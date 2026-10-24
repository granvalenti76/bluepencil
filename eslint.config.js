import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "mockup/**", "test-results/**", "playwright-report/**", ".e2e/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["e2e/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" }, // the CodeMirror view is used inside page.evaluate
  },
  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly" } },
  },
  {
    // The desktop app's preload: sandboxed preloads are CommonJS.
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: { require: "readonly" } },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
