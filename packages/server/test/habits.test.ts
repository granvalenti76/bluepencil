import { afterEach, describe, expect, it } from "vitest";
import type { Habit } from "../src/routes/habits.ts";
import { cleanupAll, makeServer } from "./helpers.ts";

const TURBO = "turbocode-draft-12-settembre.md";
afterEach(cleanupAll);

describe("habits across drafts", () => {
  it("intensifying adverbs and long sentences, across all drafts and in the requested one; one snapshot per day", async () => {
    const s = await makeServer();
    const res = await s.inject({ method: "GET", url: `/api/habits?path=${TURBO}` });
    const { habits, words } = res.json() as { habits: Habit[]; words: string[] };
    const intens = habits.find((h) => h.id === "intensifiers");
    expect(intens?.inDraft).toBeGreaterThanOrEqual(1); // «completamente»
    expect(intens!.count).toBeGreaterThanOrEqual(intens!.inDraft);
    expect(habits.find((h) => h.id === "long-sentences")?.count).toBeGreaterThan(0);
    // A word is a habit if it comes back at least twice (here «molto» and «davvero», not «completamente»).
    expect(words).toContain("molto");
    expect(words).not.toContain("completamente");
    const today = s.index.db
      .prepare("SELECT count(*) AS n FROM habit_history WHERE habit = 'intensifiers'")
      .get() as { n: number };
    expect(today.n).toBe(1);
  });
});
