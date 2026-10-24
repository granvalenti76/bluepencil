import type { Score, ScoreKind } from "@desk/core";
import type { IndexDb } from "./index.ts";

export interface StoredScore extends Score {
  kind: ScoreKind;
  /** sha256 of the scored body: if the current body differs, the score needs updating. */
  bodyHash: string;
  model: string;
  updatedAt: string;
}

interface Row {
  kind: ScoreKind;
  value: number;
  reason: string;
  body_hash: string;
  model: string;
  updated_at: string;
}

/** Model scores per draft (`review_scores` table): one per aspect, the latest. */
export class ScoresStore {
  private db: IndexDb["db"];

  constructor(index: IndexDb) {
    this.db = index.db;
  }

  set(path: string, score: Omit<StoredScore, "updatedAt">): StoredScore {
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO review_scores
         (draft_path, kind, value, reason, body_hash, model, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(path, score.kind, score.value, score.reason, score.bodyHash, score.model, updatedAt);
    return { ...score, updatedAt };
  }

  list(path: string): StoredScore[] {
    const rows = this.db
      .prepare("SELECT * FROM review_scores WHERE draft_path = ? ORDER BY kind")
      .all(path) as Row[];
    return rows.map((r) => ({
      kind: r.kind,
      value: r.value,
      reason: r.reason,
      bodyHash: r.body_hash,
      model: r.model,
      updatedAt: r.updated_at,
    }));
  }
}
