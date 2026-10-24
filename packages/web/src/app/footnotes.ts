import { isolateHistory } from "@codemirror/commands";
import { ChangeSet, Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { footnoteEdit, orphanDefinition, type Judgment } from "@desk/core";
import { deskAction } from "../editor/deskAction.ts";
import { judgmentsField, updateJudgment } from "../editor/judgmentsField.ts";
import { api } from "./api.ts";
import { isOpinionNote, packFor } from "./languages.ts";
import { useDoc } from "./docStore.ts";

const CONTEXT = 32;
const FOOTNOTE_REF = /\[\^([^\]\s]+)\]$/;

/**
 * "Add source" and "Mark as opinion": `[^n]` right after the quote and `[^n]: <note>` at the end
 * of the file, in a single undoable change (Cmd+Z and "Undo").
 */
export function linkFootnote(view: EditorView, id: string, note: string): boolean {
  const tracked = view.state.field(judgmentsField).items.find((j) => j.id === id);
  if (!tracked || tracked.status !== "open") return false;
  const off = useDoc.getState().bodyOffset;
  const doc = view.state.doc;
  const edit = footnoteEdit(doc.sliceString(off), tracked.to - off, note);
  const changes = view.state.changes([
    { from: tracked.to, insert: edit.ref.insert },
    { from: edit.def.from + off, to: edit.def.to + off, insert: edit.def.insert },
  ]);
  const next = changes.apply(doc);
  const end = tracked.to + edit.ref.insert.length;
  view.dispatch({
    changes,
    effects: updateJudgment.of({
      id,
      status: "applied",
      from: tracked.from,
      to: end,
      applied: {
        from: tracked.from,
        to: end,
        original: doc.sliceString(tracked.from, tracked.to),
        replacement: next.sliceString(tracked.from, end),
        before: next.sliceString(Math.max(0, tracked.from - CONTEXT), tracked.from),
        after: next.sliceString(end, end + CONTEXT),
      },
    }),
    annotations: [deskAction.of(true), Transaction.userEvent.of("input.note")],
    scrollIntoView: false,
  });
  return true;
}

/**
 * Links a source. If it is not yet among the front matter's `sources`, adds it (the front matter
 * is saved separately: "Undo" removes the footnote, not the list item).
 */
export async function addSource(view: EditorView, j: Judgment, ref: string): Promise<boolean> {
  const clean = ref.trim();
  if (!clean || !linkFootnote(view, j.id, clean)) return false;
  const { path } = useDoc.getState();
  if (!path) return true;
  const current = (await api.getDraft(path)).frontmatter.sources;
  const sources = Array.isArray(current) ? (current as string[]) : [];
  if (!sources.includes(clean)) {
    const { session } = await import("./session.ts");
    await session.patchFrontMatter({ sources: [...sources, clean] });
  }
  return true;
}

/**
 * "Cite" from the bar: `[^n]` at the end of the selection (or at the cursor) and `[^n]: <note>`
 * at the end of the file, in a single change (⌘Z removes it in one step). A new source (file or
 * address) also goes into the front matter's `sources`, like "Add source".
 */
export async function cite(
  view: EditorView,
  note: string,
  kind: "file" | "url" | "estimate",
): Promise<boolean> {
  const clean = note.replace(/\s+/g, " ").trim();
  if (!clean) return false;
  const off = useDoc.getState().bodyOffset;
  const { state } = view;
  const at = Math.max(state.selection.main.to, off);
  const edit = footnoteEdit(state.doc.sliceString(off), at - off, clean);
  view.dispatch({
    changes: [
      { from: at, insert: edit.ref.insert },
      { from: edit.def.from + off, to: edit.def.to + off, insert: edit.def.insert },
    ],
    selection: { anchor: at + edit.ref.insert.length },
    annotations: [Transaction.userEvent.of("input.cite"), isolateHistory.of("full")],
    scrollIntoView: true,
  });
  view.focus();
  const { path } = useDoc.getState();
  if (kind === "estimate" || !path) return true;
  const current = (await api.getDraft(path)).frontmatter.sources;
  const sources = Array.isArray(current) ? (current as string[]) : [];
  if (!sources.includes(clean)) {
    const { session } = await import("./session.ts");
    await session.patchFrontMatter({ sources: [...sources, clean] });
  }
  return true;
}

/** The footnote is in the draft's language. */
export const markOpinion = (view: EditorView, j: Judgment) =>
  linkFootnote(view, j.id, packFor(useDoc.getState().lang.code).opinionNote);

/** The footnote added by an action on the sources, if any: id and text of the definition. */
export function footnoteOf(
  view: EditorView | null,
  replacement: string | undefined,
): { id: string; text: string } | null {
  const id = replacement ? FOOTNOTE_REF.exec(replacement)?.[1] : undefined;
  if (!id || !view) return null;
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const def = new RegExp(`^\\[\\^${esc}\\]:[ \\t]*(.*)$`, "m").exec(view.state.doc.toString());
  return { id, text: def?.[1]?.trim() ?? "" };
}

/** Text of the collapsed note after an action on the sources. */
export function footnoteDoneLabel(view: EditorView | null, j: Judgment): string | null {
  const replacement = view?.state.field(judgmentsField).items.find((t) => t.id === j.id)
    ?.applied?.replacement;
  const fn = footnoteOf(view, replacement ?? j.applied?.replacement);
  if (!fn) return null;
  if (isOpinionNote(fn.text)) return "Marked as the author’s opinion";
  return fn.text ? `Source added: ${fn.text}` : "Source added";
}

/**
 * For "Undo" of an action on the sources: after removing `[^n]` (change `first`), also removes the
 * definition left without references. Returns the two changes composed.
 */
export function withOrphanRemoved(
  view: EditorView,
  first: ChangeSet,
  replacement: string,
): ChangeSet {
  const id = FOOTNOTE_REF.exec(replacement)?.[1];
  if (!id) return first;
  const off = useDoc.getState().bodyOffset;
  const next = first.apply(view.state.doc);
  const r = orphanDefinition(next.sliceString(off), id);
  if (!r) return first;
  return first.compose(
    ChangeSet.of({ from: r.from + off, to: r.to + off, insert: r.insert }, next.length),
  );
}
