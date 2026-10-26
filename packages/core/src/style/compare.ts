import {
  formatMeasure,
  STYLE_LONG_SENTENCE,
  measureText,
  STYLE_SHORT_SENTENCE,
  STYLE_DIMENSIONS,
  type MeasureDef,
  type MeasuredText,
  type MeasureLanguage,
  type StyleDimension,
} from "./measures.ts";
import { DRAFT_MIN_WORDS, type StyleSchema } from "./style.ts";

/**
 * A draft beside the style it looks at, by patterns and not by passages: each measure of the
 * draft on the style's range, and the cues, worded by the code from the numbers. A cue is either
 * a paragraph (a flat rhythm, a run of long sentences, a cluster of adverbs, connectives the style
 * never uses) or the whole draft (a measure out of the style's range). Nothing is quoted from the
 * style, and nothing here rewrites the draft.
 */
export interface ComparedMeasure {
  def: MeasureDef;
  value: number | null;
  lo: number;
  hi: number;
  all: number;
  /** Outside the style's range, and on which side (never under `DRAFT_MIN_WORDS`). */
  out: "low" | "high" | null;
}

export interface StyleCue {
  /** Stable while the text keeps the same pattern: for "not for this text". */
  id: string;
  dim: StyleDimension;
  /** The paragraphs, counted from 1; empty for the whole draft. */
  paragraphs: number[];
  text: string;
  /** Where the cue's number goes on the page (a paragraph's start), or `null`. */
  at: number | null;
  /** Words to underline on the page. */
  words: { from: number; to: number }[];
}

export interface StyleComparison {
  measured: MeasuredText;
  measures: ComparedMeasure[];
  cues: StyleCue[];
  /** Dimensions where the draft is within the style's ranges and has no cue. */
  inLine: StyleDimension[];
}

/** At most this many cues: the paragraphs first, then the measures furthest out. */
const MAX_CUES = 8;
/** Under this many words, the style cannot say it "never" uses a word. */
const NEVER_MIN_WORDS = 300;

const quoted = (w: string) => `“${w}”`;
/** A range as text: "14–21", or one value when the two ends meet. */
const span = (d: MeasureDef, lo: number, hi: number) =>
  formatMeasure(d, lo) === formatMeasure(d, hi)
    ? formatMeasure(d, lo)
    : `${formatMeasure(d, lo)}–${formatMeasure(d, hi)}`;
const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function compareWithStyle(
  body: string,
  schema: StyleSchema,
  lang: MeasureLanguage = {},
): StyleComparison {
  const m = measureText(body, lang);
  const enough = m.words >= DRAFT_MIN_WORDS;
  const measures: ComparedMeasure[] = schema.defs.map((def) => {
    const { lo, hi, all } = schema.ranges[def.id]!;
    const value = m.measures[def.id] ?? null;
    const out = !enough || value === null ? null : value < lo ? "low" : value > hi ? "high" : null;
    return { def, value, lo, hi, all, out };
  });
  const range = (id: string) => schema.ranges[id];
  const valueOf = (id: string) => measures.find((x) => x.def.id === id);

  const local: StyleCue[] = [];
  const covered = new Set<string>();
  const paraStart = (p: number) => m.paragraphs[p]!.from;

  // Rhythm: a paragraph of four or more sentences of about the same length, none short, when the
  // style moves (it has short sentences, or lengths that vary).
  const short = range("shortSentences");
  const variety = range("sentenceVariety");
  const styleMoves = (short?.lo ?? 0) >= 10 || (variety?.lo ?? 0) >= 35;
  const flat = new Set<number>();
  if (styleMoves) {
    m.paragraphs.forEach((p, i) => {
      const lens = m.sentences.slice(p.first, p.first + p.sentences).map((s) => s.words);
      if (lens.length < 4) return;
      const min = Math.min(...lens);
      const max = Math.max(...lens);
      const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
      if (min <= STYLE_SHORT_SENTENCE || max - min > Math.max(3, Math.round(mean * 0.25))) return;
      flat.add(i);
      const afterLong = range("shortAfterLong");
      local.push({
        id: `flat:${i}`,
        dim: "rhythm",
        paragraphs: [i + 1],
        text:
          `Flat rhythm: ${lens.length} sentences in a row ${min === max ? `of ${min} words` : `between ${min} and ${max} words`}, none short.` +
          (afterLong && afterLong.all > 0
            ? Math.round(afterLong.all / 10) === 10
              ? " In the style a long sentence is always followed by a short one."
              : ` In the style a long sentence is followed by a short one ${Math.round(afterLong.all / 10)} times in 10.`
            : short
              ? ` In the style ${short.all}% of the sentences are short.`
              : ""),
        at: paraStart(i),
        words: [],
      });
      covered.add("sentenceVariety").add("shortAfterLong");
    });
  }

  // Rhythm: three or more long sentences in a row, when the style has short ones.
  if (short && short.all >= 10) {
    let run: number[] = [];
    const close = () => {
      const paras = [...new Set(run.map((k) => m.sentences[k]!.para))];
      if (run.length >= 3 && !paras.every((p) => flat.has(p))) {
        const lens = run.map((k) => m.sentences[k]!.words);
        local.push({
          id: `long:${run[0]}`,
          dim: "rhythm",
          paragraphs: paras.map((p) => p + 1),
          text: `${run.length} long sentences in a row (${Math.min(...lens)}–${Math.max(...lens)} words) with no short one between them. In the style about one sentence in ${Math.max(2, Math.round(100 / short.all))} is short.`,
          at: m.sentences[run[0]!]!.from,
          words: [],
        });
        covered.add("shortSentences");
      }
      run = [];
    };
    m.sentences.forEach((s, k) => {
      if (s.words > STYLE_LONG_SENTENCE) run.push(k);
      else close();
    });
    close();
  }

  // Vocabulary: a paragraph with a cluster of adverbs, when the draft uses more than the style.
  const adverbs = valueOf("adverbs");
  if (adverbs && adverbs.out === "high" && lang.style?.adverbs) {
    const suffix = lang.style.adverbs.suffix;
    const byPara = groupBy(m.adverbs, (a) => a.para);
    for (const [p, hits] of byPara) {
      const sentences = new Set(
        hits.map((h) => m.sentences.findIndex((s) => s.from <= h.from && h.to <= s.to)),
      ).size;
      if (hits.length < 3) continue;
      local.push({
        id: `adverbs:${p}`,
        dim: "lexicon",
        paragraphs: [p + 1],
        text: `${hits.length} adverbs in -${suffix} in ${plural(sentences, "sentence", "sentences")}. ${adverbs.all < 0.5 ? "The style hardly uses any" : `The style uses about ${formatMeasure(adverbs.def, adverbs.all)} per 1,000 words`}; this draft ${formatMeasure(adverbs.def, adverbs.value!)}.`,
        at: paraStart(p),
        words: hits.map(({ from, to }) => ({ from, to })),
      });
      covered.add("adverbs");
    }
  }

  // Vocabulary: connectives the style never uses.
  if (schema.words >= NEVER_MIN_WORDS && lang.style?.connectives) {
    const styleUses = new Set(schema.connectives.map((c) => c.word));
    const foreign = m.connectives.filter((c) => !styleUses.has(c.word));
    if (foreign.length) {
      const byWord = [...groupBy(foreign, (c) => c.word)];
      const paras = [...new Set(foreign.map((c) => c.para))].sort((a, b) => a - b);
      const top = schema.connectives.slice(0, 3).map((c) => quoted(c.word));
      local.push({
        id: `connectives:${byWord.map(([w]) => w).join(",")}`,
        dim: "lexicon",
        paragraphs: paras.map((p) => p + 1),
        text:
          `${byWord.map(([w, hits]) => `${quoted(w)} ${times(hits.length)}`).join(", ")}: the style never uses ${byWord.length === 1 ? "it" : "them"}` +
          (top.length ? `; it links with ${top.join(", ")}.` : "."),
        at: paraStart(paras[0]!),
        words: foreign.map(({ from, to }) => ({ from, to })),
      });
    }
  }

  local.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));

  // The whole draft: the measures out of range that no paragraph cue already speaks of, the
  // furthest out first.
  const distance = (x: ComparedMeasure) => {
    const width = x.hi - x.lo || Math.abs(x.hi) || 1;
    return x.out === "high" ? (x.value! - x.hi) / width : (x.lo - x.value!) / width;
  };
  const global: StyleCue[] = measures
    .filter((x) => x.out && !covered.has(x.def.id))
    .sort((a, b) => distance(b) - distance(a))
    .map((x) => ({
      id: `measure:${x.def.id}:${x.out}`,
      dim: x.def.dim,
      paragraphs: [],
      text: `${x.def.label}: ${formatMeasure(x.def, x.value!)} in this draft; in the style ${span(x.def, x.lo, x.hi)}.`,
      at: null,
      words: [],
    }));

  const cues = [...local, ...global].slice(0, MAX_CUES);
  const inLine = enough
    ? STYLE_DIMENSIONS.filter(
        (dim) =>
          measures.some((x) => x.def.dim === dim && x.value !== null) &&
          !measures.some((x) => x.def.dim === dim && x.out) &&
          !cues.some((c) => c.dim === dim),
      )
    : [];
  return { measured: m, measures, cues, inLine };
}

function groupBy<T, K>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const i of items) out.set(key(i), [...(out.get(key(i)) ?? []), i]);
  return out;
}
