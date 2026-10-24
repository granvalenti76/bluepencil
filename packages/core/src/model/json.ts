export type JsonExtract = { ok: true; value: unknown } | { ok: false; error: string };

/**
 * Extracts the JSON from the final response: first a ```json block, then the first balanced
 * array or object in the text.
 */
export function extractJson(text: string): JsonExtract {
  const fences = [...text.matchAll(/```(?:json|JSON)?[ \t]*\r?\n([\s\S]*?)```/g)];
  for (const f of fences) {
    const r = tryParse(f[1]!.trim());
    if (r.ok) return r;
  }
  const whole = tryParse(text.trim());
  if (whole.ok) return whole;

  let lastError = text.trim() === "" ? "empty response" : "no JSON array or object";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "[" && ch !== "{") continue;
    const end = matchingBracket(text, i);
    if (end === -1) {
      lastError = "unterminated JSON";
      continue;
    }
    const r = tryParse(text.slice(i, end + 1));
    if (r.ok) return r;
    lastError = r.error;
  }
  return { ok: false, error: lastError };
}

/**
 * All JSON values (arrays or objects) in the text, in order: a small model may send the notes in
 * one block and the score in another. Inside a value already found, the search stops.
 */
export function extractAllJson(text: string): unknown[] {
  const whole = tryParse(text.trim());
  if (whole.ok) return [whole.value];
  const values: unknown[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "[" && ch !== "{") continue;
    const end = matchingBracket(text, i);
    if (end === -1) continue;
    const r = tryParse(text.slice(i, end + 1));
    if (r.ok) {
      values.push(r.value);
      i = end;
    }
  }
  return values;
}

function tryParse(s: string): JsonExtract {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch (e) {
    // Quotes inside a string without `\` (e.g. «l'espressione "agent harness"»): a typical
    // small-model mistake. Repaired only if that makes the JSON readable.
    const repaired = escapeStrayQuotes(s);
    if (repaired !== s) {
      try {
        return { ok: true, value: JSON.parse(repaired) };
      } catch {
        /* keep the original error */
      }
    }
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Inside a string, `"` closes it only if it is followed (spaces aside) by `,` `:` `}` `]` or the
 * end; otherwise it is a quote in the text and is written `\"`.
 */
function escapeStrayQuotes(s: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (ch === "\\") {
      out += ch + (s[i + 1] ?? "");
      i++;
    } else if (ch === '"') {
      const next = s.slice(i + 1).match(/^\s*(.)/)?.[1];
      if (next === undefined || ",:}]".includes(next)) {
        inString = false;
        out += ch;
      } else out += '\\"';
    } else out += ch;
  }
  return out;
}

function matchingBracket(text: string, start: number): number {
  const stack: string[] = [];
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[" || ch === "{") stack.push(ch === "[" ? "]" : "}");
    else if (ch === "]" || ch === "}") {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}
