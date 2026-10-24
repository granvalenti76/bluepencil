import { z } from "zod";
import type { Archetype } from "../archetypes/types.ts";
import { toAscii } from "../document/ascii.ts";
import type { OutlineEntry } from "../document/frontmatter.ts";

/** A section proposed by the model: title, target, one line of guidance. */
export const ProposedSectionSchema = z.object({
  title: z.string().min(1).max(80),
  target: z.coerce.number().int().min(0),
  guidance: z.string().default(""),
});
export type ProposedSection = z.infer<typeof ProposedSectionSchema>;

export const ProposedOutlineSchema = z.object({
  sections: z.array(ProposedSectionSchema).min(1),
  checks: z.array(z.string()).default([]),
});
export type ProposedOutline = z.infer<typeof ProposedOutlineSchema>;

/** A line of the outline while the author edits it. */
export interface OutlineDraftEntry {
  id: string;
  title: string;
  target: number;
  guidance: string;
  /** The section opens with an H2 in the text (otherwise with a marker). */
  withHeading: boolean;
}

export function slugId(title: string): string {
  const s = toAscii(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return s || "sezione";
}

/** Makes the ids unique (`method`, `method-2`…), keeping those already unique. */
export function uniqueIds<T extends { id: string }>(entries: T[]): T[] {
  const seen = new Set<string>();
  return entries.map((e) => {
    let id = e.id || "sezione";
    for (let n = 2; seen.has(id); n++) id = `${e.id}-${n}`;
    seen.add(id);
    return id === e.id ? e : { ...e, id };
  });
}

/** Splits a total by the shares, with an exact sum (remainder to the largest shares). */
export function splitTarget(total: number, shares: number[]): number[] {
  const sum = shares.reduce((a, b) => a + b, 0) || 1;
  const raw = shares.map((s) => (total * s) / sum);
  const out = raw.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (rest <= 0) break;
    out[i]!++;
    rest--;
  }
  return out;
}

/** The first section (lead, opening, summary…) has no heading in the text: it follows the H1. */
function defaultHeading(index: number): boolean {
  return index > 0;
}

/** Starting outline from the archetype's sections: works without the model too. */
export function defaultOutline(
  archetype: Archetype,
  target = archetype.defaultTarget,
): OutlineDraftEntry[] {
  const targets = splitTarget(
    target,
    archetype.defaultSections.map((s) => s.share),
  );
  return archetype.defaultSections.map((s, i) => ({
    id: s.id,
    title: s.title,
    target: targets[i]!,
    guidance: s.guidance,
    withHeading: defaultHeading(i),
  }));
}

/** Outline proposed by the model → editable lines, reusing the archetype's ids when the title matches. */
export function fromProposal(
  sections: ProposedSection[],
  archetype?: Archetype,
): OutlineDraftEntry[] {
  return uniqueIds(
    sections.map((s, i) => {
      const known = archetype?.defaultSections.find(
        (d) => d.title.toLowerCase() === s.title.trim().toLowerCase(),
      );
      return {
        id: known?.id ?? slugId(s.title),
        title: s.title.trim(),
        target: Math.max(0, Math.round(s.target)),
        guidance: s.guidance.trim(),
        withHeading: defaultHeading(i),
      };
    }),
  );
}

export function toOutline(entries: OutlineDraftEntry[]): OutlineEntry[] {
  return uniqueIds(entries).map((e) => ({
    id: e.id,
    title: e.title.trim(),
    target: e.target,
    ...(e.withHeading ? { heading: e.title.trim() } : {}),
  }));
}

/**
 * The body after "Accept structure": H1, then for each section the H2 (if it has `heading`) or
 * the `<!-- section: id -->` marker. Text already written stays; only the boundaries of the
 * sections that cannot be found are added at the end.
 */
export function skeletonBody(body: string, title: string, outline: OutlineEntry[]): string {
  let out = body.replace(/\s+$/, "");
  if (!/^# /m.test(out)) out = `# ${title}${out ? `\n\n${out}` : ""}`;
  const lines = new Set(out.split("\n").map((l) => l.trim()));
  const afterH1 = out.replace(/^[\s\S]*?^# .*$/m, "").trim();
  outline.forEach((s, i) => {
    const marker = `<!-- section: ${s.id} -->`;
    if (out.includes(marker)) return;
    if (s.heading && lines.has(`## ${s.heading}`)) return;
    // Text already written after the H1 is the lead.
    if (i === 0 && afterH1 !== "" && !/^(##|<!--)/.test(afterH1)) return;
    out += `\n\n${s.heading ? `## ${s.heading}` : marker}`;
  });
  return out + "\n";
}

/**
 * The complete sections already received in a partial JSON response: used to show the outline
 * while the model is still writing.
 */
export function partialSections(text: string): ProposedSection[] {
  const key = text.indexOf('"sections"');
  if (key === -1) return [];
  const start = text.indexOf("[", key);
  if (start === -1) return [];
  const out: ProposedSection[] = [];
  let depth = 0;
  let inString = false;
  let objStart = -1;
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && objStart !== -1) {
        try {
          const parsed = ProposedSectionSchema.safeParse(JSON.parse(text.slice(objStart, i + 1)));
          if (parsed.success) out.push(parsed.data);
        } catch {
          /* object not valid yet */
        }
        objStart = -1;
      }
    } else if (ch === "]" && depth === 0) break;
  }
  return out;
}
