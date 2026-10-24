import { existsSync, mkdirSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DEFAULT_LANGUAGE } from "@desk/core";
import { expandHome, newFolderPath, saveSettings, type Config } from "../config.ts";
import { citedFiles } from "../drafts/citations.ts";
import { DraftsRepo } from "../drafts/repo.ts";
import type { DraftWatcher } from "../drafts/watcher.ts";
import type { IndexDb } from "../index-db/index.ts";
import type { Languages } from "../languages.ts";
import { probeModel } from "../model/probe.ts";
import { sampleDraft } from "../welcome/sample.ts";

/** At most this many files are looked at to say what is in a folder (a huge folder does not block). */
const INSPECT_LIMIT = 5000;

const home = (p: string) => p.replace(/^\/(Users|home)\/[^/]+(?=\/|$)/, "~");

const FolderPath = z
  .string()
  .trim()
  .min(1)
  .refine((p) => p === "~" || p.startsWith("~/") || isAbsolute(p), {
    message: "A full path is required (for example ~/Blog/posts).",
  });

const ChooseBody = z
  .union([z.object({ fresh: z.literal(true) }).strict(), z.object({ path: FolderPath }).strict()])
  .optional();

const ProbeBody = z
  .object({ baseUrl: z.string().trim().url(), lang: z.string().optional() })
  .strict();
const FinishBody = z.object({ sample: z.boolean(), lang: z.string().optional() }).strict();

export interface FolderSummary {
  exists: boolean;
  texts: number;
  sources: number;
  /** Last change of a `.md` (ms), `null` if there are none. */
  lastEdited: number | null;
}

/**
 * What is in a folder, without indexing it or writing to it: how many texts, how many cited
 * sources, the last change. The same rules as the index (every `.md` is a text, a source is cited).
 */
export async function inspectFolder(dir: string): Promise<FolderSummary> {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return { exists: false, texts: 0, sources: 0, lastEdited: null };
  }
  const repo = new DraftsRepo(dir);
  const files = (await repo.list()).slice(0, INSPECT_LIMIT);
  const cited = new Set<string>();
  let lastEdited: number | null = null;
  for (const path of files) {
    const file = await repo.read(path);
    lastEdited = Math.max(lastEdited ?? 0, file.mtimeMs);
    for (const to of citedFiles(path, file.text)) cited.add(to);
  }
  const sources = files.filter((f) => cited.has(f)).length;
  return { exists: true, texts: files.length - sources, sources, lastEdited };
}

export interface WelcomeDeps {
  config: Config;
  configPath?: string;
  languages: Languages;
  /** Restarts the server with the saved configuration (same process, port and token). */
  relaunch?: () => void;
  env?: NodeJS.ProcessEnv;
  /** Only once the folder is chosen. */
  drafts?: { repo: DraftsRepo; index: IndexDb; watcher: DraftWatcher };
  /** e2e tests: the first start can begin again from scratch. */
  devReset?: boolean;
}

/**
 * The first start: a single screen, three cards. The folder is created only after it is chosen;
 * once chosen, the server restarts with it.
 */
export function registerWelcomeRoutes(app: FastifyInstance, deps: WelcomeDeps): void {
  const { config, configPath, languages } = deps;
  const env = deps.env ?? process.env;
  const pending = () => config.welcome === "pending";
  const relaunchSoon = () => {
    if (deps.relaunch) setTimeout(deps.relaunch, 50);
    return Boolean(deps.relaunch);
  };
  const save = (patch: Parameters<typeof saveSettings>[1]) => {
    if (configPath) saveSettings(configPath, patch);
  };

  app.get("/api/welcome", async () => ({
    pending: pending(),
    folder: config.draftsDir ? home(config.draftsDir) : null,
    newFolder: home(newFolderPath(env)),
    modelBaseUrl: config.model.baseUrl,
  }));

  app.get<{ Querystring: { path?: string } }>("/api/welcome/inspect", async (req, reply) => {
    if (!pending()) return reply.code(409).send({ error: "done" });
    const parsed = FolderPath.safeParse(req.query.path ?? "");
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    return inspectFolder(resolve(expandHome(parsed.data)));
  });

  app.post<{ Body: unknown }>("/api/welcome/folder", async (req, reply) => {
    if (!pending()) return reply.code(409).send({ error: "done" });
    const parsed = ChooseBody.safeParse(req.body);
    if (!parsed.success || !parsed.data) {
      const message = parsed.success ? "Choose a folder" : parsed.error.issues[0]?.message;
      return reply.code(400).send({ error: "bad_request", message });
    }
    const dir = "fresh" in parsed.data ? newFolderPath(env) : resolve(expandHome(parsed.data.path));
    if (existsSync(dir) && !statSync(dir).isDirectory()) {
      return reply
        .code(400)
        .send({ error: "bad_request", message: "That is a file, not a folder." });
    }
    mkdirSync(dir, { recursive: true });
    // The first start continues after the restart: it must be said, or an older configuration
    // (without `welcome`) would count it as done.
    save({ draftsDir: home(dir), welcome: "pending" });
    config.draftsDir = dir;
    return { folder: home(dir), summary: await inspectFolder(dir), relaunching: relaunchSoon() };
  });

  app.post<{ Body: unknown }>("/api/model/probe", async (req, reply) => {
    const parsed = ProbeBody.safeParse(req.body ?? {});
    if (!parsed.success || !/^https?:\/\//.test(parsed.data.baseUrl)) {
      return reply
        .code(400)
        .send({ error: "bad_request", message: "An http address is required." });
    }
    return probeModel(parsed.data.baseUrl, parsed.data.lang ?? DEFAULT_LANGUAGE, languages);
  });

  app.post<{ Body: unknown }>("/api/welcome/finish", async (req, reply) => {
    if (!pending() || !deps.drafts) return reply.code(409).send({ error: "not_ready" });
    const parsed = FinishBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    let sample: string | null = null;
    if (parsed.data.sample) {
      const { repo, index, watcher } = deps.drafts;
      const draft = sampleDraft(parsed.data.lang ?? DEFAULT_LANGUAGE);
      sample = draft.path;
      if (!(await repo.list()).includes(draft.path)) {
        const file = await repo.write(draft.path, draft.text, null);
        watcher.noteSelfWrite(draft.path, file.hash);
        index.upsert(draft.path, file.text, file.mtimeMs);
      }
    }
    save({ welcome: "done" });
    config.welcome = "done";
    // A model address chosen now applies at once: the model client is created at startup.
    return { sample, relaunching: relaunchSoon() };
  });

  if (deps.devReset) {
    app.post("/api/dev/reset-welcome", async () => {
      if (configPath) await rm(configPath, { force: true });
      return { relaunching: relaunchSoon() };
    });
  }
}
