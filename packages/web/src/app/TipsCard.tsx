import { useEffect } from "react";
import { useAsk } from "./AskBox.tsx";
import { useDoc } from "./docStore.ts";
import { useUi } from "./store.ts";
import { SAMPLE_PATHS, useTips } from "./tips.ts";

/**
 * The "Three things to try" card, held with a strip of paper tape next to the sample draft's
 * page. The boxes tick themselves.
 */
export function TipsCard() {
  const path = useDoc((s) => s.path);
  const tips = useTips();
  const sample = path !== null && SAMPLE_PATHS.includes(path);

  useEffect(() => {
    if (!sample) return;
    const marks = [
      // Something written: the text changes (and so does the save state).
      useDoc.subscribe((s, prev) => {
        if (s.bodyHash && prev.bodyHash && s.bodyHash !== prev.bodyHash)
          useTips.getState().mark({ wrote: true });
      }),
      useAsk.subscribe((s) => s.ask && useTips.getState().mark({ asked: true })),
      useUi.subscribe((s) => s.mode === "review" && useTips.getState().mark({ reviewed: true })),
    ];
    return () => marks.forEach((u) => u());
  }, [sample]);

  if (!sample || tips.hidden) return null;
  const item = (done: boolean, text: React.ReactNode) => (
    <li className="tips-item" data-done={done}>
      {/* Ticks itself when the author has done it: a click does not change it. */}
      <label>
        <input type="checkbox" checked={done} aria-readonly onChange={() => {}} tabIndex={-1} />
        <span>{text}</span>
      </label>
    </li>
  );
  return (
    <aside className="tips-card" aria-label="Tips">
      <span className="tips-tape" aria-hidden />
      <p className="tips-title">Three things to try</p>
      <ul className="tips-list" aria-label="Three things to try">
        {item(tips.wrote, "Write a sentence anywhere.")}
        {item(
          tips.asked,
          <>
            Select a sentence, then press <strong>Ask the editor</strong>.
          </>,
        )}
        {item(
          tips.reviewed,
          <>
            When it feels ready, switch to <strong>Review</strong> at the top.
          </>,
        )}
      </ul>
      <p className="tips-note">
        This sample is <code>{path}</code> in your folder. Delete it whenever you like.
      </p>
      <button type="button" className="tips-hide" onClick={() => tips.mark({ hidden: true })}>
        Hide tips
      </button>
    </aside>
  );
}
