import { useEffect, useMemo, useRef, useState } from "react";
import { countWords, STYLE_MAX_WORDS, STYLE_MIN_WORDS } from "@desk/core";
import type { StyleSummary } from "./api.ts";
import { useDoc } from "./docStore.ts";
import { languageName, useLanguages } from "./languages.ts";
import { lastLanguage } from "./lastLanguage.ts";
import { LanguageField } from "./NewDraftDialog.tsx";
import { styles, useStyles, type StyleDialog } from "./styles.ts";

/** The library and the two windows: whichever is open. */
export function StyleOverlays() {
  const libraryOpen = useStyles((s) => s.libraryOpen);
  const dialog = useStyles((s) => s.dialog);
  return (
    <>
      {libraryOpen && <StyleLibrary />}
      {dialog?.kind === "new" && <NewStyleDialog dialog={dialog} />}
      {dialog?.kind === "add" && <AddToStyleDialog dialog={dialog} />}
    </>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

const matches = (s: StyleSummary, q: string) =>
  [s.name, s.author, s.source, ...s.tags].some((x) => x.toLowerCase().includes(q));

/** The library: every style as a card, a search, and a new one. */
function StyleLibrary() {
  const { list, loaded, reading, error } = useStyles();
  const current = useDoc((s) => s.path);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q ? list.filter((s) => matches(s, q)) : list;
  useEscape(styles.closeLibrary);
  return (
    <div
      className="library-layer"
      onMouseDown={(e) => e.target === e.currentTarget && styles.closeLibrary()}
    >
      <section className="library" role="dialog" aria-modal="true" aria-labelledby="library-title">
        <header className="library-head">
          <h2 id="library-title">Styles</h2>
          <span className="style-small">
            {list.length} {list.length === 1 ? "style" : "styles"} · from books, articles and texts
            of yours
          </span>
          <span className="grow" />
          <input
            className="library-search"
            type="search"
            value={query}
            aria-label="Search the styles"
            placeholder="Search by name, author, label"
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="icon-btn" aria-label="Close" onClick={styles.closeLibrary}>
            ×
          </button>
        </header>
        {error && <p className="style-error">{error}</p>}
        <div className="library-grid">
          {shown.map((s) => (
            <button
              key={s.path}
              className="library-card"
              aria-current={s.path === current}
              onClick={() => styles.open(s.path, s.pieces > 0)}
            >
              <span className="library-card-name">{s.name}</span>
              <span className="style-small">
                {[s.author, s.source].filter(Boolean).join(" · ") || "No author or source yet"}
              </span>
              {s.summary ? (
                <span className="library-card-quote library-card-summary">{s.summary}</span>
              ) : (
                s.quote && <span className="library-card-quote">«{s.quote}»</span>
              )}
              {s.tags.length > 0 && (
                <span className="library-tags">
                  {s.tags.map((t) => (
                    <span key={t} className="library-tag">
                      {t}
                    </span>
                  ))}
                </span>
              )}
              <span className="library-card-foot">
                <span>
                  {s.pieces} {s.pieces === 1 ? "piece" : "pieces"} · {s.words.toLocaleString()}{" "}
                  words{s.lang ? ` · ${s.lang}` : ""}
                </span>
                <span>
                  {reading.includes(s.path)
                    ? "reading the pieces…"
                    : s.usedIn
                      ? `in ${s.usedIn} ${s.usedIn === 1 ? "draft" : "drafts"}`
                      : "not used yet"}
                </span>
              </span>
            </button>
          ))}
          <button
            className="library-card library-new"
            onClick={() => styles.newStyle({ lookAt: false })}
          >
            <span className="library-new-plus">+</span>
            <span className="library-new-label">New style</span>
            <span className="style-small">paste three or four pieces</span>
          </button>
        </div>
        {loaded && list.length > 0 && shown.length === 0 && (
          <p className="notes-empty">No style matches «{query}».</p>
        )}
      </section>
    </div>
  );
}

interface PieceDraft {
  title: string;
  text: string;
}

/**
 * The "New style" window: the labels, then the pieces pasted one by one, each with where it comes
 * from. Bluepencil writes the file; the model reads its procedures right after.
 */
function NewStyleDialog({ dialog }: { dialog: Extract<StyleDialog, { kind: "new" }> }) {
  const draftLang = useDoc((s) => s.lang.code);
  const draftOpen = useDoc((s) => s.path !== null);
  const packs = useLanguages((s) => s.packs);
  const [name, setName] = useState("");
  const [author, setAuthor] = useState("");
  const [source, setSource] = useState("");
  const [tags, setTags] = useState("");
  const [lang, setLang] = useState(() => (draftOpen ? draftLang : lastLanguage()));
  const [pieces, setPieces] = useState<PieceDraft[]>(() =>
    dialog.piece ? [dialog.piece] : [{ title: "", text: "" }],
  );
  const [busy, setBusy] = useState(false);
  const error = useStyles((s) => s.error);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);
  useEscape(styles.closeDialog);

  const words = useMemo(() => pieces.reduce((a, p) => a + countWords(p.text), 0), [pieces]);
  const filled = pieces.filter((p) => p.text.trim()).length;
  const set = (i: number, patch: Partial<PieceDraft>) =>
    setPieces((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const ok = await styles.create(
      {
        name: name.trim(),
        lang,
        author: author.trim(),
        source: source.trim(),
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        pieces: pieces.filter((p) => p.text.trim()),
      },
      dialog.lookAt,
    );
    if (!ok) setBusy(false);
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && styles.closeDialog()}
    >
      <form
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-style-title"
        onSubmit={submit}
      >
        <h2 id="new-style-title">New style</h2>
        <div className="style-labels-grid">
          <label>
            Name
            <input
              ref={nameRef}
              value={name}
              placeholder="e.g. Dry local news"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Author
            <input
              value={author}
              placeholder="who wrote it"
              onChange={(e) => setAuthor(e.target.value)}
            />
          </label>
          <label>
            Source
            <input
              value={source}
              placeholder="a book, a newspaper, your blog"
              onChange={(e) => setSource(e.target.value)}
            />
          </label>
          <label>
            Labels
            <input
              value={tags}
              placeholder="news, short sentences"
              onChange={(e) => setTags(e.target.value)}
            />
          </label>
          {packs.length > 1 && <LanguageField value={lang} onChange={setLang} />}
        </div>

        <div className="style-pieces">
          {pieces.map((p, i) => (
            <fieldset key={i} className="style-piece">
              <legend>Piece {i + 1}</legend>
              <input
                value={p.title}
                aria-label={`Where piece ${i + 1} comes from`}
                placeholder="Where it comes from: a chapter, an article, a date"
                onChange={(e) => set(i, { title: e.target.value })}
              />
              <textarea
                value={p.text}
                aria-label={`Text of piece ${i + 1}`}
                placeholder="Paste a passage: 300–800 words is ideal"
                rows={i === 0 ? 8 : 5}
                onChange={(e) => set(i, { text: e.target.value })}
              />
              <span className="style-small">
                {countWords(p.text).toLocaleString()} words
                {pieces.length > 1 && (
                  <>
                    {" · "}
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => setPieces((ps) => ps.filter((_, j) => j !== i))}
                    >
                      remove
                    </button>
                  </>
                )}
              </span>
            </fieldset>
          ))}
          <button
            type="button"
            className="btn-secondary btn-small"
            disabled={pieces.length >= 20}
            onClick={() => setPieces((ps) => [...ps, { title: "", text: "" }])}
          >
            + Another piece
          </button>
        </div>

        <p className="style-small">
          {filled === 0
            ? "You can also create it empty and paste the pieces into the file later."
            : `${filled} ${filled === 1 ? "piece" : "pieces"} · ${words.toLocaleString()} words. ${
                words < STYLE_MIN_WORDS
                  ? `With fewer than ${STYLE_MIN_WORDS} words the style is provisional. `
                  : words > STYLE_MAX_WORDS
                    ? `Over ${STYLE_MAX_WORDS.toLocaleString()} words a small model may not hold it all. `
                    : ""
              }The model reads what the style does right after.`}
          {dialog.lookAt && " The draft will look at it."}
        </p>
        {error && <p className="modal-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={styles.closeDialog}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary style-primary"
            disabled={!name.trim() || busy}
          >
            Create style
          </button>
        </div>
      </form>
    </div>
  );
}

/** "To a style": the selected passage becomes a piece of a style, or the first of a new one. */
function AddToStyleDialog({ dialog }: { dialog: Extract<StyleDialog, { kind: "add" }> }) {
  const { list, loaded, error } = useStyles();
  const reference = useDoc((s) => s.reference);
  const lang = useDoc((s) => s.lang.code);
  const [title, setTitle] = useState(dialog.title);
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEscape(styles.closeDialog);
  // The style the draft looks at first, then those in the draft's language, then the others.
  const ordered = useMemo(() => {
    const rank = (s: StyleSummary) =>
      s.path === reference ? 0 : !s.lang || s.lang === lang ? 1 : 2;
    return [...list].sort((a, b) => rank(a) - rank(b));
  }, [list, reference, lang]);
  const chosen = target ?? ordered[0]?.path ?? null;
  const words = countWords(dialog.text);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && styles.closeDialog()}
    >
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-style-title"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!chosen || busy) return;
          setBusy(true);
          if (!(await styles.addPiece(chosen, dialog.text, title.trim()))) setBusy(false);
        }}
      >
        <h2 id="add-style-title">To a style</h2>
        <p className="style-quote style-excerpt">{dialog.text}</p>
        <span className="style-small">{words.toLocaleString()} words</span>
        <label>
          Where it comes from
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        {loaded && ordered.length > 0 && (
          <fieldset className="style-targets">
            <legend>Add it to</legend>
            {ordered.map((s) => (
              <label key={s.path} className="check-row">
                <input
                  type="radio"
                  name="style-target"
                  checked={chosen === s.path}
                  onChange={() => setTarget(s.path)}
                />
                <span>
                  {s.name}
                  <span className="style-small">
                    {" "}
                    · {s.pieces} {s.pieces === 1 ? "piece" : "pieces"}
                    {s.lang && s.lang !== lang ? ` · ${languageName(s.lang)}` : ""}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {error && <p className="modal-error">{error}</p>}
        <div className="modal-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              styles.newStyle({ piece: { text: dialog.text, title: title.trim() }, lookAt: false })
            }
          >
            New style from this
          </button>
          <span className="grow" />
          <button type="button" className="btn-secondary" onClick={styles.closeDialog}>
            Cancel
          </button>
          <button type="submit" className="btn-primary style-primary" disabled={!chosen || busy}>
            Add
          </button>
        </div>
      </form>
    </div>
  );
}
