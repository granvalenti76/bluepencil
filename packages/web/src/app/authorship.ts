import { create } from "zustand";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { countWords, relocateAnchor } from "@desk/core";
import {
  authorshipField,
  setAuthored,
  showAuthored,
  type AuthoredRange,
} from "../editor/authorship.ts";
import { getToken } from "./api.ts";
import { useDoc } from "./docStore.ts";

/** A stretch as stored in the file next to the draft (server: routes/authorship.ts). */
interface StoredSpan {
  quote: string;
  prefix: string;
  suffix: string;
  from: number;
  words: number;
  source: string;
}

interface AuthorshipState {
  path: string | null;
  /** Words still identical to how the model proposed them. */
  authoredWords: number;
  /** Saved stretches no longer found in the text: they do not count as the author's. */
  lost: StoredSpan[];
  show: boolean;
  set: (patch: Partial<AuthorshipState>) => void;
}

export const useAuthorship = create<AuthorshipState>()((set) => ({
  path: null,
  authoredWords: 0,
  lost: [],
  show: false,
  set: (patch) => set(patch),
}));

const CONTEXT = 32;
const enc = (path: string) => path.split("/").map(encodeURIComponent).join("/");
const headers = () => ({ "X-Desk-Token": getToken() ?? "", "Content-Type": "application/json" });

/** The author's words over the total, rounded down: the figure is never more flattering than the truth. */
export function writtenByYou(total: number, authored: number, lost: number): number {
  if (total <= 0) return 100;
  return Math.max(0, Math.floor(((total - authored - lost) / total) * 100));
}

let timer: ReturnType<typeof setTimeout> | undefined;

function spansOf(view: EditorView): StoredSpan[] {
  const { bodyOffset } = useDoc.getState();
  const doc = view.state.doc;
  return view.state.field(authorshipField).ranges.map((r) => {
    const quote = doc.sliceString(r.from, r.to);
    return {
      quote,
      prefix: doc.sliceString(Math.max(0, r.from - CONTEXT), r.from),
      suffix: doc.sliceString(r.to, r.to + CONTEXT),
      from: r.from - bodyOffset,
      words: countWords(quote),
      source: r.source,
    };
  });
}

async function save(view: EditorView, path: string) {
  if (useAuthorship.getState().path !== path) return;
  const spans = [...spansOf(view), ...useAuthorship.getState().lost];
  await fetch(`/api/authorship/${enc(path)}`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify({ spans }),
  }).catch(() => {
    /* the next save tries again */
  });
}

export const authorship = {
  /** When the draft opens: the saved stretches, found in the current text. */
  async attach(view: EditorView | null, path: string | null) {
    clearTimeout(timer);
    useAuthorship.getState().set({ path, authoredWords: 0, lost: [], show: false });
    if (!view || !path) return;
    let spans: StoredSpan[];
    try {
      const res = await fetch(`/api/authorship/${enc(path)}`, { headers: headers() });
      spans = ((await res.json()) as { spans: StoredSpan[] }).spans ?? [];
    } catch {
      return;
    }
    if (useAuthorship.getState().path !== path) return;
    const { bodyOffset } = useDoc.getState();
    const body = view.state.doc.sliceString(bodyOffset);
    const found: AuthoredRange[] = [];
    const lost: StoredSpan[] = [];
    for (const s of spans) {
      const r = relocateAnchor(body, s, s.from);
      if (r) found.push({ from: r.from + bodyOffset, to: r.to + bodyOffset, source: s.source });
      else lost.push(s);
    }
    useAuthorship.getState().set({ lost });
    view.dispatch({ effects: setAuthored.of(found) });
  },

  /** Every change to the stretches: the count updates at once, the file shortly after. */
  onUpdate(u: ViewUpdate) {
    const now = u.state.field(authorshipField, false);
    const before = u.startState.field(authorshipField, false);
    if (!now || now.ranges === before?.ranges) return;
    const doc = u.state.doc;
    useAuthorship.getState().set({
      authoredWords: now.ranges.reduce((n, r) => n + countWords(doc.sliceString(r.from, r.to)), 0),
    });
    const path = useAuthorship.getState().path;
    if (!path) return;
    clearTimeout(timer);
    timer = setTimeout(() => void save(u.view, path), 600);
  },

  toggle(view: EditorView | null) {
    const show = !useAuthorship.getState().show;
    useAuthorship.getState().set({ show });
    view?.dispatch({ effects: showAuthored.of(show) });
  },
};
