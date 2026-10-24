import type { Judgment } from "@desk/core";
import { Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { addAuthored } from "../editor/authorship.ts";
import { deskAction } from "../editor/deskAction.ts";
import {
  filterOf,
  judgmentsField,
  updateJudgment,
  type FilterType,
  type JudgmentKind,
  type StatusChange,
  type TrackedJudgment,
} from "../editor/judgmentsField.ts";
import { api } from "./api.ts";
import { markOpinion, withOrphanRemoved } from "./footnotes.ts";
import { useDoc } from "./docStore.ts";
import { useJudgments } from "./store.ts";

const CONTEXT = 32;

export const TYPE_LABEL: Record<FilterType, string> = {
  fact: "Facts",
  grammar: "Grammar",
  prose: "Prose",
  struct: "Structure",
};

/** How a judgment is drawn: pass and fact state decide the underline. */
export function trackedKind(j: Pick<Judgment, "pass" | "factStatus">): JudgmentKind {
  switch (j.pass) {
    case "structure":
      return "struct";
    case "grammar":
      return "grammar";
    case "prose":
      return "prose";
    case "facts":
      return j.factStatus === "verified" ? "fact-ok" : "fact";
  }
}

export const noteType = (j: Judgment): FilterType => filterOf(trackedKind(j));

/** Verified facts are underlined but have no note. */
export const hasCard = (j: Judgment) => trackedKind(j) !== "fact-ok";

/** What the note shows after the main action ("Correction applied", …). */
export function doneLabel(j: Judgment): string {
  if (j.status === "ignored") return "Ignored";
  switch (j.proposal.action) {
    case "replace":
      return "Correction applied";
    case "delete":
      return "Text removed";
    case "insert_after":
      return "Text inserted";
    case "add_source":
      return "Source added";
    case "compare_sources":
      return "Sources compared";
    case "draft_section":
      // "Add empty section": only the heading (or the marker), no text from the model.
      return j.applied &&
        !/[^\s]/.test(j.applied.replacement.replace(/^\s*(#{1,6}[ \t][^\n]*|<!--[^>]*-->)\s*$/, ""))
        ? "Empty section added"
        : "Suggestion inserted";
    case "regenerate_section":
      return "Suggestion inserted";
    case "mark_opinion":
      return "Marked as opinion";
    default:
      return "Done";
  }
}

/** From the server (body offsets) to the editor (document offsets). */
export function toTracked(j: Judgment, bodyOffset: number): TrackedJudgment | null {
  if (j.range === null || j.status === "stale") return null;
  return {
    id: j.id,
    kind: trackedKind(j),
    from: j.range.from + bodyOffset,
    to: j.range.to + bodyOffset,
    status: j.status,
    ...(j.pass === "grammar" && j.proposal.action === "delete" ? { edit: "" } : {}),
    ...(j.pass === "grammar" && j.proposal.action === "replace" && j.proposal.text !== undefined
      ? { edit: j.proposal.text }
      : {}),
    ...(j.applied
      ? {
          applied: {
            ...j.applied,
            from: j.applied.from + bodyOffset,
            to: j.applied.to + bodyOffset,
            before: j.applied.before ?? "",
            after: j.applied.after ?? "",
          },
        }
      : {}),
  };
}

/** Saves to the server the states changed in the editor (apply, ignore, undo, stale). */
export function persistStatusChanges(changes: StatusChange[], bodyOffset: number) {
  for (const c of changes) {
    const range = { from: c.from - bodyOffset, to: c.to - bodyOffset };
    const applied = c.applied
      ? { ...c.applied, from: c.applied.from - bodyOffset, to: c.applied.to - bodyOffset }
      : undefined;
    const store = useJudgments.getState();
    store.patchNote(c.id, { status: c.status, range, ...(applied ? { applied } : {}) }, !applied);
    void api.patchJudgment(c.id, { status: c.status, range, applied }).catch(() => {
      /* the next load realigns the state */
    });
  }
}

/**
 * An action on the notes changed the text inside another judgment (e.g. the repetition fixed
 * inside the lead): its new position and new anchor are saved, so the server finds it again on
 * reload.
 */
export function persistReanchor(
  view: EditorView,
  items: { id: string; status: string; from: number; to: number }[],
  bodyOffset: number,
) {
  for (const { id, status, from, to } of items) {
    const doc = view.state.doc;
    const anchor = {
      quote: doc.sliceString(from, to),
      prefix: doc.sliceString(Math.max(0, from - CONTEXT), from),
      suffix: doc.sliceString(to, to + CONTEXT),
    };
    const range = { from: from - bodyOffset, to: to - bodyOffset };
    useJudgments.getState().patchNote(id, { range, anchor });
    void api.patchJudgment(id, { status, range, anchor }).catch(() => {});
  }
}

/** For notes without text (section notes): the state does not go through the editor. */
function persistDirect(id: string, status: "open" | "applied" | "ignored") {
  useJudgments.getState().patchNote(id, { status });
  void api.patchJudgment(id, { status }).catch(() => {});
}

const note = (id: string) => useJudgments.getState().notes.find((n) => n.id === id);
const item = (view: EditorView, id: string) =>
  view.state.field(judgmentsField).items.find((j) => j.id === id);

/** The note's main action: changes the text only on the author's click, undoable. */
function apply(view: EditorView | null, id: string) {
  const n = note(id);
  if (!n || n.status !== "open") return;
  const tracked = view && n.range !== null ? item(view, id) : undefined;
  if (!view || !tracked) return persistDirect(id, "applied");

  const { action, text } = n.proposal;
  if (action === "mark_opinion") {
    markOpinion(view, n);
    return;
  }
  const doc = view.state.doc;
  let from = tracked.from;
  let to = tracked.to;
  let insert: string | null = null;

  if (action === "replace") insert = text ?? "";
  else if (action === "delete") insert = "";
  else if (action === "insert_after") {
    from = to = tracked.to;
    insert = text ?? "";
  }

  if (insert === null) {
    view.dispatch({ effects: updateJudgment.of({ id, status: "applied" }) });
    return;
  }

  // Removing a word between two spaces removes one of them too, so no double space is left.
  if (
    insert === "" &&
    doc.sliceString(from - 1, from) === " " &&
    doc.sliceString(to, to + 1) === " "
  )
    to += 1;

  const spec = { from, to, insert };
  const next = view.state.changes(spec).apply(doc);
  const end = from + insert.length;
  view.dispatch({
    changes: spec,
    effects: [
      updateJudgment.of({
        id,
        status: "applied",
        from,
        to: end,
        applied: {
          from,
          to: end,
          original: doc.sliceString(from, to),
          replacement: insert,
          before: next.sliceString(Math.max(0, from - CONTEXT), from),
          after: next.sliceString(end, end + CONTEXT),
        },
      }),
      // The accepted model text: counts towards authorship.
      ...(insert ? [addAuthored.of({ from, to: end, source: n.pass })] : []),
    ],
    annotations: [deskAction.of(true), Transaction.userEvent.of("input.note")],
  });
}

function ignore(view: EditorView | null, id: string) {
  const n = note(id);
  if (!n || n.status !== "open") return;
  if (!view || !item(view, id)) return persistDirect(id, "ignored");
  view.dispatch({ effects: updateJudgment.of({ id, status: "ignored" }) });
}

/** Is the text inserted by "Apply" still there (not changed by hand afterwards)? */
export function canUndo(view: EditorView | null, id: string): boolean {
  const n = note(id);
  if (!n || n.status === "open") return false;
  const tracked = view && n.range !== null ? item(view, id) : undefined;
  if (view && !tracked && n.applied) {
    const off = useDoc.getState().bodyOffset;
    return view.state.sliceDoc(n.applied.from + off, n.applied.to + off) === n.applied.replacement;
  }
  if (!view || !tracked?.applied) return true;
  return view.state.sliceDoc(tracked.from, tracked.to) === tracked.applied.replacement;
}

function undo(view: EditorView | null, id: string) {
  const n = note(id);
  if (!n || n.status === "open") return;
  const tracked = view && n.range !== null ? item(view, id) : undefined;
  if (view && !tracked && n.applied) {
    // Section note with inserted text (the proposal's "Insert"): it is removed.
    const off = useDoc.getState().bodyOffset;
    const from = n.applied.from + off;
    const to = n.applied.to + off;
    if (view.state.sliceDoc(from, to) !== n.applied.replacement) return;
    view.dispatch({
      changes: { from, to, insert: n.applied.original },
      annotations: [deskAction.of(true), Transaction.userEvent.of("input.note")],
    });
    useJudgments.getState().patchNote(id, { status: "open" }, true);
    void api.patchJudgment(id, { status: "open" }).catch(() => {});
    return;
  }
  if (!view || !tracked) return persistDirect(id, "open");

  if (tracked.status === "applied" && tracked.applied) {
    if (!canUndo(view, id)) return;
    const { original, replacement } = tracked.applied;
    const first = view.state.changes({ from: tracked.from, to: tracked.to, insert: original });
    view.dispatch({
      // For footnotes the definition at the end of the file goes too.
      changes: withOrphanRemoved(view, first, replacement),
      effects: updateJudgment.of({
        id,
        status: "open",
        from: tracked.from,
        to: tracked.from + original.length,
        applied: null,
      }),
      annotations: [deskAction.of(true), Transaction.userEvent.of("input.note")],
    });
    return;
  }
  view.dispatch({ effects: updateJudgment.of({ id, status: "open" }) });
}

/** The grammar corrections "Accept all" would apply: open, on the text, with the correction. */
export function acceptableGrammar(view: EditorView | null): TrackedJudgment[] {
  if (!view) return [];
  return view.state
    .field(judgmentsField)
    .items.filter((j) => j.kind === "grammar" && j.status === "open" && j.edit !== undefined)
    .sort((a, b) => a.from - b.from);
}

/**
 * "Accept all": all the open grammar corrections in a single change, so a single ⌘Z undoes them
 * all and the notes reopen. "Undo" on a single note still works. Two corrections on the same
 * stretch: the first wins, the other stays open.
 */
function applyAll(view: EditorView | null) {
  const items = acceptableGrammar(view);
  if (!view || items.length === 0) return;
  const doc = view.state.doc;
  const specs: { id: string; from: number; to: number; insert: string }[] = [];
  let last = -1;
  for (const j of items) {
    if (j.from < last) continue;
    let to = j.to;
    const insert = j.edit!;
    if (
      insert === "" &&
      doc.sliceString(j.from - 1, j.from) === " " &&
      doc.sliceString(to, to + 1) === " "
    )
      to += 1;
    specs.push({ id: j.id, from: j.from, to, insert });
    last = to;
  }
  const changes = view.state.changes(specs.map(({ from, to, insert }) => ({ from, to, insert })));
  const next = changes.apply(doc);
  view.dispatch({
    changes,
    effects: specs.flatMap(({ id, from, to, insert }) => {
      const start = changes.mapPos(from, -1);
      const end = start + insert.length;
      const authored = insert ? [addAuthored.of({ from: start, to: end, source: "grammar" })] : [];
      return [
        ...authored,
        updateJudgment.of({
          id,
          status: "applied",
          from: start,
          to: end,
          applied: {
            from: start,
            to: end,
            original: doc.sliceString(from, to),
            replacement: insert,
            before: next.sliceString(Math.max(0, start - CONTEXT), start),
            after: next.sliceString(end, end + CONTEXT),
          },
        }),
      ];
    }),
    annotations: [deskAction.of(true), Transaction.userEvent.of("input.note")],
  });
}

export const noteActions = { apply, ignore, undo, applyAll };

/** The actions that open something below the note instead of changing the text at once. */
export const opensPanel = (j: Judgment) =>
  j.proposal.action === "add_source" || j.proposal.action === "compare_sources";

/** "Mark as opinion" (secondary action): for unsourced claims. */
export const canMarkOpinion = (j: Judgment) =>
  j.pass === "facts" &&
  j.range !== null &&
  j.proposal.action !== "mark_opinion" &&
  (j.factStatus === "unsourced" || j.proposal.action === "add_source");

/** Grammar or facts notes on a proper noun or an acronym: it can be added to the glossary. */
export function canAddToGlossary(j: Judgment): boolean {
  if (j.pass !== "grammar" && j.pass !== "facts") return false;
  const q = j.anchor.quote.trim();
  return q !== "" && q.length <= 40 && q.split(/\s+/).length <= 3 && /[A-Z0-9]/.test(q);
}

/** "Add to glossary": the entry goes into `glossary` in the front matter and the note is ignored. */
export async function addToGlossary(view: EditorView | null, j: Judgment) {
  const { path } = useDoc.getState();
  if (!path) return;
  const term = j.anchor.quote.trim();
  const current = (await api.getDraft(path)).frontmatter.glossary;
  const glossary = Array.isArray(current) ? (current as string[]) : [];
  if (!glossary.includes(term)) {
    const { session } = await import("./session.ts");
    if (!(await session.patchFrontMatter({ glossary: [...glossary, term] }))) return;
  }
  ignore(view, j.id);
}
