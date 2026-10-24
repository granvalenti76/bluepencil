import { describe, expect, test } from "vitest";
import { countLines, countWords, parseDraft, readingMinutes, sectionState } from "../src/index.ts";
import { fixture, TURBOCODE } from "./fixture.ts";

describe("counts", () => {
  const { body } = parseDraft(fixture(TURBOCODE));

  test("Turbocode draft: 25 lines, 812 words, 4 minutes", () => {
    expect(countLines(body)).toBe(25);
    expect(countWords(body)).toBe(812);
    expect(readingMinutes(812)).toBe(4);
  });

  test("ignores markers, link URLs, footnotes and HTML comments", () => {
    const md = [
      "# Titolo del testo",
      "",
      "> Una **citazione** con [un link](https://example.com/molto/lungo) e una nota[^1].",
      "",
      "- primo elemento",
      "1. secondo elemento",
      "",
      "<!-- section: x -->Fine <!-- commento\nmultiriga --> testo.",
      "",
      "[^1]: fatti.md e altre parole",
    ].join("\n");
    // Titolo del testo (3) + Una citazione con un link e una nota (8) + primo elemento (2)
    // + secondo elemento (2) + Fine testo (2)
    expect(countWords(md)).toBe(17);
  });

  test("empty body and trailing lines", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("# \n\n")).toBe(0);
    expect(countLines("")).toBe(0);
    expect(countLines("a")).toBe(1);
    expect(countLines("a\n")).toBe(1);
    expect(countLines("a\n\nb\n")).toBe(3);
  });

  test("minimum reading time 1 minute", () => {
    expect(readingMinutes(0)).toBe(1);
    expect(readingMinutes(230)).toBe(1);
    expect(readingMinutes(231)).toBe(2);
  });

  test("section state: thresholds", () => {
    expect(sectionState(0, 70)).toBe("empty");
    expect(sectionState(19, 70)).toBe("progress");
    expect(sectionState(55, 70)).toBe("progress");
    expect(sectionState(56, 70)).toBe("on_target");
    expect(sectionState(77, 70)).toBe("on_target");
    expect(sectionState(78, 70)).toBe("over");
  });
});
