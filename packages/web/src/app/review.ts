import { create } from "zustand";
import { PASSES, relocateAnchor, type Judgment, type Pass, type ReviewStep } from "@desk/core";
import { addJudgments } from "../editor/judgmentsField.ts";
import { ApiError, getToken } from "./api.ts";
import { useDoc } from "./docStore.ts";
import { useModel } from "./modelStore.ts";
import { motion } from "./motion.ts";
import { toTracked } from "./notes.ts";
import { scores } from "./scores.ts";
import { session } from "./session.ts";
import { useJudgments } from "./store.ts";

export type ReviewPhase = "starting" | "queued" | "busy" | "reasoning" | "writing" | "cached";

export interface ReviewProgress {
  step: ReviewStep;
  stepIndex: number;
  stepCount: number;
  phase: ReviewPhase;
  reasoningTokens?: number;
  /** Check on a selected passage, not on the whole text. */
  selection?: boolean;
}

export interface ReviewStats {
  steps: number;
  cached: number;
  modelCalls: number;
  judgments: number;
  errors: number;
  elapsedMs: number;
}

interface ReviewState {
  runId: string | null;
  path: string | null;
  progress: ReviewProgress | null;
  /** Error that stopped the review. */
  fatal: string | null;
  /** Passes skipped because of an error (the review went on). */
  skipped: number;
  last: (ReviewStats & { cancelled: boolean }) | null;
  set: (patch: Partial<ReviewState>) => void;
}

export const useReview = create<ReviewState>()((set) => ({
  runId: null,
  path: null,
  progress: null,
  fatal: null,
  skipped: 0,
  last: null,
  set: (patch) => set(patch),
}));

const enc = (path: string) => path.split("/").map(encodeURIComponent).join("/");
const headers = () => ({ "X-Desk-Token": getToken() ?? "", "Content-Type": "application/json" });

export const STEP_LABEL: Record<ReviewStep, string> = {
  structure: "Structure",
  facts: "Facts",
  grammar: "Grammar",
  prose: "Prose",
};

/** What can be asked of the review: everything or one note type at a time. */
export interface ReviewRequest {
  types?: Pass[];
  /** Offset in the document (front matter included) and text of the selected passage. */
  selection?: { from: number; to: number; text: string };
}

/** Overall progress, 0–1. */
export function fraction(p: ReviewProgress | null): number {
  if (!p) return 0;
  const inStep = p.phase === "writing" ? 0.9 : p.phase === "reasoning" ? 0.5 : 0;
  return Math.min(1, (p.stepIndex + inStep) / Math.max(1, p.stepCount));
}

export function progressText(p: ReviewProgress | null): string {
  if (!p || p.phase === "starting") return "Starting review…";
  const scope = p.selection ? " on selection" : "";
  const where = `${STEP_LABEL[p.step]}${scope} ${p.stepIndex + 1}/${p.stepCount}`;
  switch (p.phase) {
    case "queued":
      return `${where} · queued`;
    case "busy":
      return `${where} · the server is busy with another app, waiting…`;
    case "reasoning":
      return `${where} · thinking…${p.reasoningTokens ? ` (${p.reasoningTokens} tokens)` : ""}`;
    case "writing":
      return `${where} · writing notes`;
    case "cached":
      return `${where} · already checked`;
  }
}

export const review = {
  /**
   * Switches to review: `review` phase in the front matter, then the passes. A single note type,
   * or a selected passage, can be asked for (granular review).
   */
  async start(req: ReviewRequest = {}) {
    const { path, stage, bodyOffset } = useDoc.getState();
    if (!path || useReview.getState().progress) return;
    const types = req.types ?? [...PASSES];
    const steps = PASSES.filter((p) => types.includes(p) && !(req.selection && p === "structure"));
    if (steps.length === 0) return;
    useReview.getState().set({
      path,
      fatal: null,
      skipped: 0,
      last: null,
      progress: {
        step: steps[0]!,
        stepIndex: 0,
        stepCount: steps.length,
        phase: "starting",
        ...(req.selection ? { selection: true } : {}),
      },
    });
    if (stage !== "review" && !(await session.patchFrontMatter({ stage: "review" }))) {
      useReview.getState().set({ progress: null, fatal: "Couldn’t save the draft." });
      return;
    }
    await session.saveNow();
    try {
      const res = await fetch(`/api/review/${enc(path)}`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          cloud: useModel.getState().cloud,
          ...(req.types ? { types } : {}),
          ...(req.selection
            ? {
                selection: {
                  from: req.selection.from - bodyOffset,
                  to: req.selection.to - bodyOffset,
                  text: req.selection.text,
                },
              }
            : {}),
        }),
      });
      if (!res.ok) throw new ApiError(res.status, null);
      const { runId } = (await res.json()) as { runId: string };
      // The `review.done` event may arrive before the response (everything from the cache).
      if (useReview.getState().progress !== null) useReview.getState().set({ runId });
    } catch {
      useReview.getState().set({ progress: null, fatal: "Couldn’t start the review." });
    }
  },

  async cancel() {
    const { runId } = useReview.getState();
    if (!runId) return;
    // Without Content-Type: fastify rejects an empty JSON body.
    await fetch(`/api/review/runs/${encodeURIComponent(runId)}`, {
      method: "DELETE",
      headers: { "X-Desk-Token": getToken() ?? "" },
    });
  },

  /** After a reload: is there a review running on this draft? */
  async restore(path: string | null) {
    useReview
      .getState()
      .set({ runId: null, path, progress: null, fatal: null, skipped: 0, last: null });
    if (!path) return;
    try {
      const res = await fetch("/api/review/runs", {
        headers: { "X-Desk-Token": getToken() ?? "" },
      });
      const { runs } = (await res.json()) as { runs: { runId: string; path: string }[] };
      const run = runs.find((r) => r.path === path);
      if (run && useDoc.getState().path === path) {
        useReview.getState().set({
          runId: run.runId,
          progress: {
            step: "structure",
            stepIndex: 0,
            stepCount: 3,
            phase: "starting",
          },
        });
      }
    } catch {
      /* no review to pick up */
    }
  },

  onProgress(e: ReviewProgress & { runId: string; path: string }) {
    if (e.path !== useDoc.getState().path) return;
    const { runId, ...p } = e;
    const selection = useReview.getState().progress?.selection;
    useReview.getState().set({ runId, progress: { ...p, ...(selection ? { selection } : {}) } });
  },

  onScore: scores.onScore,

  /** New notes (pass by pass): in the column and in the editor, at the positions of the current text. */
  onJudgments(e: { path: string; judgments: Judgment[]; removed: string[] }) {
    const { path, bodyOffset } = useDoc.getState();
    if (e.path !== path) return;
    const view = session.getView();
    const body = view ? view.state.doc.sliceString(bodyOffset) : null;
    const fresh: Judgment[] = [];
    for (const j of e.judgments) {
      if (j.range === null || body === null) {
        fresh.push(j);
        continue;
      }
      if (body.slice(j.range.from, j.range.to) === j.anchor.quote) {
        fresh.push(j);
        continue;
      }
      // The author wrote while the model was working: the quote is found again.
      const r = relocateAnchor(body, j.anchor, j.range.from);
      if (r) fresh.push({ ...j, range: r });
    }
    const store = useJudgments.getState();
    const known = new Set(store.notes.map((n) => n.id));
    motion.arrive(
      fresh
        .filter((j) => !known.has(j.id))
        .sort((a, b) => (a.range?.from ?? Infinity) - (b.range?.from ?? Infinity))
        .map((j) => j.id),
    );
    const gone = new Set([...e.removed, ...fresh.map((j) => j.id)]);
    store.setNotes([...store.notes.filter((n) => !gone.has(n.id)), ...fresh]);
    view?.dispatch({
      effects: addJudgments.of({
        add: fresh.flatMap((j) => toTracked(j, bodyOffset) ?? []),
        remove: e.removed,
      }),
    });
  },

  onDone(e: { path: string; runId: string; cancelled: boolean; stats: ReviewStats }) {
    const r = useReview.getState();
    if (e.path !== useDoc.getState().path && r.runId !== e.runId) return;
    r.set({ runId: null, progress: null, last: { ...e.stats, cancelled: e.cancelled } });
  },

  onError(e: { path: string; message: string; fatal: boolean }) {
    if (e.path !== useDoc.getState().path) return;
    const r = useReview.getState();
    if (e.fatal) r.set({ fatal: e.message });
    else r.set({ skipped: r.skipped + 1 });
  },
};
