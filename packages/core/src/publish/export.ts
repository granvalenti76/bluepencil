import { parseDraft, patchFrontMatter, splitFrontMatter } from "../document/frontmatter.ts";

/**
 * Front matter fields that only serve the editorial work: they do not go to the blog. `brief`,
 * `glossary` and `style` are the author's notes; `signoff` is the review's sign-off.
 */
export const EDITORIAL_FIELDS = [
  "archetype",
  "stage",
  "target",
  "outline",
  "sources",
  "brief",
  "glossary",
  "style",
  "signoff",
] as const;

export interface PublishResult {
  text: string;
  /** Footnotes removed (they pointed to local files or were the author's opinions). */
  removedNotes: { id: string; text: string }[];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasUrl = (s: string) => /\b[a-z][a-z0-9+.-]*:\/\/\S+/i.test(s);

/**
 * The file to publish: front matter without the editorial fields (the others stay: `title`,
 * `date`, `tags`…), no section markers, footnotes only if they point to a URL (those pointing
 * to local files are removed, with their reference).
 */
export function publishText(text: string): PublishResult {
  const parsed = parseDraft(text);
  let out = text;
  if (parsed.hasFrontMatter) {
    const patch = Object.fromEntries(
      EDITORIAL_FIELDS.filter((k) => k in parsed.data).map((k) => [k, undefined]),
    );
    out = patchFrontMatter(out, patch);
  }
  const { bodyOffset } = splitFrontMatter(out);
  let head = out.slice(0, bodyOffset);
  let body = out.slice(bodyOffset);

  const removedNotes: PublishResult["removedNotes"] = [];
  for (const m of [...body.matchAll(/^\[\^([^\]\s]+)\]:[ \t]*(.*)$/gm)]) {
    const [, id, def] = m as unknown as [string, string, string];
    if (hasUrl(def)) continue;
    removedNotes.push({ id, text: def.trim() });
    body = body.replace(new RegExp(`^\\[\\^${esc(id)}\\]:[^\\n]*(\\n|$)`, "m"), "");
    body = body.replace(new RegExp(`\\[\\^${esc(id)}\\](?!:)`, "g"), "");
  }

  body = body
    // A marker alone on its line goes with the line; attached to text, only the marker goes.
    .replace(/^[ \t]*<!--\s*section:[^>]*-->[ \t]*\n/gm, "")
    .replace(/<!--\s*section:[^>]*-->[ \t]*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+$/, "\n");
  if (head === "---\n---\n") head = "";
  return { text: head + body, removedNotes };
}
