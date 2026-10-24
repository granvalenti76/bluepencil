import { Annotation } from "@codemirror/state";

/**
 * Marks the transactions born from a click on a note (Apply / Undo): the exception Hemingway mode
 * must let through.
 */
export const deskAction = Annotation.define<boolean>();
