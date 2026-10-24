import { describe, expect, it } from "vitest";
import { draftLanguage, parseDraft, patchFrontMatter, slugId, toAscii } from "../src/index.ts";
import { fixture, TURBOCODE } from "./fixture.ts";

describe("draft language", () => {
  it("without `lang` it is Italian; `it` and `en` known; case and spaces tolerated", () => {
    expect(draftLanguage(undefined)).toEqual({ code: "it", declared: undefined, unknown: false });
    expect(draftLanguage("")).toEqual({ code: "it", declared: undefined, unknown: false });
    expect(draftLanguage("en")).toEqual({ code: "en", declared: "en", unknown: false });
    expect(draftLanguage(" EN ")).toEqual({ code: "en", declared: "EN", unknown: false });
  });

  it("with the user's packs: known if installed, with the pack's code", () => {
    const installed = ["it", "en", "es", "pt-BR"];
    expect(draftLanguage("pt-br", installed)).toEqual({
      code: "pt-BR",
      declared: "pt-br",
      unknown: false,
    });
    expect(draftLanguage("es", installed).code).toBe("es");
    expect(draftLanguage("es")).toMatchObject({ code: "it", unknown: true });
  });

  it("an unknown code is treated as Italian, but this is reported and the code kept", () => {
    expect(draftLanguage("pt-BR")).toEqual({ code: "it", declared: "pt-BR", unknown: true });
    expect(draftLanguage(42)).toEqual({ code: "it", declared: undefined, unknown: false });
  });

  it("round-trip: `lang` (even unknown) stays in the file with the rest of the front matter", () => {
    const text = patchFrontMatter(fixture(TURBOCODE), { lang: "pt-BR" });
    const parsed = parseDraft(text);
    expect(parsed.issues).toEqual([]);
    expect(parsed.data.lang).toBe("pt-BR");
    expect(parsed.data.title).toBe("Turbocode V0.6");
    // Changing another field does not touch `lang`.
    const again = parseDraft(patchFrontMatter(text, { stage: "review" }));
    expect(again.data.lang).toBe("pt-BR");
    expect(again.body).toBe(parsed.body);
  });

  it("ASCII names for files and ids: accents removed, ß/æ/œ/ø/ł rewritten", () => {
    expect(toAscii("perché è così")).toBe("perche e cosi");
    expect(toAscii("Straße, ẞ, Æsir, cœur, Søren, Łódź")).toBe(
      "Strasse, SS, AEsir, coeur, Soren, Lodz",
    );
    expect(slugId("Größe und Maße")).toBe("grosse-und-masse");
  });
});
