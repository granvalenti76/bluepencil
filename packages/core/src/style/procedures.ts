import type { LanguagePack } from "../languages/pack.ts";
import type { ChatMessage } from "../model/types.ts";
import { extractAllJson } from "../model/json.ts";
import { withoutNulls } from "../judgments/schema.ts";
import { measureText, type MeasureLanguage } from "./measures.ts";
import {
  mergeTraits,
  PROCEDURE_PARTS,
  type Procedure,
  type ProcedurePart,
  type Style,
  type StyleTrait,
} from "./style.ts";

/**
 * Reading a style for its procedures. The model reads the pieces whole, once, with every sentence
 * numbered, and names the moves that come back (how a piece opens, how a paragraph closes, how
 * people are shown, how time is told…), each with the sentences where it happens. A procedure
 * with no sentence that can be found in the pieces is not proposed. The file keeps the sentences
 * themselves, not their numbers, so a piece added or changed later does not shift them; one that
 * is no longer in the pieces is simply not shown.
 */

/** The answer's names for each part: the contract (Italian), then English and near words. */
const PART_WORDS: Record<ProcedurePart, string[]> = {
  opening: ["attacco", "apertura", "inizio", "opening", "start", "beginning"],
  paragraph: ["paragrafo", "paragrafi", "paragraph", "paragraphs"],
  sentence: ["frase", "frasi", "sentence", "sentences", "sintassi", "syntax"],
  links: ["passaggi", "passaggio", "legami", "connettivi", "links", "transitions", "connectives"],
  people: ["persone", "personaggi", "people", "characters"],
  images: ["immagini", "immagine", "dettagli", "images", "imagery", "details"],
  words: ["lessico", "parole", "vocabolario", "words", "vocabulary", "lexicon"],
  time: ["tempo", "tempi", "time", "tense", "tenses"],
  voice: ["voce", "punto di vista", "voice", "point of view"],
  ending: ["finale", "chiusura", "fine", "ending", "close", "closing"],
};

/** A sentence of the pieces, numbered from 1 across all of them. */
export interface PieceSentence {
  n: number;
  /** The piece, from 0, and the paragraph inside it, from 0. */
  piece: number;
  para: number;
  text: string;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
/** How a sentence is looked for: no spacing, quotes or case differences. */
const key = (s: string) =>
  oneLine(s)
    .toLowerCase()
    .replace(/[«»“”"’']/g, "")
    .replace(/[.!?…]+$/, "");

/** Every sentence of the pieces, numbered, by piece and paragraph. */
export function pieceSentences(
  style: Pick<Style, "pieces">,
  lang: MeasureLanguage = {},
): PieceSentence[] {
  const out: PieceSentence[] = [];
  style.pieces.forEach((p, piece) => {
    const m = measureText(p.text, lang);
    for (const s of m.sentences) {
      out.push({
        n: out.length + 1,
        piece,
        para: s.para,
        text: oneLine(p.text.slice(s.from, s.to)),
      });
    }
  });
  return out;
}

/** A passage of a procedure found in the pieces, with the sentences around it. */
export interface LocatedPassage {
  piece: number;
  pieceTitle: string;
  /** The paragraph inside the piece, from 1. */
  para: number;
  before: string;
  passage: string;
  after: string;
}

/**
 * Where a procedure happens: each passage found in the pieces, with the sentence before and after
 * it in the same paragraph. A passage no longer in the pieces is left out.
 */
export function locatePassages(
  style: Pick<Style, "pieces">,
  procedure: Pick<Procedure, "passages">,
  sentences: PieceSentence[],
): LocatedPassage[] {
  const byKey = new Map<string, number>();
  sentences.forEach((s, i) => {
    if (!byKey.has(key(s.text))) byKey.set(key(s.text), i);
  });
  const seen = new Set<number>();
  return (procedure.passages ?? []).flatMap((p) => {
    const i = byKey.get(key(p));
    if (i === undefined || seen.has(i)) return [];
    seen.add(i);
    const s = sentences[i]!;
    const near = (j: number) => {
      const o = sentences[j];
      return o && o.piece === s.piece && o.para === s.para ? o.text : "";
    };
    return [
      {
        piece: s.piece,
        pieceTitle: style.pieces[s.piece]?.title || `Piece ${s.piece + 1}`,
        para: s.para + 1,
        before: near(i - 1),
        passage: s.text,
        after: near(i + 1),
      },
    ];
  });
}

/** The pieces as the model reads them: every sentence with its number, paragraph by paragraph. */
export function renderPieces(
  style: Pick<Style, "name" | "author" | "source" | "pieces">,
  sentences: PieceSentence[],
) {
  const out = [`STYLE: ${style.name}`];
  if (style.author) out.push(`Author: ${style.author}`);
  if (style.source) out.push(`Source: ${style.source}`);
  style.pieces.forEach((p, piece) => {
    out.push("", `PIECE ${piece + 1}${p.title ? ` — ${p.title}` : ""}`);
    const mine = sentences.filter((s) => s.piece === piece);
    const paras = [...new Set(mine.map((s) => s.para))];
    for (const para of paras) {
      out.push(
        `¶${para + 1} ${mine
          .filter((s) => s.para === para)
          .map((s) => `[${s.n}] ${s.text}`)
          .join(" ")}`,
      );
    }
  });
  return out.join("\n");
}

/** Reading a style for its procedures. `null` if the pack has no prompt for it. */
export function styleProceduresMessages(
  pack: LanguagePack,
  style: Style,
  sentences: PieceSentence[] = pieceSentences(style, pack),
): ChatMessage[] | null {
  const prompt = pack.prompts["style-procedures"];
  if (!prompt) return null;
  return [
    { role: "system", content: prompt },
    { role: "user", content: renderPieces(style, sentences) },
  ];
}

/** At most this many procedures from one reading. */
const MAX_PROCEDURES = 8;
/** At most this many passages per procedure. */
const MAX_PASSAGES = 6;

/** What the model read in a style: the style in one sentence, and its procedures. */
export interface StyleRead {
  summary: string;
  procedures: Procedure[];
}

const text = (v: unknown) =>
  typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";

/** A part from the model's word for it; an unknown word gives none. */
export function partOf(word: unknown): ProcedurePart | undefined {
  const w = text(word).toLowerCase();
  if (!w) return undefined;
  return PROCEDURE_PARTS.find((p) => p === w || PART_WORDS[p].includes(w));
}

/** Sentence numbers in any form: 12, "12", "[12]", "12, 14". */
function numbersIn(v: unknown): number[] {
  const items = Array.isArray(v) ? v : [v];
  return items.flatMap((x) =>
    [...text(x).matchAll(/\d+/g)].map((m) => Number(m[0])).filter((n) => n > 0),
  );
}

/**
 * The model's reading of a style, read leniently: `sintesi` and `procedimenti` (`nome`, `parte`,
 * `descrizione`, `passi`: sentence numbers), or the English names. A procedure keeps only the
 * sentences that exist; with none, or with no name, it is dropped. `null` only when nothing at
 * all can be read (then the caller asks once more).
 */
export function readProceduresAnswer(
  content: string,
  sentences: PieceSentence[],
): StyleRead | null {
  for (const v of extractAllJson(content)) {
    const o = withoutNulls(v);
    const rec = (Array.isArray(o) ? { procedimenti: o } : o) as Record<string, unknown> | null;
    if (!rec || typeof rec !== "object") continue;
    const summary = text(rec.sintesi ?? rec.summary);
    const items = rec.procedimenti ?? rec.procedures;
    const procedures: Procedure[] = [];
    const names = new Set<string>();
    if (Array.isArray(items)) {
      for (const item of items) {
        if (!item || typeof item !== "object" || procedures.length >= MAX_PROCEDURES) continue;
        const i = item as Record<string, unknown>;
        const name = text(i.nome ?? i.name);
        if (!name || names.has(name.toLowerCase())) continue;
        const passages = [
          ...new Set(
            numbersIn(i.passi ?? i.passages ?? i.frasi ?? i.sentences)
              .map((n) => sentences[n - 1]?.text)
              .filter((t): t is string => !!t),
          ),
        ].slice(0, MAX_PASSAGES);
        if (!passages.length) continue;
        const part = partOf(i.parte ?? i.part);
        const description = text(i.descrizione ?? i.description ?? i.testo ?? i.text);
        names.add(name.toLowerCase());
        procedures.push({
          name,
          ...(part ? { part } : {}),
          ...(description ? { text: description } : {}),
          passages,
        });
      }
    }
    if (summary || procedures.length) return { summary, procedures };
  }
  return null;
}

/**
 * The model read the style again: its procedures replace the proposed ones, while those the
 * author kept or set aside stay (one with the same name is not proposed again).
 */
export function mergeProcedures(previous: Procedure[], read: Procedure[]): Procedure[] {
  const kept = previous.filter((p) => p.state === "fixed" || p.state === "off");
  const known = new Set(kept.map((p) => p.name.trim().toLowerCase()));
  return [...kept, ...read.filter((p) => !known.has(p.name.trim().toLowerCase()))];
}

/**
 * A new reading into the style: the summary through the traits (kept and set-aside ones stay, and
 * the author's own), the procedures merged. The sentences on each dimension of the measures, from
 * before the procedures, go.
 */
export function mergeRead(
  previous: Pick<Style, "traits" | "procedures">,
  read: StyleRead,
): { traits: StyleTrait[]; procedures: Procedure[] } {
  return {
    traits: mergeTraits(
      previous.traits.filter((t) => !t.dim || t.dim === "summary"),
      read.summary ? [{ text: read.summary, dim: "summary" }] : [],
    ),
    procedures: mergeProcedures(previous.procedures, read.procedures),
  };
}
