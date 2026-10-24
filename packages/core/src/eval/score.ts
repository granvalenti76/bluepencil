import { z } from "zod";
import { resolveQuote } from "../judgments/resolve.ts";
import { PASSES, type ModelJudgment, type Pass } from "../judgments/schema.ts";

/**
 * Evaluation suite. An expected judgment is "quote + type"; the type depends on the pass,
 * because only some have a closed taxonomy:
 * - structure: the id of the checklist item (`checkId`), the quote does not matter;
 * - facts: the outcome (`verified` | `unsourced` | `to_check`);
 * - grammar and prose: none (the quote is enough: every note is something to fix; the type of a
 *   prose problem is no longer a closed taxonomy).
 */
export const ExpectedJudgmentSchema = z.object({
  quote: z.string(),
  type: z.string().optional(),
  /** A note for whoever reads the suite (why it is an error); not part of the score. */
  note: z.string().optional(),
});
export type ExpectedJudgment = z.infer<typeof ExpectedJudgmentSchema>;

export const EvalSuiteSchema = z.object({
  pass: z.enum(PASSES),
  cases: z.array(z.object({ file: z.string(), expected: z.array(ExpectedJudgmentSchema) })),
});
export type EvalSuite = z.infer<typeof EvalSuiteSchema>;

/** The type of a model judgment, comparable with the expected one. */
export function judgmentType(pass: Pass, j: ModelJudgment): string | undefined {
  switch (pass) {
    case "structure":
      return j.checkId;
    case "facts":
      return j.factStatus;
    case "grammar":
    case "prose":
      return undefined;
  }
}

/** The model judgments that count as notes (as in `ReviewRunner.materialize`). */
export function countsAsNote(pass: Pass, j: ModelJudgment): boolean {
  return !(pass === "structure" && (j.checkStatus === "ok" || j.checkStatus === "na"));
}

export interface CaseScore {
  file: string;
  tp: number;
  fp: number;
  fn: number;
  /** Model quotes that cannot be found in the text (the app discards them too). */
  discarded: number;
  missed: ExpectedJudgment[];
  wrong: { quote: string; type?: string }[];
}

interface Span {
  from: number;
  to: number;
}

const overlaps = (a: Span | null, b: Span | null) =>
  a === null || b === null ? a === b : a.from < b.to && b.from < a.to;

/**
 * Compares the model's judgments with the expected ones for a case: one-to-one matching, same
 * type (if the pass has one) and quotes that overlap in the text.
 */
export function scoreCase(
  pass: Pass,
  file: string,
  body: string,
  expected: ExpectedJudgment[],
  predicted: ModelJudgment[],
): CaseScore {
  const span = (quote: string): Span | null | undefined => {
    if (pass === "structure" || quote.trim() === "") return null;
    return resolveQuote(body, quote) ?? undefined;
  };
  const exp = expected.map((e) => {
    const s = span(e.quote);
    if (s === undefined)
      throw new Error(`${file}: expected quote not found in the text: «${e.quote}»`);
    return { e, s };
  });
  let discarded = 0;
  const pred: { j: ModelJudgment; s: Span | null }[] = [];
  for (const j of predicted.filter((j) => countsAsNote(pass, j))) {
    const s = span(j.quote);
    if (s === undefined) discarded++;
    else pred.push({ j, s });
  }

  const used = new Set<number>();
  const wrong: CaseScore["wrong"] = [];
  for (const p of pred) {
    const type = judgmentType(pass, p.j);
    const i = exp.findIndex(
      (x, k) =>
        !used.has(k) &&
        (type === undefined || x.e.type === undefined || x.e.type === type) &&
        (pass === "structure" || overlaps(x.s, p.s)),
    );
    if (i === -1) wrong.push({ quote: p.j.quote, ...(type ? { type } : {}) });
    else used.add(i);
  }
  const missed = exp.filter((_, k) => !used.has(k)).map((x) => x.e);
  return { file, tp: used.size, fp: wrong.length, fn: missed.length, discarded, missed, wrong };
}

export interface PassScore {
  pass: Pass;
  cases: number;
  tp: number;
  fp: number;
  fn: number;
  discarded: number;
  /** `null` if the model produced no notes (precision undefined). */
  precision: number | null;
  recall: number | null;
}

export function sumScores(pass: Pass, cases: CaseScore[]): PassScore {
  const s = { tp: 0, fp: 0, fn: 0, discarded: 0 };
  for (const c of cases) {
    s.tp += c.tp;
    s.fp += c.fp;
    s.fn += c.fn;
    s.discarded += c.discarded;
  }
  return {
    pass,
    cases: cases.length,
    ...s,
    precision: s.tp + s.fp === 0 ? null : s.tp / (s.tp + s.fp),
    recall: s.tp + s.fn === 0 ? null : s.tp / (s.tp + s.fn),
  };
}

/** Below this precision a pass starts switched off in the "Show" chips. */
export const PRECISION_THRESHOLD = 0.7;
