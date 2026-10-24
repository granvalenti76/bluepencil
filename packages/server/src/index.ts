import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildApp, buildSetupApp, type AppOptions } from "./app.ts";
import { configPath, loadConfig } from "./config.ts";
import { generateToken } from "./security.ts";

const HOST = "127.0.0.1";
const token = process.env.DESK_TOKEN || generateToken();

const staticDir =
  process.env.DESK_STATIC === "1"
    ? fileURLToPath(new URL("../../web/dist", import.meta.url))
    : undefined;

let current: Awaited<ReturnType<typeof buildApp | typeof buildSetupApp>>["app"] | null = null;
let starting: Promise<void> | null = null;

/**
 * Starts the server with the configuration on disk. Without a folder (first start) only the
 * welcome runs; once the folder is chosen, `relaunch` restarts it in the same process, on the
 * same port and with the same token: the open page stays valid.
 */
async function start(first: boolean) {
  const config = loadConfig();
  const options: AppOptions = {
    config,
    token,
    staticDir,
    seedFile: process.env.DESK_SEED_JUDGMENTS,
    evalReport:
      process.env.DESK_EVAL_REPORT ??
      fileURLToPath(new URL("../../../docs/eval-report.json", import.meta.url)),
    extraOrigins: process.env.DESK_ALLOWED_ORIGINS?.split(",").filter(Boolean),
    // In e2e tests "Show in Finder" must not open real windows.
    ...(process.env.DESK_REVEAL === "off" ? { opener: async () => {} } : {}),
    configPath: configPath(),
    // In e2e tests the folder picker answers by itself with this path.
    ...(process.env.DESK_PICK_FOLDER
      ? { picker: async () => process.env.DESK_PICK_FOLDER ?? null }
      : {}),
    relaunch,
    devReset: process.env.DESK_DEV_RESET === "1",
  };
  const built = config.draftsDir ? await buildApp(options) : await buildSetupApp(options);
  await built.app.listen({ host: HOST, port: config.port });
  current = built.app;

  if (!first) {
    console.log(`Bluepencil restarted: ${config.draftsDir || "no folder yet"}`);
    return;
  }
  // The token is in the fragment (it does not travel to the server or end up in logs).
  const url = `http://${HOST}:${config.port}/#t=${token}`;
  console.log(`Bluepencil listening on ${url}`);
  if (config.draftsDir) {
    const { scan } = built;
    console.log(
      `Drafts: ${config.draftsDir} (${scan.indexed.length} indexed, ${scan.unchanged} unchanged)`,
    );
  } else {
    console.log("First launch: choose your folder in the app.");
  }
  if (process.env.DESK_OPEN === "1") execFile("open", [url]);
}

function relaunch() {
  if (starting) return;
  starting = (async () => {
    await current?.close();
    current = null;
    await start(false);
  })().finally(() => {
    starting = null;
  });
}

await start(true);

let stopping = false;
const stop = () => {
  // On the second Ctrl+C (or if closing gets stuck) exit at once.
  if (stopping) process.exit(1);
  stopping = true;
  setTimeout(() => process.exit(0), 2000).unref();
  void (current?.close() ?? Promise.resolve()).then(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
