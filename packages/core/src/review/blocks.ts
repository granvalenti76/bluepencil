import { countWords } from "../document/wordcount.ts";

/** The text an analysis checks: the whole body, or the selected passage. */
export interface Block {
  from: number;
  to: number;
  text: string;
}

/** The whole body as text to check. */
export function wholeText(body: string): Block {
  return { from: 0, to: body.length, text: body };
}

interface Para {
  from: number;
  to: number;
  text: string;
  words: number;
}

const FOOTNOTE_DEF = /^\[\^[^\]]+\]:/;

/** Paragraphs (separated by blank lines) inside [from, to), without the footnote definitions. */
export function paragraphs(body: string, from = 0, to = body.length): Para[] {
  const out: Para[] = [];
  const re = /\n[ \t]*\n/g;
  re.lastIndex = from;
  let start = from;
  const push = (a: number, b: number) => {
    const raw = body.slice(a, b);
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text === "") return;
    if (text.split("\n").every((l) => FOOTNOTE_DEF.test(l) || /^\s{2,}\S/.test(l))) return;
    out.push({ from: a + lead, to: a + lead + text.length, text, words: countWords(text) });
  };
  for (let m = re.exec(body); m && m.index < to; m = re.exec(body)) {
    push(start, m.index);
    start = m.index + m[0].length;
  }
  push(start, to);
  return out;
}
