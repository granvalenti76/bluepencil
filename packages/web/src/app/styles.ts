import { create } from "zustand";
import {
  mergeRead,
  proceduresForFile,
  readStyle,
  traitsForFile,
  type Style,
  type StyleComparison,
  type StyleReading,
  type StyleSchema,
} from "@desk/core";
import { api, errorMessage, type NewStyle, type StyleSummary } from "./api.ts";
import { useDoc } from "./docStore.ts";
import { session } from "./session.ts";

/**
 * Styles, the process around them. A style is made in one go (the "New style" window: labels and
 * pasted pieces) or grows from the author's reading ("To a style" on a selection). Every time its
 * pieces change, the model reads its procedures again, in the background, keeping the ones the
 * author kept or set aside; its measures are the page's. A draft looks at one style ("Look at");
 * the editor reads the draft beside it, paragraph by paragraph, and Style mode sets that reading
 * beside the page.
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
  /** Styles the model is reading now, in the background. */
  reading: string[];
  error: string | null;
  looking: Looking | null;
  /** The style the open draft looks at is gone. */
  missing: string | null;
  /** On a style file: what it does on the page, in place of the pieces. */
  schemaOpen: boolean;
  /** A cue's number clicked on the page: its card is shown. */
  focusCue: number | null;
  /** The editor's last reading per draft, with the style and the text it was written on. */
  readings: Record<string, StyleReading & { style: string; bodyHash: string }>;
  /** The editor is reading the open draft beside the style. */
  noting: boolean;
  noteError: string | null;
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
  schemaOpen: false,
  readings: {},
  noting: false,
  noteError: null,
}));

/** Opens a file like the drafts list does: in the address too. */
function openPath(path: string) {
  const url = new URL(location.href);
  url.searchParams.set("d", path);
  history.replaceState(null, "", url.pathname + url.search);
  void session.open(path);
}

let noteController: AbortController | null = null;
/** Styles read once in this session without being asked: not again if it failed. */
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
  /** Opens a style; `schema`: on what it does rather than on its pieces. */
  open(path: string, schema = false) {
    useStyles.setState({ libraryOpen: false, schemaOpen: schema });
    openPath(path);
  },
  toggleSchema() {
    useStyles.setState((s) => ({ schemaOpen: !s.schemaOpen }));
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

  /** Writes the new style; its procedures are read right after, in the background. */
  async create(style: NewStyle, lookAt: boolean): Promise<string | null> {
    try {
      const { path, pieces } = await api.createStyle(style);
      useStyles.setState({ dialog: null });
      void session.refreshList();
      if (lookAt) await styles.setReference(path);
      else await styles.load();
      if (pieces > 0) void styles.readProcedures(path);
      return path;
    } catch (e) {
      fail(e, "Couldn’t create the style");
      return null;
    }
  },
  /** A passage becomes a piece of a style; its procedures are read again. */
  async addPiece(path: string, text: string, title: string): Promise<boolean> {
    try {
      await api.addStylePiece(path, text, title || undefined);
      useStyles.setState({ dialog: null });
      void styles.load();
      void styles.readProcedures(path);
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
   * The model reads a style's procedures in its pieces. A style not open in the editor: the server
   * writes them into the file. The open one: they go through the editor, so the page and the file
   * agree.
   */
  async readProcedures(path: string) {
    if (useStyles.getState().reading.includes(path)) return;
    useStyles.setState((s) => ({ reading: [...s.reading, path], error: null }));
    const open = () => useDoc.getState().path === path;
    try {
      const read = await api.readStyleProcedures(path, !open());
      if (open()) {
        const now = readStyle(session.getView()?.state.doc.toString() ?? useDoc.getState().text);
        const merged = mergeRead(now, read);
        const saved = await session.patchFrontMatter({
          traits: traitsForFile(merged.traits),
          procedures: proceduresForFile(merged.procedures),
        });
        if (saved) await session.open(path, true);
      }
    } catch (e) {
      fail(e, "The model couldn’t read the style");
    } finally {
      useStyles.setState((s) => ({ reading: s.reading.filter((p) => p !== path) }));
      void styles.load();
    }
  },

  /** A style a draft looks at, never read for its procedures: the model does it, once, in the background. */
  readIfNew(path: string, style: Style) {
    if (described.has(path) || style.pieces.length === 0 || style.procedures.length > 0) return;
    described.add(path);
    void styles.readProcedures(path);
  },

  /** The editor reads the draft beside the style, paragraph by paragraph. */
  async readDraft(draft: string, style: string, body: string, bodyHash: string) {
    noteController?.abort();
    const mine = new AbortController();
    noteController = mine;
    useStyles.setState({ noting: true, noteError: null });
    try {
      const reading = await api.styleReading(style, body, mine.signal);
      useStyles.setState((s) => ({
        readings: { ...s.readings, [draft]: { ...reading, style, bodyHash } },
      }));
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
};
