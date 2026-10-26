import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, layer, type LayerMarker } from "@codemirror/view";
import type { CueTone } from "./cueMarks.ts";

/**
 * The editor's reading beside a style, in the page's margins. On the left, beyond the line
 * numbers, a column for each paragraph: what it does ("opening", "scene"), its number and its
 * sentences as bars, short ones in sienna. On the right, the numbers of the cues on it: sienna
 * where the draft does otherwise, the pencil where it already does the same, dashed where the
 * procedure is missing; the open cue's number filled, and its paragraph tinted from margin to
 * margin. Drawn in layers, like the line numbers, so the text never moves. Shown in Style mode,
 * and in Write with View → Style cues (the shell widens the left margin then; the CSS hides the
 * layers elsewhere). A click on a number opens its cue.
 */
export interface MarginParagraph {
  from: number;
  to: number;
  /** The paragraph's number, from 1. */
  n: number;
  /** What it does, in the editor's words. */
  label?: string;
  /** Its sentences' lengths, in words. */
  bars: number[];
  cues: { n: number; tone: CueTone }[];
  /** The open cue is on this paragraph: tinted, and its number (if any) filled. */
  open?: number | true;
}

export const setStyleMargin = StateEffect.define<MarginParagraph[]>();

const field = StateField.define<MarginParagraph[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setStyleMargin)) return e.value;
    if (!tr.docChanged || value.length === 0) return value;
    return value.map((p) => ({
      ...p,
      from: tr.changes.mapPos(p.from, 1),
      to: tr.changes.mapPos(p.to, -1),
    }));
  },
});

/** The column on the left: its width, and the gap to the line numbers' column. */
const COLUMN = 92;
const GAP = 12;
/** The line numbers' column, from the text (visualLineNumbers.ts: 24 + 40). */
const NUMBERS = 64;
/** The numbers on the right: their size and the gap to the text. */
const NUMBER = 26;
const RIGHT_GAP = 10;
/** The tint goes this far beyond the paragraph, above and below. */
const BLEED = 8;

/** The page's geometry in the layers' coordinates: the text's left and right edges. */
function frame(view: EditorView) {
  const scroll = view.scrollDOM.getBoundingClientRect();
  const baseLeft = scroll.left - view.scrollDOM.scrollLeft * view.scaleX;
  const baseTop = scroll.top - view.scrollDOM.scrollTop * view.scaleY;
  const content = view.contentDOM.getBoundingClientRect();
  return {
    left: (content.left - baseLeft) / view.scaleX,
    right: (content.right - baseLeft) / view.scaleX,
    /** A position's line, top and bottom, in the layers' coordinates. */
    block(from: number, to: number) {
      const offset = (view.documentTop - baseTop) / view.scaleY;
      return {
        top: offset + view.lineBlockAt(from).top,
        bottom: offset + view.lineBlockAt(to).bottom,
      };
    },
  };
}

const inDoc = (view: EditorView, p: MarginParagraph) =>
  p.from < p.to && p.to <= view.state.doc.length;

class Tint implements LayerMarker {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  constructor(left: number, top: number, width: number, height: number) {
    this.left = left;
    this.top = top;
    this.width = width;
    this.height = height;
  }
  draw() {
    const el = document.createElement("div");
    el.className = "cm-sm-tint";
    this.adjust(el);
    return el;
  }
  update(el: HTMLElement) {
    this.adjust(el);
    return true;
  }
  private adjust(el: HTMLElement) {
    el.style.left = `${this.left}px`;
    el.style.top = `${this.top}px`;
    el.style.width = `${this.width}px`;
    el.style.height = `${this.height}px`;
  }
  eq(o: Tint) {
    return (
      o.left === this.left &&
      o.top === this.top &&
      o.width === this.width &&
      o.height === this.height
    );
  }
}

/** The left column of a paragraph, or the numbers on its right: built once, then moved. */
class Placed implements LayerMarker {
  readonly key: string;
  readonly left: number;
  readonly top: number;
  readonly build: () => HTMLElement;
  constructor(key: string, left: number, top: number, build: () => HTMLElement) {
    this.key = key;
    this.left = left;
    this.top = top;
    this.build = build;
  }
  draw() {
    const el = this.build();
    el.dataset.key = this.key;
    this.move(el);
    return el;
  }
  update(el: HTMLElement, prev: Placed) {
    if (prev.key !== this.key) return false;
    this.move(el);
    return true;
  }
  private move(el: HTMLElement) {
    el.style.left = `${this.left}px`;
    el.style.top = `${this.top}px`;
  }
  eq(o: Placed) {
    return o.key === this.key && o.left === this.left && o.top === this.top;
  }
}

const el = (tag: string, className: string, text?: string) => {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** A sentence of 30 words or more fills the bars' height. */
const BARS = 40;
const barHeight = (words: number) => Math.max(4, Math.min(BARS, Math.round((words * BARS) / 30)));

function column(p: MarginParagraph) {
  const box = el("div", "cm-sm-col");
  if (p.label) box.appendChild(el("span", "cm-sm-fn", p.label));
  box.appendChild(el("span", "cm-sm-para", `¶${p.n}`));
  if (p.bars.length) {
    const bars = el("span", "cm-sm-bars");
    for (const w of p.bars.slice(0, 16)) {
      const b = el("i", "cm-sm-bar");
      b.style.height = `${barHeight(w)}px`;
      if (w <= 8) b.dataset.short = "true";
      bars.appendChild(b);
    }
    box.appendChild(bars);
  }
  return box;
}

function numbers(p: MarginParagraph) {
  const box = el("div", "cm-sm-nums");
  for (const c of p.cues) {
    const n = el("span", "cm-sm-n", String(c.n));
    n.dataset.cue = String(c.n);
    n.dataset.tone = c.tone;
    if (p.open === c.n) n.dataset.open = "true";
    box.appendChild(n);
  }
  return box;
}

const changed = (u: { docChanged: boolean; viewportChanged: boolean; geometryChanged: boolean }) =>
  u.docChanged || u.viewportChanged || u.geometryChanged;

export function styleMargin(onNumber?: (n: number) => void): Extension {
  return [
    field,
    // Under the text: the open cue's paragraph, tinted from the column to the numbers.
    layer({
      above: false,
      class: "cm-sm-under",
      update: (u) => changed(u) || u.startState.field(field, false) !== u.state.field(field, false),
      markers(view) {
        const f = frame(view);
        return view.state.field(field).flatMap((p) => {
          if (!p.open || !inDoc(view, p)) return [];
          const { top, bottom } = f.block(p.from, p.to);
          const left = f.left - NUMBERS - GAP - COLUMN - 6;
          return [
            new Tint(
              left,
              top - BLEED,
              f.right + RIGHT_GAP + NUMBER + 4 - left,
              bottom - top + 2 * BLEED,
            ),
          ];
        });
      },
    }),
    // Above the text, in the margins only: the column and the numbers.
    layer({
      above: true,
      class: "cm-sm-over",
      update: (u) => changed(u) || u.startState.field(field, false) !== u.state.field(field, false),
      markers(view) {
        const f = frame(view);
        const line = view.defaultLineHeight;
        return view.state.field(field).flatMap((p) => {
          if (!inDoc(view, p)) return [];
          const { top } = f.block(p.from, p.from);
          const key = (part: string) =>
            `${part}|${p.n}|${p.label ?? ""}|${p.bars.join(",")}|${p.open ?? ""}|${p.cues
              .map((c) => `${c.n}${c.tone}`)
              .join(",")}`;
          return [
            new Placed(key("col"), f.left - NUMBERS - GAP - COLUMN, top + 6, () => column(p)),
            ...(p.cues.length
              ? [
                  new Placed(key("num"), f.right + RIGHT_GAP, top + (line - NUMBER) / 2, () =>
                    numbers(p),
                  ),
                ]
              : []),
          ];
        });
      },
    }),
    ViewPlugin.define((view) => {
      // Caught before CodeMirror's own handlers, which would start a selection.
      const down = (e: MouseEvent) => {
        const n = (e.target as HTMLElement).closest?.(".cm-sm-n") as HTMLElement | null;
        if (!n || !onNumber) return;
        e.preventDefault();
        e.stopPropagation();
        onNumber(Number(n.dataset.cue));
      };
      view.dom.addEventListener("mousedown", down, true);
      return { destroy: () => view.dom.removeEventListener("mousedown", down, true) };
    }),
    EditorView.baseTheme({
      ".cm-sm-over": { pointerEvents: "none" },
      ".cm-sm-under": { pointerEvents: "none" },
    }),
  ];
}
