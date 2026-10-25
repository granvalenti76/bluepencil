import { create } from "zustand";
import { mergeTraits, readStyle, traitsForFile, type StyleTip, type TraitCheck } from "@desk/core";
import { api, errorMessage, type NewStyle, type StyleSummary } from "./api.ts";
import { useDoc } from "./docStore.ts";
import { session } from "./session.ts";

/**
 * Styles, the process around them. A style is made in one go (the "New style" window: labels and
 * pasted pieces) or grows from the author's reading ("To a style" on a selection). Every time its
 * pieces change, the model reads its traits again, in the background, keeping those the author
 * fixed or set aside. A draft looks at one style ("Look at"); Style mode sets it beside the draft.
 */

/** The window open: a new style (maybe from a selection), or a selection to add to a style. */
export type StyleDialog =
  | { kind: "new"; piece?: { text: string; title: string }; lookAt: boolean }
  | { kind: "add"; text: string; title: string };

interface StylesState {
  loaded: boolean;
  list: StyleSummary[];
  libraryOpen: boolean;
  dialog: StyleDialog | null;
  /** Styles whose traits the model is reading now, in the background. */
  reading: string[];
  /** The cues for the open draft are being looked for. */
  busy: boolean;
  error: string | null;
  /** The last cues and trait checks, per draft, with the text and the style they were found on. */
  tips: Record<string, { tips: StyleTip[]; checks: TraitCheck[]; bodyHash: string; style: string }>;
  /** Cues set aside ("Not for this text") while the page stays open. */
  hidden: Record<string, string[]>;
}

export const useStyles = create<StylesState>()(() => ({
  loaded: false,
  list: [],
  libraryOpen: false,
  dialog: null,
  reading: [],
  busy: false,
  error: null,
  tips: {},
  hidden: {},
}));

let tipsController: AbortController | null = null;

/** Opens a file like the drafts list does: in the address too. */
function openPath(path: string) {
  const url = new URL(location.href);
  url.searchParams.set("d", path);
  history.replaceState(null, "", url.pathname + url.search);
  void session.open(path);
}

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
   * The model reads a style's traits. A style not open in the editor: the server writes them into
   * the file. The open one: they go through the editor, so the page and the file agree.
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
      fail(e, "The model couldn’t read the traits");
    } finally {
      useStyles.setState((s) => ({ reading: s.reading.filter((p) => p !== path) }));
      void styles.load();
    }
  },

  async findTips(draft: string, style: string, body: string, bodyHash: string) {
    tipsController?.abort();
    const mine = new AbortController();
    tipsController = mine;
    useStyles.setState({ busy: true, error: null });
    try {
      const { tips, checks } = await api.styleTips(style, body, mine.signal);
      useStyles.setState((s) => ({
        tips: { ...s.tips, [draft]: { tips, checks, bodyHash, style } },
        hidden: { ...s.hidden, [draft]: [] },
      }));
    } catch (e) {
      if (!mine.signal.aborted) fail(e, "The model couldn’t answer");
    } finally {
      if (tipsController === mine) {
        tipsController = null;
        useStyles.setState({ busy: false });
      }
    }
  },
  cancelTips() {
    tipsController?.abort();
  },
  hide(draft: string, quote: string) {
    useStyles.setState((s) => ({
      hidden: { ...s.hidden, [draft]: [...(s.hidden[draft] ?? []), quote] },
    }));
  },
};
