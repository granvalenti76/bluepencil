import { mkdirSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { countLines, countWords, mapSections, parseDraft, sourcePassages } from "@desk/core";
import { citedFiles } from "../drafts/citations.ts";
import { hashText, INDEX_DIR, LEGACY_INDEX_DIR, type DraftsRepo } from "../drafts/repo.ts";
import { MIGRATIONS } from "./migrations.ts";

export interface DraftRow {
  path: string;
  title: string;
  archetype: string;
  stage: string;
  target: number;
  words: number;
  lines: number;
  mtime: number;
  contentHash: string;
}

export interface ScanResult {
  indexed: string[];
  removed: string[];
  unchanged: number;
}

/**
 * SQLite index: a cache, never the source of truth. Deleting it and restarting rebuilds it from
 * the `.md` files.
 */
export class IndexDb {
  readonly db: Database.Database;

  constructor(draftsDir: string) {
    const dir = join(draftsDir, INDEX_DIR);
    // Before the rename (Bluepencil): the index and `style.md` lived in `.editorial-desk`.
    const legacy = join(draftsDir, LEGACY_INDEX_DIR);
    if (!existsSync(dir) && existsSync(legacy)) renameSync(legacy, dir);
    mkdirSync(dir, { recursive: true });
    const ignore = join(dir, ".gitignore");
    if (!existsSync(ignore)) writeFileSync(ignore, "index.sqlite*\n");

    this.db = new Database(join(dir, "index.sqlite"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate() {
    const current = this.db.pragma("user_version", { simple: true }) as number;
    for (let v = current; v < MIGRATIONS.length; v++) {
      this.db.transaction(() => {
        this.db.exec(MIGRATIONS[v]!);
        this.db.pragma(`user_version = ${v + 1}`);
      })();
    }
  }

  close() {
    this.db.close();
  }

  /** (Re)indexes a file: draft row, sections, text for search. */
  upsert(path: string, text: string, mtimeMs: number): DraftRow {
    const parsed = parseDraft(text);
    const fm = parsed.data;
    const outline = fm.outline ?? [];
    const title = fm.title ?? /^# +(.+?)\s*$/m.exec(parsed.body)?.[1] ?? path.replace(/\.md$/, "");
    const row: DraftRow = {
      path,
      title,
      archetype: fm.archetype ?? "undecided",
      stage: fm.stage ?? "writing",
      target: fm.target ?? 0,
      words: countWords(parsed.body),
      lines: countLines(parsed.body),
      mtime: mtimeMs,
      contentHash: hashText(text),
    };
    // No longer decides anything (migration 8): kept so as not to touch the table.
    const isDraft = parsed.hasFrontMatter ? 1 : 0;
    const cited = citedFiles(path, text);
    const sections = mapSections(parsed.body, outline);

    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO drafts (path, title, archetype, stage, target, words, lines, mtime, content_hash, is_draft)
           VALUES (@path, @title, @archetype, @stage, @target, @words, @lines, @mtime, @contentHash, @isDraft)
           ON CONFLICT(path) DO UPDATE SET title=@title, archetype=@archetype, stage=@stage,
             target=@target, words=@words, lines=@lines, mtime=@mtime, content_hash=@contentHash,
             is_draft=@isDraft`,
        )
        .run({ ...row, isDraft });
      this.db.prepare("DELETE FROM sections WHERE draft_path = ?").run(path);
      const ins = this.db.prepare(
        "INSERT INTO sections (draft_path, section_id, words, target, state) VALUES (?, ?, ?, ?, ?)",
      );
      for (const s of sections) ins.run(path, s.id, s.words, s.target, s.state);
      this.db.prepare("DELETE FROM citations WHERE from_path = ?").run(path);
      const cite = this.db.prepare("INSERT INTO citations (from_path, to_path) VALUES (?, ?)");
      for (const to of cited) cite.run(path, to);
      this.db.prepare("DELETE FROM fts_docs WHERE path = ?").run(path);
      this.db
        .prepare("INSERT INTO fts_docs (path, title, body) VALUES (?, ?, ?)")
        .run(path, title, parsed.body);
      this.db.prepare("DELETE FROM fts_passages WHERE path = ?").run(path);
      const pas = this.db.prepare("INSERT INTO fts_passages (path, ord, text) VALUES (?, ?, ?)");
      sourcePassages(parsed.body).forEach((t, i) => pas.run(path, i, t));
    })();
    return row;
  }

  remove(path: string) {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM drafts WHERE path = ?").run(path);
      this.db.prepare("DELETE FROM citations WHERE from_path = ?").run(path);
      this.db.prepare("DELETE FROM fts_docs WHERE path = ?").run(path);
      this.db.prepare("DELETE FROM fts_passages WHERE path = ?").run(path);
    })();
  }

  get(path: string): DraftRow | undefined {
    return this.db.prepare(SELECT + " WHERE path = ?").get(path) as DraftRow | undefined;
  }

  /** The texts for the drafts list: every file no other file cites. */
  list(stage?: string): DraftRow[] {
    const rows = stage
      ? this.db.prepare(SELECT + ` WHERE ${IS_TEXT} AND stage = ? ORDER BY mtime DESC`).all(stage)
      : this.db.prepare(SELECT + ` WHERE ${IS_TEXT} ORDER BY mtime DESC`).all();
    return rows as DraftRow[];
  }

  /** The sources: the files cited by another file (and that exist). */
  sources(): DraftRow[] {
    return this.db.prepare(SELECT + ` WHERE NOT ${IS_TEXT} ORDER BY path`).all() as DraftRow[];
  }

  /** All indexed files, sources included (for the scan). */
  private listAll(): DraftRow[] {
    return this.db.prepare(SELECT + " ORDER BY path").all() as DraftRow[];
  }

  /**
   * At startup: compares the files with the index (`mtime`, then hash) and reindexes only the
   * changed ones; removes the rows of files that are gone.
   */
  async scan(repo: DraftsRepo): Promise<ScanResult> {
    const result: ScanResult = { indexed: [], removed: [], unchanged: 0 };
    const files = await repo.list();
    const known = new Map(this.listAll().map((r) => [r.path, r]));

    for (const path of files) {
      const row = known.get(path);
      known.delete(path);
      const st = await repo.stat(path);
      if (row && row.mtime === st.mtimeMs) {
        result.unchanged++;
        continue;
      }
      const file = await repo.read(path);
      if (row && row.contentHash === file.hash) {
        this.db.prepare("UPDATE drafts SET mtime = ? WHERE path = ?").run(file.mtimeMs, path);
        result.unchanged++;
        continue;
      }
      this.upsert(path, file.text, file.mtimeMs);
      result.indexed.push(path);
    }
    for (const path of known.keys()) {
      this.remove(path);
      result.removed.push(path);
    }
    return result;
  }
}

const SELECT = `SELECT path, title, archetype, stage, target, words, lines, mtime, content_hash AS contentHash FROM drafts`;

/** A file is a text if no other file cites it. */
export const IS_TEXT = `NOT EXISTS (SELECT 1 FROM citations c WHERE c.to_path = drafts.path AND c.from_path != drafts.path)`;
