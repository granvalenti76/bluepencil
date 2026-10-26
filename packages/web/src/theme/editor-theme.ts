import { EditorView } from "@codemirror/view";

/** The laid-paper page, only from the tokens. */
export const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent",
    color: "var(--text)",
    fontFamily: "var(--font-text)",
    fontSize: "var(--text-size)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "var(--text-line)", overflowY: "auto" },
  ".cm-content": {
    flexGrow: "0",
    flexShrink: "1",
    width: "var(--measure)",
    minWidth: "0",
    marginLeft: "var(--numbers)",
    // Room for the cue numbers on the right, inside the scroller (styleMargin.ts).
    marginRight: "var(--cue-numbers, 0px)",
    padding: "8px 0",
    caretColor: "var(--text)",
  },
  ".cm-content ::selection": { backgroundColor: "var(--selection)" },
  ".cm-line": { padding: "0", transition: "opacity 150ms" },
  ".cm-line.cm-dim": { opacity: "0.3" },
  ".cm-blank": { lineHeight: "14px" },
  ".cm-front-matter-hidden": { height: "0" },

  // Section note
  // "Ask" next to the selection (selectionActions.ts): opens the editor's box.
  ".cm-tooltip.cm-sel-actions": {
    border: "none",
    background: "transparent",
    fontFamily: "var(--font-ui)",
    marginTop: "4px",
  },
  ".cm-sel-ask": {
    padding: "2px 10px",
    border: "1px solid var(--pencil)",
    borderRadius: "999px",
    background: "var(--card)",
    color: "var(--pencil)",
    fontSize: "var(--fs-small)",
    fontWeight: "600",
    cursor: "pointer",
    boxShadow: "var(--shadow-1)",
  },
  ".cm-ask-host": { padding: "6px 0 14px" },

  // Pencil marks: one colour, the pencil; the type reads from the shape.
  ".cm-j": {
    textDecorationLine: "underline",
    textDecorationThickness: "2px",
    textUnderlineOffset: "5px",
  },
  ".cm-j-fact-ok": {
    textDecorationStyle: "solid",
    textDecorationThickness: "1.5px",
    textDecorationColor: "var(--fact-ok)",
  },
  ".cm-j-fact": {
    textDecorationStyle: "dotted",
    textDecorationColor: "var(--pencil)",
    backgroundColor: "var(--pencil-bg)",
  },
  ".cm-j-grammar": { textDecorationStyle: "dotted", textDecorationColor: "var(--pencil)" },
  ".cm-j-prose": {
    textDecorationStyle: "wavy",
    textDecorationThickness: "1.5px",
    textDecorationColor: "var(--pencil)",
  },
  // Grammar correction: the proofreader's mark instead of the underline.
  ".cm-j-proof": { textDecorationLine: "none" },
  ".cm-proof-del": {
    textDecorationLine: "line-through",
    textDecorationThickness: "2px",
    textDecorationColor: "var(--pencil)",
  },
  // Short corrections (a word, a comma) are unreadable by hand: blue italic.
  ".cm-proof-ins::before": {
    content: "'‸' attr(data-ins)",
    marginLeft: "2px",
    color: "var(--pencil)",
    fontStyle: "italic",
    fontSize: "0.92em",
  },
  ".cm-j-active": { backgroundColor: "var(--accent-bg)" },
  // The note's number next to its text (the same as on the card), handwritten. Raised without
  // widening the line.
  ".cm-jn": { cursor: "pointer" },
  ".cm-jn::before": {
    content: "attr(data-n)",
    position: "relative",
    top: "-0.45em",
    marginLeft: "2px",
    padding: "0 2px",
    color: "var(--pencil)",
    fontFamily: "var(--font-hand)",
    fontSize: "1.15em",
    lineHeight: "0",
  },
  ".cm-j-waiting::before": {
    content: "''",
    display: "inline-block",
    width: "5px",
    height: "5px",
    marginLeft: "2px",
    borderRadius: "50%",
    backgroundColor: "var(--pencil-soft)",
    verticalAlign: "super",
  },
  // The words that came from accepted suggestions, when the author asks to see them.
  ".cm-authored": {
    backgroundColor: "var(--pencil-bg)",
    boxShadow: "inset 0 -1.5px 0 var(--pencil-soft)",
  },
  // Structure note: a pencil bracket in the left margin of the stretch.
  ".cm-line.cm-struct-line": { position: "relative" },
  ".cm-struct-line::before": {
    content: "''",
    position: "absolute",
    left: "-12px",
    top: "0",
    bottom: "0",
    width: "6px",
    borderLeft: "2px solid var(--pencil)",
  },
  ".cm-struct-first::before": {
    top: "6px",
    borderTop: "2px solid var(--pencil)",
    borderTopLeftRadius: "3px",
  },
  ".cm-struct-last::before": {
    bottom: "6px",
    borderBottom: "2px solid var(--pencil)",
    borderBottomLeftRadius: "3px",
  },
  // A missing part: ‸ at the end of the page, with the note's number.
  ".cm-missing": {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    margin: "18px 0 8px",
    color: "var(--pencil)",
    fontFamily: "var(--font-ui)",
    fontSize: "13px",
    fontWeight: "500",
    cursor: "pointer",
  },
  ".cm-missing .cm-jn::before": { marginLeft: "0", top: "0" },
  ".cm-missing-caret": { fontFamily: "var(--font-text)", fontSize: "24px", lineHeight: "1" },
  ".cm-missing::after": {
    content: "''",
    flex: "1",
    borderTop: "1.5px dashed var(--pencil-soft)",
  },
});
