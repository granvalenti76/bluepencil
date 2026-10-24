import type { Judgment, ModelJudgment } from "./schema.ts";

export interface Range {
  from: number;
  to: number;
}

const ANCHOR_CONTEXT = 32;
const FUZZY_MIN_LENGTH = 15;
const FUZZY_MAX_DISTANCE = 6;

interface Normalized {
  norm: string;
  /** map[i] = index in the original text of normalized character i. */
  map: number[];
}

const QUOTES: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "‚": "'",
  "“": '"',
  "”": '"',
  "„": '"',
};

function normalize(text: string): Normalized {
  let norm = "";
  const map: number[] = [];
  let inSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      if (!inSpace && norm !== "") {
        norm += " ";
        map.push(i);
      }
      inSpace = true;
      continue;
    }
    inSpace = false;
    norm += QUOTES[ch] ?? ch;
    map.push(i);
  }
  if (norm.endsWith(" ")) {
    norm = norm.slice(0, -1);
    map.pop();
  }
  return { norm, map };
}

/** Best approximate match of `pattern` in `text` (Sellers): [start, end) and distance. */
function fuzzyFind(text: string, pattern: string, maxDistance: number) {
  const m = pattern.length;
  let prevCost = Array.from({ length: m + 1 }, (_, i) => i);
  let prevStart = new Array<number>(m + 1).fill(0);
  let best: { start: number; end: number; distance: number } | null = null;
  for (let j = 1; j <= text.length; j++) {
    const cost = [0];
    const start = [j];
    for (let i = 1; i <= m; i++) {
      const sub = prevCost[i - 1]! + (pattern[i - 1] === text[j - 1] ? 0 : 1);
      const del = prevCost[i]! + 1; // extra character in the text
      const ins = cost[i - 1]! + 1; // missing character in the text
      if (sub <= del && sub <= ins) {
        cost.push(sub);
        start.push(prevStart[i - 1]!);
      } else if (del <= ins) {
        cost.push(del);
        start.push(prevStart[i]!);
      } else {
        cost.push(ins);
        start.push(start[i - 1]!);
      }
    }
    const d = cost[m]!;
    if (d <= maxDistance && (best === null || d < best.distance)) {
      best = { start: start[m]!, end: j, distance: d };
    }
    prevCost = cost;
    prevStart = start;
  }
  return best;
}

/**
 * Finds `quote` inside `text`: exact, then with whitespace and typographic quotes normalized,
 * then approximate (bounded distance). Returns the range in the original text or `null`.
 */
export function resolveQuote(text: string, quote: string): Range | null {
  const q = quote.trim();
  if (q === "") return null;

  const exact = text.indexOf(q);
  if (exact !== -1) return { from: exact, to: exact + q.length };

  const t = normalize(text);
  const n = normalize(q).norm;
  if (n === "") return null;

  const hit = t.norm.indexOf(n);
  if (hit !== -1) return toOriginal(t, hit, hit + n.length);

  if (n.length < FUZZY_MIN_LENGTH) return null;
  const maxDistance = Math.min(Math.floor(n.length * 0.1), FUZZY_MAX_DISTANCE);
  const fuzzy = fuzzyFind(t.norm, n, maxDistance);
  return fuzzy ? toOriginal(t, fuzzy.start, fuzzy.end) : null;
}

function toOriginal(t: Normalized, start: number, end: number): Range {
  return { from: t.map[start]!, to: t.map[end - 1]! + 1 };
}

export type ResolveResult =
  | { ok: true; range: Range | null; anchor: Judgment["anchor"] }
  | { ok: false; reason: "quote_not_found" | "noop_replace" };

/**
 * Resolves a model judgment in the file's body. `block` is the range of the passage that was
 * checked: the quote is searched only there. A judgment that cannot be resolved is discarded
 * and logged: better to lose a suggestion than to underline the wrong text.
 */
export function resolveJudgment(
  body: string,
  block: Range,
  judgment: ModelJudgment,
): ResolveResult {
  if (judgment.quote.trim() === "") {
    return { ok: true, range: null, anchor: { quote: "", prefix: "", suffix: "" } };
  }
  const local = resolveQuote(body.slice(block.from, block.to), judgment.quote);
  if (local === null) return { ok: false, reason: "quote_not_found" };

  const range = { from: block.from + local.from, to: block.from + local.to };
  const original = body.slice(range.from, range.to);

  const { action, text } = judgment.proposal;
  if (action === "replace" && text !== undefined && sameText(text, original)) {
    return { ok: false, reason: "noop_replace" };
  }

  return {
    ok: true,
    range,
    anchor: {
      quote: original,
      prefix: body.slice(Math.max(0, range.from - ANCHOR_CONTEXT), range.from),
      suffix: body.slice(range.to, range.to + ANCHOR_CONTEXT),
    },
  };
}

function sameText(a: string, b: string): boolean {
  return normalize(a).norm === normalize(b).norm;
}
