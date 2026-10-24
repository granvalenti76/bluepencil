import type { EditorView } from "@codemirror/view";
import { currentPass, REVIEW_ORDER } from "@desk/core";
import { api } from "./api.ts";
import { authorship, useAuthorship, writtenByYou } from "./authorship.ts";
import { useDoc, type SaveStatus } from "./docStore.ts";
import { ChevronDownIcon, EyeIcon, FolderIcon, MoreIcon, SparkIcon } from "./icons.tsx";
import { archetypeName, STAGE_LABEL } from "./labels.ts";
import { MenuButton, useMenu } from "./Menu.tsx";
import { useModel } from "./modelStore.ts";
import { hasCard } from "./notes.ts";
import { useDialog } from "./dialogs.ts";
import { passes, usePasses } from "./passes.ts";
import { fraction, progressText, review, STEP_LABEL, useReview } from "./review.ts";
import { useJudgments, useUi } from "./store.ts";

const SAVE_LABEL: Record<SaveStatus, string> = {
  saved: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving…",
  error: "Save failed, retrying",
  conflict: "Conflicts with the file on disk",
};

/**
 * Top bar: on the left the open draft, which opens the drafts list; in the centre Write / Review;
 * on the right how much of the text is yours, view, more actions and the review. Formatting is
 * in the bar below, in Write.
 */
export function Toolbar({ view }: { view: EditorView | null }) {
  return (
    <div className="toolbar" role="toolbar" aria-label="Tools">
      <div className="toolbar-side">
        <DocTitle />
      </div>
      <ModeSwitch />
      <div className="toolbar-side toolbar-end">
        <Authorship view={view} />
        <ViewMenu />
        <MoreMenu />
        <ReviewButton />
      </div>
    </div>
  );
}

/**
 * Write or Review. Review says how many notes are waiting (⌃⌘N switches between them).
 */
function ModeSwitch() {
  const mode = useUi((s) => s.mode);
  const setMode = useUi((s) => s.setMode);
  const path = useDoc((s) => s.path);
  const open = useJudgments((s) => s.notes.filter((n) => n.status === "open" && hasCard(n)).length);
  return (
    <div className="mode-switch" role="group" aria-label="Mode">
      <button
        className="mode-btn"
        aria-pressed={mode === "write"}
        data-tip="Write: formatting, outline, the sheet · ⌃⌘N"
        disabled={!path}
        onClick={() => setMode("write")}
      >
        Write
      </button>
      <button
        className="mode-btn"
        aria-pressed={mode === "review"}
        aria-label={`Review (${open} open)`}
        data-tip="Review: the sheet and the editor's notes · ⌃⌘N"
        disabled={!path}
        onClick={() => setMode("review")}
      >
        Review
        {open > 0 && <span className="badge">{open}</span>}
      </button>
    </div>
  );
}

/**
 * The draft's title, with the type of text, phase, a dot for the save state and how much of the
 * text is the author's.
 */
function DocTitle() {
  const { path, title, archetype, stage, status, loading } = useDoc();
  const draftsOpen = useUi((s) => s.draftsOpen);
  const setDrafts = useUi((s) => s.setDrafts);
  const drafts = (
    <button
      className="drafts-btn"
      aria-label="Drafts"
      aria-expanded={draftsOpen || (!path && !loading)}
      aria-keyshortcuts="Meta+O"
      data-tip="All drafts · ⌘O"
      onClick={() => setDrafts()}
    >
      <span className="doctitle-name">{path ? title || path : "Drafts"}</span>
      <ChevronDownIcon />
    </button>
  );
  if (!path) return <div className="doctitle">{drafts}</div>;
  return (
    <div className="doctitle">
      {drafts}
      <span className="doctitle-meta">
        <span className="doctitle-type">{archetypeName(archetype)}</span>
        <span className="stage-current" data-stage={stage}>
          {STAGE_LABEL[stage] ?? stage}
        </span>
        <span
          className="save-dot"
          data-status={status}
          role="status"
          aria-label={SAVE_LABEL[status]}
          data-tip={SAVE_LABEL[status]}
        />
      </span>
    </div>
  );
}

/**
 * "Written by you · 98%": the words that do not come from accepted suggestions. Rounded down, and
 * with "≥" if some accepted stretch cannot be found. A click shows the model's words in the text.
 */
function Authorship({ view }: { view: EditorView | null }) {
  const path = useDoc((s) => s.path);
  const total = useDoc((s) => s.counts.words);
  const preview = useUi((s) => s.preview);
  const { authoredWords, lost, show } = useAuthorship();
  const lostWords = lost.reduce((n, s) => n + s.words, 0);
  const share = writtenByYou(total, authoredWords, lostWords);
  const words = authoredWords + lostWords;
  if (!path) return null;
  return (
    <button
      className="authorship"
      aria-label={`Written by you: ${lost.length ? "at least " : ""}${share}%`}
      aria-pressed={show}
      disabled={preview}
      data-tip={
        words === 0
          ? "Every word is yours: no suggestion accepted so far"
          : `${words} words come from suggestions you accepted${lost.length ? ` (${lost.length} passages not found)` : ""} · click to ${show ? "hide" : "show"} them`
      }
      onClick={() => authorship.toggle(view)}
    >
      <span className="authorship-label">By you · </span>
      {lost.length ? "≥ " : ""}
      {share}%
    </button>
  );
}

/**
 * View: preview, focus, Hemingway; in Write the author's hand; typing sounds. Toggles, with their
 * state in `aria-pressed`.
 */
function ViewMenu() {
  const ui = useUi();
  const write = ui.mode === "write";
  const any = ui.preview || ui.focus || ui.hemingway || (write && ui.handwriting);
  const toggles: [string, string, boolean, () => void, string][] = [
    ["Preview", "The text as the reader sees it · ⇧⌘P", ui.preview, ui.togglePreview, "⇧⌘P"],
    ["Focus", "Dims the rest and keeps the line centered", ui.focus, () => ui.toggle("focus"), ""],
    ["Hemingway", "Forward only: no deleting", ui.hemingway, () => ui.toggle("hemingway"), ""],
    ...(write
      ? ([
          [
            "Handwriting",
            "Your text in your own hand, as you sign it",
            ui.handwriting,
            () => ui.togglePref("handwriting"),
            "",
          ],
        ] as [string, string, boolean, () => void, string][])
      : []),
    [
      "Typing sounds",
      "A soft key click as you type",
      ui.typingSounds,
      () => ui.togglePref("typingSounds"),
      "",
    ],
  ];
  return (
    <MenuButton
      icon={<EyeIcon />}
      label="View"
      tip="View: preview, focus, handwriting, sounds"
      active={any}
    >
      {() =>
        toggles.map(([label, tip, on, toggle, keys]) => (
          <button
            key={label}
            className="menu-item"
            aria-pressed={on}
            aria-label={label}
            data-tip={tip}
            onClick={toggle}
          >
            <span className="menu-check" aria-hidden>
              {on ? "✓" : ""}
            </span>
            {label}
            {keys && <kbd>{keys}</kbd>}
          </button>
        ))
      }
    </MenuButton>
  );
}

/** More actions on the draft: publish, show it in the Finder. */
function MoreMenu() {
  const path = useDoc((s) => s.path);
  const show = useDialog((s) => s.show);
  if (!path) return null;
  return (
    <MenuButton icon={<MoreIcon />} label="More" tip="Publish, show in Finder">
      {(close) => (
        <>
          <button
            className="menu-item"
            role="menuitem"
            onClick={() => {
              close();
              show("publish");
            }}
          >
            Publish…
          </button>
          <button
            className="menu-item"
            role="menuitem"
            onClick={() => {
              close();
              void api.reveal(path).catch(() => {});
            }}
          >
            <FolderIcon />
            Show in Finder
          </button>
        </>
      )}
    </MenuButton>
  );
}

/** The menu next to the button: all passes at once, or start again. */
const REVIEW_CHOICES: [string, string, () => Promise<void>, boolean][] = [
  ["Full review", "Every pass now, then go through them in order", () => passes.all(), false],
  ["Restart review", "Back to the structure pass; the notes stay", () => passes.restart(), true],
];

/** Who runs the analysis: the local model (or the cloud, if chosen), for the tooltip. */
function useModelLine(): string {
  const { status, cloud } = useModel();
  if (!status) return "";
  if (cloud) return ` · cloud (${status.cloud.model ?? "cloud"})`;
  return status.local.reachable
    ? ` · ${status.local.model ?? "local model"}`
    : " · model unreachable";
}

/**
 * "Start review" begins with structure; once the review has started it checks the pass to work
 * on again, once it is finished it starts over. While running it becomes "Cancel review", with
 * the progress. Next to it, the menu: all passes at once, or again from structure.
 */
function ReviewButton() {
  const { path, stage, loading } = useDoc();
  const { progress, runId } = useReview();
  const records = usePasses((s) => s.records);
  const active = records.length > 0;
  const current = currentPass(records);
  const { open, setOpen, box } = useMenu();
  const model = useModelLine();
  if (progress !== null) {
    const pct = Math.round(fraction(progress) * 100);
    return (
      <button
        className="review-btn review-running"
        style={{ "--progress": `${pct}%` } as React.CSSProperties}
        data-tip={`${progressText(progress)} · click to cancel`}
        aria-label={`Cancel review (${progressText(progress)})`}
        disabled={!runId}
        onClick={() => void review.cancel()}
      >
        <SparkIcon />
        Cancel review
      </button>
    );
  }
  const disabled = !path || loading || stage === "structure";
  return (
    <div className="review-split menu-anchor" ref={box}>
      <button
        className="review-btn"
        disabled={disabled}
        data-tip={
          !active
            ? `Pass by pass: ${REVIEW_ORDER.map((p) => STEP_LABEL[p].toLowerCase()).join(", ")}${model}`
            : current
              ? `Check the ${STEP_LABEL[current].toLowerCase()} pass again on the current text${model}`
              : `Start again from the structure pass${model}`
        }
        onClick={() => {
          // La revisione si guarda in Review.
          useUi.getState().setMode("review");
          void (!active ? passes.begin() : current ? passes.checkAgain() : passes.restart());
        }}
      >
        <SparkIcon />
        {!active ? "Start review" : current ? "Check again" : "Review again"}
      </button>
      <button
        className="review-btn review-more"
        aria-label="Choose what to review"
        aria-expanded={open}
        aria-haspopup="menu"
        data-tip="Every pass at once, or start again"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronDownIcon />
      </button>
      {open && (
        <div className="menu menu-wide" role="menu" aria-label="What to review">
          {REVIEW_CHOICES.filter(([, , , needsActive]) => active || !needsActive).map(
            ([label, hint, run]) => (
              <button
                key={label}
                className="menu-item menu-item-2"
                role="menuitem"
                aria-label={label}
                onClick={() => {
                  setOpen(false);
                  useUi.getState().setMode("review");
                  void run();
                }}
              >
                <span>{label}</span>
                <small>{hint}</small>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
