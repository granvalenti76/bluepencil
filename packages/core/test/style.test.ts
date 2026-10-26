import { describe, expect, test } from "vitest";
import {
  activeTraits,
  appendPiece,
  compareWithStyle,
  isStylePath,
  measureText,
  mergeTraits,
  newStyleText,
  readStyle,
  readTraitsAnswer,
  styleQuote,
  styleSchema,
  styleSummary,
  styleTraitsMessages,
  traitsForFile,
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

  test("with the language's words: openers, first person, adverbs, connectives, tenses", () => {
    const it = builtinPack("it");
    const body = [
      "Il sabato andavamo al mercato. Poi mio padre comprava lentamente le pesche.",
      "",
      "— Inoltre pagava sempre lui, disse. Ieri piovve.",
    ].join("\n");
    const m = measureText(body, it);
    expect(m.sentences.map((s) => s.opens)).toEqual([
      "subject",
      "conjunction",
      "conjunction",
      "setting",
    ]);
    expect(m.adverbs.map((a) => a.word)).toEqual(["lentamente"]);
    expect(m.connectives.map((c) => [c.word, c.para])).toEqual([
      ["poi", 0],
      ["inoltre", 1],
    ]);
    expect(m.measures.firstPerson).toBe(25);
    expect(m.measures.dialogue).toBe(50);
    // "andavamo", "comprava", "pagava": imperfetto; "piovve" is irregular, "disse" too.
    expect(m.measures.tense0).toBeCloseTo((3 * 1000) / m.words, 1);
    // Without the pack those measures are not there.
    expect(measureText(body).measures.adverbs).toBeUndefined();
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

  test("the model's sentences replace the proposed ones; kept and set aside stay", () => {
    const merged = mergeTraits(readStyle(STYLE).traits, [
      { text: "Numeri esatti.", dim: "lexicon" },
      { text: "ironia.", dim: "voice" },
    ]);
    expect(merged).toEqual([
      { text: "Apre su un dettaglio.", quote: "Alle sei il bar era aperto.", state: "fixed" },
      { text: "Ironia.", state: "off" },
      { text: "Numeri esatti.", dim: "lexicon" },
    ]);
    // A dimension the author kept gets no new sentence.
    const kept = mergeTraits(
      [{ text: "Frasi corte.", dim: "rhythm", state: "fixed" }],
      [
        { text: "Frasi lunghe.", dim: "rhythm" },
        { text: "Tutto in breve.", dim: "summary" },
      ],
    );
    expect(traitsForFile(kept)).toEqual([
      { text: "Frasi corte.", dim: "rhythm", state: "fixed" },
      { text: "Tutto in breve.", dim: "summary" },
    ]);
    expect(styleSummary({ traits: kept })).toBe("Tutto in breve.");
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

// A style that moves: long sentences closed by a short one, linked with "poi" and "ma".
const MOVING = [
  "Mio padre tornava la sera dal lavoro con la giacca sulle spalle e il giornale piegato sotto il braccio, e si sedeva in cucina senza dire niente a nessuno. Poi mangiava. Ma la luce restava accesa fino a tardi, perché mia madre cuciva vicino alla finestra e ascoltava la radio a basso volume. Io dormivo.",
  "D’estate la casa si riempiva di parenti che arrivavano dalla campagna con le valigie legate con lo spago e le ceste di frutta ancora calda di sole. Poi ripartivano. Ma per una settimana nessuno parlava d’altro che dei loro bambini, delle loro galline, del raccolto che quell’anno sarebbe stato buono. Io ascoltavo.",
].join("\n\n");
const MOVING_STYLE = `---\ntitle: Memoria\nlang: it\n---\n## Uno\n\n${Array.from({ length: 4 }, () => MOVING).join("\n\n")}\n`;

// The draft of the mockup: a flat third paragraph, adverbs in the second, "inoltre" and "pertanto".
const MARKET = [
  "Il sabato mattina mio padre mi portava al mercato di piazza Vittorio. Partivamo presto, quando le serrande erano ancora abbassate e i furgoni scaricavano casse di arance sul selciato bagnato. Io camminavo dietro di lui. Lui non si voltava mai.",
  "Il mercato si apriva lentamente, quasi con fatica. I banchi venivano montati velocemente dagli stessi uomini che, evidentemente, li smontavano ogni sera. Mio padre salutava tutti cordialmente, ma comprava sempre e soltanto dal vecchio Ettore, che probabilmente lo imbrogliava sul peso.",
  "Ettore teneva le zucchine in cassette di legno allineate con cura sul fondo del banco. Inoltre aveva sempre una radio accesa che trasmetteva canzoni di vent’anni prima a basso volume. Mio padre si fermava davanti alla frutta e la guardava a lungo senza toccarla mai. Pertanto io restavo in piedi accanto a lui e contavo le mosche sopra le pesche. Ettore alla fine gli porgeva un sacchetto già pronto senza chiedergli che cosa volesse. Inoltre mio padre pagava con monete contate una per una sul palmo della mano aperta.",
  "Tornando a casa, con le borse che gli segavano le dita, diceva sempre la stessa cosa: che il mercato non era più quello di una volta. Io annuivo. Non sapevo com’era, una volta.",
].join("\n\n");

describe("the schema of a style", () => {
  const it = builtinPack("it");

  test("ranges by windows, the rhythm, the words that come back, the connectives", () => {
    const schema = styleSchema(readStyle(MOVING_STYLE), it);
    expect(schema.defs.map((d) => d.dim)).toEqual(
      expect.arrayContaining(["rhythm", "lexicon", "construction", "voice"]),
    );
    expect(schema.ranges.shortSentences!.all).toBe(50);
    expect(schema.ranges.shortAfterLong!.all).toBe(100);
    expect(schema.ranges.adverbs).toEqual({ lo: 0, hi: 0, all: 0 });
    expect(schema.rhythm.slice(0, 4)).toEqual([29, 2, 22, 2]);
    expect(schema.connectives.map((c) => c.word)).toEqual(["ma", "poi"]);
    expect(schema.unused).toContain("però");
    expect(schema.recurring.length).toBeGreaterThan(0);
    expect(schema.openers!.conjunction).toBe(50);
  });

  test("windows of whole paragraphs: more pieces in the same style do not widen the range", () => {
    const one = styleSchema(readStyle(STYLE)).ranges.sentenceLength!;
    expect(one.lo).toBeGreaterThan(3);
    expect(one.hi).toBeLessThan(6);
    const more = styleSchema({
      pieces: Array.from({ length: 6 }, () => readStyle(STYLE).pieces[0]!),
    }).ranges.sentenceLength!;
    expect(more.hi - more.lo).toBeLessThanOrEqual(one.hi - one.lo + 0.01);
  });
});

describe("a draft beside the style", () => {
  const it = builtinPack("it");
  const schema = styleSchema(readStyle(MOVING_STYLE), it);

  test("cues by pattern and paragraph, never a quote of the style", () => {
    const c = compareWithStyle(MARKET, schema, it);
    const byId = (p: string) => c.cues.find((x) => x.id.startsWith(p));
    expect(byId("flat:")).toMatchObject({ dim: "rhythm", paragraphs: [3] });
    expect(byId("flat:")!.text).toMatch(
      /^Flat rhythm: 6 sentences in a row between 14 and 15 words/,
    );
    expect(byId("adverbs:")).toMatchObject({ dim: "lexicon", paragraphs: [2] });
    expect(byId("adverbs:")!.words).toHaveLength(5);
    expect(byId("connectives:")!.text).toMatch(
      /^“inoltre” twice, “pertanto” once: the style never uses them; it links with “ma”, “poi”\./,
    );
    expect(byId("connectives:")!.paragraphs).toEqual([3]);
    // The paragraph cues come first, in the order of the text; nothing quotes the pieces.
    expect(c.cues.indexOf(byId("adverbs:")!)).toBeLessThan(c.cues.indexOf(byId("flat:")!));
    for (const cue of c.cues) expect(MOVING).not.toContain(cue.text.slice(0, 30));
    // A measure a paragraph cue already speaks of is not repeated for the whole draft.
    expect(c.cues.some((x) => x.id.startsWith("measure:adverbs"))).toBe(false);
  });

  test("the same text as the style: in line, no cues", () => {
    const c = compareWithStyle(`${MOVING}\n\n${MOVING}`, schema, it);
    expect(c.cues).toEqual([]);
    expect(c.inLine).toEqual(["rhythm", "lexicon", "construction", "voice"]);
  });

  test("a short draft: measured, but nothing is out of range", () => {
    const c = compareWithStyle("Una frase lunghissima che non finisce mai.", schema, it);
    expect(c.measures.every((m) => !m.out)).toBe(true);
    expect(c.inLine).toEqual([]);
  });
});

describe("model messages", () => {
  const packs: LanguagePack[] = [builtinPack("it"), builtinPack("en")];
  test("the model reads the schema's numbers, not the pieces", () => {
    for (const pack of packs) {
      const s = readStyle(MOVING_STYLE);
      const m = styleTraitsMessages(pack, s)!;
      expect(m[0]!.content).toContain('"ritmo"');
      expect(m[1]!.content).toContain("RHYTHM");
      expect(m[1]!.content).toContain("Words per sentence:");
      expect(m[1]!.content).not.toContain("Mio padre tornava");
    }
    const it = styleTraitsMessages(packs[0]!, readStyle(MOVING_STYLE))![1]!.content;
    expect(it).toContain("- Connectives: ma ×8, poi ×8");
    expect(it).not.toMatch(/Words that come back:.*\b(loro|alla|nessuno)\b/);
    const bare = { ...packs[0]!, prompts: { ...packs[0]!.prompts, "style-traits": undefined } };
    expect(styleTraitsMessages(bare, readStyle(STYLE))).toBeNull();
  });
});

describe("reading the model's answer", () => {
  test("one sentence per dimension; empty ones left out; English keys too", () => {
    expect(
      readTraitsAnswer(
        "Ecco:\n```json\n" +
          JSON.stringify({
            sintesi: "Memoria.",
            ritmo: "Lunghe e brevi.",
            voce: "",
            lessico: null,
          }) +
          "\n```",
      ),
    ).toEqual([
      { text: "Memoria.", dim: "summary" },
      { text: "Lunghe e brevi.", dim: "rhythm" },
    ]);
    expect(readTraitsAnswer(JSON.stringify({ voice: "First person." }))).toEqual([
      { text: "First person.", dim: "voice" },
    ]);
    expect(readTraitsAnswer("Lo stile è sobrio.")).toBeNull();
    expect(readTraitsAnswer(JSON.stringify({ altro: "x" }))).toBeNull();
  });
});
