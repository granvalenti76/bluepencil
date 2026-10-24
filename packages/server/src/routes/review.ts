import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { countWords, parseDraft, PASS_STATES, PASSES } from "@desk/core";
import { z } from "zod";
import type { DraftsRepo } from "../drafts/repo.ts";
import type { LettersStore } from "../index-db/letters.ts";
import type { PassesStore } from "../index-db/passes.ts";
import type { ScoresStore } from "../index-db/scores.ts";
import type { ReviewRunner } from "../review/runner.ts";

const Body = z
  .object({
    /** Note types to check (granular review); all by default. */
    types: z.array(z.enum(PASSES)).min(1).optional(),
    /** Only a passage of the body (offset in the body and text). */
    selection: z
      .object({
        from: z.number().int().min(0),
        to: z.number().int().min(0),
        text: z.string().min(1),
      })
      .refine((s) => s.to > s.from)
      .optional(),
    cloud: z.boolean().optional(),
  })
  // An unknown field (e.g. the old `passes`/`steps`) is an error, not a full review.
  .strict();

const PassBody = z.object({ pass: z.enum(PASSES), state: z.enum(PASS_STATES) }).strict();

/** Starting and cancelling the review; progress arrives via SSE. */
export function registerReviewRoutes(
  app: FastifyInstance,
  {
    repo,
    runner,
    scores,
    passes,
    letters,
  }: {
    repo: DraftsRepo;
    runner: ReviewRunner;
    scores: ScoresStore;
    passes: PassesStore;
    letters: LettersStore;
  },
): void {
  app.get("/api/review/runs", async () => ({ runs: runner.active() }));

  app.post<{ Params: { "*": string }; Body: unknown }>("/api/review/*", async (req, reply) => {
    const parsed = Body.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request", message: "Invalid request" });
    }
    const path = req.params["*"];
    await repo.resolve(path, { mustExist: true });
    return reply.code(202).send({ runId: runner.start(path, parsed.data) });
  });

  app.delete<{ Params: { runId: string } }>("/api/review/runs/:runId", async (req, reply) =>
    runner.cancel(req.params.runId)
      ? reply.code(204).send()
      : reply.code(404).send({ error: "not_found" }),
  );

  /** The model's latest scores (prose, structure) for a draft. */
  app.get<{ Params: { "*": string } }>("/api/scores/*", async (req) => {
    const path = req.params["*"];
    await repo.resolve(path, { mustExist: true });
    return { scores: scores.list(path) };
  });

  /** The editor's letters for a draft, one per pass. */
  app.get<{ Params: { "*": string } }>("/api/letters/*", async (req) => {
    const path = req.params["*"];
    await repo.resolve(path, { mustExist: true });
    return { letters: letters.list(path) };
  });

  /** The review passes of a draft: those without a state are waiting. */
  app.get<{ Params: { "*": string } }>("/api/passes/*", async (req) => {
    const path = req.params["*"];
    await repo.resolve(path, { mustExist: true });
    return { passes: passes.list(path) };
  });

  /** Closes, skips or reopens a pass, with the fingerprint of the body as it is now on disk. */
  app.put<{ Params: { "*": string }; Body: unknown }>("/api/passes/*", async (req, reply) => {
    const parsed = PassBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request", message: "Invalid request" });
    }
    const path = req.params["*"];
    await repo.resolve(path, { mustExist: true });
    const { body } = parseDraft((await repo.read(path)).text);
    passes.set(path, parsed.data.pass, parsed.data.state, {
      hash: createHash("sha256").update(body).digest("hex"),
      words: countWords(body),
    });
    return { passes: passes.list(path) };
  });

  /** Starts the review again from the first pass (the notes stay). */
  app.delete<{ Params: { "*": string } }>("/api/passes/*", async (req) => {
    const path = req.params["*"];
    await repo.resolve(path, { mustExist: true });
    passes.clear(path);
    return { passes: [] };
  });
}
