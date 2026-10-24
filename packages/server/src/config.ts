import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface Config {
  draftsDir: string;
  port: number;
  model: { baseUrl: string };
  cloud: { enabled: boolean; baseUrl: string; model: string; apiKeyEnv: string };
  /** `dir`: the folder of published posts; if it is in a git repository, also commit. */
  publish: { dir: string; push: boolean };
  /** The first start: `pending` until the author has chosen a folder and an editor. */
  welcome: "pending" | "done";
}

export const DEFAULT_CONFIG: Config = {
  draftsDir: "~/Bluepencil/drafts",
  port: 4317,
  model: { baseUrl: "http://192.168.1.x:8080/v1" },
  cloud: { enabled: false, baseUrl: "", model: "", apiKeyEnv: "BLUEPENCIL_CLOUD_KEY" },
  publish: { dir: "", push: false },
  // A configuration from before the first-start screen already went through it: it is merged with this.
  welcome: "done",
};

/**
 * The configuration written on the very first start: no folder (the author chooses it, the
 * server does not silently create one) and the first start still to do.
 */
export const FRESH_CONFIG: Config = { ...DEFAULT_CONFIG, draftsDir: "", welcome: "pending" };

/** "A new folder" on the first start. `DESK_NEW_FOLDER` for tests. */
export function newFolderPath(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(expandHome(env.DESK_NEW_FOLDER || "~/Documents/Bluepencil"));
}

export function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : p;
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.DESK_CONFIG ?? defaultConfigPath(env);
}

export function defaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "bluepencil", "config.json");
}

/** Where the configuration lived before the rename (Editorial Desk). */
function legacyConfigPath(env: NodeJS.ProcessEnv): string {
  const base = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "editorial-desk", "config.json");
}

function merge<T>(base: T, over: unknown): T {
  if (typeof base !== "object" || base === null || typeof over !== "object" || over === null) {
    return (over === undefined || typeof over !== typeof base ? base : over) as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    if (k in out) out[k] = merge(out[k], v);
  }
  return out as T;
}

/**
 * Reads `~/.config/bluepencil/config.json` (creating it with the defaults on the first start; if
 * the Editorial Desk one exists, it is copied). The cloud key is never in the file: only the
 * name of the environment variable.
 * `DESK_DRAFTS_DIR` and `DESK_PORT` take precedence (development and tests).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const path = configPath(env);
  if (!env.DESK_CONFIG && !existsSync(path) && existsSync(legacyConfigPath(env))) {
    mkdirSync(dirname(path), { recursive: true });
    copyFileSync(legacyConfigPath(env), path);
  }
  let stored: unknown;
  try {
    stored = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`invalid config.json: ${path}`, { cause: e });
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(FRESH_CONFIG, null, 2) + "\n");
    stored = FRESH_CONFIG;
  }
  const config = merge(structuredClone(DEFAULT_CONFIG), migrate(stored));
  if (env.DESK_DRAFTS_DIR) config.draftsDir = env.DESK_DRAFTS_DIR;
  if (env.DESK_PORT) config.port = Number(env.DESK_PORT);
  // No folder yet (first start): the server starts without drafts.
  if (config.draftsDir.trim() !== "") config.draftsDir = resolve(expandHome(config.draftsDir));
  else config.draftsDir = "";
  if (config.welcome !== "pending") config.welcome = "done";
  // A configuration from before the first-start screen counts as a completed first start only if
  // its folder already has texts: with an empty or missing folder there is nothing to find.
  const legacy = (stored as { welcome?: unknown } | null)?.welcome === undefined;
  if (legacy && !env.DESK_DRAFTS_DIR && !(config.draftsDir && hasMarkdown(config.draftsDir))) {
    config.draftsDir = "";
    config.welcome = "pending";
  }
  return config;
}

/** There is at least one `.md` in the folder or below (hidden folders do not count). */
function hasMarkdown(dir: string, depth = 0): boolean {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (e.isFile() && e.name.endsWith(".md")) return true;
    if (e.isDirectory() && depth < 4 && hasMarkdown(join(dir, e.name), depth + 1)) return true;
  }
  return false;
}

/** Before the simplification: `publish.repoDir` + `publish.contentDir` (relative to the repository). */
function migrate(stored: unknown): unknown {
  const publish = (stored as { publish?: Record<string, unknown> } | undefined)?.publish;
  if (!publish || typeof publish.dir === "string" || typeof publish.repoDir !== "string") {
    return stored;
  }
  const repo = publish.repoDir.trim();
  const content = typeof publish.contentDir === "string" ? publish.contentDir : "";
  return {
    ...(stored as object),
    publish: { ...publish, dir: repo ? join(repo, content) : "" },
  };
}

export interface SettingsPatch {
  draftsDir?: string;
  welcome?: "pending" | "done";
  modelBaseUrl?: string;
  publishDir?: string;
  push?: boolean;
}

/**
 * Writes the settings chosen in the interface to `config.json`, touching only those fields: the
 * others (unknown ones included) stay as they were. The old publishing keys (`repoDir`,
 * `contentDir`) are removed when the folder is chosen.
 */
export function saveSettings(path: string, patch: SettingsPatch): void {
  let stored: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      stored = parsed as Record<string, unknown>;
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`invalid config.json: ${path}`, { cause: e });
    }
  }
  const section = (key: string): Record<string, unknown> => {
    const v = stored[key];
    const obj = v && typeof v === "object" && !Array.isArray(v) ? { ...v } : {};
    stored[key] = obj;
    return obj as Record<string, unknown>;
  };
  if (patch.draftsDir !== undefined) {
    stored.draftsDir = patch.draftsDir;
    // The author chose the folder: even if it is empty, the first start does not come back.
    stored.welcome ??= "done";
  }
  if (patch.welcome !== undefined) stored.welcome = patch.welcome;
  if (patch.modelBaseUrl !== undefined) section("model").baseUrl = patch.modelBaseUrl;
  if (patch.publishDir !== undefined || patch.push !== undefined) {
    const publish = migrate({ publish: section("publish") }) as {
      publish: Record<string, unknown>;
    };
    if (patch.publishDir !== undefined) publish.publish.dir = patch.publishDir;
    if (patch.push !== undefined) publish.publish.push = patch.push;
    delete publish.publish.repoDir;
    delete publish.publish.contentDir;
    stored.publish = publish.publish;
  }
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(stored, null, 2) + "\n");
  renameSync(tmp, path);
}
