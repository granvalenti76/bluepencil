import { z } from "zod";
import { stripMarkdown } from "../document/wordcount.ts";

/**
 * The schema of a piece of writing, measured without the model, in four dimensions: rhythm (how
 * long the sentences are and how they alternate), vocabulary (long words, variety, adverbs,
 * figures), construction (punctuation, how sentences open, subordinate clauses, asides) and voice
 * (first person, questions, dialogue, tenses). The same measures for a style's pieces and for the
 * draft. The measures that need words of the language (adverbs, connectives, openers, tenses) come
 * from the language pack's `style` block; without it they are left out.
 */
export const STYLE_DIMENSIONS = ["rhythm", "lexicon", "construction", "voice"] as const;
export type StyleDimension = (typeof STYLE_DIMENSIONS)[number];

export const DIMENSION_LABEL: Record<StyleDimension, string> = {
  rhythm: "Rhythm",
  lexicon: "Vocabulary",
  construction: "Construction",
  voice: "Voice",
};

const words = z.array(z.string().min(1));

/** The words of a language the measures need (`style` in `language.json`). All optional. */
export const StyleLexiconSchema = z.strictObject({
  /** Adverbs by their ending ("mente", "ly"), with the words that only look like one. */
  adverbs: z.strictObject({ suffix: z.string().min(1), except: words.optional() }).optional(),
  /** Words that link sentences ("ma", "poi", "inoltre"), the most common first. */
  connectives: words.optional(),
  /** Words that open a subordinate clause ("che", "quando", "perché"). */
  subordinators: words.optional(),
  /** Words that say "I" or "we". */
  firstPerson: words.optional(),
  /**
   * How a sentence opens, by its first word: a conjunction, a time or place (a preposition or an
   * adverb of time), the subject (an article or a pronoun). Checked in this order.
   */
  openers: z.strictObject({ conjunction: words, setting: words, subject: words }).optional(),
  /** Up to three tenses, by their endings ("imperfetto": "ava", "evano"…), with exceptions. */
  tenses: z
    .array(z.strictObject({ label: z.string().min(1), endings: words, except: words.optional() }))
    .max(3)
    .optional(),
});
export type StyleLexicon = z.infer<typeof StyleLexiconSchema>;

/** What the measures need from a language pack. */
export interface MeasureLanguage {
  style?: StyleLexicon;
  stopWords?: string[];
  commonWords?: string[];
}

export interface MeasureDef {
  id: string;
  dim: StyleDimension;
  label: string;
  unit: "" | "%";
  decimals: 0 | 1;
}

const def = (
  id: string,
  dim: StyleDimension,
  label: string,
  unit: "" | "%" = "",
  decimals: 0 | 1 = 1,
): MeasureDef => ({ id, dim, label, unit, decimals });

/** A sentence of this many words or fewer is short; one of more than `LONG` is long. */
export const STYLE_SHORT_SENTENCE = 8;
export const STYLE_LONG_SENTENCE = 20;
/** A long word: this many letters or more. */
const LONG_WORD = 10;

/** The measures, in the order they are shown; those the language cannot give are left out. */
export function measureDefs(lex?: StyleLexicon): MeasureDef[] {
  return [
    def("sentenceLength", "rhythm", "Words per sentence"),
    def("sentenceVariety", "rhythm", "Variety of sentence lengths", "%", 0),
    def(
      "shortSentences",
      "rhythm",
      `Short sentences (${STYLE_SHORT_SENTENCE} words or fewer)`,
      "%",
      0,
    ),
    def("shortAfterLong", "rhythm", "Long sentences followed by a short one", "%", 0),
    def("paragraphLength", "rhythm", "Sentences per paragraph"),
    def("longWords", "lexicon", `Long words (${LONG_WORD}+ letters)`, "%", 0),
    def("wordVariety", "lexicon", "Different words in every 100", "", 0),
    ...(lex?.adverbs
      ? [def("adverbs", "lexicon", `Adverbs in -${lex.adverbs.suffix} per 1,000 words`)]
      : []),
    def("numbers", "lexicon", "Figures per 1,000 words"),
    def("commas", "construction", "Commas per sentence"),
    def("semicolons", "construction", "Semicolons and colons per 1,000 words"),
    ...(lex?.subordinators
      ? [def("subordinates", "construction", "Subordinate clauses per sentence")]
      : []),
    ...(lex?.openers
      ? [
          def("openSubject", "construction", "Sentences opening on the subject", "%", 0),
          def("openSetting", "construction", "Sentences opening on a time or place", "%", 0),
          def("openConjunction", "construction", "Sentences opening on a conjunction", "%", 0),
        ]
      : []),
    def("asides", "construction", "Asides per 1,000 words"),
    def("lists", "construction", "List items per 1,000 words"),
    ...(lex?.firstPerson
      ? [def("firstPerson", "voice", "Sentences in the first person", "%", 0)]
      : []),
    def("questions", "voice", "Questions per 1,000 words"),
    def("exclamations", "voice", "Exclamations per 1,000 words"),
    def("dialogue", "voice", "Paragraphs of dialogue", "%", 0),
    ...(lex?.tenses ?? []).map((t, i) => def(`tense${i}`, "voice", `${t.label} per 1,000 words`)),
  ];
}

/** A measure as text: "12.8", "48%". */
export const formatMeasure = (d: Pick<MeasureDef, "unit" | "decimals">, v: number) =>
  `${d.decimals ? (Math.round(v * 10) / 10).toString() : Math.round(v).toString()}${d.unit}`;

export type Opener = "conjunction" | "setting" | "subject" | "other";

/** A sentence of the body, with its offsets (body positions) and its paragraph. */
export interface MeasuredSentence {
  from: number;
  to: number;
  words: number;
  para: number;
  /** How it opens: only with the language's openers. */
  opens?: Opener;
}

/** A paragraph of prose, with its offsets, its word count and its first sentence. */
export interface MeasuredParagraph {
  from: number;
  to: number;
  words: number;
  first: number;
  sentences: number;
  dialogue: boolean;
}

/** A word found in the text (an adverb, a connective), lowercase, with its place. */
export interface WordHit {
  word: string;
  from: number;
  to: number;
  para: number;
}

export interface MeasuredText {
  words: number;
  sentences: MeasuredSentence[];
  paragraphs: MeasuredParagraph[];
  /** Every measure of `measureDefs`; `null` when the text gives nothing to measure. */
  measures: Record<string, number | null>;
  adverbs: WordHit[];
  connectives: WordHit[];
  /** Content words (not stop words, four letters or more) and how often they come. */
  vocabulary: Record<string, number>;
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
const wordsIn = (s: string) => stripMarkdown(s).match(WORD)?.length ?? 0;

/** A sentence ends at . ! ? … followed by a space, a closing quote or bracket, or the end. */
const SENTENCE_END = /[.!?…]+[»”")\]]*(?=\s|$)/g;
/** A figure: digits, with decimal or thousands separators. */
const NUMBER = /(?<![\p{L}\p{N}])\p{N}+(?:[.,]\p{N}+)*/gu;
/** A paragraph that opens with a dash or a quotation mark is a line of dialogue. */
const DIALOGUE = /^[ \t]*(?:[—–]|-[ \t]|[«“"])/;

/** Lines that are not prose: headings, footnote definitions, fences, comments, rules, tables. */
const NOT_PROSE = /^[ \t]{0,3}(?:#{1,6}[ \t]|\[\^[^\]]+\]:|```|~~~|<!--|\|)|^\s*([-*_][ \t]*){3,}$/;
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/;

/** The lexicon as sets, made once per pack. */
interface Lookup {
  adverb?: (w: string) => boolean;
  connectives: Set<string>;
  subordinators: Set<string>;
  firstPerson: Set<string>;
  openers?: { conjunction: Set<string>; setting: Set<string>; subject: Set<string> };
  tenses: ((w: string) => boolean)[];
  stop: Set<string>;
}
const lookups = new WeakMap<object, Lookup>();
const norm = (w: string) => w.toLowerCase().replace(/’/g, "'");
const set = (l?: string[]) => new Set((l ?? []).map(norm));
const NO_LANGUAGE: MeasureLanguage = {};

function lookupFor(lang: MeasureLanguage): Lookup {
  const cached = lookups.get(lang);
  if (cached) return cached;
  const lex = lang.style;
  const ending = (endings: string[], except?: string[]) => {
    const no = set(except);
    const ends = endings.map(norm);
    return (w: string) => !no.has(w) && ends.some((e) => w.length > e.length + 1 && w.endsWith(e));
  };
  const made: Lookup = {
    ...(lex?.adverbs ? { adverb: ending([lex.adverbs.suffix], lex.adverbs.except) } : {}),
    connectives: set(lex?.connectives),
    subordinators: set(lex?.subordinators),
    firstPerson: set(lex?.firstPerson),
    ...(lex?.openers
      ? {
          openers: {
            conjunction: set(lex.openers.conjunction),
            setting: set(lex.openers.setting),
            subject: set(lex.openers.subject),
          },
        }
      : {}),
    tenses: (lex?.tenses ?? []).map((t) => ending(t.endings, t.except)),
    // Not content words: the language's common and stop words, and every word of the lexicon.
    stop: set([
      ...(lang.stopWords ?? []),
      ...(lang.commonWords ?? []),
      ...(lex?.connectives ?? []),
      ...(lex?.subordinators ?? []),
      ...(lex?.firstPerson ?? []),
      ...(lex?.openers ? Object.values(lex.openers).flat() : []),
    ]),
  };
  lookups.set(lang, made);
  return made;
}

/** The words of a stretch, lowercase, with their offsets; "l’ho" is two words, "l'" and "ho". */
function tokens(text: string, offset: number): { w: string; from: number; to: number }[] {
  const out: { w: string; from: number; to: number }[] = [];
  for (const m of text.matchAll(WORD)) {
    const raw = m[0].replace(/['’-]+$/, "");
    const from = offset + m.index;
    const cut = raw.search(/['’]/);
    if (cut > 0 && cut < raw.length - 1) {
      out.push({ w: norm(raw.slice(0, cut + 1)), from, to: from + cut + 1 });
      out.push({ w: norm(raw.slice(cut + 1)), from: from + cut + 1, to: from + raw.length });
    } else {
      out.push({ w: norm(raw), from, to: from + raw.length });
    }
  }
  return out;
}

const letters = (w: string) => w.match(/\p{L}/gu)?.length ?? 0;

/** Measures a body (front matter already removed). */
export function measureText(body: string, lang: MeasureLanguage = NO_LANGUAGE): MeasuredText {
  const look = lookupFor(lang);
  const text = body.replace(/<!--[\s\S]*?-->/g, (c) => " ".repeat(c.length));
  const sentences: MeasuredSentence[] = [];
  const paragraphs: MeasuredParagraph[] = [];
  const adverbs: WordHit[] = [];
  const connectives: WordHit[] = [];
  const vocabulary: Record<string, number> = {};
  const allWords: string[] = [];
  let listItems = 0;
  let questions = 0;
  let exclamations = 0;
  let asides = 0;
  let numbers = 0;
  let commas = 0;
  let semicolons = 0;
  let subordinates = 0;
  let firstPerson = 0;
  let longWords = 0;
  let lettered = 0;
  const tenses = look.tenses.map(() => 0);
  const opens: Record<Opener, number> = { conjunction: 0, setting: 0, subject: 0, other: 0 };
  let fenced = false;

  // Paragraphs: runs of prose lines, with their offset in the body.
  let para: { from: number; text: string } | null = null;
  const closePara = () => {
    if (!para) return;
    const found = splitSentences(para.text, para.from);
    if (found.length) {
      const index = paragraphs.length;
      paragraphs.push({
        from: para.from,
        to: para.from + para.text.length,
        words: found.reduce((a, s) => a + s.words, 0),
        first: sentences.length,
        sentences: found.length,
        dialogue: DIALOGUE.test(para.text),
      });
      for (const s of found) {
        const own = text.slice(s.from, s.to);
        if (/\?[»”")\]]*$/.test(own)) questions++;
        if (/![»”")\]]*$/.test(own)) exclamations++;
        const toks = tokens(own, s.from);
        const sentence: MeasuredSentence = { ...s, para: index };
        if (look.openers) {
          const first = toks.find((t) => /\p{L}/u.test(t.w))?.w ?? "";
          sentence.opens = look.openers.conjunction.has(first)
            ? "conjunction"
            : look.openers.setting.has(first)
              ? "setting"
              : look.openers.subject.has(first)
                ? "subject"
                : "other";
          opens[sentence.opens]++;
        }
        sentences.push(sentence);
        let mine = false;
        for (const t of toks) {
          const n = letters(t.w);
          if (n === 0) continue;
          lettered++;
          allWords.push(t.w);
          if (n >= LONG_WORD) longWords++;
          if (n >= 4 && !look.stop.has(t.w)) vocabulary[t.w] = (vocabulary[t.w] ?? 0) + 1;
          if (look.adverb?.(t.w)) adverbs.push({ word: t.w, from: t.from, to: t.to, para: index });
          if (look.connectives.has(t.w)) {
            connectives.push({ word: t.w, from: t.from, to: t.to, para: index });
          }
          if (look.subordinators.has(t.w)) subordinates++;
          if (look.firstPerson.has(t.w)) mine = true;
          look.tenses.forEach((is, i) => {
            if (is(t.w)) tenses[i]!++;
          });
        }
        if (mine) firstPerson++;
      }
    }
    asides +=
      (para.text.match(/\(/g) ?? []).length + (para.text.match(/\s[—–]\s/g) ?? []).length / 2;
    const plain = stripMarkdown(para.text);
    numbers += (plain.match(NUMBER) ?? []).length;
    commas += (plain.match(/,(?!\d)/g) ?? []).length;
    semicolons += (plain.match(/[;:](?![\d/])/g) ?? []).length;
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

  const total = wordsIn(stripMarkdown(text));
  const lengths = sentences.map((s) => s.words);
  const n = lengths.length;
  const mean = n ? lengths.reduce((a, b) => a + b, 0) / n : 0;
  const sd = n ? Math.sqrt(lengths.reduce((a, x) => a + (x - mean) ** 2, 0) / n) : 0;
  const perThousand = (k: number) => (total ? round1((k * 1000) / total) : 0);
  const share = (k: number, of: number) => (of ? Math.round((k * 100) / of) : null);
  const perSentence = (k: number) => (n ? round1(k / n) : null);
  let long = 0;
  let longThenShort = 0;
  for (let i = 0; i < n - 1; i++) {
    if (lengths[i]! > STYLE_LONG_SENTENCE) {
      long++;
      if (lengths[i + 1]! <= STYLE_SHORT_SENTENCE) longThenShort++;
    }
  }

  const measures: Record<string, number | null> = {
    sentenceLength: n ? round1(mean) : null,
    // Coefficient of variation, in percent: how much the lengths move around the mean.
    sentenceVariety: mean ? Math.round((sd / mean) * 100) : null,
    shortSentences: share(lengths.filter((l) => l <= STYLE_SHORT_SENTENCE).length, n),
    shortAfterLong: share(longThenShort, long),
    paragraphLength: paragraphs.length ? round1(n / paragraphs.length) : null,
    longWords: share(longWords, lettered),
    wordVariety: variety(allWords),
    numbers: perThousand(numbers),
    commas: perSentence(commas),
    semicolons: perThousand(semicolons),
    asides: perThousand(asides),
    lists: perThousand(listItems),
    questions: perThousand(questions),
    exclamations: perThousand(exclamations),
    dialogue: share(paragraphs.filter((p) => p.dialogue).length, paragraphs.length),
  };
  if (look.adverb) measures.adverbs = perThousand(adverbs.length);
  if (look.subordinators.size) measures.subordinates = perSentence(subordinates);
  if (look.openers) {
    measures.openSubject = share(opens.subject, n);
    measures.openSetting = share(opens.setting, n);
    measures.openConjunction = share(opens.conjunction, n);
  }
  if (look.firstPerson.size) measures.firstPerson = share(firstPerson, n);
  tenses.forEach((k, i) => {
    measures[`tense${i}`] = perThousand(k);
  });
  return { words: total, sentences, paragraphs, measures, adverbs, connectives, vocabulary };
}

/**
 * Different words in every 100: the mean over windows of 100 words, so that a long text is not
 * poorer than a short one only because it is longer. `null` under 100 words.
 */
function variety(ws: string[]): number | null {
  const W = 100;
  if (ws.length < W) return null;
  const counts = new Map<string, number>();
  for (let i = 0; i < W; i++) counts.set(ws[i]!, (counts.get(ws[i]!) ?? 0) + 1);
  let sum = counts.size;
  let windows = 1;
  for (let i = W; i < ws.length; i++) {
    const out = ws[i - W]!;
    const c = counts.get(out)! - 1;
    if (c) counts.set(out, c);
    else counts.delete(out);
    counts.set(ws[i]!, (counts.get(ws[i]!) ?? 0) + 1);
    sum += counts.size;
    windows++;
  }
  return Math.round(sum / windows);
}

function splitSentences(para: string, offset: number) {
  const out: { from: number; to: number; words: number }[] = [];
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
