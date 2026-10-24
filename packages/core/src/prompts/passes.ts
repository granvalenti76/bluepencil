import type { Archetype } from "../archetypes/types.ts";
import type { ReviewStep } from "../judgments/schema.ts";
import { NOTE_FIELDS, type LanguagePack } from "../languages/pack.ts";
import { fill } from "../languages/template.ts";
import type { ToolDefinition } from "../model/types.ts";

// The four analyses. The text lives in the language pack; here is how it is put together.

/** What the type of text looks like: its typical parts and the traits of the genre. */
function genre(pack: LanguagePack, a: Archetype | undefined): string {
  const l = pack.labels.structure;
  if (!a) return l.genreNone;
  const parts = a.defaultSections
    .map((s) => fill(l.genrePart, { title: s.title, guidance: s.guidance }))
    .join("\n");
  const traits = a.checklist
    .map((c) => fill(l.genreTrait, { description: c.description }))
    .join("\n");
  return `${fill(l.genre, { name: a.name })}\n${parts}${traits ? `\n${l.genreTraits}\n${traits}` : ""}`;
}

function structure(pack: LanguagePack, a: Archetype | undefined): string {
  const l = pack.labels.structure;
  return fill(pack.prompts.structure, {
    genre: genre(pack, a),
    name: a ? fill(l.name, { name: a.name }) : l.nameNone,
  });
}

/** An analysis's instructions; score and letter are asked only on the whole text. */
export function stepInstructions(
  pack: LanguagePack,
  step: ReviewStep,
  archetype: Archetype | undefined,
  withScore: boolean,
  withLetter = false,
): string {
  const base = baseInstructions(pack, step, archetype, withScore);
  return withLetter && pack.prompts.letter ? `${base}\n${pack.prompts.letter}` : base;
}

function baseInstructions(
  pack: LanguagePack,
  step: ReviewStep,
  archetype: Archetype | undefined,
  withScore: boolean,
): string {
  const p = pack.prompts;
  switch (step) {
    case "grammar":
      return p.grammar;
    case "prose":
      return withScore ? `${p.prose}\n${p["prose-score"]}` : p.prose;
    case "facts":
      return p.facts;
    case "structure":
      return withScore
        ? `${structure(pack, archetype)}\n${p["structure-score"]}`
        : structure(pack, archetype);
  }
}

/** When the author has selected a passage: the rest of the draft is there only to understand it. */
export const focusInstructions = (pack: LanguagePack): string => pack.prompts.focus;

/**
 * An analysis's tools: "annotate" always, "score" if a score is asked, "letter" for the editor's
 * letter on the whole text (if the pack has one).
 */
export function stepTools(
  pack: LanguagePack,
  step: ReviewStep,
  withScore: boolean,
  withLetter = false,
): ToolDefinition[] {
  const t = pack.tools;
  const properties: Record<string, unknown> = {};
  for (const f of NOTE_FIELDS[step]) {
    properties[f.name] = f.enum
      ? { type: "string", enum: [...f.enum] }
      : { type: "string", description: t.fields[step][f.name] };
  }
  const tools: ToolDefinition[] = [
    {
      type: "function",
      function: {
        name: "annota",
        description: t.note,
        parameters: {
          type: "object",
          properties,
          required: NOTE_FIELDS[step].filter((f) => f.required).map((f) => f.name),
        },
      },
    },
  ];
  if (withScore) {
    tools.push({
      type: "function",
      function: {
        name: "valuta",
        description: t.score,
        parameters: {
          type: "object",
          properties: {
            voto: { type: "integer", minimum: 0, maximum: 100 },
            motivo: { type: "string", description: t.scoreReason },
          },
          required: ["voto"],
        },
      },
    });
  }
  if (withLetter && t.letter && t.letterText) {
    tools.push({
      type: "function",
      function: {
        name: "lettera",
        description: t.letter,
        parameters: {
          type: "object",
          properties: { testo: { type: "string", description: t.letterText } },
          required: ["testo"],
        },
      },
    });
  }
  return tools;
}
