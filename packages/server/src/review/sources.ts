import { posix } from "node:path";
import {
  footnotesIn,
  sourceQuery,
  type Block,
  type QueryLanguage,
  type SourcePassage,
} from "@desk/core";
import type { PassageHit, Search } from "../index-db/search.ts";
import type { FactSources, SourceLoader } from "./runner.ts";

/** Search terms and passages taken for the whole text of a draft. */
const QUERY_TERMS = 80;
const PASSAGES = 40;

const isUrl = (ref: string) => /^[a-z][a-z0-9+.-]*:/i.test(ref);

/** A local source: path relative to the draft (not a URL). */
export function localSourcePath(draftPath: string, ref: string): string | null {
  if (isUrl(ref)) return null;
  const joined = posix.normalize(posix.join(posix.dirname(draftPath), ref.trim()));
  return joined.startsWith("../") || joined.startsWith("/") ? null : joined;
}

/** Passages of the source files chosen by full-text search. */
export class FileSources implements SourceLoader {
  private readonly search: Search;
  constructor(search: Search) {
    this.search = search;
  }

  /** Indexed local sources among `refs`: path in the index → how the draft calls it. */
  private resolve(path: string, refs: string[]): Map<string, string> {
    const out = new Map<string, string>();
    for (const ref of refs) {
      const rel = localSourcePath(path, ref);
      if (rel && rel !== path && !out.has(rel) && this.search.has(rel)) out.set(rel, ref.trim());
    }
    return out;
  }

  /**
   * For the facts pass: the footnotes cited in the text and the relevant passages of the files in
   * `sources` and of those the footnotes point to. The text is the whole draft, so the search uses
   * more terms and takes more passages than for a single paragraph. URLs are skipped: web pages
   * are not downloaded (the author copies the content into a source file).
   */
  async forText(
    path: string,
    sources: string[],
    body: string,
    block: Block,
    lang: QueryLanguage,
  ): Promise<FactSources> {
    const footnotes = footnotesIn(body, block.text);
    const files = this.resolve(path, [...sources, ...footnotes.map((f) => f.text)]);
    const q = sourceQuery(block.text, lang, QUERY_TERMS);
    if (!q || files.size === 0) return { sources: [], footnotes };
    return {
      sources: group(this.search.passages(q, [...files.keys()], PASSAGES), files),
      footnotes,
    };
  }

  /**
   * "Compare sources": passages with terms similar to `text` in the draft's sources (front matter
   * and footnotes); if the draft has none, in all the source files.
   */
  compare(
    path: string,
    sources: string[],
    body: string,
    text: string,
    lang: QueryLanguage,
    limit = 8,
  ): (PassageHit & { ref: string })[] {
    const notes = [...body.matchAll(/^\[\^[^\]]+\]:[ \t]*(.+)$/gm)].map((m) => m[1]!);
    let files = this.resolve(path, [...sources, ...notes]);
    if (files.size === 0) {
      files = new Map(
        this.search
          .sourceFiles()
          .filter((f) => f.path !== path)
          .map((f) => [f.path, f.path]),
      );
    }
    const q = sourceQuery(text, lang);
    if (!q || files.size === 0) return [];
    return this.search
      .passages(q, [...files.keys()], limit)
      .map((h) => ({ ...h, ref: files.get(h.path)! }));
  }
}

/** One passage per file, most relevant first; within a file, in text order. */
function group(hits: PassageHit[], refs: Map<string, string>): SourcePassage[] {
  const byPath = new Map<string, PassageHit[]>();
  for (const h of hits) byPath.set(h.path, [...(byPath.get(h.path) ?? []), h]);
  return [...byPath].map(([p, hs]) => ({
    ref: refs.get(p) ?? p,
    text: hs
      .sort((a, b) => a.ord - b.ord)
      .map((h) => `- ${h.text.replace(/\s*\n\s*/g, " ")}`)
      .join("\n"),
  }));
}
