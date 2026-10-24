import { create } from "zustand";
import { Transaction, type StateEffect } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import type { RewriteStyle } from "@desk/core";
import { addAuthored } from "../editor/authorship.ts";
import { deskAction } from "../editor/deskAction.ts";
import type { SelectedText } from "../editor/selectionActions.ts";
import { ApiError, postEvents } from "./api.ts";
import { useDoc } from "./docStore.ts";
import { useModel } from "./modelStore.ts";
import { session } from "./session.ts";

export interface Rewrite {
  style: RewriteStyle;
  /** Where the passage was in the document when it was asked (document offset). */
  from: number;
  original: string;
  status: "loading" | "ready" | "applied" | "error";
  phase?: string;
  reasoningTokens?: number;
  alternatives?: string[];
  error?: string;
  /** After "Use this": where the new text is, for "Undo". */
  applied?: { from: number; replacement: string };
}

interface RewriteState {
  current: Rewrite | null;
  set: (r: Rewrite | null) => void;
  patch: (p: Partial<Rewrite>) => void;
}

/** One rephrasing at a time: the proposal lives in the right-hand panel until it is closed. */
export const useRewrite = create<RewriteState>()((set) => ({
  current: null,
  set: (current) => set({ current }),
  patch: (p) => set((s) => (s.current ? { current: { ...s.current, ...p } } : s)),
}));

let controller: AbortController | null = null;

/**
 * "Rephrase" on the selection: asks the model for one to three proposals. The text does not
 * change until the author chooses "Use this" (undoable with Cmd+Z or "Undo").
 */
export async function requestRewrite(sel: SelectedText, style: RewriteStyle) {
  const { path, bodyOffset } = useDoc.getState();
  if (!path) return;
  controller?.abort();
  const mine = new AbortController();
  controller = mine;
  const r = useRewrite.getState();
  r.set({ style, from: sel.from, original: sel.text, status: "loading" });
  // The server looks for the passage in the file: save what is in the editor first.
  await session.saveNow();
  let done = false;
  try {
    await postEvents(
      "/api/proposals/rewrite",
      {
        path,
        from: sel.from - bodyOffset,
        to: sel.to - bodyOffset,
        text: sel.text,
        style,
        cloud: useModel.getState().cloud,
      },
      (event, data) => {
        if (controller !== mine) return;
        const d = data as {
          phase?: string;
          reasoningTokens?: number;
          alternatives?: string[];
          message?: string;
        };
        if (event === "progress") {
          r.patch({ phase: d.phase, reasoningTokens: d.reasoningTokens });
        } else if (event === "done") {
          done = true;
          r.patch({ status: "ready", alternatives: d.alternatives });
        } else if (event === "error") {
          done = true;
          r.patch({ status: "error", error: d.message });
        }
      },
      mine.signal,
    );
    if (!done && !mine.signal.aborted) r.patch({ status: "error", error: "Incomplete response" });
  } catch (e) {
    if (mine.signal.aborted) return;
    const message =
      e instanceof ApiError && e.status === 409
        ? "The selected text has changed: select it again."
        : "Couldn’t reach the server";
    r.patch({ status: "error", error: message });
  } finally {
    if (controller === mine) controller = null;
  }
}

/** Where `text` is now: at the expected position or, if the author has written, the nearest one. */
function locate(view: EditorView, text: string, near: number): number | null {
  const doc = view.state.doc.toString();
  if (doc.slice(near, near + text.length) === text) return near;
  let best: number | null = null;
  for (let i = doc.indexOf(text); i !== -1; i = doc.indexOf(text, i + 1)) {
    if (best === null || Math.abs(i - near) < Math.abs(best - near)) best = i;
  }
  return best;
}

function replace(
  view: EditorView,
  from: number,
  to: number,
  insert: string,
  effects: StateEffect<unknown>[] = [],
) {
  view.dispatch({
    changes: { from, to, insert },
    effects,
    selection: { anchor: from + insert.length },
    annotations: [deskAction.of(true), Transaction.userEvent.of("input.note")],
    scrollIntoView: true,
  });
  // Focus goes back to the text: Cmd+Z must undo at once, as after any change.
  view.focus();
}

/** "Use this": the passage becomes the chosen proposal, by an action of the author. */
export function applyRewrite(view: EditorView | null, replacement: string) {
  const cur = useRewrite.getState().current;
  if (!view || !cur) return;
  const at = locate(view, cur.original, cur.from);
  if (at === null) {
    useRewrite.getState().patch({
      status: "error",
      error: "The selected text is gone: the suggestion can’t be applied.",
    });
    return;
  }
  // The chosen rephrasing: model text, counts towards authorship.
  replace(view, at, at + cur.original.length, replacement, [
    addAuthored.of({ from: at, to: at + replacement.length, source: "rewrite" }),
  ]);
  useRewrite.getState().patch({ status: "applied", applied: { from: at, replacement } });
}

/** "Undo": puts the original passage back (Cmd+Z does too). */
export function undoRewrite(view: EditorView | null) {
  const cur = useRewrite.getState().current;
  if (!view || !cur?.applied) return;
  const at = locate(view, cur.applied.replacement, cur.applied.from);
  if (at === null) return;
  replace(view, at, at + cur.applied.replacement.length, cur.original);
  useRewrite.getState().patch({ status: "ready", applied: undefined, from: at });
}

/**
 * The card follows the text: if the applied rephrasing is no longer there (Cmd+Z, or the author
 * changed it), it goes back to the proposals; otherwise its position follows the changes.
 */
export function syncRewrite(u: ViewUpdate) {
  const cur = useRewrite.getState().current;
  if (!u.docChanged || !cur) return;
  if (!cur.applied) {
    useRewrite.getState().patch({ from: u.changes.mapPos(cur.from, -1) });
    return;
  }
  const from = u.changes.mapPos(cur.applied.from, -1);
  const { replacement } = cur.applied;
  if (u.state.sliceDoc(from, from + replacement.length) === replacement) {
    if (from !== cur.applied.from) useRewrite.getState().patch({ applied: { from, replacement } });
  } else {
    useRewrite.getState().patch({ status: "ready", applied: undefined, from });
  }
}

export function closeRewrite() {
  controller?.abort();
  controller = null;
  useRewrite.getState().set(null);
}

export function rewriteStatusText(r: Rewrite): string {
  if (r.phase === "queued") return "Queued…";
  if (r.phase === "busy") return "The server is busy with another app, waiting…";
  if (r.phase === "writing") return "Writing suggestions…";
  return `The model is thinking…${r.reasoningTokens ? ` (${r.reasoningTokens} tokens)` : ""}`;
}
