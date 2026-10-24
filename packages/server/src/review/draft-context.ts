import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { archetypeIn, MAX_IGNORED, parseDraft, type DraftContext } from "@desk/core";
import { INDEX_DIR, type DraftsRepo } from "../drafts/repo.ts";
import type { JudgmentsStore } from "../index-db/judgments.ts";
import type { Languages } from "../languages.ts";

/** `<draftsDir>/.bluepencil/style.md`: one rule per line, for every draft. */
export async function readCommonStyle(draftsDir: string): Promise<string[]> {
  let text: string;
  try {
    text = await readFile(join(draftsDir, INDEX_DIR, "style.md"), "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
    .filter((l) => l !== "" && !l.startsWith("#") && !l.startsWith("<!--"));
}

/**
 * Gathers the data for a draft's session context. To be called when a review starts and then
 * kept fixed: the list of dismissed notes is not updated meanwhile.
 */
export async function loadDraftContext(
  repo: DraftsRepo,
  store: JudgmentsStore,
  draftsDir: string,
  path: string,
  languages: Languages,
): Promise<{ ctx: DraftContext; body: string }> {
  const { data, body } = parseDraft((await repo.read(path)).text);
  const pack = languages.forDraft(data.lang);
  const ctx: DraftContext = {
    pack,
    title: data.title,
    archetype: archetypeIn(pack, data.archetype),
    target: data.target,
    outline: data.outline ?? [],
    brief: data.brief,
    glossary: data.glossary ?? [],
    style: [...(await readCommonStyle(draftsDir)), ...(data.style ?? [])],
    ignored: store
      .listIgnored(path, MAX_IGNORED)
      .filter((j) => j.quote.trim() !== "")
      .map((j) => ({ kind: j.kind, quote: j.quote })),
  };
  return { ctx, body };
}
