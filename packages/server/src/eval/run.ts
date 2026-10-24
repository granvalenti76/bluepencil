import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  buildMessages,
  CONTEXT_VERSION,
  defaultOutline,
  EvalSuiteSchema,
  footnotesIn,
  archetypeIn,
  isModelError,
  readAnalysis,
  reviewTools,
  parseDraft,
  PRECISION_THRESHOLD,
  promptVersion,
  scoreCase,
  sourcePassages,
  sumScores,
  toOutline,
  type CaseScore,
  type DraftContext,
  type ModelJudgment,
  type Pass,
  type PassScore,
  type ReviewInput,
} from "@desk/core";
import { Languages } from "../languages.ts";
import type { ModelService } from "../model/service.ts";
import { localSourcePath } from "../review/sources.ts";
import { REVIEW_MAX_TOKENS, REVIEW_TEMPERATURE } from "../review/runner.ts";

export interface EvalCaseResult extends CaseScore {
  pass: Pass;
  seconds: number;
  reasoningTokens: number;
  error?: string;
}

export interface EvalReport {
  date: string;
  model: string;
  promptVersions: Record<string, string>;
  contextVersion: string;
  /** Only some passes or cases: the numbers do not count for deciding the chips. */
  partial: boolean;
  passes: (PassScore & { errors: number; seconds: number; enabled: boolean })[];
  cases: EvalCaseResult[];
}

export interface EvalOptions {
  /** `fixtures/eval`. */
  root: string;
  model: ModelService;
  passes?: Pass[];
  /** Only the cases whose file name contains this text. */
  only?: string;
  signal?: AbortSignal;
  onCase?: (r: EvalCaseResult) => void;
}

/** The built-in language packs, read once. */
let cached: Languages | undefined;
const languages = () => (cached ??= new Languages());

/** A case: the context from its front matter, the whole text as the review prepares it. */
export async function prepareCase(
  pass: Pass,
  file: string,
): Promise<{ body: string; ctx: DraftContext; input: ReviewInput }> {
  const { data, body } = parseDraft(await readFile(file, "utf8"));
  const pack = languages().forDraft(data.lang);
  const archetype = archetypeIn(pack, data.archetype ?? "article");
  const outline =
    data.outline ?? (archetype ? toOutline(defaultOutline(archetype, data.target)) : []);
  const ctx: DraftContext = {
    pack,
    title: data.title,
    archetype,
    target: data.target,
    outline,
    brief: data.brief,
    glossary: data.glossary ?? [],
    style: data.style ?? [],
    ignored: [],
  };
  const input: ReviewInput = { text: body };
  if (pass === "facts") {
    // Short cases: whole sources (in passages, as search prepares them), no FTS selection.
    input.sources = [];
    for (const ref of data.sources ?? []) {
      const rel = localSourcePath("caso.md", ref);
      if (!rel) continue;
      const text = await readFile(join(dirname(file), rel), "utf8");
      input.sources.push({
        ref,
        text: sourcePassages(text)
          .map((p) => `- ${p}`)
          .join("\n"),
      });
    }
    input.footnotes = footnotesIn(body, body);
  }
  return { body, ctx, input };
}

/**
 * The suites with expected cases valid for the current analyses. The structure ones check the old
 * checklist (headings, missing sections) and need rewriting for consistency with the type of
 * text: until then, structure is not evaluated.
 */
export const EVAL_PASSES: Pass[] = ["facts", "grammar", "prose"];

/**
 * Evaluation suite: every case goes through the model with the same prompts, context and
 * parameters as the review, then is compared with the expected judgments.
 */
export async function runEval(o: EvalOptions): Promise<EvalReport> {
  const passes = o.passes ?? EVAL_PASSES;
  const cases: EvalCaseResult[] = [];
  let partial = passes.length < EVAL_PASSES.length || o.only !== undefined;

  for (const pass of passes) {
    const dir = join(o.root, pass);
    const suite = EvalSuiteSchema.parse(
      JSON.parse(await readFile(join(dir, "expected.json"), "utf8")),
    );
    if (suite.pass !== pass) throw new Error(`${dir}/expected.json: pass ${suite.pass}`);
    for (const c of suite.cases) {
      if (o.only && !c.file.includes(o.only)) continue;
      const { body, ctx, input } = await prepareCase(pass, join(dir, c.file));
      const started = Date.now();
      let predicted: ModelJudgment[] = [];
      let reasoningTokens = 0;
      let error: string | undefined;
      try {
        predicted = await o.model.run(
          async (client) =>
            readAnalysis(
              pass,
              await client.chat({
                messages: buildMessages(pass, ctx, input),
                tools: reviewTools(ctx.pack, pass, input),
                temperature: REVIEW_TEMPERATURE,
                maxTokens: REVIEW_MAX_TOKENS,
                signal: o.signal,
                onProgress: (p) => (reasoningTokens = p.reasoningTokens ?? reasoningTokens),
              }),
              ctx.pack,
            ).judgments,
          { signal: o.signal },
        );
      } catch (e) {
        if (isModelError(e, "aborted") || isModelError(e, "unreachable")) throw e;
        error = (e as Error).message;
        partial = true;
      }
      const result: EvalCaseResult = {
        pass,
        ...scoreCase(pass, c.file, body, c.expected, predicted),
        seconds: (Date.now() - started) / 1000,
        reasoningTokens,
        ...(error ? { error } : {}),
      };
      cases.push(result);
      o.onCase?.(result);
    }
  }

  return {
    date: new Date().toISOString(),
    model: o.model.modelName(),
    promptVersions: Object.fromEntries(
      passes.map((p) => [p, promptVersion(languages().forDraft(undefined), p)]),
    ),
    contextVersion: CONTEXT_VERSION,
    partial,
    passes: passes.map((pass) => {
      const mine = cases.filter((c) => c.pass === pass);
      const score = sumScores(pass, mine);
      return {
        ...score,
        errors: mine.filter((c) => c.error).length,
        seconds: mine.reduce((a, c) => a + c.seconds, 0),
        enabled: score.precision === null || score.precision >= PRECISION_THRESHOLD,
      };
    }),
    cases,
  };
}

const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);
const LABEL: Record<Pass, string> = {
  structure: "Structure",
  facts: "Facts",
  grammar: "Grammar",
  prose: "Prose",
};

export function renderReport(r: EvalReport): string {
  const out = [
    "# Evaluation of the review passes",
    "",
    `Run on ${r.date} with the model \`${r.model}\` (prompts ${Object.entries(r.promptVersions)
      .map(([p, v]) => `${p} ${v}`)
      .join(", ")}; context ${r.contextVersion}).`,
    r.partial ? "\n**Partial run** (selected passes or cases, or model errors)." : "",
    "",
    "Structure is not evaluated until its expected cases are rewritten for the new analysis (consistency with the type of text).",
    "",
    "| Pass | Cases | Expected | Notes | Right | Wrong | Missed | Discarded | Precision | Recall | Errors | Time |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...r.passes.map(
      (p) =>
        `| ${LABEL[p.pass]} | ${p.cases} | ${p.tp + p.fn} | ${p.tp + p.fp} | ${p.tp} | ${p.fp} | ${p.fn} | ${p.discarded} | ${pct(p.precision)} | ${pct(p.recall)} | ${p.errors} | ${Math.round(p.seconds)} s |`,
    ),
    "",
    "## Cases in detail",
  ];
  for (const c of r.cases) {
    out.push(
      "",
      `### ${LABEL[c.pass]} · ${c.file}`,
      "",
      `${c.tp} right, ${c.fp} wrong, ${c.fn} missed, ${c.discarded} discarded · ${c.seconds.toFixed(1)} s · ${c.reasoningTokens} reasoning tokens`,
    );
    if (c.error) out.push(`- **Error:** ${c.error}`);
    for (const m of c.missed)
      out.push(
        `- Missed: «${m.quote}»${m.type ? ` (${m.type})` : ""}${m.note ? ` — ${m.note}` : ""}`,
      );
    for (const w of c.wrong) out.push(`- Extra: «${w.quote}»${w.type ? ` (${w.type})` : ""}`);
  }
  return out.join("\n") + "\n";
}
