import { spawnSync, spawn } from "node:child_process";

const build = spawnSync("npm", ["run", "build"], { stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

const server = spawn("npm", ["run", "start", "-w", "@desk/server"], {
  stdio: "inherit",
  env: { ...process.env, DESK_STATIC: "1", DESK_OPEN: "1" },
});
server.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => server.kill("SIGINT"));
process.on("SIGTERM", () => server.kill("SIGTERM"));
