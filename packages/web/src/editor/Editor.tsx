import { useEffect, useRef } from "react";
import { Compartment, EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { splitFrontMatter } from "@desk/core";
import { useDoc } from "../app/docStore.ts";
import { marksInfo } from "../app/noteOrder.ts";
import { useJudgments, useUi } from "../app/store.ts";
import { editorTheme } from "../theme/editor-theme.ts";
import { authorshipField } from "./authorship.ts";
import { focusMode, setFocusMode } from "./focusMode.ts";
import { frontMatter } from "./frontMatter.ts";
import { hemingway } from "./hemingway.ts";
import {
  judgmentHistory,
  judgmentsField,
  setJudgments,
  setVisibleTypes,
  type TrackedJudgment,
} from "./judgmentsField.ts";
import { livePreview } from "./livePreview.ts";
import { markDrawing } from "./markDrawing.ts";
import { proofMarks, setMarks } from "./proofMarks.ts";
import { typewriter } from "./typewriter.ts";
import { typingSounds } from "./typingSounds.ts";
import { visualLineNumbers } from "./visualLineNumbers.ts";

/** With the hand (Write only) you hear the fountain pen, not the keyboard. */
const pen = (s: { handwriting: boolean; mode: string }) => s.handwriting && s.mode === "write";

interface Props {
  /** The editor is recreated only when this changes: the other props are read at that moment. */
  docKey: string | number;
  /** Full text of the file, front matter included (it gets hidden). */
  doc: string;
  /** Initial cursor position; normally the start of the body. */
  selection?: number | null;
  judgments?: TrackedJudgment[];
  /** Extra extensions (saving, counts, formatting…). */
  extensions?: Extension[];
  /** Language of the text (the draft's `lang`): screen readers, IME, glyphs. */
  lang?: string;
  onView?: (view: EditorView | null) => void;
}

export function Editor(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const { doc, selection, judgments = [], extensions = [], onView, lang } = latest.current;
    const ui = useUi.getState();
    const hemC = new Compartment();
    const typeC = new Compartment();
    const soundC = new Compartment();

    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc,
        selection: { anchor: Math.min(selection ?? splitFrontMatter(doc).bodyOffset, doc.length) },
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          ...(lang ? [EditorView.contentAttributes.of({ lang })] : []),
          livePreview(),
          editorTheme,
          frontMatter(doc),
          visualLineNumbers(),
          judgmentsField,
          // After `judgmentsField`, whose judgments it reads. With high precedence its marks sit
          // inside the note's underline, which stays a single element (checked on the DOM: with
          // normal precedence the strikethrough split it into three).
          Prec.high(proofMarks),
          judgmentHistory,
          markDrawing,
          authorshipField,
          focusMode(),
          hemC.of(hemingway(ui.hemingway)),
          typeC.of(typewriter(ui.focus || ui.typewriter)),
          soundC.of(typingSounds(ui.typingSounds, pen(ui))),
          ...extensions,
        ],
      }),
    });

    view.dispatch({
      // With hidden syntax the initial cursor goes past the heading's hidden prefix.
      selection: view.state.selection,
      effects: [
        setJudgments.of(judgments),
        setVisibleTypes.of(ui.visibleTypes),
        setFocusMode.of(ui.focus),
      ],
    });

    const unsubscribe = useUi.subscribe((s, prev) => {
      view.dispatch({
        effects: [
          ...(s.focus !== prev.focus ? [setFocusMode.of(s.focus)] : []),
          ...(s.visibleTypes !== prev.visibleTypes ? [setVisibleTypes.of(s.visibleTypes)] : []),
          ...(s.hemingway !== prev.hemingway ? [hemC.reconfigure(hemingway(s.hemingway))] : []),
          ...(s.focus !== prev.focus || s.typewriter !== prev.typewriter
            ? [typeC.reconfigure(typewriter(s.focus || s.typewriter))]
            : []),
          ...(s.typingSounds !== prev.typingSounds || pen(s) !== pen(prev)
            ? [soundC.reconfigure(typingSounds(s.typingSounds, pen(s)))]
            : []),
        ],
      });
    });

    // Note numbers and missing parts: from the panel's notes, in the same order.
    const marks = () =>
      setMarks.of(
        marksInfo(
          useJudgments.getState().notes,
          useUi.getState().visibleTypes,
          useDoc.getState().outline,
        ),
      );
    view.dispatch({ effects: marks() });
    const unsubMarks = [
      useJudgments.subscribe((s, prev) => {
        if (s.notes !== prev.notes) view.dispatch({ effects: marks() });
      }),
      useUi.subscribe((s, prev) => {
        if (s.visibleTypes !== prev.visibleTypes) view.dispatch({ effects: marks() });
      }),
      useDoc.subscribe((s, prev) => {
        if (s.outline !== prev.outline) view.dispatch({ effects: marks() });
      }),
    ];

    onView?.(view);
    return () => {
      unsubscribe();
      for (const u of unsubMarks) u();
      onView?.(null);
      view.destroy();
    };
  }, [props.docKey]);

  return <div ref={host} data-testid="editor" style={{ height: "100%" }} />;
}
