import { useState } from "react";
import type { Judgment } from "@desk/core";
import type { EditorView } from "@codemirror/view";
import {
  addToGlossary,
  canAddToGlossary,
  canMarkOpinion,
  canUndo,
  doneLabel,
  noteActions,
  noteType,
  opensPanel,
  TYPE_LABEL,
} from "./notes.ts";
import { footnoteDoneLabel, markOpinion } from "./footnotes.ts";
import { ComparePanel, SourcePicker } from "./SourcePanels.tsx";
import {
  addEmptySection,
  discardProposal,
  insertProposal,
  isSectionProposal,
  proposalStatusText,
  requestProposal,
  useProposals,
} from "./proposals.ts";
import { useHabits } from "./habits.ts";
import { useJudgments } from "./store.ts";

interface Props {
  note: Judgment;
  view: EditorView | null;
  flashing: boolean;
  /** The note's number, the same as the one marked on the page. */
  number?: number;
}

/** "Got it" says little: notes without a change say who does what. */
const NOTED: Record<Judgment["pass"], string> = {
  structure: "I’ll rework it",
  facts: "Noted",
  prose: "I’ll rework it",
  grammar: "Got it",
};

function primaryLabel(note: Judgment): string {
  if (note.proposal.action === "none") return NOTED[note.pass];
  if (note.proposal.action === "draft_section") return "Add empty section";
  return note.proposal.label || "Apply";
}

/** The margin note: type, title, main action, "Ignore"; collapsed once resolved. */
export function NoteCard({ note, view, flashing, number }: Props) {
  const type = noteType(note);
  const open = note.status === "open";
  const setHover = useJudgments((s) => s.setHover);
  const proposal = useProposals((s) => s.byId[note.id]);
  const [panel, setPanel] = useState(false);
  // A prose note on a word that keeps coming back across drafts.
  const isHabit = useHabits(
    (s) => note.pass === "prose" && s.words.includes(note.anchor.quote.trim().toLowerCase()),
  );
  const primary = () => {
    if (note.proposal.action === "draft_section") addEmptySection(view, note);
    else if (isSectionProposal(note)) void requestProposal(note);
    else if (opensPanel(note)) setPanel((p) => !p);
    else noteActions.apply(view, note.id);
  };

  return (
    <div
      className="note"
      data-testid={`margin-card-${note.id}`}
      data-status={note.status}
      data-type={type}
      data-flash={flashing}
      tabIndex={0}
      onMouseEnter={() => setHover(note.id)}
      onMouseLeave={() => setHover(null)}
      onFocus={() => setHover(note.id)}
      onBlur={() => setHover(null)}
      onKeyDown={(e) => {
        // Enter = main action, Esc = ignore: only if the note itself has focus
        if (e.target !== e.currentTarget || !open) return;
        if (e.key === "Enter") {
          e.preventDefault();
          primary();
        } else if (e.key === "Escape") {
          e.preventDefault();
          noteActions.ignore(view, note.id);
        }
      }}
    >
      <div className="note-head">
        {number !== undefined && (
          <span className="note-number" aria-label={`Note ${number}`}>
            {number}
          </span>
        )}
        <span className="note-title">{note.title}</span>
        {isHabit && (
          <span
            className="note-habit"
            data-tip="You often do this: it comes back across your drafts"
          >
            your habit
          </span>
        )}
        <span className="note-chip" data-type={type}>
          {TYPE_LABEL[type]}
        </span>
        {!open && canUndo(view, note.id) && (
          <button className="note-undo" onClick={() => noteActions.undo(view, note.id)}>
            Undo
          </button>
        )}
      </div>
      {open && showQuote(note) && (
        <q
          className="note-quote"
          data-tip={note.range ? undefined : "This passage is no longer in the text"}
        >
          {note.anchor.quote}
        </q>
      )}
      {open && note.rationale && <div className="note-text">{note.rationale}</div>}
      {open &&
        note.proposal.action === "replace" &&
        note.pass !== "grammar" &&
        note.proposal.text && <div className="note-proposal">{note.proposal.text}</div>}
      {open ? null : (
        <div className="note-done">
          {(note.status === "applied" && footnoteDoneLabel(view, note)) || doneLabel(note)}
        </div>
      )}
      {open && (
        <div className="note-actions">
          <button
            className="note-primary"
            disabled={proposal?.status === "loading"}
            aria-expanded={opensPanel(note) ? panel : undefined}
            data-tip={PRIMARY_TIP[note.proposal.action]}
            onClick={primary}
          >
            {primaryLabel(note)}
          </button>
          <button
            className="note-ignore"
            data-tip="Dismiss the note: it won’t come back"
            onClick={() => noteActions.ignore(view, note.id)}
          >
            Ignore
          </button>
          <span className="grow" />
          {note.proposal.action === "draft_section" && (
            <button
              className="note-link"
              disabled={proposal?.status === "loading"}
              data-tip="Ask the model for a first draft: insert it only if you like it"
              onClick={() => void requestProposal(note)}
            >
              Propose a draft
            </button>
          )}
          {canAddToGlossary(note) && (
            <button className="note-link" onClick={() => void addToGlossary(view, note)}>
              Add to glossary
            </button>
          )}
          {view && canMarkOpinion(note) && (
            <button className="note-link" onClick={() => markOpinion(view, note)}>
              Mark as opinion
            </button>
          )}
        </div>
      )}
      {open && panel && note.proposal.action === "add_source" && (
        <SourcePicker note={note} view={view} onClose={() => setPanel(false)} />
      )}
      {open && panel && note.proposal.action === "compare_sources" && (
        <ComparePanel note={note} onClose={() => setPanel(false)} />
      )}
      {open && proposal && (
        <ProposalBox
          id={note.id}
          status={proposal.status}
          text={proposal.status === "ready" ? (proposal.text ?? "") : proposalStatusText(proposal)}
          onInsert={() => insertProposal(view, note)}
        />
      )}
    </div>
  );
}

/** What the main button does, for the hover tooltip. */
const PRIMARY_TIP: Record<Judgment["proposal"]["action"], string> = {
  replace: "Replace the text with the suggestion (undo with ⌘Z)",
  delete: "Remove the passage from the text (undo with ⌘Z)",
  insert_after: "Add the suggested text after the passage (undoable)",
  add_source: "Link a source with a footnote",
  mark_opinion: "State that this is your own opinion",
  compare_sources: "Show the source passages that mention it",
  regenerate_section: "Ask the model for a suggestion: insert it only if you like it",
  draft_section: "Add the section’s heading at the end, for you to write",
  none: "Mark the note as handled: the text stays as it is",
};

/** The quoted passage helps when the title does not already say it (grammar shows it in the title). */
const showQuote = (n: Judgment) => n.anchor.quote.trim() !== "" && n.pass !== "grammar";

/** Box below the note with the model's proposal: it goes into the text only with "Insert". */
export function ProposalBox({
  id,
  status,
  text,
  onInsert,
}: {
  id: string;
  status: "loading" | "ready" | "error";
  text: string;
  onInsert: () => void;
}) {
  return (
    <div className="proposal" data-testid={`proposal-${id}`} data-status={status}>
      <div className="proposal-text" role={status === "ready" ? undefined : "status"}>
        {text}
      </div>
      <div className="proposal-actions">
        {status === "ready" && (
          <button className="note-primary" onClick={onInsert}>
            Insert
          </button>
        )}
        <button className="note-ignore" onClick={() => discardProposal(id)}>
          {status === "loading" ? "Cancel" : "Discard"}
        </button>
      </div>
    </div>
  );
}
