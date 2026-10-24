import type { EditorView } from "@codemirror/view";
import { toggleShowMarkdown } from "../editor/livePreview.ts";
import { useUi } from "./store.ts";
import { useDoc } from "./docStore.ts";
import { useModel } from "./modelStore.ts";
import { progressText, useReview } from "./review.ts";

/**
 * Status bar cut down to the essentials: how the review went and which model is working. Words
 * and reading time are in the right-hand panel; saving next to the title.
 */
export function StatusBar({ view }: { view: EditorView | null }) {
  const path = useDoc((s) => s.path);
  if (!path) return <div className="statusbar" />;
  return (
    <div className="statusbar" role="status">
      <span className="statusbar-side">
        <ReviewState />
      </span>
      <ShowMarkdown view={view} />
      <span className="statusbar-side statusbar-end">
        <ModelIndicator />
      </span>
    </div>
  );
}

/** "Show Markdown" (⌥⌘M): the Markdown under the text, for those who want to see it. */
function ShowMarkdown({ view }: { view: EditorView | null }) {
  const shown = useUi((s) => s.markdownShown);
  if (!view) return <span />;
  return (
    <button
      type="button"
      className="show-md"
      aria-pressed={shown}
      aria-keyshortcuts="Alt+Meta+M"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        toggleShowMarkdown(view);
        view.focus();
      }}
    >
      Show Markdown <kbd>⌥⌘M</kbd>
    </button>
  );
}

/** "<model> · local|cloud", or "model unreachable". */
function ModelIndicator() {
  const { status, cloud } = useModel();
  if (!status) return <span className="model-state">model…</span>;
  const name = cloud ? (status.cloud.model ?? "cloud") : status.local.model;
  const unreachable = !cloud && !status.local.reachable;
  const mode = cloud ? "cloud" : "local";
  return (
    <>
      {unreachable ? (
        <span className="model-state" data-state="unreachable" data-tip={status.local.error}>
          model unreachable
        </span>
      ) : (
        <span className="model-state">{name ?? "model"}</span>
      )}
      {" · "}
      {/* The cloud is switched on from Settings; here you always see where the text goes. */}
      <span
        className="model-mode"
        data-cloud={cloud}
        data-tip={cloud ? "Text goes to the cloud: turn it off in Settings" : undefined}
      >
        {mode}
      </span>
    </>
  );
}

/** Review status: progress, the error that stopped it, outcome of the last one. */
function ReviewState() {
  const { progress, fatal, skipped, last } = useReview();
  if (progress) {
    return (
      <span className="review-state" data-state="running">
        {progressText(progress)}
      </span>
    );
  }
  if (fatal) {
    return (
      <span className="review-state" data-state="error" data-tip={fatal}>
        Review stopped: {fatal}
      </span>
    );
  }
  if (!last) return null;
  const secs = Math.max(1, Math.round(last.elapsedMs / 1000));
  return (
    <span className="review-state" data-state={skipped ? "warn" : "done"}>
      {last.cancelled ? "Review cancelled" : `Review finished in ${secs} s`}
      {skipped ? ` · ${skipped} ${skipped === 1 ? "check failed" : "checks failed"}` : ""}
    </span>
  );
}
