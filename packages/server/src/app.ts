import { registerHabitRoutes } from "./routes/habits.ts";
import { registerAuthorshipRoutes } from "./routes/authorship.ts";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import type { Config } from "./config.ts";
import { DraftsRepo } from "./drafts/repo.ts";
import { DraftWatcher } from "./drafts/watcher.ts";
import { EventBus } from "./events.ts";
import { IndexDb } from "./index-db/index.ts";
import { CheckCache } from "./index-db/check-cache.ts";
import { Search } from "./index-db/search.ts";
import { JudgmentsStore } from "./index-db/judgments.ts";
import { ReviewRunner } from "./review/runner.ts";
import { FileSources } from "./review/sources.ts";
import { LettersStore } from "./index-db/letters.ts";
import { PassesStore } from "./index-db/passes.ts";
import { ScoresStore } from "./index-db/scores.ts";
import { registerReviewRoutes } from "./routes/review.ts";
import { registerRevealRoutes, type Opener } from "./routes/reveal.ts";
import { registerProposalRoutes } from "./routes/proposals.ts";
import { ModelService, type ModelServiceOptions } from "./model/service.ts";
import { seedJudgments } from "./judgments-seed.ts";
import { registerDraftRoutes } from "./routes/drafts.ts";
import { registerEventRoutes } from "./routes/events.ts";
import { registerJudgmentRoutes } from "./routes/judgments.ts";
import { registerModelRoutes } from "./routes/model.ts";
import { registerStructureRoutes } from "./routes/structure.ts";
import { registerSourceRoutes } from "./routes/sources.ts";
import { registerPublishRoutes } from "./routes/publish.ts";
import { registerSettingsRoutes, systemPicker, type FolderPicker } from "./routes/settings.ts";
import { registerEvalRoutes } from "./routes/eval.ts";
import { Publisher } from "./publish/publisher.ts";
import { Languages, userLanguagesDir } from "./languages.ts";
import { registerLanguageRoutes } from "./routes/languages.ts";
import { registerSecurity } from "./security.ts";
import { registerWelcomeRoutes } from "./routes/welcome.ts";
import { registerStyleRoutes } from "./routes/styles.ts";

export interface AppOptions {
  config: Config;
  token: string;
  /** Folder of the web build to serve (`npm start` only). */
  staticDir?: string;
  /** Extra allowed origins (development: the page served by Vite). */
  extraOrigins?: string[];
  /** Development and tests only: JSON file with fake judgments to load. */
  seedFile?: string;
  /** For tests: no watching of the folder. */
  watch?: boolean;
  /** `docs/eval-report.json`: decides which passes start switched on in the "Show" chips. */
  evalReport?: string;
  /** How the Finder is opened (in tests, a function that records the call). */
  opener?: Opener;
  /** Where to save the settings chosen in the interface (without: in memory only, for tests). */
  configPath?: string;
  /** The folder picker (in tests, a function that answers by itself; `null`: none). */
  picker?: FolderPicker | null;
  /** Periodic check of llama-server; in tests `pollMs: 0`. */
  model?: ModelServiceOptions;
  /** The language packs (tests can pass others). */
  languages?: Languages;
  /** Restarts the server with the configuration just saved (first start). */
  relaunch?: () => void;
  /** e2e tests: `POST /api/dev/reset-welcome` starts the first start over. */
  devReset?: boolean;
}

/** One id per launch: the page can tell the server has restarted (first start). */
const newBoot = () => randomUUID();

/**
 * First start without a folder: no drafts and no index, only what is needed to choose the folder
 * and try the editor. Once the folder is chosen, the server restarts.
 */
export async function buildSetupApp(options: AppOptions) {
  const { config } = options;
  const app = Fastify({ logger: false, forceCloseConnections: true });
  const boot = newBoot();
  const languages = loadLanguages(options);
  const bus = new EventBus();
  const model = new ModelService(config, bus, options.model);
  registerSecurity(app, {
    token: options.token,
    port: config.port,
    extraOrigins: options.extraOrigins,
  });
  app.get("/api/health", async () => ({ ok: true, boot }));
  registerEventRoutes(app, bus);
  registerModelRoutes(app, model);
  registerLanguageRoutes(app, { languages, bus, opener: options.opener });
  registerSettingsRoutes(app, {
    config,
    configPath: options.configPath,
    picker: options.picker === undefined ? systemPicker : options.picker,
  });
  registerWelcomeRoutes(app, {
    config,
    configPath: options.configPath,
    languages,
    relaunch: options.relaunch,
    devReset: options.devReset,
  });
  await serveStatic(app, options.staticDir);
  model.start();
  app.addHook("onClose", async () => {
    languages.close();
    model.stop();
  });
  return { app, scan: { indexed: [], removed: [], unchanged: 0 } };
}

function loadLanguages(options: AppOptions): Languages {
  // The user's packs live next to `config.json` (in tests: none, unless `languages`).
  return (
    options.languages ??
    new Languages({
      userDir: options.configPath ? userLanguagesDir(options.configPath) : undefined,
    })
  );
}

async function serveStatic(app: FastifyInstance, staticDir?: string) {
  if (!staticDir || !existsSync(staticDir)) return;
  await app.register(fastifyStatic, { root: staticDir });
  // No client-side router: /lab and the other pages fall back to index.html.
  app.setNotFoundHandler((req, reply) => {
    if (req.method === "GET" && !req.url.startsWith("/api/")) return reply.sendFile("index.html");
    return reply.code(404).send({ error: "not_found" });
  });
}

export async function buildApp(options: AppOptions) {
  const { config } = options;
  mkdirSync(config.draftsDir, { recursive: true });

  // Closing also closes the open connections (the tab's SSE): without this, Ctrl+C does not stop it.
  const app = Fastify({ logger: false, forceCloseConnections: true });
  const boot = newBoot();
  const languages = loadLanguages(options);
  const repo = new DraftsRepo(config.draftsDir);
  const index = new IndexDb(config.draftsDir);
  const judgments = new JudgmentsStore(index);
  const bus = new EventBus();
  const watcher = new DraftWatcher(repo, index, bus);
  const model = new ModelService(config, bus, options.model);
  const search = new Search(index);
  const sources = new FileSources(search);
  const scores = new ScoresStore(index);
  const passes = new PassesStore(index);
  const letters = new LettersStore(index);
  const runner = new ReviewRunner({
    languages,
    repo,
    store: judgments,
    cache: new CheckCache(index),
    scores,
    passes,
    letters,
    model,
    bus,
    draftsDir: config.draftsDir,
    sources,
  });

  registerSecurity(app, {
    token: options.token,
    port: config.port,
    extraOrigins: options.extraOrigins,
  });

  app.get("/api/health", async () => ({ ok: true, boot }));
  registerDraftRoutes(app, { repo, index, watcher, languages });
  registerLanguageRoutes(app, {
    languages,
    bus,
    opener: options.opener,
  });
  if (options.watch !== false) languages.watch(() => bus.emit({ type: "languages.changed" }));
  registerJudgmentRoutes(app, { repo, store: judgments, seedFile: options.seedFile });
  registerEventRoutes(app, bus);
  registerModelRoutes(app, model);
  registerStructureRoutes(app, model, languages);
  registerReviewRoutes(app, { repo, runner, scores, passes, letters });
  registerProposalRoutes(app, {
    repo,
    store: judgments,
    model,
    draftsDir: config.draftsDir,
    languages,
  });
  registerSourceRoutes(app, { repo, search, sources, store: judgments, languages });
  registerPublishRoutes(app, new Publisher(config.publish, repo));
  registerEvalRoutes(app, options.evalReport);
  registerRevealRoutes(app, { repo, opener: options.opener });
  registerAuthorshipRoutes(app, { repo, draftsDir: config.draftsDir });
  registerHabitRoutes(app, { repo, index, store: judgments, languages });
  registerStyleRoutes(app, { repo, index, watcher, languages, model });
  registerSettingsRoutes(app, {
    config,
    configPath: options.configPath,
    picker: options.picker === undefined ? systemPicker : options.picker,
  });
  registerWelcomeRoutes(app, {
    config,
    configPath: options.configPath,
    languages,
    relaunch: options.relaunch,
    drafts: { repo, index, watcher },
    devReset: options.devReset,
  });

  await serveStatic(app, options.staticDir);

  const scan = await index.scan(repo);
  if (options.seedFile) await seedJudgments(repo, judgments, options.seedFile);
  if (options.watch !== false) await watcher.start();
  model.start();

  app.addHook("onClose", async () => {
    languages.close();
    model.stop();
    await runner.close();
    await watcher.close();
    index.close();
  });

  return { app, repo, index, judgments, bus, watcher, model, runner, search, scan, languages };
}
