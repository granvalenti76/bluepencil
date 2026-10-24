import { create } from "zustand";
import {
  currentPass,
  nextPass,
  REVIEW_ORDER,
  type Pass,
  type PassRecord,
  type PassState,
} from "@desk/core";
import type { FilterType } from "../editor/judgmentsField.ts";
import { api } from "./api.ts";
import { motion } from "./motion.ts";
import { review, useReview } from "./review.ts";
import { session } from "./session.ts";
import { useUi } from "./store.ts";

/**
 * The review passes: top to bottom, one at a time. The server keeps each one's state; here we
 * choose which one is shown and move to the next.
 */
interface PassesState {
  path: string | null;
  records: PassRecord[];
  /** The pass the author is looking at; `null` = the one to work on. */
  viewed: Pass | null;
  set: (patch: Partial<PassesState>) => void;
}

export const usePasses = create<PassesState>()((set) => ({
  path: null,
  records: [],
  viewed: null,
  set: (patch) => set(patch),
}));

export const PASS_FILTER: Record<Pass, FilterType> = {
  structure: "struct",
  facts: "fact",
  prose: "prose",
  grammar: "grammar",
};

const ALL_TYPES: Record<FilterType, boolean> = {
  struct: true,
  fact: true,
  prose: true,
  grammar: true,
};

/** The pass-by-pass review has started on this draft. */
export const isActive = (s: Pick<PassesState, "records">) => s.records.length > 0;

/** The pass shown: the chosen one, otherwise the one to work on (`null` = all). */
export function shownPass(s: Pick<PassesState, "records" | "viewed">): Pass | null {
  if (!isActive(s)) return null;
  return s.viewed ?? currentPass(s.records);
}

/** Notes and underlines: only those of the pass shown; all of them outside the review. */
function syncVisibility() {
  const shown = shownPass(usePasses.getState());
  const visibleTypes = shown
    ? { struct: false, fact: false, prose: false, grammar: false, [PASS_FILTER[shown]]: true }
    : ALL_TYPES;
  useUi.setState({ visibleTypes });
}
usePasses.subscribe(syncVisibility);

// A check on a selection shows its note type, even outside the current pass.
useReview.subscribe((s, prev) => {
  const p = s.progress;
  if (p?.selection && !prev.progress?.selection && isActive(usePasses.getState())) {
    passes.view(p.step);
  }
});

function apply(path: string, records: PassRecord[]) {
  if (usePasses.getState().path !== path) return;
  usePasses.getState().set({ records, viewed: null });
}

/** Starts the pass to work on, if any: re-entering with the text unchanged does not call the model. */
async function runCurrent() {
  const pass = currentPass(usePasses.getState().records);
  if (pass) await review.start({ types: [pass] });
}

async function change(pass: Pass, state: PassState) {
  const path = usePasses.getState().path;
  if (!path) return;
  // The server takes the body's fingerprint from disk: save first.
  await session.saveNow();
  apply(path, await api.setPass(path, pass, state));
}

export const passes = {
  async load(path: string | null) {
    usePasses.getState().set({ path, records: [], viewed: null });
    if (!path) return;
    try {
      apply(path, await api.passes(path));
    } catch {
      /* without pass state the review has not started */
    }
  },

  /** After an analysis: a computed pass becomes "open". */
  async refresh() {
    const path = usePasses.getState().path;
    if (!path) return;
    try {
      const records = await api.passes(path);
      if (usePasses.getState().path === path) usePasses.getState().set({ records });
    } catch {
      /* the previous state stays */
    }
  },

  /** "Start review": begins with structure. */
  begin() {
    motion.serve();
    return review.start({ types: [REVIEW_ORDER[0]] });
  },

  /** All passes at once (to read them later, in order). */
  all: () => review.start(),

  /** Closes the pass (open notes stay open) and starts the next one. */
  async finish(pass: Pass) {
    await change(pass, "done");
    motion.serve();
    await runCurrent();
  },

  async skip(pass: Pass) {
    await change(pass, "skipped");
    motion.serve();
    await runCurrent();
  },

  /** Reopens a closed pass and checks it again on the current text. */
  async reopen(pass: Pass) {
    await change(pass, "open");
    motion.serve();
    await runCurrent();
  },

  /** "Restart review": again from structure. The notes stay. */
  async restart() {
    const path = usePasses.getState().path;
    if (!path) return;
    apply(path, await api.restartPasses(path));
    await passes.begin();
  },

  /** Checks the pass to work on again, on the current text. */
  checkAgain: runCurrent,

  view(pass: Pass | null) {
    const current = currentPass(usePasses.getState().records);
    usePasses.getState().set({ viewed: pass === current ? null : pass });
  },
};

export { nextPass };
