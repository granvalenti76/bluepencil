import type { IndexDb } from "./index.ts";

/** Marks around the terms found (FTS5 `highlight`/`snippet`); the browser turns them into `<mark>`. */
export const MARK_OPEN = "\u0001";
export const MARK_CLOSE = "\u0002";

export interface PassageHit {
  path: string;
  ord: number;
  text: string;
  /** The text with the terms found between `MARK_OPEN` and `MARK_CLOSE`. */
  marked: string;
}

export interface DocHit {
  path: string;
  title: string;
  isDraft: boolean;
  snippet: string;
}

/** A search typed by the author → FTS5 query: every word quoted, the last as a prefix. */
export function userQuery(q: string): string | null {
  const words = q.match(/[\p{L}\p{N}][\p{L}\p{N}._-]*/gu) ?? [];
  if (words.length === 0) return null;
  return words.map((w, i) => `"${w}"${i === words.length - 1 ? "*" : ""}`).join(" ");
}

/** Full-text search over drafts and sources (`fts_docs` and `fts_passages` tables). */
export class Search {
  private db: IndexDb["db"];

  constructor(index: IndexDb) {
    this.db = index.db;
  }

  /** The most relevant passages for `match` (an FTS5 query), at most `limit`, only in the `paths` files. */
  passages(match: string, paths: string[] | null, limit = 12): PassageHit[] {
    if (paths && paths.length === 0) return [];
    const filter = paths ? `AND path IN (${paths.map(() => "?").join(",")})` : "";
    try {
      return this.db
        .prepare(
          `SELECT path, ord, text, highlight(fts_passages, 2, ?, ?) AS marked FROM fts_passages
           WHERE fts_passages MATCH ? ${filter} ORDER BY bm25(fts_passages) LIMIT ?`,
        )
        .all(MARK_OPEN, MARK_CLOSE, match, ...(paths ?? []), limit) as PassageHit[];
    } catch {
      return []; // invalid FTS5 query: no results instead of an error
    }
  }

  docs(q: string, limit = 30): DocHit[] {
    const match = userQuery(q);
    if (!match) return [];
    try {
      const rows = this.db
        .prepare(
          `SELECT f.path, f.title,
             NOT EXISTS (SELECT 1 FROM citations c WHERE c.to_path = f.path AND c.from_path != f.path) AS isDraft,
             snippet(fts_docs, 2, ?, ?, '…', 14) AS snippet
           FROM fts_docs f
           WHERE fts_docs MATCH ? ORDER BY bm25(fts_docs) LIMIT ?`,
        )
        .all(MARK_OPEN, MARK_CLOSE, match, limit) as (Omit<DocHit, "isDraft"> & {
        isDraft: number;
      })[];
      return rows.map((r) => ({ ...r, isDraft: r.isDraft === 1 }));
    } catch {
      return [];
    }
  }

  /** The sources: files cited by another file ("Compare sources" when the draft has none). */
  sourceFiles(): { path: string; title: string }[] {
    return this.db
      .prepare(
        `SELECT path, title FROM drafts d WHERE EXISTS
           (SELECT 1 FROM citations c WHERE c.to_path = d.path AND c.from_path != d.path)
         ORDER BY path`,
      )
      .all() as { path: string; title: string }[];
  }

  /**
   * What can be cited from "Your sources": the sources first, then the other files in the folder
   * (citing one makes it a source).
   */
  citable(): { path: string; title: string; isSource: boolean }[] {
    const rows = this.db
      .prepare(
        `SELECT path, title, EXISTS
           (SELECT 1 FROM citations c WHERE c.to_path = d.path AND c.from_path != d.path) AS isSource
         FROM drafts d ORDER BY isSource DESC, path`,
      )
      .all() as { path: string; title: string; isSource: number }[];
    return rows.map((r) => ({ ...r, isSource: r.isSource === 1 }));
  }

  has(path: string): boolean {
    return this.db.prepare("SELECT 1 FROM drafts WHERE path = ?").get(path) !== undefined;
  }
}
