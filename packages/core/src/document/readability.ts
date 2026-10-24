import type { ReadabilityConfig } from "../languages/pack.ts";
import { stripMarkdown } from "./wordcount.ts";

export interface Readability {
  /**
   * Readability index, 0–100 (higher = easier); `null` if the text is too short. With the
   * "sentences" formula there is no index: the average sentence length is used.
   */
  index: number | null;
  words: number;
  sentences: number;
  /** Average words per sentence (one decimal). */
  averageSentence?: number;
  /** Sentences over `LONG_SENTENCE` words. */
  longSentences?: number;
}

/** Beyond this many words a sentence is long, in every language ("sentences" formula). */
export const LONG_SENTENCE = 25;

/** Below this many words the index means nothing. */
const MIN_WORDS = 20;

/**
 * Words and sentences of the text, as the formulas count them. Headings, list items and
 * paragraphs without a final full stop count as sentences.
 */
function textStats(body: string): { tokens: string[]; sentences: number; lengths: number[] } {
  const text = stripMarkdown(
    body
      .replace(/<!--[\s\S]*?-->/g, " ")
      // A heading or item without a final full stop still ends the sentence.
      .replace(/^([ \t]{0,3}(?:#{1,6}[ \t]+|[-*+][ \t]+|\d+[.)][ \t]+).*?)[ \t]*$/gm, (line) =>
        /[.!?…:;]$/.test(line) ? line : `${line}.`,
      ),
  );
  const tokens: string[] = [];
  const lengths: number[] = [];
  let sentences = 0;
  for (const para of text.split(/\n[ \t]*\n/)) {
    const words = para.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
    if (words.length === 0) continue;
    tokens.push(...words);
    const ends = para.match(/[.!?…]+(?=[\s»”")\]]|$)/g)?.length ?? 0;
    // A paragraph that does not end with a full stop still has a last sentence.
    sentences += ends + (/[.!?…][\s»”")\]]*$/.test(para.trim()) ? 0 : 1);
    for (const s of para.split(/[.!?…]+(?=[\s»”")\]]|$)/)) {
      const n = s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
      if (n > 0) lengths.push(n);
    }
  }
  return { tokens, sentences, lengths };
}

/**
 * Gulpease index (Lucisano and Piemontese, 1988), the readability measure calibrated for
 * Italian: 89 + (300 × sentences − 10 × letters) / words. Digits count as letters.
 */
export function gulpease(body: string): Readability {
  const { tokens, sentences } = textStats(body);
  const words = tokens.length;
  if (words < MIN_WORDS) return { index: null, words, sentences };
  let letters = 0;
  for (const t of tokens) letters += (t.match(/[\p{L}\p{N}]/gu) ?? []).length;
  const raw = 89 + (300 * sentences - 10 * letters) / words;
  return { index: Math.round(Math.min(100, Math.max(0, raw))), words, sentences };
}

/**
 * Flesch Reading Ease and its adaptations: base − perSentence × words/sentences − perSyllable ×
 * syllables/words. For English 206.835 − 1.015 × … − 84.6 × ….
 */
export function flesch(
  body: string,
  c: Extract<ReadabilityConfig, { formula: "flesch" }>,
): Readability {
  const { tokens, sentences } = textStats(body);
  const words = tokens.length;
  if (words < MIN_WORDS) return { index: null, words, sentences };
  let syl = 0;
  for (const t of tokens) syl += syllables(t, c.vowels, c.silentE ?? false);
  const raw = c.base - c.perSentence * (words / sentences) - c.perSyllable * (syl / words);
  return { index: Math.round(Math.min(100, Math.max(0, raw))), words, sentences };
}

/**
 * Syllables in a word, estimated as groups of vowels. With `silentE` a final "e" after a
 * consonant does not count ("make", not "table"), nor does the one in "-ed" and "-es" where it
 * is silent ("asked", "makes"; but "wanted", "boxes"). A digit or an acronym with no vowels: one.
 */
export function syllables(word: string, vowels: string, silentE: boolean): number {
  const w = word
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]/g, "");
  const isVowel = (ch: string | undefined) => ch !== undefined && vowels.includes(ch);
  let groups = 0;
  for (let i = 0; i < w.length; i++) if (isVowel(w[i]) && !isVowel(w[i - 1])) groups++;
  if (silentE && groups > 1) {
    const n = w.length;
    const before = (k: number) => w[n - k];
    if (w.endsWith("e") && !isVowel(before(2)) && !/[^aeiouy]le$/.test(w)) groups--;
    else if (w.endsWith("ed") && !isVowel(before(3)) && !/[td]ed$/.test(w)) groups--;
    else if (w.endsWith("es") && !isVowel(before(3)) && !/(s|x|z|ch|sh|g|c)es$/.test(w)) groups--;
  }
  return Math.max(1, groups);
}

/**
 * Without a formula for the language: average words per sentence and how many sentences are
 * long. It does not become a score, because a score's thresholds would need calibrating for
 * each language.
 */
export function sentenceLength(body: string): Readability {
  const { tokens, sentences, lengths } = textStats(body);
  const words = tokens.length;
  if (words < MIN_WORDS) return { index: null, words, sentences };
  return {
    index: null,
    words,
    sentences,
    averageSentence: Math.round((words / sentences) * 10) / 10,
    longSentences: lengths.filter((n) => n > LONG_SENTENCE).length,
  };
}

/** Readability with the language pack's formula. */
export function readability(body: string, config: ReadabilityConfig): Readability {
  switch (config.formula) {
    case "gulpease":
      return gulpease(body);
    case "flesch":
      return flesch(body, config);
    case "sentences":
      return sentenceLength(body);
  }
}

/** Level from the average sentence length: up to 20 words easy, over 25 hard. */
export function sentenceLengthLevel(average: number): ReadabilityLevel {
  return average <= 20 ? "easy" : average <= LONG_SENTENCE ? "medium" : "hard";
}

export type ReadabilityLevel = "easy" | "medium" | "hard";

/**
 * For an adult reader: Gulpease above 60 easy, below 40 hard; Flesch (and its adaptations)
 * above 60 easy, below 30 hard.
 */
export function readabilityLevel(
  index: number,
  formula: Exclude<ReadabilityConfig["formula"], "sentences"> = "gulpease",
): ReadabilityLevel {
  const [easy, hard] = formula === "gulpease" ? [60, 40] : [60, 30];
  return index >= easy ? "easy" : index >= hard ? "medium" : "hard";
}
