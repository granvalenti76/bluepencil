import { describe, expect, test } from "vitest";
import {
  activeTraits,
  readTipsAnswer,
  readTraitsAnswer,
  appendPiece,
  styleQuote,
  isStylePath,
  measureText,
  mergeTraits,
  newStyleText,
  readAgainst,
  readStyle,
  styleRanges,
  styleTipsMessages,
  styleTraitsMessages,
  type LanguagePack,
} from "../src/index.ts";
import { builtinPack } from "./packs.ts";

describe("measures", () => {
  test("sentences with their offsets; headings, lists and comments are not prose", () => {
    const body = [
      "# Titolo",
      "",
      "L’ho tolto un martedì. Il polso era leggero!",
      "Perché? Non so.",
      "",
      "- una voce",
      "- un’altra",
      "",
      "<!-- nota. lunga. -->Una frase (con un inciso) da 12,5 euro e 80 volte",
    ].join("\n");
    const m = measureText(body);
    expect(m.sentences.map((s) => body.slice(s.from, s.to))).toEqual([
      "L’ho tolto un martedì.",
      "Il polso era leggero!",
      "Perché?",
      "Non so.",
      "Una frase (con un inciso) da 12,5 euro e 80 volte",
    ]);
    expect(m.paragraphs).toHaveLength(2);
    expect(m.measures.paragraphLength).toBe(2.5);
    expect(m.measures.lists).toBeGreaterThan(0);
    expect(m.measures.questions).toBeGreaterThan(0);
    expect(m.measures.asides).toBeGreaterThan(0);
    // «12,5» and «80»: two figures.
    expect(m.measures.numbers).toBeCloseTo((2 * 1000) / m.words, 1);
  });

  test("a blockquote keeps the offsets of the body", () => {
    const body = "> Prima riga\n> seconda riga. Poi.";
    expect(measureText(body).sentences.map((s) => body.slice(s.from, s.to))).toEqual([
      "Prima riga\n> seconda riga.",
      "Poi.",
    ]);
  });
});

const SHORT = "Alle sei il bar era aperto. Il furgone no. È arrivato tardi.";
const piece = (n: number) => Array.from({ length: n }, () => SHORT).join(" ");
const STYLE = [
  "---",
  "title: Cronaca asciutta",
  "author: vari",
  "source: articoli",
  "lang: it",
  "tags: [cronaca, frasi brevi]",
  "traits:",
  "  - text: Apre su un dettaglio.",
  "    quote: Alle sei il bar era aperto.",
  "    state: fixed",
  "  - Frasi corte.",
  "  - text: Ironia.",
  "    state: off",
  "---",
  "# Cronaca asciutta",
  "",
  "## Articolo, marzo",
  "",
  `${piece(10)}\n\n${piece(10)}`,
  "",
  "## Articolo, aprile",
  "",
  "<!-- un commento -->",
  `${piece(10)}\n\n${piece(10)}`,
  "",
].join("\n");

describe("style files", () => {
  test("labels, pieces by heading, traits in any form", () => {
    const s = readStyle(STYLE);
    expect(s).toMatchObject({
      name: "Cronaca asciutta",
      author: "vari",
      source: "articoli",
      lang: "it",
      tags: ["cronaca", "frasi brevi"],
    });
    expect(s.pieces.map((p) => p.title)).toEqual(["Articolo, marzo", "Articolo, aprile"]);
    expect(s.pieces[1]!.text.startsWith("Alle sei")).toBe(true);
    expect(s.words).toBe(4 * 10 * 12);
    expect(s.traits.map((t) => t.state ?? "active")).toEqual(["fixed", "active", "off"]);
    expect(activeTraits(s).map((t) => t.text)).toEqual(["Apre su un dettaglio.", "Frasi corte."]);
  });

  test("a new style reads back with its name and no pieces yet", () => {
    const s = readStyle(newStyleText({ name: "Saggio che racconta", lang: "it" }));
    expect(s.name).toBe("Saggio che racconta");
    expect(s.pieces).toEqual([]);
    expect(isStylePath("Styles/saggio.md")).toBe(true);
    expect(isStylePath("saggio.md")).toBe(false);
  });

  test("the model's traits replace the active ones; fixed and set aside stay", () => {
    const merged = mergeTraits(readStyle(STYLE).traits, [
      { text: "Numeri esatti.", quote: "alle sei" },
      { text: "ironia." },
    ]);
    expect(merged).toEqual([
      { text: "Apre su un dettaglio.", quote: "Alle sei il bar era aperto.", state: "fixed" },
      { text: "Ironia.", state: "off" },
      { text: "Numeri esatti.", quote: "alle sei" },
    ]);
  });
});

describe("making a style", () => {
  test("labels and pasted pieces become the file; a piece is added at the end", () => {
    const text = newStyleText(
      { name: "Cronaca", author: "vari", source: "giornali", lang: "it", tags: ["breve"] },
      [{ title: "Articolo, marzo", text: `  ${SHORT}  ` }, { text: "" }, { text: SHORT }],
    );
    const s = readStyle(text);
    expect(s).toMatchObject({
      name: "Cronaca",
      author: "vari",
      source: "giornali",
      tags: ["breve"],
    });
    expect(s.pieces.map((p) => p.title)).toEqual(["Articolo, marzo", "Piece 2"]);
    const more = readStyle(appendPiece(text, { title: "## Da un libro\n", text: SHORT }));
    expect(more.pieces.map((p) => p.title)).toEqual(["Articolo, marzo", "Piece 2", "Da un libro"]);
    expect(styleQuote(more)).toBe("Alle sei il bar era aperto.");
    expect(styleQuote(readStyle(STYLE))).toBe("Alle sei il bar era aperto.");
  });
});

describe("ranges and reading", () => {
  test("windows of whole paragraphs; a long, wordy draft is out of range", () => {
    const ranges = styleRanges(readStyle(STYLE));
    expect(ranges.sentenceLength.lo).toBeGreaterThan(3);
    expect(ranges.sentenceLength.hi).toBeLessThan(6);
    const wordy = Array.from(
      { length: 8 },
      () =>
        "Risulta fondamentale, al fine di comprendere il fenomeno nella sua interezza, considerare che il comportamento degli utenti incide in maniera significativa sulla qualità dell’attenzione residua.",
    ).join(" ");
    const r = readAgainst(wordy, ranges);
    expect(r.measures.find((m) => m.id === "sentenceLength")!.out).toBe("high");
    // A short draft: measured, but nothing out of range.
    expect(
      readAgainst("Una frase lunghissima che non finisce mai.", ranges).measures.every(
        (m) => !m.out,
      ),
    ).toBe(true);
  });

  test("more pieces in the same style keep the range, they do not widen it", () => {
    const one = styleRanges(readStyle(STYLE)).sentenceLength;
    const more = styleRanges({
      pieces: Array.from({ length: 6 }, () => readStyle(STYLE).pieces[0]!),
    }).sentenceLength;
    expect(more.hi - more.lo).toBeLessThanOrEqual(one.hi - one.lo + 0.01);
  });
});

describe("model messages", () => {
  const packs: LanguagePack[] = [builtinPack("it"), builtinPack("en")];
  test("traits and cues: the style is in the system message, the draft in the user one", () => {
    for (const pack of packs) {
      const s = readStyle(STYLE);
      const traits = styleTraitsMessages(pack, s)!;
      expect(traits[1]!.content).toContain("<<< 1 · Articolo, marzo");
      expect(traits[1]!.content).not.toContain("Frasi corte.");
      const tips = styleTipsMessages(pack, s, "La bozza.")!;
      expect(tips[0]!.content).toContain("2. Frasi corte.");
      expect(tips[0]!.content).not.toContain("Ironia.");
      expect(tips[1]!.content).toContain("La bozza.");
    }
    const bare = { ...packs[0]!, prompts: { ...packs[0]!.prompts, "style-tips": undefined } };
    expect(styleTipsMessages(bare, readStyle(STYLE), "x")).toBeNull();
  });
});

describe("reading the model's answers", () => {
  const traits = [{ text: "Frasi corte." }, { text: "Numeri esatti." }];
  const tip = { citazione: "molte persone", spunto: "Lo stile conta.", esempio: "undici volte" };

  test("the expected object", () => {
    const r = readTipsAnswer(
      JSON.stringify({ tratti: [{ numero: 1, seguito: true }], spunti: [tip] }),
      traits,
    );
    expect(r).toEqual({
      tips: [{ quote: "molte persone", tip: "Lo stile conta.", example: "undici volte" }],
      checks: [{ text: "Frasi corte.", followed: true }],
    });
  });

  test("a bare array of cues, two blocks, a broken object with a readable array inside", () => {
    expect(readTipsAnswer(JSON.stringify([tip]), traits)?.tips).toHaveLength(1);
    const two = [
      "```json",
      JSON.stringify([{ numero: "2", seguito: "no", citazione: "molte persone" }]),
      "```",
      "E gli spunti:",
      "```json",
      JSON.stringify([tip]),
      "```",
    ].join("\n");
    expect(readTipsAnswer(two, traits)).toEqual({
      tips: [expect.objectContaining({ quote: "molte persone" })],
      checks: [{ text: "Numeri esatti.", followed: false, quote: "molte persone" }],
    });
    const broken = `{"tratti": [{"numero": 1, "seguito": "sì"}], "spunti": [${JSON.stringify(tip)},]`;
    expect(readTipsAnswer(broken, traits)?.checks).toEqual([
      { text: "Frasi corte.", followed: true },
    ]);
  });

  test("bad items are dropped one by one; nothing readable is null", () => {
    expect(
      readTipsAnswer(JSON.stringify({ spunti: [{ spunto: "senza citazione" }, tip] }), traits)
        ?.tips,
    ).toHaveLength(1);
    expect(readTipsAnswer(JSON.stringify({ spunti: [] }), traits)).toEqual({
      tips: [],
      checks: [],
    });
    expect(readTipsAnswer("Nessuno spunto, la bozza va bene.", traits)).toBeNull();
    expect(
      readTraitsAnswer(JSON.stringify([{ tratto: "Frasi corte.", esempio: "Il furgone no." }])),
    ).toEqual([{ text: "Frasi corte.", quote: "Il furgone no." }]);
  });
});
