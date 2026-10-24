import type { FastifyInstance } from "fastify";
import {
  JUDGMENT_STATUSES,
  JudgmentSchema,
  parseDraft,
  relocateAnchor,
  relocateApplied,
  type Judgment,
} from "@desk/core";
import { z } from "zod";
import type { DraftsRepo } from "../drafts/repo.ts";
import type { JudgmentsStore } from "../index-db/judgments.ts";
import { seedJudgments } from "../judgments-seed.ts";

interface Deps {
  repo: DraftsRepo;
  store: JudgmentsStore;
  /** Development and tests only: file with fake judgments. */
  seedFile?: string;
}

/**
 * Maps a judgment to the current text. Saved positions may be old (the text changed later): the
 * quote is found again from the anchor; if it is no longer there, the judgment is `stale`.
 * An "Apply" that never reached the disk (the page closed before saving) goes back to `open`.
 */
export function refreshJudgment(body: string, j: Judgment): Judgment {
  if (j.range === null || j.status === "stale") return j;

  if (j.status === "applied" && j.applied) {
    const r = relocateApplied(body, j.applied);
    if (r) return sameRange(j.range, r) ? j : { ...j, range: r };
    const original = relocateAnchor(body, j.anchor, j.range.from);
    if (original) {
      const reverted: Judgment = { ...j, status: "open", range: original };
      delete reverted.applied;
      return reverted;
    }
    return j; // can no longer be undone: it stays "applied" where it was
  }

  if (body.slice(j.range.from, j.range.to) === j.anchor.quote) return j;
  const found = relocateAnchor(body, j.anchor, j.range.from);
  return found ? { ...j, range: found } : { ...j, status: "stale" };
}

const sameRange = (a: { from: number; to: number }, b: { from: number; to: number }) =>
  a.from === b.from && a.to === b.to;

const Patch = z.object({
  status: z.enum(JUDGMENT_STATUSES),
  applied: JudgmentSchema.shape.applied,
  range: z.object({ from: z.number(), to: z.number() }).nullable().optional(),
  /** New anchor: the judgment's text changed because of an action on the notes (e.g. "Apply" inside it). */
  anchor: JudgmentSchema.shape.anchor.optional(),
});

export function registerJudgmentRoutes(
  app: FastifyInstance,
  { repo, store, seedFile }: Deps,
): void {
  // The draft's path arrives encoded (%2F) in a single segment.
  app.get<{ Params: { path: string } }>("/api/drafts/:path/judgments", async (req) => {
    const path = req.params.path;
    const { body } = parseDraft((await repo.read(path)).text);

    const out: Judgment[] = [];
    for (const stored of store.list(path)) {
      const current = refreshJudgment(body, stored);
      if (current !== stored) store.update(current);
      if (current.status !== "stale") out.push(current);
    }
    return { judgments: out };
  });

  /** "Clear suggestions": removes all the draft's notes (the text does not change). */
  app.delete<{ Params: { path: string } }>("/api/drafts/:path/judgments", async (req) => {
    const path = req.params.path;
    await repo.resolve(path, { mustExist: true });
    return { removed: store.clear(path) };
  });

  app.patch<{ Params: { id: string }; Body: unknown }>("/api/judgments/:id", async (req, reply) => {
    const parsed = Patch.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request", message: "Invalid request" });
    }
    const j = store.get(req.params.id);
    if (!j) return reply.code(404).send({ error: "not_found" });

    const { status, applied, range, anchor } = parsed.data;
    const next: Judgment = { ...j, status };
    if (range !== undefined) next.range = range;
    if (anchor) next.anchor = anchor;
    if (applied) next.applied = applied;
    else delete next.applied;
    store.update(next);
    return next;
  });

  if (seedFile) {
    app.post<{ Body: { path?: unknown } }>("/api/dev/seed-judgments", async (req, reply) => {
      const path = req.body?.path;
      if (typeof path !== "string") return reply.code(400).send({ error: "bad_request" });
      await repo.resolve(path, { mustExist: true });
      const res = await seedJudgments(repo, store, seedFile, path);
      return res ?? reply.code(404).send({ error: "not_found" });
    });
  }
}
