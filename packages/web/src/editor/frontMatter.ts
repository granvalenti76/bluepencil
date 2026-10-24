import { EditorState, Facet, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { splitFrontMatter } from "@desk/core";

/** Lines taken by the (hidden) front matter: the numbering subtracts them. */
export const frontMatterLines = Facet.define<number, number>({ combine: (v) => v[0] ?? 0 });

class Hidden extends WidgetType {
  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-front-matter-hidden";
    el.setAttribute("aria-hidden", "true");
    return el;
  }
  override ignoreEvent() {
    return true;
  }
}

/**
 * Hides the front matter with a block decoration and prevents editing it from here: the front
 * matter changes through `frontmatterPatch`, not by typing in the editor.
 */
export function frontMatter(doc: string): Extension {
  const { bodyOffset } = splitFrontMatter(doc);
  if (bodyOffset === 0) return [];

  let end = bodyOffset;
  if (doc[end - 1] === "\n") end--;
  if (doc[end - 1] === "\r") end--;
  const lines = doc.slice(0, bodyOffset).split("\n").length - 1;

  const hidden = StateField.define<DecorationSet>({
    create: () =>
      Decoration.set([Decoration.replace({ widget: new Hidden(), block: true }).range(0, end)]),
    update: (value, tr) => value.map(tr.changes),
    provide: (f) => EditorView.decorations.from(f),
  });

  return [
    frontMatterLines.of(lines),
    hidden,
    // A range that reaches the last character before the body: Backspace at the start of the body
    // cannot join the lines, while typing at the start of the body is still possible.
    EditorState.changeFilter.of(() => [0, bodyOffset]),
  ];
}
