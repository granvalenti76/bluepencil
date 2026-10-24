import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import {
  ChangeSet,
  EditorSelection,
  EditorState,
  Facet,
  Prec,
  StateEffect,
  StateField,
  Transaction,
  findClusterBreak,
  type ChangeSpec,
  type EditorState as State,
  type Extension,
  type Line,
  type Range,
  type SelectionRange,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type Command,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

/**
 * Hidden syntax: the Markdown markers disappear and the text takes on the style, as in a word
 * processor. Rules:
 * - markers do not reappear when moving the cursor: the text never moves under the cursor. They
 *   show while being typed, until they form an element, and with "Show Markdown"; so do code
 *   block fences and the separator on the cursor's line;
 * - the cursor does not enter block prefixes (headings, lists, quotes), and Backspace at the
 *   start of the text removes the style;
 * - an arrow key always crosses a visible character: hidden markers are skipped;
 * - deleting a selection that cuts through an element keeps its markers, so the rest of the
 *   element keeps its style;
 * - "Show Markdown" (⌥⌘M) shows all the Markdown, with the same styles.
 */

export const setShowMarkdown = StateEffect.define<boolean>();

export const showMarkdownField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setShowMarkdown)) value = e.value;
    return value;
  },
});

export const toggleShowMarkdown: Command = (view) => {
  view.dispatch({ effects: setShowMarkdown.of(!view.state.field(showMarkdownField)) });
  return true;
};

const isShown = (state: State) => state.field(showMarkdownField, false) ?? false;

// --- Parsing ---------------------------------------------------------------------------------

const INLINE: Record<string, string> = {
  Emphasis: "cm-lp-em",
  StrongEmphasis: "cm-lp-strong",
  Strikethrough: "cm-lp-strike",
  InlineCode: "cm-lp-code",
  Link: "cm-lp-link",
};

type Tree = ReturnType<typeof syntaxTree>;
type Node = ReturnType<Tree["resolveInner"]>;

/** A footnote `[^n]` (the parser reads it as a link without an address). */
function isFootnote(state: State, node: { name: string; from: number; to: number }) {
  return node.name === "Link" && state.doc.sliceString(node.from, node.from + 2) === "[^";
}

/**
 * The `[^n]` label of a footnote, reference or definition. `[^1]: fatti.md` (a single term after
 * the colon) is read by the parser as a reference definition: the label is its LinkLabel.
 */
function footnoteLabel(state: State, ref: { name: string; from: number; to: number; node: Node }) {
  if (isFootnote(state, ref)) return { from: ref.from, to: ref.to };
  if (ref.name !== "LinkReference" || state.doc.sliceString(ref.from, ref.from + 2) !== "[^")
    return null;
  const label = ref.node.getChild("LinkLabel");
  return label ? { from: label.from, to: label.to } : null;
}

/** The markers of an inline element, in order. */
function inlineMarks(node: Node): [number, number][] {
  const out: [number, number][] = [];
  if (node.name === "Link") {
    const open = node.getChild("LinkMark");
    const close = node.getChildren("LinkMark")[1];
    if (open) out.push([node.from, open.to]);
    if (close) out.push([close.from, node.to]);
    return out;
  }
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === "EmphasisMark" || c.name === "StrikethroughMark" || c.name === "CodeMark")
      out.push([c.from, c.to]);
  }
  return out;
}

/** The element's text, between the markers. */
function inlineContent(node: Node): [number, number] {
  const marks = inlineMarks(node);
  if (marks.length < 2) return [node.from, node.to];
  return [marks[0]![1], marks[marks.length - 1]![0]];
}

const spacesAfter = (state: State, pos: number, max: number) => {
  let p = pos;
  while (p < max && state.doc.sliceString(p, p + 1) === " ") p++;
  return p;
};

/** A line's block prefix: where the text starts, and of what type. */
interface LineInfo {
  heading?: number;
  /** End of the hidden prefix (heading, quote, list indent). */
  prefixEnd?: number;
  quote?: number;
  list?: { depth: number; mark?: { from: number; to: number; text: string; ordered: boolean } };
  code?: "open" | "close" | "body";
}

function analyzeLines(state: State, from: number, to: number): Map<number, LineInfo> {
  const { doc } = state;
  const infos = new Map<number, LineInfo>();
  const info = (n: number) => {
    let i = infos.get(n);
    if (!i) infos.set(n, (i = {}));
    return i;
  };
  const first = doc.lineAt(from).number;
  const last = doc.lineAt(to).number;
  const eachLine = (a: number, b: number, fn: (n: number) => void) => {
    const s = Math.max(first, doc.lineAt(a).number);
    const e = Math.min(last, doc.lineAt(b).number);
    for (let n = s; n <= e; n++) fn(n);
  };
  const push = (n: number, end: number) => {
    const i = info(n);
    i.prefixEnd = Math.max(i.prefixEnd ?? 0, end);
  };

  syntaxTree(state).iterate({
    from: doc.line(first).from,
    to: doc.line(last).to,
    enter(ref) {
      const name = ref.name;
      if (name.startsWith("ATXHeading")) {
        const node = ref.node;
        const line = doc.lineAt(ref.from);
        const i = info(line.number);
        i.heading = Number(name.slice(10));
        const mark = node.firstChild;
        if (mark?.name === "HeaderMark" && mark.from === ref.from)
          push(line.number, spacesAfter(state, mark.to, ref.to));
        return false;
      }
      if (name === "Blockquote") {
        eachLine(ref.from, ref.to, (n) => (info(n).quote = (info(n).quote ?? 0) + 1));
      } else if (name === "QuoteMark") {
        const line = doc.lineAt(ref.from);
        push(line.number, ref.to + (doc.sliceString(ref.to, ref.to + 1) === " " ? 1 : 0));
      } else if (name === "ListItem") {
        let depth = 0;
        for (let p = ref.node.parent; p; p = p.parent)
          if (p.name === "BulletList" || p.name === "OrderedList") depth++;
        eachLine(ref.from, ref.to, (n) => (info(n).list = { depth }));
      } else if (name === "ListMark") {
        const line = doc.lineAt(ref.from);
        const ordered = ref.node.parent?.parent?.name === "OrderedList";
        info(line.number).list = {
          depth: info(line.number).list?.depth ?? 1,
          mark: { from: ref.from, to: ref.to, text: doc.sliceString(ref.from, ref.to), ordered },
        };
        push(line.number, spacesAfter(state, ref.to, line.to));
      } else if (name === "FencedCode") {
        const open = doc.lineAt(ref.from).number;
        const lastChild = ref.node.lastChild;
        const close =
          lastChild?.name === "CodeMark" && doc.lineAt(lastChild.from).number !== open
            ? doc.lineAt(lastChild.from).number
            : -1;
        eachLine(ref.from, ref.to, (n) => {
          info(n).code = n === open ? "open" : n === close ? "close" : "body";
        });
        return false;
      } else if (name === "CodeBlock") {
        eachLine(ref.from, ref.to, (n) => (info(n).code = "body"));
        return false;
      }
      return true;
    },
  });

  // Lines of a list item after the first: the indent is hidden, the text aligns.
  for (const [n, i] of infos) {
    if (!i.list || i.list.mark || i.code) continue;
    const line = doc.line(n);
    const ws = /^\s*/.exec(line.text)![0].length;
    if (ws > 0 && ws < line.length) push(n, line.from + ws);
  }
  return infos;
}

/** End of the line's hidden block prefix, if any (the cursor does not enter it). */
export function blockPrefixEnd(state: State, line: Line): number | null {
  if (line.length === 0) return null;
  const i = analyzeLines(state, line.from, line.to).get(line.number);
  return i?.prefixEnd !== undefined && i.prefixEnd > line.from ? i.prefixEnd : null;
}

// --- Decorations -----------------------------------------------------------------------------

class BulletWidget extends WidgetType {
  readonly text: string;
  constructor(text: string) {
    super();
    this.text = text;
  }
  override eq(other: BulletWidget) {
    return other.text === this.text;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-lp-bullet";
    el.textContent = this.text;
    return el;
  }
  override ignoreEvent() {
    return false;
  }
}

/** The type of a footnote at the end of the page: source file, web address, author's opinion. */
export type FootnoteKind = "file" | "web" | "estimate" | "note";

/** The "author's opinion" notes of the language packs (the app provides them). */
export const footnoteOpinions = Facet.define<string, readonly string[]>();

function footnoteKind(state: State, text: string): FootnoteKind {
  const t = text.trim();
  if (/^https?:\/\//i.test(t)) return "web";
  if (state.facet(footnoteOpinions).includes(t)) return "estimate";
  if (/^\S+\.[a-z0-9]{1,8}$/i.test(t)) return "file";
  return "note";
}

// Line icons, as in the text styles board: document, globe, person.
const KIND_ICON: Record<Exclude<FootnoteKind, "note">, string> = {
  file: '<path d="M6 3h9l3 3v15H6z"/><path d="M9 11h6M9 15h4"/>',
  web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  estimate: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/>',
};
const KIND_LABEL: Record<FootnoteKind, string> = {
  file: "Source file",
  web: "Web address",
  estimate: "Your estimate",
  note: "Note",
};

class FootnoteWidget extends WidgetType {
  readonly n: string;
  /** Only for the definition at the end of the page. */
  readonly kind: FootnoteKind | null;
  constructor(n: string, kind: FootnoteKind | null = null) {
    super();
    this.n = n;
    this.kind = kind;
  }
  override eq(other: FootnoteWidget) {
    return other.n === this.n && other.kind === this.kind;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-lp-fn";
    el.textContent = this.n;
    if (this.kind && this.kind !== "note") {
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("class", "cm-lp-fn-kind");
      icon.setAttribute("aria-label", KIND_LABEL[this.kind]);
      icon.setAttribute("role", "img");
      icon.innerHTML = KIND_ICON[this.kind];
      el.append(icon);
    }
    return el;
  }
  override ignoreEvent() {
    return false;
  }
}

class RuleWidget extends WidgetType {
  override eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-lp-rule";
    el.textContent = "⁂";
    return el;
  }
  override ignoreEvent() {
    return false;
  }
}

const hide = Decoration.replace({});
const syntaxMark = Decoration.mark({ class: "cm-lp-syntax" });
const lineClass = (cls: string) => Decoration.line({ class: cls });
const markClass = new Map(
  Object.entries(INLINE).map(([k, cls]) => [k, Decoration.mark({ class: cls })]),
);
const rule = new RuleWidget();

/** Cursor line: code block fences and the separator are visible there. */
const cursorLine = (state: State) => state.doc.lineAt(state.selection.main.head).number;

export interface Built {
  decos: Range<Decoration>[];
  /** Hidden ranges with nothing in their place: the cursor skips them. */
  hidden: Range<Decoration>[];
  /** Hidden plus those replaced by a sign (dash, footnote number): atomic. */
  atomic: Range<Decoration>[];
  /** Line classes, by line start. */
  lines: Map<number, string>;
}

/** The decorations of the lines touching `ranges`. Exported to measure off-screen lines. */
export function buildDecorations(
  state: State,
  ranges: readonly { from: number; to: number }[],
  show: boolean,
  /** Cursor line, or `null` to measure without a cursor. */
  revealLine: number | null,
): Built {
  const { doc } = state;
  const out: Built = { decos: [], hidden: [], atomic: [], lines: new Map() };
  const addLineClass = (pos: number, cls: string) => {
    out.decos.push(lineClass(cls).range(pos));
    const prev = out.lines.get(pos);
    out.lines.set(pos, prev ? `${prev} ${cls}` : cls);
  };
  const hideRange = (from: number, to: number) => {
    if (to <= from) return;
    if (show) {
      out.decos.push(syntaxMark.range(from, to));
      return;
    }
    const r = hide.range(from, to);
    out.decos.push(r);
    out.hidden.push(r);
    out.atomic.push(r);
  };
  const replaceWith = (from: number, to: number, widget: WidgetType) => {
    if (show) {
      out.decos.push(syntaxMark.range(from, to));
      return;
    }
    const r = Decoration.replace({ widget }).range(from, to);
    out.decos.push(r);
    out.atomic.push(r);
  };
  let lastLine = -1;
  for (const range of ranges) {
    const fromLine = Math.max(doc.lineAt(range.from).number, lastLine + 1);
    const toLine = doc.lineAt(range.to).number;
    if (fromLine > toLine) continue;
    lastLine = toLine;
    const from = doc.line(fromLine).from;
    const to = doc.line(toLine).to;
    const infos = analyzeLines(state, from, to);

    for (let n = fromLine; n <= toLine; n++) {
      const line = doc.line(n);
      const i = infos.get(n);
      const cls: string[] = [];
      if (line.length === 0 && i?.code !== "body") cls.push("cm-blank");
      if (i?.heading) cls.push(`cm-lp-h${Math.min(i.heading, 3)}`);
      if (i?.quote) cls.push("cm-lp-quote");
      if (i?.code === "body") cls.push("cm-lp-codeblock");
      if (i?.code === "open" || i?.code === "close")
        cls.push("cm-lp-codeblock", "cm-lp-fence", `cm-lp-fence-${i.code}`);
      if (i?.list && line.length > 0)
        cls.push(i.list.mark ? "cm-lp-li" : "cm-lp-li-cont", `cm-lp-d${Math.min(i.list.depth, 4)}`);
      if (i?.list?.mark?.ordered) cls.push("cm-lp-ol");
      if (i?.quote && /^\s*(—|--)\s/.test(line.text.slice((i.prefixEnd ?? line.from) - line.from)))
        cls.push("cm-lp-quote-attr");
      if (cls.length) addLineClass(line.from, cls.join(" "));

      if (i?.code === "open" || i?.code === "close") {
        if (revealLine !== n) hideRange(line.from, line.to);
        continue;
      }
      if (i?.list?.mark) {
        const m = i.list.mark;
        hideRange(line.from, m.from);
        replaceWith(m.from, i.prefixEnd ?? m.to, new BulletWidget(m.ordered ? m.text : "–"));
      } else if (i?.prefixEnd !== undefined) {
        hideRange(line.from, i.prefixEnd);
      }
    }

    syntaxTree(state).iterate({
      from,
      to,
      enter(ref) {
        const name = ref.name;
        if (name === "FencedCode" || name === "CodeBlock") return false;
        if (name.startsWith("ATXHeading")) {
          // Optional closing `## Heading ##`
          const close = ref.node.lastChild;
          if (close?.name === "HeaderMark" && close.from > ref.from + 1) {
            let start = close.from;
            while (start > ref.from && doc.sliceString(start - 1, start) === " ") start--;
            hideRange(start, ref.to);
          }
          return true;
        }
        if (name === "HorizontalRule") {
          const line = doc.lineAt(ref.from);
          addLineClass(line.from, "cm-lp-hr");
          if (revealLine !== line.number) replaceWith(ref.from, ref.to, rule);
          return false;
        }
        if (name === "Comment") {
          hideRange(ref.from, ref.to);
          return false;
        }
        const fn = footnoteLabel(state, ref);
        if (fn) {
          const line = doc.lineAt(fn.from);
          const n = doc.sliceString(fn.from + 2, fn.to - 1);
          const def = fn.from === line.from && doc.sliceString(fn.to, fn.to + 1) === ":";
          if (def) {
            // "Notes and sources": a heading before the first footnote at the end of the page.
            let above = line.number - 1;
            while (above > 0 && doc.line(above).length === 0) above--;
            const first = above === 0 || !/^\[\^[^\]]+\]:/.test(doc.line(above).text);
            addLineClass(line.from, first ? "cm-lp-fn-def cm-lp-fn-first" : "cm-lp-fn-def");
          }
          const kind = def ? footnoteKind(state, doc.sliceString(fn.to + 1, line.to)) : null;
          replaceWith(fn.from, def ? fn.to + 1 : fn.to, new FootnoteWidget(n, kind));
          return false;
        }
        const deco = markClass.get(name);
        if (!deco) return true;
        if (ref.to > ref.from) out.decos.push(deco.range(ref.from, ref.to));
        for (const [a, b] of inlineMarks(ref.node)) hideRange(a, b);
        return name !== "InlineCode";
      },
    });
  }
  return out;
}

class LivePreview {
  decorations: DecorationSet;
  hidden: DecorationSet = Decoration.none;
  atomic: DecorationSet = Decoration.none;

  constructor(view: EditorView) {
    this.decorations = this.compute(view);
  }

  update(u: ViewUpdate) {
    if (
      u.docChanged ||
      u.viewportChanged ||
      syntaxTree(u.state) !== syntaxTree(u.startState) ||
      isShown(u.state) !== isShown(u.startState) ||
      cursorLine(u.state) !== cursorLine(u.startState)
    ) {
      this.decorations = this.compute(u.view);
    }
  }

  private compute(view: EditorView): DecorationSet {
    const { state } = view;
    const built = buildDecorations(state, view.visibleRanges, isShown(state), cursorLine(state));
    this.hidden = Decoration.set(built.hidden, true);
    this.atomic = Decoration.set(built.atomic, true);
    return Decoration.set(built.decos, true);
  }
}

const livePlugin = ViewPlugin.fromClass(LivePreview, { decorations: (v) => v.decorations });

const hiddenOf = (view: EditorView) => view.plugin(livePlugin)?.hidden ?? Decoration.none;

/** End (or start, backwards) of the chain of hidden ranges starting at `pos`. */
function hiddenRun(set: DecorationSet, pos: number, forward: boolean): number {
  for (let moved = true; moved;) {
    moved = false;
    set.between(pos - 1, pos + 1, (from, to) => {
      if (forward && from === pos && to > pos) {
        pos = to;
        moved = true;
        return false;
      }
      if (!forward && to === pos && from < pos) {
        pos = from;
        moved = true;
        return false;
      }
      return undefined;
    });
  }
  return pos;
}

/** `[a, b]` is entirely hidden: moving over it is not visible. */
function allHidden(set: DecorationSet, a: number, b: number): boolean {
  let pos = a;
  set.between(a, b, (from, to) => {
    if (from <= pos && to > pos) pos = to;
  });
  return pos >= b;
}

// --- Cursor ----------------------------------------------------------------------------------

/** A step of one visible character: hidden markers are crossed without dead key presses. */
function visibleStep(view: EditorView, start: SelectionRange, forward: boolean): SelectionRange {
  const hidden = hiddenOf(view);
  const { state } = view;
  let cur = EditorSelection.cursor(start.head, start.assoc);
  for (;;) {
    const next = view.moveByChar(cur, forward);
    if (next.head === cur.head) return cur;
    // Inside a block prefix (dash, `## `): forwards goes to the text, backwards skips it.
    const line = state.doc.lineAt(next.head);
    const end = next.head - line.from <= 40 ? blockPrefixEnd(state, line) : null;
    if (end !== null && next.head < end) {
      if (forward || line.from === 0) return EditorSelection.cursor(end);
      cur = EditorSelection.cursor(line.from);
      continue;
    }
    const done = !allHidden(hidden, Math.min(cur.head, next.head), Math.max(cur.head, next.head));
    cur = next;
    if (done) return cur;
  }
}

function arrow(forward: boolean, extend: boolean): Command {
  return (view) => {
    if (isShown(view.state)) return false;
    const sel = view.state.selection;
    if (!extend && sel.ranges.some((r) => !r.empty)) return false;
    const ranges = sel.ranges.map((r) => {
      const moved = visibleStep(view, r, forward);
      return extend ? EditorSelection.range(r.anchor, moved.head) : moved;
    });
    view.dispatch({
      selection: EditorSelection.create(ranges, sel.mainIndex),
      scrollIntoView: true,
      userEvent: "select",
    });
    return true;
  };
}

/** The cursor is never inside a hidden block prefix: it goes to the start of the text. */
const keepOutOfPrefixes = EditorState.transactionFilter.of((tr) => {
  if (tr.docChanged || !tr.selection || isShown(tr.startState)) return tr;
  const state = tr.startState;
  let changed = false;
  const ranges = tr.selection.ranges.map((r) => {
    const line = state.doc.lineAt(r.head);
    if (r.head - line.from > 40) return r;
    const end = blockPrefixEnd(state, line);
    if (end === null || r.head >= end) return r;
    changed = true;
    return r.empty ? EditorSelection.cursor(end) : EditorSelection.range(r.anchor, end);
  });
  if (!changed) return tr;
  return [
    tr,
    { selection: EditorSelection.create(ranges, tr.selection.mainIndex), sequential: true },
  ];
});

// --- Deleting --------------------------------------------------------------------------------

/** If the inline element would be left empty, it is removed with its markers. */
function widenToEmptied(state: State, from: number, to: number): [number, number] {
  for (let n: Node | null = syntaxTree(state).resolveInner(from, 1); n; n = n.parent) {
    if (!INLINE[n.name] || isFootnote(state, n)) continue;
    const [a, b] = inlineContent(n);
    if (a >= from && b <= to && n.from <= from && n.to >= to) return [n.from, n.to];
  }
  return [from, to];
}

function deleteVisible(forward: boolean): Command {
  return (view) => {
    const { state } = view;
    if (isShown(state)) return false;
    const sel = state.selection.main;
    if (!sel.empty || state.selection.ranges.length > 1) return false;
    const head = sel.head;
    const line = state.doc.lineAt(head);

    if (!forward) {
      // At the start of a heading: Backspace removes the heading (as in a word processor).
      const info = analyzeLines(state, line.from, line.to).get(line.number);
      if (info?.heading && info.prefixEnd === head) {
        view.dispatch({
          changes: { from: line.from, to: head },
          userEvent: "delete.backward",
          scrollIntoView: true,
        });
        return true;
      }
    } else if (head === line.to && line.number < state.doc.lines) {
      // At the end of a line, Delete joins the next line without keeping its prefix.
      const next = state.doc.line(line.number + 1);
      const end = blockPrefixEnd(state, next);
      if (end !== null) {
        view.dispatch({ changes: { from: head, to: end }, userEvent: "delete.forward" });
        return true;
      }
    }

    const hidden = hiddenOf(view);
    const edge = hiddenRun(hidden, head, forward);
    if (edge === head) return false;
    let from: number;
    let to: number;
    if (forward) {
      const lineAtEdge = state.doc.lineAt(edge);
      from = edge;
      to =
        edge === lineAtEdge.to
          ? Math.min(edge + 1, state.doc.length)
          : findClusterBreak(lineAtEdge.text, edge - lineAtEdge.from, true) + lineAtEdge.from;
    } else {
      const lineAtEdge = state.doc.lineAt(edge);
      to = edge;
      from =
        edge === lineAtEdge.from
          ? Math.max(edge - 1, 0)
          : findClusterBreak(lineAtEdge.text, edge - lineAtEdge.from, false) + lineAtEdge.from;
    }
    if (from === to) return false;
    [from, to] = widenToEmptied(state, from, to);
    view.dispatch({
      changes: { from, to },
      selection: { anchor: forward ? head : head - (to - from) },
      userEvent: forward ? "delete.forward" : "delete.backward",
      scrollIntoView: true,
    });
    return true;
  };
}

/** Enter at the start of a heading: a blank line above, the heading stays a heading. */
const enterBeforeHeading: Command = (view) => {
  const { state } = view;
  if (isShown(state) || state.selection.ranges.length > 1) return false;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  const info = analyzeLines(state, line.from, line.to).get(line.number);
  if (!info?.heading || info.prefixEnd !== sel.head || sel.head === line.to) return false;
  view.dispatch({
    changes: { from: line.from, insert: "\n" },
    selection: { anchor: sel.head + 1 },
    userEvent: "input",
    scrollIntoView: true,
  });
  return true;
};

/**
 * Deleting (or typing over) a selection that cuts through an inline element: the element's
 * markers stay, otherwise the rest would lose its style and loose `**` would appear.
 */
const keepCutMarks = EditorState.transactionFilter.of((tr) => {
  if (
    !tr.docChanged ||
    isShown(tr.startState) ||
    !(tr.isUserEvent("delete") || tr.isUserEvent("input.type") || tr.isUserEvent("input.paste")) ||
    tr.isUserEvent("input.type.compose")
  )
    return tr;
  const state = tr.startState;
  const changes: ChangeSpec[] = [];
  let altered = false;
  let cursorFrom = state.selection.main.from;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (toA <= fromA) {
      changes.push({ from: fromA, insert: inserted });
      return;
    }
    let [a, b] = [fromA, toA];
    if (inserted.length === 0) [a, b] = widenToEmptied(state, a, b);
    const keep: [number, number][] = [];
    syntaxTree(state).iterate({
      from: a,
      to: b,
      enter(ref) {
        if (!INLINE[ref.name] || isFootnote(state, ref)) return true;
        if (ref.from >= a && ref.to <= b) return false;
        for (const [m0, m1] of inlineMarks(ref.node)) if (m0 >= a && m1 <= b) keep.push([m0, m1]);
        return true;
      },
    });
    if (keep.length === 0 && a === fromA && b === toA) {
      changes.push({ from: fromA, to: toA, insert: inserted });
      return;
    }
    altered = true;
    if (fromA <= state.selection.main.from && state.selection.main.from <= toA) cursorFrom = a;
    keep.sort((x, y) => x[0] - y[0]);
    let pos = a;
    changes.push({ from: a, insert: inserted });
    for (const [m0, m1] of keep) {
      if (m0 > pos) changes.push({ from: pos, to: m0 });
      pos = Math.max(pos, m1);
    }
    if (b > pos) changes.push({ from: pos, to: b });
  });
  if (!altered) return tr;
  const set = ChangeSet.of(changes, state.doc.length);
  const userEvent = tr.annotation(Transaction.userEvent);
  return {
    changes: set,
    selection: EditorSelection.cursor(set.mapPos(cursorFrom, 1)),
    effects: tr.effects,
    scrollIntoView: tr.scrollIntoView,
    ...(userEvent ? { userEvent } : {}),
  };
});

// Text styles from the text styles board: sizes in em on the 21 px body, colours from the tokens.
const theme = EditorView.baseTheme({
  // Title 36/50, Heading 26/40, Subheading 17/30 spaced capitals.
  ".cm-line.cm-lp-h1": {
    fontSize: "1.714em",
    lineHeight: "1.389",
    fontWeight: "500",
    paddingTop: "0.1em",
  },
  ".cm-line.cm-lp-h2": {
    fontSize: "1.238em",
    lineHeight: "1.538",
    fontWeight: "500",
    paddingTop: "0.2em",
  },
  ".cm-line.cm-lp-h3": {
    fontSize: "0.81em",
    lineHeight: "1.765",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "var(--text-2)",
  },
  ".cm-lp-strong": { fontWeight: "600" },
  ".cm-lp-em": { fontStyle: "italic" },
  ".cm-lp-strike": { textDecorationLine: "line-through" },
  ".cm-lp-code": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.762em",
    backgroundColor: "var(--code-bg)",
    borderRadius: "0.25em",
    padding: "0.06em 0.3em",
  },
  // The link has the ink colour: blue belongs to the editor.
  ".cm-lp-link": {
    textDecorationLine: "underline",
    textDecorationColor: "var(--underline)",
    textDecorationThickness: "1px",
    textUnderlineOffset: "0.19em",
  },
  ".cm-lp-syntax": { color: "var(--text-faint)" },
  ".cm-lp-syntax .cm-lp-code, .cm-lp-code .cm-lp-syntax": { backgroundColor: "transparent" },
  // List dashes and numbers in a 32 px column: hanging indent.
  ".cm-lp-bullet": {
    display: "inline-block",
    width: "1.524em",
    textIndent: "0",
    color: "var(--text-faint)",
    fontVariantNumeric: "oldstyle-nums",
  },
  ".cm-line.cm-lp-ol .cm-lp-bullet": { color: "var(--text-muted)" },
  ".cm-line.cm-lp-li": { textIndent: "-1.524em" },
  ".cm-line.cm-lp-d1": { paddingLeft: "1.524em" },
  ".cm-line.cm-lp-d2": { paddingLeft: "3.048em" },
  ".cm-line.cm-lp-d3": { paddingLeft: "4.572em" },
  ".cm-line.cm-lp-d4": { paddingLeft: "6.096em" },
  // Quote: italic with a rule; the line starting with "—" is the attribution.
  ".cm-line.cm-lp-quote": {
    boxShadow: "inset 2px 0 var(--border-strong)",
    paddingLeft: "1.333em",
    fontStyle: "italic",
    color: "var(--text-2)",
  },
  ".cm-line.cm-lp-quote-attr": {
    fontSize: "0.81em",
    lineHeight: "2",
    fontStyle: "normal",
    color: "var(--text-muted)",
  },
  // Code block: JetBrains Mono 15/30 on dark paper, rounded corners at the top and bottom.
  ".cm-line.cm-lp-codeblock": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.714em",
    lineHeight: "2",
    backgroundColor: "var(--code-bg)",
    padding: "0 1.2em",
  },
  ".cm-line.cm-lp-fence-open": { borderRadius: "0.4em 0.4em 0 0" },
  ".cm-line.cm-lp-fence-close": { borderRadius: "0 0 0.4em 0.4em" },
  ".cm-lp-fn": {
    position: "relative",
    top: "-0.55em",
    padding: "0 0.1em",
    fontSize: "0.62em",
    color: "var(--text-muted)",
    cursor: "pointer",
  },
  ".cm-line.cm-lp-fn-def": { fontSize: "0.857em" },
  ".cm-line.cm-lp-fn-def .cm-lp-fn": {
    position: "static",
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4em",
    minWidth: "1.3em",
    marginRight: "0.4em",
    padding: "0",
    fontSize: "1em",
  },
  ".cm-lp-fn-kind": {
    width: "0.8em",
    height: "0.8em",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
  // "Notes and sources": the heading of the footnotes at the end of the page.
  ".cm-line.cm-lp-fn-first::before": {
    content: '"Notes and sources"',
    display: "block",
    marginTop: "0.6em",
    fontSize: "0.78em",
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  },
  ".cm-lp-rule": {
    display: "inline-block",
    width: "100%",
    textAlign: "center",
    fontSize: "0.762em",
    letterSpacing: "0.6em",
    color: "var(--underline)",
  },
});

/**
 * Hidden syntax. Includes the Markdown language: HTML comments (`<!-- section: … -->`) are
 * inline, not blocks, so the paragraph that follows them stays a paragraph with its styles.
 */
export function livePreview(): Extension {
  return [
    markdown({ base: markdownLanguage, extensions: [{ remove: ["HTMLBlock"] }] }),
    showMarkdownField,
    livePlugin,
    EditorView.atomicRanges.of((view) => view.plugin(livePlugin)?.atomic ?? Decoration.none),
    keepOutOfPrefixes,
    keepCutMarks,
    Prec.high(
      keymap.of([
        { key: "Mod-Alt-m", run: toggleShowMarkdown, preventDefault: true },
        { key: "ArrowLeft", run: arrow(false, false), shift: arrow(false, true) },
        { key: "ArrowRight", run: arrow(true, false), shift: arrow(true, true) },
        { key: "Backspace", run: deleteVisible(false) },
        { key: "Delete", run: deleteVisible(true) },
        { key: "Enter", run: enterBeforeHeading },
      ]),
    ),
    theme,
  ];
}
