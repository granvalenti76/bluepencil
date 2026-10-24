import {
  E2E_BLOG_DIR,
  E2E_BLOG_REMOTE,
  E2E_CONFIG,
  E2E_DRAFTS_DIR,
  E2E_LLM_PORT,
  E2E_SEED,
  E2E_SERVER_PORT,
  E2E_TOKEN,
  E2E_WEB_PORT,
  E2E_LANGUAGES_DIR,
  E2E_WELCOME_CONFIG,
  E2E_WELCOME_DIR,
  E2E_WELCOME_NEW,
  E2E_WELCOME_NOTES,
  E2E_WELCOME_SERVER_PORT,
  E2E_WELCOME_WEB_PORT,
} from "./e2e/env.ts";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// The test server works on a copy of the fixtures. It must be prepared before the webServer
// starts, and only once: the workers load this file too, but they have TEST_WORKER_INDEX.
if (process.env.TEST_WORKER_INDEX === undefined) {
  rmSync(E2E_DRAFTS_DIR, { recursive: true, force: true });
  rmSync(E2E_LANGUAGES_DIR, { recursive: true, force: true });
  // The first start begins without configuration.
  rmSync(E2E_WELCOME_DIR, { recursive: true, force: true });
  mkdirSync(E2E_WELCOME_DIR, { recursive: true });
  mkdirSync(dirname(E2E_CONFIG), { recursive: true });
  cpSync("fixtures/drafts", E2E_DRAFTS_DIR, { recursive: true });
  // The blog repository for publishing, with a local remote for the push.
  rmSync(E2E_BLOG_DIR, { recursive: true, force: true });
  rmSync(E2E_BLOG_REMOTE, { recursive: true, force: true });
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args]);
  mkdirSync(E2E_BLOG_DIR, { recursive: true });
  mkdirSync(E2E_BLOG_REMOTE, { recursive: true });
  git(E2E_BLOG_REMOTE, "init", "-q", "--bare", "-b", "main");
  git(E2E_BLOG_DIR, "init", "-q", "-b", "main");
  git(E2E_BLOG_DIR, "config", "user.name", "Prova e2e");
  git(E2E_BLOG_DIR, "config", "user.email", "e2e@example.org");
  writeFileSync(`${E2E_BLOG_DIR}/README.md`, "Blog di prova\n");
  git(E2E_BLOG_DIR, "add", ".");
  git(E2E_BLOG_DIR, "commit", "-q", "-m", "inizio");
  git(E2E_BLOG_DIR, "remote", "add", "origin", E2E_BLOG_REMOTE);
  git(E2E_BLOG_DIR, "push", "-q", "-u", "origin", "main");
  writeFileSync(
    E2E_CONFIG,
    JSON.stringify({
      model: { baseUrl: `http://127.0.0.1:${E2E_LLM_PORT}/v1` },
      publish: { dir: `${E2E_BLOG_DIR}/content/posts`, push: true },
    }) + "\n",
  );
}

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: "list",
  // Reduced motion: the interface's animations switch off and measurements are stable.
  use: { baseURL: `http://127.0.0.1:${E2E_WEB_PORT}`, reducedMotion: "reduce" },
  webServer: [
    {
      command: "node packages/server/test/fake-llm-server.ts",
      // A little slowness to see the review's progress (~0.3 s per call).
      env: { FAKE_LLM_PORT: String(E2E_LLM_PORT), FAKE_LLM_CHUNK_DELAY_MS: "2" },
      url: `http://127.0.0.1:${E2E_LLM_PORT}/v1/models`,
      reuseExistingServer: false,
    },
    {
      command: "npm run dev",
      env: {
        DESK_TOKEN: E2E_TOKEN,
        DESK_DRAFTS_DIR: E2E_DRAFTS_DIR,
        DESK_CONFIG: E2E_CONFIG,
        DESK_PORT: String(E2E_SERVER_PORT),
        DESK_WEB_PORT: String(E2E_WEB_PORT),
        DESK_SEED_JUDGMENTS: E2E_SEED,
        DESK_REVEAL: "off",
        // The Finder's "Choose…" answers by itself with the test posts folder.
        DESK_PICK_FOLDER: `${E2E_BLOG_DIR}/content/posts`,
        // Never the real report in docs/: the chips all start switched on (the off case is simulated).
        DESK_EVAL_REPORT: `${E2E_DRAFTS_DIR}/../eval-report.json`,
      },
      url: `http://127.0.0.1:${E2E_WEB_PORT}`,
      // Never reuse a server already running: it could be the author's, with their drafts.
      reuseExistingServer: false,
    },
    {
      // The first start: no folder, no configuration; start over with
      // `POST /api/dev/reset-welcome`.
      command: "npm run dev",
      env: {
        DESK_TOKEN: E2E_TOKEN,
        DESK_CONFIG: E2E_WELCOME_CONFIG,
        DESK_PORT: String(E2E_WELCOME_SERVER_PORT),
        DESK_WEB_PORT: String(E2E_WELCOME_WEB_PORT),
        DESK_REVEAL: "off",
        DESK_PICK_FOLDER: E2E_WELCOME_NOTES,
        DESK_NEW_FOLDER: E2E_WELCOME_NEW,
        DESK_DEV_RESET: "1",
        DESK_EVAL_REPORT: `${E2E_WELCOME_DIR}/eval-report.json`,
      },
      url: `http://127.0.0.1:${E2E_WELCOME_WEB_PORT}`,
      reuseExistingServer: false,
    },
  ],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /welcome\.spec\.ts/ },
    { name: "webkit", use: { ...devices["Desktop Safari"] }, testIgnore: /welcome\.spec\.ts/ },
    // The first start has a single server: one engine first, then the other.
    {
      name: "welcome-chromium",
      testMatch: /welcome\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${E2E_WELCOME_WEB_PORT}` },
    },
    {
      name: "welcome-webkit",
      testMatch: /welcome\.spec\.ts/,
      dependencies: ["welcome-chromium"],
      use: { ...devices["Desktop Safari"], baseURL: `http://127.0.0.1:${E2E_WELCOME_WEB_PORT}` },
    },
  ],
});
