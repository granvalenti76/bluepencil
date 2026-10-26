import { z } from "zod";
import { ARCHETYPE_SKELETONS } from "../archetypes/skeletons.ts";
import type { Archetype } from "../archetypes/types.ts";
import { REVIEW_STEPS, type ReviewStep } from "../judgments/schema.ts";
import { StyleLexiconSchema, type StyleLexicon } from "../style/measures.ts";
import { placeholdersIn } from "./template.ts";

/**
 * Language pack: everything that depends on the draft's language, in text files. The same files
 * for the built-in packs (`packages/core/languages/`) and the users' ones. Here the format and
 * the validation; reading the files from disk is the server's job.
 */

/** The prompts, one per file in `prompts/<name>.md`, with the allowed and required placeholders. */
export const PROMPT_FILES = {
  system: { allowed: [], required: [] },
  structure: { allowed: ["genre", "name"], required: ["genre"] },
  "structure-score": { allowed: [], required: [] },
  facts: { allowed: [], required: [] },
  grammar: { allowed: [], required: [] },
  prose: { allowed: [], required: [] },
  "prose-score": { allowed: [], required: [] },
  focus: { allowed: [], required: [] },
  outline: { allowed: [], required: [] },
  section: { allowed: ["context"], required: ["context"] },
  rewrite: { allowed: ["goal", "context"], required: ["goal", "context"] },
  repair: { allowed: ["error"], required: ["error"] },
} as const satisfies Record<string, { allowed: readonly string[]; required: readonly string[] }>;
export type PromptName = keyof typeof PROMPT_FILES;

/**
 * Optional prompts: a pack without them still loads, without that feature. The editor's letter
 * goes with `letter` and `letterText` in `prompts/tools.json`. The editor's first words on the
 * first start are `greeting`. Styles need `style-traits` (putting a style's schema into words) and
 * `style-note` (the editor's note on a draft beside a style).
 */
export const OPTIONAL_PROMPT_FILES = {
  letter: { allowed: [], required: [] },
  greeting: { allowed: [], required: [] },
  "style-traits": { allowed: [], required: [] },
  "style-note": { allowed: [], required: [] },
} as const satisfies Record<string, { allowed: readonly string[]; required: readonly string[] }>;
export type OptionalPromptName = keyof typeof OPTIONAL_PROMPT_FILES;

/** Short prompt texts (`prompts/labels.json`), with the allowed placeholders for each. */
const LABEL_PLACEHOLDERS = {
  context: {
    heading: [],
    title: ["title"],
    type: ["name"],
    typeNone: [],
    brief: [],
    glossary: [],
    style: [],
    ignored: [],
    ignoredItem: ["quote"],
  },
  review: {
    text: [],
    sources: [],
    sourceOpen: ["ref"],
    sourceClose: [],
    sourcesNone: [],
    footnotes: [],
  },
  structure: {
    genre: ["name"],
    genrePart: ["title", "guidance"],
    genreTraits: [],
    genreTrait: ["description"],
    genreNone: [],
    name: ["name"],
    nameNone: [],
  },
  outline: {
    type: ["name"],
    sections: ["sections"],
    section: ["title", "percent", "guidance"],
    sectionSeparator: [],
    checklist: ["items"],
    rules: ["rules"],
    target: ["target"],
    topic: [],
    noTopic: [],
  },
  section: {
    draft: ["title", "target"],
    regenerate: ["title", "target"],
    reason: ["reason"],
    before: [],
    current: [],
    after: [],
  },
  rewrite: { text: [], passage: [] },
  /** Texts the app adds to the model's notes (in the draft's language). */
  notes: { suggestion: ["text"] },
} as const;

type LabelGroups = typeof LABEL_PLACEHOLDERS;
export type PromptLabels = {
  [G in keyof LabelGroups]: { [K in keyof LabelGroups[G]]: string };
} & { rewrite: { goals: Record<RewriteGoal, string> } };

export const REWRITE_GOALS = ["concise", "clear", "fluent", "creative"] as const;
type RewriteGoal = (typeof REWRITE_GOALS)[number];

/**
 * The fields the model fills in, per analysis, in the order it receives them. The names are the
 * contract with the response reader (`review/analysis.ts`) and stay the same in every language;
 * the descriptions come from the pack (`prompts/tools.json`).
 */
export const NOTE_FIELDS: Record<
  ReviewStep,
  { name: string; enum?: readonly string[]; required: boolean }[]
> = {
  grammar: [
    { name: "citazione", required: true },
    { name: "correzione", required: true },
    { name: "spiegazione", required: false },
  ],
  prose: [
    { name: "citazione", required: true },
    { name: "problema", required: true },
    { name: "proposta", required: false },
  ],
  structure: [
    { name: "citazione", required: false },
    { name: "osservazione", required: true },
    { name: "proposta", required: false },
  ],
  facts: [
    { name: "citazione", required: true },
    { name: "esito", enum: ["verificato", "da_verificare", "senza_fonte"], required: true },
    { name: "spiegazione", required: false },
    { name: "correzione", required: false },
  ],
};

export interface ToolTexts {
  note: string;
  score: string;
  scoreReason: string;
  /** The "letter" tool and its "text" field (optional, with `prompts/letter.md`). */
  letter?: string;
  letterText?: string;
  fields: Record<ReviewStep, Record<string, string>>;
}

export const READABILITY_FORMULAS = ["gulpease", "flesch", "sentences"] as const;

/**
 * A language's readability formula. Gulpease (Italian) counts letters; Flesch and its
 * adaptations (English; Spanish with Szigriszt-Pazos, French with Kandel and Moles, German with
 * Amstad) change only the coefficients and count syllables as groups of vowels.
 */
export const ReadabilitySchema = z.discriminatedUnion("formula", [
  z.strictObject({ formula: z.literal("gulpease") }),
  /** For languages without their own formula: sentence length, no score. */
  z.strictObject({ formula: z.literal("sentences") }),
  z.strictObject({
    formula: z.literal("flesch"),
    base: z.number(),
    perSentence: z.number(),
    perSyllable: z.number(),
    /** The language's vowels (lowercase, without accents: accents are removed first). */
    vowels: z.string().regex(/^[a-z]+$/, "lowercase letters without accents"),
    /** Silent final "e" (English, French): "make" has one syllable. */
    silentE: z.boolean().optional(),
  }),
]);
export type ReadabilityConfig = z.infer<typeof ReadabilitySchema>;

export interface LanguagePack {
  code: string;
  name: string;
  /** Built into the app (`it`, `en`) or the user's. */
  builtIn: boolean;
  /**
   * Appended to the prompt versions: empty for Italian (the versions stay as they always were),
   * `-<code>` for the other built-in packs, `-<code>-<fingerprint>` for the user's, so editing
   * one of its files invalidates that language's cache.
   */
  versionSuffix: string;
  promptVersions: Record<"system" | ReviewStep, string>;
  prompts: Record<PromptName, string> & Partial<Record<OptionalPromptName, string>>;
  labels: PromptLabels;
  tools: ToolTexts;
  archetypes: Archetype[];
  readability: ReadabilityConfig;
  wordsPerMinute: number;
  /** Note text for "Mark as opinion". */
  opinionNote: string;
  /** File name for a draft whose title has no Latin letters. */
  untitledSlug: string;
  /** A capitalised word suggests a proper noun (not true in German). */
  capitalizedNames: boolean;
  /** Words to ignore when searching the sources. */
  stopWords: string[];
  /** The most frequent words of the language: used to recognise it. */
  commonWords: string[];
  /** Intensifying adverbs ("completamente", "really"): a habit to count. Optional. */
  intensifiers?: string[];
  /** The words a style's schema needs (connectives, openers, tenses…). Optional. */
  style?: StyleLexicon;
}

const nonEmpty = z.string().min(1);

const LanguageJson = z.strictObject({
  code: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{1,8})*$/, "a BCP 47 code such as es or pt-BR"),
  name: nonEmpty,
  promptVersions: z.strictObject({
    system: nonEmpty,
    structure: nonEmpty,
    facts: nonEmpty,
    grammar: nonEmpty,
    prose: nonEmpty,
  }),
  readability: ReadabilitySchema,
  wordsPerMinute: z.number().int().min(50).max(1000),
  opinionNote: nonEmpty,
  untitledSlug: z.string().regex(/^[a-z0-9-]+$/, "lowercase letters, digits and dashes"),
  capitalizedNames: z.boolean(),
  stopWords: z.array(nonEmpty),
  commonWords: z.array(nonEmpty),
  intensifiers: z.array(nonEmpty).optional(),
  style: StyleLexiconSchema.optional(),
});

const labelsSchema = () => {
  const groups: Record<string, z.ZodType> = {};
  for (const [g, keys] of Object.entries(LABEL_PLACEHOLDERS)) {
    const shape: Record<string, z.ZodType> = {};
    for (const k of Object.keys(keys)) shape[k] = z.string();
    if (g === "rewrite") {
      shape.goals = z.strictObject(
        Object.fromEntries(REWRITE_GOALS.map((r) => [r, nonEmpty])) as Record<string, z.ZodString>,
      );
    }
    groups[g] = z.strictObject(shape);
  }
  return z.strictObject(groups);
};

const toolsSchema = () =>
  z.strictObject({
    note: nonEmpty,
    score: nonEmpty,
    scoreReason: nonEmpty,
    letter: nonEmpty.optional(),
    letterText: nonEmpty.optional(),
    fields: z.strictObject(
      Object.fromEntries(
        REVIEW_STEPS.map((step) => [
          step,
          z.strictObject(
            Object.fromEntries(
              NOTE_FIELDS[step].filter((f) => !f.enum).map((f) => [f.name, nonEmpty]),
            ) as Record<string, z.ZodString>,
          ),
        ]),
      ) as Record<string, z.ZodType>,
    ),
  });

const archetypeSchema = (sections: string[], checklist: string[]) =>
  z.strictObject({
    name: nonEmpty,
    shortName: nonEmpty,
    sections: z.strictObject(
      Object.fromEntries(
        sections.map((id) => [id, z.strictObject({ title: nonEmpty, guidance: nonEmpty })]),
      ),
    ),
    checklist: z.strictObject(Object.fromEntries(checklist.map((id) => [id, nonEmpty]))),
    proseRules: z.array(nonEmpty),
  });

export type PackFiles = Record<string, string>;
export type ParsedPack = { ok: true; pack: LanguagePack } | { ok: false; errors: string[] };

/** Text file: drop the trailing newline that editors add. */
const textOf = (s: string) => s.replace(/\r\n/g, "\n").replace(/\n$/, "");

/**
 * Reads a pack from its files (relative path → content). Every problem becomes a readable
 * message, with the file: a pack with an error does not load.
 */
export function parseLanguagePack(files: PackFiles, opts: { builtIn: boolean }): ParsedPack {
  const errors: string[] = [];
  const json = <T>(path: string, schema: z.ZodType<T>): T | undefined => {
    const raw = files[path];
    if (raw === undefined) {
      errors.push(`${path}: missing`);
      return undefined;
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (e) {
      errors.push(`${path}: invalid JSON (${(e as Error).message})`);
      return undefined;
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const where = issue.path.length ? ` at ${issue.path.join(".")}` : "";
        errors.push(`${path}${where}: ${issue.message}`);
      }
      return undefined;
    }
    return parsed.data;
  };
  const checkPlaceholders = (
    where: string,
    text: string,
    allowed: readonly string[],
    required: readonly string[] = [],
  ) => {
    const used = placeholdersIn(text);
    for (const p of used) {
      if (!allowed.includes(p)) {
        errors.push(
          `${where}: unknown placeholder {{${p}}}${allowed.length ? ` (allowed: ${allowed.map((a) => `{{${a}}}`).join(", ")})` : ""}`,
        );
      }
    }
    for (const p of required) if (!used.includes(p)) errors.push(`${where}: {{${p}}} is missing`);
  };

  const meta = json("language.json", LanguageJson);

  const prompts = {} as LanguagePack["prompts"];
  for (const [name, spec] of Object.entries(PROMPT_FILES) as [
    PromptName,
    (typeof PROMPT_FILES)[PromptName],
  ][]) {
    const path = `prompts/${name}.md`;
    const raw = files[path];
    if (raw === undefined || raw.trim() === "") {
      errors.push(`${path}: ${raw === undefined ? "missing" : "empty"}`);
      continue;
    }
    prompts[name] = textOf(raw);
    checkPlaceholders(path, prompts[name], spec.allowed, spec.required);
  }

  for (const [name, spec] of Object.entries(OPTIONAL_PROMPT_FILES) as [
    OptionalPromptName,
    (typeof OPTIONAL_PROMPT_FILES)[OptionalPromptName],
  ][]) {
    const path = `prompts/${name}.md`;
    const raw = files[path];
    if (raw === undefined) continue;
    if (raw.trim() === "") {
      errors.push(`${path}: empty`);
      continue;
    }
    prompts[name] = textOf(raw);
    checkPlaceholders(path, prompts[name], spec.allowed, spec.required);
  }

  const labels = json("prompts/labels.json", labelsSchema()) as PromptLabels | undefined;
  if (labels) {
    for (const [g, keys] of Object.entries(LABEL_PLACEHOLDERS)) {
      for (const [k, allowed] of Object.entries(keys as Record<string, readonly string[]>)) {
        const text = (labels as unknown as Record<string, Record<string, string>>)[g]![k]!;
        checkPlaceholders(`prompts/labels.json at ${g}.${k}`, text, allowed);
      }
    }
    for (const r of REWRITE_GOALS) {
      checkPlaceholders(`prompts/labels.json at rewrite.goals.${r}`, labels.rewrite.goals[r], []);
    }
  }

  const tools = json("prompts/tools.json", toolsSchema()) as ToolTexts | undefined;
  if (
    tools &&
    (prompts.letter !== undefined) !==
      (tools.letter !== undefined && tools.letterText !== undefined)
  ) {
    errors.push(
      "prompts/letter.md: goes together with letter and letterText in prompts/tools.json (all three, or none)",
    );
  }

  const archetypes: Archetype[] = [];
  for (const sk of ARCHETYPE_SKELETONS) {
    const texts = json(
      `archetypes/${sk.id}.json`,
      archetypeSchema(
        sk.sections.map((s) => s.id),
        sk.checklist.map((c) => c.id),
      ),
    );
    if (!texts) continue;
    archetypes.push({
      id: sk.id,
      name: texts.name,
      shortName: texts.shortName,
      defaultTarget: sk.defaultTarget,
      defaultSections: sk.sections.map((s) => ({
        id: s.id,
        title: texts.sections[s.id]!.title,
        share: s.share,
        guidance: texts.sections[s.id]!.guidance,
      })),
      checklist: sk.checklist.map((c) => ({
        id: c.id,
        description: texts.checklist[c.id]!,
        ...(c.sectionId ? { sectionId: c.sectionId } : {}),
        severity: c.severity,
      })),
      proseRules: texts.proseRules,
    });
  }

  const known = new Set([
    "language.json",
    "prompts/labels.json",
    "prompts/tools.json",
    ...Object.keys(PROMPT_FILES).map((n) => `prompts/${n}.md`),
    ...Object.keys(OPTIONAL_PROMPT_FILES).map((n) => `prompts/${n}.md`),
    ...ARCHETYPE_SKELETONS.map((a) => `archetypes/${a.id}.json`),
  ]);
  for (const path of Object.keys(files)) {
    if (!known.has(path) && !/(^|\/)(README|readme)(\.md)?$/.test(path)) {
      errors.push(`${path}: not a file of a language pack`);
    }
  }

  if (errors.length || !meta || !labels || !tools) return { ok: false, errors };
  const hash = fnv1a(
    Object.keys(files)
      .sort()
      .map((p) => `${p}\u0000${files[p]}`)
      .join("\u0000"),
  );
  return {
    ok: true,
    pack: {
      ...meta,
      builtIn: opts.builtIn,
      versionSuffix:
        meta.code === "it" && opts.builtIn
          ? ""
          : opts.builtIn
            ? `-${meta.code}`
            : `-${meta.code}-${hash}`,
      prompts,
      labels,
      tools,
      archetypes,
    },
  };
}

/** Short fingerprint of the content (32-bit FNV-1a): enough to invalidate the cache. */
function fnv1a(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
