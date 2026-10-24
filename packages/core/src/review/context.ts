import type { Archetype } from "../archetypes/types.ts";
import type { OutlineEntry } from "../document/frontmatter.ts";
import { STEP_SCORE, type ReviewStep } from "../judgments/schema.ts";
import type { ChatMessage, ToolDefinition } from "../model/types.ts";
import type { LanguagePack } from "../languages/pack.ts";
import { fill } from "../languages/template.ts";
import { focusInstructions, stepInstructions, stepTools } from "../prompts/passes.ts";
import { systemPrompt } from "../prompts/system.ts";

// Session context. The order goes from the most stable to the most variable: system and
// context, then the text, then the analysis instructions. This way the start of the request is
// the same for every analysis of the same draft and llama-server reuses it.

export const CONTEXT_VERSION = "4";

/** Everything about a draft that stays the same across the passes of a review. */
export interface DraftContext {
  /** The draft's language: the text of prompts and labels. */
  pack: LanguagePack;
  title?: string;
  archetype?: Archetype;
  target?: number;
  outline: OutlineEntry[];
  brief?: string;
  glossary: string[];
  /** Shared `style.md` followed by the draft's `style`. */
  style: string[];
  /** Latest dismissed judgments (at most 30): not to be proposed again. */
  ignored: { kind: string; quote: string }[];
}

export interface SourcePassage {
  ref: string;
  text: string;
}

/** What an analysis checks: the whole text of the draft. */
export interface ReviewInput {
  text: string;
  /** The passage selected by the author, if the analysis is on that alone (the text stays as context). */
  focus?: string;
  /** Facts only: source passages chosen by search. */
  sources?: SourcePassage[];
  /** Facts only: footnotes cited in the text, with their definition. */
  footnotes?: { id: string; text: string }[];
}

export const MAX_IGNORED = 30;

/** The draft's context: identical byte for byte for every analysis. */
export function renderDraftContext(ctx: DraftContext): string {
  const l = ctx.pack.labels.context;
  const out: string[] = [l.heading];
  if (ctx.title) out.push(fill(l.title, { title: oneLine(ctx.title) }));
  out.push(fill(l.type, { name: ctx.archetype?.name ?? l.typeNone }));
  if (ctx.brief?.trim()) out.push("", l.brief, ctx.brief.trim());
  if (ctx.glossary.length) out.push("", l.glossary, ctx.glossary.join(", "));
  if (ctx.style.length) out.push("", l.style, ...ctx.style.map((s) => `- ${oneLine(s)}`));
  if (ctx.ignored.length) {
    out.push(
      "",
      l.ignored,
      ...ctx.ignored
        .slice(0, MAX_IGNORED)
        .map((j) => fill(l.ignoredItem, { quote: oneLine(j.quote) })),
    );
  }
  return out.join("\n");
}

/** The score is asked only on the whole text, and only for prose and structure. */
const withScore = (step: ReviewStep, input: ReviewInput) =>
  STEP_SCORE[step] !== undefined && input.focus === undefined;

/** The editor's letter: on the whole text, if the pack has one. */
const withLetter = (pack: LanguagePack, input: ReviewInput) =>
  input.focus === undefined && pack.prompts.letter !== undefined;

/**
 * Messages of a request: [system + draft context] then [text, analysis instructions, selected
 * passage or sources].
 */
export function buildMessages(
  step: ReviewStep,
  ctx: DraftContext,
  input: ReviewInput,
): ChatMessage[] {
  const { pack } = ctx;
  const l = pack.labels.review;
  const user: string[] = [
    l.text,
    "<<<",
    input.text,
    ">>>",
    "",
    stepInstructions(pack, step, ctx.archetype, withScore(step, input), withLetter(pack, input)),
  ];

  if (input.focus !== undefined) {
    user.push("", focusInstructions(pack), "<<<", input.focus, ">>>");
  }

  if (step === "facts") {
    if (input.sources?.length) {
      user.push("", l.sources);
      for (const s of input.sources) {
        user.push(fill(l.sourceOpen, { ref: s.ref }), s.text.trim(), l.sourceClose);
      }
    } else {
      user.push("", l.sourcesNone);
    }
    if (input.footnotes?.length) {
      user.push("", l.footnotes);
      for (const f of input.footnotes) user.push(`[^${f.id}]: ${oneLine(f.text)}`);
    }
  }

  return [
    { role: "system", content: `${systemPrompt(pack)}\n\n${renderDraftContext(ctx)}` },
    { role: "user", content: user.join("\n") },
  ];
}

/** The tools through which the model delivers the notes (and the score) of an analysis. */
export function reviewTools(
  pack: LanguagePack,
  step: ReviewStep,
  input: ReviewInput,
): ToolDefinition[] {
  return stepTools(pack, step, withScore(step, input), withLetter(pack, input));
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
