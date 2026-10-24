import { describe, expect, it } from "vitest";
import { habitWord, localHabits } from "../src/index.ts";
import { IT } from "./packs.ts";
import { builtinPack } from "./packs.ts";

describe("habits", () => {
  it("intensifying adverbs and long sentences, counted on the text", () => {
    const body =
      "# Titolo\n\nÈ completamente nuovo, davvero. Completamente!\n\n" +
      "Questa frase è lunga apposta perché deve superare la soglia delle venticinque parole e per farlo continua a elencare cose, poi ancora altre cose, e infine finisce qui.\n" +
      "<!-- molto -->\n";
    expect(localHabits(body, IT)).toEqual({
      intensifiers: { completamente: 2, davvero: 1 },
      longSentences: 1,
    });
    const en = localHabits("It is really, really good. Very.", builtinPack("en"));
    expect(en.intensifiers).toEqual({ really: 2, very: 1 });
    expect(localHabits("Senza elenco.", {}).intensifiers).toEqual({});
  });

  it("from the model: a single word, accepted; dismissed ones do not count", () => {
    const j = (pass: "prose" | "grammar" | "facts", status: string, quote: string) => ({
      pass,
      status: status as "applied",
      anchor: { quote, prefix: "", suffix: "" },
    });
    expect(habitWord(j("prose", "applied", " Completamente "))).toBe("completamente");
    expect(habitWord(j("prose", "ignored", "completamente"))).toBeNull();
    expect(habitWord(j("prose", "applied", "due parole"))).toBeNull();
    expect(habitWord(j("facts", "applied", "Qwen"))).toBeNull();
  });
});
