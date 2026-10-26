import { z } from "zod";
import { parseDraft } from "../document/frontmatter.ts";
import { countWords } from "../document/wordcount.ts";
import {
  measureDefs,
  measureText,
  STYLE_DIMENSIONS,
  STYLE_SHORT_SENTENCE,
  type MeasureDef,
  type MeasureLanguage,
} from "./measures.ts";

/**
 * Styles: references the author builds in the editor from pieces of books, articles or their own
 * texts, and looks at while writing a draft. A style is a Markdown file in `Styles/` inside the
 * drafts folder: labels in the front matter (name in `title`, `author`, `source`, `lang`, `tags`),
 * one piece per `##` section (the heading says where it comes from), its summary and its
 * procedures. What the style does is read by the model in the pieces, whole: its procedures, each
 * with the sentences where it happens; the author keeps or sets aside each one. The measures
 * (rhythm, vocabulary, construction, voice) are the code's, and stand beside them as evidence. A
 * draft looks at one style (`reference:` in its front matter). Bluepencil never rewrites in a
 * style: it says, paragraph by paragraph, which procedure of the style is at stake and how the
 * draft stands beside it, and the author decides.
 */
export const STYLES_DIR = "Styles";
export const isStylePath = (path: string) => path.startsWith(`${STYLES_DIR}/`);

/**
 * `active`: proposed by the model, replaced when it reads the style again; `fixed`: kept by the
 * author; `off`: set aside, not proposed again.
 */
export const TRAIT_STATES = ["active", "fixed", "off"] as const;
export type TraitState = (typeof TRAIT_STATES)[number];

/** What a trait describes: the whole style, or one dimension of its schema. */
export const TRAIT_DIMS = ["summary", ...STYLE_DIMENSIONS] as const;
export type TraitDim = (typeof TRAIT_DIMS)[number];

export const StyleTraitSchema = z.object({
  text: z.string().min(1),
  dim: z.enum(TRAIT_DIMS).optional(),
  /** A short passage of the style that shows the trait (traits read before the schema). */
  quote: z.string().optional(),
  state: z.enum(TRAIT_STATES).optional(),
});
export type StyleTrait = z.infer<typeof StyleTraitSchema>;

/** Where in a piece a procedure works. */
export const PROCEDURE_PARTS = [
  "opening",
  "paragraph",
  "sentence",
  "links",
  "people",
  "images",
  "words",
  "time",
  "voice",
  "ending",
] as const;
export type ProcedurePart = (typeof PROCEDURE_PARTS)[number];

export const PART_LABEL: Record<ProcedurePart, string> = {
  opening: "Opening",
  paragraph: "Paragraph",
  sentence: "Sentence",
  links: "Links",
  people: "People",
  images: "Images",
  words: "Words",
  time: "Time",
  voice: "Voice",
  ending: "Ending",
};

/** A procedure of the style: a move that comes back in its pieces. */
export const ProcedureSchema = z.object({
  /** What it does, in a few words: "Opens on a thing, not on a theme". */
  name: z.string().min(1),
  part: z.enum(PROCEDURE_PARTS).optional(),
  /** How it works, in one or two sentences. */
  text: z.string().optional(),
  /** Sentences of the pieces where it happens. */
  passages: z.array(z.string()).optional(),
  state: z.enum(TRAIT_STATES).optional(),
});
export type Procedure = z.infer<typeof ProcedureSchema>;

/** The procedures that count: all but those set aside. */
export const activeProcedures = (s: Pick<Style, "procedures">): Procedure[] =>
  s.procedures.filter((p) => p.state !== "off");

/** Procedures as they go in the front matter: no empty fields, `active` left out. */
export const proceduresForFile = (procedures: Procedure[]) =>
  procedures.map((p) => ({
    name: p.name,
    ...(p.part ? { part: p.part } : {}),
    ...(p.text ? { text: p.text } : {}),
    ...(p.passages?.length ? { passages: p.passages } : {}),
    ...(p.state && p.state !== "active" ? { state: p.state } : {}),
  }));

export interface StylePiece {
  /** The `##` heading: where the piece comes from. */
  title: string;
  text: string;
  words: number;
}

export interface Style {
  name: string;
  author: string;
  source: string;
  lang?: string;
  tags: string[];
  traits: StyleTrait[];
  procedures: Procedure[];
  pieces: StylePiece[];
  words: number;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Reads a style file. Text before the first `##` (other than the `#` title) is a piece too. */
export function readStyle(text: string): Style {
  const { data, body } = parseDraft(text);
  const raw = data as Record<string, unknown>;
  const pieces: StylePiece[] = [];
  let current: { title: string; lines: string[] } = { title: "", lines: [] };
  const close = () => {
    const t = current.lines
      .join("\n")
      .replace(/<!--[\s\S]*?-->/g, "")
      .trim();
    if (t) pieces.push({ title: current.title, text: t, words: countWords(t) });
  };
  for (const line of body.split("\n")) {
    const h2 = /^##[ \t]+(.+?)\s*#*\s*$/.exec(line);
    if (h2) {
      close();
      current = { title: h2[1]!, lines: [] };
    } else if (!/^#[ \t]/.test(line)) {
      current.lines.push(line);
    }
  }
  close();
  const traits = Array.isArray(raw.traits)
    ? raw.traits.flatMap((t) => {
        const p = StyleTraitSchema.safeParse(typeof t === "string" ? { text: t } : t);
        return p.success ? [p.data] : [];
      })
    : [];
  const procedures = Array.isArray(raw.procedures)
    ? raw.procedures.flatMap((p) => {
        const parsed = ProcedureSchema.safeParse(typeof p === "string" ? { name: p } : p);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
  const tags = Array.isArray(raw.tags)
    ? raw.tags.map(str).filter(Boolean)
    : str(raw.tags)
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
  return {
    name: str(data.title) || "Untitled style",
    author: str(raw.author),
    source: str(raw.source),
    ...(data.lang ? { lang: data.lang } : {}),
    tags,
    traits,
    procedures,
    pieces,
    words: pieces.reduce((a, p) => a + p.words, 0),
  };
}

/** The labels of a style, as the "New style" window and the label bar edit them. */
export interface StyleLabels {
  name: string;
  author?: string;
  source?: string;
  lang: string;
  tags?: string[];
}

/** A piece to add: the text and where it comes from (the `##` heading). */
export interface NewPiece {
  title?: string;
  text: string;
}

/** A heading on one line, never empty: where the piece comes from. */
const pieceHeading = (title: string | undefined, n: number) =>
  title
    ?.replace(/\s+/g, " ")
    .replace(/^#+\s*/, "")
    .trim() || `Piece ${n}`;

/**
 * The new style's file. Without pieces, an empty first heading and a comment on what to paste
 * there (for those who write the file by hand).
 */
export function newStyleText(labels: StyleLabels, pieces: NewPiece[] = []): string {
  const head = [
    "---",
    `title: ${JSON.stringify(labels.name)}`,
    `author: ${JSON.stringify(labels.author ?? "")}`,
    `source: ${JSON.stringify(labels.source ?? "")}`,
    `lang: ${labels.lang}`,
    `tags: ${JSON.stringify(labels.tags ?? [])}`,
    "---",
    `# ${labels.name}`,
    "",
  ];
  const filled = pieces.filter((p) => p.text.trim());
  const body = filled.length
    ? filled.flatMap((p, i) => [`## ${pieceHeading(p.title, i + 1)}`, "", p.text.trim(), ""])
    : [
        "## Piece 1",
        "",
        "<!-- Paste a passage of 300–800 words under each “##” heading, and write in the heading where it comes from. Three or four pieces are enough. -->",
        "",
      ];
  return [...head, ...body].join("\n");
}

/** Adds a piece at the end of a style file, under its own heading. */
export function appendPiece(text: string, piece: NewPiece): string {
  const n = readStyle(text).pieces.length + 1;
  return `${text.replace(/\s*$/, "")}\n\n## ${pieceHeading(piece.title, n)}\n\n${piece.text.trim()}\n`;
}

/**
 * The first sentence of the style, for its card in the library: where a procedure happens, a
 * trait's quote, or a piece's first sentence.
 */
export function styleQuote(style: Pick<Style, "traits" | "procedures" | "pieces">): string {
  const shown =
    activeProcedures(style).find((p) => p.passages?.length)?.passages?.[0] ??
    activeTraits(style).find((t) => t.quote)?.quote;
  if (shown) return shown;
  const first = style.pieces[0]?.text.replace(/\s+/g, " ") ?? "";
  return /^.{10,160}?[.!?…](?=\s|$)/.exec(first)?.[0] ?? first.slice(0, 120);
}

/** The model's one-sentence summary of the style, if the author has not set it aside. */
export const styleSummary = (style: Pick<Style, "traits">): string | undefined =>
  activeTraits(style).find((t) => t.dim === "summary")?.text;

/** The traits that guide the review: all but those set aside. */
export const activeTraits = (s: Pick<Style, "traits">): StyleTrait[] =>
  s.traits.filter((t) => t.state !== "off");

/**
 * The model read the style again: its sentences replace the proposed ones, while those the
 * author kept or set aside stay. A dimension with a kept sentence gets no new one; a sentence set
 * aside is not proposed again.
 */
export function mergeTraits(previous: StyleTrait[], read: StyleTrait[]): StyleTrait[] {
  const kept = previous.filter((t) => t.state === "fixed" || t.state === "off");
  const known = new Set(kept.map((t) => t.text.trim().toLowerCase()));
  const settled = new Set(kept.filter((t) => t.state === "fixed" && t.dim).map((t) => t.dim));
  return [
    ...kept,
    ...read
      .filter((t) => !known.has(t.text.trim().toLowerCase()) && !(t.dim && settled.has(t.dim)))
      .map((t) => ({
        text: t.text,
        ...(t.dim ? { dim: t.dim } : {}),
        ...(t.quote ? { quote: t.quote } : {}),
      })),
  ];
}

/** Traits as they go in the front matter: no empty fields, `active` left out (the default). */
export const traitsForFile = (traits: StyleTrait[]) =>
  traits.map((t) => ({
    text: t.text,
    ...(t.dim ? { dim: t.dim } : {}),
    ...(t.quote ? { quote: t.quote } : {}),
    ...(t.state && t.state !== "active" ? { state: t.state } : {}),
  }));

/** Under this many words a style's measures are provisional. */
export const STYLE_MIN_WORDS = 800;
/** Under this many words a draft's measures say little: shown, but none is out of range. */
export const DRAFT_MIN_WORDS = 150;
/** Above this many words a style takes long to measure and to read. */
export const STYLE_MAX_WORDS = 5000;

/** The size of the windows a style is measured in: about a long paragraph. */
const WINDOW_WORDS = 150;
/** How many sentences of the style its rhythm bars show. */
const RHYTHM_BARS = 60;

/** A measure of the style: the middle half of its windows, and the value on all its pieces. */
export interface StyleRange {
  lo: number;
  hi: number;
  all: number;
}

/** The schema of a style: what the code reads in its pieces. */
export interface StyleSchema {
  words: number;
  sentences: number;
  /** The measures the style has a range for, in order. */
  defs: MeasureDef[];
  ranges: Record<string, StyleRange>;
  /** The lengths of the first sentences, in order: the rhythm bars. */
  rhythm: number[];
  /** Paragraphs of two sentences or more that close on a short one, in percent. */
  lastShort: number;
  /** Content words that come back, the most frequent first. */
  recurring: { word: string; n: number }[];
  /** Every connective the pieces use, the most frequent first. */
  connectives: { word: string; n: number }[];
  /** Connectives of the language the pieces never use (the most common ones). */
  unused: string[];
  /** How the sentences open, in percent (with the language's openers). */
  openers?: { subject: number; setting: number; conjunction: number; other: number };
}

/** The pieces cut into windows of about 150 words, whole paragraphs. */
function windowsOf(style: Pick<Style, "pieces">): string[] {
  const windows: string[] = [];
  for (const piece of style.pieces) {
    let acc: string[] = [];
    let n = 0;
    for (const para of piece.text.split(/\n[ \t]*\n/)) {
      acc.push(para);
      n += countWords(para);
      if (n >= WINDOW_WORDS) {
        windows.push(acc.join("\n\n"));
        acc = [];
        n = 0;
      }
    }
    // A short tail joins the window before it, if the piece has one.
    if (acc.length) {
      if (n < WINDOW_WORDS / 2 && windows.length)
        windows[windows.length - 1] += `\n\n${acc.join("\n\n")}`;
      else windows.push(acc.join("\n\n"));
    }
  }
  return windows;
}

/**
 * The schema of a style. Each measure has a range: the pieces are cut into windows of about 150
 * words, each window is measured, and the range goes from the first to the third quartile (more
 * pieces make it more precise, not wider); `all` is the measure on all the pieces together. The
 * rhythm, the recurring words and the connectives come from all the pieces.
 */
export function styleSchema(style: Pick<Style, "pieces">, lang: MeasureLanguage = {}): StyleSchema {
  const whole = measureText(style.pieces.map((p) => p.text).join("\n\n"), lang);
  const measured = windowsOf(style).map((w) => measureText(w, lang).measures);
  const ranges: Record<string, StyleRange> = {};
  const defs = measureDefs(lang.style).filter((d) => {
    const values = measured
      .map((m) => m[d.id])
      .filter((v): v is number => v !== null && v !== undefined)
      .sort((a, b) => a - b);
    const all = whole.measures[d.id];
    if (!values.length || all === null || all === undefined) return false;
    ranges[d.id] =
      values.length < 4
        ? { lo: values[0]!, hi: values[values.length - 1]!, all }
        : { lo: quantile(values, 0.25), hi: quantile(values, 0.75), all };
    return true;
  });
  const byCount = (m: Map<string, number> | Record<string, number>) =>
    [...(m instanceof Map ? m : Object.entries(m))]
      .map(([word, n]) => ({ word, n }))
      .sort((a, b) => b.n - a.n || a.word.localeCompare(b.word));
  const used = new Map<string, number>();
  for (const c of whole.connectives) used.set(c.word, (used.get(c.word) ?? 0) + 1);
  const n = whole.sentences.length;
  const opened = (k: string) =>
    n ? Math.round((whole.sentences.filter((s) => s.opens === k).length * 100) / n) : 0;
  const closing = whole.paragraphs.filter((p) => p.sentences >= 2);
  const closedShort = closing.filter(
    (p) => whole.sentences[p.first + p.sentences - 1]!.words <= STYLE_SHORT_SENTENCE,
  ).length;
  return {
    words: whole.words,
    sentences: n,
    defs,
    ranges,
    rhythm: whole.sentences.slice(0, RHYTHM_BARS).map((s) => s.words),
    lastShort: closing.length ? Math.round((closedShort * 100) / closing.length) : 0,
    recurring: byCount(whole.vocabulary)
      .filter((w) => w.n >= 3)
      .slice(0, 8),
    connectives: byCount(used),
    unused: (lang.style?.connectives ?? [])
      .map((c) => c.toLowerCase())
      .filter((c) => !used.has(c))
      .slice(0, 5),
    ...(lang.style?.openers
      ? {
          openers: {
            subject: opened("subject"),
            setting: opened("setting"),
            conjunction: opened("conjunction"),
            other: opened("other"),
          },
        }
      : {}),
  };
}

function quantile(sorted: number[], q: number): number {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return Math.round((sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo)) * 10) / 10;
}
