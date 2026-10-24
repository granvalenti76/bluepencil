import { REVIEW_ORDER, type Pass, type PassRecord } from "../judgments/schema.ts";

/** How a pass stands for the author: besides the saved states, "waiting" (not computed yet). */
export type PassStatus = "waiting" | "open" | "done" | "skipped";

/** Above this change in words, a closed pass "belongs to another text". */
export const PASS_CHANGE_THRESHOLD = 0.1;

const closed = (r: PassRecord | undefined) => r?.state === "done" || r?.state === "skipped";

/**
 * The pass to work on: the first, in order, that is neither closed nor skipped. `null` when all
 * of them are (review finished) or when the review has not started (no state).
 */
export function currentPass(records: PassRecord[]): Pass | null {
  if (records.length === 0) return null;
  return REVIEW_ORDER.find((p) => !closed(records.find((r) => r.pass === p))) ?? null;
}

/** The pass after `pass` in the order, if any. */
export function nextPass(pass: Pass): Pass | null {
  return REVIEW_ORDER[REVIEW_ORDER.indexOf(pass) + 1] ?? null;
}

export function passStatus(pass: Pass, records: PassRecord[]): PassStatus {
  return records.find((r) => r.pass === pass)?.state ?? "waiting";
}

/**
 * Has the text changed a lot since the pass was closed? Counts the change in words: the small
 * edits made by later passes (which are their job) are not enough.
 */
export function changedSince(record: PassRecord, words: number): boolean {
  if (!closed(record)) return false;
  return Math.abs(words - record.words) / Math.max(1, record.words) > PASS_CHANGE_THRESHOLD;
}
