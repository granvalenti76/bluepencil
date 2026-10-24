import { mkdir, readdir, readFile, rm, utimes, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { cleanupAll, makeServer, tempDrafts } from "./helpers.ts";

afterEach(cleanupAll);

describe("SQLite index", () => {
  test("rename: .editorial-desk (index and style.md) becomes .bluepencil", async () => {
    const dir = await tempDrafts();
    await mkdir(join(dir, ".editorial-desk"));
    await writeFile(join(dir, ".editorial-desk", "style.md"), "- Niente punti esclamativi.\n");
    await makeServer({ dir });
    expect(await readFile(join(dir, ".bluepencil", "style.md"), "utf8")).toContain("esclamativi");
    expect((await readdir(dir)).includes(".editorial-desk")).toBe(false);
  });

  test("creates .bluepencil with its .gitignore and the tables", async () => {
    const s = await makeServer();
    expect(await readdir(join(s.dir, ".bluepencil"))).toEqual(
      expect.arrayContaining([".gitignore", "index.sqlite"]),
    );
    const tables = s.index.db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table')")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "drafts",
        "sections",
        "judgments",
        "check_cache",
        "claim_sources",
        "word_history",
        "fts_docs",
        "fts_passages",
        "review_scores",
        "review_passes",
        "review_letters",
        "habit_history",
        "citations",
      ]),
    );
    expect(s.index.db.pragma("user_version", { simple: true })).toBe(8);
  });

  test("scan: sections and full-text search", async () => {
    const s = await makeServer();
    const rows = s.index.db
      .prepare(
        "SELECT section_id, words, target, state FROM sections WHERE draft_path = ? ORDER BY rowid",
      )
      .all("turbocode-draft-12-settembre.md");
    expect(rows).toEqual([
      { section_id: "lead", words: 19, target: 70, state: "progress" },
      { section_id: "context", words: expect.any(Number), target: 130, state: expect.any(String) },
      { section_id: "development", words: expect.any(Number), target: 650, state: "over" },
      { section_id: "closing", words: 0, target: 50, state: "empty" },
    ]);
    const hits = s.index.db
      .prepare("SELECT path FROM fts_docs WHERE fts_docs MATCH ?")
      .all("llama") as { path: string }[];
    expect(hits.map((h) => h.path)).toContain("turbocode-draft-12-settembre.md");
  });

  test("deleting the index, it is rebuilt identical on restart", async () => {
    const dir = await tempDrafts();
    const first = await makeServer({ dir });
    expect(first.scan.indexed).toHaveLength(8);
    const before = first.index.list();
    await first.close();

    for (const f of await readdir(join(dir, ".bluepencil"))) {
      if (f.startsWith("index.sqlite")) await rm(join(dir, ".bluepencil", f));
    }

    const second = await makeServer({ dir });
    expect(second.scan.indexed).toHaveLength(8);
    expect(second.index.list()).toEqual(before);
  });

  test("on restart only changed or deleted files are reindexed", async () => {
    const dir = await tempDrafts();
    const first = await makeServer({ dir });
    await first.close();

    const same = await makeServer({ dir });
    expect(same.scan).toMatchObject({ indexed: [], removed: [], unchanged: 8 });
    await same.close();

    await writeFile(join(dir, "modelli-locali-su-mac.md"), "# Cambiata\n\nSolo tre parole.\n");
    await unlink(join(dir, "guida-installare-turbocode.md"));
    await writeFile(join(dir, "nuova.md"), "---\ntitle: Nuova\n---\n# Nuova\n");

    const third = await makeServer({ dir });
    expect(third.scan.indexed.sort()).toEqual(["modelli-locali-su-mac.md", "nuova.md"]);
    expect(third.scan.removed).toEqual(["guida-installare-turbocode.md"]);
    expect(third.index.get("modelli-locali-su-mac.md")?.title).toBe("Cambiata");
  });

  test("only mtime changed, same content: no reindexing", async () => {
    const dir = await tempDrafts();
    await (await makeServer({ dir })).close();
    const later = new Date(Date.now() + 60_000);
    await utimes(join(dir, "turbocode-draft-12-settembre.md"), later, later);
    const s = await makeServer({ dir });
    expect(s.scan.indexed).toEqual([]);
    expect(s.index.get("turbocode-draft-12-settembre.md")?.mtime).toBeCloseTo(later.getTime(), -3);
  });

  test("file without front matter: title from the H1, default values", async () => {
    const dir = await tempDrafts();
    await writeFile(join(dir, "libera.md"), "# Una nota libera\n\nDue parole.\n");
    const s = await makeServer({ dir });
    expect(s.index.get("libera.md")).toMatchObject({
      title: "Una nota libera",
      archetype: "undecided",
      stage: "writing",
      words: 5,
      lines: 3,
    });
    // Every .md is a text: even without front matter it is in the list. A source, that is a file
    // cited by another (fatti.md by Turbocode), is not; it stays indexed for search.
    expect(s.index.list().map((d) => d.path)).toContain("libera.md");
    expect(s.index.list().map((d) => d.path)).not.toContain("fatti.md");
    expect(s.index.sources().map((d) => d.path)).toEqual(["fatti.md", "local-models-facts.md"]);
    expect(
      s.index.db.prepare("SELECT path FROM fts_docs WHERE path = ?").get("fatti.md"),
    ).toBeDefined();
  });
});
