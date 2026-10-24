import { describe, expect, test } from "vitest";
import {
  relocateAnchor,
  relocateApplied,
  resolveJudgment,
  type ModelJudgment,
} from "../src/index.ts";

const mj = (quote: string): ModelJudgment => ({
  kind: "x",
  quote,
  title: "t",
  rationale: "r",
  proposal: { action: "none", label: "" },
});

const BODY = "Prima frase con parola. Seconda frase con parola. Terza frase con parola.\n";

function anchorOf(body: string, quote: string, nth = 0) {
  let from = -1;
  for (let i = 0; i <= nth; i++) from = body.indexOf(quote, from + 1);
  const r = resolveJudgment(body, { from, to: from + quote.length }, mj(quote));
  if (!r.ok || !r.range) throw new Error("anchor not created");
  return { anchor: r.anchor, range: r.range };
}

describe("relocateAnchor", () => {
  test("same text: same position", () => {
    const { anchor, range } = anchorOf(BODY, "Seconda frase");
    expect(relocateAnchor(BODY, anchor, range.from)).toEqual(range);
  });

  test("after insertions before it, the position shifts", () => {
    const { anchor, range } = anchorOf(BODY, "Seconda frase");
    const next = "NUOVO INIZIO. " + BODY;
    const r = relocateAnchor(next, anchor, range.from)!;
    expect(next.slice(r.from, r.to)).toBe("Seconda frase");
    expect(r.from).toBe(range.from + 14);
  });

  test("with several occurrences, the one with the right context wins", () => {
    const { anchor, range } = anchorOf(BODY, "parola", 1); // the second one
    const next = "Altro testo con parola. " + BODY;
    const r = relocateAnchor(next, anchor, range.from)!;
    expect(r.from).toBe(next.indexOf("Seconda frase con parola") + "Seconda frase con ".length);
  });

  test("with several occurrences and little shared context, it does not guess", () => {
    const { anchor } = anchorOf("a-parola-b-parola-c", "parola", 1);
    expect(relocateAnchor("x/parola/y/parola/z", anchor, 0)).toBeNull();
  });

  test("a single occurrence is found even if the context has changed", () => {
    const { anchor } = anchorOf(BODY, "Seconda frase");
    expect(relocateAnchor("Tutto diverso: Seconda frase, e basta.", anchor, 0)).toEqual({
      from: 15,
      to: 28,
    });
  });

  test("quote gone, changed or empty → null", () => {
    const { anchor } = anchorOf(BODY, "Seconda frase");
    expect(relocateAnchor(BODY.replace("Seconda", "Secondo"), anchor, 0)).toBeNull();
    expect(relocateAnchor(BODY, { quote: "", prefix: "", suffix: "" }, 0)).toBeNull();
  });
});

describe("relocateApplied", () => {
  const body = "Un testo con proposta applicata qui dentro e altro.";
  const applied = {
    from: 13,
    to: 31,
    original: "vecchio",
    replacement: "proposta applicata",
    before: "Un testo con ",
    after: " qui dentro e altro.",
  };

  test("finds the replacement by its context", () => {
    expect(relocateApplied("PRIMA " + body, applied)).toEqual({ from: 19, to: 37 });
  });

  test("deletion: empty range at the right spot", () => {
    const del = {
      from: 3,
      to: 3,
      original: "xxx ",
      replacement: "",
      before: "Un ",
      after: "testo.",
    };
    expect(relocateApplied("Un testo.", del)).toEqual({ from: 3, to: 3 });
  });

  test("changed text: null", () => {
    expect(relocateApplied(body.replace("applicata", "ritoccata"), applied)).toBeNull();
  });

  test("without saved context, the position is checked", () => {
    expect(
      relocateApplied(body, { from: 13, to: 31, original: "v", replacement: "proposta applicata" }),
    ).toEqual({ from: 13, to: 31 });
    expect(
      relocateApplied("tutto diverso qui", {
        from: 13,
        to: 31,
        original: "v",
        replacement: "proposta applicata",
      }),
    ).toBeNull();
  });
});
