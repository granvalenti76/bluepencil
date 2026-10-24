import { useEffect } from "react";
import { createPortal } from "react-dom";

const SHORTCUTS: [string, string][] = [
  ["⌘N", "New draft (desktop app)"],
  ["⌘O", "Your drafts"],
  ["⌃⌘N", "Switch between Write and Review"],
  ["⌘S", "Save now (drafts also save on their own)"],
  ["⌘Z / ⇧⌘Z", "Undo / redo, including changes made from a note"],
  ["⌘B · ⌘I · ⌘E · ⌘K", "Bold · italic · code · link"],
  ["⌥⌘1–3 · ⌥⌘0", "Title, heading, subheading · body text"],
  ["⇧⌘7 · ⇧⌘8 · ⇧⌘9", "Numbered list · bulleted list · quote"],
  ["⌥⌘M", "Show the Markdown"],
  ["⇧⌘P", "Preview the text as a reader sees it"],
  ["⌘,", "Settings"],
  ["Enter · Esc", "On a focused note: apply it · ignore it"],
];

/**
 * Minimal help (Help ▸ Bluepencil Help in the desktop app): what the app does and how to use it,
 * offline. In English like the rest of the interface.
 */
export function HelpDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal modal-wide help"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
      >
        <h2 id="help-title">Bluepencil Help</h2>
        <div className="help-body">
          <p>
            Bluepencil is a Markdown editor for your writing. An editor — a language model running
            on your own network — reads your text back and suggests;{" "}
            <strong>it never changes your text by itself</strong>. Every change happens only when
            you click, and every change can be undone.
          </p>

          <h3>The first start</h3>
          <p>
            The first time, Bluepencil asks three things. <em>Your writing</em>: a new folder or one
            you already use. <em>The editor</em>: the address of llama-server; Bluepencil tries it
            and the editor writes its first words — or you write without it. <em>Try it</em>: a
            sample piece opens with three things to try. You can change the folder and the editor
            later in Settings.
          </p>

          <h3>Your texts</h3>
          <p>
            Every <code>.md</code> file in the folder is a text: the files are the real data, so you
            can edit, copy or back them up with any tool. A file that another text cites (in its
            sources or a footnote) is a <em>source</em>. <em>⌘O</em> or the name at the top opens
            your drafts; <em>+ New</em> starts one. The type of text and a plan of the sections are
            optional: tick <em>Plan the sections first</em>, or use <em>Plan the sections</em> in
            the outline later.
          </p>

          <h3>Write</h3>
          <p>
            The page shows your text as it will read: the Markdown hides and comes back on the line
            you are editing (<em>Show Markdown</em>, ⌥⌘M, shows it all). Each line on the page has
            its number. The bar above the page formats the text, adds links, images, tables and
            sources; <em>Ask the editor</em> on a selection offers to rephrase it (concise, clearer,
            smoother, creative) or to check it — the proposals go in only with <em>Use this</em>.
            The outline next to the page shows each section against its target. Focus, Handwriting
            and Typing sounds are in the <em>View</em> menu.
          </p>

          <h3>Review and the editor’s card</h3>
          <p>
            Switch to <em>Review</em> at the top. The editor reads the whole text in four passes,
            like a managing editor: structure, facts, prose, grammar last. Each pass is a tab on the
            editor’s card, next to the page: a short letter in the editor’s hand, then the numbered
            notes, with the same number pencilled on the page next to its passage — click either to
            jump to the other. Use the note’s main button to apply a suggestion, <em>Ignore</em> to
            dismiss it, <em>Undo</em> to put the text back. Grammar fixes are proofreading marks and
            change nothing until you accept them (<em>Accept all</em> takes them in one go; one ⌘Z
            undoes them). <em>Finish pass</em> or <em>Skip</em> moves on to the next pass. The prose
            pass also shows readability and your habits; elsewhere, click <em>Readability</em> on
            the card to see them.
          </p>
          <p>
            When the last pass is closed, the <em>Sign-off</em> tab gives the visto — «Visto, si
            stampi», with the date and a blind stamp on the page — and leads to <em>Publish…</em>.
            Editing the text afterwards lifts it. «Written by you» counts the words that did not
            come from accepted suggestions.
          </p>

          <h3>Sources and facts</h3>
          <p>
            The facts pass compares numbers, names and dates with your sources. Cite one from{" "}
            <em>Source</em> in the bar, or with <em>Add source</em> on a note: it becomes a
            footnote. <em>Mark as opinion</em> states that a claim is your own view.
          </p>

          <h3>Publishing</h3>
          <p>
            <em>File ▸ Publish…</em> copies the text, without your working notes, into the folder
            you choose. If that folder is inside a git repository, Bluepencil also commits the file;
            it pushes only if you enable it in Settings and confirm.
          </p>

          <h3>Settings</h3>
          <p>
            <em>Bluepencil ▸ Settings…</em> (⌘,) sets the folder of your texts, the publish folder,
            the address of the editor (llama-server, OpenAI-compatible), the languages and, if one
            is configured, the cloud model. Each text has a language, chosen when you create it: it
            decides the language of the editor’s notes and the readability index. To add one, use{" "}
            <em>Languages ▸ New language…</em>. Nothing leaves your computer except requests to the
            editor, and to the cloud only while you turn it on.
          </p>

          <h3>Keyboard shortcuts</h3>
          <table className="help-keys">
            <tbody>
              {SHORTCUTS.map(([keys, what]) => (
                <tr key={keys}>
                  <td>
                    <kbd>{keys}</kbd>
                  </td>
                  <td>{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
