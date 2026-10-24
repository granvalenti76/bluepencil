import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLanguagePack, type LanguagePack, type PackFiles } from "../src/index.ts";

export const LANGUAGES_DIR = fileURLToPath(new URL("../languages", import.meta.url));

/** The files of a folder, as the server reads them: relative path → text. */
export function readPackFiles(dir: string): PackFiles {
  const files: PackFiles = {};
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else files[relative(dir, p).split("\\\\").join("/")] = readFileSync(p, "utf8");
    }
  };
  walk(dir);
  return files;
}

/** A pack built into the app, read from disk. */
export function builtinPack(code: string): LanguagePack {
  const parsed = parseLanguagePack(readPackFiles(join(LANGUAGES_DIR, code)), { builtIn: true });
  if (!parsed.ok) throw new Error(`${code}: ${parsed.errors.join("; ")}`);
  return parsed.pack;
}

/** The Italian pack, for the tests that need a language. */
export const IT = builtinPack("it");
