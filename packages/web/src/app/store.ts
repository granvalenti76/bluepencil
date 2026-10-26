import { create } from "zustand";
import type { Judgment } from "@desk/core";
import type { BlockStyle } from "../editor/formatting.ts";
import type { FilterType } from "../editor/judgmentsField.ts";

/**
 * Write, Review or Style: a browser preference, not part of the draft. You start by writing.
 * Style is not editing: it sets the draft beside the style it looks at.
 */
export type Mode = "write" | "review" | "style";
const MODE_KEY = "desk-mode";
function loadMode(): Mode {
  try {
    const m = localStorage.getItem(MODE_KEY);
    return m === "review" || m === "style" ? m : "write";
  } catch {
    return "write";
  }
}
function saveMode(mode: Mode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* without localStorage the choice holds while the page stays open */
  }
}

/** "Handwriting", "Typing sounds", "Style cues": browser preferences, off by default. */
type Pref = "handwriting" | "typingSounds" | "styleCues";
const PREF_KEY: Record<Pref, string> = {
  handwriting: "desk-handwriting",
  typingSounds: "desk-typing-sounds",
  styleCues: "desk-style-cues",
};
function loadPref(key: Pref): boolean {
  try {
    return localStorage.getItem(PREF_KEY[key]) === "on";
  } catch {
    return false;
  }
}
function savePref(key: Pref, on: boolean) {
  try {
    localStorage.setItem(PREF_KEY[key], on ? "on" : "off");
  } catch {
    /* without localStorage the choice holds while the page stays open */
  }
}

interface UiState {
  focus: boolean;
  hemingway: boolean;
  typewriter: boolean;
  /** In Write the author's text in their own hand (Pinyon Script, the signature), in ink. */
  handwriting: boolean;
  /** A synthesised typing sound at every key (editor/typingSounds.ts). */
  typingSounds: boolean;
  /** The style's cues numbered on the page in Write too, not only in Style mode. */
  styleCues: boolean;
  /** Write: formatting bar, outline and page. Review: page and the editor's notes. Style: page and
   * the style the draft looks at. */
  mode: Mode;
  /** The drafts list, open over the desk (⌘O). */
  draftsOpen: boolean;
  /** Preview: the piece as it will be published, in place of the editor. */
  preview: boolean;
  /** The Markdown shown in the editor (⌥⌘M): the state lives in the editor, this is a copy. */
  markdownShown: boolean;
  /** The style of the cursor's paragraph and whether there is a selection: for the formatting bar. */
  caret: { style: BlockStyle; selection: boolean };
  setMode: (mode: Mode) => void;
  setDrafts: (open?: boolean) => void;
  togglePreview: () => void;
  visibleTypes: Record<FilterType, boolean>;
  toggle: (key: "focus" | "hemingway" | "typewriter") => void;
  togglePref: (key: Pref) => void;
  toggleType: (type: FilterType) => void;
}

export const useUi = create<UiState>()((set, get) => ({
  focus: false,
  hemingway: false,
  typewriter: false,
  handwriting: loadPref("handwriting"),
  typingSounds: loadPref("typingSounds"),
  styleCues: loadPref("styleCues"),
  mode: loadMode(),
  draftsOpen: false,
  preview: false,
  markdownShown: false,
  caret: { style: "body", selection: false },
  setMode: (mode) => {
    set({ mode });
    saveMode(mode);
  },
  setDrafts: (open) => set({ draftsOpen: open ?? !get().draftsOpen }),
  togglePreview: () => set((s) => ({ preview: !s.preview })),
  visibleTypes: { fact: true, grammar: true, prose: true, struct: true },
  toggle: (key) => set((s) => ({ [key]: !s[key] })),
  togglePref: (key) => {
    const on = !get()[key];
    set({ [key]: on });
    savePref(key, on);
  },
  toggleType: (type) =>
    set((s) => ({ visibleTypes: { ...s.visibleTypes, [type]: !s.visibleTypes[type] } })),
}));

interface JudgmentsState {
  /** The open draft's judgments (body offsets), for the margin notes. */
  notes: Judgment[];
  /** Note under the mouse or with focus: its text is highlighted. */
  hoverId: string | null;
  /** Note to highlight after a click on the underline. */
  flashId: string | null;
  setNotes: (notes: Judgment[]) => void;
  patchNote: (id: string, patch: Partial<Judgment>, clearApplied?: boolean) => void;
  setHover: (id: string | null) => void;
  flash: (id: string) => void;
  /** State by id, updated by the editor (e.g. `stale` when writing inside a range). */
  statuses: Record<string, string>;
  setStatuses: (ids: string[], status: string) => void;
}

export const useJudgments = create<JudgmentsState>()((set) => ({
  notes: [],
  hoverId: null,
  flashId: null,
  setNotes: (notes) => set({ notes }),
  patchNote: (id, patch, clearApplied) =>
    set((s) => ({
      notes: s.notes.map((n) => {
        if (n.id !== id) return n;
        const next = { ...n, ...patch };
        if (clearApplied) delete next.applied;
        return next;
      }),
    })),
  setHover: (hoverId) => set({ hoverId }),
  flash: (flashId) => set({ flashId }),
  statuses: {},
  setStatuses: (ids, status) =>
    set((s) => ({
      statuses: { ...s.statuses, ...Object.fromEntries(ids.map((id) => [id, status])) },
    })),
}));
