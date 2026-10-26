import type { LanguagePack } from "../languages/pack.ts";
import type { ChatMessage } from "../model/types.ts";
import { extractAllJson } from "../model/json.ts";
import { withoutNulls } from "../judgments/schema.ts";
import { measureText, type MeasureLanguage } from "./measures.ts";
import {
  activeProcedures,
  PART_LABEL,
  styleSummary,
  type Procedure,
  type ProcedurePart,
  type Style,
} from "./style.ts";

/**
 * The editor reads a draft beside the style it looks at, by function: what each paragraph does
 * (an opening, a portrait, a scene, an ending…) and, where a procedure of the style is at stake,
 * how the draft stands beside it: it does otherwise, it does the same, or the procedure is not in
 * the draft yet. The model reads the whole draft and the style's procedures in words, never the
 * pieces: the passages shown beside a cue are the procedure's own, found in the pieces by the
 * code. Nothing here rewrites the draft.
 */
export const READING_OUTCOMES = ["differs", "like", "missing"] as const;
export type ReadingOutcome = (typeof READING_OUTCOMES)[number];

export interface ReadingCue {
  /** Stable for the same procedure on the same paragraph. */
  id: string;
  procedure: { name: string; part?: ProcedurePart };
  /** The paragraph, counted from 1 as the measures count them; `null` for the whole draft. */
  paragraph: number | null;
  outcome: ReadingOutcome;
  note: string;
  /** Words of the draft the note speaks of, as written there. */
  words: string[];
}

export interface StyleReading {
  /** How the draft stands beside the style, in two sentences. */
  summary: string;
  /** What each paragraph does, by paragraph from 0; empty when the model said nothing. */
  functions: string[];
  cues: ReadingCue[];
}

/** The draft and the style's procedures, as the model reads them. */
export function renderReading(
  style: Pick<Style, "name" | "author" | "traits">,
  procedures: Procedure[],
  body: string,
  lang: MeasureLanguage = {},
): string {
  const m = measureText(body, lang);
  const out = [`STYLE: ${style.name}${style.author ? ` (${style.author})` : ""}`];
  const summary = styleSummary(style);
  if (summary) out.push(`In brief: ${summary}`);
  out.push("", "PROCEDURES OF THE STYLE:");
  procedures.forEach((p, i) => {
    out.push(
      `${i + 1}. [${p.part ? PART_LABEL[p.part].toLowerCase() : "—"}] ${p.name}${p.text ? ` — ${p.text}` : ""}`,
    );
  });
  out.push("", `DRAFT: ${m.words} words, ${m.paragraphs.length} paragraphs.`);
  m.paragraphs.forEach((p, i) => {
    out.push(`¶${i + 1} <<<${body.slice(p.from, p.to).replace(/\s+/g, " ").trim()}>>>`);
  });
  return out.join("\n");
}

/**
 * Reading the draft beside the style. `null` if the pack has no prompt for it; the procedures
 * are those the author has not set aside.
 */
export function styleReadingMessages(
  pack: LanguagePack,
  style: Pick<Style, "name" | "author" | "traits" | "procedures">,
  body: string,
): ChatMessage[] | null {
  const prompt = pack.prompts["style-reading"];
  if (!prompt) return null;
  return [
    { role: "system", content: prompt },
    { role: "user", content: renderReading(style, activeProcedures(style), body, pack) },
  ];
}

/** At most this many cues from one reading, and this many where the draft is like the style. */
const MAX_CUES = 10;
const MAX_LIKE = 2;
/** At most this many words to underline per cue, and this long each. */
const MAX_WORDS = 3;
const WORDS_CHARS = 80;
/** A paragraph's function: a word or two. */
const FUNCTION_CHARS = 28;

const OUTCOME_WORDS: Record<ReadingOutcome, string[]> = {
  differs: ["diverso", "diversa", "differente", "differs", "different", "otherwise"],
  like: ["come", "simile", "uguale", "come lo stile", "like", "same", "similar", "as the style"],
  missing: ["assente", "manca", "non ancora", "missing", "absent", "not yet"],
};

const text = (v: unknown) =>
  typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";

function outcomeOf(v: unknown): ReadingOutcome {
  const w = text(v).toLowerCase();
  return READING_OUTCOMES.find((o) => o === w || OUTCOME_WORDS[o].includes(w)) ?? "differs";
}

/** A paragraph number in 1..`count`; `null` for none or for the whole draft, `undefined` if wrong. */
function paragraphOf(v: unknown, count: number): number | null | undefined {
  const t = text(v);
  if (!t || /^(0|tutt|whole|all|intera)/i.test(t)) return null;
  const n = Number(/\d+/.exec(t)?.[0]);
  return Number.isInteger(n) && n >= 1 && n <= count ? n : undefined;
}

/**
 * The model's reading, read leniently: `sintesi`, `paragrafi` (`numero`, `funzione`) and
 * `spunti` (`procedimento`, `paragrafo`, `esito`, `nota`, `parole`), or the English names. A cue
 * on a procedure or a paragraph that does not exist is dropped, and so are the cues where the
 * draft is like the style after the first two. `null` only when nothing at all can be read.
 */
export function readReadingAnswer(
  content: string,
  procedures: Procedure[],
  paragraphs: number,
): StyleReading | null {
  for (const v of extractAllJson(content)) {
    const o = withoutNulls(v);
    if (!o || typeof o !== "object" || Array.isArray(o)) continue;
    const rec = o as Record<string, unknown>;
    const summary = text(rec.sintesi ?? rec.summary);
    const functions: string[] = Array.from({ length: paragraphs }, () => "");
    const paras = rec.paragrafi ?? rec.paragraphs;
    if (Array.isArray(paras)) {
      for (const item of paras) {
        if (!item || typeof item !== "object") continue;
        const i = item as Record<string, unknown>;
        const n = paragraphOf(i.numero ?? i.number ?? i.paragrafo ?? i.paragraph, paragraphs);
        const f = text(i.funzione ?? i.function).toLowerCase();
        if (n && f && f.length <= FUNCTION_CHARS) functions[n - 1] = f;
      }
    }
    const cues: ReadingCue[] = [];
    const items = rec.spunti ?? rec.cues;
    if (Array.isArray(items)) {
      for (const item of items) {
        if (!item || typeof item !== "object" || cues.length >= MAX_CUES) continue;
        const i = item as Record<string, unknown>;
        const p = procedures[Number(/\d+/.exec(text(i.procedimento ?? i.procedure))?.[0]) - 1];
        const paragraph = paragraphOf(i.paragrafo ?? i.paragraph, paragraphs);
        const note = text(i.nota ?? i.note);
        if (!p || paragraph === undefined || !note) continue;
        const id = `${p.name.toLowerCase()}:${paragraph ?? "all"}`;
        const outcome = outcomeOf(i.esito ?? i.outcome);
        if (cues.some((c) => c.id === id)) continue;
        // The reading is there for where the draft differs: a lenient model's praise is cut short.
        if (outcome === "like" && cues.filter((c) => c.outcome === "like").length >= MAX_LIKE) {
          continue;
        }
        const said = i.parole ?? i.words;
        const words = (Array.isArray(said) ? said : [])
          .map(text)
          .filter((w) => w && w.length <= WORDS_CHARS)
          .slice(0, MAX_WORDS);
        cues.push({
          id,
          procedure: { name: p.name, ...(p.part ? { part: p.part } : {}) },
          paragraph,
          outcome,
          note,
          words,
        });
      }
    }
    if (!summary && !cues.length && functions.every((f) => !f)) continue;
    // The paragraphs in the order of the text, the whole draft last.
    cues.sort((a, b) => (a.paragraph ?? paragraphs + 1) - (b.paragraph ?? paragraphs + 1));
    return { summary, functions, cues };
  }
  return null;
}
