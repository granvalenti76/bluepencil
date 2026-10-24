import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InjectOptions } from "fastify";
import { afterEach, describe, expect, test } from "vitest";
import { buildSetupApp } from "../src/app.ts";
import { FRESH_CONFIG, loadConfig } from "../src/config.ts";
import { inspectFolder } from "../src/routes/welcome.ts";
import { scriptedChat } from "./fake-llm-script.ts";
import { startFakeLlm, type FakeLlm } from "./fake-llm.ts";
import { cleanupAll, freePort, makeServer, TOKEN } from "./helpers.ts";

/** First start: every `.md` is a text, the chosen folder, the test. */

let fake: FakeLlm | null = null;
afterEach(async () => {
  await fake?.close();
  fake = null;
  await cleanupAll();
});

async function tmp(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return dir;
}

/** A folder of notes without front matter: two texts, one citing a third (the source). */
async function notesFolder() {
  const dir = await tmp("desk-notes-");
  await mkdir(join(dir, "fonti"));
  await writeFile(join(dir, "pane.md"), "# Il pane\n\nCosta meno.[^1]\n\n[^1]: fonti/prezzi.md\n");
  await writeFile(join(dir, "orto.md"), "# L'orto\n\nPomodori.\n");
  await writeFile(join(dir, "fonti", "prezzi.md"), "Il pane del forno costa 4 euro al chilo.\n");
  // A hidden folder does not count.
  await mkdir(join(dir, ".obsidian"));
  await writeFile(join(dir, ".obsidian", "nota.md"), "nascosta\n");
  return dir;
}

/** The first-start server, with the configuration of a very first start. */
async function setupServer(env: NodeJS.ProcessEnv = {}, stored?: object) {
  const configPath = join(await tmp("desk-welcome-"), "config.json");
  if (stored) await writeFile(configPath, JSON.stringify(stored));
  const config = loadConfig({ DESK_CONFIG: configPath });
  const port = await freePort();
  config.port = port;
  const relaunches: number[] = [];
  const built = await buildSetupApp({
    config,
    token: TOKEN,
    configPath,
    model: { pollMs: 0, env: {} },
    picker: async () => null,
    relaunch: () => relaunches.push(Date.now()),
  });
  const headers = { host: `127.0.0.1:${port}`, "x-desk-token": TOKEN };
  return {
    config,
    configPath,
    relaunches,
    env,
    inject: (o: InjectOptions) => built.app.inject({ ...o, headers }),
    close: () => built.app.close(),
  };
}

describe("every .md is a text; a source is a cited file", () => {
  test("a folder without front matter: all texts, except the cited source", async () => {
    const dir = await notesFolder();
    const s = await makeServer({ dir });
    expect(
      s.index
        .list()
        .map((d) => d.path)
        .sort(),
    ).toEqual(["orto.md", "pane.md"]);
    expect(s.index.sources().map((d) => d.path)).toEqual(["fonti/prezzi.md"]);
    // With the note removed, the source becomes a text again (the index updates with the citing file).
    const text = "# Il pane\n\nCosta meno.\n";
    await writeFile(join(dir, "pane.md"), text);
    s.index.upsert("pane.md", text, Date.now());
    expect(s.index.list().map((d) => d.path)).toContain("fonti/prezzi.md");
    await s.close();
  });

  test("`sources` in the front matter also makes a file a source", async () => {
    const dir = await tmp("desk-notes-");
    await writeFile(join(dir, "a.md"), "---\ntitle: A\nsources:\n  - b.md\n---\n# A\n");
    await writeFile(join(dir, "b.md"), "# B\n");
    const s = await makeServer({ dir });
    expect(s.index.list().map((d) => d.path)).toEqual(["a.md"]);
    await s.close();
  });

  test("inspectFolder counts texts, sources and the last change, without writing anything", async () => {
    const dir = await notesFolder();
    const summary = await inspectFolder(dir);
    expect(summary).toMatchObject({ exists: true, texts: 2, sources: 1 });
    expect(summary.lastEdited).toBeGreaterThan(0);
    expect(existsSync(join(dir, ".bluepencil"))).toBe(false);
    expect(await inspectFolder(join(dir, "non-c-e"))).toEqual({
      exists: false,
      texts: 0,
      sources: 0,
      lastEdited: null,
    });
  });
});

describe("the first start", () => {
  test("a very first start has no folder and does not create one", async () => {
    const configPath = join(await tmp("desk-welcome-"), "config.json");
    const c = loadConfig({ DESK_CONFIG: configPath });
    expect(c.draftsDir).toBe("");
    expect(c.welcome).toBe("pending");
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual(FRESH_CONFIG);
  });

  test("a configuration from before the first-start screen does not repeat it if the folder has texts", async () => {
    const configPath = join(await tmp("desk-welcome-"), "config.json");
    const dir = await notesFolder();
    await writeFile(configPath, JSON.stringify({ draftsDir: dir }));
    expect(loadConfig({ DESK_CONFIG: configPath })).toMatchObject({
      draftsDir: dir,
      welcome: "done",
    });
    await writeFile(configPath, JSON.stringify({ draftsDir: await tmp("desk-vuota-") }));
    expect(loadConfig({ DESK_CONFIG: configPath })).toMatchObject({
      draftsDir: "",
      welcome: "pending",
    });
  });

  test("with an older configuration, once the folder is chosen the first start continues after the restart", async () => {
    const empty = await tmp("desk-vuota-");
    const s = await setupServer({}, { draftsDir: empty, model: { baseUrl: "http://x:8080/v1" } });
    expect(s.config.welcome).toBe("pending");
    const dir = await notesFolder();
    const r = await s.inject({
      method: "POST",
      url: "/api/welcome/folder",
      payload: { path: dir },
    });
    expect(r.statusCode).toBe(200);
    // On restart: the chosen folder, the first start still to finish (the editor, the test).
    expect(loadConfig({ DESK_CONFIG: s.configPath })).toMatchObject({
      draftsDir: dir,
      welcome: "pending",
      model: { baseUrl: "http://x:8080/v1" },
    });
  });

  test("without a folder: welcome, folder counts, choice, restart", async () => {
    const s = await setupServer();
    const welcome = (await s.inject({ method: "GET", url: "/api/welcome" })).json();
    expect(welcome).toMatchObject({ pending: true, folder: null });
    // Without a folder there are no drafts.
    expect((await s.inject({ method: "GET", url: "/api/drafts" })).statusCode).toBe(404);

    const dir = await notesFolder();
    const inspect = await s.inject({
      method: "GET",
      url: `/api/welcome/inspect?path=${encodeURIComponent(dir)}`,
    });
    expect(inspect.json()).toMatchObject({ exists: true, texts: 2, sources: 1 });

    const chosen = await s.inject({
      method: "POST",
      url: "/api/welcome/folder",
      payload: { path: dir },
    });
    expect(chosen.json()).toMatchObject({ summary: { texts: 2 }, relaunching: true });
    expect(JSON.parse(await readFile(s.configPath, "utf8"))).toMatchObject({
      draftsDir: dir,
      welcome: "pending",
    });
    await new Promise((r) => setTimeout(r, 80));
    expect(s.relaunches).toHaveLength(1);
    await s.close();
  });

  test('"A new folder" creates the folder only after the choice', async () => {
    const base = await tmp("desk-new-");
    const fresh = join(base, "Documents", "Bluepencil");
    process.env.DESK_NEW_FOLDER = fresh;
    try {
      const s = await setupServer();
      expect(existsSync(fresh)).toBe(false);
      const r = await s.inject({
        method: "POST",
        url: "/api/welcome/folder",
        payload: { fresh: true },
      });
      expect(r.statusCode).toBe(200);
      expect(existsSync(fresh)).toBe(true);
      await s.close();
    } finally {
      delete process.env.DESK_NEW_FOLDER;
      await rm(base, { recursive: true, force: true });
    }
  });

  test("once the folder is chosen: the sample draft, then the first start does not repeat", async () => {
    const dir = await notesFolder();
    const configPath = join(await tmp("desk-welcome-"), "config.json");
    await writeFile(configPath, JSON.stringify({ ...FRESH_CONFIG, draftsDir: dir }));
    const config = loadConfig({ DESK_CONFIG: configPath });
    const s = await makeServer({ dir, configPath, config: { welcome: config.welcome } });
    const done = await s.inject({
      method: "POST",
      url: "/api/welcome/finish",
      payload: { sample: true, lang: "it" },
    });
    expect(done.json()).toMatchObject({ sample: "Esempio.md" });
    const sample = await readFile(join(dir, "Esempio.md"), "utf8");
    expect(sample).toContain("# Il pane della domenica");
    expect(sample).toContain("perchè"); // there is something to find
    expect(s.index.list().map((d) => d.path)).toContain("Esempio.md");
    expect(JSON.parse(await readFile(configPath, "utf8")).welcome).toBe("done");
    expect(loadConfig({ DESK_CONFIG: configPath }).welcome).toBe("done");
    // Done: the first-start routes are no longer needed.
    const again = await s.inject({
      method: "POST",
      url: "/api/welcome/finish",
      payload: { sample: true },
    });
    expect(again.statusCode).toBe(409);
    await s.close();
  });
});

describe("the editor test", () => {
  test("answers: time, model, context, reasoning and its first words", async () => {
    fake = await startFakeLlm({ chat: scriptedChat, models: ["Qwen3.6-35B"] });
    const s = await setupServer();
    const r = await s.inject({
      method: "POST",
      url: "/api/model/probe",
      payload: { baseUrl: fake.url, lang: "it" },
    });
    expect(r.json()).toMatchObject({
      ok: true,
      model: "Qwen3.6-35B",
      context: 16384,
      minutes: 3,
      reasoning: true,
      words: expect.stringContaining("Le virgole per ultime"),
    });
    // The test does not save the address.
    expect(JSON.parse(await readFile(s.configPath, "utf8")).model.baseUrl).toBe(
      FRESH_CONFIG.model.baseUrl,
    );
    await s.close();
  });

  test("nobody answers: says so, with the address", async () => {
    const s = await setupServer();
    const port = await freePort();
    const r = await s.inject({
      method: "POST",
      url: "/api/model/probe",
      payload: { baseUrl: `http://127.0.0.1:${port}/v1` },
    });
    expect(r.json()).toMatchObject({
      ok: false,
      reason: "unreachable",
      address: `127.0.0.1:${port}`,
    });
    await s.close();
  });
});
