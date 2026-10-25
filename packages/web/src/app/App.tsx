import { useCallback, useEffect, useMemo, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { EditorView as View } from "@codemirror/view";
import { detectLanguage } from "@desk/core";
import { Editor } from "../editor/Editor.tsx";
import {
  judgmentClick,
  judgmentsField,
  setActiveJudgment,
  statusListener,
} from "../editor/judgmentsField.ts";
import { NotesPanel } from "./NotesPanel.tsx";
import { noteNumbers, orderedNotes } from "./noteOrder.ts";
import { TipsCard } from "./TipsCard.tsx";
import { OutlineCard } from "./OutlineCard.tsx";
import { isActive, usePasses } from "./passes.ts";
import { persistReanchor, persistStatusChanges } from "./notes.ts";
import { useJudgments, useUi } from "./store.ts";
import { currentStyle, formatting } from "../editor/formatting.ts";
import { linkTools } from "../editor/linkTools.ts";
import { askBox, askOf } from "../editor/askBox.ts";
import { AskBox, useAsk } from "./AskBox.tsx";
import { DryStamp } from "./DryStamp.tsx";
import { footnoteOpinions, showMarkdownField } from "../editor/livePreview.ts";
import { liveCounts } from "../editor/liveCounts.ts";
import { selectionActions } from "../editor/selectionActions.ts";
import { syncRewrite } from "./rewrite.ts";
import { ConflictBanner } from "./ConflictBanner.tsx";
import { connectEvents } from "./events.ts";
import { TooltipLayer } from "./Tooltip.tsx";
import { ctrlMod, mod } from "./keys.ts";
import { useDoc } from "./docStore.ts";
import { initToken } from "./api.ts";
import { Preview } from "../preview/Preview.tsx";
import { session } from "./session.ts";
import { packFor, useLanguages } from "./languages.ts";
import { Sidebar } from "./Sidebar.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { FormatBar } from "./FormatBar.tsx";
import { Toolbar } from "./Toolbar.tsx";
import { StructureScreen } from "../structure/StructureScreen.tsx";
import { review } from "./review.ts";
import { authorship } from "./authorship.ts";
import { letters } from "./letters.ts";
import { passes } from "./passes.ts";
import { scores } from "./scores.ts";
import { connectDesktopMenu } from "./desktopMenu.ts";
import { useDialog } from "./dialogs.ts";
import { HelpDialog } from "./HelpDialog.tsx";
import { NewDraftDialog } from "./NewDraftDialog.tsx";
import { PublishDialog } from "./PublishDialog.tsx";
import { SettingsDialog } from "./SettingsDialog.tsx";

/** The open dialog, from the bar, the app menu or a shortcut (one at a time). */
function Dialogs({ onCreated }: { onCreated: (path: string) => void }) {
  const { open, close } = useDialog();
  const path = useDoc((s) => s.path);
  switch (open) {
    case "new-draft":
      return (
        <NewDraftDialog
          onClose={close}
          onCreated={(p) => {
            close();
            onCreated(p);
          }}
        />
      );
    case "publish":
      return path ? <PublishDialog onClose={close} /> : null;
    case "settings":
      return <SettingsDialog onClose={close} />;
    case "help":
      return <HelpDialog onClose={close} />;
    default:
      return null;
  }
}

function selectedFromUrl(): string | null {
  return new URLSearchParams(location.search).get("d");
}

function setUrl(path: string | null) {
  const url = new URL(location.href);
  if (path) url.searchParams.set("d", path);
  else url.searchParams.delete("d");
  history.replaceState(null, "", url.pathname + url.search);
}

export function App() {
  const [token] = useState(() => initToken());
  const [view, setView] = useState<EditorView | null>(null);
  const doc = useDoc();
  // The editor and the Structure screen wait for the language packs (readability, archetypes).
  const languagesReady = useLanguages((s) => s.ready);

  const onView = useCallback((v: EditorView | null) => {
    session.setView(v);
    setView(v);
    window.__lab = { view: v, judgmentCount: 0 }; // hook for the e2e tests (as in the lab)
  }, []);

  const select = useCallback((path: string | null) => {
    setUrl(path);
    void session.open(path);
  }, []);

  useEffect(() => {
    if (!token) return;
    void useLanguages.getState().load();
    void session.refreshList();
    const stop = connectEvents();
    connectDesktopMenu();
    const d = selectedFromUrl();
    if (d) void session.open(d);
    return stop;
  }, [token]);

  // A review already running on this draft (e.g. after a reload) is picked up again.
  useEffect(() => {
    if (token) void review.restore(doc.path);
    if (token) void scores.load(doc.path);
    if (token) void passes.load(doc.path);
    if (token) void letters.load(doc.path);
  }, [token, doc.path]);

  // The stretches accepted from suggestions (authorship), found in the text as soon as the editor exists.
  useEffect(() => {
    if (token) void authorship.attach(view, view ? doc.path : null);
  }, [token, view, doc.path]);

  // ⌘O (and ⌃⌘S) the drafts, ⌃⌘N Write / Review, ⇧⌘P preview, Esc leaves Focus (Ctrl and
  // Ctrl+Alt off macOS: keys.ts).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const ui = useUi.getState();
      if ((mod(e) && !e.shiftKey && !e.altKey && k === "o") || (ctrlMod(e) && k === "s")) {
        e.preventDefault();
        ui.setDrafts();
      } else if (ctrlMod(e) && k === "n") {
        e.preventDefault();
        ui.setMode(ui.mode === "review" ? "write" : "review");
      } else if (mod(e) && e.shiftKey && k === "p") {
        e.preventDefault();
        ui.togglePreview();
      } else if (k === "escape" && ui.draftsOpen) {
        ui.setDrafts(false);
      } else if (
        k === "escape" &&
        ui.focus &&
        !e.defaultPrevented &&
        !document.querySelector(".menu, [role=dialog]")
      ) {
        ui.toggle("focus");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Cmd+S saves at once
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        !(e.metaKey && e.ctrlKey) &&
        !ctrlMod(e) &&
        e.key.toLowerCase() === "s"
      ) {
        e.preventDefault();
        void session.saveNow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Extensions tied to the open draft: read when the editor is (re)created.
  const extensions = useMemo(
    () => [
      formatting(),
      linkTools(),
      // The "author's opinion" notes are recognised at the end of the page, in every language.
      ...useLanguages.getState().packs.map((p) => footnoteOpinions.of(p.opinionNote)),
      liveCounts({
        bodyOffset: doc.bodyOffset,
        outline: doc.outline,
        pack: packFor(doc.lang.code),
        detect: (body) => detectLanguage(body, useLanguages.getState().packs),
        onCounts: (c) =>
          useDoc.getState().set({
            counts: {
              words: c.words,
              lines: c.lines,
              minutes: c.minutes,
              readability: c.readability,
              averageSentence: c.averageSentence,
              longSentences: c.longSentences,
            },
            sections: c.sections,
            detectedLang: c.detected,
          }),
        onBodyHash: (bodyHash) => useDoc.getState().set({ bodyHash }),
        onCursor: (line) => useDoc.getState().set({ cursorLine: line }),
      }),
      View.updateListener.of((u) => {
        const ask = askOf(u.state);
        if (ask !== askOf(u.startState)) useAsk.setState({ ask });
        const shown = u.state.field(showMarkdownField, false) ?? false;
        if (shown !== useUi.getState().markdownShown) useUi.setState({ markdownShown: shown });
        if (u.selectionSet || u.docChanged) {
          const caret = {
            style: currentStyle(u.state),
            selection: !u.state.selection.main.empty,
          };
          const prev = useUi.getState().caret;
          if (caret.style !== prev.style || caret.selection !== prev.selection)
            useUi.setState({ caret });
        }
        if (u.docChanged) session.docChanged();
        syncRewrite(u);
        authorship.onUpdate(u);
      }),
      selectionActions({ bodyOffset: doc.bodyOffset }),
      askBox((host) => useAsk.setState({ host })),
      statusListener(
        (changes) => persistStatusChanges(changes, doc.bodyOffset),
        (items) => {
          const v = session.getView();
          if (v) persistReanchor(v, items, doc.bodyOffset);
        },
      ),
      judgmentClick((id) => {
        // In Write: a click on the underline switches to Review and shows the note.
        useUi.getState().setMode("review");
        useJudgments.getState().flash(id);
      }),
    ],
    [doc.loadId, languagesReady],
  );

  // The note under the mouse highlights its text.
  const hoverId = useJudgments((s) => s.hoverId);
  useEffect(() => {
    view?.dispatch({ effects: setActiveJudgment.of(hoverId) });
  }, [view, hoverId]);

  const mode = useUi((s) => s.mode);
  const focus = useUi((s) => s.focus);
  const hand = useUi((s) => s.handwriting) && mode === "write";
  // The font changes outside CodeMirror: line heights must be measured again.
  useEffect(() => {
    view?.requestMeasure();
  }, [view, hand]);
  const preview = useUi((s) => s.preview);
  // With no open draft the list stays open: it is the only thing to do.
  const draftsOpen = useUi((s) => s.draftsOpen) || (!doc.path && !doc.loading);
  const inReview = mode === "review";

  if (!token) {
    return (
      <div className="gate">
        <h1>Bluepencil</h1>
        <p>
          The access token is missing. Open the address the server printed in the terminal at
          startup (it contains <code>#t=…</code>).
        </p>
      </div>
    );
  }

  return (
    <div className="shell" data-mode={mode} data-focus={focus} data-hand={hand}>
      <TooltipLayer />
      <Toolbar view={view} />
      <ConflictBanner />
      {draftsOpen && (
        <div
          className="drafts-layer"
          onMouseDown={(e) => e.target === e.currentTarget && useUi.getState().setDrafts(false)}
        >
          <Sidebar
            onSelect={(path) => {
              useUi.getState().setDrafts(false);
              select(path);
            }}
          />
        </div>
      )}
      <main className="main">
        <div className="writing" data-mode={mode}>
          {doc.error && <p className="doc-error">{doc.error}</p>}
          {!doc.path && !doc.error && !doc.loading && (
            <p className="doc-empty">Pick a draft from the list, or create a new one.</p>
          )}
          {doc.path && !doc.loading && languagesReady && doc.stage === "structure" && (
            <StructureScreen key={doc.loadId} />
          )}
          {doc.path && !doc.loading && languagesReady && doc.stage !== "structure" && (
            <>
              <DeskBar view={view} />
              <div className="desk">
                {!inReview && !focus && !preview && <OutlineCard view={view} />}
                <div className="editor-area">
                  {preview && (
                    <Preview
                      body={previewBody(view)}
                      lang={doc.lang.code}
                      notes={inReview ? previewNotes(view) : []}
                    />
                  )}
                  <AskBox view={view} />
                  <div className="editor-col sheet" hidden={preview}>
                    <DryStamp />
                    <Editor
                      key={doc.loadId}
                      docKey={doc.loadId}
                      doc={doc.text}
                      selection={doc.selection}
                      judgments={doc.tracked}
                      extensions={extensions}
                      lang={doc.lang.code}
                      onView={onView}
                    />
                  </div>
                </div>
                {inReview && <NotesPanel view={view} />}
                {!inReview && !focus && !preview && <TipsCard />}
              </div>
            </>
          )}
        </div>
      </main>
      <StatusBar view={view} />
      <Dialogs
        // The server's own writes raise no SSE events: the list must be refreshed by hand.
        onCreated={(path) => {
          useUi.getState().setDrafts(false);
          void session.refreshList();
          select(path);
        }}
      />
    </div>
  );
}

/**
 * The row above the page, the same height in both modes (switching does not move the text): in
 * Write the formatting bar, in Review an invitation to start.
 */
function DeskBar({ view }: { view: EditorView | null }) {
  const mode = useUi((s) => s.mode);
  const focus = useUi((s) => s.focus);
  const active = usePasses((s) => isActive(s));
  if (focus) return null;
  if (mode === "write") {
    return (
      <div className="desk-bar">
        <FormatBar view={view} />
      </div>
    );
  }
  // In Review the passes are the card's tabs: the row stays, so the text does not move.
  return (
    <div className="desk-bar">
      {!active && (
        <span className="desk-bar-hint">
          Start a review: the editor reads the draft pass by pass.
        </span>
      )}
    </div>
  );
}

/** The numbers of the open notes, at the end of the text they comment on (body positions). */
function previewNotes(view: EditorView | null): { pos: number; n: number }[] {
  if (!view) return [];
  const { notes } = useJudgments.getState();
  const numbers = noteNumbers(orderedNotes(notes, useUi.getState().visibleTypes));
  const offset = useDoc.getState().bodyOffset;
  return view.state
    .field(judgmentsField)
    .items.filter((j) => j.status === "open" && numbers[j.id] !== undefined && j.to >= offset)
    .map((j) => ({ pos: j.to - offset, n: numbers[j.id]! }));
}

function previewBody(view: EditorView | null): string {
  if (!view) return "";
  return view.state.sliceDoc(useDoc.getState().bodyOffset);
}
