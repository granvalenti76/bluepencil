import { describe, expect, it } from "vitest";
import {
  defaultOutline,
  fromProposal,
  archetypeIn,
  mapSections,
  partialSections,
  skeletonBody,
  splitTarget,
  toOutline,
} from "../src/index.ts";
import { IT } from "./packs.ts";

const article = archetypeIn(IT, "article")!;

describe("outline (Structure phase)", () => {
  it("splitTarget: exact sum", () => {
    expect(splitTarget(900, [0.08, 0.14, 0.72, 0.06])).toEqual([72, 126, 648, 54]);
    const parts = splitTarget(1001, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b)).toBe(1001);
  });

  it("defaultOutline: the archetype's sections, the first without a heading in the text", () => {
    const o = defaultOutline(article, 1000);
    expect(o.map((s) => s.id)).toEqual(["lead", "context", "development", "closing"]);
    expect(o.reduce((a, s) => a + s.target, 0)).toBe(1000);
    expect(o.map((s) => s.withHeading)).toEqual([false, true, true, true]);
  });

  it("fromProposal: ids reused, unique, cleaned up", () => {
    const o = fromProposal(
      [
        { title: "Lead", target: 70, guidance: "x" },
        { title: "Perché conta", target: 100.4, guidance: "" },
        { title: "Perché conta", target: 30, guidance: "" },
      ],
      article,
    );
    expect(o.map((s) => [s.id, s.target])).toEqual([
      ["lead", 70],
      ["perche-conta", 100],
      ["perche-conta-2", 30],
    ]);
  });

  it("skeleton: H1, marker for the lead, H2 for the others; explicit mapping", () => {
    const outline = toOutline(defaultOutline(article, 900));
    const body = skeletonBody("# Titolo\n", "Titolo", outline);
    expect(body).toBe(
      "# Titolo\n\n<!-- section: lead -->\n\n## Contesto\n\n## Sviluppo\n\n## Chiusura\n",
    );
    const sections = mapSections(body, outline);
    expect(sections.every((s) => s.range !== null)).toBe(true);
    expect(sections.map((s) => s.state)).toEqual(["empty", "empty", "empty", "empty"]);
  });

  it("skeleton: text already written stays and existing boundaries are not duplicated", () => {
    const outline = toOutline(defaultOutline(article, 900));
    const body = skeletonBody("# T\n\nGià un lead.\n\n## Sviluppo\n\nTesto.\n", "T", outline);
    expect(body).toBe(
      "# T\n\nGià un lead.\n\n## Sviluppo\n\nTesto.\n\n## Contesto\n\n## Chiusura\n",
    );
    expect(skeletonBody("", "Nuovo", outline).startsWith("# Nuovo\n\n<!-- section: lead -->")).toBe(
      true,
    );
  });

  it("partialSections: only the complete objects of the partial response", () => {
    const partial =
      '{"sections": [{"title": "Lead", "target": 70, "guidance": "a {b}"}, {"title": "Con';
    expect(partialSections(partial)).toEqual([{ title: "Lead", target: 70, guidance: "a {b}" }]);
    expect(partialSections("niente")).toEqual([]);
  });
});
