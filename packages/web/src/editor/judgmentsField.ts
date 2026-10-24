import { invertedEffects } from "@codemirror/commands";
import {
  StateEffect,
  StateField,
  type ChangeSet,
  type Extension,
  type Range,
} from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { deskAction } from "./deskAction.ts";

export type JudgmentKind = "fact-ok" | "fact" | "grammar" | "prose" | "struct";
export type FilterType = "fact" | "grammar" | "prose" | "struct";
export type TrackedStatus = "open" | "applied" | "ignored" | "stale";

/** What "Apply" did to the text, to be able to undo it (document offsets). */
export interface AppliedEdit {
  from: number;
  to: number;
  original: string;
  replacement: string;
  before: string;
  after: string;
}

export interface TrackedJudgment {
  id: string;
  kind: JudgmentKind;
  /** Offset in the editor's document. */
  from: number;
  to: number;
  status: TrackedStatus;
  applied?: AppliedEdit;
  /** Proposed grammar correction (replacement, "" = deletion): drawn as a proofreader's mark
   *  (proofMarks.ts) instead of an underline. */
  edit?: string;
}

export const filterOf = (kind: JudgmentKind): FilterType => (kind === "fact-ok" ? "fact" : kind);

export const setJudgments = StateEffect.define<TrackedJudgment[]>();
export interface JudgmentUpdate {
  id: string;
  status?: TrackedStatus;
  from?: number;
  to?: number;
  /** `null` = nothing left to undo. */
  applied?: AppliedEdit | null;
}

export const updateJudgment = StateEffect.define<JudgmentUpdate>({
  // The effects recorded by the history (Cmd+Z) follow the later changes.
  map: (v, mapping) => ({
    ...v,
    from: v.from === undefined ? undefined : mapping.mapPos(v.from, 1),
    to: v.to === undefined ? undefined : mapping.mapPos(v.to, -1),
  }),
});
/** New notes arriving during the review (added) and superseded notes (removed). */
export const addJudgments = StateEffect.define<{ add: TrackedJudgment[]; remove: string[] }>({
  map: (v, mapping) => ({
    ...v,
    add: v.add.map((j) => ({
      ...j,
      from: mapping.mapPos(j.from, 1),
      to: mapping.mapPos(j.to, -1),
    })),
  }),
});
export const setVisibleTypes = StateEffect.define<Record<FilterType, boolean>>();
/** The marks just drawn (markDrawing.ts): once the animation ends, they stay still. */
export const endDrawing = StateEffect.define<null>();
export const setActiveJudgment = StateEffect.define<string | null>();

interface Value {
  /** Judgments whose text changed through an action on the notes (to re-anchor on the server). */
  reanchored: string[];
  items: TrackedJudgment[];
  visible: Record<FilterType, boolean>;
  active: string | null;
  /** Notes that just arrived, whose mark is drawn: id → arrival order in the group. */
  drawing: ReadonlyMap<string, number>;
  decos: DecorationSet;
}

type Touch = "none" | "contained" | "stale";

/**
 * How a change touches a judgment: it overlaps or falls inside (`stale`), or, if it is an action
 * on the notes (`fromDesk`: "Apply", "Undo", Cmd+Z) and lies entirely inside a larger judgment
 * (e.g. "Apply" on a repetition inside the paragraph of a structure note), it leaves it valid but
 * changes its text (`contained`: to be re-anchored).
 */
function touch(changes: ChangeSet, from: number, to: number, fromDesk: boolean): Touch {
  let result: Touch = "none";
  changes.iterChangedRanges((fromA, toA) => {
    const inside = fromA === toA ? fromA > from && fromA < to : fromA < to && toA > from;
    if (!inside) return;
    if (fromDesk && fromA >= from && toA <= to && !(fromA === from && toA === to)) {
      if (result === "none") result = "contained";
    } else {
      result = "stale";
    }
  });
  return result;
}

/** One mark after another, but quickly: after eight, all together (the same pace as the notes). */
const DRAW_STEP = 110;
export const DRAW_TIME = 650 + DRAW_STEP * 8;

function build(value: Pick<Value, "items" | "visible" | "active" | "drawing">): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const j of value.items) {
    // Structure: no underline. Applied, ignored and stale: none.
    if (j.status !== "open" || j.kind === "struct" || j.from >= j.to) continue;
    if (!value.visible[filterOf(j.kind)]) continue;
    const proof = j.kind === "grammar" && j.edit !== undefined ? " cm-j-proof" : "";
    const order = proof ? undefined : value.drawing.get(j.id);
    const draw = order === undefined ? "" : " cm-j-draw";
    const cls = `cm-j cm-j-${j.kind}${proof}${draw}${value.active === j.id ? " cm-j-active" : ""}`;
    const attributes: Record<string, string> = { "data-j": j.id };
    if (order !== undefined) attributes.style = `--draw-delay: ${Math.min(order, 8) * DRAW_STEP}ms`;
    ranges.push(Decoration.mark({ class: cls, attributes }).range(j.from, j.to));
  }
  return Decoration.set(ranges, true);
}

export const judgmentsField = StateField.define<Value>({
  create: () => ({
    items: [],
    reanchored: [],
    visible: { fact: true, grammar: true, prose: true, struct: true },
    active: null,
    drawing: new Map(),
    decos: Decoration.none,
  }),
  update(value, tr) {
    let { items, visible, active, drawing } = value;
    const reanchored: string[] = [];

    if (tr.docChanged) {
      // Actions on the notes always carry an effect on the judgments (Cmd+Z too, which inverts them).
      const fromDesk =
        tr.annotation(deskAction) === true || tr.effects.some((e) => e.is(updateJudgment));
      items = items.map((j) => {
        const from = tr.changes.mapPos(j.from, 1);
        const to = Math.max(from, tr.changes.mapPos(j.to, -1));
        const hit = j.status === "stale" ? "none" : touch(tr.changes, j.from, j.to, fromDesk);
        if (hit === "stale" && j.status === "open") return { ...j, from, to, status: "stale" };
        if (hit === "contained") reanchored.push(j.id);
        return { ...j, from, to };
      });
    }

    for (const e of tr.effects) {
      if (e.is(setJudgments)) {
        items = e.value;
      } else if (e.is(addJudgments)) {
        const known = new Set(items.map((j) => j.id));
        const fresh = e.value.add.filter((j) => !known.has(j.id));
        if (fresh.length) {
          const next = new Map(drawing);
          for (const j of [...fresh].sort((a, b) => a.from - b.from)) next.set(j.id, next.size);
          drawing = next;
        }
        const drop = new Set([...e.value.remove, ...e.value.add.map((j) => j.id)]);
        items = [...items.filter((j) => !drop.has(j.id)), ...e.value.add];
      } else if (e.is(endDrawing)) {
        drawing = new Map();
      } else if (e.is(updateJudgment)) {
        const { id, applied, ...patch } = e.value;
        items = items.map((j) => {
          if (j.id !== id) return j;
          const next = { ...j, ...definedOnly(patch) };
          if (applied === null) delete next.applied;
          else if (applied) next.applied = applied;
          return next;
        });
      } else if (e.is(setVisibleTypes)) {
        visible = e.value;
      } else if (e.is(setActiveJudgment)) {
        active = e.value;
      }
    }

    const changed =
      items !== value.items ||
      visible !== value.visible ||
      active !== value.active ||
      drawing !== value.drawing;
    return {
      items,
      reanchored: reanchored.filter((id) => items.find((j) => j.id === id)?.status !== "stale"),
      visible,
      active,
      drawing,
      decos: changed ? build({ items, visible, active, drawing }) : value.decos,
    };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
});

function definedOnly<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export interface StatusChange {
  id: string;
  status: TrackedStatus;
  from: number;
  to: number;
  applied?: AppliedEdit;
}

/**
 * Reports when a judgment's state changes: `stale` for an edit by the author,
 * `applied`/`ignored`/`open` for the actions on the notes and for Cmd+Z.
 */
export function statusListener(
  onChange: (changes: StatusChange[]) => void,
  onReanchor?: (items: { id: string; status: TrackedStatus; from: number; to: number }[]) => void,
): Extension {
  return EditorView.updateListener.of((u) => {
    const { items: now, reanchored } = u.state.field(judgmentsField);
    if (onReanchor && reanchored.length > 0) {
      onReanchor(
        now
          .filter((j) => reanchored.includes(j.id))
          .map(({ id, status, from, to }) => ({ id, status, from, to })),
      );
    }
    const before = new Map(u.startState.field(judgmentsField).items.map((j) => [j.id, j.status]));
    const changes: StatusChange[] = [];
    for (const j of u.state.field(judgmentsField).items) {
      const old = before.get(j.id);
      if (old !== undefined && old !== j.status) {
        changes.push({ id: j.id, status: j.status, from: j.from, to: j.to, applied: j.applied });
      }
    }
    if (changes.length > 0) onChange(changes);
  });
}

/** Cmd+Z / Redo also restore the judgment's state (not just the text). */
export const judgmentHistory: Extension = invertedEffects.of((tr) => {
  const items = tr.startState.field(judgmentsField).items;
  const out: StateEffect<JudgmentUpdate>[] = [];
  for (const e of tr.effects) {
    if (!e.is(updateJudgment)) continue;
    const old = items.find((j) => j.id === e.value.id);
    if (!old) continue;
    out.push(
      updateJudgment.of({
        id: old.id,
        status: old.status,
        from: old.from,
        to: old.to,
        applied: old.applied ?? null,
      }),
    );
  }
  return out;
});

/** Click on an underline or on a note's number: the interface highlights the note. */
export function judgmentClick(onClick: (id: string) => void): Extension {
  return EditorView.domEventHandlers({
    click(event) {
      const el = (event.target as HTMLElement | null)?.closest?.("[data-j], [data-jn]");
      const id = el?.getAttribute("data-j") ?? el?.getAttribute("data-jn");
      if (id) onClick(id);
      return false;
    },
  });
}
