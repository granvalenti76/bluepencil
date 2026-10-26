import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

/**
 * The words a cue of the editor's reading speaks of, underlined on the page: sienna where the
 * draft does otherwise than the style, the pencil where it already does the same. They follow
 * the text as it changes and are shown with the style's margin (styleMargin.ts): in Style mode,
 * and in Write with View → Style cues (the CSS hides them elsewhere).
 */
export type CueTone = "differs" | "like" | "missing";

export interface CueMark {
  from: number;
  to: number;
  tone?: CueTone;
}

export const setCueMarks = StateEffect.define<CueMark[]>();

const build = (marks: CueMark[]): DecorationSet =>
  Decoration.set(
    marks
      .filter((m) => m.to > m.from)
      .map((m) =>
        Decoration.mark({
          class: "cm-cue",
          attributes: { "data-tone": m.tone ?? "differs" },
        }).range(m.from, m.to),
      ),
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
