import { useEffect } from "react";
import type { EditorView } from "@codemirror/view";
import {
  changedSince,
  currentPass,
  passStatus,
  REVIEW_ORDER,
  STEP_SCORE,
  type Pass,
} from "@desk/core";
import { useDoc } from "./docStore.ts";
import { habitLabel, loadHabits, useHabits } from "./habits.ts";
import { HandText } from "./HandText.tsx";
import { useLetters } from "./letters.ts";
import { SignOff } from "./SignOff.tsx";
import { hasCard, noteActions } from "./notes.ts";
import { isActive, nextPass, passes, shownPass, usePasses } from "./passes.ts";
import { STEP_LABEL, useReview } from "./review.ts";
import { useScores } from "./scores.ts";
import { useJudgments } from "./store.ts";

const PASS_TIP: Record<Pass, string> = {
  structure: "Structure: does the piece have the shape of its type?",
  facts: "Facts: every claim against your sources",
  prose: "Prose: rhythm, repetition, words that don’t earn their place",
  grammar: "Grammar: spelling, agreement, punctuation. Last, so nothing is checked twice",
};

/** Open notes per pass (verified facts have no note). */
function useOpenCounts(): Record<Pass, number> {
  const notes = useJudgments((s) => s.notes);
  const counts: Record<Pass, number> = { structure: 0, facts: 0, prose: 0, grammar: 0 };
  for (const n of notes) if (n.status === "open" && hasCard(n)) counts[n.pass]++;
  return counts;
}

/** The pass that is running, if the current review is on the whole text. */
function useRunning(): Pass | null {
  const progress = useReview((s) => s.progress);
  return progress && !progress.selection ? progress.step : null;
}

/**
 * The card's tabs: one pass per tab, with a pencil tick on the closed ones, and the sign-off at
 * the end. A click shows a pass already computed.
 */
export function PassTabs() {
  const state = usePasses();
  const words = useDoc((s) => s.counts.words);
  const counts = useOpenCounts();
  const running = useRunning();
  const current = currentPass(state.records);
  const shown = shownPass(state);
  return (
    <div className="pass-tabs" role="tablist" aria-label="Review passes">
      {REVIEW_ORDER.map((p) => {
        const status = passStatus(p, state.records);
        const record = state.records.find((r) => r.pass === p);
        const changed = record ? changedSince(record, words) : false;
        const info =
          running === p
            ? "checking…"
            : status === "done"
              ? changed
                ? "text changed"
                : "done"
              : status === "skipped"
                ? "skipped"
                : status === "open"
                  ? `${counts[p]} open`
                  : p === current
                    ? "to check"
                    : "waiting";
        return (
          <button
            key={p}
            id={`pass-tab-${p}`}
            role="tab"
            className="pass-tab"
            data-status={running === p ? "running" : status}
            data-changed={changed || undefined}
            aria-current={p === current ? "step" : undefined}
            aria-selected={p === shown}
            aria-controls="editor-card"
            aria-label={`${STEP_LABEL[p]}: ${info}`}
            data-tip={
              changed
                ? `${PASS_TIP[p]} · the text changed a lot since: reopen to check it again`
                : PASS_TIP[p]
            }
            disabled={status === "waiting" && p !== current}
            onClick={() => passes.view(p)}
          >
            {STEP_LABEL[p]}
            {p === shown && status === "open" && counts[p] > 0 && ` · ${counts[p]}`}
            {status === "done" && running !== p && (
              <span className="pass-tick" aria-hidden>
                ✓
              </span>
            )}
          </button>
        );
      })}
      <button
        id="pass-tab-signoff"
        role="tab"
        className="pass-tab"
        aria-selected={shown === null}
        aria-controls="editor-card"
        aria-label={current === null ? "Sign-off: ready" : "Sign-off: after the passes"}
        data-tip="The sign-off is yours: when every pass is closed"
        disabled={current !== null}
        onClick={() => passes.view(null)}
      >
        Sign-off
      </button>
    </div>
  );
}

/**
 * At the top of the notes panel: the pass shown and what can be done. A pass is closed (notes
 * left open stay so), skipped, or a closed one reopened.
 */
export function PassHeader({ view }: { view: EditorView | null }) {
  const state = usePasses();
  // Open grammar corrections, on the text: "Accept all" applies them in one go.
  const fixes = useJudgments(
    (s) =>
      s.notes.filter(
        (n) =>
          n.pass === "grammar" &&
          n.status === "open" &&
          n.range !== null &&
          (n.proposal.action === "delete" ||
            (n.proposal.action === "replace" && n.proposal.text !== undefined)),
      ).length,
  );
  const words = useDoc((s) => s.counts.words);
  const counts = useOpenCounts();
  const running = useRunning();
  if (!isActive(state)) return null;
  const current = currentPass(state.records);
  const shown = shownPass(state);

  // Review finished: the sign-off.
  if (!shown) return <SignOff />;

  const status = passStatus(shown, state.records);
  const record = state.records.find((r) => r.pass === shown);
  const open = counts[shown];
  const next = nextPass(shown);
  const title = `${STEP_LABEL[shown]} pass`;

  if (shown !== current) {
    return (
      <div className="pass-head" role="group" aria-label={title}>
        <span className="pass-head-title">{title}</span>
        <span className="pass-head-note">
          {status === "skipped" ? "skipped" : status === "done" ? "done" : `${open} open`}
          {record && changedSince(record, words) ? " · text changed since" : ""}
        </span>
        <span className="grow" />
        {(status === "done" || status === "skipped") && (
          <button
            className="pass-btn"
            data-tip="Open this pass again and check it on the current text"
            onClick={() => void passes.reopen(shown)}
          >
            Reopen
          </button>
        )}
        <button className="pass-link" onClick={() => passes.view(null)}>
          Back to {current ? STEP_LABEL[current] : "the review"}
        </button>
      </div>
    );
  }

  const busy = running !== null || useReview.getState().progress !== null;
  const primary =
    open > 0 ? "Finish pass" : next ? `Continue to ${STEP_LABEL[next]}` : "Finish review";
  return (
    <div className="pass-head" role="group" aria-label={title}>
      <span className="pass-head-title">{title}</span>
      <span className="pass-head-note">
        {running === shown ? "checking…" : status === "waiting" ? "to check" : `${open} open`}
      </span>
      <span className="grow" />
      {shown === "grammar" && fixes > 1 && (
        <button
          className="pass-btn"
          disabled={busy}
          data-tip="Apply every correction at once: one ⌘Z undoes them all"
          onClick={() => noteActions.applyAll(view)}
        >
          Accept all {fixes}
        </button>
      )}
      {(open > 0 || status === "waiting") && (
        <button
          className="pass-link"
          disabled={busy}
          data-tip="Leave this pass out and go on"
          onClick={() => void passes.skip(shown)}
        >
          Skip
        </button>
      )}
      <button
        className="pass-btn pass-btn-primary"
        disabled={busy || status === "waiting"}
        data-tip={
          open > 0
            ? `Close the pass: the ${open} open notes stay open${next ? `, then ${STEP_LABEL[next]}` : ""}`
            : next
              ? `Close the pass and check ${STEP_LABEL[next]}`
              : "Close the last pass"
        }
        onClick={() => void passes.finish(shown)}
      >
        {primary}
      </button>
    </div>
  );
}

/**
 * The editor's letter for the pass shown: two or three sentences on the whole text, at the top of
 * the margin, with the pass's score next to it if it has one. When the text has changed since it
 * was read, it says so.
 */
export function EditorLetter() {
  const state = usePasses();
  const byPass = useLetters((s) => s.byPass);
  const fresh = useLetters((s) => s.fresh);
  const running = useRunning();
  const scores = useScores((s) => s.byKind);
  const bodyHash = useDoc((s) => s.bodyHash);
  // On the first pass the review starts only when it is over: write for the one that is running.
  const shown = shownPass(state) ?? running;
  if (!shown) return null;
  const label = `Editor’s letter · ${STEP_LABEL[shown].toLowerCase()}`;
  // While the model works the editor writes: the letter arrives at the end of the pass.
  if (running === shown) {
    return (
      <section className="letter" aria-label={label} aria-busy="true">
        <div className="letter-head">
          <span className="letter-label">{label}</span>
        </div>
        <p className="letter-writing">
          The editor is writing
          <span className="letter-dots" aria-hidden>
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </p>
      </section>
    );
  }
  const letter = byPass[shown];
  if (!letter) return null;
  const kind = STEP_SCORE[shown];
  const score = kind ? scores[kind] : undefined;
  const stale = bodyHash !== "" && bodyHash !== letter.bodyHash;
  const time = new Date(letter.updatedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <section className="letter" aria-label={label} data-stale={stale}>
      <div className="letter-head">
        <span className="letter-label">{label}</span>
        {score && (
          <span className="letter-score" data-tip={score.reason || undefined}>
            {score.value}
          </span>
        )}
      </div>
      <HandText
        key={letter.updatedAt}
        className="letter-text"
        text={letter.text}
        writing={fresh === shown}
        onWritten={() => useLetters.getState().set({ fresh: null })}
      />
      <span className="letter-meta">
        {stale ? "Out of date: the text has changed since" : `Whole text · read at ${time}`}
      </span>
    </section>
  );
}

/** How many habits to show: the most frequent. */
const HABITS_SHOWN = 4;

/**
 * The author's habits, in the prose pass: how many times they come back in this piece and across
 * all drafts, and how they compare with last time.
 */
export function YourHabits() {
  const state = usePasses();
  const path = useDoc((s) => s.path);
  const habits = useHabits((s) => s.habits);
  const shown = shownPass(state);
  useEffect(() => {
    if (shown === "prose") void loadHabits(path);
  }, [shown, path]);
  if (shown !== "prose" || habits.length === 0) return null;
  return (
    <section className="habits" aria-label="Your habits">
      <span className="letter-label">Your habits</span>
      {habits.slice(0, HABITS_SHOWN).map((h) => (
        <div key={h.id} className="habit">
          <span className="habit-name">{habitLabel(h.id)}</span>
          <span className="habit-here" data-tip="In this piece">
            {h.inDraft}
          </span>
          <span className="habit-all">
            {h.count} in {h.drafts} {h.drafts === 1 ? "draft" : "drafts"}
            {h.previous !== undefined && h.previous !== h.count
              ? ` · ${h.previous > h.count ? "down" : "up"} from ${h.previous}`
              : ""}
          </span>
        </div>
      ))}
    </section>
  );
}
