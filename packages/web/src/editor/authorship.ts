import { StateEffect, StateField, type Range } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

/**
 * The stretches that entered the text through an accepted suggestion. They follow the edits; if
 * the author writes inside one, the stretch becomes theirs again and disappears. ⌘Z removes it
 * too, because it deletes or replaces the inserted text.
 */
export interface AuthoredRange {
  from: number;
  to: number;
  /** Where it comes from: a review pass, "rewrite" or "section". */
  source: string;
}

/** A just-accepted stretch: positions in the document after the change. */
export const addAuthored = StateEffect.define<AuthoredRange>();
export const setAuthored = StateEffect.define<AuthoredRange[]>();
export const showAuthored = StateEffect.define<boolean>();

interface Value {
  ranges: AuthoredRange[];
  show: boolean;
  decos: DecorationSet;
}

const MARK = Decoration.mark({ class: "cm-authored" });

function build(ranges: AuthoredRange[], show: boolean): DecorationSet {
  if (!show) return Decoration.none;
  const out: Range<Decoration>[] = ranges.map((r) => MARK.range(r.from, r.to));
  return Decoration.set(out, true);
}

export const authorshipField = StateField.define<Value>({
  create: () => ({ ranges: [], show: false, decos: Decoration.none }),
  update(value, tr) {
    let { ranges, show } = value;
    if (tr.docChanged) {
      const next: AuthoredRange[] = [];
      for (const r of ranges) {
        let touched = false;
        tr.changes.iterChangedRanges((fromA, toA) => {
          if (fromA < r.to && toA > r.from) touched = true;
          else if (fromA === toA && fromA > r.from && fromA < r.to) touched = true;
        });
        if (touched) continue;
        const from = tr.changes.mapPos(r.from, 1);
        const to = tr.changes.mapPos(r.to, -1);
        if (to > from) next.push({ ...r, from, to });
      }
      ranges = next;
    }
    for (const e of tr.effects) {
      if (e.is(setAuthored)) ranges = e.value;
      else if (e.is(addAuthored) && e.value.to > e.value.from) ranges = [...ranges, e.value];
      else if (e.is(showAuthored)) show = e.value;
    }
    if (ranges === value.ranges && show === value.show) return value;
    return { ranges, show, decos: build(ranges, show) };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
});
