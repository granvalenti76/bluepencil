/** Numbered migrations (`PRAGMA user_version`). Never change a released one: add a new one. */
export const MIGRATIONS: string[] = [
  // 1 — initial tables
  `
  CREATE TABLE drafts (
    path TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    archetype TEXT NOT NULL,
    stage TEXT NOT NULL,
    target INTEGER NOT NULL DEFAULT 0,
    words INTEGER NOT NULL DEFAULT 0,
    lines INTEGER NOT NULL DEFAULT 0,
    mtime REAL NOT NULL,
    content_hash TEXT NOT NULL
  );
  CREATE TABLE sections (
    draft_path TEXT NOT NULL REFERENCES drafts(path) ON DELETE CASCADE,
    section_id TEXT NOT NULL,
    words INTEGER NOT NULL,
    target INTEGER NOT NULL,
    state TEXT NOT NULL,
    PRIMARY KEY (draft_path, section_id)
  );
  CREATE TABLE judgments (
    id TEXT PRIMARY KEY,
    draft_path TEXT NOT NULL,
    pass TEXT NOT NULL,
    section_id TEXT,
    kind TEXT NOT NULL,
    range_from INTEGER,
    range_to INTEGER,
    anchor_json TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL,
    chunk_hash TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX judgments_draft ON judgments(draft_path, status);
  CREATE TABLE check_cache (
    chunk_hash TEXT NOT NULL,
    pass TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    result_json TEXT NOT NULL,
    PRIMARY KEY (chunk_hash, pass, model, prompt_version)
  );
  CREATE TABLE claim_sources (
    judgment_id TEXT NOT NULL,
    source_ref TEXT NOT NULL,
    verdict TEXT NOT NULL,
    PRIMARY KEY (judgment_id, source_ref)
  );
  CREATE TABLE word_history (
    draft_path TEXT NOT NULL,
    section_id TEXT NOT NULL,
    day TEXT NOT NULL,
    words INTEGER NOT NULL,
    PRIMARY KEY (draft_path, section_id, day)
  );
  CREATE VIRTUAL TABLE fts_docs USING fts5(path UNINDEXED, title, body, tokenize = 'unicode61 remove_diacritics 2');
  `,
  // 2 — only files with front matter are drafts; the other .md files (e.g. sources) stay indexed
  // for search but do not appear in the list. The index is a cache: emptied and rebuilt.
  `
  DELETE FROM drafts;
  DELETE FROM fts_docs;
  ALTER TABLE drafts ADD COLUMN is_draft INTEGER NOT NULL DEFAULT 1;
  `,
  // 3 — passages (paragraphs and list items) of every file, to pick the sources for the facts
  // pass and for "Compare sources". Rebuilt by the scan.
  `
  CREATE VIRTUAL TABLE fts_passages USING fts5(path UNINDEXED, ord UNINDEXED, text, tokenize = 'unicode61 remove_diacritics 2');
  DELETE FROM drafts;
  DELETE FROM fts_docs;
  `,
  // 4 — model scores on the whole text (prose, structure), with the fingerprint of the body they
  // refer to: the interface marks them "outdated" when the text changes.
  `
  CREATE TABLE review_scores (
    draft_path TEXT NOT NULL,
    kind TEXT NOT NULL,
    value INTEGER NOT NULL,
    reason TEXT NOT NULL,
    body_hash TEXT NOT NULL,
    model TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (draft_path, kind)
  );
  `,
  // 5 — review passes: one state per draft and pass, with the body's fingerprint and word count
  // when it was closed. Deleting the index sets them back to "waiting".
  `
  CREATE TABLE review_passes (
    draft_path TEXT NOT NULL,
    pass TEXT NOT NULL,
    state TEXT NOT NULL,
    body_hash TEXT NOT NULL,
    words INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (draft_path, pass)
  );
  `,
  // 6 — the editor's letter for each pass, with the fingerprint of the body that was read: the
  // interface marks it "outdated" when the text changes. Regenerated.
  `
  CREATE TABLE review_letters (
    draft_path TEXT NOT NULL,
    pass TEXT NOT NULL,
    text TEXT NOT NULL,
    body_hash TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (draft_path, pass)
  );
  `,
  // 7 — habit history: one count per day per habit, to say "fewer than before". Lost with the
  // index.
  `
  CREATE TABLE habit_history (
    day TEXT NOT NULL,
    habit TEXT NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (day, habit)
  );
  `,
  // 8 — every `.md` is a text; it is a source only if another file cites it (`sources` or a
  // footnote). The citations of each file, to decide. Rebuilt by the scan.
  `
  CREATE TABLE citations (
    from_path TEXT NOT NULL,
    to_path TEXT NOT NULL,
    PRIMARY KEY (from_path, to_path)
  );
  CREATE INDEX citations_to ON citations(to_path);
  DELETE FROM drafts;
  DELETE FROM fts_docs;
  DELETE FROM fts_passages;
  `,
];
