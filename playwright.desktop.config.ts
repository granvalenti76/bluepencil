import { defineConfig } from "@playwright/test";

// Desktop app (Electron): every test starts the real app, which starts its server. It needs the
// interface build (`npm run test:desktop` prepares it).
export default defineConfig({
  testDir: "e2e-desktop",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
});
