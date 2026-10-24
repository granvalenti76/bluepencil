import { z } from "zod";

export const ProposalSchema = z.object({
  action: z.enum([
    "replace",
    "delete",
    "insert_after",
    "add_source",
    "mark_opinion",
    "compare_sources",
    "regenerate_section",
    "draft_section",
    "none",
  ]),
  text: z.string().optional(),
  label: z.string(),
});

/** What the model must produce: a quote, never offsets. */
export const ModelJudgmentSchema = z.object({
  kind: z.string(),
  quote: z.string(),
  title: z.string(),
  rationale: z.string(),
  proposal: ProposalSchema,
  factStatus: z.enum(["verified", "unsourced", "to_check"]).optional(),
  checkStatus: z.enum(["ok", "warn", "missing", "na"]).optional(),
  checkId: z.string().optional(),
});
export type ModelJudgment = z.infer<typeof ModelJudgmentSchema>;

/** The note types: they decide colour, "Show" filter and evaluation. */
export const PASSES = ["structure", "facts", "grammar", "prose"] as const;
export type Pass = (typeof PASSES)[number];

/**
 * The analyses: one per note type, each in its own call on the whole text, independent of each
 * other.
 */
export const REVIEW_STEPS = PASSES;
export type ReviewStep = Pass;

/**
 * The order of the review passes: top to bottom, like a managing editor. Grammar last: the
 * earlier passes rewrite sentences.
 */
export const REVIEW_ORDER = ["structure", "facts", "prose", "grammar"] as const satisfies Pass[];

/**
 * State of a pass for a draft: `open` (computed, to work on), `done` (closed by the author),
 * `skipped`. With no saved state, a pass is "waiting".
 */
export const PASS_STATES = ["open", "done", "skipped"] as const;
export type PassState = (typeof PASS_STATES)[number];

export interface PassRecord {
  pass: Pass;
  state: PassState;
  /** sha256 of the body when the pass was closed or skipped (or computed, if `open`). */
  bodyHash: string;
  /** Words in the body at that moment: used to say "the text has changed a lot since then". */
  words: number;
  updatedAt: string;
}

/** Score of one aspect of the whole text (0–100), with a one-line reason. */
export const ScoreSchema = z.object({
  value: z.coerce.number().min(0).max(100).transform(Math.round),
  reason: z.string().default(""),
});
export type Score = z.infer<typeof ScoreSchema>;

/** The aspects the model scores: clarity comes from the readability index. */
export const SCORE_KINDS = ["prose", "structure"] as const;
export type ScoreKind = (typeof SCORE_KINDS)[number];

/** The analyses that also give the whole text a score. */
export const STEP_SCORE: Partial<Record<ReviewStep, ScoreKind>> = {
  structure: "structure",
  prose: "prose",
};

export const JUDGMENT_STATUSES = ["open", "applied", "ignored", "stale"] as const;

export const JudgmentSchema = ModelJudgmentSchema.extend({
  id: z.string(),
  draftPath: z.string(),
  pass: z.enum(PASSES),
  sectionId: z.string().optional(),
  /** Offset in the body; `null` = section note. */
  range: z.object({ from: z.number(), to: z.number() }).nullable(),
  anchor: z.object({ quote: z.string(), prefix: z.string(), suffix: z.string() }),
  status: z.enum(JUDGMENT_STATUSES),
  applied: z
    .object({
      from: z.number(),
      to: z.number(),
      original: z.string(),
      replacement: z.string(),
      /** Context right before and right after, once the change is made: to find it again and undo it. */
      before: z.string().optional(),
      after: z.string().optional(),
    })
    .optional(),
  chunkHash: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  createdAt: z.string(),
});
export type Judgment = z.infer<typeof JudgmentSchema>;

/** Drops `null` fields from objects: many models write `"text": null` for "absent". */
export function withoutNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withoutNulls);
  if (v === null || typeof v !== "object") return v;
  return Object.fromEntries(
    Object.entries(v)
      .filter(([, x]) => x !== null)
      .map(([k, x]) => [k, withoutNulls(x)]),
  );
}

/** `checkId` copied with the brackets from the context ("[lead-answers]"): strip them. */
function normalize(v: unknown): unknown {
  const out = withoutNulls(v);
  if (!Array.isArray(out)) return out;
  return out.map((j) =>
    j && typeof j === "object" && typeof (j as { checkId?: unknown }).checkId === "string"
      ? { ...j, checkId: (j as { checkId: string }).checkId.replace(/^\[(.*)\]$/, "$1").trim() }
      : j,
  );
}

/**
 * The response of a review pass: an array of judgments. `null`s count as absent and `checkId`
 * loses its square brackets (behaviours seen with gemma-4-E4B).
 */
export const ModelJudgmentsSchema = z.preprocess(normalize, z.array(ModelJudgmentSchema));

/** The result of an analysis, as stored in the check cache. */
export interface ReviewResponse {
  judgments: ModelJudgment[];
  score?: Score;
  /** The editor's letter on the whole text. */
  letter?: string;
}
