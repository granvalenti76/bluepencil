// Server in watch mode + Vite, without extra dependencies (no `concurrently`).
// A single token for the whole development session: the server in watch mode restarts, the token does not.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const token = process.env.DESK_TOKEN ?? randomBytes(32).toString("base64url");
const webPort = process.env.DESK_WEB_PORT ?? "5173";
const webOrigin = `http://127.0.0.1:${webPort}`;
// Fake judgments on the Turbocode draft, to try the margin notes.
const seed = fileURLToPath(
  new URL("../fixtures/judgments/turbocode-draft-12-settembre.json", import.meta.url),
);
const env = {
  ...process.env,
  DESK_TOKEN: token,
  DESK_ALLOWED_ORIGINS: webOrigin,
  DESK_SEED_JUDGMENTS: process.env.DESK_SEED_JUDGMENTS ?? seed,
};

const procs = [
  spawn("npm", ["run", "dev", "-w", "@desk/server"], { stdio: "inherit", env }),
  spawn("npm", ["run", "dev", "-w", "@desk/web"], { stdio: "inherit", env }),
];
console.log(`\nBluepencil (dev): ${webOrigin}/#t=${token}\n`);

const stop = (code = 0) => {
  for (const p of procs) p.kill("SIGTERM");
  process.exit(code);
};
for (const p of procs) p.on("exit", (code) => stop(code ?? 1));
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
