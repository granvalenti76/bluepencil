import { describe, expect, it } from "vitest";
import { scoreCase, sumScores, type ModelJudgment } from "../src/index.ts";

const j = (quote: string, extra: Partial<ModelJudgment> = {}): ModelJudgment => ({
  kind: "x",
  quote,
  title: "t",
  rationale: "r",
  proposal: { action: "none", label: "" },
  ...extra,
});

const BODY = "Il gatto è molto bello. Le case sono rosse e il gatto dorme veramente tanto.";

describe("suite score", () => {
  it("prose: overlapping quotes are enough (the type is free)", () => {
    const s = scoreCase(
      "prose",
      "a.md",
      BODY,
      [
        { quote: "molto", type: "adverb" },
        { quote: "veramente", type: "adverb" },
      ],
      [
        j("è molto bello", { kind: "adverb" }), // it overlaps: it counts
        j("veramente", { kind: "repetition" }), // another name for the same problem: it counts
        j("non c'è", { kind: "adverb" }), // made-up quote
      ],
    );
    expect(s).toMatchObject({ tp: 2, fp: 0, fn: 0, discarded: 1 });
  });

  it("grammar: the quote is enough; one to one", () => {
    const s = scoreCase("grammar", "b.md", BODY, [{ quote: "case" }], [j("case"), j("case")]);
    expect(s).toMatchObject({ tp: 1, fp: 1, fn: 0 });
  });

  it("facts: outcome; structure: checklist item, ok/na do not count", () => {
    expect(
      scoreCase(
        "facts",
        "c.md",
        BODY,
        [{ quote: "gatto dorme", type: "unsourced" }],
        [j("il gatto dorme", { factStatus: "unsourced" })],
      ),
    ).toMatchObject({ tp: 1, fp: 0, fn: 0 });
    expect(
      scoreCase(
        "structure",
        "d.md",
        BODY,
        [{ quote: "", type: "has-closing" }],
        [
          j("", { checkId: "has-closing", checkStatus: "missing" }),
          j("", { checkId: "lead-answers", checkStatus: "ok" }),
          j("Il gatto", { checkId: "no-opinions", checkStatus: "warn" }),
        ],
      ),
    ).toMatchObject({ tp: 1, fp: 1, fn: 0 });
  });

  it("an expected quote that is not in the text is a suite error", () => {
    expect(() => scoreCase("grammar", "e.md", BODY, [{ quote: "cane" }], [])).toThrow(/cane/);
  });

  it("precision and recall per pass", () => {
    const sum = sumScores("prose", [
      { file: "a", tp: 3, fp: 1, fn: 2, discarded: 0, missed: [], wrong: [] },
      { file: "b", tp: 1, fp: 0, fn: 0, discarded: 2, missed: [], wrong: [] },
    ]);
    expect(sum).toMatchObject({ cases: 2, tp: 4, fp: 1, fn: 2, discarded: 2, precision: 0.8 });
    expect(sum.recall).toBeCloseTo(4 / 6);
    expect(sumScores("facts", []).precision).toBeNull();
  });
});
