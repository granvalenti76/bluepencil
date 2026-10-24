import { parseDraft } from "@desk/core";
import { localSourcePath } from "../review/sources.ts";

/**
 * The files a text cites: those in `sources` in the front matter and those a footnote points to
 * (`[^1]: fatti.md`). A `.md` cited by another file is a source; all the others are texts.
 * Paths relative to the drafts folder.
 */
export function citedFiles(path: string, text: string): string[] {
  const { data, body } = parseDraft(text);
  const notes = [...body.matchAll(/^\[\^[^\]]+\]:[ \t]*(\S.*?)\s*$/gm)].map((m) => m[1]!);
  const out = new Set<string>();
  for (const ref of [...(data.sources ?? []), ...notes]) {
    if (typeof ref !== "string") continue;
    const rel = localSourcePath(path, ref);
    if (rel && rel !== path && rel.endsWith(".md")) out.add(rel);
  }
  return [...out];
}
