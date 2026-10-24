import { create } from "zustand";
import { LONG_SENTENCE } from "@desk/core";
import { getToken } from "./api.ts";

/** A habit across drafts (server: routes/habits.ts). */
export interface Habit {
  id: string;
  count: number;
  drafts: number;
  inDraft: number;
  previous?: number;
}

interface HabitsState {
  habits: Habit[];
  /** Words that come back: notes on these words say "your habit". */
  words: string[];
  set: (patch: Partial<HabitsState>) => void;
}

export const useHabits = create<HabitsState>()((set) => ({
  habits: [],
  words: [],
  set: (patch) => set(patch),
}));

export function habitLabel(id: string): string {
  if (id === "intensifiers") return "Intensifying adverbs";
  if (id === "long-sentences") return `Sentences over ${LONG_SENTENCE} words`;
  return `«${id.replace(/^word:/, "")}»`;
}

/** The habits, with the open draft for the "in this piece" count. */
export async function loadHabits(path: string | null) {
  try {
    const q = path ? `?path=${encodeURIComponent(path)}` : "";
    const res = await fetch(`/api/habits${q}`, { headers: { "X-Desk-Token": getToken() ?? "" } });
    const data = (await res.json()) as { habits: Habit[]; words: string[] };
    useHabits.getState().set({ habits: data.habits ?? [], words: data.words ?? [] });
  } catch {
    /* without habits the margin shows only the notes */
  }
}
