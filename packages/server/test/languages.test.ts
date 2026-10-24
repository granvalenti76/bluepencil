import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DeskEvent } from "../src/events.ts";
import { BUILTIN_LANGUAGES_DIR, Languages } from "../src/languages.ts";
import { replyWith, startFakeLlm, type FakeLlm } from "./fake-llm.ts";
import { cleanupAll, makeServer } from "./helpers.ts";

let fake: FakeLlm | undefined;
const dirs: string[] = [];
afterEach(async () => {
  await fake?.close();
  fake = undefined;
  await cleanupAll();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "desk-languages-"));
  dirs.push(dir);
  return dir;
}

/** A user folder with a copy of the built-in English pack as `code`. */
async function userPack(code: string, edit: (meta: Record<string, unknown>) => void = () => {}) {
  const userDir = await tempDir();
  await cp(join(BUILTIN_LANGUAGES_DIR, "en"), join(userDir, code), { recursive: true });
  const metaPath = join(userDir, code, "language.json");
  const meta = JSON.parse(await readFile(metaPath, "utf8")) as Record<string, unknown>;
  meta.code = code;
  edit(meta);
  await writeFile(metaPath, JSON.stringify(meta));
  return userDir;
}

describe("built-in packs", () => {
  it("Italian and English; a draft with no pack for its language uses Italian", () => {
    const l = new Languages();
    expect(l.codes().sort()).toEqual(["en", "it"]);
    expect(l.problems).toEqual([]);
    expect(l.forDraft(undefined).code).toBe("it");
    expect(l.forDraft("pt-BR").code).toBe("it");
    expect(l.forDraft("EN").code).toBe("en");
  });

  it("without a valid Italian pack the server does not start", async () => {
    const dir = await tempDir();
    await cp(join(BUILTIN_LANGUAGES_DIR, "it"), join(dir, "it"), { recursive: true });
    await rm(join(dir, "it", "prompts", "system.md"));
    expect(() => new Languages({ builtinDir: dir })).toThrow(
      /The Italian language pack is missing or invalid[\s\S]*prompts\/system\.md: missing/,
    );
  });
});

describe("user packs", () => {
  it("they load next to the built-in ones; hidden files skipped; a broken one says why", async () => {
    const userDir = await userPack("es");
    await writeFile(join(userDir, "es", ".DS_Store"), "x");
    await cp(join(userDir, "es"), join(userDir, "fr"), { recursive: true });
    await writeFile(join(userDir, "fr", "prompts", "grammar.md"), "Revisa {{texto}}.");
    await cp(join(userDir, "es"), join(userDir, "de"), { recursive: true });
    const l = new Languages({ userDir });
    expect(l.codes().sort()).toEqual(["en", "es", "it"]);
    expect(l.get("es")!.builtIn).toBe(false);
    expect(l.get("es")!.versionSuffix).toMatch(/^-es-[0-9a-f]{8}$/);
    expect(l.problems).toEqual([
      {
        dir: join(userDir, "de"),
        errors: ['language.json: code "es" differs from the folder name'],
      },
      { dir: join(userDir, "fr"), errors: ["prompts/grammar.md: unknown placeholder {{texto}}"] },
    ]);
  });

  it("a user pack called `it` (or `en`) does not replace the built-in one", async () => {
    const userDir = await userPack("it", (m) => (m.name = "Il mio italiano"));
    const l = new Languages({ userDir });
    expect(l.get("it")!.name).toBe("Italiano");
    expect(l.get("it")!.builtIn).toBe(true);
    expect(l.problems).toEqual([
      {
        dir: join(userDir, "it"),
        errors: [
          '"it" is a built-in language: copy the folder to a new code (for example it-x-mine) to make your own version',
        ],
      },
    ]);
  });

  it("symbolic links: neither a file nor a folder can leave the pack", async () => {
    const userDir = await userPack("es");
    const outside = await tempDir();
    await writeFile(join(outside, "grammar.md"), "Fuori.");
    await rm(join(userDir, "es", "prompts", "grammar.md"));
    await symlink(join(outside, "grammar.md"), join(userDir, "es", "prompts", "grammar.md"));
    await cp(join(BUILTIN_LANGUAGES_DIR, "en"), join(outside, "fr"), { recursive: true });
    await symlink(join(outside, "fr"), join(userDir, "fr"));
    const l = new Languages({ userDir });
    expect(l.codes().sort()).toEqual(["en", "it"]);
    expect(l.problems).toEqual([
      {
        dir: join(userDir, "es"),
        errors: [
          "prompts/grammar.md: symbolic links are not allowed",
          "prompts/grammar.md: missing",
        ],
      },
      { dir: join(userDir, "fr"), errors: ["symbolic links are not allowed"] },
    ]);
  });
});

describe("user packs API", () => {
  async function server(opts: { watch?: boolean } = {}) {
    const dir = await tempDir();
    const configPath = join(dir, "config.json");
    await writeFile(configPath, "{}");
    const opened: string[] = [];
    fake = await startFakeLlm({ chat: () => replyWith("[]") });
    const s = await makeServer({
      modelUrl: fake.url,
      configPath,
      opener: async (abs) => void opened.push(abs),
      watch: opts.watch,
    });
    return { s, opened, userDir: join(dir, "languages") };
  }

  it('"New language…": copies English with code and name, a README, readability without a formula', async () => {
    const { s, opened, userDir } = await server();
    const res = await s.inject({
      method: "POST",
      url: "/api/languages",
      payload: { code: "es", name: "Español" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().created).toBe(join(userDir, "es"));
    expect(opened).toEqual([join(userDir, "es")]);
    const es = res.json().packs.find((p: { code: string }) => p.code === "es");
    expect(es).toMatchObject({
      name: "Español",
      builtIn: false,
      readability: { formula: "sentences" },
      stopWords: [],
      commonWords: [],
    });
    expect(await readFile(join(userDir, "es", "README.md"), "utf8")).toMatch(/^# Language pack/);
    expect(res.json().problems).toEqual([]);

    const again = (payload: object) => s.inject({ method: "POST", url: "/api/languages", payload });
    expect((await again({ code: "es", name: "Otra" })).statusCode).toBe(409);
    expect((await again({ code: "en", name: "English 2" })).statusCode).toBe(409);
    expect((await again({ code: "Spanish", name: "x" })).statusCode).toBe(400);
    expect((await again({ code: "../x", name: "x" })).statusCode).toBe(400);
    expect((await again({ code: "pt", name: "" })).statusCode).toBe(400);
  });

  it('a `lang: es` draft receives its pack\'s prompts, after an edit and "Reload"', async () => {
    const { s, userDir } = await server();
    await s.inject({
      method: "POST",
      url: "/api/languages",
      payload: { code: "es", name: "Español" },
    });
    await writeFile(
      join(userDir, "es", "prompts", "system.md"),
      "Eres un revisor editorial. Escribe en español.\n",
    );
    const reload = await s.inject({ method: "POST", url: "/api/languages/reload" });
    expect(reload.statusCode).toBe(200);
    const draft = (
      await s.inject({
        method: "POST",
        url: "/api/drafts",
        payload: { title: "Escribir con un modelo local", lang: "es" },
      })
    ).json();
    expect(draft.frontmatter.lang).toBe("es");
    const run = await s.inject({
      method: "POST",
      url: `/api/review/${draft.path}`,
      payload: { types: ["grammar"] },
    });
    await s.runner.wait(run.json().runId);
    const system = (fake!.chatRequests()[0]!.body!.messages as { content: string }[])[0]!.content;
    expect(system).toMatch(/^Eres un revisor editorial\. Escribe en español\.\n\n# Draft/);
  });

  it("changing a pack's prompt invalidates that language's cache, not the others'", async () => {
    const { s, userDir } = await server();
    await s.inject({
      method: "POST",
      url: "/api/languages",
      payload: { code: "es", name: "Español" },
    });
    const create = async (title: string, lang: string) =>
      (await s.inject({ method: "POST", url: "/api/drafts", payload: { title, lang } })).json()
        .path as string;
    const esPath = await create("Uno", "es");
    const itPath = await create("Due", "it");
    for (const path of [esPath, itPath]) {
      await writeFile(join(s.dir, path), `${await readFile(join(s.dir, path), "utf8")}\nTesto.\n`);
    }
    await s.index.scan(s.repo);
    const review = async (path: string) => {
      const run = await s.inject({
        method: "POST",
        url: `/api/review/${path}`,
        payload: { types: ["grammar"] },
      });
      await s.runner.wait(run.json().runId);
    };
    await review(esPath);
    await review(itPath);
    await review(esPath);
    await review(itPath);
    expect(fake!.chatRequests()).toHaveLength(2); // the second time, both from the cache

    const grammar = join(userDir, "es", "prompts", "grammar.md");
    await writeFile(grammar, `${await readFile(grammar, "utf8")}Be brief.\n`);
    await s.inject({ method: "POST", url: "/api/languages/reload" });
    await review(esPath);
    await review(itPath);
    expect(fake!.chatRequests()).toHaveLength(3); // only Spanish is checked again
    const last = fake!.chatRequests()[2]!.body!.messages as { content: string }[];
    // The edited prompt, followed by the letter request.
    expect(last[1]!.content).toMatch(/Be brief\.\nFinally, call "lettera"/);
  });

  it("editing the files in the folder reloads the packs and the interface knows", async () => {
    const { s, userDir } = await server({ watch: true });
    await mkdir(userDir, { recursive: true });
    const events: DeskEvent[] = [];
    s.bus.subscribe((e) => events.push(e));
    await cp(join(BUILTIN_LANGUAGES_DIR, "en"), join(userDir, "de"), { recursive: true });
    const meta = join(userDir, "de", "language.json");
    await writeFile(
      meta,
      JSON.stringify({ ...JSON.parse(await readFile(meta, "utf8")), code: "de", name: "Deutsch" }),
    );
    const started = Date.now();
    while (!s.languages.get("de") && Date.now() - started < 3000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(s.languages.get("de")?.name).toBe("Deutsch");
    expect(events.some((e) => e.type === "languages.changed")).toBe(true);
  });
});
