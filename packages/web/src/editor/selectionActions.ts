import { StateField, type EditorState, type Extension } from "@codemirror/state";
import { showTooltip, type EditorView, type Tooltip } from "@codemirror/view";
import { askOf, openAskBox, selectedText } from "./askBox.ts";

/** The selected passage: offset in the document (front matter included) and text. */
export interface SelectedText {
  from: number;
  to: number;
  text: string;
}

/**
 * Next to the selection, a small "Ask": opens the editor's box below the paragraph (askBox.ts),
 * where you ask to rephrase or to check. With `onStyle`, also "To a style": the passage becomes a
 * piece of a style.
 */
export function selectionActions({
  bodyOffset,
  onStyle,
}: {
  bodyOffset: number;
  onStyle?: (text: string) => void;
}): Extension {
  const tooltipOf = (state: EditorState): Tooltip | null => {
    const sel = selectedText(state, bodyOffset);
    if (!sel || askOf(state)) return null;
    return {
      pos: sel.to,
      above: false,
      create: (view) => {
        const dom = document.createElement("div");
        dom.className = "cm-sel-actions";
        // A click must take neither the selection nor focus away from the editor.
        dom.addEventListener("mousedown", (e) => e.preventDefault());
        const ask = document.createElement("button");
        ask.type = "button";
        ask.className = "cm-sel-ask";
        ask.textContent = "Ask";
        ask.setAttribute("aria-label", "Ask the editor about the selection");
        ask.dataset.tip = "Ask the editor: rephrase or check the selected passage";
        ask.addEventListener("click", () => openAskBox(view, bodyOffset));
        dom.append(ask);
        if (onStyle) {
          const style = document.createElement("button");
          style.type = "button";
          style.className = "cm-sel-ask cm-sel-style";
          style.textContent = "To a style";
          style.setAttribute("aria-label", "Add the selection to a style");
          style.dataset.tip = "Keep this passage as a piece of a style";
          style.addEventListener("click", () => {
            const now = selectedText(view.state, bodyOffset);
            if (now) onStyle(now.text);
          });
          dom.append(style);
        }
        return { dom };
      },
    };
  };
  return StateField.define<Tooltip | null>({
    create: tooltipOf,
    update: (tip, tr) =>
      tr.docChanged || tr.selection || tr.effects.length ? tooltipOf(tr.state) : tip,
    provide: (f) => showTooltip.from(f),
  });
}

/** "Ask the editor" from the bar: the box on the selection. */
export function openSelectionMenu(view: EditorView, bodyOffset = 0): boolean {
  return openAskBox(view, bodyOffset);
}
