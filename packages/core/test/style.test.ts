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
  locatePassages,
  mergeRead,
  pieceSentences,
  proceduresForFile,
  readProceduresAnswer,
  readReadingAnswer,
  renderPieces,
  styleProceduresMessages,
  styleQuote,
  styleReadingMessages,
  styleSchema,
  styleSummary,
  traitsForFile,
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
    // Every paragraph closes on a short sentence ("Io dormivo.", "Io ascoltavo.").
    expect(schema.lastShort).toBe(100);
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

describe("the procedures of a style", () => {
  const it = builtinPack("it");
  const style = readStyle(MOVING_STYLE);
  const sentences = pieceSentences(style, it);

  test("the model reads the pieces whole, every sentence numbered, paragraph by paragraph", () => {
    expect(sentences[1]).toEqual({ n: 2, piece: 0, para: 0, text: "Poi mangiava." });
    const shown = renderPieces(style, sentences);
    expect(shown).toContain("PIECE 1 — Uno");
    expect(shown).toMatch(/^¶1 \[1\] Mio padre tornava .* \[2\] Poi mangiava\. \[3\] Ma la luce/m);
    expect(shown).toMatch(/^¶2 \[5\] D’estate/m);
    for (const pack of [it, builtinPack("en")]) {
      const m = styleProceduresMessages(pack, style)!;
      expect(m[0]!.content).toContain('"procedimenti"');
      expect(m[1]!.content).toContain("[4] Io dormivo.");
    }
    const bare = { ...it, prompts: { ...it.prompts, "style-procedures": undefined } };
    expect(styleProceduresMessages(bare, style)).toBeNull();
  });

  test("procedures keep only sentences that exist; none, or no name, and they are dropped", () => {
    const read = readProceduresAnswer(
      "Ecco:\n```json\n" +
        JSON.stringify({
          sintesi: "Memoria che si chiude su una frase breve.",
          procedimenti: [
            {
              parte: "paragrafo",
              nome: "Chiude su una frase breve",
              descrizione: "Due frasi lunghe, poi una corta.",
              passi: [4, "[8]", 999, 4],
            },
            { parte: "attacco", nome: "Inventato", passi: [999] },
            { nome: "", passi: [1] },
            { parte: "boh", nome: "Lega con poi e ma", passi: "2, 6" },
          ],
        }) +
        "\n```",
      sentences,
    );
    expect(read).toEqual({
      summary: "Memoria che si chiude su una frase breve.",
      procedures: [
        {
          name: "Chiude su una frase breve",
          part: "paragraph",
          text: "Due frasi lunghe, poi una corta.",
          passages: ["Io dormivo.", "Io ascoltavo."],
        },
        { name: "Lega con poi e ma", passages: ["Poi mangiava.", "Poi ripartivano."] },
      ],
    });
    expect(
      readProceduresAnswer(
        JSON.stringify({ procedures: [{ part: "ending", name: "Ends short", passages: [4] }] }),
        sentences,
      )!.procedures,
    ).toEqual([{ name: "Ends short", part: "ending", passages: ["Io dormivo."] }]);
    expect(readProceduresAnswer("Lo stile è sobrio.", sentences)).toBeNull();
  });

  test("a passage is found in the pieces with the sentences around it; one gone is left out", () => {
    const found = locatePassages(
      style,
      { passages: ["poi  mangiava", "Una frase che non c’è."] },
      sentences,
    );
    expect(found).toEqual([
      {
        piece: 0,
        pieceTitle: "Uno",
        para: 1,
        before: expect.stringMatching(/^Mio padre tornava/),
        passage: "Poi mangiava.",
        after: expect.stringMatching(/^Ma la luce restava accesa/),
      },
    ]);
  });

  test("a new reading: proposed procedures replaced, kept and set aside stay; old sentences go", () => {
    const merged = mergeRead(
      {
        traits: [
          { text: "Vecchia sintesi.", dim: "summary" },
          { text: "Frasi lunghe.", dim: "rhythm", state: "fixed" },
          { text: "Mie note.", state: "fixed" },
        ],
        procedures: [
          { name: "Apre su un oggetto", state: "fixed" },
          { name: "Tono malinconico", state: "off" },
          { name: "Proposto prima", passages: ["Poi mangiava."] },
        ],
      },
      {
        summary: "Nuova sintesi.",
        procedures: [
          { name: "tono malinconico", passages: ["Io dormivo."] },
          { name: "Chiude breve", part: "paragraph", passages: ["Io dormivo."] },
        ],
      },
    );
    expect(merged.traits).toEqual([
      { text: "Mie note.", state: "fixed" },
      { text: "Nuova sintesi.", dim: "summary" },
    ]);
    expect(proceduresForFile(merged.procedures)).toEqual([
      { name: "Apre su un oggetto", state: "fixed" },
      { name: "Tono malinconico", state: "off" },
      { name: "Chiude breve", part: "paragraph", passages: ["Io dormivo."] },
    ]);
  });

  test("a style file keeps its procedures; the library shows where one happens", () => {
    const text = MOVING_STYLE.replace(
      "lang: it\n",
      "lang: it\nprocedures:\n  - name: Chiude breve\n    part: paragraph\n    passages: [Io dormivo.]\n  - name: Altro\n    part: nonsense\n",
    );
    const s = readStyle(text);
    expect(s.procedures).toEqual([
      { name: "Chiude breve", part: "paragraph", passages: ["Io dormivo."] },
    ]);
    expect(styleQuote(s)).toBe("Io dormivo.");
  });
});

describe("the editor reads the draft beside the style", () => {
  const it = builtinPack("it");
  const style = {
    ...readStyle(MOVING_STYLE),
    traits: [{ text: "Memoria.", dim: "summary" as const }],
    procedures: [
      { name: "Entra da una cosa", part: "opening" as const, text: "Apre su un oggetto." },
      { name: "Tono malinconico", state: "off" as const },
      { name: "Chiude breve", part: "paragraph" as const },
    ],
  };

  test("the model reads the whole draft and the procedures, never the pieces", () => {
    const m = styleReadingMessages(it, style, MARKET)!;
    expect(m[0]!.content).toContain('"esito"');
    expect(m[1]!.content).toContain("In brief: Memoria.");
    expect(m[1]!.content).toContain("1. [opening] Entra da una cosa — Apre su un oggetto.");
    expect(m[1]!.content).toContain("2. [paragraph] Chiude breve");
    expect(m[1]!.content).not.toContain("Tono malinconico");
    expect(m[1]!.content).toContain("DRAFT: ");
    expect(m[1]!.content).toMatch(
      /^¶3 <<<Ettore teneva le zucchine.*palmo della mano aperta\.>>>$/m,
    );
    expect(m[1]!.content).not.toContain("Mio padre tornava la sera");
    const bare = { ...it, prompts: { ...it.prompts, "style-reading": undefined } };
    expect(styleReadingMessages(bare, style, MARKET)).toBeNull();
  });

  test("functions by paragraph; cues on real procedures and paragraphs, in the order of the text", () => {
    const sent = [style.procedures[0]!, style.procedures[2]!];
    const r = readReadingAnswer(
      JSON.stringify({
        sintesi: "Il finale è già dello stile.",
        paragrafi: [
          { numero: 1, funzione: "Attacco" },
          { numero: "3", funzione: "scena" },
          { numero: 9, funzione: "x" },
        ],
        spunti: [
          { procedimento: 2, paragrafo: 4, esito: "come", nota: "Chiude breve.", parole: [] },
          {
            procedimento: 1,
            paragrafo: 1,
            esito: "diverso",
            nota: "Dichiara il tema.",
            parole: ["mio padre", "x".repeat(200)],
          },
          { procedimento: 2, paragrafo: 0, esito: "assente", nota: "Manca." },
          { procedimento: 7, paragrafo: 1, nota: "Nessuno." },
          { procedimento: 1, paragrafo: 12, nota: "Fuori." },
          { procedimento: 1, paragrafo: 1, nota: "Doppio." },
          { procedimento: 1, paragrafo: 2, esito: "like", nota: "Anche qui." },
          { procedimento: 1, paragrafo: 3, esito: "like", nota: "Troppo." },
        ],
      }),
      sent,
      4,
    );
    expect(r!.summary).toBe("Il finale è già dello stile.");
    expect(r!.functions).toEqual(["attacco", "", "scena", ""]);
    expect(r!.cues.map((c) => [c.procedure.name, c.paragraph, c.outcome, c.note, c.words])).toEqual(
      [
        ["Entra da una cosa", 1, "differs", "Dichiara il tema.", ["mio padre"]],
        // At most two where the draft is like the style.
        ["Entra da una cosa", 2, "like", "Anche qui.", []],
        ["Chiude breve", 4, "like", "Chiude breve.", []],
        ["Chiude breve", null, "missing", "Manca.", []],
      ],
    );
    expect(r!.cues[0]!.procedure.part).toBe("opening");
    expect(readReadingAnswer("La bozza va bene.", sent, 4)).toBeNull();
  });
});
