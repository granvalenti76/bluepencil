import { readFileSync } from "node:fs";
import {
  ModelJudgmentSchema,
  parseDraft,
  resolveJudgment,
  type Judgment,
  type Pass,
  PASSES,
} from "@desk/core";
import { z } from "zod";
import type { DraftsRepo } from "./drafts/repo.ts";
import type { JudgmentsStore } from "./index-db/judgments.ts";
import { ulid } from "./ulid.ts";

const SeedFile = z.object({
  draft: z.string(),
  judgments: z.array(
    ModelJudgmentSchema.extend({ pass: z.enum(PASSES), sectionId: z.string().optional() }),
  ),
});

/**
 * Fake judgments to try the interface: read as the model would give them, that is with the
 * quote, and resolved the same way. Development and tests only.
 * Does nothing if the draft already has judgments.
 */
export async function seedJudgments(
  repo: DraftsRepo,
  store: JudgmentsStore,
  file: string,
  onlyPath?: string,
): Promise<{ draft: string; inserted: number } | null> {
  const seed = SeedFile.parse(JSON.parse(readFileSync(file, "utf8")));
  const path = onlyPath ?? seed.draft;
  if (store.count(path) > 0) return { draft: path, inserted: 0 };

  let text: string;
  try {
    text = (await repo.read(path)).text;
  } catch {
    return null; // the draft is not in this folder
  }
  const { body } = parseDraft(text);
  const now = new Date().toISOString();
  let inserted = 0;
  for (const { pass, sectionId, ...mj } of seed.judgments) {
    const r = resolveJudgment(body, { from: 0, to: body.length }, mj);
    if (!r.ok) continue;
    const j: Judgment = {
      ...mj,
      id: ulid(),
      draftPath: path,
      pass: pass as Pass,
      ...(sectionId ? { sectionId } : {}),
      range: r.range,
      anchor: r.anchor,
      status: "open",
      chunkHash: "seed",
      model: "fixture",
      promptVersion: "seed",
      createdAt: now,
    };
    store.insert(j);
    inserted++;
  }
  return { draft: path, inserted };
}
