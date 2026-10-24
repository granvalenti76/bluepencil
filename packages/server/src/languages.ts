import { watch, type FSWatcher } from "node:fs";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_LANGUAGE,
  draftLanguage,
  parseLanguagePack,
  type LanguagePack,
  type PackFiles,
} from "@desk/core";

/** The packs built into the app. */
export const BUILTIN_LANGUAGES_DIR = fileURLToPath(
  new URL("../../core/languages", import.meta.url),
);

/** The folder of the user's packs, next to `config.json`. */
export const userLanguagesDir = (configPath: string) => join(dirname(configPath), "languages");

/** A pack that could not be loaded, with the reasons. */
export interface PackProblem {
  dir: string;
  errors: string[];
}

/**
 * The files of a pack: relative path (with `/`) → text. Hidden files are skipped; a symbolic link
 * is an error, so a pack cannot read anything outside its folder.
 */
export function readPackFiles(dir: string): { files: PackFiles; errors: string[] } {
  const files: PackFiles = {};
  const errors: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue; // .DS_Store and the like
      const p = join(d, e.name);
      const rel = relative(dir, p).split(sep).join("/");
      if (e.isSymbolicLink()) errors.push(`${rel}: symbolic links are not allowed`);
      else if (e.isDirectory()) walk(p);
      else if (e.isFile()) files[rel] = readFileSync(p, "utf8");
    }
  };
  walk(dir);
  return { files, errors };
}

/** The README that comes with a new pack: what each file contains (in English, for everyone). */
const NEW_PACK_README = `# Language pack

This folder teaches Bluepencil a language. It is plain text: edit it with any editor, then use
Settings ▸ Languages ▸ Reload (or just save: Bluepencil notices). If something is wrong, Settings
shows the file and the problem. The full guide is docs/languages.md in the Bluepencil repository.

- language.json: the language code (must match this folder's name), its name, prompt versions,
  readability formula, words per minute, the footnote text for "Mark as opinion", the file name
  for untitled drafts, words to ignore when searching sources (stopWords), and the most common
  words of the language (commonWords: they let Bluepencil recognize it).
- prompts/*.md: what the model is told, one file per task. Keep the {{placeholders}} and the
  field names the model must fill (annota, citazione, correzione…): they are how Bluepencil reads
  the answers. Ask the model to write in your language.
- prompts/labels.json: short texts around the prompts (headings of the draft context, rewrite
  styles…).
- prompts/tools.json: descriptions of the fields the model fills.
- archetypes/*.json: the types of text, with section titles and checklists in your language.

Bluepencil copied this pack from English: translate the texts, and replace stopWords and
commonWords with your language's. Changing a file invalidates the cached checks in this language.
`;

/**
 * The language packs: the built-in ones and the user's (`~/.config/bluepencil/languages/`).
 * A user pack does not replace `it` or `en`. Without the Italian pack the server does not start:
 * it is the language of every draft without `lang`.
 */
export class Languages {
  private packs = new Map<string, LanguagePack>();
  problems: PackProblem[] = [];
  readonly userDir: string | undefined;
  private readonly builtinDir: string;
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | undefined;

  constructor(opts: { builtinDir?: string; userDir?: string } = {}) {
    this.builtinDir = opts.builtinDir ?? BUILTIN_LANGUAGES_DIR;
    this.userDir = opts.userDir;
    this.reload();
  }

  /** Reloads all the packs (after the files change). */
  reload(): void {
    const packs = new Map<string, LanguagePack>();
    const problems: PackProblem[] = [];
    const load = (dir: string, builtIn: boolean) => {
      // In name order: problems and the list always come out the same.
      const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        const packDir = join(dir, e.name);
        if (e.isSymbolicLink()) {
          problems.push({ dir: packDir, errors: ["symbolic links are not allowed"] });
          continue;
        }
        if (!e.isDirectory()) continue;
        const read = readPackFiles(packDir);
        const parsed = parseLanguagePack(read.files, { builtIn });
        const errors = [...read.errors, ...(parsed.ok ? [] : parsed.errors)];
        if (parsed.ok && parsed.pack.code !== e.name) {
          errors.push(`language.json: code "${parsed.pack.code}" differs from the folder name`);
        }
        if (parsed.ok && !builtIn && packs.has(parsed.pack.code)) {
          errors.push(
            `"${parsed.pack.code}" is a built-in language: copy the folder to a new code (for example ${parsed.pack.code}-x-mine) to make your own version`,
          );
        }
        if (errors.length || !parsed.ok) problems.push({ dir: packDir, errors });
        else packs.set(parsed.pack.code, parsed.pack);
      }
    };
    load(this.builtinDir, true);
    if (this.userDir && existsSync(this.userDir)) load(this.userDir, false);
    if (!packs.has(DEFAULT_LANGUAGE)) {
      const why = problems.map((p) => `${p.dir}: ${p.errors.join("; ")}`).join("\n");
      throw new Error(`The Italian language pack is missing or invalid.\n${why}`);
    }
    this.packs = packs;
    this.problems = problems;
  }

  get(code: string): LanguagePack | undefined {
    return this.packs.get(code);
  }

  list(): LanguagePack[] {
    return [...this.packs.values()];
  }

  codes(): string[] {
    return [...this.packs.keys()];
  }

  /** The pack for a draft from its `lang`; with no pack for that language, Italian. */
  forDraft(lang: unknown): LanguagePack {
    return (
      this.packs.get(draftLanguage(lang, this.codes()).code) ?? this.packs.get(DEFAULT_LANGUAGE)!
    );
  }

  /**
   * A new pack in the user's folder, copied from English: the chosen code and name, versions from
   * scratch, readability without a language formula, no English stop words or common words.
   * Written to a temporary folder and then renamed: either everything is there or nothing.
   */
  create(code: string, name: string): string {
    if (!this.userDir) throw new Error("No folder for language packs");
    const dir = join(this.userDir, code);
    if (existsSync(dir)) throw new Error(`A language pack "${code}" already exists`);
    mkdirSync(this.userDir, { recursive: true });
    const tmp = join(this.userDir, `.${code}.${process.pid}.tmp`);
    rmSync(tmp, { recursive: true, force: true });
    cpSync(join(this.builtinDir, "en"), tmp, { recursive: true });
    const meta = JSON.parse(readFileSync(join(tmp, "language.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const fresh = {
      ...meta,
      code,
      name,
      promptVersions: { system: "1", structure: "1", facts: "1", grammar: "1", prose: "1" },
      readability: { formula: "sentences" },
      stopWords: [],
      commonWords: [],
    };
    writeFileSync(join(tmp, "language.json"), JSON.stringify(fresh, null, 2) + "\n");
    writeFileSync(join(tmp, "README.md"), NEW_PACK_README);
    renameSync(tmp, dir);
    this.reload();
    return dir;
  }

  /** Reloads when the files in the user's folder change (after a pause). */
  watch(onChange: () => void): void {
    if (!this.userDir || this.watcher) return;
    mkdirSync(this.userDir, { recursive: true });
    this.watcher = watch(this.userDir, { recursive: true }, () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        try {
          this.reload();
        } catch {
          // A broken Italian pack cannot come from the user's folder: keep the previous state.
          return;
        }
        onChange();
      }, 300);
    });
  }

  close(): void {
    clearTimeout(this.timer);
    this.watcher?.close();
    this.watcher = null;
  }
}
