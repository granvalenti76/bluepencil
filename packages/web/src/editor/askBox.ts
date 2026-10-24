import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

/**
 * "Ask the editor": a box below the selection's paragraph, in the card's style. The editor keeps
 * the space (a block after the line) and hands it to the app, which draws the questions and
 * answers inside it.
 */

export interface Ask {
  /** The selected passage (document offsets) and its text. */
  from: number;
  to: number;
  text: string;
}

export const openAsk = StateEffect.define<Ask>();
export const closeAsk = StateEffect.define<null>();

const askField = StateField.define<Ask | null>({
  create: () => null,
  update(value, tr) {
    if (value && tr.docChanged)
      value = {
        ...value,
        from: tr.changes.mapPos(value.from, 1),
        to: tr.changes.mapPos(value.to, -1),
      };
    for (const e of tr.effects) {
      if (e.is(openAsk)) value = e.value;
      if (e.is(closeAsk)) value = null;
    }
    return value;
  },
});

export const askOf = (state: EditorState) => state.field(askField, false) ?? null;

/** The selection without the spaces at its edges, body only: what is asked of the editor. */
export function selectedText(state: EditorState, bodyOffset: number): Ask | null {
  const r = state.selection.main;
  if (r.empty) return null;
  let from = Math.max(r.from, bodyOffset);
  let to = r.to;
  const raw = state.sliceDoc(from, to);
  from += raw.length - raw.trimStart().length;
  to -= raw.length - raw.trimEnd().length;
  if (to - from < 2) return null;
  return { from, to, text: state.sliceDoc(from, to) };
}

/** Opens the box on the selection; without a selection it does nothing. */
export function openAskBox(view: EditorView, bodyOffset: number): boolean {
  const ask = selectedText(view.state, bodyOffset);
  if (!ask) return false;
  view.dispatch({ effects: openAsk.of(ask) });
  return true;
}

class AskHost extends WidgetType {
  readonly onHost: (el: HTMLElement | null) => void;
  constructor(onHost: (el: HTMLElement | null) => void) {
    super();
    this.onHost = onHost;
  }
  override eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-ask-host";
    // The box is not part of the draft's text.
    el.contentEditable = "false";
    queueMicrotask(() => this.onHost(el));
    return el;
  }
  override destroy() {
    this.onHost(null);
  }
  override ignoreEvent() {
    return true;
  }
}

/** `onHost` receives the element to draw the box in (or `null` when it goes away). */
export function askBox(onHost: (el: HTMLElement | null) => void): Extension {
  const host = new AskHost(onHost);
  const decorations = EditorView.decorations.compute([askField], (state): DecorationSet => {
    const ask = askOf(state);
    if (!ask) return Decoration.none;
    const at = state.doc.lineAt(ask.to).to;
    return Decoration.set([Decoration.widget({ widget: host, block: true, side: 1 }).range(at)]);
  });
  return [askField, decorations];
}
