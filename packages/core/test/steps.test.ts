import { describe, expect, it } from "vitest";
import {
  buildMessages,
  archetypeIn,
  gulpease,
  readabilityLevel,
  readAnalysis,
  reviewTools,
  type ChatResult,
} from "../src/index.ts";
import { IT } from "./packs.ts";

const result = (over: Partial<ChatResult>): ChatResult => ({
  content: "",
  toolCalls: [],
  reasoning: "",
  reasoningTokens: 0,
  contentTokens: 0,
  finishReason: "stop",
  model: null,
  slot: undefined,
  elapsedMs: 0,
  ...over,
});
const call = (name: string, args: unknown) => ({ name, arguments: JSON.stringify(args) });

describe("reading the notes", () => {
  it("grammar: quote → correction; title and label come from the app", () => {
    const a = readAnalysis(
      "grammar",
      result({
        toolCalls: [
          call("annota", {
            citazione: "perchè",
            correzione: "perché",
            spiegazione: "Accento acuto.",
          }),
          call("annota", { citazione: "uguale", correzione: "uguale" }), // not a correction
          call("annota", { citazione: "manca la correzione" }),
          { name: "annota", arguments: "{rotto" },
        ],
      }),
      IT,
    );
    expect(a.judgments).toEqual([
      {
        kind: "grammar",
        quote: "perchè",
        title: "perchè → perché",
        rationale: "Accento acuto.",
        proposal: { action: "replace", text: "perché", label: "Fix" },
      },
    ]);
    expect(a.dropped).toBe(3);
  });

  it("prose and structure: free observations, optional proposal, score clamped to 0–100", () => {
    const prose = readAnalysis(
      "prose",
      result({
        toolCalls: [
          call("annota", { citazione: "x", problema: "Frasi accostate senza legame." }),
          call("annota", { citazione: "y", problema: "Parola generica.", proposta: "z" }),
          call("valuta", { voto: 130, motivo: "ok" }),
        ],
      }),
      IT,
    );
    expect(prose.judgments.map((j) => j.proposal.action)).toEqual(["none", "replace"]);
    expect(prose.score).toEqual({ value: 100, reason: "ok" });
    const structure = readAnalysis(
      "structure",
      result({ toolCalls: [call("annota", { osservazione: "Manca una chiusura." })] }),
      IT,
    );
    expect(structure.judgments[0]).toMatchObject({ quote: "", title: "Manca una chiusura." });
  });

  it("notes and score in two text blocks, nested score (small models)", () => {
    const a = readAnalysis(
      "prose",
      result({
        content:
          '[{"citazione": "x", "problema": "Generica.", "proposta": "z"}]\n\n' +
          '```json\n{"voto": {"voto": 62, "motivo": "Scorrevole."}}\n```',
      }),
      IT,
    );
    expect(a.judgments.map((j) => j.quote)).toEqual(["x"]);
    expect(a.score).toEqual({ value: 62, reason: "Scorrevole." });
  });

  it("facts: the outcome decides the action", () => {
    const a = readAnalysis(
      "facts",
      result({
        toolCalls: [
          call("annota", { citazione: "a", esito: "verificato" }),
          call("annota", { citazione: "b", esito: "da verificare", correzione: "c" }),
          call("annota", { citazione: "d", esito: "senza_fonte" }),
        ],
      }),
      IT,
    );
    expect(a.judgments.map((j) => [j.factStatus, j.proposal.action])).toEqual([
      ["verified", "none"],
      ["to_check", "replace"],
      ["unsourced", "add_source"],
    ]);
  });

  it("without tools: JSON array in the text; words only = no notes; truncated = error", () => {
    const json = readAnalysis(
      "grammar",
      result({ content: '[{"citazione": "qual\'è", "correzione": "qual è"}]' }),
      IT,
    );
    expect(json.judgments).toHaveLength(1);
    expect(readAnalysis("grammar", result({ content: "Nessun errore." }), IT)).toMatchObject({
      judgments: [],
      textOnly: true,
    });
    expect(() =>
      readAnalysis(
        "grammar",
        result({ content: '[{"citazione": "tro', finishReason: "length" }),
        IT,
      ),
    ).toThrow();
  });

  it("request: structure on the type of text; score only on the whole text", () => {
    const ctx = {
      outline: [],
      glossary: [],
      style: [],
      ignored: [],
      pack: IT,
      archetype: archetypeIn(IT, "blog"),
    };
    const [, structure] = buildMessages("structure", ctx, { text: "T" });
    expect(structure!.content).toContain("Il testo è un «Post di blog»");
    expect(structure!.content).toContain("- Apertura: Un gancio e il tema del post.");
    expect(structure!.content).not.toMatch(/\d+ parole/);
    // The editor's letter on the whole text, never on a selection.
    expect(reviewTools(IT, "prose", { text: "T" }).map((t) => t.function.name)).toEqual([
      "annota",
      "valuta",
      "lettera",
    ]);
    expect(reviewTools(IT, "prose", { text: "T", focus: "x" }).map((t) => t.function.name)).toEqual(
      ["annota"],
    );
    expect(reviewTools(IT, "grammar", { text: "T" }).map((t) => t.function.name)).toEqual([
      "annota",
      "lettera",
    ]);
    const [, focused] = buildMessages("grammar", ctx, {
      text: "Tutto. Un tratto.",
      focus: "Un tratto.",
    });
    expect(focused!.content.startsWith("Testo della bozza:\n<<<\nTutto. Un tratto.\n>>>")).toBe(
      true,
    );
    expect(focused!.content.endsWith("<<<\nUn tratto.\n>>>")).toBe(true);
  });
});

describe("Gulpease index", () => {
  it("short sentences and short words: easy; long sentences and long words: hard", () => {
    const easy = "Il gatto dorme. Il cane gioca. La casa è calda. Il sole entra. ".repeat(4);
    const hard =
      "La riorganizzazione infrastrutturale dell'amministrazione territoriale, considerata imprescindibile dalle rappresentanze istituzionali, comporterebbe conseguentemente un'inevitabile ridefinizione procedurale delle competenze interdipartimentali. ".repeat(
        2,
      );
    const e = gulpease(easy);
    const h = gulpease(hard);
    expect(e.index).toBeGreaterThan(80);
    expect(h.index).toBeLessThan(40);
    expect(readabilityLevel(e.index!)).toBe("easy");
    expect(readabilityLevel(h.index!)).toBe("hard");
  });

  it("formula: 89 + (300 × sentences − 10 × letters) / words", () => {
    // 20 words of 4 letters, 4 sentences: 89 + (1200 − 800) / 20 = 109 → 100.
    expect(gulpease("casa casa casa casa casa. ".repeat(4)).index).toBe(100);
    // 20 words of 10 letters, 1 sentence: 89 + (300 − 2000) / 20 = 4.
    expect(gulpease(`${"abcdefghij ".repeat(19)}abcdefghij.`).index).toBe(4);
  });

  it("headings and list items without a full stop end the sentence; short text: no index", () => {
    const withHeading = gulpease(
      "# Titolo lungo senza punto\n\nPoi una frase. ".concat("Altra frase qui. ".repeat(6)),
    );
    const withoutHeading = gulpease("Poi una frase. ".concat("Altra frase qui. ".repeat(6)));
    expect(withHeading.sentences).toBe(withoutHeading.sentences + 1);
    expect(gulpease("Troppo poco testo.").index).toBeNull();
    // Markdown and comments do not count.
    expect(
      gulpease("<!-- section: x -->\n**Il** gatto [dorme](http://a.b). ".repeat(8)).words,
    ).toBe(24);
  });
});
