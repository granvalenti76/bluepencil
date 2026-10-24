import { createHash } from "node:crypto";
import {
  countWords,
  fitToBudget,
  isModelError,
  mapSections,
  ModelError,
  parseDraft,
  promptVersion,
  readAnalysis,
  renderDraftContext,
  resolveJudgment,
  REVIEW_ORDER,
  reviewTools,
  STEP_SCORE,
  wholeText,
  type Block,
  type DraftContext,
  type QueryLanguage,
  type Judgment,
  type ModelJudgment,
  type OutlineEntry,
  type Pass,
  type ReviewResponse,
  type SourcePassage,
} from "@desk/core";
import type { DraftsRepo } from "../drafts/repo.ts";
import type { EventBus, ReviewPhase, ReviewStats } from "../events.ts";
import type { CheckCache } from "../index-db/check-cache.ts";
import type { JudgmentsStore } from "../index-db/judgments.ts";
import type { LettersStore } from "../index-db/letters.ts";
import type { PassesStore } from "../index-db/passes.ts";
import type { ScoresStore } from "../index-db/scores.ts";
import type { Languages } from "../languages.ts";
import type { ModelService } from "../model/service.ts";
import { refreshJudgment } from "../routes/judgments.ts";
import { ulid } from "../ulid.ts";
import { loadDraftContext } from "./draft-context.ts";

/** Reasoning eats into the budget: start generous. */
export const REVIEW_MAX_TOKENS = 16_384;
export const REVIEW_TEMPERATURE = 0.2;
/** If `/props` does not report the context. */
const FALLBACK_CONTEXT = 32_768;
/** At most one progress event every so often: reasoning sends thousands of tokens. */
const PROGRESS_EVERY_MS = 250;

export interface ReviewOptions {
  /** The analyses to run (one per note type); all by default. */
  types?: Pass[];
  /**
   * Only this passage (offset in the body and text, to find it again if the body changed): the
   * model still reads the whole text. No structure or scores on a selection.
   */
  selection?: { from: number; to: number; text: string };
  cloud?: boolean;
}

/** What the facts analysis receives, besides the text. */
export interface FactSources {
  sources: SourcePassage[];
  footnotes: { id: string; text: string }[];
}

export interface SourceLoader {
  /** Source passages and footnotes for the text checked by the facts analysis. */
  forText(
    path: string,
    sources: string[],
    body: string,
    block: Block,
    lang: QueryLanguage,
  ): Promise<FactSources>;
}

interface Run {
  id: string;
  path: string;
  controller: AbortController;
  done: Promise<void>;
}

interface Deps {
  languages: Languages;
  repo: DraftsRepo;
  store: JudgmentsStore;
  cache: CheckCache;
  scores: ScoresStore;
  passes: PassesStore;
  letters: LettersStore;
  model: ModelService;
  bus: EventBus;
  draftsDir: string;
  sources: SourceLoader;
  log?: (msg: string, data?: unknown) => void;
}

const sha256 = (...parts: string[]) =>
  createHash("sha256").update(parts.join("\u0000")).digest("hex");

/**
 * The review: one analysis per chosen type (structure, facts, grammar, prose), each in a call on
 * the whole text, cached by fingerprint, notes sent via SSE at the end of each analysis,
 * cancellable. Calls go through `ModelService`'s single queue (one at a time).
 */
export class ReviewRunner {
  private runs = new Map<string, Run>();
  private readonly d: Deps;

  constructor(deps: Deps) {
    this.d = deps;
  }

  active(): { runId: string; path: string }[] {
    return [...this.runs.values()].map((r) => ({ runId: r.id, path: r.path }));
  }

  /** Starts a review; if one is already running on the same draft, returns that one. */
  start(path: string, opts: ReviewOptions = {}): string {
    for (const r of this.runs.values()) if (r.path === path) return r.id;
    const run: Run = {
      id: ulid(),
      path,
      controller: new AbortController(),
      done: Promise.resolve(),
    };
    this.runs.set(run.id, run);
    run.done = this.execute(run, opts).finally(() => this.runs.delete(run.id));
    return run.id;
  }

  /** Cancel: the model request is closed at once (abort down to `fetch`). */
  cancel(runId: string): boolean {
    const run = this.runs.get(runId);
    if (!run) return false;
    run.controller.abort();
    return true;
  }

  /** For tests and for shutting the server down. */
  async wait(runId: string): Promise<void> {
    await this.runs.get(runId)?.done;
  }

  async close() {
    for (const r of this.runs.values()) r.controller.abort();
    await Promise.all([...this.runs.values()].map((r) => r.done));
  }

  private async execute(run: Run, opts: ReviewOptions): Promise<void> {
    const { bus, model } = this.d;
    const { id: runId, path } = run;
    const signal = run.controller.signal;
    const started = Date.now();
    const stats: ReviewStats = {
      steps: 0,
      cached: 0,
      modelCalls: 0,
      judgments: 0,
      errors: 0,
      elapsedMs: 0,
    };
    const finish = (cancelled: boolean) => {
      stats.elapsedMs = Date.now() - started;
      bus.emit({ type: "review.done", runId, path, cancelled, stats });
    };
    const error = (code: string, message: string, fatal: boolean) => {
      stats.errors++;
      bus.emit({ type: "review.error", runId, path, code, message, fatal });
    };

    try {
      // The context (with the list of dismissed notes) is fixed here and does not change during the review.
      const { ctx, body } = await loadDraftContext(
        this.d.repo,
        this.d.store,
        this.d.draftsDir,
        path,
        this.d.languages,
      );
      const { data } = parseDraft((await this.d.repo.read(path)).text);
      const outline = data.outline ?? [];
      if (!opts.cloud && !model.status().local.reachable) await model.refresh();
      const modelName = model.modelName(opts.cloud);
      const contextHash = sha256(renderDraftContext(ctx));
      const slot = opts.cloud ? undefined : await model.slotFor(path);
      const nCtx = opts.cloud ? undefined : await model.contextSize();
      // The response (reasoning included) gets at most half the context: on a small server it
      // must not leave the prompt without room.
      const ctxSize = nCtx ?? FALLBACK_CONTEXT;
      const maxTokens = Math.min(REVIEW_MAX_TOKENS, Math.floor(ctxSize / 2));
      const budget = ctxSize - maxTokens;
      const types: readonly Pass[] = opts.types ?? REVIEW_ORDER;
      const steps = REVIEW_ORDER.filter(
        (p) => types.includes(p) && !(opts.selection && p === "structure"),
      );
      const focus = opts.selection !== undefined;
      const block = opts.selection ? locate(body, opts.selection) : wholeText(body);
      if (!block) {
        error("selection_changed", "The selected text has changed: select it again.", true);
        return finish(false);
      }
      const bodyHash = sha256(body);
      const bodyState = { hash: bodyHash, words: countWords(body) };

      for (const [stepIndex, step] of steps.entries()) {
        if (signal.aborted) throw new ModelError("aborted");
        const version = promptVersion(ctx.pack, step);
        stats.steps++;
        let last = 0;
        let lastPhase: ReviewPhase | null = null;
        const progress = (phase: ReviewPhase, reasoningTokens?: number, force = false) => {
          const now = Date.now();
          if (!force && phase === lastPhase && now - last < PROGRESS_EVERY_MS) return;
          last = now;
          lastPhase = phase;
          bus.emit({
            type: "review.progress",
            runId,
            path,
            step,
            stepIndex,
            stepCount: steps.length,
            phase,
            ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
          });
        };

        // For facts the fingerprint includes the source passages: if `fatti.md` changes, check
        // again. On a selection it includes the passage and where it is.
        const facts =
          step === "facts"
            ? await this.d.sources.forText(path, data.sources ?? [], body, block, ctx.pack)
            : undefined;
        const chunkHash = sha256(
          step,
          version,
          modelName,
          contextHash,
          ...(facts ? [JSON.stringify(facts)] : []),
          ...(focus ? ["focus", String(block.from), block.text] : []),
          body,
        );
        let result = this.d.cache.get(chunkHash, step, modelName, version);
        if (result) {
          stats.cached++;
          progress("cached", undefined, true);
        } else {
          progress("queued", undefined, true);
          try {
            result = await this.analyse(step, ctx, body, block, {
              facts,
              focus,
              cloud: opts.cloud,
              slot,
              budget,
              maxTokens,
              signal,
              progress,
              stats,
            });
          } catch (e) {
            if (!isModelError(e) || e.code === "aborted") throw e;
            if (e.code === "unreachable" || e.code === "timeout") throw e;
            // An analysis that fails (unreadable or truncated response) does not stop the others.
            error(e.code, `${LABEL[step]}: ${e.message}`, false);
            continue;
          }
          this.d.cache.set(chunkHash, step, modelName, version, result);
        }

        const scoreKind = STEP_SCORE[step];
        if (scoreKind && result.score && !focus) {
          const score = this.d.scores.set(path, {
            kind: scoreKind,
            ...result.score,
            bodyHash,
            model: modelName,
          });
          bus.emit({ type: "review.score", runId, path, score });
        }

        // The editor's letter: only on the whole text.
        if (result.letter && !focus) {
          const letter = this.d.letters.set(path, {
            pass: step,
            text: result.letter,
            bodyHash,
            model: modelName,
            promptVersion: version,
          });
          bus.emit({ type: "review.letter", runId, path, letter });
        }

        const { created, removed } = await this.materialize(path, step, body, result.judgments, {
          chunkHash,
          modelName,
          version,
          outline,
          range: focus ? { from: block.from, to: block.to } : null,
        });
        stats.judgments += created.length;
        if (created.length || removed.length) {
          bus.emit({ type: "judgment.created", runId, path, judgments: created, removed });
        }
        // A check on a selection is not the pass: the pass looks at the whole text.
        if (!focus) this.d.passes.markRun(path, step, bodyState);
      }
      finish(false);
    } catch (e) {
      if (signal.aborted || (isModelError(e) && e.code === "aborted")) return finish(true);
      const code = isModelError(e) ? e.code : "internal";
      error(code, (e as Error).message, true);
      this.d.log?.("review stopped", e);
      finish(false);
    }
  }

  /** A model call: the notes arrive through the "annotate" tool (or as JSON in the text). */
  private async analyse(
    step: Pass,
    ctx: DraftContext,
    body: string,
    block: Block,
    o: {
      facts?: FactSources;
      /** `block` is a selection: the model receives the whole text and the passage. */
      focus: boolean;
      cloud?: boolean;
      slot?: number;
      budget: number;
      maxTokens: number;
      signal: AbortSignal;
      progress: (phase: ReviewPhase, reasoningTokens?: number, force?: boolean) => void;
      stats: ReviewStats;
    },
  ): Promise<ReviewResponse> {
    return this.d.model.run(
      async (client) => {
        const input = { text: body, ...(o.focus ? { focus: block.text } : {}), ...(o.facts ?? {}) };
        const fitted = await fitToBudget(
          step,
          ctx,
          input,
          o.budget,
          async (t) => (await client.countTokens(t, o.signal)).count,
        );
        o.stats.modelCalls++;
        const result = await client.chat({
          messages: fitted.messages,
          tools: reviewTools(ctx.pack, step, fitted.input),
          temperature: REVIEW_TEMPERATURE,
          maxTokens: o.maxTokens,
          slot: o.slot,
          signal: o.signal,
          onProgress: (p) => o.progress(p.phase, p.reasoningTokens),
        });
        const analysis = readAnalysis(step, result, ctx.pack);
        if (analysis.dropped) {
          this.d.log?.(`${analysis.dropped} unreadable notes discarded`, { step });
        }
        if (analysis.textOnly)
          this.d.log?.("response without notes", { step, text: result.content });
        return {
          judgments: analysis.judgments,
          ...(analysis.score ? { score: analysis.score } : {}),
          ...(analysis.letter ? { letter: analysis.letter } : {}),
        };
      },
      { cloud: o.cloud, signal: o.signal, onWait: (w) => o.progress(w, undefined, true) },
    );
  }

  /**
   * Turns the model's notes into saved judgments: finds the quotes in the text, does not repeat a
   * check already done on the same text, removes the open notes of the same type it supersedes.
   * A quote that cannot be found does not lose the note: it stays, without an underline.
   */
  private async materialize(
    path: string,
    step: Pass,
    body: string,
    result: ModelJudgment[],
    meta: {
      chunkHash: string;
      modelName: string;
      version: string;
      outline: OutlineEntry[];
      /** Analysis on a selection: only the notes touching it are replaced. */
      range: { from: number; to: number } | null;
    },
  ): Promise<{ created: Judgment[]; removed: string[] }> {
    const { store } = this.d;
    const all = store.list(path, { includeStale: true }).filter((j) => j.pass === step);
    if (all.some((j) => j.chunkHash === meta.chunkHash && j.status !== "stale")) {
      return { created: [], removed: [] };
    }

    const touched = (j: Judgment) =>
      meta.range === null ||
      (j.range !== null && j.range.from < meta.range.to && j.range.to > meta.range.from);
    const removed: string[] = [];
    for (const j of all) {
      if (j.status === "open" && touched(j)) {
        store.update({ ...j, status: "stale" });
        removed.push(j.id);
      }
    }

    // The text may have changed while the model was working: positions are mapped to the current file.
    const current = parseDraft((await this.d.repo.read(path)).text).body;
    const now = new Date().toISOString();
    const sections = mapSections(body, meta.outline);
    const sectionAt = (at: number) =>
      sections.find((s) => s.range && s.range.from <= at && at < s.range.to)?.id;
    // Dismissed notes are not proposed again (the prompt asks for this; here to be safe).
    const ignored = new Set(all.filter((j) => j.status === "ignored").map((j) => j.anchor.quote));
    const where = meta.range ?? { from: 0, to: body.length };
    const created: Judgment[] = [];
    for (const mj of result) {
      let resolved = resolveJudgment(body, where, mj);
      if (!resolved.ok && resolved.reason === "noop_replace") {
        resolved = resolveJudgment(body, where, { ...mj, proposal: { action: "none", label: "" } });
        mj.proposal = { action: "none", label: "Got it" };
      }
      if (!resolved.ok) {
        // Quote not found: the note stays, without a position (and without proposed changes).
        resolved = { ok: true, range: null, anchor: { quote: mj.quote, prefix: "", suffix: "" } };
        if (mj.proposal.action === "replace") mj.proposal = { action: "none", label: "Got it" };
      }
      if (mj.quote && ignored.has(resolved.anchor.quote)) continue;
      const sectionId = resolved.range ? sectionAt(resolved.range.from) : undefined;
      let j: Judgment = {
        ...mj,
        id: ulid(),
        draftPath: path,
        pass: step,
        ...(sectionId ? { sectionId } : {}),
        range: resolved.range,
        anchor: resolved.anchor,
        status: "open",
        chunkHash: meta.chunkHash,
        model: meta.modelName,
        promptVersion: meta.version,
        createdAt: now,
      };
      if (current !== body && j.range) j = refreshJudgment(current, j);
      if (j.status === "stale") continue;
      store.insert(j);
      created.push(j);
    }
    return { created, removed };
  }
}

/** In error messages for the user: in English, like the interface. */
const LABEL: Record<Pass, string> = {
  structure: "Structure",
  facts: "Facts",
  grammar: "Grammar",
  prose: "Prose",
};

/**
 * The selected passage in the current body: where the interface says it is or, if the body has
 * changed in the meantime (late save), the nearest occurrence.
 */
function locate(body: string, sel: { from: number; to: number; text: string }): Block | null {
  if (sel.text.trim() === "") return null;
  if (body.slice(sel.from, sel.to) === sel.text) return { ...sel };
  let best = -1;
  for (let i = body.indexOf(sel.text); i !== -1; i = body.indexOf(sel.text, i + 1)) {
    if (best === -1 || Math.abs(i - sel.from) < Math.abs(best - sel.from)) best = i;
  }
  return best === -1 ? null : { from: best, to: best + sel.text.length, text: sel.text };
}
