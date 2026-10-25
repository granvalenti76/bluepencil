import { create } from "zustand";
import { draftLanguage, type DraftLanguage, type OutlineEntry, type SectionInfo } from "@desk/core";
import type { TrackedJudgment } from "../editor/judgmentsField.ts";
import type { DraftDetail, DraftRow } from "./api.ts";

export type SaveStatus = "saved" | "dirty" | "saving" | "error" | "conflict";

export interface Counts {
  words: number;
  lines: number;
  minutes: number;
  /** Gulpease index of the body; `null` if the text is too short. */
  readability: number | null;
  /** "sentences" formula (packs without a language formula): words per sentence and long sentences. */
  averageSentence?: number;
  longSentences?: number;
}

interface DocState {
  path: string | null;
  /** Changes at every (re)load: the editor is recreated. */
  loadId: number;
  /** Text the editor is created with (whole file, front matter included). */
  text: string;
  /** Initial cursor position (absolute); `null` = start of the body. */
  selection: number | null;
  bodyOffset: number;
  hash: string;
  title: string;
  archetype: string;
  stage: string;
  target: number;
  outline: OutlineEntry[];
  /** From the Structure phase: what it is about. */
  brief: string;
  /** The review's sign-off (`signoff` in the front matter). */
  signoff: { at: string; body: string } | null;
  /** The style the draft looks at (`reference:`, a path in `Styles/`). */
  reference: string | null;
  /** The draft's language (`lang` in the front matter; Italian if missing). */
  lang: DraftLanguage;
  /** The language the text seems to be written in, if clear (to propose changing `lang`). */
  detectedLang: string | null;
  status: SaveStatus;
  counts: Counts;
  /** sha256 of the current body (to know whether a model score is outdated). */
  bodyHash: string;
  sections: SectionInfo[];
  /** Cursor line, counted after the front matter. */
  cursorLine: number;
  /** The judgments with text, at document positions, to create the editor. */
  tracked: TrackedJudgment[];
  loading: boolean;
  error: string | null;
  set: (patch: Partial<DocState>) => void;
}

export const useDoc = create<DocState>()((set) => ({
  path: null,
  loadId: 0,
  text: "",
  selection: null,
  bodyOffset: 0,
  hash: "",
  title: "",
  archetype: "undecided",
  stage: "writing",
  target: 0,
  outline: [],
  signoff: null,
  reference: null,
  brief: "",
  lang: draftLanguage(undefined),
  detectedLang: null,
  status: "saved",
  counts: { words: 0, lines: 0, minutes: 1, readability: null },
  bodyHash: "",
  sections: [],
  cursorLine: 1,
  tracked: [],
  loading: false,
  error: null,
  set: (patch) => set(patch),
}));

interface DraftsState {
  drafts: DraftRow[];
  filter: "all" | "structure" | "writing" | "review";
  set: (patch: Partial<DraftsState>) => void;
}

export const useDrafts = create<DraftsState>()((set) => ({
  drafts: [],
  filter: "all",
  set: (patch) => set(patch),
}));

export type { DraftDetail };
