import { StateEffect, StateField, type Range, type Text } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { proofEdit } from "@desk/core";
import { filterOf, judgmentsField, type TrackedJudgment } from "./judgmentsField.ts";

/**
 * The pencil marks on the page: each note's number next to its text, a bracket in the margin for
 * structure notes, proofreader's marks for grammar (strikethrough and ‸ with the correction) and ‸
 * at the end for a missing part. They are only decorations: the document does not change until
 * the author accepts.
 */

/** A missing part of the text (structure note without text, with a section to write). */
export interface MissingPart {
  id: string;
  n: number;
  label: string;
}

export interface MarksInfo {
  /** Note number by id, as in the notes panel. */
  numbers: Record<string, number>;
  missing: MissingPart[];
}

export const setMarks = StateEffect.define<MarksInfo>();

class NumberWidget extends WidgetType {
  readonly id: string;
  readonly n: number;
  constructor(id: string, n: number) {
    super();
    this.id = id;
    this.n = n;
  }
  override eq(o: NumberWidget) {
    return o.id === this.id && o.n === this.n;
  }
  override toDOM() {
    const el = document.createElement("span");
    el.className = "cm-jn";
    el.dataset.jn = this.id;
    // CSS draws the number (attr): the document's text stays as it is.
    el.dataset.n = String(this.n);
    el.setAttribute("aria-label", `Note ${this.n}`);
    el.setAttribute("role", "button");
    return el;
  }
  override ignoreEvent() {
    return false;
  }
}

/** A note from a later pass: only a faint dot, to show it is there. */
class WaitingWidget extends WidgetType {
  override eq() {
    return true;
  }
  override toDOM() {
    const el = document.createElement("span");
    el.className = "cm-j-waiting";
    el.setAttribute("aria-hidden", "true");
    return el;
  }
}
const WAITING = Decoration.widget({ widget: new WaitingWidget(), side: 3 });

/** The order of the passes (REVIEW_ORDER) by mark type. */
const PASS_INDEX: Record<string, number> = { struct: 0, fact: 1, prose: 2, grammar: 3 };

class InsertWidget extends WidgetType {
  readonly text: string;
  constructor(text: string) {
    super();
    this.text = text;
  }
  override eq(o: InsertWidget) {
    return o.text === this.text;
  }
  override toDOM() {
    const el = document.createElement("span");
    el.className = "cm-proof-ins";
    el.dataset.ins = this.text;
    el.setAttribute("aria-label", `suggested: ${this.text}`);
    return el;
  }
}

class MissingWidget extends WidgetType {
  readonly part: MissingPart;
  constructor(part: MissingPart) {
    super();
    this.part = part;
  }
  override eq(o: MissingWidget) {
    return (
      o.part.id === this.part.id && o.part.n === this.part.n && o.part.label === this.part.label
    );
  }
  override toDOM() {
    const el = document.createElement("div");
    el.className = "cm-missing";
    el.dataset.jn = this.part.id;
    const n = document.createElement("span");
    n.className = "cm-jn";
    n.dataset.n = String(this.part.n);
    n.setAttribute("aria-hidden", "true");
    const caret = document.createElement("span");
    caret.className = "cm-missing-caret";
    caret.textContent = "‸";
    caret.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "cm-missing-label";
    label.textContent = this.part.label;
    el.append(n, caret, label);
    return el;
  }
  override ignoreEvent() {
    return false;
  }
}

function build(
  doc: Text,
  items: TrackedJudgment[],
  visible: Record<string, boolean>,
  info: MarksInfo,
): DecorationSet {
  const out: Range<Decoration>[] = [];
  // One pass is looked at: the notes of the later ones are faint dots.
  const shown = Object.keys(visible).filter((k) => visible[k]);
  const shownIndex = shown.length === 1 ? PASS_INDEX[shown[0]!]! : Infinity;
  for (const j of items) {
    if (j.status !== "open" || j.from >= j.to || j.to > doc.length) continue;
    if (!visible[filterOf(j.kind)]) {
      if (j.kind !== "fact-ok" && PASS_INDEX[filterOf(j.kind)]! > shownIndex) {
        out.push(WAITING.range(j.to));
      }
      continue;
    }
    if (j.kind === "struct") {
      const first = doc.lineAt(j.from).number;
      const last = doc.lineAt(Math.max(j.from, j.to - 1)).number;
      for (let n = first; n <= last; n++) {
        const cls = ["cm-struct-line"];
        if (n === first) cls.push("cm-struct-first");
        if (n === last) cls.push("cm-struct-last");
        out.push(Decoration.line({ class: cls.join(" ") }).range(doc.line(n).from));
      }
    }
    if (j.kind === "grammar" && j.edit !== undefined) {
      const e = proofEdit(doc.sliceString(j.from, j.to), j.edit);
      if (e.to > e.from) {
        out.push(Decoration.mark({ class: "cm-proof-del" }).range(j.from + e.from, j.from + e.to));
      }
      if (e.insert) {
        out.push(
          Decoration.widget({ widget: new InsertWidget(e.insert), side: 1 }).range(j.from + e.to),
        );
      }
    }
    const n = info.numbers[j.id];
    if (n !== undefined) {
      // Two notes ending at the same spot: numbers in order.
      out.push(
        Decoration.widget({ widget: new NumberWidget(j.id, n), side: 2 + n / 10_000 }).range(j.to),
      );
    }
  }
  for (const part of info.missing) {
    out.push(
      Decoration.widget({ widget: new MissingWidget(part), block: true, side: 1 }).range(
        doc.length,
      ),
    );
  }
  return Decoration.set(out, true);
}

interface Value extends MarksInfo {
  decos: DecorationSet;
}

export const proofMarks = StateField.define<Value>({
  create: () => ({ numbers: {}, missing: [], decos: Decoration.none }),
  update(value, tr) {
    let info: MarksInfo = value;
    let changed = false;
    for (const e of tr.effects) {
      if (e.is(setMarks)) {
        info = e.value;
        changed = true;
      }
    }
    const now = tr.state.field(judgmentsField);
    const before = tr.startState.field(judgmentsField);
    if (
      !changed &&
      !tr.docChanged &&
      now.items === before.items &&
      now.visible === before.visible
    ) {
      return value;
    }
    return {
      numbers: info.numbers,
      missing: info.missing,
      decos: build(tr.state.doc, now.items, now.visible, info),
    };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
});
