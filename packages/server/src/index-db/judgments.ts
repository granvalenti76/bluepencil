import type { Judgment, Pass } from "@desk/core";
import type { IndexDb } from "./index.ts";

type Row = {
  id: string;
  draft_path: string;
  pass: string;
  section_id: string | null;
  kind: string;
  range_from: number | null;
  range_to: number | null;
  anchor_json: string;
  payload_json: string;
  status: string;
  chunk_hash: string;
  model: string;
  prompt_version: string;
  created_at: string;
};

/** The judgment fields that have no column of their own (`payload_json`). */
type Payload = Pick<
  Judgment,
  | "quote"
  | "title"
  | "rationale"
  | "proposal"
  | "factStatus"
  | "checkStatus"
  | "checkId"
  | "applied"
>;

function toJudgment(r: Row): Judgment {
  const payload = JSON.parse(r.payload_json) as Payload;
  return {
    ...payload,
    kind: r.kind,
    id: r.id,
    draftPath: r.draft_path,
    pass: r.pass as Pass,
    ...(r.section_id ? { sectionId: r.section_id } : {}),
    range:
      r.range_from === null || r.range_to === null ? null : { from: r.range_from, to: r.range_to },
    anchor: JSON.parse(r.anchor_json),
    status: r.status as Judgment["status"],
    chunkHash: r.chunk_hash,
    model: r.model,
    promptVersion: r.prompt_version,
    createdAt: r.created_at,
  };
}

function toPayload(j: Judgment): Payload {
  const { quote, title, rationale, proposal, factStatus, checkStatus, checkId, applied } = j;
  return { quote, title, rationale, proposal, factStatus, checkStatus, checkId, applied };
}

/** Model judgments saved in the index (`judgments` table). */
export class JudgmentsStore {
  private db: IndexDb["db"];

  constructor(index: IndexDb) {
    this.db = index.db;
  }

  insert(j: Judgment) {
    this.db
      .prepare(
        `INSERT INTO judgments (id, draft_path, pass, section_id, kind, range_from, range_to, anchor_json,
           payload_json, status, chunk_hash, model, prompt_version, created_at, updated_at)
         VALUES (@id, @draft_path, @pass, @section_id, @kind, @range_from, @range_to, @anchor_json,
           @payload_json, @status, @chunk_hash, @model, @prompt_version, @created_at, @created_at)`,
      )
      .run({
        id: j.id,
        draft_path: j.draftPath,
        pass: j.pass,
        section_id: j.sectionId ?? null,
        kind: j.kind,
        range_from: j.range?.from ?? null,
        range_to: j.range?.to ?? null,
        anchor_json: JSON.stringify(j.anchor),
        payload_json: JSON.stringify(toPayload(j)),
        status: j.status,
        chunk_hash: j.chunkHash,
        model: j.model,
        prompt_version: j.promptVersion,
        created_at: j.createdAt,
      });
  }

  get(id: string): Judgment | undefined {
    const r = this.db.prepare("SELECT * FROM judgments WHERE id = ?").get(id) as Row | undefined;
    return r ? toJudgment(r) : undefined;
  }

  /** All the draft's judgments, in creation order; `stale` ones excluded unless asked for. */
  list(draftPath: string, opts: { includeStale?: boolean } = {}): Judgment[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM judgments WHERE draft_path = ? ${opts.includeStale ? "" : "AND status != 'stale'"}
         ORDER BY id`,
      )
      .all(draftPath) as Row[];
    return rows.map(toJudgment);
  }

  /** The latest dismissed judgments, most recent first: they go into the session context. */
  listIgnored(draftPath: string, limit: number): Judgment[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM judgments WHERE draft_path = ? AND status = 'ignored'
         ORDER BY updated_at DESC, id DESC LIMIT ?`,
      )
      .all(draftPath, limit) as Row[];
    return rows.map(toJudgment);
  }

  /**
   * Deletes all the notes of a draft ("Clear suggestions") and the cached checks they came from:
   * the next review asks the model again and starts from the first pass. Returns how many there
   * were.
   */
  clear(draftPath: string): number {
    const hashes = (
      this.db
        .prepare("SELECT DISTINCT chunk_hash FROM judgments WHERE draft_path = ?")
        .all(draftPath) as { chunk_hash: string }[]
    ).map((r) => r.chunk_hash);
    const run = this.db.transaction(() => {
      const del = this.db.prepare("DELETE FROM check_cache WHERE chunk_hash = ?");
      for (const h of hashes) del.run(h);
      this.db.prepare("DELETE FROM review_passes WHERE draft_path = ?").run(draftPath);
      this.db.prepare("DELETE FROM review_letters WHERE draft_path = ?").run(draftPath);
      return this.db.prepare("DELETE FROM judgments WHERE draft_path = ?").run(draftPath).changes;
    });
    return run();
  }

  count(draftPath: string): number {
    return (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM judgments WHERE draft_path = ?")
        .get(draftPath) as { n: number }
    ).n;
  }

  update(j: Judgment) {
    this.db
      .prepare(
        `UPDATE judgments SET status = @status, range_from = @range_from, range_to = @range_to,
           anchor_json = @anchor_json, payload_json = @payload_json, updated_at = @updated_at WHERE id = @id`,
      )
      .run({
        id: j.id,
        status: j.status,
        range_from: j.range?.from ?? null,
        range_to: j.range?.to ?? null,
        anchor_json: JSON.stringify(j.anchor),
        payload_json: JSON.stringify(toPayload(j)),
        updated_at: new Date().toISOString(),
      });
  }
}
