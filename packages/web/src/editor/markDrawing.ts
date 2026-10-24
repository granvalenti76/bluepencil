import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { DRAW_TIME, endDrawing, judgmentsField } from "./judgmentsField.ts";

/**
 * The marks of newly arrived notes are drawn left to right (the animation is in design.css,
 * `.cm-j-draw`). Once the stroke is done the class is removed: CodeMirror redraws a line at every
 * keystroke, and with the class still there the mark would be drawn again.
 */
export const markDrawing = ViewPlugin.fromClass(
  class {
    private timer = 0;
    readonly view: EditorView;
    constructor(view: EditorView) {
      this.view = view;
    }
    update(u: ViewUpdate) {
      const drawing = u.state.field(judgmentsField).drawing;
      if (drawing.size === 0 || drawing === u.startState.field(judgmentsField).drawing) return;
      clearTimeout(this.timer);
      this.timer = window.setTimeout(
        () => this.view.dispatch({ effects: endDrawing.of(null) }),
        DRAW_TIME,
      );
    }
    destroy() {
      clearTimeout(this.timer);
    }
  },
);
