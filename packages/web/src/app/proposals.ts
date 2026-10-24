import { create } from "zustand";
import { Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { Judgment } from "@desk/core";
import { addAuthored } from "../editor/authorship.ts";
import { deskAction } from "../editor/deskAction.ts";
import { judgmentsField, updateJudgment } from "../editor/judgmentsField.ts";
import { api, postEvents } from "./api.ts";
import { useDoc } from "./docStore.ts";
import { useModel } from "./modelStore.ts";
import { useJudgments } from "./store.ts";

export interface Proposal {
  status: "loading" | "ready" | "error";
  phase?: string;
  reasoningTokens?: number;
  text?: string;
  error?: string;
}

interface ProposalsState {
  byId: Record<string, Proposal>;
  set: (id: string, p: Proposal | null) => void;
}

export const useProposals = create<ProposalsState>()((set) => ({
  byId: {},
  set: (id, p) =>
    set((s) => {
      const byId = { ...s.byId };
      if (p) byId[id] = p;
      else delete byId[id];
      return { byId };
    }),
}));

const controllers = new Map<string, AbortController>();
const CONTEXT = 32;

export const isSectionProposal = (j: Judgment) =>
  j.proposal.action === "draft_section" || j.proposal.action === "regenerate_section";

/**
 * "Propose a draft" / "Rewrite …": asks the model for a **proposal**, shown in a box below the
 * note with "Insert" and "Discard". The file does not change until the author chooses "Insert".
 */
export async function requestProposal(note: Judgment) {
  const { path } = useDoc.getState();
  if (!path || !note.sectionId) return;
  controllers.get(note.id)?.abort();
  const controller = new AbortController();
  controllers.set(note.id, controller);
  const set = (p: Proposal | null) => useProposals.getState().set(note.id, p);
  set({ status: "loading" });
  let done = false;
  try {
    await postEvents(
      "/api/proposals/section",
      {
        path,
        sectionId: note.sectionId,
        mode: note.proposal.action === "draft_section" ? "draft" : "regenerate",
        judgmentId: note.id,
        cloud: useModel.getState().cloud,
      },
      (event, data) => {
        const d = data as {
          phase?: string;
          reasoningTokens?: number;
          text?: string;
          message?: string;
        };
        if (event === "progress")
          set({ status: "loading", phase: d.phase, reasoningTokens: d.reasoningTokens });
        else if (event === "done") {
          done = true;
          set({ status: "ready", text: d.text });
        } else if (event === "error") {
          done = true;
          set({ status: "error", error: d.message });
        }
      },
      controller.signal,
    );
    if (!done && !controller.signal.aborted) set({ status: "error", error: "Incomplete response" });
  } catch {
    if (!controller.signal.aborted) set({ status: "error", error: "Couldn’t reach the server" });
  } finally {
    controllers.delete(note.id);
  }
}

export function discardProposal(id: string) {
  controllers.get(id)?.abort();
  useProposals.getState().set(id, null);
}

export function proposalStatusText(p: Proposal): string {
  if (p.status === "error") return `Suggestion failed: ${p.error ?? ""}`;
  if (p.phase === "queued") return "Queued…";
  if (p.phase === "busy") return "The server is busy with another app, waiting…";
  if (p.phase === "writing") return "Writing the suggestion…";
  return `The model is thinking…${p.reasoningTokens ? ` (${p.reasoningTokens} tokens)` : ""}`;
}

/** Where the proposed text goes (document offset). */
function target(
  view: EditorView,
  note: Judgment,
): { from: number; to: number; insert: string } | null {
  const { sections, bodyOffset, outline } = useDoc.getState();
  const text = useProposals.getState().byId[note.id]?.text;
  if (!text) return null;
  const doc = view.state.doc;
  const section = sections.find((s) => s.id === note.sectionId);
  const entry = outline.find((o) => o.id === note.sectionId);

  if (!section?.range) {
    // Missing section: at the end of the document, with its heading or marker.
    const end = doc.length;
    const trimmed = doc.sliceString(0, end).replace(/\s+$/, "").length;
    const opener = entry?.heading
      ? `## ${entry.heading}\n\n`
      : `<!-- section: ${note.sectionId} -->\n`;
    return { from: trimmed, to: end, insert: `\n\n${opener}${text}\n` };
  }
  const from = bodyOffset + section.range.from;
  const to = bodyOffset + section.range.to;
  const raw = doc.sliceString(from, to);
  const opener = /^\s*(#{1,6}[ \t][^\n]*\n|<!--\s*section:[^>]*-->[ \t]*\n?)/.exec(raw);
  const proseFrom = from + (opener ? opener[0].length : raw.length - raw.trimStart().length);
  const proseTo = from + raw.replace(/\s+$/, "").length;
  if (note.proposal.action === "regenerate_section" || proseTo <= proseFrom) {
    const lead =
      opener && !opener[0].endsWith("\n\n") && proseTo > proseFrom ? "" : opener ? "\n" : "";
    return { from: proseFrom, to: Math.max(proseFrom, proseTo), insert: `${lead}${text}` };
  }
  return { from: proseTo, to: proseTo, insert: `\n\n${text}` };
}

/** "Insert": the text goes into the file with an action of the author, undoable (Cmd+Z and "Undo"). */
export function insertProposal(view: EditorView | null, note: Judgment) {
  if (!view) return;
  const t = target(view, note);
  if (!t) return;
  const { bodyOffset } = useDoc.getState();
  const doc = view.state.doc;
  const next = view.state.changes(t).apply(doc);
  const end = t.from + t.insert.length;
  const applied = {
    from: t.from,
    to: end,
    original: doc.sliceString(t.from, t.to),
    replacement: t.insert,
    before: next.sliceString(Math.max(0, t.from - CONTEXT), t.from),
    after: next.sliceString(end, end + CONTEXT),
  };
  const tracked = view.state.field(judgmentsField).items.some((j) => j.id === note.id);
  view.dispatch({
    changes: t,
    effects: [
      ...(tracked
        ? [updateJudgment.of({ id: note.id, status: "applied", from: t.from, to: end, applied })]
        : []),
      // The text proposed by the model: counts towards authorship, without the surrounding line breaks.
      addAuthored.of({
        from: t.from + (t.insert.length - t.insert.trimStart().length),
        to: end - (t.insert.length - t.insert.trimEnd().length),
        source: "section",
      }),
    ],
    annotations: [deskAction.of(true), Transaction.userEvent.of("input.note")],
  });
  if (!tracked) {
    // Section note: it does not live in the editor, the state is saved here (body offset).
    const body = { ...applied, from: applied.from - bodyOffset, to: applied.to - bodyOffset };
    useJudgments.getState().patchNote(note.id, { status: "applied", applied: body });
    void api.patchJudgment(note.id, { status: "applied", applied: body }).catch(() => {});
  }
  useProposals.getState().set(note.id, null);
}

/**
 * "Add empty section": for a missing part, its heading (or marker) at the end of the text,
 * without writing anything in the author's place; the cursor goes there. If the section exists
 * but is empty, the cursor goes to its start. Undoable ("Undo" and ⌘Z).
 */
export function addEmptySection(view: EditorView | null, note: Judgment) {
  if (!view || !note.sectionId) return;
  const { sections, bodyOffset, outline } = useDoc.getState();
  const section = sections.find((s) => s.id === note.sectionId);
  const done = (applied?: Judgment["applied"]) => {
    useJudgments
      .getState()
      .patchNote(note.id, { status: "applied", ...(applied ? { applied } : {}) });
    void api.patchJudgment(note.id, { status: "applied", applied }).catch(() => {});
  };
  if (section?.range) {
    const at = bodyOffset + section.range.to;
    view.dispatch({ selection: { anchor: at }, scrollIntoView: true });
    view.focus();
    done();
    return;
  }
  const doc = view.state.doc;
  const entry = outline.find((o) => o.id === note.sectionId);
  const from = doc.sliceString(0, doc.length).replace(/\s+$/, "").length;
  const opener = entry?.heading ? `## ${entry.heading}` : `<!-- section: ${note.sectionId} -->`;
  const insert = `\n\n${opener}\n\n`;
  const end = from + insert.length;
  const next = view.state.changes({ from, to: doc.length, insert }).apply(doc);
  view.dispatch({
    changes: { from, to: doc.length, insert },
    selection: { anchor: end },
    scrollIntoView: true,
    annotations: [deskAction.of(true), Transaction.userEvent.of("input.note")],
  });
  view.focus();
  done({
    from: from - bodyOffset,
    to: end - bodyOffset,
    original: doc.sliceString(from),
    replacement: insert,
    before: next.sliceString(Math.max(0, from - CONTEXT), from),
    after: "",
  });
}
