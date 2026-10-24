import type { EditorView } from "@codemirror/view";
import { draftLanguage, splitFrontMatter } from "@desk/core";
import { useLanguages } from "./languages.ts";
import type { Judgment } from "@desk/core";
import { api, ApiError, type DraftDetail } from "./api.ts";
import { toTracked } from "./notes.ts";
import { useJudgments } from "./store.ts";
import { useDoc, useDrafts } from "./docStore.ts";

const AUTOSAVE_MS = 800;

/**
 * The writing session: opens a draft, saves it automatically (800 ms after the last change and
 * with Cmd+S) and handles conflicts with the file on disk. The real document lives in
 * CodeMirror; here are the metadata.
 */
let view: EditorView | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight = false;
let openToken = 0;

const doc = () => useDoc.getState();

function applyDetail(detail: DraftDetail, selection: number | null, judgments: Judgment[]) {
  const fm = detail.frontmatter;
  const bodyOffset = splitFrontMatter(detail.text).bodyOffset;
  useJudgments.getState().setNotes(judgments);
  doc().set({
    path: detail.path,
    loadId: doc().loadId + 1,
    text: detail.text,
    selection,
    bodyOffset,
    tracked: judgments.flatMap((j) => toTracked(j, bodyOffset) ?? []),
    hash: detail.contentHash,
    title: fm.title ?? detail.path,
    archetype: fm.archetype ?? "undecided",
    stage: fm.stage ?? "writing",
    target: fm.target ?? 0,
    outline: fm.outline ?? [],
    brief: typeof fm.brief === "string" ? fm.brief.trim() : "",
    signoff: fm.signoff ?? null,
    lang: draftLanguage(
      fm.lang,
      useLanguages.getState().packs.map((p) => p.code),
    ),
    sections: detail.sections,
    status: "saved",
    loading: false,
    error: null,
  });
}

/** The desktop app calls this before closing the window: saves the pending text. */
(window as unknown as { __deskFlush?: () => Promise<void> }).__deskFlush = () => session.saveNow();

export const session = {
  setView(v: EditorView | null) {
    view = v;
  },

  getView: () => view,

  async refreshList() {
    try {
      useDrafts.getState().set({ drafts: await api.listDrafts() });
    } catch {
      /* the list refreshes on the next event */
    }
  },

  async open(path: string | null, keepSelection = false) {
    clearTimeout(timer);
    const token = ++openToken;
    if (path === null) {
      doc().set({
        path: null,
        text: "",
        status: "saved",
        loading: false,
        error: null,
        sections: [],
        outline: [],
        tracked: [],
      });
      useJudgments.getState().setNotes([]);
      return;
    }
    const selection = keepSelection && view ? view.state.selection.main.head : null;
    if (!keepSelection) doc().set({ loading: true, error: null });
    try {
      const [detail, judgments] = await Promise.all([
        api.getDraft(path),
        api.listJudgments(path).catch(() => [] as Judgment[]),
      ]);
      if (token !== openToken) return;
      applyDetail(detail, selection, judgments);
    } catch (e) {
      if (token !== openToken) return;
      doc().set({
        loading: false,
        error:
          e instanceof ApiError && e.status === 404
            ? "The draft no longer exists."
            : "Couldn’t open the draft.",
      });
    }
  },

  /** To be called at every text change. */
  docChanged() {
    if (doc().status === "conflict") return;
    doc().set({ status: "dirty" });
    clearTimeout(timer);
    timer = setTimeout(() => void session.saveNow(), AUTOSAVE_MS);
  },

  async saveNow() {
    clearTimeout(timer);
    const { path, hash, bodyOffset, status } = doc();
    if (!view || !path || status === "conflict") return;
    if (inFlight) {
      timer = setTimeout(() => void session.saveNow(), 100);
      return;
    }
    const text = view.state.doc.toString();
    if (status === "saved") return;
    inFlight = true;
    doc().set({ status: "saving" });
    try {
      const res = await api.putDraft(path, text.slice(bodyOffset), hash);
      if (doc().path !== path) return;
      if (!res.ok) {
        doc().set({ status: "conflict" });
        return;
      }
      doc().set({
        hash: res.detail.contentHash,
        // If more was written in the meantime, a new save is already queued.
        status: view && view.state.doc.toString() === text ? "saved" : "dirty",
      });
      void session.refreshList();
    } catch {
      doc().set({ status: "error" });
      timer = setTimeout(() => void session.saveNow(), 3000);
    } finally {
      inFlight = false;
    }
  },

  /** Conflict banner → "Reload": discards local changes, keeps the cursor. */
  async reload() {
    const { path } = doc();
    if (path) await session.open(path, true);
  },

  /** Conflict banner → "Keep my version": restarts from the file's current hash. */
  async keepMine() {
    const { path } = doc();
    if (!path) return;
    const current = await api.getDraft(path);
    doc().set({ hash: current.contentHash, status: "dirty" });
    await session.saveNow();
  },

  /**
   * Changes front matter fields (phase, glossary…) without reloading the editor: first saves the
   * text, then sends body + `frontmatterPatch` with the current hash. The front matter hidden in
   * the editor stays the old one, but is never sent back (only the body is saved).
   */
  async patchFrontMatter(patch: Record<string, unknown>): Promise<boolean> {
    await session.saveNow();
    const { path, hash, bodyOffset, status } = doc();
    if (!view || !path || status === "conflict") return false;
    const text = view.state.doc.toString();
    inFlight = true;
    try {
      const res = await api.putDraft(path, text.slice(bodyOffset), hash, patch);
      if (!res.ok) {
        doc().set({ status: "conflict" });
        return false;
      }
      const fm = res.detail.frontmatter;
      doc().set({
        hash: res.detail.contentHash,
        stage: fm.stage ?? doc().stage,
        target: fm.target ?? doc().target,
        signoff: fm.signoff ?? null,
        status: view.state.doc.toString() === text ? "saved" : "dirty",
      });
      void session.refreshList();
      return true;
    } catch {
      return false;
    } finally {
      inFlight = false;
    }
  },

  /** SSE event `draft.changed`. */
  async onDraftChanged(e: { path: string; contentHash: string | null; change: string }) {
    void session.refreshList();
    const { path, hash, status } = doc();
    if (e.path !== path) return;
    if (e.change === "unlink") {
      await session.open(null);
      return;
    }
    if (e.contentHash === hash) return;
    if (status === "saved") await session.open(path, true);
    else doc().set({ status: "conflict" });
  },
};
