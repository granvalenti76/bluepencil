import { REVIEW_ORDER, type Pass, type PassRecord, type PassState } from "@desk/core";
import type { IndexDb } from "./index.ts";

interface Row {
  pass: Pass;
  state: PassState;
  body_hash: string;
  words: number;
  updated_at: string;
}

/** State of the review passes per draft (`review_passes` table). */
export class PassesStore {
  private db: IndexDb["db"];

  constructor(index: IndexDb) {
    this.db = index.db;
  }

  /** In review order; a pass with no row is "waiting" and does not appear. */
  list(path: string): PassRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM review_passes WHERE draft_path = ?")
      .all(path) as Row[];
    return rows
      .map((r) => ({
        pass: r.pass,
        state: r.state,
        bodyHash: r.body_hash,
        words: r.words,
        updatedAt: r.updated_at,
      }))
      .sort((a, b) => REVIEW_ORDER.indexOf(a.pass) - REVIEW_ORDER.indexOf(b.pass));
  }

  set(path: string, pass: Pass, state: PassState, body: { hash: string; words: number }) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO review_passes (draft_path, pass, state, body_hash, words, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(path, pass, state, body.hash, body.words, new Date().toISOString());
  }

  /** A freshly computed pass becomes `open`, but does not reopen a closed or skipped one. */
  markRun(path: string, pass: Pass, body: { hash: string; words: number }) {
    const row = this.db
      .prepare("SELECT state FROM review_passes WHERE draft_path = ? AND pass = ?")
      .get(path, pass) as { state: PassState } | undefined;
    if (!row || row.state === "open") this.set(path, pass, "open", body);
  }

  /** Start again from the first pass. */
  clear(path: string): void {
    this.db.prepare("DELETE FROM review_passes WHERE draft_path = ?").run(path);
  }
}
