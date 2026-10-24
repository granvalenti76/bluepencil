import type { ReviewResponse, ReviewStep } from "@desk/core";
import type { IndexDb } from "./index.ts";

/** Check results by text fingerprint and pass (`check_cache` table). */
export class CheckCache {
  private db: IndexDb["db"];

  constructor(index: IndexDb) {
    this.db = index.db;
  }

  get(
    chunkHash: string,
    step: ReviewStep,
    model: string,
    promptVersion: string,
  ): ReviewResponse | null {
    const row = this.db
      .prepare(
        `SELECT result_json FROM check_cache
         WHERE chunk_hash = ? AND pass = ? AND model = ? AND prompt_version = ?`,
      )
      .get(chunkHash, step, model, promptVersion) as { result_json: string } | undefined;
    if (!row) return null;
    const v = JSON.parse(row.result_json) as ReviewResponse | ReviewResponse["judgments"];
    return Array.isArray(v) ? { judgments: v } : v;
  }

  set(
    chunkHash: string,
    step: ReviewStep,
    model: string,
    promptVersion: string,
    result: ReviewResponse,
  ) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO check_cache (chunk_hash, pass, model, prompt_version, result_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(chunkHash, step, model, promptVersion, JSON.stringify(result));
  }
}
