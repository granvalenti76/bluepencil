import { create } from "zustand";
import type { ScoreKind } from "@desk/core";
import { api, type StoredScore } from "./api.ts";
import { useDoc } from "./docStore.ts";

interface ScoresState {
  path: string | null;
  byKind: Partial<Record<ScoreKind, StoredScore>>;
  set: (patch: Partial<ScoresState>) => void;
}

/** The model's latest scores (prose, structure) for the open draft. */
export const useScores = create<ScoresState>()((set) => ({
  path: null,
  byKind: {},
  set: (patch) => set(patch),
}));

export const scores = {
  async load(path: string | null) {
    useScores.getState().set({ path, byKind: {} });
    if (!path) return;
    try {
      const list = await api.scores(path);
      if (useScores.getState().path !== path) return;
      useScores.getState().set({ byKind: Object.fromEntries(list.map((s) => [s.kind, s])) });
    } catch {
      /* without scores the panel shows "—" */
    }
  },

  onScore(e: { path: string; score: StoredScore }) {
    const s = useScores.getState();
    if (e.path !== s.path) return;
    s.set({ byKind: { ...s.byKind, [e.score.kind]: e.score } });
  },
};

/** Does the score still hold for the current text? (`null` = unknown: fingerprint not computed.) */
export function isCurrent(score: StoredScore): boolean | null {
  const hash = useDoc.getState().bodyHash;
  return hash ? hash === score.bodyHash : null;
}
