import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

// Typewriter: the cursor's line stays in the middle of the view. Active together with Focus
// (Editor.tsx).

const EXTRA_LINES = 4;

/** Every selection or text change carries the scroll to the centre with it. */
const centerOnChange = EditorState.transactionExtender.of((tr) =>
  tr.selection || tr.docChanged
    ? { effects: EditorView.scrollIntoView(tr.newSelection.main.head, { y: "center" }) }
    : null,
);

/**
 * Half a view of space above and below the text, so the first and last lines can also sit in the
 * middle. Recomputed when the scroller's height changes. A few extra lines below: when adding a
 * line at the end of the document, the scroll starts before the browser has lengthened the page
 * and would be stopped at the old bottom.
 */
const centerPadding = ViewPlugin.fromClass(
  class {
    private half = -1;
    private readonly view: EditorView;

    constructor(view: EditorView) {
      this.view = view;
      this.resize.observe(view.scrollDOM);
    }

    private frame = 0;

    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet) {
        cancelAnimationFrame(this.frame);
        this.frame = requestAnimationFrame(() => this.center());
      }
    }

    /**
     * Back to the centre on the next frame, with the lines already laid out. When adding a line,
     * the scroll requested with the transaction is computed before the new line has its height
     * and moves nothing; corrected inside the measure cycle, CodeMirror's scroll anchoring
     * cancels it.
     */
    center() {
      if (this.half < 0 || !this.view.dom.isConnected) return;
      // A font still loading will change the line breaks: re-centre when it has finished.
      if (document.fonts.status === "loading") void document.fonts.ready.then(() => this.center());
      this.view.dispatch({
        effects: EditorView.scrollIntoView(this.view.state.selection.main.head, { y: "center" }),
      });
    }

    // Only when the scroller's height changes: a measure request at every geometry change
    // (e.g. a new line) would defer CodeMirror's scroll.
    private readonly resize = new ResizeObserver(() => this.measure());

    measure() {
      this.view.requestMeasure({
        key: "typewriter-padding",
        read: (v) => ({
          half: Math.round(v.scrollDOM.clientHeight / 2),
          extra: Math.round(v.defaultLineHeight * EXTRA_LINES),
        }),
        write: ({ half, extra }, v) => {
          if (half === this.half) return;
          const first = this.half < 0;
          this.half = half;
          v.contentDOM.style.paddingTop = `${half}px`;
          v.contentDOM.style.paddingBottom = `${half + extra}px`;
          // When switched on the cursor is centred, as soon as there is room to do so.
          if (first) this.frame = requestAnimationFrame(() => this.center());
        },
      });
    }

    destroy() {
      cancelAnimationFrame(this.frame);
      this.resize.disconnect();
      this.half = -1;
      this.view.contentDOM.style.paddingTop = "";
      this.view.contentDOM.style.paddingBottom = "";
    }
  },
);

export function typewriter(enabled: boolean): Extension {
  return enabled ? [centerOnChange, centerPadding] : [];
}
