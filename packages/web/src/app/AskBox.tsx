import { createPortal } from "react-dom";
import { create } from "zustand";
import type { EditorView } from "@codemirror/view";
import { REWRITE_STYLE_LABEL, REWRITE_STYLES, type Pass, type RewriteStyle } from "@desk/core";
import { closeAsk, type Ask } from "../editor/askBox.ts";
import { review, useReview } from "./review.ts";
import { requestRewrite, useRewrite } from "./rewrite.ts";
import { RewriteCard } from "./RewriteCard.tsx";
import { useUi } from "./store.ts";

/** Where to draw the box (the editor provides it) and on which passage. */
export const useAsk = create<{ host: HTMLElement | null; ask: Ask | null }>()(() => ({
  host: null,
  ask: null,
}));

const STYLE_TIP: Record<RewriteStyle, string> = {
  concise: "Same content, fewer words",
  clear: "Simpler syntax, one idea per sentence",
  fluent: "Rhythm and links between sentences",
  creative: "Fresher images and words",
};

const CHECKS: [string, Pass[], string][] = [
  ["Check facts", ["facts"], "Check the passage’s numbers, names and dates against the sources"],
  ["Check grammar", ["grammar"], "The passage’s mistakes, one by one"],
  ["Judge the prose", ["prose"], "Flow, word choice and line of reasoning in the passage"],
];

/**
 * "Ask the editor": below the paragraph, in the card's style, the questions about the selected
 * passage (rephrase, check) and the editor's proposals. The text changes only with "Use this".
 */
export function AskBox({ view }: { view: EditorView | null }) {
  const host = useAsk((s) => s.host);
  const ask = useAsk((s) => s.ask);
  if (!host || !ask || !view) return null;
  return createPortal(<AskCard view={view} ask={ask} />, host);
}

function AskCard({ view, ask }: { view: EditorView; ask: Ask }) {
  const rewrite = useRewrite((s) => s.current);
  const busy = useReview((s) => s.progress !== null);
  const close = () => {
    view.dispatch({ effects: closeAsk.of(null) });
    view.focus();
  };
  return (
    <section
      className="ask-card"
      aria-label="Ask the editor"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          close();
        }
      }}
    >
      <div className="ask-head">
        <span className="ask-title">Ask the editor</span>
        <button className="ask-close" aria-label="Close" onClick={close}>
          ×
        </button>
      </div>
      {!rewrite && (
        <>
          <q className="ask-quote">{ask.text}</q>
          <div className="ask-group" role="group" aria-label="Rephrase">
            <span className="ask-label">Rephrase</span>
            {REWRITE_STYLES.map((style) => (
              <button
                key={style}
                className="ask-btn"
                data-tip={STYLE_TIP[style]}
                onClick={() => void requestRewrite(ask, style)}
              >
                {REWRITE_STYLE_LABEL[style]}
              </button>
            ))}
          </div>
          <div className="ask-group" role="group" aria-label="Check">
            <span className="ask-label">Check</span>
            {CHECKS.map(([label, types, tip]) => (
              <button
                key={label}
                className="ask-btn"
                data-tip={tip}
                disabled={busy}
                onClick={() => {
                  close();
                  // The check's notes arrive on the card, in Review.
                  useUi.getState().setMode("review");
                  void review.start({ types, selection: ask });
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
      <RewriteCard view={view} onClose={close} />
    </section>
  );
}
