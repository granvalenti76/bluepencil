import { cp, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { InjectOptions } from "fastify";
import type { Opener } from "../src/routes/reveal.ts";
import type { FolderPicker } from "../src/routes/settings.ts";
import { buildApp } from "../src/app.ts";
import { DEFAULT_CONFIG, type Config } from "../src/config.ts";

export const TOKEN = "test-token";
export const FIXTURES = fileURLToPath(new URL("../../../fixtures/drafts", import.meta.url));

const cleanups: (() => Promise<unknown>)[] = [];
export async function cleanupAll() {
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

export async function tempDrafts(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "desk-drafts-"));
  await cp(FIXTURES, dir, { recursive: true });
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

export const SEED_FILE = fileURLToPath(
  new URL("../../../fixtures/judgments/turbocode-draft-12-settembre.json", import.meta.url),
);

export async function makeServer(
  opts: {
    dir?: string;
    port?: number;
    watch?: boolean;
    seedFile?: string;
    modelUrl?: string;
    config?: Partial<Config>;
    env?: NodeJS.ProcessEnv;
    evalReport?: string;
    opener?: Opener;
    configPath?: string;
    picker?: FolderPicker;
    noPicker?: boolean;
  } = {},
) {
  const dir = opts.dir ?? (await tempDrafts());
  const port = opts.port ?? 4317;
  const built = await buildApp({
    config: {
      ...DEFAULT_CONFIG,
      // Never the real network in tests: without a fake server the model points to a closed port.
      model: { baseUrl: opts.modelUrl ?? "http://127.0.0.1:9/v1" },
      ...opts.config,
      draftsDir: dir,
      port,
    },
    model: { pollMs: 0, busyPollMs: 20, env: opts.env ?? {} },
    token: TOKEN,
    watch: opts.watch ?? false,
    seedFile: opts.seedFile,
    evalReport: opts.evalReport,
    // Never the real Finder in tests.
    opener: opts.opener ?? (async () => {}),
    configPath: opts.configPath,
    // Never the real picker in tests: with no instructions it answers "cancelled".
    picker: opts.noPicker ? null : (opts.picker ?? (async () => null)),
  });
  cleanups.push(() => built.app.close());
  const headers = { host: `127.0.0.1:${port}`, "x-desk-token": TOKEN };
  return {
    ...built,
    dir,
    port,
    headers,
    /** A valid request (right host and token) that can be overridden. */
    inject: (o: InjectOptions) =>
      built.app.inject({ ...o, headers: { ...headers, ...(o.headers as object) } }),
    close: async () => built.app.close(),
  };
}
