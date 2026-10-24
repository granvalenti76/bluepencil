import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { cleanupAll, makeServer } from "./helpers.ts";

afterEach(cleanupAll);

const TURBO = "turbocode-draft-12-settembre.md";

describe("drafts API", () => {
  test("list from the index, with a phase filter", async () => {
    const s = await makeServer();
    const all = (await s.inject({ method: "GET", url: "/api/drafts" })).json().drafts;
    expect(all).toHaveLength(6); // fatti.md and local-models-facts.md have no front matter: they are sources

    const turbo = all.find((d: { path: string }) => d.path === TURBO);
    expect(turbo).toMatchObject({
      title: "Turbocode V0.6",
      archetype: "article",
      stage: "writing",
      target: 900,
      words: 812,
      lines: 25,
    });

    const structure = (await s.inject({ method: "GET", url: "/api/drafts?stage=structure" })).json()
      .drafts;
    expect(structure.map((d: { path: string }) => d.path).sort()).toEqual([
      "guida-installare-turbocode.md",
      "swift-tauri-o-electron.md",
    ]);
  });

  test("GET returns front matter, body, hash and sections", async () => {
    const s = await makeServer();
    const d = (await s.inject({ method: "GET", url: `/api/drafts/${TURBO}` })).json();
    expect(d.frontmatter.title).toBe("Turbocode V0.6");
    expect(d.body.startsWith("# Turbocode V0.6")).toBe(true);
    expect(d.text).toBe(await readFile(join(s.dir, TURBO), "utf8"));
    expect(d.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(d.sections.map((x: { id: string; words: number }) => [x.id, x.words])).toEqual([
      ["lead", 19],
      ["context", expect.any(Number)],
      ["development", expect.any(Number)],
      ["closing", 0],
    ]);
  });

  test("PUT: atomic save, front matter intact, index updated", async () => {
    const s = await makeServer();
    const path = join(s.dir, TURBO);
    const before = await readFile(path, "utf8");
    const inoBefore = (await stat(path)).ino;
    const d = (await s.inject({ method: "GET", url: `/api/drafts/${TURBO}` })).json();

    const newBody = d.body.replace("Turbocode è un agent harness", "Turbocode è un harness");
    const res = await s.inject({
      method: "PUT",
      url: `/api/drafts/${TURBO}`,
      payload: { body: newBody, baseHash: d.contentHash },
    });
    expect(res.statusCode).toBe(200);

    const after = await readFile(path, "utf8");
    expect(after).toBe(before.replace("Turbocode è un agent harness", "Turbocode è un harness"));
    // rename: the file is a new inode and no temporary files are left
    expect((await stat(path)).ino).not.toBe(inoBefore);
    expect((await readdir(s.dir)).filter((f) => f.endsWith(".tmp"))).toEqual([]);

    expect(res.json().contentHash).not.toBe(d.contentHash);
    expect(s.index.get(TURBO)?.words).toBe(811);
  });

  test("PUT with frontmatterPatch changes only that field and keeps unknown fields", async () => {
    const s = await makeServer();
    const text =
      "---\ntitle: Prova # nota\nmio_campo:\n  a: 1\nstage: writing\n---\n# Prova\n\ntesto\n";
    await writeFile(join(s.dir, "prova.md"), text);
    const d = (await s.inject({ method: "GET", url: "/api/drafts/prova.md" })).json();
    const res = await s.inject({
      method: "PUT",
      url: "/api/drafts/prova.md",
      payload: { frontmatterPatch: { stage: "review" }, baseHash: d.contentHash },
    });
    expect(res.statusCode).toBe(200);
    expect(await readFile(join(s.dir, "prova.md"), "utf8")).toBe(
      text.replace("stage: writing", "stage: review"),
    );
  });

  test("PUT with an old hash → 409 and the file does not change", async () => {
    const s = await makeServer();
    const path = join(s.dir, TURBO);
    const d = (await s.inject({ method: "GET", url: `/api/drafts/${TURBO}` })).json();

    await s.inject({
      method: "PUT",
      url: `/api/drafts/${TURBO}`,
      payload: { body: d.body + "\nPrimo salvataggio.\n", baseHash: d.contentHash },
    });
    const afterFirst = await readFile(path, "utf8");

    const stale = await s.inject({
      method: "PUT",
      url: `/api/drafts/${TURBO}`,
      payload: { body: "# Altro\n", baseHash: d.contentHash },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe("conflict");
    expect(await readFile(path, "utf8")).toBe(afterFirst);
  });

  test("PUT after an external change to the file → 409", async () => {
    const s = await makeServer();
    const d = (await s.inject({ method: "GET", url: `/api/drafts/${TURBO}` })).json();
    await writeFile(join(s.dir, TURBO), d.text + "\nModifica esterna.\n");
    const res = await s.inject({
      method: "PUT",
      url: `/api/drafts/${TURBO}`,
      payload: { body: d.body, baseHash: d.contentHash },
    });
    expect(res.statusCode).toBe(409);
  });

  test("PUT: invalid requests → 400", async () => {
    const s = await makeServer();
    const url = `/api/drafts/${TURBO}`;
    expect((await s.inject({ method: "PUT", url, payload: { body: "x" } })).statusCode).toBe(400);
    expect(
      (await s.inject({ method: "PUT", url, payload: { body: 3, baseHash: "h" } })).statusCode,
    ).toBe(400);
    expect(
      (await s.inject({ method: "PUT", url, payload: { frontmatterPatch: [], baseHash: "h" } }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await s.inject({
          method: "PUT",
          url: "/api/drafts/nuova-inesistente.md",
          payload: { body: "x", baseHash: "h" },
        })
      ).statusCode,
    ).toBe(404);
  });

  test("POST creates slug.md in Writing (in Structure with `plan`), without overwriting", async () => {
    const s = await makeServer();
    const res = await s.inject({
      method: "POST",
      url: "/api/drafts",
      payload: { title: "Perché scrivere è difficile!", archetype: "blog", plan: true },
    });
    expect(res.statusCode).toBe(201);
    const d = res.json();
    expect(d.path).toBe("perche-scrivere-e-difficile.md");
    expect(d.frontmatter).toMatchObject({
      title: "Perché scrivere è difficile!",
      archetype: "blog",
      stage: "structure",
    });
    expect(await readFile(join(s.dir, d.path), "utf8")).toBe(d.text);

    const second = await s.inject({
      method: "POST",
      url: "/api/drafts",
      payload: { title: "Perché scrivere è difficile!" },
    });
    expect(second.json().path).toBe("perche-scrivere-e-difficile-2.md");
    expect(second.json().frontmatter).toMatchObject({ archetype: "undecided", stage: "writing" });

    expect(
      (await s.inject({ method: "GET", url: "/api/drafts?stage=structure" })).json().drafts,
    ).toHaveLength(3);
    expect(
      (
        await s.inject({
          method: "POST",
          url: "/api/drafts",
          payload: { title: "x", archetype: "boh" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await s.inject({ method: "POST", url: "/api/drafts", payload: { title: "  " } })).statusCode,
    ).toBe(400);
  });

  test("POST with the language: `lang` in the front matter (Italian if missing), unknown language → 400", async () => {
    const s = await makeServer();
    const post = (payload: object) => s.inject({ method: "POST", url: "/api/drafts", payload });
    const en = await post({ title: "Why writing is hard", lang: "en" });
    expect(en.statusCode).toBe(201);
    expect(en.json().frontmatter.lang).toBe("en");
    expect((await post({ title: "Senza lingua" })).json().frontmatter.lang).toBe("it");
    expect((await post({ title: "x", lang: "pt" })).statusCode).toBe(400);
    expect((await post({ title: "x", lang: 3 })).statusCode).toBe(400);
  });

  test("file names: letters with no accents to remove stay (ß, œ)", async () => {
    const s = await makeServer();
    const post = (title: string) =>
      s.inject({ method: "POST", url: "/api/drafts", payload: { title } });
    expect((await post("Die Straße")).json().path).toBe("die-strasse.md");
    expect((await post("Le cœur")).json().path).toBe("le-coeur.md");
    expect((await post("Ελληνικά")).json().path).toBe("bozza.md");
  });
});
