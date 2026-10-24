import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildMessages,
  footnoteEdit,
  footnotesIn,
  nextFootnoteId,
  orphanDefinition,
  sourcePassages,
  sourceQuery,
} from "../src/index.ts";
import { IT } from "./packs.ts";

const FATTI = readFileSync(new URL("../../../fixtures/drafts/fatti.md", import.meta.url), "utf8");

describe("sourcePassages", () => {
  it("one list item per passage, no headings", () => {
    const p = sourcePassages(FATTI);
    expect(p).toContain("Consumo di memoria in una sessione tipica: 100–150 MB di RAM.");
    expect(p).toContain("Modello usato nei test: Qwen3.6-35B-A3B, quantizzazione Q3_XSS.");
    expect(p.some((t) => t.startsWith("#"))).toBe(false);
    expect(p).toHaveLength(5);
  });

  it("whole paragraphs; footnote definitions excluded", () => {
    const p = sourcePassages("Primo paragrafo\nsu due righe.\n\nSecondo.\n\n[^1]: fatti.md\n");
    expect(p).toEqual(["Primo paragrafo\nsu due righe.", "Secondo."]);
  });
});

describe("sourceQuery", () => {
  it("numbers, acronyms and their parts, proper nouns", () => {
    const q = sourceQuery(
      "Funziona con Qwen3.6-35B-3B e consuma tra i 100 e i 150 MB di RAM.",
      IT,
    )!;
    for (const t of [
      '"Qwen3.6-35B-3B"',
      '"Qwen3"',
      '"35B"',
      '"100"',
      '"150"',
      '"RAM"',
      '"Funziona"',
    ])
      expect(q).toContain(t);
    expect(q.split(" OR ").length).toBeGreaterThan(5);
  });

  it("nothing to search → null; doubled quotes", () => {
    expect(sourceQuery("e di la", IT)).toBeNull();
    expect(sourceQuery('Il "Desk2" va', IT)).toContain('"Desk2"');
  });
});

describe("footnotes", () => {
  const body = "Testo con cifra[^1] e altro[^2].\n\n[^1]: fatti.md\n[^2]: https://x.y\n";

  it("footnotesIn and nextFootnoteId", () => {
    expect(footnotesIn(body, "Testo con cifra[^1].")).toEqual([{ id: "1", text: "fatti.md" }]);
    expect(nextFootnoteId(body)).toBe("3");
    expect(nextFootnoteId("niente")).toBe("1");
  });

  it("footnoteEdit: reference after the quote, definition at the end", () => {
    const text = "Una frase da provare.\n";
    const at = "Una frase da provare".length;
    const e = footnoteEdit(text, at, "fatti.md");
    const out =
      text.slice(0, at) +
      e.ref.insert +
      text.slice(at, e.def.from) +
      e.def.insert +
      text.slice(e.def.to);
    expect(out).toBe("Una frase da provare[^1].\n\n[^1]: fatti.md\n");
    // After an existing definition, just a line break.
    const e2 = footnoteEdit(out, 3, IT.opinionNote);
    expect(e2.id).toBe("2");
    expect(e2.def.insert).toBe("\n[^2]: Valutazione dell'autore.\n");
  });

  it("orphanDefinition: removes the definition with no references", () => {
    expect(orphanDefinition(body, "1")).toBeNull();
    const t = "Frase.\n\n[^1]: fatti.md\n";
    const r = orphanDefinition(t, "1")!;
    expect(t.slice(0, r.from) + r.insert + t.slice(r.to)).toBe("Frase.\n");
    const t2 = "Frase.\n\n[^1]: a.md\n[^2]: b.md\n";
    const r2 = orphanDefinition(t2.replace("", ""), "1")!;
    expect(t2.slice(0, r2.from) + r2.insert + t2.slice(r2.to)).toBe("Frase.\n\n[^2]: b.md\n");
  });
});

describe("facts pass context", () => {
  it("sources and the text's footnotes in the user message, after the text", () => {
    const [, user] = buildMessages(
      "facts",
      { pack: IT, outline: [], glossary: [], style: [], ignored: [] },
      {
        text: "Consuma 100 MB[^1].",
        sources: [{ ref: "fatti.md", text: "Consumo: 100–150 MB di RAM." }],
        footnotes: [{ id: "1", text: "fatti.md" }],
      },
    );
    expect(user!.content).toContain(
      '<fonte ref="fatti.md">\nConsumo: 100–150 MB di RAM.\n</fonte>',
    );
    expect(user!.content).toContain("Note a piè di pagina del testo:\n[^1]: fatti.md");
    // The text comes first: it is the start shared by every pass (prompt cache).
    expect(user!.content.indexOf(">>>")).toBeLessThan(user!.content.indexOf("[^1]: fatti.md"));
  });
});
