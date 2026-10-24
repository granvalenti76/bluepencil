import type { Pass } from "@desk/core";
import type { IndexDb } from "./index.ts";

/** The editor's letter for a pass: the latest one, per draft. */
export interface StoredLetter {
  pass: Pass;
  text: string;
  /** sha256 of the body that was read: if the current body differs, the letter needs updating. */
  bodyHash: string;
  model: string;
  promptVersion: string;
  updatedAt: string;
}

interface Row {
  pass: Pass;
  text: string;
  body_hash: string;
  model: string;
  prompt_version: string;
  updated_at: string;
}

/** `review_letters` table: one letter per draft and pass. Lost with the index and regenerated. */
export class LettersStore {
  private db: IndexDb["db"];

  constructor(index: IndexDb) {
    this.db = index.db;
  }

  set(path: string, letter: Omit<StoredLetter, "updatedAt">): StoredLetter {
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO review_letters
         (draft_path, pass, text, body_hash, model, prompt_version, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        path,
        letter.pass,
        letter.text,
        letter.bodyHash,
        letter.model,
        letter.promptVersion,
        updatedAt,
      );
    return { ...letter, updatedAt };
  }

  list(path: string): StoredLetter[] {
    const rows = this.db
      .prepare("SELECT * FROM review_letters WHERE draft_path = ?")
      .all(path) as Row[];
    return rows.map((r) => ({
      pass: r.pass,
      text: r.text,
      bodyHash: r.body_hash,
      model: r.model,
      promptVersion: r.prompt_version,
      updatedAt: r.updated_at,
    }));
  }
}
