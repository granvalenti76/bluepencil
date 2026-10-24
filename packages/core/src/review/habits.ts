import { sentenceLength } from "../document/readability.ts";
import type { Judgment } from "../judgments/schema.ts";
import type { LanguagePack } from "../languages/pack.ts";

/**
 * Habits that come back from one draft to the next. Two sources: local measures, without the
 * model (intensifying adverbs, long sentences), and the model's accepted notes on a single
 * word, grouped by word.
 */
export interface LocalHabits {
  /** Intensifying adverbs, by word (lowercase). */
  intensifiers: Record<string, number>;
  /** Sentences over `LONG_SENTENCE` words. */
  longSentences: number;
}

export function localHabits(body: string, pack: Pick<LanguagePack, "intensifiers">): LocalHabits {
  const list = new Set((pack.intensifiers ?? []).map((w) => w.toLowerCase()));
  const intensifiers: Record<string, number> = {};
  const text = body.replace(/<!--[\s\S]*?-->/g, " ").replace(/\[\^[^\]]*\]:?.*$/gm, " ");
  for (const raw of text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []) {
    const w = raw.toLowerCase();
    if (list.has(w)) intensifiers[w] = (intensifiers[w] ?? 0) + 1;
  }
  return { intensifiers, longSentences: sentenceLength(body).longSentences ?? 0 };
}

/**
 * The word of a habit flagged by the model: a prose or grammar note on a single word, accepted
 * or taken on (`applied`). Dismissed notes do not count: the author did not agree.
 */
export function habitWord(j: Pick<Judgment, "pass" | "status" | "anchor">): string | null {
  if (j.pass !== "prose" && j.pass !== "grammar") return null;
  if (j.status !== "applied") return null;
  const q = j.anchor.quote.trim().toLowerCase();
  return q !== "" && !/\s/.test(q) && q.length <= 30 ? q : null;
}
