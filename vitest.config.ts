import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/{core,server,web}/**/*.test.ts"],
    passWithNoTests: true,
  },
});
