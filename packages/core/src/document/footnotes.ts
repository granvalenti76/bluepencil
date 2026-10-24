const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Footnotes cited in the passage, with their definition (from the rest of the body). */
export function footnotesIn(body: string, text: string): { id: string; text: string }[] {
  const ids = [...new Set([...text.matchAll(/\[\^([^\]\s]+)\](?!:)/g)].map((m) => m[1]!))];
  const out: { id: string; text: string }[] = [];
  for (const id of ids) {
    const def = new RegExp(`^\\[\\^${esc(id)}\\]:[ \\t]*(.*)$`, "m").exec(body);
    if (def) out.push({ id, text: def[1]!.trim() });
  }
  return out;
}

/** The next free footnote number. */
export function nextFootnoteId(body: string): string {
  let max = 0;
  for (const m of body.matchAll(/\[\^(\d+)\]/g)) max = Math.max(max, Number(m[1]));
  return String(max + 1);
}

export interface FootnoteEdit {
  id: string;
  /** `[^n]` right after the quote. */
  ref: { at: number; insert: string };
  /** `[^n]: text` at the end of the file, after the other definitions. */
  def: { from: number; to: number; insert: string };
}

/**
 * The two changes that link a source (or an opinion) to the text ending at `at`: the reference
 * and the definition at the end. Offsets in the given text.
 */
export function footnoteEdit(text: string, at: number, note: string): FootnoteEdit {
  const id = nextFootnoteId(text);
  const end = text.length;
  const trimmed = text.replace(/\s+$/, "").length;
  const lastLine = text.slice(0, trimmed).split("\n").at(-1) ?? "";
  // After another definition, just a line break; otherwise leave a blank line.
  const sep = trimmed === 0 ? "" : /^\[\^[^\]]+\]:/.test(lastLine) ? "\n" : "\n\n";
  return {
    id,
    ref: { at, insert: `[^${id}]` },
    def: {
      from: trimmed,
      to: end,
      insert: `${sep}[^${id}]: ${note.replace(/\s+/g, " ").trim()}\n`,
    },
  };
}

/**
 * For "Undo": the change that removes the definition `[^id]: …` if no reference to it is left in
 * the text. At the end of the file it also removes the blank lines that separated it.
 */
export function orphanDefinition(
  text: string,
  id: string,
): { from: number; to: number; insert: string } | null {
  if (new RegExp(`\\[\\^${esc(id)}\\](?!:)`).test(text)) return null;
  const m = new RegExp(`^\\[\\^${esc(id)}\\]:[^\\n]*(\\n|$)`, "m").exec(text);
  if (!m) return null;
  const end = m.index + m[0].length;
  if (text.slice(end).trim() !== "") return { from: m.index, to: end, insert: "" };
  let from = m.index;
  while (from > 0 && text[from - 1] === "\n") from--;
  return { from, to: text.length, insert: from > 0 ? "\n" : "" };
}
