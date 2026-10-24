import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { frontMatterLines } from "./frontMatter.ts";

export const setFocusMode = StateEffect.define<boolean>();

const dim = Decoration.line({ class: "cm-dim" });

/** Lines of the block (paragraph, heading, list…) that contains the cursor. */
function currentBlockLines(state: EditorState): [number, number] {
  const head = state.selection.main.head;
  const tree = syntaxTree(state);
  for (const side of [1, -1] as const) {
    let node = tree.resolveInner(head, side);
    if (node.type.name === "Document") continue;
    while (node.parent && node.parent.type.name !== "Document") node = node.parent;
    return [state.doc.lineAt(node.from).number, state.doc.lineAt(node.to).number];
  }
  const line = state.doc.lineAt(head).number;
  return [line, line];
}

function build(state: EditorState): DecorationSet {
  const [first, last] = currentBlockLines(state);
  const skip = state.facet(frontMatterLines);
  const ranges: Range<Decoration>[] = [];
  for (let n = skip + 1; n <= state.doc.lines; n++) {
    if (n < first || n > last) ranges.push(dim.range(state.doc.line(n).from));
  }
  return Decoration.set(ranges);
}

interface Value {
  on: boolean;
  decos: DecorationSet;
}

const focusField = StateField.define<Value>({
  create: () => ({ on: false, decos: Decoration.none }),
  update(value, tr) {
    let on = value.on;
    for (const e of tr.effects) if (e.is(setFocusMode)) on = e.value;
    if (!on) return value.on ? { on: false, decos: Decoration.none } : value;
    const stale =
      on !== value.on ||
      tr.docChanged ||
      tr.selection !== undefined ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState);
    return stale ? { on, decos: build(tr.state) } : value;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
});

/** Focus: dims everything except the cursor's block. */
export function focusMode(): Extension {
  return focusField;
}
