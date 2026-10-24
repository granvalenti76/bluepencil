import { paragraphs } from "../review/blocks.ts";

/**
 * The passages of a source file: a paragraph, or one item per line in lists (in `fatti.md`
 * each item is a fact). Footnote definitions are left out.
 */
export function sourcePassages(body: string): string[] {
  const out: string[] = [];
  for (const p of paragraphs(body)) {
    const lines = p.text.split("\n");
    if (lines.every((l) => /^\s*([-*+]|\d+[.)])\s+/.test(l) || /^\s{2,}\S/.test(l))) {
      for (const l of lines) {
        const t = l.replace(/^\s*([-*+]|\d+[.)])\s+/, "").trim();
        if (t) out.push(t);
      }
    } else if (!/^#{1,6}\s/.test(p.text)) {
      out.push(p.text);
    }
  }
  return out;
}

/** What is needed, from the draft's language, to pick the terms (from the language pack). */
export interface QueryLanguage {
  stopWords: readonly string[];
  /** A capitalised word suggests a proper noun (not true in German). */
  capitalizedNames: boolean;
}

/**
 * Terms to search the sources for a passage: numbers, proper nouns and acronyms, long words.
 * Returns an FTS5 query (quoted phrases joined by OR), or `null` if there is nothing to search.
 */
export function sourceQuery(text: string, lang: QueryLanguage, max = 24): string | null {
  const stop = new Set(lang.stopWords);
  const clean = text
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\[\^[^\]]+\]/g, " ")
    .replace(/[#*_`>]/g, " ");
  const terms: string[] = [];
  const seen = new Set<string>();
  const push = (t: string) => {
    const k = t.toLowerCase();
    if (seen.has(k) || terms.length >= max) return;
    seen.add(k);
    terms.push(t);
  };
  // Acronyms and names with digits or inner capitals (Qwen3.6-35B-3B, llama-server), numbers.
  for (const m of clean.matchAll(/[\p{L}\p{N}][\p{L}\p{N}.\-_]*[\p{L}\p{N}]|\p{N}+/gu)) {
    const w = m[0];
    if (/\p{N}/u.test(w) || /\p{Lu}/u.test(w.slice(1)) || /-/.test(w)) push(w);
  }
  // Parts of compound names: "Qwen3.6-35B-3B" must also find "Qwen3.6-35B-A3B".
  for (const t of [...terms]) {
    if (!/[.\-_]/.test(t)) continue;
    for (const piece of t.split(/[.\-_]+/))
      if (piece.length >= 3 && /\p{L}/u.test(piece)) push(piece);
  }
  if (lang.capitalizedNames) for (const m of clean.matchAll(/\p{Lu}\p{Ll}{2,}/gu)) push(m[0]);
  for (const m of clean.matchAll(/\p{L}{6,}/gu)) {
    if (!stop.has(m[0].toLowerCase())) push(m[0]);
  }
  if (terms.length === 0) return null;
  return terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
}
