import { z } from "zod";
import { parseDraft } from "../document/frontmatter.ts";
import { countWords } from "../document/wordcount.ts";
import type { LanguagePack } from "../languages/pack.ts";
import type { ChatMessage } from "../model/types.ts";
import { extractAllJson } from "../model/json.ts";
import { withoutNulls } from "../judgments/schema.ts";
import { measureText, STYLE_MEASURES, type StyleMeasure } from "./measures.ts";

/**
 * Styles: references the author builds in the editor from pieces of books, articles or their own
 * texts, and looks at while writing a draft. A style is a Markdown file in `Styles/` inside the
 * drafts folder: labels in the front matter (name in `title`, `author`, `source`, `lang`, `tags`),
 * one piece per `##` section (the heading says where it comes from), and the traits the model
 * read in it, which the author can fix, set aside or add to. A draft looks at one style
 * (`reference:` in its front matter). Bluepencil never rewrites in a style: it shows how the style
 * does things, and the author decides.
 */
export const STYLES_DIR = "Styles";
export const isStylePath = (path: string) => path.startsWith(`${STYLES_DIR}/`);

/** `fixed`: kept when the model reads the style again; `off`: no longer a reference. */
export const TRAIT_STATES = ["active", "fixed", "off"] as const;
export type TraitState = (typeof TRAIT_STATES)[number];

export const StyleTraitSchema = z.object({
  text: z.string().min(1),
  /** A short passage of the style that shows the trait. */
  quote: z.string().optional(),
  state: z.enum(TRAIT_STATES).optional(),
});
export type StyleTrait = z.infer<typeof StyleTraitSchema>;

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

/** The first sentence of the style, for its card in the library: a trait's quote, or a piece's. */
export function styleQuote(style: Pick<Style, "traits" | "pieces">): string {
  const fromTrait = activeTraits(style).find((t) => t.quote)?.quote;
  if (fromTrait) return fromTrait;
  const first = style.pieces[0]?.text.replace(/\s+/g, " ") ?? "";
  return /^.{10,160}?[.!?…](?=\s|$)/.exec(first)?.[0] ?? first.slice(0, 120);
}

/** The traits that guide the review and the cues: all but those set aside. */
export const activeTraits = (s: Pick<Style, "traits">): StyleTrait[] =>
  s.traits.filter((t) => t.state !== "off");

/**
 * The model read the style again: its traits replace the active ones, while the fixed ones and
 * the ones set aside stay (a trait the author set aside is not proposed again).
 */
export function mergeTraits(previous: StyleTrait[], read: StyleTrait[]): StyleTrait[] {
  const kept = previous.filter((t) => t.state === "fixed" || t.state === "off");
  const known = new Set(kept.map((t) => t.text.trim().toLowerCase()));
  return [
    ...kept,
    ...read
      .filter((t) => !known.has(t.text.trim().toLowerCase()))
      .map((t) => ({ text: t.text, ...(t.quote ? { quote: t.quote } : {}) })),
  ];
}

/** Traits as they go in the front matter: no empty fields, `active` left out (the default). */
export const traitsForFile = (traits: StyleTrait[]) =>
  traits.map((t) => ({
    text: t.text,
    ...(t.quote ? { quote: t.quote } : {}),
    ...(t.state && t.state !== "active" ? { state: t.state } : {}),
  }));

/** Under this many words a style's measures are provisional. */
export const STYLE_MIN_WORDS = 800;
/** Under this many words a draft's measures say little: shown, but none is out of range. */
export const DRAFT_MIN_WORDS = 150;
/** Above this many words a style may not fit a small context (about 7,000 tokens). */
export const STYLE_MAX_WORDS = 5000;

/** The size of the windows a style is measured in: about a long paragraph. */
const WINDOW_WORDS = 150;

export type StyleRanges = Record<StyleMeasure, { lo: number; hi: number }>;

/**
 * The range of each measure in the style: the pieces are cut into windows of about 150 words
 * (whole paragraphs), each window is measured, and the range goes from the first to the third
 * quartile. More pieces make it more precise, not wider.
 */
export function styleRanges(style: Pick<Style, "pieces">): StyleRanges {
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
  const measured = windows.map((w) => measureText(w).measures);
  const ranges = {} as StyleRanges;
  for (const id of STYLE_MEASURES) {
    const values = measured.map((m) => m[id]).sort((a, b) => a - b);
    ranges[id] = values.length
      ? values.length < 4
        ? { lo: values[0]!, hi: values[values.length - 1]! }
        : { lo: quantile(values, 0.25), hi: quantile(values, 0.75) }
      : { lo: 0, hi: 0 };
  }
  return ranges;
}

function quantile(sorted: number[], q: number): number {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return Math.round((sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo)) * 10) / 10;
}

/** The draft against the style: what Style mode shows. */
export interface StyleReading {
  words: number;
  measures: {
    id: StyleMeasure;
    value: number;
    lo: number;
    hi: number;
    /** Outside the style's range, and on which side. */
    out: "low" | "high" | null;
  }[];
}

export function readAgainst(body: string, ranges: StyleRanges): StyleReading {
  const m = measureText(body);
  const enough = m.words >= DRAFT_MIN_WORDS;
  return {
    words: m.words,
    measures: STYLE_MEASURES.map((id) => {
      const value = m.measures[id];
      const { lo, hi } = ranges[id];
      return {
        id,
        value,
        lo,
        hi,
        out: !enough ? null : value < lo ? "low" : value > hi ? "high" : null,
      };
    }),
  };
}

// The model: reading a style's traits, and finding cues in a draft. The fields are the contract
// with the reader and stay the same in every language; the instructions come from the pack.

/**
 * Reading the model's answers. Like the review's notes, every item is read on its own and a bad
 * one is dropped: the answer may be the expected object, a bare array, two blocks (traits, then
 * cues), or an object broken somewhere with a readable array inside. `null` only when nothing at
 * all can be read (then the caller asks once more).
 */
function answerItems(content: string, keys: string[]): Record<string, unknown>[] | null {
  const items: Record<string, unknown>[] = [];
  let recognised = false;
  const take = (v: unknown) => {
    const x = withoutNulls(v);
    if (Array.isArray(x)) {
      recognised = true;
      for (const i of x) take(i);
    } else if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      const lists = keys.filter((k) => k in o);
      if (lists.length) {
        recognised = true;
        for (const k of lists) take(o[k] ?? []);
      } else {
        items.push(o);
      }
    }
  };
  for (const v of extractAllJson(content)) take(v);
  return recognised || items.length ? items : null;
}

const text = (v: unknown) =>
  typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
/** "sì", "yes", true, 1: followed; anything else (also "partly") is not. */
const yes = (v: unknown) =>
  v === true || v === 1 || (typeof v === "string" && /^(s[iì]|yes|true|1)$/i.test(v.trim()));

/** The traits the model read in a style. */
export function readTraitsAnswer(content: string): StyleTrait[] | null {
  const items = answerItems(content, ["tratti", "traits"]);
  if (!items) return null;
  return items.flatMap((o) => {
    const t = text(o.tratto ?? o.trait ?? o.text);
    const q = text(o.esempio ?? o.example ?? o.quote);
    return t ? [{ text: t, ...(q ? { quote: q } : {}) }] : [];
  });
}

/**
 * The cues on a draft and the check of each trait (by its number in the request: one the model
 * skipped, or a number that does not exist, is not checked).
 */
export function readTipsAnswer(
  content: string,
  traits: StyleTrait[],
): { tips: StyleTip[]; checks: TraitCheck[] } | null {
  const items = answerItems(content, ["tratti", "spunti", "traits", "tips"]);
  if (!items) return null;
  const tips: StyleTip[] = [];
  const checks: TraitCheck[] = [];
  for (const o of items) {
    const quote = text(o.citazione ?? o.quote);
    const tip = text(o.spunto ?? o.tip);
    if (tip && quote) {
      const example = text(o.esempio ?? o.example);
      tips.push({ quote, tip, ...(example ? { example } : {}) });
      continue;
    }
    const n = Number(text(o.numero ?? o.number));
    const t = Number.isInteger(n) ? traits[n - 1] : undefined;
    if (!t || checks.some((c) => c.text === t.text)) continue;
    const followed = yes(o.seguito ?? o.followed);
    checks.push({ text: t.text, followed, ...(!followed && quote ? { quote } : {}) });
  }
  return { tips: tips.slice(0, 12), checks };
}

/** A cue: a passage of the draft, what the style would do there, a passage of the style. */
export interface StyleTip {
  quote: string;
  tip: string;
  example?: string;
}

/** A trait of the style, checked on the draft: followed, or where it is missing. */
export interface TraitCheck {
  text: string;
  followed: boolean;
  quote?: string;
}

function renderStyle(style: Style, withTraits: boolean): string {
  const out = [`STYLE: ${style.name}`];
  if (style.author) out.push(`Author: ${style.author}`);
  if (style.source) out.push(`Source: ${style.source}`);
  if (withTraits) {
    const traits = activeTraits(style);
    if (traits.length) out.push("", "TRAITS:", ...traits.map((t, i) => `${i + 1}. ${t.text}`));
  }
  for (const [i, p] of style.pieces.entries()) {
    out.push("", `<<< ${i + 1}${p.title ? ` · ${p.title}` : ""}`, p.text, ">>>");
  }
  return out.join("\n");
}

/** Reading the traits of a style. `null` if the pack has no style prompts. */
export function styleTraitsMessages(pack: LanguagePack, style: Style): ChatMessage[] | null {
  const prompt = pack.prompts["style-traits"];
  if (!prompt) return null;
  return [
    { role: "system", content: prompt },
    { role: "user", content: renderStyle(style, false) },
  ];
}

/**
 * Cues for a draft. The style goes in the system message, the same for every draft that looks at
 * it: llama-server keeps it in its cache from one request to the next.
 */
export function styleTipsMessages(
  pack: LanguagePack,
  style: Style,
  draft: string,
): ChatMessage[] | null {
  const prompt = pack.prompts["style-tips"];
  if (!prompt) return null;
  return [
    { role: "system", content: `${prompt}\n\n${renderStyle(style, true)}` },
    { role: "user", content: `${pack.labels.review.text}\n<<<\n${draft}\n>>>` },
  ];
}
