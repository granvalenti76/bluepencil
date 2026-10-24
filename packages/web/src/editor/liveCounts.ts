import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import {
  countLines,
  countWords,
  mapSections,
  readability,
  readingMinutes,
  type LanguagePack,
  type OutlineEntry,
  type SectionInfo,
} from "@desk/core";
import { frontMatterLines } from "./frontMatter.ts";

export interface LiveCounts {
  words: number;
  lines: number;
  minutes: number;
  /** The language's readability index (clarity); `null` if the text is too short. */
  readability: number | null;
  averageSentence?: number;
  longSentences?: number;
  sections: SectionInfo[];
  /** The language the text seems to be written in, among the installed ones; `null` if unclear. */
  detected: string | null;
}

export interface LiveCountsOptions {
  bodyOffset: number;
  outline: OutlineEntry[];
  /** The draft's language: readability formula and words per minute. */
  pack: LanguagePack;
  /** Detects the language of the text. */
  detect?: (body: string) => string | null;
  onCounts: (counts: LiveCounts) => void;
  /** sha256 of the body, computed after the counts (it is asynchronous). */
  onBodyHash?: (hash: string) => void;
  /** Cursor line after the front matter, updated at once (no debounce). */
  onCursor: (line: number) => void;
}

/** Live counts: 150 ms debounce; the cursor line is not debounced. */
export function liveCounts(opts: LiveCountsOptions): Extension {
  const compute = (view: EditorView) => {
    const body = view.state.doc.sliceString(opts.bodyOffset);
    const words = countWords(body);
    opts.onCounts({
      words,
      lines: countLines(body),
      minutes: readingMinutes(words, opts.pack.wordsPerMinute),
      ...readable(readability(body, opts.pack.readability)),
      sections: mapSections(body, opts.outline),
      detected: opts.detect?.(body) ?? null,
    });
    if (opts.onBodyHash) void sha256(body).then((h) => h && opts.onBodyHash!(h));
  };
  const cursor = (view: EditorView) => {
    const offset = view.state.facet(frontMatterLines);
    opts.onCursor(
      Math.max(1, view.state.doc.lineAt(view.state.selection.main.head).number - offset),
    );
  };

  return ViewPlugin.fromClass(
    class {
      timer: ReturnType<typeof setTimeout> | undefined;
      constructor(view: EditorView) {
        compute(view);
        cursor(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged) {
          clearTimeout(this.timer);
          this.timer = setTimeout(() => compute(u.view), 150);
        }
        if (u.docChanged || u.selectionSet) cursor(u.view);
      }
      destroy() {
        clearTimeout(this.timer);
      }
    },
  );
}

const readable = (r: ReturnType<typeof readability>) => ({
  readability: r.index,
  ...(r.averageSentence !== undefined
    ? { averageSentence: r.averageSentence, longSentences: r.longSentences ?? 0 }
    : {}),
});

/** Hex like the server's `createHash("sha256")`; "" where `crypto.subtle` is missing. */
async function sha256(text: string): Promise<string> {
  if (!globalThis.crypto?.subtle) return "";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
