import type { EditorView } from "@codemirror/view";
import { REWRITE_STYLE_LABEL } from "@desk/core";
import {
  applyRewrite,
  closeRewrite,
  rewriteStatusText,
  undoRewrite,
  useRewrite,
} from "./rewrite.ts";

/**
 * The "Rephrase" proposals (in the "Ask the editor" box): the original passage and one to three
 * alternatives. "Use this" changes the text (undoable); "Close" discards everything.
 */
export function RewriteCard({ view, onClose }: { view: EditorView | null; onClose?: () => void }) {
  const r = useRewrite((s) => s.current);
  if (!r) return null;
  return (
    <div className="rewrite" data-status={r.status} aria-label="Rephrasing">
      <div className="rewrite-head">
        <span className="note-chip" data-type="prose">
          Rephrase
        </span>
        <span className="rewrite-style">{REWRITE_STYLE_LABEL[r.style]}</span>
        <button
          className="note-link"
          onClick={() => {
            closeRewrite();
            onClose?.();
          }}
        >
          Close
        </button>
      </div>
      <blockquote className="rewrite-original">{r.original}</blockquote>
      {r.status === "loading" && <p className="rewrite-status">{rewriteStatusText(r)}</p>}
      {r.status === "error" && <p className="rewrite-status rewrite-error">{r.error}</p>}
      {r.status === "applied" && (
        <div className="rewrite-done">
          <span>Rephrasing applied</span>
          <button className="note-undo" onClick={() => undoRewrite(view)}>
            Undo
          </button>
        </div>
      )}
      {r.status === "ready" &&
        r.alternatives?.map((alt, i) => (
          <div className="rewrite-alt" key={i}>
            <p className="rewrite-text">{alt}</p>
            <button className="note-primary" onClick={() => applyRewrite(view, alt)}>
              Use this
            </button>
          </div>
        ))}
    </div>
  );
}
