import { Document, isMap, isScalar, parseDocument } from "yaml";
import { z } from "zod";

export const ARCHETYPE_IDS = ["article", "blog", "report", "docs", "undecided"] as const;
export const STAGES = ["structure", "writing", "review"] as const;

export const OutlineEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  target: z.number(),
  heading: z.string().optional(),
});
export type OutlineEntry = z.infer<typeof OutlineEntrySchema>;

// Every field is optional and unknown fields pass through: the file is the source of truth.
export const FrontMatterSchema = z.looseObject({
  title: z.string().optional(),
  archetype: z.enum(ARCHETYPE_IDS).optional(),
  stage: z.enum(STAGES).optional(),
  target: z.number().optional(),
  outline: z.array(OutlineEntrySchema).optional(),
  sources: z.array(z.string()).optional(),
  brief: z.string().optional(),
  glossary: z.array(z.string()).optional(),
  style: z.array(z.string()).optional(),
  /** Language of the draft (`it`, `en`…); Italian if missing. An unknown code is kept. */
  lang: z.string().optional(),
  /** The style the draft looks at: the path of a file in `Styles/`. */
  reference: z.string().optional(),
  /** The author's sign-off: when, and on which body (sha256, 12 characters). */
  signoff: z.object({ at: z.string(), body: z.string() }).optional(),
});
export type FrontMatter = z.infer<typeof FrontMatterSchema>;

export interface ParsedDraft {
  /** Front matter values. If they fail the schema they are the raw ones and `issues` says why. */
  data: FrontMatter;
  issues: string[];
  hasFrontMatter: boolean;
  /** The YAML document, to change a field without losing order and comments. */
  doc: Document;
  body: string;
  /** Offset of the body in the file. */
  bodyOffset: number;
  raw: string;
}

const FENCE = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

export function splitFrontMatter(text: string): {
  yaml: string | null;
  body: string;
  bodyOffset: number;
} {
  const m = FENCE.exec(text);
  if (!m) return { yaml: null, body: text, bodyOffset: 0 };
  return { yaml: m[1] ?? "", body: text.slice(m[0].length), bodyOffset: m[0].length };
}

export function parseDraft(text: string): ParsedDraft {
  const { yaml, body, bodyOffset } = splitFrontMatter(text);
  const doc = parseDocument(yaml ?? "");
  const issues = doc.errors.map((e) => e.message);
  const js: unknown = doc.toJS() ?? {};
  const asObject =
    typeof js === "object" && !Array.isArray(js) ? (js as Record<string, unknown>) : {};
  const parsed = FrontMatterSchema.safeParse(asObject);
  if (!parsed.success) {
    for (const i of parsed.error.issues)
      issues.push(`${i.path.join(".") || "(radice)"}: ${i.message}`);
  }
  return {
    data: parsed.success ? parsed.data : (asObject as FrontMatter),
    issues,
    hasFrontMatter: yaml !== null,
    doc,
    body,
    bodyOffset,
    raw: text,
  };
}

interface Edit {
  from: number;
  to: number;
  text: string;
}

const dump = (value: unknown) => new Document(value).toString({ lineWidth: 0 });

/**
 * Updates only the given fields (`undefined` = remove) and leaves the rest of the file intact:
 * the field's range is replaced in the original text, so order, comments and formatting of the
 * other lines do not change. With no changes it returns the identical text.
 */
export function patchFrontMatter(text: string, patch: Record<string, unknown>): string {
  const keys = Object.keys(patch);
  if (keys.length === 0) return text;

  const { yaml, body } = splitFrontMatter(text);
  const source = yaml ? `${yaml}\n` : "";
  const doc = parseDocument(source);
  const edits: Edit[] = [];
  let appended = "";

  if (doc.errors.length > 0 || !(doc.contents === null || isMap(doc.contents))) {
    return rebuild(doc, patch, body);
  }

  for (const key of keys) {
    const value = patch[key];
    const pair = isMap(doc.contents)
      ? doc.contents.items.find((p) => isScalar(p.key) && p.key.value === key)
      : undefined;
    const keyRange = isScalar(pair?.key) ? pair.key.range : null;
    const rawRange = pair?.value && "range" in pair.value ? pair.value.range : null;
    // For block collections the range includes the trailing line breaks: drop them.
    let valueEnd = rawRange ? rawRange[1] : 0;
    while (rawRange && valueEnd > rawRange[0] && /\s/.test(source[valueEnd - 1]!)) valueEnd--;
    const valueRange: [number, number] | null = rawRange ? [rawRange[0], valueEnd] : null;

    if (pair === undefined) {
      if (value !== undefined) appended += dump({ [key]: value });
    } else if (!keyRange || !valueRange) {
      return rebuild(doc, patch, body); // `key:` with no value: rare case, full rebuild
    } else if (value === undefined) {
      const from = source.lastIndexOf("\n", keyRange[0] - 1) + 1;
      const nl = source.indexOf("\n", valueRange[1]);
      edits.push({ from, to: nl === -1 ? source.length : nl + 1, text: "" });
    } else {
      edits.push({ from: keyRange[0], to: valueRange[1], text: dump({ [key]: value }).trimEnd() });
    }
  }

  let out = source;
  for (const e of edits.sort((a, b) => b.from - a.from)) {
    out = out.slice(0, e.from) + e.text + out.slice(e.to);
  }
  if (appended !== "") out = (out === "" || out.endsWith("\n") ? out : out + "\n") + appended;
  return `---\n${out}---\n${body}`;
}

function rebuild(doc: Document, patch: Record<string, unknown>, body: string): string {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) doc.delete(key);
    else doc.set(key, value);
  }
  return `---\n${doc.toString({ lineWidth: 0 })}---\n${body}`;
}

/** Replaces the body, keeping the front matter byte for byte. */
export function replaceBody(text: string, body: string): string {
  const { bodyOffset } = splitFrontMatter(text);
  return text.slice(0, bodyOffset) + body;
}
