import { useEffect, useMemo, useState } from "react";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  compareWithStyle,
  DIMENSION_LABEL,
  DRAFT_MIN_WORDS,
  formatMeasure,
  isStylePath,
  readStyle,
  STYLE_DIMENSIONS,
  STYLE_MAX_WORDS,
  STYLE_MIN_WORDS,
  styleSchema,
  traitsForFile,
  type MeasureDef,
  type MeasuredText,
  type Style,
  type StyleCue,
  type StyleDimension,
  type StyleSchema,
  type StyleTrait,
  type TraitDim,
} from "@desk/core";
import { setCueMarks } from "../editor/cueMarks.ts";
import { api } from "./api.ts";
import { useDoc } from "./docStore.ts";
import { languageName, useLanguages, usePack } from "./languages.ts";
import { useMenu } from "./Menu.tsx";
import { useMode } from "./mode.ts";
import { session } from "./session.ts";
import { useUi } from "./store.ts";
import { styles, useStyles } from "./styles.ts";

/**
 * The card on the right. On a draft, in Style mode: what the style does, in the model's words;
 * the editor's note on the draft beside it (the cues the code finds by patterns, numbered on the
 * page too, each put into words by the model); the numbers, closed. On a style file: the model's
 * sentence on each dimension, to keep or set aside, with the code's numbers under it. Nothing
 * here rewrites the text, and nothing quotes the style's pieces.
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

/** The cues the author has not set aside, numbered as on the page. */
function useShownCues(): StyleCue[] {
  const looking = useStyles((s) => s.looking);
  const hidden = useStyles((s) => (looking ? s.hidden[looking.draft] : undefined));
  return useMemo(
    () => (looking?.comparison.cues ?? []).filter((c) => !hidden?.includes(c.id)),
    [looking, hidden],
  );
}

/**
 * The draft beside the style it looks at, always (not only in Style mode): the style is read and
 * measured once, the draft again as it changes; the cues go on the page in Style mode, and in
 * Write if the author asks (View → Style cues).
 */
export function StyleCues({ view }: { view: EditorView | null }) {
  const path = useDoc((s) => s.path) ?? "";
  const reference = useDoc((s) => s.reference);
  const offset = useDoc((s) => s.bodyOffset);
  const draftLang = useDoc((s) => s.lang.code);
  const body = useBody(view);
  const mode = useMode();
  const inWrite = useUi((s) => s.styleCues);
  // The style is read again when its sentences or pieces change (the model writes in the background).
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
  }, [path, reference, listed?.traits, listed?.pieces, listed?.words, listed?.summary]);

  const current = style && style.path === reference ? style : null;
  // A style never put into words: the model describes it, once, in the background.
  useEffect(() => {
    if (current) styles.describeIfNew(current.path, current.style);
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

  const shown = useShownCues();
  const visible = mode === "style" || (mode === "write" && inWrite);
  useEffect(() => {
    if (!view) return;
    view.dispatch({
      effects: setCueMarks.of(
        visible
          ? shown.flatMap((c, i) => [
              ...(c.at !== null ? [{ from: offset + c.at, to: offset + c.at, n: i + 1 }] : []),
              ...c.words.map((w) => ({ from: offset + w.from, to: offset + w.to })),
            ])
          : [],
      ),
    });
  }, [view, offset, shown, visible]);
  useEffect(() => () => view?.dispatch({ effects: setCueMarks.of([]) }), [view]);
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
        Bluepencil measures its rhythm, vocabulary, construction and voice, and shows where the
        draft’s patterns move away from it.
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

/**
 * The rhythm: a bar per sentence, as long as the sentence, short ones in sienna; with paragraphs,
 * a gap between them, and a click on a paragraph goes there. The band is the style's usual length.
 */
function RhythmBars({
  lengths,
  band,
  paragraphs,
  marked,
  onParagraph,
}: {
  lengths: number[];
  band?: { lo: number; hi: number };
  paragraphs?: { first: number; sentences: number }[];
  marked?: Set<number>;
  onParagraph?: (p: number) => void;
}) {
  const h = (n: number) => Math.max(5, Math.min(56, Math.round(n * 1.6)));
  const bar = (n: number, k: number) => (
    <span key={k} className="style-bar" data-short={n <= 8} style={{ height: h(n) }} />
  );
  const groups = paragraphs ?? [{ first: 0, sentences: lengths.length }];
  return (
    <div className="style-bars" aria-hidden>
      {band && (
        <span
          className="style-bars-band"
          style={{ bottom: h(band.lo), height: Math.max(2, h(band.hi) - h(band.lo)) }}
        />
      )}
      {groups.map((g, p) =>
        onParagraph ? (
          <button
            key={p}
            className="style-bars-para"
            style={{ flexGrow: g.sentences }}
            data-marked={marked?.has(p) ?? false}
            tabIndex={-1}
            data-tip={`Paragraph ${p + 1}`}
            onClick={() => onParagraph(p)}
          >
            {lengths.slice(g.first, g.first + g.sentences).map(bar)}
          </button>
        ) : (
          <span key={p} className="style-bars-para" style={{ flexGrow: g.sentences }}>
            {lengths.slice(g.first, g.first + g.sentences).map(bar)}
          </span>
        ),
      )}
    </div>
  );
}

const STATE_LABEL = { active: "Proposed", fixed: "Kept", off: "Set aside" } as const;

/** A sentence of the model (or the author's), with its state and what can be done with it. */
function TraitLine({
  trait,
  onState,
}: {
  trait: StyleTrait;
  onState: (state: StyleTrait["state"]) => void;
}) {
  const state = trait.state ?? "active";
  return (
    <div className="style-said" data-state={state}>
      <p>{trait.text}</p>
      <div className="style-said-row">
        <span className="style-state" data-state={state}>
          {state === "fixed" ? "✓ " : ""}
          {STATE_LABEL[state]}
        </span>
        {state === "active" && (
          <button
            className="btn-secondary btn-small"
            data-tip="Kept when the model describes the style again"
            onClick={() => onState("fixed")}
          >
            Keep
          </button>
        )}
        {state !== "off" ? (
          <button
            className="btn-secondary btn-small"
            data-tip="No longer part of the style, and not proposed again"
            onClick={() => onState("off")}
          >
            Set aside
          </button>
        ) : (
          <button className="btn-secondary btn-small" onClick={() => onState("fixed")}>
            Take back
          </button>
        )}
      </div>
    </div>
  );
}

/** The model's sentence on a dimension, if there is one and it is not set aside. */
const saidOn = (style: Pick<Style, "traits">, dim: TraitDim) =>
  style.traits.find((t) => t.dim === dim && t.state !== "off")?.text;

const where = (c: StyleCue) =>
  c.paragraphs.length === 0
    ? "Whole draft"
    : `¶${c.paragraphs.slice(0, 4).join(", ¶")}${c.paragraphs.length > 4 ? "…" : ""}`;

/** Notes asked for once without a click, per draft and style: not again if it failed. */
const noted = new Set<string>();

/**
 * A draft looking at a style. At the top what the style does, in the model's words; then the
 * editor's note: the cues the code found, each in the model's words (the code's numbers below
 * it); the numbers themselves, closed, at the end.
 */
function LookingAt({ view }: { view: EditorView | null }) {
  const reference = useDoc((s) => s.reference) ?? "";
  const offset = useDoc((s) => s.bodyOffset);
  const bodyHash = useDoc((s) => s.bodyHash);
  const body = useBody(view);
  const looking = useStyles((s) => (s.looking?.reference === reference ? s.looking : null));
  const missing = useStyles((s) => s.missing === reference);
  const focusCue = useStyles((s) => s.focusCue);
  const describing = useStyles((s) => s.reading.includes(reference));
  const noting = useStyles((s) => s.noting);
  const noteError = useStyles((s) => s.noteError);
  const saved = useStyles((s) => (looking ? s.notes[looking.draft] : undefined));
  const note = saved?.style === reference ? saved : undefined;
  const cues = useShownCues();

  useEffect(() => {
    if (focusCue === null) return;
    document
      .querySelector(`.style-cue[data-n="${focusCue}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const t = setTimeout(() => useStyles.setState({ focusCue: null }), 1600);
    return () => clearTimeout(t);
  }, [focusCue]);

  // The editor reads the draft beside the style by itself the first time; afterwards on request.
  const draft = looking?.draft;
  const ready = !!looking && looking.style.pieces.length > 0 && !describing;
  useEffect(() => {
    if (!draft || !ready || note || noting) return;
    const key = `${draft}\u0000${reference}`;
    if (noted.has(key)) return;
    noted.add(key);
    void styles.readNote(draft, reference, body, bodyHash);
  }, [draft, ready, note, noting, reference, body, bodyHash]);

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

  const goTo = (from: number, to = from) => {
    if (!view) return;
    const sel = EditorSelection.range(offset + from, offset + to);
    view.dispatch({
      selection: sel,
      effects: EditorView.scrollIntoView(sel.from, { y: "center" }),
    });
    view.focus();
  };
  const summary = saidOn(style, "summary");
  const what = STYLE_DIMENSIONS.flatMap((d) => {
    const t = saidOn(style, d);
    return t ? [{ dim: d, text: t }] : [];
  });
  const marked = new Set(cues.flatMap((c) => c.paragraphs.map((p) => p - 1)));
  const stale = note !== undefined && note.bodyHash !== bodyHash;
  const ask = () => void styles.readNote(looking.draft, reference, body, bodyHash);

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
          <button className="link-btn" onClick={() => styles.open(reference)}>
            Open the style
          </button>
          <button className="link-btn" onClick={styles.openLibrary}>
            Change
          </button>
        </span>
      </header>

      <section className="style-dim" aria-label="What the style does">
        <div className="notes-section">What the style does</div>
        {summary && <p className="style-summary">{summary}</p>}
        {what.length > 0 && (
          <dl className="style-what">
            {what.map((w) => (
              <div key={w.dim}>
                <dt>{DIMENSION_LABEL[w.dim]}</dt>
                <dd>{w.text}</dd>
              </div>
            ))}
          </dl>
        )}
        {!summary && what.length === 0 && (
          <p className="style-small">
            {describing
              ? "The editor is putting the style into words…"
              : style.pieces.length === 0
                ? "The style has no pieces yet: open it and paste a few."
                : "Not described yet: open the style and choose “Describe in words”."}
          </p>
        )}
      </section>

      <section className="style-tips" aria-label="The editor's note">
        <div className="notes-section">The editor’s note</div>
        {noting ? (
          <div className="style-busy">
            <span className="style-small">The editor is reading the draft beside the style…</span>
            <button className="btn-secondary btn-small" onClick={styles.cancelNote}>
              Stop
            </button>
          </div>
        ) : (
          style.pieces.length > 0 &&
          (!note || stale) && (
            <div className="style-busy">
              {stale && <span className="style-small">The text has changed since.</span>}
              <button className="btn-primary btn-small style-primary" onClick={ask}>
                {note ? "Read again" : "Ask the editor"}
              </button>
            </div>
          )
        )}
        {noteError && !noting && <p className="style-error">{noteError}</p>}
        {note?.summary && <p className="style-lead">{note.summary}</p>}

        {style.pieces.length > 0 && cues.length === 0 && (
          <p className="notes-empty">
            {comparison.cues.length > 0
              ? "You set every cue aside."
              : m.words < DRAFT_MIN_WORDS
                ? `Under ${DRAFT_MIN_WORDS} words there is little to compare: keep writing.`
                : "Nothing to point out: the draft follows the style’s patterns."}
          </p>
        )}
        {cues.length > 0 && (
          <ol className="notes-ol style-notes">
            {cues.map((c, i) => {
              const said = note?.notes[c.id];
              return (
                <li
                  key={c.id}
                  className="notes-item style-cue"
                  data-n={i + 1}
                  data-focus={focusCue === i + 1}
                >
                  <div className="note style-note">
                    <div className="style-note-text">
                      <span className="style-number">{i + 1}</span>
                      <span>
                        <span className="style-cue-tag">
                          {DIMENSION_LABEL[c.dim]} · {where(c)}
                        </span>
                        {said ? (
                          <>
                            <span className="note-text">{said}</span>
                            <span className="style-cue-numbers">{c.text}</span>
                          </>
                        ) : (
                          <span className="note-text">{c.text}</span>
                        )}
                      </span>
                    </div>
                    <div className="note-actions">
                      {c.paragraphs.length > 0 && (
                        <button
                          className="btn-secondary btn-small"
                          onClick={() => {
                            const w = c.words[0];
                            if (w) goTo(w.from, w.to);
                            else if (c.at !== null) goTo(c.at);
                          }}
                        >
                          Go to ¶{c.paragraphs[0]}
                        </button>
                      )}
                      <button
                        className="btn-secondary btn-small"
                        onClick={() => styles.hide(looking.draft, c.id)}
                      >
                        Not for this text
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {comparison.inLine.length > 0 && (
          <p className="style-small">
            In line with the style:{" "}
            {comparison.inLine.map((d) => DIMENSION_LABEL[d].toLowerCase()).join(", ")}.
          </p>
        )}
      </section>

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

/** Saves the traits in the open style file, then reloads it (the editor and the file agree). */
async function saveTraits(path: string, traits: StyleTrait[]) {
  if (await session.patchFrontMatter({ traits: traitsForFile(traits) })) {
    await session.open(path, true);
    void styles.load();
  }
}

/** Chips of words with how often they come; the ones never used struck through. */
function Words({ used, never }: { used: { word: string; n: number }[]; never?: string[] }) {
  return (
    <span className="style-chips">
      {used.map((w) => (
        <span key={w.word} className="style-chip">
          {w.word} <small>×{w.n}</small>
        </span>
      ))}
      {never?.map((w) => (
        <span key={w} className="style-chip" data-never>
          {w}
        </span>
      ))}
    </span>
  );
}

const OPENER_LABEL = {
  subject: "subject",
  setting: "time or place",
  conjunction: "conjunction",
  other: "other",
} as const;

/** What the dimension shows beyond its measures: rhythm bars, words, how sentences open. */
function DimensionExtra({ dim, schema }: { dim: StyleDimension; schema: StyleSchema }) {
  if (dim === "rhythm" && schema.rhythm.length) {
    return (
      <>
        <RhythmBars lengths={schema.rhythm} band={schema.ranges.sentenceLength} />
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

/** A style file, open in the editor: its schema, and the sentences that put it into words. */
function ThisStyle({ view }: { view: EditorView | null }) {
  const path = useDoc((s) => s.path) ?? "";
  const reading = useStyles((s) => s.reading.includes(path));
  const text = useDoc((s) => s.text);
  const body = useBody(view);
  const [added, setAdded] = useState("");
  // The sentences come from the file as loaded; the pieces from the page as it is now.
  const style = useMemo(() => {
    const live = readStyle(`---\n---\n${body}`);
    return { ...readStyle(text), pieces: live.pieces, words: live.words };
  }, [text, body]);
  const pack = usePack(style.lang ?? useDoc.getState().lang.code);
  const schema = useMemo(() => styleSchema(style, pack), [style, pack]);
  const describe = async () => {
    await session.saveNow();
    void styles.readTraits(path);
  };
  const setState = (t: StyleTrait, state: StyleTrait["state"]) =>
    void saveTraits(
      path,
      style.traits.map((x) => (x === t ? { ...x, state } : x)),
    );
  const sentence = (dim: TraitDim) =>
    style.traits
      .filter((t) => t.dim === dim)
      .map((t, i) => (
        <TraitLine key={`${dim}-${i}`} trait={t} onState={(state) => setState(t, state)} />
      ));
  const own = style.traits.filter((t) => !t.dim);

  return (
    <>
      <StyleLabels key={useDoc.getState().loadId} />
      <header className="style-head">
        <span className="style-small">
          {style.pieces.length} {style.pieces.length === 1 ? "piece" : "pieces"} ·{" "}
          {style.words.toLocaleString()} words · {schema.sentences} sentences. Each “##” heading on
          the page starts a piece.
        </span>
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
            {sentence("summary")}
            {reading ? (
              <p className="style-small">The model is putting the schema into words…</p>
            ) : (
              <button
                className="btn-secondary btn-small"
                onClick={() => void describe()}
                data-tip="The sentences you kept or set aside stay"
              >
                {style.traits.some((t) => t.dim) ? "Describe again" : "Describe in words"}
              </button>
            )}
          </section>
          {STYLE_DIMENSIONS.map((dim) => {
            const defs = schema.defs.filter((d) => d.dim === dim);
            if (!defs.length) return null;
            return (
              <section key={dim} className="style-dim" aria-label={DIMENSION_LABEL[dim]}>
                <div className="notes-section">{DIMENSION_LABEL[dim]}</div>
                {sentence(dim)}
                <details className="style-numbers">
                  <summary>The numbers</summary>
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
                </details>
              </section>
            );
          })}
          {style.words < STYLE_MIN_WORDS && (
            <p className="style-small">
              Under {STYLE_MIN_WORDS} words the ranges are provisional: add a piece.
            </p>
          )}
          {style.words > STYLE_MAX_WORDS && (
            <p className="style-small">
              Over {STYLE_MAX_WORDS.toLocaleString()} words the style takes longer to measure.
            </p>
          )}
          <p className="style-small">
            The measures come from the pieces, without the model; the model only writes the
            sentences, from the numbers.
          </p>
        </>
      )}

      <section className="style-traits" aria-label="Your traits">
        <div className="notes-section">Your traits</div>
        {own.length === 0 && (
          <p className="style-small">What you notice in the style, in your words.</p>
        )}
        {own.map((t, i) => (
          <TraitLine key={`own-${i}`} trait={t} onState={(state) => setState(t, state)} />
        ))}
        <form
          className="style-new-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!added.trim()) return;
            void saveTraits(path, [...style.traits, { text: added.trim(), state: "fixed" }]);
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
