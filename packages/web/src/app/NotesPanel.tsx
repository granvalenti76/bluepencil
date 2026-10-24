import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { EditorView } from "@codemirror/view";
import { judgmentsField, setJudgments } from "../editor/judgmentsField.ts";
import { api } from "./api.ts";
import { useDoc } from "./docStore.ts";
import { TrashIcon } from "./icons.tsx";
import { NoteCard } from "./NoteCard.tsx";
import { isMissingPart, noteNumbers, orderedNotes } from "./noteOrder.ts";
import { hasCard } from "./notes.ts";
import { currentPass, REVIEW_ORDER } from "@desk/core";
import { EditorLetter, PassHeader, PassTabs, YourHabits } from "./PassRail.tsx";
import { STEP_LABEL } from "./review.ts";
import { letters } from "./letters.ts";
import { motion, reducedMotion } from "./motion.ts";
import { isActive, passes, shownPass, usePasses } from "./passes.ts";
import { useProposals } from "./proposals.ts";
import { ReadingPanel } from "./ReadingPanel.tsx";
import { useJudgments, useUi } from "./store.ts";

/**
 * Right-hand panel: the reading of the text at the top, then the notes. Notes are in text order;
 * those not tied to a precise spot (or whose quote cannot be found) are at the bottom, "On the
 * whole text". A click on a note takes the text to the quote; a click on an underline takes the
 * panel to the note. Once the review has started it shows one pass at a time, with what can be
 * done at the top.
 */
export function NotesPanel({ view }: { view: EditorView | null }) {
  const notes = useJudgments((s) => s.notes);
  const flashId = useJudgments((s) => s.flashId);
  const visibleTypes = useUi((s) => s.visibleTypes);
  const galley = usePasses((s) => isActive(s));
  const list = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);

  // A pass starts: the card comes from the stack, where the tab was waiting askew.
  useEffect(
    () =>
      motion.onServe(() => {
        if (reducedMotion()) return;
        cardRef.current?.animate(
          [
            { transform: "translate(10px, -16px) rotate(1.8deg)", opacity: 0.5 },
            { transform: "none", opacity: 1 },
          ],
          { duration: 420, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        );
      }),
    [],
  );

  const visible = useMemo(() => notes.filter((n) => n.status !== "stale" && hasCard(n)), [notes]);
  // The same order (and the same numbers) as the marks on the page.
  const order = useMemo(() => orderedNotes(notes, visibleTypes), [notes, visibleTypes]);
  const numbers = useMemo(() => noteNumbers(order), [order]);
  const { anchored, loose } = order;
  const shown = [...anchored, ...loose];
  const open = shown.filter((n) => n.status === "open").length;

  useEffect(() => {
    if (!flashId) return;
    list.current
      ?.querySelector(`[data-testid="margin-card-${CSS.escape(flashId)}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const t = setTimeout(() => useJudgments.getState().flash(""), 1600);
    return () => clearTimeout(t);
  }, [flashId]);

  /** The note's quote, centred in the editor (the editor keeps the current positions). */
  const reveal = (id: string) => {
    if (!view) return;
    const item = view.state.field(judgmentsField).items.find((j) => j.id === id);
    // A missing part is marked at the bottom of the page.
    const note = notes.find((n) => n.id === id);
    const at = item?.from ?? (note && isMissingPart(note) ? view.state.doc.length : null);
    if (at === null) return;
    view.dispatch({ effects: EditorView.scrollIntoView(at, { y: "center" }) });
  };

  const card = (n: (typeof shown)[number]) => (
    <li
      key={n.id}
      className="notes-item"
      // Newly arrived notes appear one at a time, like their marks on the page.
      style={
        motion.noteDelay(n.id) !== undefined
          ? ({ "--note-delay": `${motion.noteDelay(n.id)}ms` } as CSSProperties)
          : undefined
      }
      onClick={(e) => {
        // Only a click on the note, not on its buttons or fields.
        if (!(e.target as HTMLElement).closest("button, input, a, form")) reveal(n.id);
      }}
    >
      <NoteCard note={n} view={view} flashing={flashId === n.id} number={numbers[n.id]} />
    </li>
  );

  const pass = usePasses((s) => shownPass(s));
  const waiting = usePasses((s) => {
    const current = currentPass(s.records);
    return current !== null && current !== REVIEW_ORDER[REVIEW_ORDER.length - 1];
  });
  return (
    <div className="card-stack" data-waiting={galley && waiting}>
      {galley && <PassTabs />}
      <aside
        ref={cardRef}
        id="editor-card"
        className="notes-panel editor-card"
        aria-label="Editor's card"
        role={galley ? "tabpanel" : undefined}
        aria-labelledby={galley ? `pass-tab-${pass ?? "signoff"}` : undefined}
      >
        <div className="notes-head">
          <span className="panel-title">
            The editor{galley ? ` · ${pass ? STEP_LABEL[pass] : "Done"}` : ""}
          </span>
          <span className="grow" />
          <span className="notes-count">{`${open} open`}</span>
          <ClearButton view={view} disabled={visible.length === 0} />
        </div>
        <div className="notes-list" ref={list}>
          <ReadingPanel />
          <EditorLetter />
          <YourHabits />
          {anchored.length > 0 && (
            <ol className="notes-ol" aria-label="Notes">
              {anchored.map(card)}
            </ol>
          )}
          {loose.length > 0 && <div className="notes-section">On the whole text</div>}
          {loose.length > 0 && (
            <ol className="notes-ol" aria-label="On the whole text">
              {loose.map(card)}
            </ol>
          )}
          {shown.length === 0 && (
            <p className="notes-empty">
              {visible.length === 0
                ? "No notes. Select a passage to rephrase or check it, or start a review."
                : galley
                  ? "No notes in this pass."
                  : "No notes."}
            </p>
          )}
        </div>
        <PassHeader view={view} />
      </aside>
    </div>
  );
}

/**
 * "Clear suggestions": the review is not set in stone. Removes all the draft's notes (the text
 * does not change; what was already applied can still be undone with ⌘Z) and the analysis cache,
 * so the next one starts from the model again (and from the first pass). Asks for confirmation.
 */
function ClearButton({ view, disabled }: { view: EditorView | null; disabled: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const path = useDoc((s) => s.path);
  const clear = async () => {
    setConfirm(false);
    if (!path) return;
    try {
      await api.clearJudgments(path);
    } catch {
      return;
    }
    useJudgments.getState().setNotes([]);
    useProposals.setState({ byId: {} });
    // The server also removed the passes' state: the review starts again from structure.
    void passes.load(path);
    letters.clear();
    view?.dispatch({ effects: setJudgments.of([]) });
  };
  if (confirm) {
    return (
      <span className="confirm" role="group" aria-label="Confirm">
        <button className="confirm-yes" onClick={() => void clear()}>
          Clear all
        </button>
        <button className="confirm-no" onClick={() => setConfirm(false)}>
          No
        </button>
      </span>
    );
  }
  return (
    <button
      className="icon-btn"
      aria-label="Clear suggestions"
      data-tip="Clear all suggestions: the next review starts from scratch"
      disabled={disabled}
      onClick={() => setConfirm(true)}
    >
      <TrashIcon />
    </button>
  );
}
