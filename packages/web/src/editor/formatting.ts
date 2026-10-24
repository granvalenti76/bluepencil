import { isolateHistory } from "@codemirror/commands";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  type ChangeSpec,
  type EditorState,
  type Extension,
  type Line,
  type TransactionSpec,
} from "@codemirror/state";
import { keymap, type Command, type EditorView } from "@codemirror/view";

/**
 * Formatting bar commands. Each is a single change, isolated in the history: ⌘Z undoes it in one
 * step. The file stays standard Markdown.
 */

/** The paragraph styles of the "style ▾" menu. */
export type BlockStyle =
  "title" | "heading" | "subheading" | "body" | "quote" | "code" | "bullet" | "numbered";

const format = (spec: TransactionSpec): TransactionSpec => ({
  ...spec,
  userEvent: "input.format",
  scrollIntoView: true,
  annotations: isolateHistory.of("full"),
});

/** A line's block prefix (heading, quote, list) and the text after it. */
const PREFIX = /^(\s*)(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)?/;

const HEADING: Partial<Record<BlockStyle, string>> = {
  title: "# ",
  heading: "## ",
  subheading: "### ",
};

/** The lines touched by the selection (all selections), without repeats. */
function touchedLines(state: EditorState): Line[] {
  const seen = new Set<number>();
  const out: Line[] = [];
  for (const r of state.selection.ranges) {
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      out.push(state.doc.line(n));
    }
  }
  return out;
}

/**
 * The fenced code block that contains `pos`, if any. The tree is completed up to there: the
 * parser works in chunks and a block far from the view may not be parsed yet.
 */
function fencedCodeAt(state: EditorState, pos: number) {
  const tree = ensureSyntaxTree(state, pos + 1, 50) ?? syntaxTree(state);
  for (
    let n: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, 1);
    n;
    n = n.parent
  ) {
    if (n.name === "FencedCode") return n;
  }
  return null;
}

/**
 * The cursor is in a fenced code block: fences are counted from the start (the text, not the
 * tree, which the parser completes in chunks and may be missing far from the view).
 */
function inFencedCode(state: EditorState, pos: number): boolean {
  const n = state.doc.lineAt(pos).number;
  let open = false;
  for (let i = 1; i <= n; i++) {
    const fence = /^\s{0,3}(`{3,}|~{3,})/.test(state.doc.line(i).text);
    if (fence && i === n) return true;
    if (fence) open = !open;
  }
  return open;
}

/** The style of the cursor's paragraph: the "style ▾" menu shows it. */
export function currentStyle(state: EditorState): BlockStyle {
  const head = state.selection.main.head;
  if (inFencedCode(state, head)) return "code";
  const text = state.doc.lineAt(head).text;
  const m = /^\s*(#{1,6})\s/.exec(text);
  if (m) return m[1]!.length === 1 ? "title" : m[1]!.length === 2 ? "heading" : "subheading";
  if (/^\s*>/.test(text)) return "quote";
  if (/^\s*[-*+]\s/.test(text)) return "bullet";
  if (/^\s*\d+[.)]\s/.test(text)) return "numbered";
  return "body";
}

/** Applies the style to the selection's paragraphs; the same style a second time goes back to body. */
export function setStyle(style: BlockStyle): Command {
  return (view) => {
    const { state } = view;
    if (style === "code") return toggleCodeBlock(view);
    const target = style !== "body" && currentStyle(state) === style ? "body" : style;
    const lines = touchedLines(state).filter(
      (l) => l.length > 0 || touchedLines(state).length === 1,
    );
    const changes: ChangeSpec[] = [];
    lines.forEach((line, i) => {
      const m = PREFIX.exec(line.text)!;
      const prefixEnd = line.from + m[0].length;
      const prefix =
        HEADING[target] ??
        (target === "quote"
          ? "> "
          : target === "bullet"
            ? "- "
            : target === "numbered"
              ? `${i + 1}. `
              : "");
      changes.push({ from: line.from, to: prefixEnd, insert: prefix });
    });
    view.dispatch(state.update(format({ changes })));
    return true;
  };
}

/** Code block: ``` fences around the paragraphs; inside a block, removes them. */
function toggleCodeBlock(view: EditorView): boolean {
  const { state } = view;
  const block = fencedCodeAt(state, state.selection.main.head);
  if (block) {
    const open = state.doc.lineAt(block.from);
    const close = state.doc.lineAt(block.to);
    const changes: ChangeSpec[] = [{ from: open.from, to: Math.min(open.to + 1, close.from) }];
    if (close.number !== open.number && /^\s*(`{3,}|~{3,})\s*$/.test(close.text))
      changes.push({ from: close.from - 1, to: close.to });
    view.dispatch(state.update(format({ changes })));
    return true;
  }
  const lines = touchedLines(state);
  const first = lines[0]!;
  const last = lines[lines.length - 1]!;
  view.dispatch(
    state.update(
      format({
        changes: [
          { from: first.from, insert: "```\n" },
          { from: last.to, insert: "\n```" },
        ],
      }),
    ),
  );
  return true;
}

/** The word under the cursor, if the selection is empty: ⌘B on a word makes it bold. */
function rangeOrWord(state: EditorState, r: { from: number; to: number; empty: boolean }) {
  if (!r.empty) return { from: r.from, to: r.to };
  const word = state.wordAt(r.from);
  return word ?? { from: r.from, to: r.to };
}

/** Wraps (or unwraps) the selection with a marker: `**text**`, `*text*`, `` `text` ``. */
function toggleWrap(marker: string): Command {
  return (view) => {
    view.dispatch(
      view.state.update(
        format(
          view.state.changeByRange((sel) => {
            const range = rangeOrWord(view.state, sel);
            const { doc } = view.state;
            const before = doc.sliceString(Math.max(0, range.from - marker.length), range.from);
            const after = doc.sliceString(range.to, range.to + marker.length);
            if (before === marker && after === marker) {
              return {
                changes: [
                  { from: range.from - marker.length, to: range.from },
                  { from: range.to, to: range.to + marker.length },
                ],
                range: EditorSelection.range(range.from - marker.length, range.to - marker.length),
              };
            }
            return {
              changes: [
                { from: range.from, insert: marker },
                { from: range.to, insert: marker },
              ],
              range: EditorSelection.range(range.from + marker.length, range.to + marker.length),
            };
          }),
        ),
      ),
    );
    return true;
  };
}

/** A Markdown link that contains `pos`: text and address, with their positions. */
export interface LinkAt {
  from: number;
  to: number;
  text: { from: number; to: number };
  url: string;
}

export function linkAt(state: EditorState, pos: number): LinkAt | null {
  for (
    let n: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(
      state,
    ).resolveInner(pos, 1);
    n;
    n = n.parent
  ) {
    if (n.name !== "Link") continue;
    const marks = n.getChildren("LinkMark");
    const url = n.getChild("URL");
    if (marks.length < 2 || !url) return null;
    return {
      from: n.from,
      to: n.to,
      text: { from: marks[0]!.to, to: marks[1]!.from },
      url: state.sliceDoc(url.from, url.to),
    };
  }
  return null;
}

/**
 * Adds a link: on the selection (or the word), or changes the address of the existing link.
 * Without text it inserts the address itself as the text.
 */
export function setLink(view: EditorView, url: string): boolean {
  const { state } = view;
  const clean = url.trim();
  if (!clean) return false;
  const sel = state.selection.main;
  const existing = linkAt(state, sel.head);
  if (existing) {
    const urlFrom = existing.text.to + 2;
    view.dispatch(
      state.update(
        format({ changes: { from: urlFrom, to: urlFrom + existing.url.length, insert: clean } }),
      ),
    );
    return true;
  }
  const range = rangeOrWord(state, sel);
  const text = state.sliceDoc(range.from, range.to) || clean;
  const insert = `[${text}](${clean})`;
  view.dispatch(
    state.update(
      format({
        changes: { from: range.from, to: range.to, insert },
        selection: { anchor: range.from + insert.length },
      }),
    ),
  );
  return true;
}

/** Removes the link and keeps the text. */
export function removeLink(view: EditorView, pos: number): boolean {
  const link = linkAt(view.state, pos);
  if (!link) return false;
  const text = view.state.sliceDoc(link.text.from, link.text.to);
  view.dispatch(
    view.state.update(format({ changes: { from: link.from, to: link.to, insert: text } })),
  );
  return true;
}

/** A new block after the cursor's paragraph, separated by blank lines. */
function insertBlock(block: string, select?: [number, number]): Command {
  return (view) => {
    const { state } = view;
    const line = state.doc.lineAt(state.selection.main.to);
    const before = line.length > 0 ? "\n\n" : "";
    const nextLine = line.number < state.doc.lines ? state.doc.line(line.number + 1) : null;
    const after = nextLine && nextLine.length > 0 ? "\n\n" : nextLine ? "\n" : "\n";
    const insert = `${before}${block}${after}`;
    const at = line.to + before.length;
    view.dispatch(
      state.update(
        format({
          changes: { from: line.to, insert },
          selection: select
            ? EditorSelection.range(at + select[0], at + select[1])
            : { anchor: at + block.length },
        }),
      ),
    );
    return true;
  };
}

export const formatCommands = {
  bold: toggleWrap("**"),
  italic: toggleWrap("*"),
  code: toggleWrap("`"),
  heading: setStyle("heading"),
  quote: setStyle("quote"),
  list: setStyle("bullet"),
  numbered: setStyle("numbered"),
  separator: insertBlock("---"),
  // The image address is already selected: type over it.
  image: insertBlock("![Description](image.jpg)", [15, 24]),
  table: insertBlock("| Column | Column |\n| --- | --- |\n| | |", [2, 8]),
};

export type FormatName = keyof typeof formatCommands;

export function runFormat(view: EditorView | null, name: FormatName) {
  if (!view) return;
  formatCommands[name](view);
  view.focus();
}

/** Shortcuts: ⌘B, ⌘I, ⌘E code, ⌥⌘0–3 styles, ⇧⌘7/8 lists, ⇧⌘9 quote (⌘K: linkTools.ts). */
export function formatting(): Extension {
  return keymap.of([
    { key: "Mod-b", run: formatCommands.bold, preventDefault: true },
    { key: "Mod-i", run: formatCommands.italic, preventDefault: true },
    { key: "Mod-e", run: formatCommands.code, preventDefault: true },
    { key: "Mod-Alt-0", run: setStyle("body"), preventDefault: true },
    { key: "Mod-Alt-1", run: setStyle("title"), preventDefault: true },
    { key: "Mod-Alt-2", run: setStyle("heading"), preventDefault: true },
    { key: "Mod-Alt-3", run: setStyle("subheading"), preventDefault: true },
    { key: "Mod-Shift-7", run: setStyle("numbered"), preventDefault: true },
    { key: "Mod-Shift-8", run: setStyle("bullet"), preventDefault: true },
    { key: "Mod-Shift-9", run: setStyle("quote"), preventDefault: true },
  ]);
}
