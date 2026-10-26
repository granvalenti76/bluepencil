import { useEffect, useMemo, useState } from "react";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  activeProcedures,
  compareWithStyle,
  countWords,
  DIMENSION_LABEL,
  DRAFT_MIN_WORDS,
  formatMeasure,
  isStylePath,
  PART_LABEL,
  proceduresForFile,
  readStyle,
  STYLE_DIMENSIONS,
  STYLE_MAX_WORDS,
  STYLE_MIN_WORDS,
  styleSchema,
  traitsForFile,
  type MeasureDef,
  type MeasuredParagraph,
  type MeasuredText,
  type PieceSentence,
  type Procedure,
  type ReadingCue,
  type ReadingOutcome,
  type Style,
  type StyleDimension,
  type StyleReading,
  type StyleSchema,
  type StyleTrait,
} from "@desk/core";
import { setCueMarks, type CueMark } from "../editor/cueMarks.ts";
import { setStyleMargin, type MarginParagraph } from "../editor/styleMargin.ts";
import { api } from "./api.ts";
import { useDoc } from "./docStore.ts";
import { languageName, useLanguages, usePack } from "./languages.ts";
import { useMenu } from "./Menu.tsx";
import { useMode } from "./mode.ts";
import {
  PassageSlip,
  PieceDots,
  RhythmBars,
  StateRow,
  TraitLine,
  useLocated,
  useSentences,
  Words,
} from "./Procedures.tsx";
import { session } from "./session.ts";
import { useUi } from "./store.ts";
import { styles, useStyles } from "./styles.ts";

/**
 * The card on the right. On a draft, in Style mode: the editor's reading of the draft beside the
 * style, paragraph by paragraph (which procedure of the style is at stake, how the draft stands
 * beside it, and the style's own passage on a click), numbered on the page too; the numbers,
 * closed. On a style file: what the model read in it (its summary and procedures, to keep or set
 * aside) and its measures. Nothing here rewrites the text.
 */
export function StylePanel({ view }: { view: EditorView | null }) {
  const path = useDoc((s) => s.path) ?? "";
  const reference = useDoc((s) => s.reference);
  const error = useStyles((s) => s.error);
  useEffect(() => {
    void styles.load();
  }, []);

  return (
    <div className="card-stack">
      <aside className="notes-panel editor-card style-card" aria-label="Style">
        <div className="notes-head">
          <span className="panel-title">{isStylePath(path) ? "This style" : "Style"}</span>
        </div>
        <div className="notes-list">
          {error && <p className="style-error">{error}</p>}
          {isStylePath(path) ? (
            <ThisStyle view={view} />
          ) : reference ? (
            <LookingAt view={view} />
          ) : (
            <Choose />
          )}
        </div>
      </aside>
    </div>
  );
}

/** The body as the editor has it now: measured again whenever the text changes. */
function useBody(view: EditorView | null) {
  const bodyHash = useDoc((s) => s.bodyHash);
  const offset = useDoc((s) => s.bodyOffset);
  return useMemo(() => view?.state.sliceDoc(offset) ?? "", [view, offset, bodyHash]);
}

/** The editor's last reading of the open draft, if it was beside the style it looks at now. */
function useReading() {
  const path = useDoc((s) => s.path) ?? "";
  const reference = useDoc((s) => s.reference);
  return useStyles((s) => {
    const r = s.readings[path];
    return r && r.style === reference ? r : undefined;
  });
}

/** Words of the draft a cue speaks of: in its paragraph first, then anywhere. */
function findWords(body: string, words: string, para?: MeasuredParagraph) {
  const norm = (t: string) => t.toLowerCase().replace(/’/g, "'");
  const hay = norm(body);
  const needle = norm(words.trim());
  if (!needle) return null;
  let at = para ? hay.indexOf(needle, para.from) : -1;
  if (para && at > para.to) at = -1;
  if (at < 0) at = hay.indexOf(needle);
  return at < 0 ? null : { from: at, to: at + needle.length };
}

/** The words the reading's cues name, underlined on the page. */
function underlines(reading: StyleReading, m: MeasuredText, body: string): CueMark[] {
  return reading.cues.flatMap((c) => {
    const p = c.paragraph ? m.paragraphs[c.paragraph - 1] : undefined;
    return c.words.flatMap((w) => {
      const at = findWords(body, w, p);
      return at ? [{ ...at, tone: c.outcome }] : [];
    });
  });
}

/** The cue whose passage is open: the one chosen, or the first. */
const openOf = (reading: StyleReading | undefined, chosen: string | null) =>
  chosen ?? reading?.cues[0]?.id ?? "";

/**
 * The margins of the page: every paragraph with its number and its sentences, what it does and
 * its cues when the editor has read the draft, the open cue's paragraph tinted.
 */
function marginOf(
  m: MeasuredText,
  reading: StyleReading | undefined,
  open: string,
): MarginParagraph[] {
  return m.paragraphs.map((p, i) => {
    const cues = (reading?.cues ?? []).flatMap((c, k) =>
      c.paragraph === i + 1 ? [{ n: k + 1, tone: c.outcome, id: c.id }] : [],
    );
    const opened = cues.find((c) => c.id === open);
    return {
      from: p.from,
      to: p.to,
      n: i + 1,
      ...(reading?.functions[i] ? { label: reading.functions[i] } : {}),
      bars: m.sentences.slice(p.first, p.first + p.sentences).map((s) => s.words),
      cues: cues.map(({ n, tone }) => ({ n, tone })),
      ...(opened ? { open: opened.n } : {}),
    };
  });
}

/**
 * The draft beside the style it looks at, always (not only in Style mode): the style is read and
 * measured once, the draft again as it changes; the editor's reading goes in the page's margins
 * in Style mode, and in Write if the author asks (View → Style cues).
 */
export function StyleCues({ view }: { view: EditorView | null }) {
  const path = useDoc((s) => s.path) ?? "";
  const reference = useDoc((s) => s.reference);
  const offset = useDoc((s) => s.bodyOffset);
  const draftLang = useDoc((s) => s.lang.code);
  const body = useBody(view);
  const mode = useMode();
  const inWrite = useUi((s) => s.styleCues);
  // The style is read again when the model has read it (in the background) or its pieces change.
  const listed = useStyles((s) => s.list.find((x) => x.path === reference));
  const [style, setStyle] = useState<{ path: string; style: Style } | null>(null);

  useEffect(() => {
    if (!reference || isStylePath(path)) {
      setStyle(null);
      useStyles.setState({ missing: null });
      return;
    }
    let live = true;
    api.getDraft(reference).then(
      (d) => {
        if (!live) return;
        setStyle({ path: reference, style: readStyle(d.text) });
        useStyles.setState({ missing: null });
      },
      () => live && useStyles.setState({ missing: reference }),
    );
    return () => {
      live = false;
    };
  }, [path, reference, listed?.procedures, listed?.pieces, listed?.words, listed?.summary]);

  const current = style && style.path === reference ? style : null;
  // A style never read: the model reads it, once, in the background.
  useEffect(() => {
    if (current) styles.readIfNew(current.path, current.style);
  }, [current]);
  const pack = usePack(current?.style.lang ?? draftLang);
  const schema = useMemo(
    () => (current ? styleSchema(current.style, pack) : null),
    [current, pack],
  );
  const comparison = useMemo(
    () => (schema ? compareWithStyle(body, schema, pack) : null),
    [body, schema, pack],
  );
  useEffect(() => {
    useStyles.setState({
      looking:
        current && schema && comparison
          ? { draft: path, reference: current.path, style: current.style, schema, comparison }
          : null,
    });
  }, [path, current, schema, comparison]);

  const reading = useReading();
  const chosen = useStyles((s) => s.openCue);
  const visible = mode === "style" || (mode === "write" && inWrite);
  useEffect(() => {
    if (!view) return;
    const m = comparison?.measured;
    const at = <T extends { from: number; to: number }>(x: T): T => ({
      ...x,
      from: offset + x.from,
      to: offset + x.to,
    });
    view.dispatch({
      effects: [
        setCueMarks.of(visible && reading && m ? underlines(reading, m, body).map(at) : []),
        setStyleMargin.of(
          visible && m ? marginOf(m, reading, openOf(reading, chosen)).map(at) : [],
        ),
      ],
    });
  }, [view, offset, reading, comparison, body, visible, chosen]);
  useEffect(
    () => () => view?.dispatch({ effects: [setCueMarks.of([]), setStyleMargin.of([])] }),
    [view],
  );
  return null;
}

/** A draft that looks at no style yet: the styles in its language, a new one, the library. */
function Choose() {
  const { list, loaded } = useStyles();
  const lang = useDoc((s) => s.lang.code);
  const mine = list.filter((s) => !s.lang || s.lang === lang);
  return (
    <div className="style-choose">
      <p className="style-lead">
        Look at a style while you write: pieces of a book, articles, a text of yours that worked.
        The editor reads in them what the style does (how it opens, how it closes a paragraph, how
        it shows people) and tells you, paragraph by paragraph, how your draft stands beside it.
      </p>
      {loaded && mine.length > 0 && (
        <ul className="style-list" aria-label="Styles">
          {mine.map((s) => (
            <li key={s.path}>
              <button className="style-pick" onClick={() => void styles.setReference(s.path)}>
                <span className="style-pick-name">{s.name}</span>
                <span className="style-small">
                  {[s.author, s.source].filter(Boolean).join(" · ") || "—"} · {s.pieces}{" "}
                  {s.pieces === 1 ? "piece" : "pieces"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="style-row">
        <button
          className="btn-primary btn-small style-primary"
          onClick={() => styles.newStyle({ lookAt: true })}
        >
          New style…
        </button>
        <button className="btn-secondary btn-small" onClick={styles.openLibrary}>
          Open the library
        </button>
      </div>
      <p className="style-small">
        To collect pieces as you read, select a passage in any text and choose “To a style”.
      </p>
    </div>
  );
}

/**
 * "Look at ▾" in the draft's title bar: the styles in the draft's language, the others apart, no
 * style, a new style, the library.
 */
export function LookAtMenu() {
  const path = useDoc((s) => s.path);
  const reference = useDoc((s) => s.reference);
  const lang = useDoc((s) => s.lang.code);
  const list = useStyles((s) => s.list);
  const { open, setOpen, box } = useMenu();
  useEffect(() => {
    void styles.load();
  }, []);
  if (!path || isStylePath(path)) return null;
  const current = list.find((s) => s.path === reference);
  const mine = list.filter((s) => !s.lang || s.lang === lang);
  const others = list.filter((s) => s.lang && s.lang !== lang);
  const pick = (p: string | null) => {
    setOpen(false);
    void styles.setReference(p);
  };
  const item = (s: (typeof list)[number]) => (
    <button
      key={s.path}
      role="menuitemradio"
      aria-checked={s.path === reference}
      className="look-at-item"
      onClick={() => pick(s.path)}
    >
      <span className="look-at-mark" aria-hidden>
        {s.path === reference ? "●" : ""}
      </span>
      <span className="look-at-text">
        <span className="look-at-name">{s.name}</span>
        <span className="style-small">
          {[s.author, s.source].filter(Boolean).join(" · ")}
          {s.usedIn ? ` · in ${s.usedIn} ${s.usedIn === 1 ? "draft" : "drafts"}` : ""}
        </span>
      </span>
    </button>
  );
  return (
    <span className="menu-anchor look-at" ref={box}>
      <button
        className="look-at-btn"
        data-set={reference !== null}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tip="The style this draft looks at"
        onClick={() => setOpen(!open)}
      >
        {reference ? `Look at: ${current?.name ?? reference}` : "Look at a style"} ▾
      </button>
      {open && (
        <div className="menu look-at-menu" role="menu" aria-label="Look at">
          <div className="look-at-head">Look at a style · {languageName(lang)}</div>
          {mine.length === 0 && (
            <p className="style-small look-at-empty">No styles in this language yet.</p>
          )}
          {mine.map(item)}
          {others.length > 0 && <div className="look-at-head">Other languages</div>}
          {others.map(item)}
          <div className="look-at-foot">
            <button className="link-btn" onClick={() => pick(null)} disabled={!reference}>
              No style
            </button>
            <button
              className="link-btn"
              onClick={() => {
                setOpen(false);
                styles.newStyle({ lookAt: true });
              }}
            >
              New style…
            </button>
            <button
              className="link-btn"
              onClick={() => {
                setOpen(false);
                styles.openLibrary();
              }}
            >
              Manage styles…
            </button>
          </div>
        </div>
      )}
    </span>
  );
}

/** A measure on the style's range: the band is the style, the dot the draft (or the whole style). */
function MeasureRow({
  def,
  lo,
  hi,
  value,
  out,
  legend,
}: {
  def: MeasureDef;
  lo: number;
  hi: number;
  value: number | null;
  out: "low" | "high" | null;
  legend: [string, string];
}) {
  const top = def.unit === "%" ? 100 : Math.max(hi * 1.5, (value ?? 0) * 1.1, 1);
  const pct = (n: number) => `${Math.min(100, (n / top) * 100)}%`;
  const range =
    formatMeasure(def, lo) === formatMeasure(def, hi)
      ? formatMeasure(def, lo)
      : `${formatMeasure(def, lo)}–${formatMeasure(def, hi)}`;
  return (
    <div className="style-measure" data-out={out ?? "no"}>
      <span className="style-measure-label">{def.label}</span>
      <span className="style-track" aria-hidden>
        <span
          className="style-band"
          style={{ left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})` }}
        />
        {value !== null && <span className="style-dot" style={{ left: pct(value) }} />}
      </span>
      <span
        className="style-measure-value"
        data-tip={`${legend[0]} ${value === null ? "—" : formatMeasure(def, value)} · ${legend[1]} ${range}`}
      >
        {value === null ? "—" : formatMeasure(def, value)}
      </span>
    </div>
  );
}

const OUTCOME_LABEL: Record<ReadingOutcome, string> = {
  differs: "Differs from the style",
  like: "Like the style",
  missing: "Not in the draft yet",
};

/** Readings asked for once without a click, per draft and style: not again if it failed. */
const asked = new Set<string>();

/**
 * A draft looking at a style: the editor's reading, paragraph by paragraph. At the top how the
 * draft stands beside the style; then each cue (the paragraph and what it does, the procedure of
 * the style at stake, the note, and on a click the passage where the style does it); the numbers,
 * closed, at the end.
 */
function LookingAt({ view }: { view: EditorView | null }) {
  const reference = useDoc((s) => s.reference) ?? "";
  const offset = useDoc((s) => s.bodyOffset);
  const bodyHash = useDoc((s) => s.bodyHash);
  const draftLang = useDoc((s) => s.lang.code);
  const body = useBody(view);
  const looking = useStyles((s) => (s.looking?.reference === reference ? s.looking : null));
  const missing = useStyles((s) => s.missing === reference);
  const focusCue = useStyles((s) => s.focusCue);
  const describing = useStyles((s) => s.reading.includes(reference));
  const noting = useStyles((s) => s.noting);
  const noteError = useStyles((s) => s.noteError);
  const reading = useReading();
  const pack = usePack(looking?.style.lang ?? draftLang);
  const sentences = useSentences(looking?.style ?? NO_STYLE, pack);
  const chosen = useStyles((s) => s.openCue);

  useEffect(() => {
    if (focusCue === null) return;
    document
      .querySelector(`.style-cue[data-n="${focusCue}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const cue = reading?.cues[focusCue - 1];
    if (cue) useStyles.setState({ openCue: cue.id });
    const t = setTimeout(() => useStyles.setState({ focusCue: null }), 1600);
    return () => clearTimeout(t);
  }, [focusCue, reading]);

  // The editor reads the draft beside the style by itself the first time; afterwards on request.
  const draft = looking?.draft;
  const ready = !!looking && activeProcedures(looking.style).length > 0 && !describing;
  useEffect(() => {
    if (!draft || !ready || reading || noting) return;
    const key = `${draft}\u0000${reference}`;
    if (asked.has(key)) return;
    asked.add(key);
    void styles.readDraft(draft, reference, body, bodyHash);
  }, [draft, ready, reading, noting, reference, body, bodyHash]);

  if (missing) {
    return (
      <div className="style-choose">
        <p className="style-lead">The style this draft looks at is gone ({reference}).</p>
        <button className="btn-secondary btn-small" onClick={() => void styles.setReference(null)}>
          Look at no style
        </button>
      </div>
    );
  }
  if (!looking) return <p className="notes-empty">Reading the style…</p>;
  const { style, schema, comparison } = looking;
  const m: MeasuredText = comparison.measured;
  const procedures = activeProcedures(style);

  const goTo = (from: number, to = from) => {
    if (!view) return;
    const sel = EditorSelection.range(offset + from, offset + to);
    view.dispatch({
      selection: sel,
      effects: EditorView.scrollIntoView(sel.from, { y: "center" }),
    });
    view.focus();
  };
  const stale = reading !== undefined && reading.bodyHash !== bodyHash;
  const ask = () => void styles.readDraft(looking.draft, reference, body, bodyHash);
  const shownOpen = openOf(reading, chosen);
  const marked = new Set(
    (reading?.cues ?? []).flatMap((c) => (c.paragraph ? [c.paragraph - 1] : [])),
  );

  return (
    <>
      <header className="style-head">
        <span className="style-name">{style.name}</span>
        <span className="style-small">
          {[style.author, style.source].filter(Boolean).join(" · ")}
          {style.author || style.source ? " · " : ""}
          {style.pieces.length} {style.pieces.length === 1 ? "piece" : "pieces"}
        </span>
        <span className="style-head-actions">
          <button className="link-btn" onClick={() => styles.open(reference, true)}>
            See what it does
          </button>
          <button className="link-btn" onClick={() => styles.open(reference)}>
            Open the style
          </button>
          <button className="link-btn" onClick={styles.openLibrary}>
            Change
          </button>
        </span>
      </header>

      <section className="style-tips" aria-label="The draft and the style">
        <div className="notes-section">The draft and the style</div>
        {procedures.length === 0 ? (
          <div className="style-busy">
            <span className="style-small">
              {describing
                ? "The editor is reading the style’s pieces…"
                : style.pieces.length === 0
                  ? "The style has no pieces yet: open it and paste a few."
                  : style.procedures.length > 0
                    ? "You set aside every procedure of the style."
                    : "The style has not been read yet."}
            </span>
            {!describing && style.pieces.length > 0 && style.procedures.length === 0 && (
              <button
                className="btn-primary btn-small style-primary"
                onClick={() => void styles.readProcedures(reference)}
              >
                Read the style
              </button>
            )}
          </div>
        ) : noting ? (
          <div className="style-busy">
            <span className="style-small">The editor is reading the draft beside the style…</span>
            <button className="btn-secondary btn-small" onClick={styles.cancelNote}>
              Stop
            </button>
          </div>
        ) : (
          <>
            {reading?.summary && <p className="style-reading-summary">{reading.summary}</p>}
            <div className="style-busy">
              {stale && <span className="style-small">The text has changed since.</span>}
              <button
                className={
                  !reading || stale
                    ? "btn-primary btn-small style-primary"
                    : "btn-secondary btn-small"
                }
                onClick={ask}
              >
                {reading ? "Read again" : "Ask the editor"}
              </button>
            </div>
          </>
        )}
        {noteError && !noting && <p className="style-error">{noteError}</p>}
        {!reading && m.words < DRAFT_MIN_WORDS && procedures.length > 0 && (
          <p className="style-small">
            Under {DRAFT_MIN_WORDS} words there is little to read beside the style.
          </p>
        )}
      </section>

      {reading && (
        <section className="style-tips" aria-label="Paragraph by paragraph">
          <div className="notes-section">Paragraph by paragraph</div>
          {reading.cues.length === 0 ? (
            <p className="notes-empty">
              The editor found no procedure of the style at stake in this draft.
            </p>
          ) : (
            <ol className="notes-ol style-notes">
              {reading.cues.map((c, i) => (
                <ReadingCueItem
                  key={c.id}
                  cue={c}
                  n={i + 1}
                  style={style}
                  sentences={sentences}
                  schema={schema}
                  m={m}
                  functions={reading.functions}
                  focus={focusCue === i + 1}
                  open={shownOpen === c.id}
                  onToggle={() => useStyles.setState({ openCue: shownOpen === c.id ? "" : c.id })}
                  goTo={goTo}
                />
              ))}
            </ol>
          )}
        </section>
      )}

      <details className="style-numbers">
        <summary>The numbers</summary>
        {m.sentences.length > 0 && (
          <section className="style-dim" aria-label="Rhythm of the draft">
            <div className="notes-section">Rhythm of the draft</div>
            <RhythmBars
              lengths={m.sentences.map((s) => s.words)}
              band={schema.ranges.sentenceLength}
              paragraphs={m.paragraphs}
              marked={marked}
              onParagraph={(p) => goTo(m.paragraphs[p]!.from)}
            />
            <p className="style-small">
              A bar per sentence, paragraph by paragraph; short ones in sienna. The band: the
              style’s usual length.
            </p>
          </section>
        )}
        {comparison.cues.length > 0 && (
          <section className="style-dim" aria-label="What the numbers say">
            <div className="notes-section">What the numbers say</div>
            <ul className="style-said-list">
              {comparison.cues.map((c) => (
                <li key={c.id}>
                  <span className="style-cue-tag">
                    {DIMENSION_LABEL[c.dim]} ·{" "}
                    {c.paragraphs.length ? `¶${c.paragraphs.join(", ¶")}` : "whole draft"}
                  </span>
                  {c.text}
                </li>
              ))}
            </ul>
          </section>
        )}
        {STYLE_DIMENSIONS.map((dim) => {
          const rows = comparison.measures.filter((x) => x.def.dim === dim);
          if (!rows.length) return null;
          return (
            <section key={dim} className="style-dim" aria-label={DIMENSION_LABEL[dim]}>
              <div className="notes-section">{DIMENSION_LABEL[dim]}</div>
              <div className="style-print">
                {rows.map((r) => (
                  <MeasureRow
                    key={r.def.id}
                    def={r.def}
                    lo={r.lo}
                    hi={r.hi}
                    value={r.value}
                    out={r.out}
                    legend={["this draft", "the style"]}
                  />
                ))}
              </div>
            </section>
          );
        })}
        <p className="style-small">
          Measured by Bluepencil on the draft and on the style’s pieces, without the model.
        </p>
      </details>
      {schema.words < STYLE_MIN_WORDS && style.pieces.length > 0 && (
        <p className="style-small">
          The style has {schema.words} words: with fewer than {STYLE_MIN_WORDS} its measures are
          rough. Add a piece or two to the style.
        </p>
      )}
    </>
  );
}

const NO_STYLE: Pick<Style, "pieces"> = { pieces: [] };

/** A cue of the reading: where, what the paragraph does, the procedure, the note, the passage. */
function ReadingCueItem({
  cue,
  n,
  style,
  sentences,
  schema,
  m,
  functions,
  focus,
  open,
  onToggle,
  goTo,
}: {
  cue: ReadingCue;
  n: number;
  style: Style;
  sentences: PieceSentence[];
  schema: StyleSchema;
  m: MeasuredText;
  functions: string[];
  focus: boolean;
  open: boolean;
  onToggle: () => void;
  goTo: (from: number) => void;
}) {
  const procedure = style.procedures.find(
    (p) => p.name.toLowerCase() === cue.procedure.name.toLowerCase(),
  );
  const located = useLocated(style, procedure, sentences);
  const index = cue.paragraph ? cue.paragraph - 1 : -1;
  const para = m.paragraphs[index];
  const fn = functions[index];
  return (
    <li className="notes-item style-cue" data-n={n} data-focus={focus}>
      <div className="note style-note">
        <div className="style-note-text">
          <span className="style-number" data-tone={cue.outcome}>
            {n}
          </span>
          <span className="style-cue-body">
            <span className="style-cue-tag">
              {cue.paragraph ? `¶${cue.paragraph}${fn ? ` · ${fn}` : ""}` : "Whole draft"}
              <span className="style-outcome" data-tone={cue.outcome}>
                {OUTCOME_LABEL[cue.outcome]}
              </span>
            </span>
            <span className="style-cue-proc">{cue.procedure.name}</span>
            <span className="note-text">{cue.note}</span>
          </span>
        </div>
        <CueEvidence
          cue={cue}
          index={index}
          m={m}
          schema={schema}
          located={located}
          sentences={sentences}
        />
        {open && located.length > 0 && (
          <PassageSlip passages={located} lead="How the style does it" />
        )}
        <div className="note-actions">
          {located.length > 0 && (
            <button className="link-btn style-slip-btn" onClick={onToggle} aria-expanded={open}>
              {open ? "Hide the style’s passage" : "How the style does it ▸"}
            </button>
          )}
          {para && (
            <button className="btn-secondary btn-small" onClick={() => goTo(para.from)}>
              Go to ¶{cue.paragraph}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * The code's numbers under a cue on a paragraph: its sentences beside a paragraph of the style
 * where the procedure happens (for a paragraph's or a sentence's procedure), or the connectives
 * it uses that the style never does (for the links).
 */
function CueEvidence({
  cue,
  index,
  m,
  schema,
  located,
  sentences,
}: {
  cue: ReadingCue;
  index: number;
  m: MeasuredText;
  schema: StyleSchema;
  located: ReturnType<typeof useLocated>;
  sentences: PieceSentence[];
}) {
  const para = m.paragraphs[index];
  if (!para) return null;
  const part = cue.procedure.part;
  if (part === "paragraph" || part === "sentence") {
    const mine = m.sentences.slice(para.first, para.first + para.sentences).map((s) => s.words);
    const at = located[0];
    const theirs = at
      ? sentences
          .filter((s) => s.piece === at.piece && s.para === at.para - 1)
          .map((s) => countWords(s.text))
      : [];
    return (
      <div
        className="style-mini"
        role="img"
        aria-label="The paragraph's sentences beside a paragraph of the style"
      >
        <span>¶{index + 1} of the draft</span>
        <RhythmBars lengths={mine} height={32} />
        {theirs.length > 0 && (
          <>
            <span>a paragraph of the style</span>
            <RhythmBars lengths={theirs} height={32} />
          </>
        )}
      </div>
    );
  }
  if (part === "links") {
    const uses = new Set(schema.connectives.map((c) => c.word));
    const counted = new Map<string, number>();
    for (const c of m.connectives) {
      if (c.para === index && !uses.has(c.word))
        counted.set(c.word, (counted.get(c.word) ?? 0) + 1);
    }
    if (!counted.size) return null;
    return (
      <div className="proc-ev">
        <span className="proc-ev-label">In ¶{index + 1}, links the style never uses</span>
        <Words used={[]} never={[...counted.keys()]} />
        {schema.connectives.length > 0 && (
          <>
            <span className="proc-ev-label">The style links with</span>
            <Words used={schema.connectives.slice(0, 3)} />
          </>
        )}
      </div>
    );
  }
  return null;
}

export const OPENER_LABEL = {
  subject: "subject",
  setting: "time or place",
  conjunction: "conjunction",
  other: "other",
} as const;

/** What the dimension shows beyond its measures: rhythm bars, words, how sentences open. */
export function DimensionExtra({
  dim,
  schema,
  barsHeight,
}: {
  dim: StyleDimension;
  schema: StyleSchema;
  barsHeight?: number;
}) {
  if (dim === "rhythm" && schema.rhythm.length) {
    return (
      <>
        <RhythmBars
          lengths={schema.rhythm}
          band={schema.ranges.sentenceLength}
          height={barsHeight}
        />
        <p className="style-small">
          The first {schema.rhythm.length} sentences of the pieces, in order; short ones in sienna.
        </p>
      </>
    );
  }
  if (dim === "lexicon") {
    return (
      <>
        {schema.recurring.length > 0 && (
          <div className="style-extra">
            <span className="style-small">Words that come back</span>
            <Words used={schema.recurring} />
          </div>
        )}
        {(schema.connectives.length > 0 || schema.unused.length > 0) && (
          <div className="style-extra">
            <span className="style-small">Connectives, and some it never uses</span>
            <Words used={schema.connectives.slice(0, 6)} never={schema.unused} />
          </div>
        )}
      </>
    );
  }
  if (dim === "construction" && schema.openers) {
    const o = schema.openers;
    return (
      <div className="style-extra">
        <span className="style-small">How the sentences open</span>
        <span
          className="style-stack"
          role="img"
          aria-label={(Object.keys(OPENER_LABEL) as (keyof typeof OPENER_LABEL)[])
            .map((k) => `${OPENER_LABEL[k]} ${o[k]}%`)
            .join(", ")}
        >
          {(Object.keys(OPENER_LABEL) as (keyof typeof OPENER_LABEL)[]).map((k) => (
            <span key={k} data-k={k} style={{ width: `${o[k]}%` }} />
          ))}
        </span>
        <span className="style-stack-legend">
          {(Object.keys(OPENER_LABEL) as (keyof typeof OPENER_LABEL)[]).map((k) => (
            <span key={k}>
              <i data-k={k} />
              {OPENER_LABEL[k]} {o[k]}%
            </span>
          ))}
        </span>
      </div>
    );
  }
  return null;
}

/** Saves a change in the open style file's front matter, then reloads it. */
async function saveFrontMatter(path: string, patch: Record<string, unknown>) {
  if (await session.patchFrontMatter(patch)) {
    await session.open(path, true);
    void styles.load();
  }
}

/**
 * The open style file: its summary and procedures from the file as loaded, its pieces from the
 * page as it is now, its measures; and what can be done with what the model read.
 */
export function useThisStyle(view: EditorView | null) {
  const path = useDoc((s) => s.path) ?? "";
  const reading = useStyles((s) => s.reading.includes(path));
  const text = useDoc((s) => s.text);
  const body = useBody(view);
  const style = useMemo(() => {
    const live = readStyle(`---\n---\n${body}`);
    return { ...readStyle(text), pieces: live.pieces, words: live.words };
  }, [text, body]);
  const pack = usePack(style.lang ?? useDoc.getState().lang.code);
  const schema = useMemo(() => styleSchema(style, pack), [style, pack]);
  const sentences = useSentences(style, pack);
  const readAgain = async () => {
    await session.saveNow();
    void styles.readProcedures(path);
  };
  const setTraitState = (t: StyleTrait, state: StyleTrait["state"]) =>
    void saveFrontMatter(path, {
      traits: traitsForFile(style.traits.map((x) => (x === t ? { ...x, state } : x))),
    });
  const setProcedureState = (p: Procedure, state: Procedure["state"]) =>
    void saveFrontMatter(path, {
      procedures: proceduresForFile(style.procedures.map((x) => (x === p ? { ...x, state } : x))),
    });
  return {
    path,
    reading,
    style,
    schema,
    sentences,
    readAgain,
    setTraitState,
    setProcedureState,
  };
}

/** A procedure in short, on the style's card: where it works, what it does, its state. */
function ProcedureLine({
  procedure,
  style,
  sentences,
  onState,
}: {
  procedure: Procedure;
  style: Style;
  sentences: PieceSentence[];
  onState: (state: Procedure["state"]) => void;
}) {
  const located = useLocated(style, procedure, sentences);
  const off = procedure.state === "off";
  return (
    <div className="style-said proc-line" data-state={procedure.state ?? "active"}>
      <span className="proc-part">{procedure.part ? PART_LABEL[procedure.part] : "Procedure"}</span>
      <p>{procedure.name}</p>
      {!off && <PieceDots pieces={style.pieces.length} located={located} />}
      <StateRow state={procedure.state} onState={onState} />
    </div>
  );
}

function ThisStyle({ view }: { view: EditorView | null }) {
  const { path, reading, style, schema, sentences, readAgain, setTraitState, setProcedureState } =
    useThisStyle(view);
  const [added, setAdded] = useState("");
  const schemaOpen = useStyles((s) => s.schemaOpen);
  const summary = style.traits.filter((t) => t.dim === "summary");
  const own = style.traits.filter((t) => !t.dim);
  const procedures = [
    ...style.procedures.filter((p) => p.state !== "off"),
    ...style.procedures.filter((p) => p.state === "off"),
  ];

  return (
    <>
      <StyleLabels key={useDoc.getState().loadId} />
      <header className="style-head">
        <span className="style-small">
          {style.pieces.length} {style.pieces.length === 1 ? "piece" : "pieces"} ·{" "}
          {style.words.toLocaleString()} words · {schema.sentences} sentences. Each “##” heading on
          the page starts a piece.
        </span>
        {style.pieces.length > 0 && (
          <button
            className="btn-primary btn-small style-primary style-schema-btn"
            aria-pressed={schemaOpen}
            onClick={() => styles.toggleSchema()}
          >
            {schemaOpen ? "Back to the pieces" : "See what it does"}
          </button>
        )}
      </header>
      {style.pieces.length === 0 ? (
        <p className="style-lead">
          Paste a passage under each “##” heading, and write in the heading where it comes from.
          Three or four pieces of 300–800 words make a good style.
        </p>
      ) : (
        <>
          <section className="style-dim" aria-label="The style in brief">
            <div className="notes-section">In brief</div>
            {summary.map((t, i) => (
              <TraitLine key={i} trait={t} onState={(state) => setTraitState(t, state)} />
            ))}
            {reading ? (
              <p className="style-small">The model is reading the pieces…</p>
            ) : (
              <button
                className="btn-secondary btn-small"
                onClick={() => void readAgain()}
                data-tip="The procedures you kept or set aside stay"
              >
                {style.procedures.length ? "Read again" : "Read the style"}
              </button>
            )}
          </section>
          <section className="style-dim" aria-label="What it does">
            <div className="notes-section">What it does</div>
            {procedures.length === 0 && !reading && (
              <p className="style-small">
                The model has not read the pieces yet: “Read the style” finds its procedures.
              </p>
            )}
            {procedures.map((p) => (
              <ProcedureLine
                key={p.name}
                procedure={p}
                style={style}
                sentences={sentences}
                onState={(state) => setProcedureState(p, state)}
              />
            ))}
          </section>
          <details className="style-numbers">
            <summary>The measures</summary>
            {STYLE_DIMENSIONS.map((dim) => {
              const defs = schema.defs.filter((d) => d.dim === dim);
              if (!defs.length) return null;
              return (
                <section key={dim} className="style-dim" aria-label={DIMENSION_LABEL[dim]}>
                  <div className="notes-section">{DIMENSION_LABEL[dim]}</div>
                  <DimensionExtra dim={dim} schema={schema} />
                  <div className="style-print">
                    {defs.map((d) => {
                      const r = schema.ranges[d.id]!;
                      return (
                        <MeasureRow
                          key={d.id}
                          def={d}
                          lo={r.lo}
                          hi={r.hi}
                          value={r.all}
                          out={null}
                          legend={["all the pieces", "most passages"]}
                        />
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </details>
          {style.words < STYLE_MIN_WORDS && (
            <p className="style-small">
              Under {STYLE_MIN_WORDS} words the ranges are provisional: add a piece.
            </p>
          )}
          {style.words > STYLE_MAX_WORDS && (
            <p className="style-small">
              Over {STYLE_MAX_WORDS.toLocaleString()} words the style takes longer to read.
            </p>
          )}
          <p className="style-small">
            The model reads the procedures in the pieces, each with the sentences where it happens;
            the measures are Bluepencil’s, without the model.
          </p>
        </>
      )}

      <section className="style-traits" aria-label="Your traits">
        <div className="notes-section">Your traits</div>
        {own.length === 0 && (
          <p className="style-small">What you notice in the style, in your words.</p>
        )}
        {own.map((t, i) => (
          <TraitLine key={`own-${i}`} trait={t} onState={(state) => setTraitState(t, state)} />
        ))}
        <form
          className="style-new-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!added.trim()) return;
            void saveFrontMatter(path, {
              traits: traitsForFile([...style.traits, { text: added.trim(), state: "fixed" }]),
            });
            setAdded("");
          }}
        >
          <input
            value={added}
            aria-label="Add a trait"
            placeholder="Add a trait, in your words"
            onChange={(e) => setAdded(e.target.value)}
          />
          <button className="btn-secondary btn-small" disabled={!added.trim()}>
            Add
          </button>
        </form>
      </section>
    </>
  );
}

/**
 * A style's labels, at the top of its card: saved in the front matter when a field is left. The
 * name is the file's title.
 */
function StyleLabels() {
  const text = useDoc((s) => s.text);
  const packs = useLanguages((s) => s.packs);
  const initial = useMemo(() => readStyle(text), [text]);
  const [labels, setLabels] = useState({
    name: initial.name,
    author: initial.author,
    source: initial.source,
    tags: initial.tags.join(", "),
    lang: initial.lang ?? "",
  });
  const save = async (patch: Record<string, unknown>) => {
    if (await session.patchFrontMatter(patch)) {
      if (typeof patch.title === "string") useDoc.setState({ title: patch.title });
      void styles.load();
    }
  };
  const leave = (key: "name" | "author" | "source" | "tags") => {
    const v = labels[key].trim();
    if (key === "name") {
      if (v && v !== initial.name) void save({ title: v });
    } else if (key === "tags") {
      const tags = v
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      if (tags.join(",") !== initial.tags.join(",")) void save({ tags });
    } else if (v !== initial[key]) {
      void save({ [key]: v });
    }
  };
  const field = (key: "name" | "author" | "source" | "tags", label: string, hint: string) => (
    <label className="style-label-field">
      {label}
      <input
        value={labels[key]}
        placeholder={hint}
        onChange={(e) => setLabels((l) => ({ ...l, [key]: e.target.value }))}
        onBlur={() => leave(key)}
      />
    </label>
  );
  return (
    <section className="style-labels" aria-label="Labels of the style">
      {field("name", "Name", "e.g. Dry local news")}
      {field("author", "Author", "who wrote it")}
      {field("source", "Source", "a book, a newspaper")}
      {field("tags", "Labels", "news, short sentences")}
      {packs.length > 1 && (
        <label className="style-label-field">
          Language
          <select
            value={labels.lang}
            onChange={(e) => {
              setLabels((l) => ({ ...l, lang: e.target.value }));
              void save({ lang: e.target.value || null });
            }}
          >
            <option value="">—</option>
            {packs.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button className="link-btn" onClick={styles.openLibrary}>
        All styles
      </button>
    </section>
  );
}
