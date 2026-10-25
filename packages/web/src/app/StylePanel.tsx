import { useEffect, useMemo, useState } from "react";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  activeTraits,
  DRAFT_MIN_WORDS,
  isStylePath,
  readAgainst,
  readStyle,
  STYLE_MAX_WORDS,
  STYLE_MEASURE_LABEL,
  STYLE_MEASURES,
  STYLE_MIN_WORDS,
  styleRanges,
  traitsForFile,
  type Style,
  type StyleRanges,
  type StyleReading,
  type StyleTrait,
} from "@desk/core";
import { setCueMarks } from "../editor/cueMarks.ts";
import { api } from "./api.ts";
import { useDoc } from "./docStore.ts";
import { languageName, useLanguages } from "./languages.ts";
import { useMenu } from "./Menu.tsx";
import { session } from "./session.ts";
import { styles, useStyles } from "./styles.ts";

/**
 * The card on the right. On a draft, in Style mode: the style it looks at, the draft's print on
 * the style's ranges, the style's traits checked on the draft, and the cues (where the draft moves
 * away from the style, with one of its passages, numbered on the page too). On a style file: what
 * Bluepencil reads in it, and its traits to fix or set aside. Nothing here rewrites the text.
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
          {error && (isStylePath(path) || !reference) && <p className="style-error">{error}</p>}
          {isStylePath(path) ? (
            <ThisStyle view={view} />
          ) : reference ? (
            <LookingAt key={reference} reference={reference} view={view} />
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

/** A draft that looks at no style yet: the styles in its language, a new one, the library. */
function Choose() {
  const { list, loaded } = useStyles();
  const lang = useDoc((s) => s.lang.code);
  const mine = list.filter((s) => !s.lang || s.lang === lang);
  return (
    <div className="style-choose">
      <p className="style-lead">
        Look at a style while you write: pieces of a book, articles, a text of yours that worked.
        Bluepencil shows where the draft moves away from it, and how the style does it.
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

/** The print: each measure of the draft on the style's range. */
function Print({ reading, legend }: { reading: StyleReading; legend: [string, string] }) {
  return (
    <section className="style-print" aria-label="Print">
      <div className="style-print-head">
        <span>Print</span>
        <span className="style-legend">
          <span className="style-dot" aria-hidden /> {legend[0]}
          <span className="style-band-key" aria-hidden /> {legend[1]}
        </span>
      </div>
      {reading.measures.map((m) => {
        const max = Math.max(m.hi * 1.5, m.value * 1.1, 1);
        const pct = (n: number) => `${Math.min(100, (n / max) * 100)}%`;
        return (
          <div className="style-measure" key={m.id} data-out={m.out ?? "no"}>
            <span className="style-measure-label">{STYLE_MEASURE_LABEL[m.id]}</span>
            <span className="style-track" aria-hidden>
              <span
                className="style-band"
                style={{ left: pct(m.lo), width: `calc(${pct(m.hi)} - ${pct(m.lo)})` }}
              />
              <span className="style-dot" style={{ left: pct(m.value) }} />
            </span>
            <span
              className="style-measure-value"
              data-tip={`${legend[0]} ${m.value} · ${legend[1]} ${m.lo}–${m.hi}`}
            >
              {m.out === "high" ? "more" : m.out === "low" ? "less" : m.value}
            </span>
          </div>
        );
      })}
    </section>
  );
}

/** A draft looking at a style. */
function LookingAt({ reference, view }: { reference: string; view: EditorView | null }) {
  const [style, setStyle] = useState<Style | null>(null);
  const [missing, setMissing] = useState(false);
  const path = useDoc((s) => s.path) ?? "";
  const bodyHash = useDoc((s) => s.bodyHash);
  const offset = useDoc((s) => s.bodyOffset);
  const body = useBody(view);
  const busy = useStyles((s) => s.busy);
  const error = useStyles((s) => s.error);
  const reading = useStyles((s) => s.reading.includes(reference));
  const found = useStyles((s) => s.tips[path]);
  const hidden = useStyles((s) => s.hidden[path]);
  // The style is read again when its traits or pieces change (the model reads in the background).
  const listed = useStyles((s) => s.list.find((x) => x.path === reference));

  useEffect(() => {
    let live = true;
    api.getDraft(reference).then(
      (d) => live && setStyle(readStyle(d.text)),
      () => live && setMissing(true),
    );
    return () => {
      live = false;
    };
  }, [reference, listed?.traits, listed?.pieces]);

  const ranges = useMemo<StyleRanges | null>(() => (style ? styleRanges(style) : null), [style]);
  const print = useMemo(() => (ranges ? readAgainst(body, ranges) : null), [body, ranges]);
  const result = found?.style === reference ? found : undefined;
  const shown = useMemo(
    () => (result?.tips ?? []).filter((t) => !hidden?.includes(t.quote)),
    [result, hidden],
  );

  // The cues on the page, numbered like the cards, placed where they are when they arrive (or
  // when one is set aside); afterwards the marks follow the text by themselves.
  useEffect(() => {
    if (!view) return;
    const text = view.state.sliceDoc(offset);
    view.dispatch({
      effects: setCueMarks.of(
        shown.flatMap((t, i) => {
          const at = text.indexOf(t.quote);
          return at < 0 ? [] : [{ from: offset + at, to: offset + at + t.quote.length, n: i + 1 }];
        }),
      ),
    });
  }, [view, offset, shown]);
  useEffect(() => () => view?.dispatch({ effects: setCueMarks.of([]) }), [view]);

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
  if (!style || !print) return <p className="notes-empty">Reading the style…</p>;

  const traits = activeTraits(style);
  const stale = result !== undefined && result.bodyHash !== bodyHash;
  const goTo = (quote: string) => {
    if (!view) return;
    const at = view.state.sliceDoc(offset).indexOf(quote);
    if (at < 0) return;
    const sel = EditorSelection.range(offset + at, offset + at + quote.length);
    view.dispatch({
      selection: sel,
      effects: EditorView.scrollIntoView(sel.from, { y: "center" }),
    });
    view.focus();
  };
  const check = (text: string) => result?.checks.find((c) => c.text === text);

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

      <Print reading={print} legend={["this draft", "the style"]} />
      {print.words < DRAFT_MIN_WORDS && (
        <p className="style-small">
          Under {DRAFT_MIN_WORDS} words the measures say little: keep writing.
        </p>
      )}
      {style.words < STYLE_MIN_WORDS && (
        <p className="style-small">
          The style has {style.words} words: with fewer than {STYLE_MIN_WORDS} its ranges are
          provisional.
        </p>
      )}

      <section className="style-traits" aria-label="Traits of the style, in the draft">
        <div className="notes-section">Traits of the style, in the draft</div>
        {reading ? (
          <p className="style-small">The model is reading the style’s traits…</p>
        ) : traits.length === 0 ? (
          <p className="style-small">No traits yet: open the style to read them.</p>
        ) : (
          <ul className="style-checks">
            {traits.map((t) => {
              const c = check(t.text);
              return (
                <li key={t.text} data-followed={c ? String(c.followed) : "unknown"}>
                  <span className="style-check-mark" aria-hidden>
                    {c ? (c.followed ? "✓" : "–") : "·"}
                  </span>
                  <span>
                    {t.text}
                    {c && !c.followed && c.quote && (
                      <>
                        {" "}
                        <button className="link-btn" onClick={() => goTo(c.quote!)}>
                          where
                        </button>
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {!result && traits.length > 0 && !reading && (
          <p className="style-small">“Find cues” also checks each trait on the draft.</p>
        )}
      </section>

      <section className="style-tips" aria-label="Cues">
        <div className="notes-section">Cues</div>
        {busy ? (
          <div className="style-busy">
            <span className="style-small">The model is reading the draft beside the style…</span>
            <button className="btn-secondary btn-small" onClick={styles.cancelTips}>
              Stop
            </button>
          </div>
        ) : (
          <button
            className="btn-primary btn-small style-primary"
            disabled={style.pieces.length === 0}
            onClick={() => void styles.findTips(path, reference, body, bodyHash)}
          >
            {result ? "Look again" : "Find cues"}
          </button>
        )}
        {error && !busy && <p className="style-error">{error}</p>}
        {stale && !busy && (
          <p className="style-small">The text has changed since: look again for fresh cues.</p>
        )}
        {result && shown.length === 0 && !busy && (
          <p className="notes-empty">
            {result.tips.length > 0
              ? "You set every cue aside."
              : "Nothing to point out: the draft is close to the style."}
          </p>
        )}
        {shown.length > 0 && (
          <ol className="notes-ol style-notes">
            {shown.map((t, i) => (
              <li key={t.quote} className="notes-item">
                <div className="note style-note">
                  <div className="style-note-text">
                    <span className="style-number">{i + 1}</span>
                    <span className="note-text">{t.tip}</span>
                  </div>
                  <p className="style-quote style-quote-draft">«{t.quote}»</p>
                  {t.example && <p className="style-quote">In the style: «{t.example}»</p>}
                  <div className="note-actions">
                    <button
                      className="btn-secondary btn-small"
                      disabled={!body.includes(t.quote)}
                      onClick={() => goTo(t.quote)}
                    >
                      Go to the passage
                    </button>
                    <button
                      className="btn-secondary btn-small"
                      onClick={() => styles.hide(path, t.quote)}
                    >
                      Not for this text
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

const STATE_NEXT: Record<NonNullable<StyleTrait["state"]>, StyleTrait["state"]> = {
  active: "fixed",
  fixed: "off",
  off: "active",
};
const STATE_LABEL = { active: "active", fixed: "fixed", off: "set aside" } as const;

/** Saves the traits in the open style file, then reloads it (the editor and the file agree). */
async function saveTraits(path: string, traits: StyleTrait[]) {
  if (await session.patchFrontMatter({ traits: traitsForFile(traits) })) {
    await session.open(path, true);
    void styles.load();
  }
}

/** A style file, open in the editor: what Bluepencil reads in it. */
function ThisStyle({ view }: { view: EditorView | null }) {
  const path = useDoc((s) => s.path) ?? "";
  const reading = useStyles((s) => s.reading.includes(path));
  const text = useDoc((s) => s.text);
  const body = useBody(view);
  const [added, setAdded] = useState("");
  // The traits come from the file as loaded; the pieces from the page as it is now.
  const style = useMemo(() => {
    const live = readStyle(`---\n---\n${body}`);
    return { ...readStyle(text), pieces: live.pieces, words: live.words };
  }, [text, body]);
  const ranges = useMemo(() => styleRanges(style), [style]);
  const print: StyleReading = {
    words: style.words,
    measures: STYLE_MEASURES.map((id) => ({
      id,
      value: Math.round(((ranges[id].lo + ranges[id].hi) / 2) * 10) / 10,
      ...ranges[id],
      out: null,
    })),
  };
  const read = async () => {
    await session.saveNow();
    void styles.readTraits(path);
  };

  return (
    <>
      <StyleLabels key={useDoc.getState().loadId} />
      <header className="style-head">
        <span className="style-small">
          {style.pieces.length} {style.pieces.length === 1 ? "piece" : "pieces"} ·{" "}
          {style.words.toLocaleString()} words. Each “##” heading on the page starts a piece.
        </span>
      </header>
      {style.pieces.length === 0 ? (
        <p className="style-lead">
          Paste a passage under each “##” heading, and write in the heading where it comes from.
          Three or four pieces of 300–800 words make a good style.
        </p>
      ) : (
        <>
          <Print reading={print} legend={["middle", "range"]} />
          {style.words < STYLE_MIN_WORDS && (
            <p className="style-small">
              Under {STYLE_MIN_WORDS} words the ranges are provisional: add a piece.
            </p>
          )}
          {style.words > STYLE_MAX_WORDS && (
            <p className="style-small">
              Over {STYLE_MAX_WORDS.toLocaleString()} words the style may not fit a small model’s
              context.
            </p>
          )}
        </>
      )}

      <section className="style-traits" aria-label="Traits">
        <div className="notes-section">Traits</div>
        {style.traits.length === 0 && !reading && (
          <p className="style-small">
            The model reads them in the pieces; you can also write your own.
          </p>
        )}
        <ul className="style-trait-list">
          {style.traits.map((t, i) => {
            const state = t.state ?? "active";
            return (
              <li key={`${t.text}-${i}`} data-state={state}>
                <span className="style-trait-text">
                  {t.text}
                  {t.quote && <span className="style-quote"> «{t.quote}»</span>}
                </span>
                <button
                  className="chip chip-small"
                  data-tip="Active → fixed (kept when the model reads again) → set aside"
                  onClick={() =>
                    void saveTraits(
                      path,
                      style.traits.map((x, j) =>
                        j === i ? { ...x, state: STATE_NEXT[state] } : x,
                      ),
                    )
                  }
                >
                  {STATE_LABEL[state]}
                </button>
              </li>
            );
          })}
        </ul>
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
        {reading ? (
          <p className="style-small">The model is reading the pieces…</p>
        ) : (
          <button
            className="btn-secondary btn-small"
            disabled={style.pieces.length === 0}
            onClick={() => void read()}
            data-tip="Your fixed traits and the ones set aside stay"
          >
            {style.traits.length ? "Read the traits again" : "Read the traits"}
          </button>
        )}
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
