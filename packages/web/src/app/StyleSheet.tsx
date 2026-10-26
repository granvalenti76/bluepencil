import type { EditorView } from "@codemirror/view";
import {
  DIMENSION_LABEL,
  formatMeasure,
  locatePassages,
  STYLE_DIMENSIONS,
  STYLE_MIN_WORDS,
  type StyleDimension,
} from "@desk/core";
import { ProcedureCard, TraitLine } from "./Procedures.tsx";
import { DimensionExtra, useThisStyle } from "./StylePanel.tsx";
import { styles } from "./styles.ts";

/** What each dimension looks at, under its name. */
const DIMENSION_KICKER: Record<StyleDimension, string> = {
  rhythm: "lengths and alternations",
  lexicon: "words and links",
  construction: "punctuation and syntax",
  voice: "who speaks, and when",
};

/**
 * What a style does, on the page, in place of its pieces: the style in brief, then its procedures
 * (where in a piece each one works, in how many pieces it happens, a passage where it does, the
 * numbers beside it, its state), those set aside at the end; the measures, closed; the pieces.
 */
export function StyleSheet({ view }: { view: EditorView | null }) {
  const { reading, style, schema, sentences, readAgain, setTraitState, setProcedureState } =
    useThisStyle(view);
  const kept = style.procedures.filter((p) => p.state !== "off");
  const aside = style.procedures.filter((p) => p.state === "off");
  const byPiece = style.pieces.map(
    (_, k) =>
      kept.filter((p) => locatePassages(style, p, sentences).some((l) => l.piece === k)).length,
  );

  return (
    <div className="schema-sheet">
      <article className="schema-page">
        <header className="schema-head">
          <span className="schema-kicker">Style · what it does</span>
          <h1 className="schema-title">{style.name}</h1>
          <p className="schema-labels">
            {style.author && (
              <span>
                <b>Author</b> {style.author}
              </span>
            )}
            {style.source && (
              <span>
                <b>Source</b> {style.source}
              </span>
            )}
            <span>
              <b>Read by the model</b> {style.pieces.length}{" "}
              {style.pieces.length === 1 ? "piece" : "pieces"} · {style.words.toLocaleString()}{" "}
              words
            </span>
          </p>
        </header>

        {style.pieces.length === 0 ? (
          <p className="style-lead">
            The style has no pieces yet: go back to the pieces and paste a few passages.
          </p>
        ) : (
          <>
            <section className="schema-brief" aria-label="In brief">
              {style.traits
                .filter((t) => t.dim === "summary")
                .map((t, i) => (
                  <TraitLine key={i} trait={t} onState={(state) => setTraitState(t, state)} />
                ))}
              <span className="style-said-row">
                {reading ? (
                  <span className="style-small">The model is reading the pieces…</span>
                ) : (
                  <button
                    className="btn-secondary btn-small"
                    onClick={() => void readAgain()}
                    data-tip="The procedures you kept or set aside stay"
                  >
                    {style.procedures.length ? "Read again" : "Read the style"}
                  </button>
                )}
              </span>
            </section>

            <section className="proc-section" aria-label="The procedures">
              <div className="proc-section-head">
                <h2>
                  The procedures
                  {style.procedures.length > 0 && (
                    <span>
                      {" "}
                      · {kept.length} kept or proposed
                      {aside.length ? `, ${aside.length} set aside` : ""}
                    </span>
                  )}
                </h2>
                <p>
                  Each one says where in a piece it works, in how many pieces it happens and where,
                  with a passage to see it. These are what the editor looks for in a draft.
                </p>
              </div>
              {style.procedures.length === 0 ? (
                <p className="style-small">
                  {reading
                    ? "The model is reading the pieces whole, to find what comes back in them…"
                    : "Not read yet: “Read the style” asks the model to find its procedures."}
                </p>
              ) : (
                <div className="proc-grid">
                  {[...kept, ...aside].map((p) => (
                    <ProcedureCard
                      key={p.name}
                      procedure={p}
                      style={style}
                      sentences={sentences}
                      schema={schema}
                      onState={(state) => setProcedureState(p, state)}
                    />
                  ))}
                </div>
              )}
            </section>

            <details className="schema-measures-box">
              <summary>
                <span className="schema-measures-title">The measures</span>
                <span className="style-small">
                  Rhythm, vocabulary, construction, voice: {schema.defs.length} measures taken by
                  Bluepencil on the pieces, with their ranges.
                </span>
              </summary>
              <div className="schema-grid">
                {STYLE_DIMENSIONS.map((dim) => {
                  const defs = schema.defs.filter((d) => d.dim === dim);
                  if (!defs.length) return null;
                  return (
                    <section key={dim} className="schema-dim" aria-label={DIMENSION_LABEL[dim]}>
                      <div className="schema-dim-head">
                        <h2>{DIMENSION_LABEL[dim]}</h2>
                        <span className="schema-kicker">{DIMENSION_KICKER[dim]}</span>
                      </div>
                      <DimensionExtra dim={dim} schema={schema} barsHeight={110} />
                      <dl className="schema-measures">
                        {defs.map((d) => {
                          const r = schema.ranges[d.id]!;
                          const lo = formatMeasure(d, r.lo);
                          const hi = formatMeasure(d, r.hi);
                          return (
                            <div key={d.id}>
                              <dt>{d.label}</dt>
                              <dd>{formatMeasure(d, r.all)}</dd>
                              <dd className="schema-range">
                                most passages {lo === hi ? lo : `${lo}–${hi}`}
                              </dd>
                            </div>
                          );
                        })}
                      </dl>
                    </section>
                  );
                })}
              </div>
            </details>

            <p className="schema-foot">
              The procedures are found by the model, once and in the background, reading the pieces
              whole. Each one carries the sentences where it happens: the passages above come from
              there, and a procedure with none is not proposed. The measures are Bluepencil’s,
              without the model; persons and tenses are estimates from the word endings.
              {style.words < STYLE_MIN_WORDS &&
                ` With ${style.words} words the ranges are provisional: add a piece or two.`}
            </p>
          </>
        )}
      </article>

      {style.pieces.length > 0 && (
        <section className="schema-pieces" aria-label="Pieces">
          <h2>
            Pieces <span>· {style.pieces.length}</span>
          </h2>
          <div className="schema-pieces-grid">
            {style.pieces.map((p, i) => (
              <button key={i} className="schema-piece" onClick={() => styles.toggleSchema()}>
                <span>{p.title || `Piece ${i + 1}`}</span>
                <small>
                  {p.words.toLocaleString()} words
                  {byPiece[i]
                    ? ` · ${byPiece[i]} ${byPiece[i] === 1 ? "procedure" : "procedures"}`
                    : ""}
                </small>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
