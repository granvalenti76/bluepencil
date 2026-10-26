import type { LanguagePack } from "../languages/pack.ts";
import type { ChatMessage } from "../model/types.ts";
import { extractAllJson } from "../model/json.ts";
import { withoutNulls } from "../judgments/schema.ts";
import type { StyleComparison } from "./compare.ts";
import { DIMENSION_LABEL } from "./measures.ts";
import { activeTraits, type Style } from "./style.ts";

/**
 * The editor's note on a draft beside a style: the code finds where the draft's patterns move
 * away from the style (the cues, with their numbers); the model reads them with the paragraphs
 * they speak of and writes, in the draft's language, what the style does there and what the
 * draft does instead. It never rewrites the draft and never quotes the style's pieces (it does
 * not see them).
 */
export interface StyleNote {
  /** How the draft stands beside the style, in two sentences. */
  summary: string;
  /** A note for each cue, by its id; a cue the model skipped has none. */
  notes: Record<string, string>;
}

/** A paragraph as the model reads it: at most this many characters. */
const PARAGRAPH_CHARS = 900;

/** The draft's comparison as the model reads it: the style in words, the cues, the paragraphs. */
export function renderComparison(
  style: Pick<Style, "name" | "author" | "traits">,
  comparison: StyleComparison,
  body: string,
): string {
  const m = comparison.measured;
  const out = [`STYLE: ${style.name}${style.author ? ` (${style.author})` : ""}`];
  const said = activeTraits(style).filter((t) => t.dim);
  if (said.length) {
    out.push("The style in words:");
    for (const t of said) {
      out.push(`- ${t.dim === "summary" ? "In brief" : DIMENSION_LABEL[t.dim!]}: ${t.text}`);
    }
  }
  out.push("", `DRAFT: ${m.words} words, ${m.paragraphs.length} paragraphs.`);
  if (comparison.cues.length) {
    out.push("", "CUES:");
    comparison.cues.forEach((c, i) => {
      const where = c.paragraphs.length ? `¶${c.paragraphs.join(", ¶")}` : "whole draft";
      out.push(`${i + 1}. [${DIMENSION_LABEL[c.dim]} · ${where}] ${c.text}`);
      for (const p of c.paragraphs.slice(0, 2)) {
        const para = m.paragraphs[p - 1];
        if (!para) continue;
        const text = body.slice(para.from, para.to).replace(/\s+/g, " ").trim();
        out.push(
          `   Paragraph ${p}: <<<${text.length > PARAGRAPH_CHARS ? `${text.slice(0, PARAGRAPH_CHARS)}…` : text}>>>`,
        );
      }
    });
  } else {
    out.push("", "CUES: none.");
  }
  if (comparison.inLine.length) {
    out.push(
      "",
      `IN LINE WITH THE STYLE: ${comparison.inLine.map((d) => DIMENSION_LABEL[d].toLowerCase()).join(", ")}.`,
    );
  }
  return out.join("\n");
}

/** The editor's note on the draft. `null` if the pack has no style-note prompt. */
export function styleNoteMessages(
  pack: LanguagePack,
  style: Pick<Style, "name" | "author" | "traits">,
  comparison: StyleComparison,
  body: string,
): ChatMessage[] | null {
  const prompt = pack.prompts["style-note"];
  if (!prompt) return null;
  return [
    { role: "system", content: prompt },
    { role: "user", content: renderComparison(style, comparison, body) },
  ];
}

const text = (v: unknown) =>
  typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";

/**
 * The model's note, read leniently: the summary (`sintesi`) and a note per cue by its number
 * (`spunti`: `numero`, `nota`); a number that does not exist is dropped. `null` only when nothing
 * at all can be read.
 */
export function readNoteAnswer(content: string, cueIds: string[]): StyleNote | null {
  for (const v of extractAllJson(content)) {
    const o = withoutNulls(v);
    const rec = (Array.isArray(o) ? { spunti: o } : o) as Record<string, unknown> | null;
    if (!rec || typeof rec !== "object") continue;
    const summary = text(rec.sintesi ?? rec.summary);
    const items = rec.spunti ?? rec.cues ?? rec.notes;
    const notes: Record<string, string> = {};
    if (Array.isArray(items)) {
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const i = item as Record<string, unknown>;
        const n = Number(text(i.numero ?? i.number));
        const note = text(i.nota ?? i.note);
        const id = Number.isInteger(n) ? cueIds[n - 1] : undefined;
        if (id && note && !notes[id]) notes[id] = note;
      }
    }
    if (summary || Object.keys(notes).length) return { summary, notes };
  }
  return null;
}
