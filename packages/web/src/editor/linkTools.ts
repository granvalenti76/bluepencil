import { StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  EditorView,
  hoverTooltip,
  keymap,
  showTooltip,
  type Command,
  type Tooltip,
} from "@codemirror/view";
import { linkAt, removeLink, setLink } from "./formatting.ts";

/**
 * Links: ⌘K opens an address field below the selection; hovering a link shows the address,
 * "Open", "Edit" and "Remove".
 */

const setField = StateEffect.define<{ pos: number; url: string } | null>();

const field = StateField.define<{ pos: number; url: string } | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setField)) value = e.value;
    // Typing in the text or moving the cursor closes the field.
    if (value && (tr.docChanged || (tr.selection && !tr.effects.some((e) => e.is(setField)))))
      return null;
    return value;
  },
  provide: (f) =>
    showTooltip.from(f, (v): Tooltip | null =>
      v ? { pos: v.pos, above: false, create: (view) => linkField(view, v.url) } : null,
    ),
});

/** ⌘K: the address field, already filled in if the cursor is on a link. */
export const openLinkField: Command = (view) => {
  const { state } = view;
  const sel = state.selection.main;
  const existing = linkAt(state, sel.head);
  view.dispatch({
    effects: setField.of({ pos: existing ? existing.to : sel.to, url: existing?.url ?? "" }),
  });
  return true;
};

function linkField(view: EditorView, url: string) {
  const dom = document.createElement("form");
  dom.className = "cm-link-field";
  const input = document.createElement("input");
  input.type = "url";
  input.value = url;
  input.placeholder = "https://";
  input.setAttribute("aria-label", "Link address");
  const apply = document.createElement("button");
  apply.type = "submit";
  apply.textContent = url ? "Update" : "Add link";
  dom.append(input, apply);
  const close = () => {
    view.dispatch({ effects: setField.of(null) });
    view.focus();
  };
  dom.addEventListener("submit", (e) => {
    e.preventDefault();
    view.dispatch({ effects: setField.of(null) });
    setLink(view, input.value);
    view.focus();
  });
  // The field's keys stay with the field: the editor must not receive them (Enter, Esc, arrows).
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });
  return { dom, mount: () => input.focus() };
}

function button(label: string, onClick: () => void) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("click", onClick);
  return b;
}

/** The link under the mouse: the address and what to do with it. */
const linkHover = hoverTooltip(
  (view, pos) => {
    const link = linkAt(view.state, pos);
    if (!link || pos < link.text.from || pos > link.text.to) return null;
    return {
      pos: link.text.from,
      end: link.text.to,
      above: true,
      create: () => {
        const dom = document.createElement("div");
        dom.className = "cm-link-hover";
        const url = document.createElement("span");
        url.className = "cm-link-url";
        url.textContent = link.url;
        const open = document.createElement("a");
        open.href = link.url;
        open.target = "_blank";
        open.rel = "noopener noreferrer";
        open.textContent = "Open";
        dom.append(
          url,
          open,
          button("Edit", () => {
            view.dispatch({
              selection: { anchor: link.text.from, head: link.text.to },
              effects: setField.of({ pos: link.to, url: link.url }),
            });
          }),
          button("Remove", () => {
            removeLink(view, link.text.from);
            view.focus();
          }),
        );
        return { dom };
      },
    };
  },
  { hoverTime: 250 },
);

const theme = EditorView.baseTheme({
  ".cm-tooltip.cm-tooltip-hover, .cm-tooltip:has(> .cm-link-field)": {
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    background: "var(--card)",
    boxShadow: "var(--shadow-2)",
  },
  ".cm-link-field, .cm-link-hover": {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 8px",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--fs-body)",
  },
  ".cm-link-field input": {
    width: "260px",
    padding: "4px 8px",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    background: "var(--paper)",
    color: "var(--text)",
    font: "inherit",
  },
  ".cm-link-field button, .cm-link-hover button, .cm-link-hover a": {
    padding: "3px 8px",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    background: "transparent",
    color: "var(--text)",
    font: "inherit",
    textDecoration: "none",
    cursor: "pointer",
  },
  ".cm-link-url": {
    maxWidth: "260px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-muted)",
  },
});

export function linkTools(): Extension {
  return [
    field,
    linkHover,
    keymap.of([{ key: "Mod-k", run: openLinkField, preventDefault: true }]),
    theme,
  ];
}
