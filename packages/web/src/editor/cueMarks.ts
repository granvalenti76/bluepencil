import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

/**
 * The editor's reading beside a style, on the page: at the start of a paragraph what it does
 * ("opening", "scene") and the number of its cue, and the words a cue speaks of underlined:
 * sienna where the draft does otherwise than the style, the pencil where it already does the same.
 * They follow the text as it changes and are shown in Style mode, and the numbers and underlines
 * in Write if the author asks (View → Style cues; the CSS hides them elsewhere). A click on a
 * number opens the cue.
 */
export type CueTone = "differs" | "like" | "missing";

export interface CueMark {
  from: number;
  to: number;
  /** The cue's number, shown at `from`. */
  n?: number;
  /** What the paragraph does, shown at `from`, before the number. */
  label?: string;
  tone?: CueTone;
}

export const setCueMarks = StateEffect.define<CueMark[]>();

class CueNumber extends WidgetType {
  readonly n: number;
  readonly tone: CueTone;
  constructor(n: number, tone: CueTone) {
    super();
    this.n = n;
    this.tone = tone;
  }
  override eq(other: CueNumber) {
    return other.n === this.n && other.tone === this.tone;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-cue-n";
    el.textContent = String(this.n);
    el.dataset.cue = String(this.n);
    el.dataset.tone = this.tone;
    el.setAttribute("aria-hidden", "true");
    return el;
  }
  override ignoreEvent() {
    return false;
  }
}

class ParagraphLabel extends WidgetType {
  readonly label: string;
  constructor(label: string) {
    super();
    this.label = label;
  }
  override eq(other: ParagraphLabel) {
    return other.label === this.label;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-cue-fn";
    el.textContent = this.label;
    el.setAttribute("aria-hidden", "true");
    return el;
  }
}

const build = (marks: CueMark[]): DecorationSet =>
  Decoration.set(
    marks.flatMap((m) => [
      ...(m.label
        ? [Decoration.widget({ widget: new ParagraphLabel(m.label), side: -2 }).range(m.from)]
        : []),
      ...(m.n !== undefined
        ? [
            Decoration.widget({ widget: new CueNumber(m.n, m.tone ?? "differs"), side: -1 }).range(
              m.from,
            ),
          ]
        : []),
      ...(m.to > m.from
        ? [
            Decoration.mark({
              class: "cm-cue",
              attributes: { "data-tone": m.tone ?? "differs" },
            }).range(m.from, m.to),
          ]
        : []),
    ]),
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
