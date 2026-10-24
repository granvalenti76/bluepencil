import type { Range } from "../judgments/resolve.ts";
import type { Judgment } from "../judgments/schema.ts";

type Anchor = Judgment["anchor"];
type Applied = NonNullable<Judgment["applied"]>;

/** With several occurrences, at least this many characters of shared context are needed to pick one. */
const MIN_CONTEXT = 4;

function commonSuffix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * Finds a quote again after the text has changed (`anchor`). Among the occurrences it picks the
 * one with the most shared context (32 characters before and after), and on a tie the one
 * closest to `near`. With several occurrences and no shared context it does not guess: `null`,
 * and the judgment becomes `stale`.
 */
export function relocateAnchor(body: string, anchor: Anchor, near: number): Range | null {
  const { quote, prefix, suffix } = anchor;
  if (quote === "") return null;

  const candidates: { from: number; score: number }[] = [];
  for (let i = body.indexOf(quote); i !== -1; i = body.indexOf(quote, i + 1)) {
    const before = body.slice(Math.max(0, i - prefix.length), i);
    const after = body.slice(i + quote.length, i + quote.length + suffix.length);
    candidates.push({ from: i, score: commonSuffix(before, prefix) + commonPrefix(after, suffix) });
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score || Math.abs(a.from - near) - Math.abs(b.from - near));
  const best = candidates[0]!;
  if (candidates.length > 1 && best.score < MIN_CONTEXT) return null;
  return { from: best.from, to: best.from + quote.length };
}

/**
 * Where the text inserted by "Apply" is now: looks for `before + replacement + after` (the
 * context as it was right after the change). Returns the range of the replaced text (empty if
 * the proposal was a deletion) or `null` if the text has changed.
 */
export function relocateApplied(body: string, applied: Applied): Range | null {
  if (applied.before === undefined || applied.after === undefined) {
    const at = body.slice(applied.from, applied.from + applied.replacement.length);
    return at === applied.replacement ? { from: applied.from, to: applied.from + at.length } : null;
  }
  const needle = applied.before + applied.replacement + applied.after;
  const idx = body.indexOf(needle);
  if (idx === -1) return null;
  const from = idx + applied.before.length;
  return { from, to: from + applied.replacement.length };
}
