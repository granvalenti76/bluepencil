import { describe, expect, test } from "vitest";
import { mapSections, parseDraft, countWords, type OutlineEntry } from "../src/index.ts";
import { fixture, TURBOCODE } from "./fixture.ts";

const O = (id: string, extra: Partial<OutlineEntry> = {}): OutlineEntry => ({
  id,
  title: id,
  target: 100,
  ...extra,
});

describe("section mapping", () => {
  test("Turbocode draft: lead, heading, inline marker and missing closing", () => {
    const d = parseDraft(fixture(TURBOCODE));
    const s = mapSections(d.body, d.data.outline!);
    const by = Object.fromEntries(s.map((x) => [x.id, x]));

    expect(by.lead?.words).toBe(19);
    expect(by.lead?.state).toBe("progress");
    expect(d.body.slice(by.lead!.range!.from, by.lead!.range!.to)).toContain("fallback cloud.");
    expect(d.body.slice(by.lead!.range!.from, by.lead!.range!.to)).not.toContain("# Turbocode");

    expect(d.body.slice(by.context!.range!.from).startsWith("## Cosa è Turbocode")).toBe(true);
    expect(by.development?.state).toBe("over");
    expect(
      d.body.slice(by.development!.range!.from).startsWith("<!-- section: development -->"),
    ).toBe(true);

    expect(by.closing).toMatchObject({ range: null, words: 0, isEmpty: true, state: "empty" });

    // H1 (2 words) + sections = draft total
    expect(2 + s.reduce((n, x) => n + x.words, 0)).toBe(countWords(d.body));
    expect(s.map((x) => x.range && x.range.to)).toEqual([
      by.context!.range!.from,
      by.development!.range!.from,
      d.body.length,
      null,
    ]);
  });

  test("the marker wins over the heading", () => {
    const body =
      "# T\n\nlead\n\n## Contesto\n\nuno due\n\n<!-- section: ctx -->\n\ntre quattro cinque\n";
    const [lead, ctx] = mapSections(body, [O("lead"), O("ctx", { heading: "Contesto" })]);
    expect(body.slice(ctx!.range!.from, ctx!.range!.from + 12)).toBe("<!-- section");
    expect(ctx!.words).toBe(3);
    // the heading's text falls into the lead, because the section starts after it
    expect(lead!.words).toBe(1 + 1 + 2);
  });

  test("without a boundary a section is «to write»; with only the heading it is empty", () => {
    const body = "# T\n\nlead qui\n\n## Chiusura\n";
    const s = mapSections(body, [O("lead"), O("closing", { heading: "Chiusura" }), O("extra")]);
    expect(s[0]).toMatchObject({ words: 2, isEmpty: false });
    expect(s[1]).toMatchObject({ words: 1, isEmpty: true, state: "empty" });
    expect(s[2]).toMatchObject({ range: null, isEmpty: true });
  });

  test("without an H1 the lead starts at the beginning of the body", () => {
    const [lead] = mapSections("solo testo\n\n## Altro\n", [
      O("lead"),
      O("x", { heading: "Altro" }),
    ]);
    expect(lead).toMatchObject({ range: { from: 0 }, words: 2 });
  });

  test("ignores headings and markers inside code blocks", () => {
    const body = "# T\n\nlead\n\n```\n## Contesto\n<!-- section: ctx -->\n```\n";
    const s = mapSections(body, [O("lead"), O("ctx", { heading: "Contesto" })]);
    expect(s[1]!.range).toBeNull();
  });

  test("sections out of order in the outline follow the order in the text", () => {
    const body = "# T\n\nlead\n\n## B\n\nb b\n\n## A\n\na a a\n";
    const s = mapSections(body, [O("lead"), O("a", { heading: "A" }), O("b", { heading: "B" })]);
    expect(s.map((x) => x.words)).toEqual([1, 4, 3]);
  });
});
