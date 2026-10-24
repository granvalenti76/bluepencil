import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { loadConfig } from "../src/config.ts";
import { cleanupAll, makeServer } from "./helpers.ts";

const dirs: string[] = [];
afterEach(async () => {
  await cleanupAll();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function configFile(content: object) {
  const dir = await mkdtemp(join(tmpdir(), "desk-settings-"));
  dirs.push(dir);
  const path = join(dir, "config.json");
  await writeFile(path, JSON.stringify(content, null, 2));
  return path;
}

test("the chosen publish folder applies at once and ends up in config.json", async () => {
  const path = await configFile({
    port: 4317,
    extra: { mio: true },
    publish: { repoDir: "~/vecchio", contentDir: "content/posts", push: false },
  });
  const s = await makeServer({ configPath: path });
  const r = await s.inject({
    method: "PUT",
    url: "/api/settings",
    payload: { publishDir: "~/Blog/post", push: true },
  });
  expect(r.statusCode).toBe(200);
  expect(r.json()).toMatchObject({ publishDir: "~/Blog/post", push: true, restartNeeded: false });
  const saved = JSON.parse(await readFile(path, "utf8"));
  expect(saved).toEqual({
    port: 4317,
    extra: { mio: true },
    publish: { dir: "~/Blog/post", push: true },
  });
  // At once for publishing: the folder is not a repository, so no push.
  const p = await s.inject({ method: "GET", url: "/api/publish/turbocode-draft-12-settembre.md" });
  expect(p.json()).toMatchObject({ git: false, canPush: false });
});

test("drafts folder and model: saved, they apply from the next start", async () => {
  const path = await configFile({});
  const s = await makeServer({ configPath: path });
  const r = await s.inject({
    method: "PUT",
    url: "/api/settings",
    payload: { draftsDir: "/tmp/altre-bozze", modelBaseUrl: "http://10.0.0.5:8080/v1" },
  });
  expect(r.json()).toMatchObject({
    draftsDir: "/tmp/altre-bozze",
    modelBaseUrl: "http://10.0.0.5:8080/v1",
    restartNeeded: true,
  });
  const c = loadConfig({ DESK_CONFIG: path });
  expect(c.draftsDir).toBe("/tmp/altre-bozze");
  expect(c.model.baseUrl).toBe("http://10.0.0.5:8080/v1");
});

test("invalid values → 400, the file does not change", async () => {
  const path = await configFile({ port: 4317 });
  const s = await makeServer({ configPath: path });
  for (const payload of [
    { publishDir: "relativo/post" },
    { draftsDir: "" },
    { modelBaseUrl: "ftp://x" },
    { altro: 1 },
  ]) {
    const r = await s.inject({ method: "PUT", url: "/api/settings", payload });
    expect(r.statusCode, JSON.stringify(payload)).toBe(400);
  }
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ port: 4317 });
});

test("folder picker: path with ~, cancelled → null, missing → 501", async () => {
  const home = (await import("node:os")).homedir();
  const s = await makeServer({ picker: async () => join(home, "Blog") });
  const r = await s.inject({ method: "POST", url: "/api/pick-folder", payload: {} });
  expect(r.json()).toEqual({ path: "~/Blog" });

  const s2 = await makeServer({ picker: async () => null });
  expect(
    (await s2.inject({ method: "POST", url: "/api/pick-folder", payload: {} })).json(),
  ).toEqual({ path: null });

  const s3 = await makeServer({ noPicker: true });
  expect(
    (await s3.inject({ method: "POST", url: "/api/pick-folder", payload: {} })).statusCode,
  ).toBe(501);
});

test("old configuration (repoDir + contentDir) → a single folder", async () => {
  const path = await configFile({
    publish: { repoDir: "~/Work/writing", contentDir: "blog", push: true },
  });
  expect(loadConfig({ DESK_CONFIG: path }).publish).toEqual({
    dir: "~/Work/writing/blog",
    push: true,
  });
});
