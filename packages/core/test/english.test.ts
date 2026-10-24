import { describe, expect, it } from "vitest";
import {
  buildMessages,
  detectLanguage,
  flesch,
  outlineMessages,
  parseDraft,
  promptVersion,
  readability,
  readabilityLevel,
  repairMessage,
  reviewTools,
  rewriteMessages,
  sectionMessages,
  syllables,
  type DraftContext,
} from "../src/index.ts";
import { fixture, TURBOCODE } from "./fixture.ts";
import { builtinPack, IT } from "./packs.ts";

const EN = builtinPack("en");
const ENGLISH_DRAFT = "writing-with-a-local-model.md";

describe("English pack", () => {
  it("valid, with its own versions and archetypes with the same ids as Italian", () => {
    expect(EN.code).toBe("en");
    expect(promptVersion(EN, "grammar")).toBe("s1-grammar2-en");
    expect(EN.archetypes.map((a) => a.defaultSections.map((s) => s.id))).toEqual(
      IT.archetypes.map((a) => a.defaultSections.map((s) => s.id)),
    );
    expect(EN.archetypes.find((a) => a.id === "blog")!.defaultSections.map((s) => s.title)).toEqual(
      ["Opening", "Body", "Conclusion"],
    );
  });

  it("the English prompts have no Italian leftovers (except the field names, which are the contract)", () => {
    const { data, body } = parseDraft(fixture(ENGLISH_DRAFT));
    const ctx: DraftContext = {
      pack: EN,
      title: data.title,
      archetype: EN.archetypes.find((a) => a.id === "blog"),
      outline: [],
      brief: data.brief,
      glossary: ["llama-server"],
      style: ["Short sentences."],
      ignored: [{ kind: "grammar", quote: "x" }],
    };
    const texts: string[] = [];
    for (const step of ["structure", "facts", "grammar", "prose"] as const) {
      const input = { text: body, focus: "x", sources: [], footnotes: [{ id: "1", text: "y" }] };
      texts.push(...buildMessages(step, ctx, input).map((m) => m.content));
      texts.push(...buildMessages(step, ctx, { text: body }).map((m) => m.content));
      texts.push(JSON.stringify(reviewTools(EN, step, { text: body })));
    }
    texts.push(...outlineMessages(EN, ctx.archetype!, "", 700).map((m) => m.content));
    texts.push(
      ...sectionMessages(ctx, {
        mode: "regenerate",
        title: "Body",
        target: 1,
        current: "a",
        reason: "b",
        before: "c",
        after: "d",
      }).map((m) => m.content),
    );
    texts.push(
      ...rewriteMessages(ctx, { style: "clear", passage: "p", text: "t" }).map((m) => m.content),
    );
    texts.push(repairMessage(EN, "e"));
    const all = texts
      .join("\n")
      .replace(body, "")
      // The letter's field: only as a quoted name, so «testo» counts as a leftover.
      .replace(/"testo"/g, "")
      // The contract with the model: tools, fields and outcomes stay Italian in every language.
      .replace(
        /\b(annota|valuta|lettera|citazione|correzione|spiegazione|problema|proposta|osservazione|esito|voto|motivo|verificato|da_verificare|senza_fonte)\b/g,
        "",
      );
    for (const word of ["della", "bozza", "testo", "il ", " di ", "Sei ", "italiano", "«", "»"]) {
      expect(all, word).not.toContain(word);
    }
    expect(all).toContain("Write in English");
  });
});

describe("Flesch Reading Ease", () => {
  // Contato a mano: 32 parole, 3 frasi, 46 sillabe → 206,835 − 1,015 × 32/3 − 84,6 × 46/32 = 74,4.
  const REFERENCE =
    "The committee met on Tuesday to review the budget. Members agreed that the new plan was too expensive. They asked the director to cut costs by ten percent before the next meeting.";

  it("a reference text gives the expected value (±2)", () => {
    const r = flesch(
      REFERENCE,
      EN.readability as Extract<typeof EN.readability, { formula: "flesch" }>,
    );
    expect(r.words).toBe(32);
    expect(r.sentences).toBe(3);
    expect(Math.abs(r.index! - 74.4)).toBeLessThanOrEqual(2);
    expect(readability(REFERENCE, EN.readability)).toEqual(r);
  });

  it("English syllables: vowel groups and silent «e»", () => {
    const count = (w: string) => syllables(w, "aeiouy", true);
    const cases: Record<string, number> = {
      the: 1,
      cat: 1,
      make: 1,
      makes: 1,
      table: 2,
      committee: 3,
      expensive: 3,
      before: 2,
      asked: 1,
      wanted: 2,
      agreed: 2,
      boxes: 2,
      changes: 2,
      Tuesday: 2,
      review: 2,
      meeting: 2,
      director: 3,
      they: 1,
      "2024": 1,
      readability: 5,
    };
    for (const [w, n] of Object.entries(cases)) expect(count(w), w).toBe(n);
  });

  it("levels: Flesch above 60 easy, below 30 hard; Gulpease as before", () => {
    expect(readabilityLevel(65, "flesch")).toBe("easy");
    expect(readabilityLevel(45, "flesch")).toBe("medium");
    expect(readabilityLevel(25, "flesch")).toBe("hard");
    expect(readabilityLevel(35)).toBe("hard");
    expect(readabilityLevel(35, "gulpease")).toBe("hard");
  });
});

describe("language detection", () => {
  const packs = [IT, EN];
  const body = (name: string) => parseDraft(fixture(name)).body;

  it("the sample drafts: Italian and English", () => {
    for (const name of [
      TURBOCODE,
      "modelli-locali-su-mac.md",
      "making-of-scultura-digitale-in-blender.md",
    ]) {
      expect(detectLanguage(body(name), packs), name).toBe("it");
    }
    expect(detectLanguage(body(ENGLISH_DRAFT), packs)).toBe("en");
  });

  it("short text, or no language clearly ahead: no proposal", () => {
    expect(detectLanguage("The cat sat on the mat.", packs)).toBeNull();
    const mixed = `${body(ENGLISH_DRAFT).slice(0, 600)}\n\n${body(TURBOCODE).slice(0, 600)}`;
    expect(detectLanguage(mixed, packs)).toBeNull();
    expect(detectLanguage("1 2 3 ".repeat(50), packs)).toBeNull();
  });
});
