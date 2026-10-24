import { describe, expect, test } from "vitest";
import { ARCHETYPE_SKELETONS, archetypeIn } from "../src/index.ts";
import { IT } from "./packs.ts";

const ARCHETYPES = IT.archetypes;
const getArchetype = (id: string) => archetypeIn(IT, id);

describe("archetypes", () => {
  test("there are four, with shares that add up to 1", () => {
    expect(ARCHETYPES.map((a) => a.id)).toEqual(["article", "blog", "report", "docs"]);
    expect(ARCHETYPE_SKELETONS.map((a) => a.id)).toEqual(ARCHETYPES.map((a) => a.id));
    for (const a of ARCHETYPES) {
      const sum = a.defaultSections.reduce((n, s) => n + s.share, 0);
      expect(sum).toBeCloseTo(1, 10);
      expect(a.checklist.length).toBeGreaterThan(0);
      expect(a.proseRules.length).toBeGreaterThan(0);
    }
  });

  test("checks tied to a section point to existing sections", () => {
    for (const a of ARCHETYPES) {
      const ids = new Set(a.defaultSections.map((s) => s.id));
      for (const c of a.checklist) if (c.sectionId) expect(ids.has(c.sectionId)).toBe(true);
    }
  });

  test("the article has the expected sections", () => {
    const a = getArchetype("article")!;
    expect(a.defaultSections.map((s) => Math.round(s.share * a.defaultTarget))).toEqual([
      72, 126, 648, 54,
    ]);
    expect(getArchetype("undecided")).toBeUndefined();
  });
});
