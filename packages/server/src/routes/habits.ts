import type { FastifyInstance } from "fastify";
import { habitWord, localHabits, parseDraft } from "@desk/core";
import type { DraftsRepo } from "../drafts/repo.ts";
import type { IndexDb } from "../index-db/index.ts";
import type { JudgmentsStore } from "../index-db/judgments.ts";
import type { Languages } from "../languages.ts";

/**
 * A habit: `intensifiers` (intensifying adverbs), `long-sentences`, or `word:<word>` (accepted
 * model notes on that word).
 */
export interface Habit {
  id: string;
  /** Across all drafts. */
  count: number;
  /** In how many drafts it appears. */
  drafts: number;
  /** In the requested draft (`?path=`). */
  inDraft: number;
  /** The last count of an earlier day, for the trend. */
  previous?: number;
}

/** How many times a word must come back, in total, to be a habit. */
const MIN_WORD_COUNT = 2;

/** The habits across drafts, with a history of one count per day. */
export function registerHabitRoutes(
  app: FastifyInstance,
  deps: { repo: DraftsRepo; index: IndexDb; store: JudgmentsStore; languages: Languages },
): void {
  const { repo, index, store, languages } = deps;

  app.get<{ Querystring: { path?: string } }>("/api/habits", async (req) => {
    const current = typeof req.query.path === "string" ? req.query.path : undefined;
    const totals = new Map<string, { count: number; drafts: number; inDraft: number }>();
    const add = (id: string, n: number, path: string) => {
      if (n <= 0) return;
      const t = totals.get(id) ?? { count: 0, drafts: 0, inDraft: 0 };
      t.count += n;
      t.drafts += 1;
      if (path === current) t.inDraft += n;
      totals.set(id, t);
    };
    // The words that come back: for "your habit" on the notes.
    const words = new Map<string, number>();

    for (const row of index.list()) {
      let text: string;
      try {
        text = (await repo.read(row.path)).text;
      } catch {
        continue;
      }
      const { data, body } = parseDraft(text);
      const local = localHabits(body, languages.forDraft(data.lang));
      const intens = Object.values(local.intensifiers).reduce((a, b) => a + b, 0);
      add("intensifiers", intens, row.path);
      add("long-sentences", local.longSentences, row.path);
      for (const [w, n] of Object.entries(local.intensifiers))
        words.set(w, (words.get(w) ?? 0) + n);
      const fromNotes = new Map<string, number>();
      for (const j of store.list(row.path)) {
        const w = habitWord(j);
        if (w) fromNotes.set(w, (fromNotes.get(w) ?? 0) + 1);
      }
      for (const [w, n] of fromNotes) add(`word:${w}`, n, row.path);
    }

    const habits: Habit[] = [...totals]
      .filter(([id, t]) => !id.startsWith("word:") || t.count >= MIN_WORD_COUNT)
      .map(([id, t]) => ({ id, ...t }))
      .sort((a, b) => b.count - a.count);

    // One snapshot per day; the trend is read against the last day before today.
    const day = new Date().toISOString().slice(0, 10);
    const upsert = index.db.prepare(
      "INSERT OR REPLACE INTO habit_history (day, habit, count) VALUES (?, ?, ?)",
    );
    const before = index.db.prepare(
      "SELECT count FROM habit_history WHERE habit = ? AND day < ? ORDER BY day DESC LIMIT 1",
    );
    for (const h of habits) {
      const prev = before.get(h.id, day) as { count: number } | undefined;
      if (prev) h.previous = prev.count;
      upsert.run(day, h.id, h.count);
    }

    const marked = new Set([
      ...[...words].filter(([, n]) => n >= MIN_WORD_COUNT).map(([w]) => w),
      ...habits.filter((h) => h.id.startsWith("word:")).map((h) => h.id.slice(5)),
    ]);
    return { habits, words: [...marked].sort() };
  });
}
