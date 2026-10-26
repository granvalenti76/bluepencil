import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

/**
 * The style's cues on the page: the cue's number at the start of its paragraph, and the words it
 * speaks of underlined in sienna. They follow the text as it changes and are shown in Style mode,
 * and in Write if the author asks (View → Style cues; the CSS hides them elsewhere): a reference,
 * not a correction, so not in the editor's pencil. A click on a number opens the cue.
 */
export interface CueMark {
  from: number;
  to: number;
  /** The cue's number, shown at `from`; without it, only the underline. */
  n?: number;
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
    el.dataset.cue = String(this.n);
    el.setAttribute("aria-hidden", "true");
    return el;
  }
  override ignoreEvent() {
    return false;
  }
}

const build = (marks: CueMark[]): DecorationSet =>
  Decoration.set(
    marks
      .flatMap((m) => [
        ...(m.n !== undefined
          ? [Decoration.widget({ widget: new CueNumber(m.n), side: -1 }).range(m.from)]
          : []),
        ...(m.to > m.from ? [Decoration.mark({ class: "cm-cue" }).range(m.from, m.to)] : []),
      ])
      .sort((a, b) => a.from - b.from),
    true,
  );

export function cueMarks(onNumber?: (n: number) => void): Extension {
  return [
    StateField.define<DecorationSet>({
      create: () => Decoration.none,
      update(deco, tr) {
        for (const e of tr.effects) if (e.is(setCueMarks)) return build(e.value);
        return deco.map(tr.changes);
      },
      provide: (f) => EditorView.decorations.from(f),
    }),
    EditorView.domEventHandlers({
      mousedown(e) {
        const n = (e.target as HTMLElement).closest?.(".cm-cue-n") as HTMLElement | null;
        if (!n || !onNumber) return false;
        e.preventDefault();
        onNumber(Number(n.dataset.cue));
        return true;
      },
    }),
  ];
}
