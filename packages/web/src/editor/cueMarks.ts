import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

/**
 * The style's cues on the page: the passage underlined in sienna, with the cue's number before it.
 * They follow the text as it changes and are shown only in Style mode (the CSS hides them
 * elsewhere): a reference, not a correction, so not in the editor's pencil.
 */
export interface CueMark {
  from: number;
  to: number;
  n: number;
}

export const setCueMarks = StateEffect.define<CueMark[]>();

class CueNumber extends WidgetType {
  readonly n: number;
  constructor(n: number) {
    super();
    this.n = n;
  }
  override eq(other: CueNumber) {
    return other.n === this.n;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-cue-n";
    el.textContent = String(this.n);
    el.setAttribute("aria-hidden", "true");
    return el;
  }
}

const build = (marks: CueMark[]): DecorationSet =>
  Decoration.set(
    marks
      .filter((m) => m.to > m.from)
      .sort((a, b) => a.from - b.from)
      .flatMap((m) => [
        Decoration.widget({ widget: new CueNumber(m.n), side: -1 }).range(m.from),
        Decoration.mark({ class: "cm-cue" }).range(m.from, m.to),
      ]),
    true,
  );

export function cueMarks(): Extension {
  return StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(deco, tr) {
      for (const e of tr.effects) if (e.is(setCueMarks)) return build(e.value);
      return deco.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}
