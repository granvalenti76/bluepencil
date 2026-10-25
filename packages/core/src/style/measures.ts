import { stripMarkdown } from "../document/wordcount.ts";

/**
 * A style, measured without the model: how long the sentences are and how much they vary, how
 * many sentences a paragraph holds, how often the text asks, opens an aside, gives an exact
 * number or makes a list. The same measures for a style's pieces and for the draft.
 */
export const STYLE_MEASURES = [
  "sentenceLength",
  "sentenceVariety",
  "paragraphLength",
  "questions",
  "asides",
  "numbers",
  "lists",
] as const;
export type StyleMeasure = (typeof STYLE_MEASURES)[number];

export const STYLE_MEASURE_LABEL: Record<StyleMeasure, string> = {
  sentenceLength: "Words per sentence",
  sentenceVariety: "Sentence variety",
  paragraphLength: "Sentences per paragraph",
  questions: "Questions per 1,000 words",
  asides: "Asides per 1,000 words",
  numbers: "Numbers per 1,000 words",
  lists: "List items per 1,000 words",
};

/** A sentence of the body, with its offsets (body positions). */
export interface MeasuredSentence {
  from: number;
  to: number;
  words: number;
}

/** A paragraph of prose, with its offsets and its word count. */
export interface MeasuredParagraph {
  from: number;
  to: number;
  words: number;
}

export interface MeasuredText {
  words: number;
  sentences: MeasuredSentence[];
  paragraphs: MeasuredParagraph[];
  measures: Record<StyleMeasure, number>;
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
const wordsIn = (s: string) => stripMarkdown(s).match(WORD)?.length ?? 0;

/** A sentence ends at . ! ? … followed by a space, a closing quote or bracket, or the end. */
const SENTENCE_END = /[.!?…]+[»”")\]]*(?=\s|$)/g;
/** A figure: digits, with decimal or thousands separators. */
const NUMBER = /(?<![\p{L}\p{N}])\p{N}+(?:[.,]\p{N}+)*/gu;

/** Lines that are not prose: headings, footnote definitions, fences, comments, rules, tables. */
const NOT_PROSE = /^[ \t]{0,3}(?:#{1,6}[ \t]|\[\^[^\]]+\]:|```|~~~|<!--|\|)|^\s*([-*_][ \t]*){3,}$/;
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/;

/** Measures a body (front matter already removed). */
export function measureText(body: string): MeasuredText {
  const text = body.replace(/<!--[\s\S]*?-->/g, (c) => " ".repeat(c.length));
  const sentences: MeasuredSentence[] = [];
  const paragraphs: MeasuredParagraph[] = [];
  let listItems = 0;
  let questions = 0;
  let asides = 0;
  let numbers = 0;
  let fenced = false;

  // Paragraphs: runs of prose lines, with their offset in the body.
  let para: { from: number; text: string } | null = null;
  const closePara = () => {
    if (!para) return;
    const found = splitSentences(para.text, para.from);
    if (found.length) {
      paragraphs.push({
        from: para.from,
        to: para.from + para.text.length,
        words: found.reduce((a, s) => a + s.words, 0),
      });
    }
    for (const s of found) {
      sentences.push(s);
      if (/\?[»”")\]]*$/.test(text.slice(s.from, s.to))) questions++;
    }
    asides += (para.text.match(/\(/g) ?? []).length;
    numbers += (stripMarkdown(para.text).match(NUMBER) ?? []).length;
    para = null;
  };

  let at = 0;
  for (const line of text.split("\n")) {
    const from = at;
    at += line.length + 1;
    if (/^[ \t]{0,3}(```|~~~)/.test(line)) {
      closePara();
      fenced = !fenced;
      continue;
    }
    if (fenced || line.trim() === "" || NOT_PROSE.test(line)) {
      closePara();
      continue;
    }
    if (LIST_ITEM.test(line)) {
      closePara();
      listItems++;
      continue;
    }
    const content = line.replace(/^[ \t]*(?:>[ \t]?)+/, "");
    const start = from + (line.length - content.length);
    if (para) para.text += `\n${" ".repeat(line.length - content.length)}${content}`;
    else para = { from: start, text: content };
  }
  closePara();

  const words = wordsIn(stripMarkdown(text));
  const lengths = sentences.map((s) => s.words);
  const mean = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  const sd = lengths.length
    ? Math.sqrt(lengths.reduce((a, n) => a + (n - mean) ** 2, 0) / lengths.length)
    : 0;
  const perThousand = (n: number) => (words ? (n * 1000) / words : 0);
  return {
    words,
    sentences,
    paragraphs,
    measures: {
      sentenceLength: round1(mean),
      // Coefficient of variation, in percent: how much the lengths move around the mean.
      sentenceVariety: mean ? Math.round((sd / mean) * 100) : 0,
      paragraphLength: paragraphs.length ? round1(sentences.length / paragraphs.length) : 0,
      questions: round1(perThousand(questions)),
      asides: round1(perThousand(asides)),
      numbers: round1(perThousand(numbers)),
      lists: round1(perThousand(listItems)),
    },
  };
}

function splitSentences(para: string, offset: number): MeasuredSentence[] {
  const out: MeasuredSentence[] = [];
  let start = 0;
  const push = (end: number) => {
    const raw = para.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    const n = wordsIn(trimmed);
    if (n > 0) {
      const from = offset + start + lead;
      out.push({ from, to: from + trimmed.length, words: n });
    }
  };
  for (const m of para.matchAll(SENTENCE_END)) {
    const end = m.index + m[0].length;
    push(end);
    start = end;
  }
  push(para.length);
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
