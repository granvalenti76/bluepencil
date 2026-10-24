export type SectionState = "empty" | "progress" | "on_target" | "over";

export const SECTION_STATE_LABEL: Record<SectionState, string> = {
  empty: "to write",
  progress: "in progress",
  on_target: "on target",
  over: "over target",
};

/** "Readable" text of the body: without Markdown markers, link URLs, footnotes and HTML comments. */
export function stripMarkdown(body: string): string {
  return body
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/^\[[^\]]+\]:.*$/gm, " ") // definitions of [^n]: footnotes and of links
    .replace(/\[\^[^\]]+\]/g, "") // [^n] references
    .replace(/<(?:https?:\/\/|mailto:)[^>\s]*>/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*([-*_][ \t]*){3,}$/gm, " ") // horizontal rules
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*(?:>[ \t]?)+/gm, "")
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, "")
    .replace(/[*`]|~~/g, "")
    .replace(/(?<!\w)_(?=\S)|(?<=\S)_(?!\w)/g, "");
}

export function countWords(body: string): number {
  const text = stripMarkdown(body).trim();
  return text === "" ? 0 : text.split(/\s+/).length;
}

/** Lines of the body (front matter excluded); the final "\n" does not open a new line. */
export function countLines(body: string): number {
  if (body === "") return 0;
  const n = body.split("\n").length;
  return body.endsWith("\n") ? n - 1 : n;
}

export function readingMinutes(words: number, wordsPerMinute = 230): number {
  return Math.max(1, Math.ceil(words / wordsPerMinute));
}

export function sectionState(words: number, target: number): SectionState {
  if (words === 0) return "empty";
  if (target <= 0) return "progress";
  const ratio = words / target;
  if (ratio < 0.8) return "progress";
  if (ratio <= 1.1) return "on_target";
  return "over";
}
