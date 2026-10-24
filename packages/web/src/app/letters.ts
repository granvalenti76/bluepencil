import { create } from "zustand";
import type { Pass } from "@desk/core";
import { api, type StoredLetter } from "./api.ts";
import { useDoc } from "./docStore.ts";

interface LettersState {
  path: string | null;
  byPass: Partial<Record<Pass, StoredLetter>>;
  /** The letter just arrived from the model: written line by line, only once. */
  fresh: Pass | null;
  set: (patch: Partial<LettersState>) => void;
}

/** The editor's letters for the open draft, one per pass. */
export const useLetters = create<LettersState>()((set) => ({
  path: null,
  byPass: {},
  fresh: null,
  set: (patch) => set(patch),
}));

export const letters = {
  async load(path: string | null) {
    useLetters.getState().set({ path, byPass: {}, fresh: null });
    if (!path) return;
    try {
      const list = await api.letters(path);
      if (useLetters.getState().path !== path) return;
      useLetters.getState().set({ byPass: Object.fromEntries(list.map((l) => [l.pass, l])) });
    } catch {
      /* without letters the margin shows only the notes */
    }
  },

  onLetter(e: { path: string; letter: StoredLetter }) {
    const s = useLetters.getState();
    if (e.path !== s.path) return;
    s.set({ byPass: { ...s.byPass, [e.letter.pass]: e.letter }, fresh: e.letter.pass });
  },

  /** "Clear suggestions" also removes them on the server. */
  clear() {
    useLetters.getState().set({ byPass: {}, fresh: null });
  },
};

/** Does the letter still hold for the current text? (`null` = unknown: fingerprint not computed.) */
export function letterIsCurrent(letter: StoredLetter): boolean | null {
  const hash = useDoc.getState().bodyHash;
  return hash ? hash === letter.bodyHash : null;
}
