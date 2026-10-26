import { create } from "zustand";
import {
  mergeTraits,
  readStyle,
  traitsForFile,
  type Style,
  type StyleComparison,
  type StyleNote,
  type StyleSchema,
} from "@desk/core";
import { api, errorMessage, type NewStyle, type StyleSummary } from "./api.ts";
import { useDoc } from "./docStore.ts";
import { session } from "./session.ts";

/**
 * Styles, the process around them. A style is made in one go (the "New style" window: labels and
 * pasted pieces) or grows from the author's reading ("To a style" on a selection). Its schema is
 * measured in the page; every time its pieces change, the model puts it into words again, in the
 * background, keeping the sentences the author kept or set aside. A draft looks at one style
 * ("Look at"); the comparison follows the text as it changes, and Style mode sets it beside it.
 */

/** The open draft beside the style it looks at: measured again as the text changes. */
export interface Looking {
  draft: string;
  reference: string;
  style: Style;
  schema: StyleSchema;
  comparison: StyleComparison;
}

/** The window open: a new style (maybe from a selection), or a selection to add to a style. */
export type StyleDialog =
  | { kind: "new"; piece?: { text: string; title: string }; lookAt: boolean }
  | { kind: "add"; text: string; title: string };

interface StylesState {
  loaded: boolean;
  list: StyleSummary[];
  libraryOpen: boolean;
  dialog: StyleDialog | null;
  /** Styles the model is putting into words now, in the background. */
  reading: string[];
  error: string | null;
  looking: Looking | null;
  /** The style the open draft looks at is gone. */
  missing: string | null;
  /** A cue's number clicked on the page: its card is shown. */
  focusCue: number | null;
  /** The editor's last note per draft, with the style and the text it was written on. */
  notes: Record<string, StyleNote & { style: string; bodyHash: string }>;
  /** The editor is reading the open draft beside the style. */
  noting: boolean;
  noteError: string | null;
  /** Cues set aside ("Not for this text") while the page stays open, by cue id, per draft. */
  hidden: Record<string, string[]>;
}

export const useStyles = create<StylesState>()(() => ({
  loaded: false,
  list: [],
  libraryOpen: false,
  dialog: null,
  reading: [],
  error: null,
  looking: null,
  missing: null,
  focusCue: null,
  notes: {},
  noting: false,
  noteError: null,
  hidden: {},
}));

/** Opens a file like the drafts list does: in the address too. */
function openPath(path: string) {
  const url = new URL(location.href);
  url.searchParams.set("d", path);
  history.replaceState(null, "", url.pathname + url.search);
  void session.open(path);
}

let noteController: AbortController | null = null;
/** Styles described once in this session without being asked: not again if it failed. */
const described = new Set<string>();

const fail = (e: unknown, fallback: string) =>
  useStyles.setState({ error: errorMessage(e, fallback) });

export const styles = {
  async load() {
    try {
      useStyles.setState({ list: await api.listStyles(), loaded: true });
    } catch (e) {
      useStyles.setState({ loaded: true });
      fail(e, "Couldn’t read the styles");
    }
  },
  open(path: string) {
    useStyles.setState({ libraryOpen: false });
    openPath(path);
  },
  openLibrary() {
    useStyles.setState({ libraryOpen: true, error: null });
    void styles.load();
  },
  closeLibrary() {
    useStyles.setState({ libraryOpen: false });
  },
  /** The "New style" window; `lookAt`: the open draft will look at the new style. */
  newStyle(opts: { piece?: { text: string; title: string }; lookAt?: boolean } = {}) {
    useStyles.setState({
      dialog: { kind: "new", piece: opts.piece, lookAt: opts.lookAt ?? false },
      error: null,
    });
  },
  /** "To a style" on a selection: the passage, and where it comes from (the open text). */
  addSelection(text: string) {
    const title = useDoc.getState().title;
    useStyles.setState({ dialog: { kind: "add", text, title: title ? `From «${title}»` : "" } });
    void styles.load();
  },
  closeDialog() {
    useStyles.setState({ dialog: null });
  },

  /** Writes the new style; its traits are read right after, in the background. */
  async create(style: NewStyle, lookAt: boolean): Promise<string | null> {
    try {
      const { path, pieces } = await api.createStyle(style);
      useStyles.setState({ dialog: null });
      void session.refreshList();
      if (lookAt) await styles.setReference(path);
      else await styles.load();
      if (pieces > 0) void styles.readTraits(path);
      return path;
    } catch (e) {
      fail(e, "Couldn’t create the style");
      return null;
    }
  },
  /** A passage becomes a piece of a style; the traits are read again. */
  async addPiece(path: string, text: string, title: string): Promise<boolean> {
    try {
      await api.addStylePiece(path, text, title || undefined);
      useStyles.setState({ dialog: null });
      void styles.load();
      void styles.readTraits(path);
      return true;
    } catch (e) {
      fail(e, "Couldn’t add the piece");
      return false;
    }
  },

  /** The style the open draft looks at (`null`: none). */
  async setReference(path: string | null) {
    await session.patchFrontMatter({ reference: path });
    void styles.load();
  },

  /**
   * The model puts a style's schema into words. A style not open in the editor: the server writes
   * the sentences into the file. The open one: they go through the editor, so the page and the
   * file agree.
   */
  async readTraits(path: string) {
    if (useStyles.getState().reading.includes(path)) return;
    useStyles.setState((s) => ({ reading: [...s.reading, path], error: null }));
    const open = () => useDoc.getState().path === path;
    try {
      const { traits } = await api.readStyleTraits(path, !open());
      if (open()) {
        const merged = mergeTraits(
          readStyle(session.getView()?.state.doc.toString() ?? useDoc.getState().text).traits,
          traits,
        );
        if (await session.patchFrontMatter({ traits: traitsForFile(merged) })) {
          await session.open(path, true);
        }
      }
    } catch (e) {
      fail(e, "The model couldn’t describe the style");
    } finally {
      useStyles.setState((s) => ({ reading: s.reading.filter((p) => p !== path) }));
      void styles.load();
    }
  },

  /** A style a draft looks at, never put into words yet: the model does it, once, in the background. */
  describeIfNew(path: string, style: Style) {
    if (described.has(path) || style.pieces.length === 0 || style.traits.some((t) => t.dim)) return;
    described.add(path);
    void styles.readTraits(path);
  },

  /** The editor's note on the draft beside the style: what the style does where the draft differs. */
  async readNote(draft: string, style: string, body: string, bodyHash: string) {
    noteController?.abort();
    const mine = new AbortController();
    noteController = mine;
    useStyles.setState({ noting: true, noteError: null });
    try {
      const note = await api.styleNote(style, body, mine.signal);
      useStyles.setState((s) => ({ notes: { ...s.notes, [draft]: { ...note, style, bodyHash } } }));
    } catch (e) {
      if (!mine.signal.aborted) {
        useStyles.setState({ noteError: errorMessage(e, "The editor couldn’t answer") });
      }
    } finally {
      if (noteController === mine) {
        noteController = null;
        useStyles.setState({ noting: false });
      }
    }
  },
  cancelNote() {
    noteController?.abort();
  },

  hide(draft: string, cue: string) {
    useStyles.setState((s) => ({
      hidden: { ...s.hidden, [draft]: [...(s.hidden[draft] ?? []), cue] },
    }));
  },
};
