import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { builtinPack } from "./packs.ts";
import { promptCases } from "./prompt-reference.ts";

/**
 * Italian, moved into its language pack, produces the same prompts as before, byte for byte:
 * system, context, instructions, tools, versions, structure, sections, rephrasing, repair,
 * archetypes, Gulpease, source search.
 */
const reference = JSON.parse(
  readFileSync(new URL("../../../fixtures/requests/prompts-it.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

describe("Italian pack: identical to the code from before", () => {
  const cases = promptCases(builtinPack("it"));

  it("same cases", () => {
    expect(Object.keys(cases).sort()).toEqual(Object.keys(reference).sort());
  });

  for (const key of Object.keys(reference)) {
    it(key, () => {
      expect(JSON.stringify(cases[key])).toBe(JSON.stringify(reference[key]));
    });
  }
});
