import { useCallback, useMemo, useState } from "react";
import { EditorView } from "@codemirror/view";
import turbocode from "../../../../fixtures/drafts/turbocode-draft-12-settembre.md?raw";
import { useJudgments, useUi } from "../app/store.ts";
import { Editor } from "../editor/Editor.tsx";
import { deskAction } from "../editor/deskAction.ts";
import { formatting } from "../editor/formatting.ts";
import { showMarkdownField, toggleShowMarkdown } from "../editor/livePreview.ts";
import {
  judgmentsField,
  statusListener,
  updateJudgment,
  type FilterType,
  type JudgmentKind,
} from "../editor/judgmentsField.ts";
import sample from "./carta-sample.md?raw";
import { buildFakeJudgments, STYLE_FAKES } from "./fakeJudgments.ts";
import "./lab.css";
import { buildStress } from "./stress.ts";

declare global {
  interface Window {
    __lab?: { view: EditorView | null; judgmentCount: number };
  }
}

// The lab shows the state of the judgments next to the editor.
const LAB_EXTENSIONS = [
  statusListener((changes) => {
    for (const c of changes) useJudgments.getState().setStatuses([c.id], c.status);
  }),
  formatting(),
];

const TYPE_LABEL: Record<JudgmentKind, string> = {
  "fact-ok": "Facts ✓",
  fact: "Facts",
  grammar: "Grammar",
  prose: "Prose",
  struct: "Structure",
};

const CHIPS: [FilterType, string][] = [
  ["fact", "Facts"],
  ["grammar", "Grammar"],
  ["prose", "Prose"],
  ["struct", "Structure"],
];

/**
 * Editor test page: the Turbocode draft and fake judgments, with hidden syntax and line numbers
 * on the page. It is not the app.
 * `?doc=styles`: all the text styles; `?stress=1`: the long draft.
 */
export function Lab() {
  const params = new URLSearchParams(location.search);
  const stress = params.has("stress");
  const styles = params.get("doc") === "styles";
  const { doc, judgments, meta } = useMemo(() => {
    if (stress) {
      const s = buildStress(turbocode, sample);
      return { ...s, meta: [] };
    }
    if (styles) return { doc: sample, ...buildFakeJudgments(sample, STYLE_FAKES) };
    return { doc: turbocode, ...buildFakeJudgments(turbocode) };
  }, [stress, styles]);

  const [showMd, setShowMd] = useState(false);
  const extensions = useMemo(
    () => [
      ...LAB_EXTENSIONS,
      EditorView.updateListener.of((u) => {
        const md = u.state.field(showMarkdownField);
        if (md !== u.startState.field(showMarkdownField)) setShowMd(md);
      }),
    ],
    [],
  );

  const [view, setView] = useState<EditorView | null>(null);
  const onView = useCallback(
    (v: EditorView | null) => {
      setView(v);
      window.__lab = { view: v, judgmentCount: judgments.length };
    },
    [judgments],
  );

  const ui = useUi();
  const { statuses } = useJudgments();

  // A provisional "Apply" for testing: the lab has no real note actions.
  const apply = (id: string, fix: string) => {
    if (!view) return;
    const j = view.state.field(judgmentsField).items.find((x) => x.id === id);
    if (!j) return;
    view.dispatch({
      changes: { from: j.from, to: j.to, insert: fix },
      effects: updateJudgment.of({ id, status: "applied", from: j.from, to: j.from + fix.length }),
      annotations: deskAction.of(true),
      userEvent: "input.desk",
    });
    useJudgments.getState().setStatuses([id], "applied");
  };

  return (
    <div className="lab">
      <header className="lab-toolbar">
        <span className="lab-title">Lab editor</span>
        <span className="lab-sep" />
        <span className="lab-label">Show:</span>
        {CHIPS.map(([type, label]) => (
          <button
            key={type}
            className="lab-chip"
            aria-pressed={ui.visibleTypes[type]}
            onClick={() => ui.toggleType(type)}
          >
            {label}
          </button>
        ))}
        <span className="lab-grow" />
        <button
          className="lab-toggle"
          aria-pressed={showMd}
          title="Show Markdown (⌥⌘M)"
          onClick={() => {
            if (view) toggleShowMarkdown(view);
            view?.focus();
          }}
        >
          Show Markdown
        </button>
        <button className="lab-toggle" aria-pressed={ui.focus} onClick={() => ui.toggle("focus")}>
          Focus
        </button>
        <button
          className="lab-toggle"
          aria-pressed={ui.hemingway}
          onClick={() => ui.toggle("hemingway")}
        >
          Hemingway
        </button>
      </header>
      <div className="lab-body lab-carta">
        <main className="lab-editor sheet">
          <Editor
            docKey={stress ? "stress" : styles ? "styles" : "lab"}
            doc={doc}
            judgments={judgments}
            extensions={extensions}
            onView={onView}
          />
        </main>
        <aside className="lab-margin" aria-label="Judgment status">
          {meta.length > 0 && <h2>Fake judgments (for testing the editor)</h2>}
          {meta.map((m) => {
            const status = statuses[m.id] ?? "open";
            return (
              <div
                key={m.id}
                className="lab-card"
                data-testid={`judgment-${m.id}`}
                data-status={status}
              >
                <span className="lab-type" data-type={m.kind}>
                  {TYPE_LABEL[m.kind]}
                </span>
                <span className="lab-card-title">{m.title ?? m.id}</span>
                <span className="lab-card-status">
                  <span data-testid={`status-${m.id}`}>{status}</span>
                </span>
                {m.fix !== undefined && (
                  <button
                    className="lab-apply"
                    data-testid={`apply-${m.id}`}
                    onClick={() => apply(m.id, m.fix!)}
                  >
                    Apply {m.id}
                  </button>
                )}
              </div>
            );
          })}
        </aside>
      </div>
    </div>
  );
}
