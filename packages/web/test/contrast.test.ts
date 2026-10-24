import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** The token colours (tokens.css), with `var(--x)` references resolved. */
function tokens(): Record<string, string> {
  const css = readFileSync(new URL("../src/theme/tokens.css", import.meta.url), "utf8");
  const raw: Record<string, string> = {};
  for (const m of css.matchAll(/--([\w-]+):\s*([^;]+);/g)) raw[m[1]!] = m[2]!.trim();
  const resolve = (v: string, depth = 0): string => {
    const ref = /^var\(--([\w-]+)\)$/.exec(v);
    return ref && depth < 5 ? resolve(raw[ref[1]!]!, depth + 1) : v;
  };
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, resolve(v)]));
}

function luminance(hex: string): number {
  const n = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!n) throw new Error(`not a hex colour: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(n[1]!.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

/**
 * Interface text and marks on the surfaces where they appear (WCAG AA, 4.5:1), line numbers
 * included. `text-faint` is left out: it is for decorations (list dashes, visible markers), not
 * for text to read.
 */
const PAIRS: [string, string][] = [
  ...["text", "text-2", "text-muted"].flatMap((t) =>
    ["paper", "desk", "surface", "bg", "bg-sidebar", "bg-toolbar", "pencil-bg"].map(
      (bg) => [t, bg] as [string, string],
    ),
  ),
  ["on-accent", "accent"],
  ["pencil", "paper"],
  ["pencil", "surface"],
  ["pencil", "pencil-bg"],
  ["pencil-strong", "pencil-bg"],
  ["pencil-strong", "paper"],
  ["accent-text", "accent-bg"],
  ["warn-text", "paper"],
  ["warn-text", "desk"],
  ["fact-ok", "paper"],
  ["line-number", "paper"],
  ["text", "code-bg"],
  ["text-2", "code-bg"],
  ["text", "selection"],
  ["text-muted", "card"],
];

describe("token contrast", () => {
  const t = tokens();
  it.each(PAIRS)("--%s su --%s almeno 4,5:1", (fg, bg) => {
    expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
  });
});
