import { describe, expect, it } from "vitest";
import {
  extractAllJson,
  buildMessages,
  extractJson,
  fitToBudget,
  slotFor,
  splitThink,
  ThinkTracker,
  type DraftContext,
} from "../src/index.ts";
import { IT } from "./packs.ts";

describe("extractJson", () => {
  it("plain array, object, ```json block, surrounding text", () => {
    expect(extractJson("[1, 2]")).toEqual({ ok: true, value: [1, 2] });
    expect(extractJson('Ecco: {"a": "x]y"} fine')).toEqual({ ok: true, value: { a: "x]y" } });
    expect(extractJson('```json\n[{"a":1}]\n```')).toEqual({ ok: true, value: [{ a: 1 }] });
    expect(extractJson('nota [sic] poi [{"a": 2}]')).toEqual({ ok: true, value: [{ a: 2 }] });
  });
  it("readable errors", () => {
    expect(extractJson("")).toEqual({ ok: false, error: "empty response" });
    expect(extractJson("niente")).toEqual({ ok: false, error: "no JSON array or object" });
    expect(extractJson('[{"a": 1')).toEqual({ ok: false, error: "unterminated JSON" });
  });
  it("unescaped quotes inside a string (small models): repaired", () => {
    const text = '[{"spiegazione": "L\'espressione "agent harness" è rara.", "b": "x"}]';
    expect(extractJson(text)).toEqual({
      ok: true,
      value: [{ spiegazione: 'L\'espressione "agent harness" è rara.', b: "x" }],
    });
  });
});

describe("extractAllJson", () => {
  it("all the blocks, in order; inside a value already found the search stops", () => {
    const text = '[{"a": 1}, {"a": 2}]\n\n```json\n{"voto": 62}\n```';
    expect(extractAllJson(text)).toEqual([[{ a: 1 }, { a: 2 }], { voto: 62 }]);
    expect(extractAllJson('{"a": [1]}')).toEqual([{ a: [1] }]);
    expect(extractAllJson("niente")).toEqual([]);
  });
});

describe("reasoning", () => {
  it("splitThink: complete tags, closing only, never closed, missing", () => {
    expect(splitThink("<think>uno</think>\n[1]")).toEqual({ reasoning: "uno", answer: "[1]" });
    expect(splitThink("due</think>[2]")).toEqual({ reasoning: "due", answer: "[2]" });
    expect(splitThink("<think>tre")).toEqual({ reasoning: "tre", answer: "" });
    expect(splitThink(" [4] ")).toEqual({ reasoning: "", answer: "[4]" });
  });
  it("ThinkTracker recognises the tag even when split", () => {
    const t = new ThinkTracker();
    expect(["<th", "ink>", "ciao", "</th", "ink>", "[", "]"].map((d) => t.push(d))).toEqual([
      "reasoning",
      "reasoning",
      "reasoning",
      "reasoning",
      "reasoning",
      "answer",
      "answer",
    ]);
  });
});

describe("slots and budget", () => {
  it("slotFor is stable and within range", () => {
    expect(slotFor("a.md", 4)).toBe(slotFor("a.md", 4));
    for (const k of ["a", "b", "c", "d", "e"]) expect(slotFor(k, 3)).toBeLessThan(3);
    expect(slotFor("x", 0)).toBe(0);
  });

  const ctx: DraftContext = {
    title: "T",
    pack: IT,
    archetype: IT.archetypes[0],
    outline: [],
    glossary: [],
    style: [],
    ignored: Array.from({ length: 8 }, (_, i) => ({
      kind: "adverb",
      quote: `scartato ${i} `.repeat(5),
    })),
  };
  const input = {
    text: "Testo intero.",
    sources: [1, 2, 3].map((i) => ({ ref: `f${i}.md`, text: "fonte ".repeat(60) })),
  };
  const count = async (s: string) => s.length;

  it("cuts sources, then dismissed notes; never the draft's text", async () => {
    const full = buildMessages("facts", ctx, input)
      .map((m) => m.content)
      .join("\n").length;
    const r1 = await fitToBudget("facts", ctx, input, full - 100, count);
    expect(r1.trimmed).toEqual({ sources: 1, ignored: 0 });

    const r2 = await fitToBudget("facts", ctx, input, full - 1500, count);
    expect(r2.trimmed.sources).toBe(3);
    expect(r2.trimmed.ignored).toBeGreaterThan(0);

    const r3 = await fitToBudget("facts", ctx, input, 10, count);
    expect(r3.trimmed).toEqual({ sources: 3, ignored: 8 });
    expect(r3.messages[1]!.content).toContain("Testo intero.");
    expect(r3.tokens).toBeGreaterThan(10);
  });
});
