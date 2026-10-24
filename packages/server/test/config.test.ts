import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { DEFAULT_CONFIG, FRESH_CONFIG, loadConfig } from "../src/config.ts";

async function tmp() {
  return join(await mkdtemp(join(tmpdir(), "desk-config-")), "sub", "config.json");
}

test("on the first start it creates the file with the defaults, without a folder (the author chooses it)", async () => {
  const path = await tmp();
  const c = loadConfig({ DESK_CONFIG: path });
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual(FRESH_CONFIG);
  expect(c.port).toBe(4317);
  expect(c.draftsDir).toBe("");
  expect(c.welcome).toBe("pending");
  expect(c.cloud.enabled).toBe(false);
});

test("a configuration without a folder, after the first start, takes the old default one", async () => {
  const path = await tmp();
  loadConfig({ DESK_CONFIG: path });
  await writeFile(path, JSON.stringify({ port: 5000, welcome: "done" }));
  expect(loadConfig({ DESK_CONFIG: path }).draftsDir).toBe(join(homedir(), "Bluepencil", "drafts"));
});

test("a configuration from before the first-start screen skips it only if its folder has texts", async () => {
  const path = await tmp();
  const drafts = join(path, "..", "bozze");
  await mkdir(join(drafts, ".bluepencil"), { recursive: true });
  await writeFile(join(drafts, ".bluepencil", "nota.md"), "nascosta");
  await writeFile(path, JSON.stringify({ draftsDir: drafts, model: { baseUrl: "http://x/v1" } }));
  // Empty folder (only the index): first start, without a folder; the model stays.
  expect(loadConfig({ DESK_CONFIG: path })).toMatchObject({
    welcome: "pending",
    draftsDir: "",
    model: { baseUrl: "http://x/v1" },
  });
  await mkdir(join(drafts, "2026"), { recursive: true });
  await writeFile(join(drafts, "2026", "pezzo.md"), "# Pezzo\n");
  expect(loadConfig({ DESK_CONFIG: path })).toMatchObject({ welcome: "done", draftsDir: drafts });
  // A folder that does not exist: first start.
  await writeFile(path, JSON.stringify({ draftsDir: join(drafts, "manca") }));
  expect(loadConfig({ DESK_CONFIG: path }).welcome).toBe("pending");
});

test("the file's values are merged with the defaults", async () => {
  const path = await tmp();
  loadConfig({ DESK_CONFIG: path });
  await writeFile(
    path,
    JSON.stringify({
      port: 5000,
      model: { baseUrl: "http://10.0.0.2:8080/v1" },
      draftsDir: "/tmp/mie",
      welcome: "done",
    }),
  );
  const c = loadConfig({ DESK_CONFIG: path });
  expect(c).toMatchObject({
    port: 5000,
    draftsDir: "/tmp/mie",
    model: { baseUrl: "http://10.0.0.2:8080/v1" },
    publish: { dir: "", push: false },
  });
});

test("environment variables take precedence and a wrong type falls back to the default", async () => {
  const path = await tmp();
  loadConfig({ DESK_CONFIG: path });
  await writeFile(path, JSON.stringify({ port: "boh" }));
  const c = loadConfig({ DESK_CONFIG: path, DESK_DRAFTS_DIR: "/tmp/altra", DESK_PORT: "4400" });
  expect(c).toMatchObject({ draftsDir: "/tmp/altra", port: 4400 });
  expect(loadConfig({ DESK_CONFIG: path }).port).toBe(4317);
});

test("an unreadable config.json is a clear error", async () => {
  const path = await tmp();
  loadConfig({ DESK_CONFIG: path });
  await writeFile(path, "{ non json");
  expect(() => loadConfig({ DESK_CONFIG: path })).toThrow(/invalid config\.json/);
});

test("the cloud key is not in the file: only the variable's name", () => {
  expect(JSON.stringify(DEFAULT_CONFIG)).not.toMatch(/apiKey"/);
  expect(DEFAULT_CONFIG.cloud.apiKeyEnv).toBe("BLUEPENCIL_CLOUD_KEY");
});

test("rename: the Editorial Desk configuration is copied to bluepencil", async () => {
  const base = await mkdtemp(join(tmpdir(), "desk-xdg-"));
  const legacy = join(base, "editorial-desk", "config.json");
  await mkdir(join(base, "editorial-desk"), { recursive: true });
  const old = join(base, "vecchie");
  await mkdir(old);
  await writeFile(join(old, "bozza.md"), "# Bozza\n");
  await writeFile(legacy, JSON.stringify({ port: 5111, draftsDir: old }));
  const c = loadConfig({ XDG_CONFIG_HOME: base });
  expect(c).toMatchObject({ port: 5111, draftsDir: old, welcome: "done" });
  expect(JSON.parse(await readFile(join(base, "bluepencil", "config.json"), "utf8")).port).toBe(
    5111,
  );
  expect(JSON.parse(await readFile(legacy, "utf8")).port).toBe(5111); // the original stays
});
