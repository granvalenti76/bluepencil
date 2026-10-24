import { RangeSet, StateEffect, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, layer, type LayerMarker } from "@codemirror/view";
import { frontMatterLines } from "./frontMatter.ts";
import { buildDecorations, setShowMarkdown, showMarkdownField } from "./livePreview.ts";

/**
 * Numbers on the page's lines: every line as it appears, including wrapped ones; blank lines
 * between paragraphs are not numbered; the cursor line's number is darker. With "Show Markdown"
 * the file's line numbers come back.
 *
 * Lines in view are counted from the DOM (the text's rectangles grouped by line). Those out of
 * view do not exist in CodeMirror's DOM: they are counted once in a hidden mirror with the same
 * classes and width, and remembered by text. The page width is fixed, so the count changes only
 * with the text, the typeface ("Handwriting") or its size.
 */

const refresh = StateEffect.define<null>();

interface Box {
  top: number;
  bottom: number;
}

/** The visual lines of a line element, top to bottom (client coordinates). */
function visualLines(el: HTMLElement): Box[] {
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = Array.from(range.getClientRects())
    .filter((r) => r.width > 0.5 && r.height > 0)
    .sort((a, b) => a.top - b.top);
  const out: Box[] = [];
  for (const r of rects) {
    const last = out[out.length - 1];
    // A superscript or a taller mark sits on the same line: the centre counts, not the edge.
    if (last && (r.top + r.bottom) / 2 < last.bottom) {
      last.top = Math.min(last.top, r.top);
      last.bottom = Math.max(last.bottom, r.bottom);
    } else out.push({ top: r.top, bottom: r.bottom });
  }
  return out;
}

/** Code block fences and the ⁂ separator are not lines of text. */
const unnumbered = (classes: string) => /\bcm-lp-(fence|hr)\b/.test(classes);

class Num implements LayerMarker {
  readonly text: string;
  readonly left: number;
  readonly top: number;
  readonly active: boolean;
  constructor(text: string, left: number, top: number, active: boolean) {
    this.text = text;
    this.left = left;
    this.top = top;
    this.active = active;
  }
  draw() {
    const el = document.createElement("div");
    this.adjust(el);
    return el;
  }
  update(el: HTMLElement) {
    this.adjust(el);
    return true;
  }
  private adjust(el: HTMLElement) {
    el.className = this.active ? "cm-vln cm-vln-active" : "cm-vln";
    el.textContent = this.text;
    el.style.left = `${this.left}px`;
    el.style.top = `${this.top}px`;
  }
  eq(other: Num) {
    return (
      other.text === this.text &&
      other.left === this.left &&
      other.top === this.top &&
      other.active === this.active
    );
  }
}

const GAP = 24;
const WIDTH = 40;

class Counter {
  /** Visual lines by line text: the text includes the markers, hence the style. */
  private cache = new Map<string, number>();
  private widthKey = "";
  private timer = 0;
  private waitingFonts = false;
  /** The page's typefaces already loaded (they change with "Handwriting"). */
  private fontsFor = "";
  private fontsLoading = false;
  private destroyed = false;
  private readonly onFonts = () => this.reset();

  readonly view: EditorView;

  constructor(view: EditorView) {
    this.view = view;
    document.fonts.addEventListener("loadingdone", this.onFonts);
    document.fonts.addEventListener("loadingerror", this.onFonts);
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.timer);
    document.fonts.removeEventListener("loadingdone", this.onFonts);
    document.fonts.removeEventListener("loadingerror", this.onFonts);
  }

  /**
   * All the variants of the page's typefaces (italic, code) before counting: an off-screen line is
   * counted only with the real typeface, and WebKit reports as ready an italic never requested.
   * Called in the measure phase, when the editor is in the page and has its styles.
   */
  private loadFonts(): boolean {
    const cs = getComputedStyle(this.view.scrollDOM);
    const families = `${cs.fontFamily} ${cs.getPropertyValue("--font-mono")}`;
    if (this.fontsFor === families) return true;
    if (this.fontsLoading) return false;
    this.fontsLoading = true;
    const loads: Promise<unknown>[] = [];
    document.fonts.forEach((f) => {
      if (families.includes(f.family.replace(/"/g, ""))) loads.push(f.load().catch(() => {}));
    });
    void Promise.all(loads).then(() => {
      this.fontsLoading = false;
      this.fontsFor = families;
      this.reset();
    });
    return false;
  }

  private reset() {
    if (this.destroyed) return;
    this.cache.clear();
    this.widthKey = "";
    this.view.dispatch({ effects: refresh.of(null) });
  }

  /** Width of the lines. */
  private lineWidth(): number {
    const cs = getComputedStyle(this.view.contentDOM);
    return (
      this.view.contentDOM.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    );
  }

  /** Measure phase of the layer: reads the DOM and returns the numbers to draw. */
  markers(): LayerMarker[] {
    const { view } = this;
    const { state } = view;
    const show = state.field(showMarkdownField, false) ?? false;
    const skip = state.facet(frontMatterLines);
    // Lines measured with a fallback typeface are no longer valid once the real one arrives.
    let loaded = 0;
    document.fonts.forEach((f) => void (f.status === "loaded" && loaded++));
    const content = getComputedStyle(view.contentDOM);
    const widthKey = `${this.lineWidth()}|${content.fontSize}|${content.fontFamily}|${loaded}`;
    if (widthKey !== this.widthKey) {
      this.cache.clear();
      this.widthKey = widthKey;
    }

    const scroll = view.scrollDOM.getBoundingClientRect();
    const baseLeft = scroll.left - view.scrollDOM.scrollLeft * view.scaleX;
    const baseTop = scroll.top - view.scrollDOM.scrollTop * view.scaleY;
    const left =
      (view.contentDOM.getBoundingClientRect().left - baseLeft) / view.scaleX - GAP - WIDTH;
    const head = state.selection.main.head;
    const headLine = state.doc.lineAt(head).number;
    const caret = view.coordsAtPos(head, state.selection.main.assoc || 1);
    const caretMid = caret ? (caret.top + caret.bottom) / 2 : null;

    // The lines drawn by CodeMirror, measured.
    const rendered = new Map<number, Box[]>();
    for (const el of Array.from(view.contentDOM.children) as HTMLElement[]) {
      if (!el.classList.contains("cm-line")) continue;
      const line = state.doc.lineAt(view.posAtDOM(el, 0));
      if (line.number <= skip) continue;
      const boxes = line.length === 0 || unnumbered(el.className) ? [] : visualLines(el);
      rendered.set(line.number, boxes);
      // The cursor line may show its markers: this does not apply to copies elsewhere.
      if (line.number !== headLine && !show) this.cache.set(line.text, boxes.length);
    }

    const out: LayerMarker[] = [];
    const place = (text: string, box: Box, active: boolean) => {
      const mid = (box.top + box.bottom) / 2 - baseTop;
      out.push(new Num(text, left, mid / view.scaleY, active));
    };
    const lastRendered = Math.max(0, ...rendered.keys());

    if (show) {
      for (const [n, boxes] of rendered) {
        if (boxes[0]) place(String(n - skip), boxes[0], n === headLine);
      }
      this.setPending(false);
      return out;
    }

    let count = 0;
    // With a typeface still arriving the lines will change: redraw as soon as it is ready.
    const fontsReady = this.loadFonts();
    let missing = !fontsReady || document.fonts.status !== "loaded";
    if (missing && !this.waitingFonts) {
      this.waitingFonts = true;
      void document.fonts.ready.then(() => {
        this.waitingFonts = false;
        this.reset();
      });
    }
    for (let n = skip + 1; n <= lastRendered; n++) {
      const boxes = rendered.get(n);
      if (boxes) {
        boxes.forEach((box, i) => {
          const active = caretMid !== null && caretMid >= box.top && caretMid <= box.bottom;
          place(String(count + i + 1), box, active && n === headLine);
        });
        count += boxes.length;
        continue;
      }
      const line = state.doc.line(n);
      if (line.length === 0) continue;
      const known = this.cache.get(line.text);
      if (known === undefined) {
        missing = true;
        count += Math.max(
          1,
          Math.round(view.lineBlockAt(line.from).height / view.defaultLineHeight),
        );
      } else count += known;
    }
    this.setPending(missing);
    if (missing && fontsReady && !this.waitingFonts) this.schedule();
    return out;
  }

  private setPending(pending: boolean) {
    const el = this.view.dom.querySelector<HTMLElement>(".cm-vln-layer");
    if (el) el.dataset.pending = String(pending);
  }

  private schedule() {
    if (this.timer) return;
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      if (this.destroyed) return;
      if (document.fonts.status !== "loaded") {
        void document.fonts.ready.then(() => this.schedule());
        return;
      }
      if (this.measureOffscreen()) this.view.dispatch({ effects: refresh.of(null) });
    }, 30);
  }

  /** Counts the missing off-screen lines, in batches so as not to stall the page. */
  private measureOffscreen(): boolean {
    const { state } = this.view;
    const skip = state.facet(frontMatterLines);
    const todo: number[] = [];
    for (let n = skip + 1; n <= state.doc.lines && todo.length < 400; n++) {
      const line = state.doc.line(n);
      if (line.length > 0 && !this.cache.has(line.text)) todo.push(n);
    }
    if (todo.length === 0) return false;
    const counts = mirrorLineCounts(this.view, todo);
    if (!counts) {
      this.schedule();
      return false;
    }
    todo.forEach((n, i) => this.cache.set(state.doc.line(n).text, counts[i]!));
    return true;
  }
}

/**
 * Visual lines of the file's `lines`, measured in a hidden mirror with the classes and width of
 * the real lines (only the hidden-syntax decorations, not the notes). `null` if a typeface not yet
 * loaded is needed (italic, code): it is loaded and retried.
 */
export function mirrorLineCounts(view: EditorView, lines: number[]): number[] | null {
  const { state } = view;
  const cs = getComputedStyle(view.contentDOM);
  const mirror = document.createElement("div");
  mirror.className = "cm-vln-mirror cm-lineWrapping";
  mirror.style.width = `${
    view.contentDOM.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
  }px`;
  mirror.setAttribute("aria-hidden", "true");

  const els = lines.map((n) => {
    const line = state.doc.line(n);
    const built = buildDecorations(state, [line], false, null);
    const classes = built.lines.get(line.from) ?? "";
    if (line.length === 0 || unnumbered(classes)) return null;
    const el = document.createElement("div");
    el.className = `cm-line ${classes}`;
    RangeSet.spans([Decoration.set(built.decos, true)], line.from, line.to, {
      span: (from, to, active) => {
        const text = document.createTextNode(state.doc.sliceString(from, to));
        const cls = active.map((d) => d.spec.class as string | undefined).filter(Boolean);
        if (cls.length === 0) el.appendChild(text);
        else {
          const span = document.createElement("span");
          span.className = cls.join(" ");
          span.appendChild(text);
          el.appendChild(span);
        }
      },
      point: (_from, _to, deco) => {
        if (deco.spec.widget && !deco.spec.block) el.appendChild(deco.spec.widget.toDOM(view));
      },
    });
    mirror.appendChild(el);
    return el;
  });
  view.scrollDOM.appendChild(mirror);
  // A typeface used only off-screen has not been requested yet: measuring now would give the
  // fallback typeface's lines.
  const fonts = new Set<string>();
  for (const el of Array.from(mirror.querySelectorAll<HTMLElement>("*"))) {
    // Built by hand: WebKit does not return the computed `font` shorthand.
    const cs = getComputedStyle(el);
    const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    if (!document.fonts.check(font)) fonts.add(font);
  }
  const counts = fonts.size ? null : els.map((el) => (el ? visualLines(el).length : 0));
  mirror.remove();
  if (fonts.size) void Promise.all([...fonts].map((f) => document.fonts.load(f)));
  return counts;
}

const counter = ViewPlugin.fromClass(Counter);

const theme = EditorView.baseTheme({
  ".cm-vln-layer": { pointerEvents: "none" },
  ".cm-vln": {
    width: `${WIDTH}px`,
    height: "1em",
    marginTop: "-0.5em",
    textAlign: "right",
    // From the page, not the text: with "Handwriting" the numbers stay in EB Garamond.
    fontFamily: "var(--font-text)",
    fontSize: "calc(var(--text-size) * 2 / 3)",
    lineHeight: "1",
    color: "var(--line-number)",
    fontVariantNumeric: "oldstyle-nums",
    whiteSpace: "nowrap",
  },
  ".cm-vln-active": { color: "var(--text)", fontWeight: "600" },
  ".cm-vln-mirror": {
    position: "absolute",
    top: "0",
    left: "0",
    visibility: "hidden",
  },
});

/** Visual line numbers, to the left of the text. */
export function visualLineNumbers(): Extension {
  return [
    counter,
    layer({
      above: false,
      class: "cm-vln-layer",
      update: (u) =>
        u.docChanged ||
        u.viewportChanged ||
        u.geometryChanged ||
        u.selectionSet ||
        u.transactions.some((tr) => tr.effects.some((e) => e.is(refresh) || e.is(setShowMarkdown))),
      markers: (view) => view.plugin(counter)?.markers() ?? [],
    }),
    theme,
  ];
}
