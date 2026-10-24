import { describe, expect, it } from "vitest";
import { proofEdit } from "../src/index.ts";

/** The mark as it reads: [struck out → written above]. */
const show = (quote: string, replacement: string) => {
  const e = proofEdit(quote, replacement);
  return `${quote.slice(0, e.from)}[${quote.slice(e.from, e.to)}→${e.insert}]${quote.slice(e.to)}`;
};

describe("proofreader's mark", () => {
  it("strikes only the words that change, whole", () => {
    expect(show("si può integrare", "si possono integrare")).toBe("si [può→possono] integrare");
    expect(show("perchè", "perché")).toBe("[perchè→perché]");
    expect(show("un po di tempo", "un po' di tempo")).toBe("un [po→po'] di tempo");
  });

  it("punctuation and spaces", () => {
    expect(show("Turbocode,che gira", "Turbocode, che gira")).toBe("Turbocode,[→ ]che gira");
    expect(show("dice:  sì", "dice: sì")).toBe("dice: [ →]sì");
  });

  it("deleting and adding", () => {
    expect(show("molto molto bello", "molto bello")).toBe("molto [molto →]bello");
    expect(show("è bello", "è davvero bello")).toBe("è [→davvero ]bello");
    expect(show("parola", "")).toBe("[parola→]");
  });

  it("identical: no mark", () => {
    const e = proofEdit("uguale", "uguale");
    expect(e.to - e.from).toBe(0);
    expect(e.insert).toBe("");
  });
});
