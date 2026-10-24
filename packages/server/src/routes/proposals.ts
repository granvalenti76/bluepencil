import type { FastifyInstance } from "fastify";
import {
  isModelError,
  mapSections,
  parseDraft,
  repairMessage,
  REWRITE_STYLES,
  rewriteMessages,
  sectionMessages,
} from "@desk/core";
import { z } from "zod";
import type { DraftsRepo } from "../drafts/repo.ts";
import type { JudgmentsStore } from "../index-db/judgments.ts";
import type { Languages } from "../languages.ts";
import type { ModelService } from "../model/service.ts";
import { loadDraftContext } from "../review/draft-context.ts";

const Body = z.object({
  path: z.string(),
  sectionId: z.string(),
  mode: z.enum(["draft", "regenerate"]),
  judgmentId: z.string().optional(),
  cloud: z.boolean().optional(),
});
const Proposal = z.object({ text: z.string().min(1) });

const RewriteBody = z.object({
  path: z.string(),
  /** The selected passage (offset in the body and text). */
  from: z.number().int().min(0),
  to: z.number().int().min(0),
  text: z.string().min(1),
  style: z.enum(REWRITE_STYLES),
  cloud: z.boolean().optional(),
});
const Rewrite = z.object({ alternatives: z.array(z.string()).min(1) });

const SECTION_MAX_TOKENS = 8192;

/** Text of a section without the heading or marker that opens it. */
export function sectionProse(text: string): string {
  return text.replace(/^\s*(#{1,6}[ \t][^\n]*|<!--\s*section:[^>]*-->)[ \t]*\n?/, "").trim();
}

/**
 * `POST /api/proposals/section`: a text **proposal** for a section, streamed over SSE
 * (`progress`, `done` with `{ text }`, `error`). Does not touch the file: the text goes in only
 * with "Insert" in the editor.
 */
export function registerProposalRoutes(
  app: FastifyInstance,
  deps: {
    repo: DraftsRepo;
    store: JudgmentsStore;
    model: ModelService;
    draftsDir: string;
    languages: Languages;
  },
): void {
  app.post<{ Body: unknown }>("/api/proposals/section", async (req, reply) => {
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    const { path, sectionId, mode, judgmentId, cloud } = parsed.data;

    const { data, body } = parseDraft((await deps.repo.read(path)).text);
    const outline = data.outline ?? [];
    const entry = outline.find((o) => o.id === sectionId);
    if (!entry) return reply.code(404).send({ error: "not_found", message: "Unknown section" });
    const section = mapSections(body, outline).find((s) => s.id === sectionId)!;
    const { ctx } = await loadDraftContext(
      deps.repo,
      deps.store,
      deps.draftsDir,
      path,
      deps.languages,
    );
    const judgment = judgmentId ? deps.store.get(judgmentId) : undefined;
    const range = section.range;

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
    });
    const send = (event: string, d: unknown) => {
      if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(d)}\n\n`);
    };
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });

    try {
      const { value } = await deps.model.run(
        (client) =>
          client.completeJson(
            Proposal,
            {
              messages: sectionMessages(ctx, {
                mode,
                title: entry.title,
                target: entry.target,
                current: range ? sectionProse(body.slice(range.from, range.to)) : undefined,
                reason: judgment?.rationale,
                before: body.slice(
                  Math.max(0, (range?.from ?? body.length) - 600),
                  range?.from ?? body.length,
                ),
                after: range ? body.slice(range.to, range.to + 400) : undefined,
              }),
              temperature: 0.6,
              maxTokens: SECTION_MAX_TOKENS,
              signal: controller.signal,
              onProgress: (p) => send("progress", p),
            },
            (error) => repairMessage(ctx.pack, error),
          ),
        { cloud, signal: controller.signal, onWait: (w) => send("progress", { phase: w }) },
      );
      send("done", { text: value.text.trim() });
    } catch (e) {
      if (!controller.signal.aborted) {
        send("error", {
          code: isModelError(e) ? e.code : "internal",
          message: (e as Error).message,
        });
      }
    } finally {
      res.end();
    }
  });

  /**
   * `POST /api/proposals/rewrite`: one to three **proposals** to rephrase a selected passage, in
   * the chosen style, streamed over SSE (`progress`, `done` with `{ alternatives }`, `error`).
   * Does not touch the file: the text changes only with "Use this".
   */
  app.post<{ Body: unknown }>("/api/proposals/rewrite", async (req, reply) => {
    const parsed = RewriteBody.safeParse(req.body);
    if (!parsed.success || parsed.data.to <= parsed.data.from) {
      return reply.code(400).send({ error: "bad_request" });
    }
    const { path, text, style, cloud } = parsed.data;
    const { body } = parseDraft((await deps.repo.read(path)).text);
    if (!body.includes(text)) {
      return reply.code(409).send({
        error: "conflict",
        message: "The selected text has changed: select it again.",
      });
    }
    const { ctx } = await loadDraftContext(
      deps.repo,
      deps.store,
      deps.draftsDir,
      path,
      deps.languages,
    );

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
    });
    const send = (event: string, d: unknown) => {
      if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(d)}\n\n`);
    };
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });

    try {
      const { value } = await deps.model.run(
        (client) =>
          client.completeJson(
            Rewrite,
            {
              messages: rewriteMessages(ctx, { style, passage: text, text: body }),
              temperature: style === "creative" ? 0.8 : 0.5,
              maxTokens: SECTION_MAX_TOKENS,
              signal: controller.signal,
              onProgress: (p) => send("progress", p),
            },
            (error) => repairMessage(ctx.pack, error),
          ),
        { cloud, signal: controller.signal, onWait: (w) => send("progress", { phase: w }) },
      );
      // No duplicates and no proposals identical to the passage: they would not be a choice.
      const alternatives = [...new Set(value.alternatives.map((a) => a.trim()))]
        .filter((a) => a !== "" && a !== text.trim())
        .slice(0, 3);
      if (alternatives.length === 0) {
        send("error", { code: "empty", message: "The model didn’t suggest any alternatives." });
      } else {
        send("done", { alternatives });
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        send("error", {
          code: isModelError(e) ? e.code : "internal",
          message: (e as Error).message,
        });
      }
    } finally {
      res.end();
    }
  });
}
