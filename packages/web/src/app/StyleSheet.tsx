import type { EditorView } from "@codemirror/view";
import {
  DIMENSION_LABEL,
  formatMeasure,
  STYLE_DIMENSIONS,
  STYLE_MIN_WORDS,
  type StyleDimension,
  type TraitDim,
} from "@desk/core";
import { DimensionExtra, TraitLine, useThisStyle } from "./StylePanel.tsx";
import { styles } from "./styles.ts";

/** What each dimension looks at, under its name. */
const DIMENSION_KICKER: Record<StyleDimension, string> = {
  rhythm: "lengths and alternations",
  lexicon: "words and links",
  construction: "punctuation and syntax",
  voice: "who speaks, and when",
};

/**
 * The schema of a style on the page, in place of its pieces: the style in brief, then its four
 * dimensions side by side, each with the model's sentence (to keep or set aside), what the code
 * draws (rhythm bars, words, how sentences open) and its measures with the range of the pieces.
 * No sentence of the pieces appears here.
 */
export function StyleSheet({ view }: { view: EditorView | null }) {
  const { reading, style, schema, describe, setState } = useThisStyle(view);
  const sentences = (dim: TraitDim) =>
    style.traits
      .filter((t) => t.dim === dim)
      .map((t, i) => (
        <TraitLine key={`${dim}-${i}`} trait={t} onState={(state) => setState(t, state)} />
      ));
  const described = style.traits.some((t) => t.dim);

  return (
    <div className="schema-sheet">
      <article className="schema-page">
        <header className="schema-head">
          <span className="schema-kicker">Style · schema of the writing</span>
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
              <b>Measured on</b> {style.pieces.length}{" "}
              {style.pieces.length === 1 ? "piece" : "pieces"} · {style.words.toLocaleString()}{" "}
              words · {schema.sentences} sentences
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
              {sentences("summary")}
              {!described && !reading && (
                <p className="style-small">The model has not put this style into words yet.</p>
              )}
              <span className="style-said-row">
                {reading ? (
                  <span className="style-small">The model is putting the schema into words…</span>
                ) : (
                  <button
                    className="btn-secondary btn-small"
                    onClick={() => void describe()}
                    data-tip="The sentences you kept or set aside stay"
                  >
                    {described ? "Describe again" : "Describe in words"}
                  </button>
                )}
              </span>
            </section>

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
                    {sentences(dim)}
                  </section>
                );
              })}
            </div>

            <p className="schema-foot">
              The measures come from the pieces, without the model; persons and tenses are estimates
              from the word endings. The model only writes the sentences in italics. No sentence of
              the pieces appears here.
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
                <small>{p.words.toLocaleString()} words</small>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
