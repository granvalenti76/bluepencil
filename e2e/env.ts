import { resolve } from "node:path";

/** The e2e dev server works on a copy of the fixtures, never on the originals. */
export const E2E_TOKEN = "e2e-token";
export const E2E_DRAFTS_DIR = resolve(".e2e/drafts");
export const E2E_CONFIG = resolve(".e2e/config.json");
/** The user's language packs live next to config.json. */
export const E2E_LANGUAGES_DIR = resolve(".e2e/languages");

/** Ports dedicated to the tests: they do not clash with an `npm run dev` already running. */
export const E2E_WEB_PORT = 5273;
export const E2E_SERVER_PORT = 4417;
export const E2E_SEED = resolve("fixtures/judgments/turbocode-draft-12-settembre.json");

/** Fake llama-server (packages/server/test/fake-llm-server.ts). */
export const E2E_LLM_PORT = 4499;

/** The blog repository for publishing and its remote. */
export const E2E_BLOG_DIR = resolve(".e2e/blog");
export const E2E_BLOG_REMOTE = resolve(".e2e/blog-remote.git");

/**
 * The first start has a server of its own: it starts without configuration, chooses a folder and
 * restarts. It does not touch the other tests' one.
 */
export const E2E_WELCOME_DIR = resolve(".e2e/welcome");
export const E2E_WELCOME_CONFIG = resolve(".e2e/welcome/config.json");
/** The folder "you already use" (the fake Finder picks it) and the "new" one. */
export const E2E_WELCOME_NOTES = resolve(".e2e/welcome/notes");
export const E2E_WELCOME_NEW = resolve(".e2e/welcome/new/Bluepencil");
export const E2E_WELCOME_WEB_PORT = 5274;
export const E2E_WELCOME_SERVER_PORT = 4418;
