import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fill, parseLanguagePack, placeholdersIn, type PackFiles } from "../src/index.ts";
import { LANGUAGES_DIR, readPackFiles } from "./packs.ts";

const IT_FILES = readPackFiles(join(LANGUAGES_DIR, "it"));

/** The Italian pack with a few files changed (`null` = removed). */
function itWith(changes: Record<string, string | null>): PackFiles {
  const files = { ...IT_FILES };
  for (const [path, text] of Object.entries(changes)) {
    if (text === null) delete files[path];
    else files[path] = text;
  }
  return files;
}

const errorsOf = (files: PackFiles, builtIn = false) => {
  const r = parseLanguagePack(files, { builtIn });
  return r.ok ? [] : r.errors;
};

const labels = () =>
  JSON.parse(IT_FILES["prompts/labels.json"]!) as Record<string, Record<string, string>>;

describe("language pack: format and validation", () => {
  it("the built-in Italian pack is valid, with the long-standing versions", () => {
    const r = parseLanguagePack(IT_FILES, { builtIn: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pack.code).toBe("it");
    expect(r.pack.versionSuffix).toBe("");
    expect(r.pack.archetypes.map((a) => a.id)).toEqual(["article", "blog", "report", "docs"]);
  });

  it("unknown placeholder or missing required one: it does not load, and says where", () => {
    expect(errorsOf(itWith({ "prompts/grammar.md": "Controlla {{testo}}." }))).toEqual([
      "prompts/grammar.md: unknown placeholder {{testo}}",
    ]);
    expect(errorsOf(itWith({ "prompts/section.md": "Senza contesto." }))).toEqual([
      "prompts/section.md: {{context}} is missing",
    ]);
    const l = labels();
    l.context!.title = "Titolo: {{titolo}}";
    expect(errorsOf(itWith({ "prompts/labels.json": JSON.stringify(l) }))).toEqual([
      "prompts/labels.json at context.title: unknown placeholder {{titolo}} (allowed: {{title}})",
    ]);
  });

  it("missing, empty or unknown file", () => {
    expect(errorsOf(itWith({ "prompts/system.md": null }))).toEqual(["prompts/system.md: missing"]);
    expect(errorsOf(itWith({ "prompts/facts.md": "  \n" }))).toEqual(["prompts/facts.md: empty"]);
    expect(errorsOf(itWith({ "archetypes/blog.json": null }))).toEqual([
      "archetypes/blog.json: missing",
    ]);
    expect(errorsOf(itWith({ "prompts/extra.md": "x" }))).toEqual([
      "prompts/extra.md: not a file of a language pack",
    ]);
    expect(errorsOf(itWith({ "README.md": "Come usare il pacchetto." }))).toEqual([]);
  });

  it("broken JSON or wrong fields", () => {
    expect(errorsOf(itWith({ "language.json": "{ code: it" }))[0]).toMatch(
      /^language\.json: invalid JSON/,
    );
    const meta = JSON.parse(IT_FILES["language.json"]!);
    expect(
      errorsOf(itWith({ "language.json": JSON.stringify({ ...meta, wordsPerMinute: "230" }) })),
    ).toEqual(["language.json at wordsPerMinute: Invalid input: expected number, received string"]);
    expect(
      errorsOf(
        itWith({ "language.json": JSON.stringify({ ...meta, readability: { formula: "x" } }) }),
      )[0],
    ).toMatch(/^language\.json at readability\.formula: /);
    const blog = JSON.parse(IT_FILES["archetypes/blog.json"]!);
    delete blog.sections.body;
    expect(errorsOf(itWith({ "archetypes/blog.json": JSON.stringify(blog) }))).toEqual([
      "archetypes/blog.json at sections.body: Invalid input: expected object, received undefined",
    ]);
  });

  it("versions: `-<code>` for a built-in pack, with the fingerprint for a user's pack", () => {
    const meta = JSON.parse(IT_FILES["language.json"]!);
    const es = itWith({ "language.json": JSON.stringify({ ...meta, code: "es" }) });
    const builtIn = parseLanguagePack(es, { builtIn: true });
    const user = parseLanguagePack(es, { builtIn: false });
    const edited = parseLanguagePack(
      { ...es, "prompts/grammar.md": `${es["prompts/grammar.md"]} Di più.` },
      { builtIn: false },
    );
    expect(builtIn.ok && builtIn.pack.versionSuffix).toBe("-es");
    expect(user.ok && user.pack.versionSuffix).toMatch(/^-es-[0-9a-f]{8}$/);
    expect(edited.ok && edited.pack.versionSuffix).toMatch(/^-es-[0-9a-f]{8}$/);
    expect(user.ok && edited.ok && user.pack.versionSuffix !== edited.pack.versionSuffix).toBe(
      true,
    );
  });

  it("placeholders: filled in a single pass, the draft's text is not read again", () => {
    expect(placeholdersIn("{{a}} e {{b}} e {{a}}")).toEqual(["a", "b"]);
    expect(fill("Testo: {{text}}", { text: "c'è un {{text}} nella bozza" })).toBe(
      "Testo: c'è un {{text}} nella bozza",
    );
  });
});
