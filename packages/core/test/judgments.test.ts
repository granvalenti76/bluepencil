import { describe, expect, it, test } from "vitest";
import {
  JudgmentSchema,
  ModelJudgmentSchema,
  resolveJudgment,
  resolveQuote,
  type ModelJudgment,
} from "../src/index.ts";

const J = (quote: string, over: Partial<ModelJudgment["proposal"]> = {}): ModelJudgment => ({
  kind: "repetition",
  quote,
  title: "Ripetizione",
  rationale: "…",
  proposal: { action: "replace", text: "altro", label: "Applica", ...over },
});

const TEXT =
  "Per lavori più complessi si può integrare modelli cloud. Funziona con «llama-server» e l’uso resta “contenuto”.";

describe("judgment schema", () => {
  test("accepts a valid judgment, even with a long title; rejects unknown actions", () => {
    expect(ModelJudgmentSchema.safeParse(J("x")).success).toBe(true);
    expect(ModelJudgmentSchema.safeParse({ ...J("x"), title: "a".repeat(200) }).success).toBe(true);
    expect(
      ModelJudgmentSchema.safeParse({ ...J("x"), proposal: { action: "boh", label: "x" } }).success,
    ).toBe(false);
  });

  test("the stored judgment adds identity, state and range", () => {
    const stored = {
      ...J("x"),
      id: "01J",
      draftPath: "a.md",
      pass: "grammar",
      range: null,
      anchor: { quote: "", prefix: "", suffix: "" },
      status: "open",
      chunkHash: "h",
      model: "m",
      promptVersion: "1",
      createdAt: "2026-10-02T00:00:00Z",
    };
    expect(JudgmentSchema.safeParse(stored).success).toBe(true);
    expect(JudgmentSchema.safeParse({ ...stored, status: "boh" }).success).toBe(false);
  });
});

describe("quote resolution", () => {
  test("exact", () => {
    const r = resolveQuote(TEXT, "si può integrare");
    expect(TEXT.slice(r!.from, r!.to)).toBe("si può integrare");
  });

  test("different whitespace", () => {
    const r = resolveQuote("una  frase\n  con spazi", "frase con spazi");
    expect("una  frase\n  con spazi".slice(r!.from, r!.to)).toBe("frase\n  con spazi");
  });

  test("typographic quotes, in both directions", () => {
    const a = resolveQuote(TEXT, 'l\'uso resta "contenuto"');
    expect(TEXT.slice(a!.from, a!.to)).toBe("l’uso resta “contenuto”");
    const b = resolveQuote('l\'uso è "molto" utile', "l’uso è “molto” utile");
    expect(b).toEqual({ from: 0, to: 21 });
  });

  test("approximate: small difference found, different text discarded", () => {
    const r = resolveQuote(TEXT, "Per lavori più complessi si puo integrare modelli cloud");
    expect(r).not.toBeNull();
    expect(TEXT.slice(r!.from, r!.to)).toContain("integrare modelli cloud");
    expect(resolveQuote(TEXT, "Una frase che nel testo non esiste affatto")).toBeNull();
  });

  test("short quotes get no approximate match", () => {
    expect(resolveQuote(TEXT, "complessa")).toBeNull();
  });

  test("missing or empty", () => {
    expect(resolveQuote(TEXT, "non c'è")).toBeNull();
    expect(resolveQuote(TEXT, "   ")).toBeNull();
  });
});

describe("resolveJudgment", () => {
  const body =
    "# Titolo\n\nPrimo paragrafo con completamente troppo.\n\nSecondo paragrafo con completamente altro.\n";
  const second = { from: body.indexOf("Secondo"), to: body.length };

  test("searches only the checked block and returns body offsets with the anchor", () => {
    const r = resolveJudgment(
      body,
      second,
      J("completamente", { action: "delete", text: undefined }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok || !r.range) throw new Error();
    expect(r.range.from).toBeGreaterThan(second.from);
    expect(body.slice(r.range.from, r.range.to)).toBe("completamente");
    expect(r.anchor.quote).toBe("completamente");
    expect(r.anchor.prefix).toHaveLength(32);
    expect(r.anchor.prefix.endsWith("Secondo paragrafo con ")).toBe(true);
    expect(r.anchor.suffix).toBe(" altro.\n");
  });

  test("missing quote: discarded", () => {
    expect(resolveJudgment(body, second, J("troppo"))).toEqual({
      ok: false,
      reason: "quote_not_found",
    });
  });

  test("replace identical to the quote: discarded", () => {
    expect(resolveJudgment(body, second, J("completamente", { text: "completamente" }))).toEqual({
      ok: false,
      reason: "noop_replace",
    });
  });

  test("empty quote: section note without a range", () => {
    expect(resolveJudgment(body, second, J("", { action: "draft_section" }))).toEqual({
      ok: true,
      range: null,
      anchor: { quote: "", prefix: "", suffix: "" },
    });
  });
});

describe("responses with null (real models)", () => {
  it('`"text": null` and the like count as missing fields', async () => {
    const { ModelJudgmentsSchema } = await import("../src/index.ts");
    const r = ModelJudgmentsSchema.safeParse([
      {
        kind: "x",
        quote: "q",
        title: "t",
        rationale: "r",
        proposal: { action: "none", text: null, label: "Ok" },
        factStatus: null,
        checkId: "[lead-answers]",
        checkStatus: "ok",
      },
    ]);
    expect(r.data?.[0]?.checkId).toBe("lead-answers");
    expect(r.success).toBe(true);
    expect(r.data![0]!.proposal).toEqual({ action: "none", label: "Ok" });
    expect("factStatus" in r.data![0]!).toBe(false);
    expect(ModelJudgmentsSchema.safeParse([{ kind: "x", quote: null }]).success).toBe(false);
  });
});
