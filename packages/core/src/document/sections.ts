import type { OutlineEntry } from "./frontmatter.ts";
import { countWords, sectionState, type SectionState } from "./wordcount.ts";

export interface SectionInfo {
  id: string;
  title: string;
  target: number;
  /** Range in the body; `null` if the section has no boundary in the text yet. */
  range: { from: number; to: number } | null;
  /** Words in the range, heading included. */
  words: number;
  /** No text besides the heading: the section is "to write". */
  isEmpty: boolean;
  state: SectionState;
}

const MARKER = /<!--\s*section:\s*([\w-]+)\s*-->/g;

interface Scan {
  h1End: number | null;
  markers: Map<string, number>;
  headings: { text: string; from: number }[];
}

function scan(body: string): Scan {
  const out: Scan = { h1End: null, markers: new Map(), headings: [] };
  let offset = 0;
  let fence: string | null = null;
  for (const line of body.split("\n")) {
    const lineEnd = offset + line.length + 1;
    const f = /^\s{0,3}(```+|~~~+)/.exec(line);
    if (f) {
      const mark = f[1]!;
      if (fence === null) fence = mark;
      else if (mark.startsWith(fence[0]!) && mark.length >= fence.length) fence = null;
    } else if (fence === null) {
      for (const m of line.matchAll(MARKER)) {
        if (!out.markers.has(m[1]!)) out.markers.set(m[1]!, offset + m.index);
      }
      if (out.h1End === null && /^# /.test(line)) out.h1End = Math.min(lineEnd, body.length);
      const h2 = /^##[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
      if (h2) out.headings.push({ text: h2[1]!, from: offset });
    }
    offset = lineEnd;
  }
  return out;
}

/**
 * The marker wins over the heading; the lead is the text between the H1 and the first boundary;
 * a section with no boundary and no text is "to write".
 */
export function mapSections(body: string, outline: OutlineEntry[]): SectionInfo[] {
  const { h1End, markers, headings } = scan(body);

  const starts = new Map<string, number>();
  outline.forEach((entry, i) => {
    let from = markers.get(entry.id);
    if (from === undefined && entry.heading !== undefined) {
      from = headings.find((h) => h.text === entry.heading)?.from;
    }
    if (from === undefined && i === 0) from = h1End ?? 0;
    if (from !== undefined) starts.set(entry.id, from);
  });

  const ordered = [...starts.entries()].sort((a, b) => a[1] - b[1]);
  const ends = new Map<string, number>();
  ordered.forEach(([id], i) => ends.set(id, ordered[i + 1]?.[1] ?? body.length));

  return outline.map((entry) => {
    const from = starts.get(entry.id);
    const to = ends.get(entry.id);
    if (from === undefined || to === undefined) {
      return base(entry, null, 0, true);
    }
    const text = body.slice(from, to);
    const proseOnly = text.replace(/^\s*#{1,6}[^\n]*\n?/, "");
    return base(entry, { from, to }, countWords(text), countWords(proseOnly) === 0);
  });
}

function base(
  entry: OutlineEntry,
  range: SectionInfo["range"],
  words: number,
  isEmpty: boolean,
): SectionInfo {
  return {
    id: entry.id,
    title: entry.title,
    target: entry.target,
    range,
    words,
    isEmpty,
    state: isEmpty ? "empty" : sectionState(words, entry.target),
  };
}
