import { useMemo, useState, type ReactNode } from "react";
import {
  formatMeasure,
  locatePassages,
  PART_LABEL,
  pieceSentences,
  type LanguagePack,
  type LocatedPassage,
  type PieceSentence,
  type Procedure,
  type Style,
  type StyleSchema,
  type StyleTrait,
} from "@desk/core";

/**
 * The pieces a style is made of, and what the model read in them: its procedures, each with the
 * passages where it happens, on a slip of paper; the measures that stand beside it as evidence;
 * the state the author gave it. Shared by the style's page, its card and Style mode.
 */

/**
 * The rhythm: a bar per sentence, as long as the sentence, short ones in sienna; with paragraphs,
 * a gap between them, and a click on a paragraph goes there. The band is the style's usual length.
 */
export function RhythmBars({
  lengths,
  band,
  paragraphs,
  marked,
  onParagraph,
  height = 58,
}: {
  lengths: number[];
  band?: { lo: number; hi: number };
  paragraphs?: { first: number; sentences: number }[];
  marked?: Set<number>;
  onParagraph?: (p: number) => void;
  /** The height of the strip: a sentence of 35 words or more fills it. */
  height?: number;
}) {
  const h = (n: number) => Math.max(5, Math.min(height - 2, Math.round((n * height) / 36)));
  const bar = (n: number, k: number) => (
    <span key={k} className="style-bar" data-short={n <= 8} style={{ height: h(n) }} />
  );
  const groups = paragraphs ?? [{ first: 0, sentences: lengths.length }];
  return (
    <div className="style-bars" style={{ height }} aria-hidden>
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

/** Chips of words with how often they come; the ones never used struck through. */
export function Words({ used, never }: { used: { word: string; n: number }[]; never?: string[] }) {
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

type State = NonNullable<StyleTrait["state"]>;
const STATE_LABEL: Record<State, string> = { active: "Proposed", fixed: "Kept", off: "Set aside" };

/** The state the author gave a sentence or a procedure, and what can be done with it. */
export function StateRow({
  state = "active",
  onState,
}: {
  state?: State;
  onState: (state: State) => void;
}) {
  return (
    <div className="style-said-row">
      <span className="style-state" data-state={state}>
        {state === "fixed" ? "✓ " : ""}
        {STATE_LABEL[state]}
      </span>
      {state === "active" && (
        <button
          className="btn-secondary btn-small"
          data-tip="Kept when the model reads the style again"
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
  );
}

/** A sentence of the model (or the author's), with its state and what can be done with it. */
export function TraitLine({
  trait,
  onState,
}: {
  trait: StyleTrait;
  onState: (state: StyleTrait["state"]) => void;
}) {
  return (
    <div className="style-said" data-state={trait.state ?? "active"}>
      <p>{trait.text}</p>
      <StateRow state={trait.state} onState={onState} />
    </div>
  );
}

/** The sentences of a style's pieces, numbered: where its procedures are looked for. */
export function useSentences(style: Pick<Style, "pieces">, pack: LanguagePack): PieceSentence[] {
  return useMemo(() => pieceSentences(style, pack), [style, pack]);
}

/** Where a procedure happens in the pieces. */
export function useLocated(
  style: Pick<Style, "pieces">,
  procedure: Procedure | undefined,
  sentences: PieceSentence[],
): LocatedPassage[] {
  return useMemo(
    () => (procedure ? locatePassages(style, procedure, sentences) : []),
    [style, procedure, sentences],
  );
}

/**
 * A passage of the style on a slip of paper: the sentence where the procedure happens marked, the
 * one before and after it in its paragraph; the next passage on a click.
 */
export function PassageSlip({ passages, lead }: { passages: LocatedPassage[]; lead?: string }) {
  const [i, setI] = useState(0);
  const p = passages[i % passages.length];
  if (!p) return null;
  return (
    <figure className="slip">
      <span className="slip-tape" aria-hidden />
      <blockquote className="slip-text">
        {p.before && <>{p.before} </>}
        <mark>{p.passage}</mark>
        {p.after && <> {p.after}</>}
      </blockquote>
      <figcaption className="slip-src">
        <span>
          {lead ? `${lead} · ` : ""}
          {p.pieceTitle} · ¶{p.para}
        </span>
        {passages.length > 1 && (
          <button
            className="btn-secondary btn-small"
            aria-label="Another passage"
            onClick={() => setI((n) => (n + 1) % passages.length)}
          >
            {(i % passages.length) + 1} of {passages.length} ›
          </button>
        )}
      </figcaption>
    </figure>
  );
}

/** A dot per piece, filled where the procedure happens. */
export function PieceDots({ pieces, located }: { pieces: number; located: LocatedPassage[] }) {
  const inPieces = new Set(located.map((p) => p.piece));
  const n = inPieces.size;
  return (
    <span className="proc-where">
      <span className="proc-dots" aria-hidden>
        {Array.from({ length: pieces }, (_, k) => (
          <i key={k} data-in={inPieces.has(k)} />
        ))}
      </span>
      {n === 0
        ? "no passage found"
        : n === pieces && pieces > 1
          ? `in all ${pieces} pieces`
          : `in ${n} of ${pieces} ${pieces === 1 ? "piece" : "pieces"}`}
    </span>
  );
}

const tenseDefs = (schema: StyleSchema) => schema.defs.filter((d) => d.id.startsWith("tense"));

/**
 * The style's measures that stand beside a procedure, by the part of the piece it works on: the
 * rhythm beside a paragraph's close, the connectives beside the links, and so on. The code's
 * numbers, not the model's.
 */
export function ProcedureEvidence({
  procedure,
  schema,
}: {
  procedure: Pick<Procedure, "part">;
  schema: StyleSchema;
}) {
  const r = schema.ranges;
  const def = (id: string) => schema.defs.find((x) => x.id === id);
  const all = (id: string) => {
    const d = def(id);
    return d && r[id] ? formatMeasure(d, r[id].all) : null;
  };
  const most = (id: string) => {
    const d = def(id);
    return d && r[id] ? `${formatMeasure(d, r[id].lo)}–${formatMeasure(d, r[id].hi)}` : null;
  };
  let body: ReactNode = null;
  switch (procedure.part) {
    case "paragraph":
      body = (
        <>
          {schema.rhythm.length > 0 && (
            <RhythmBars lengths={schema.rhythm.slice(0, 30)} height={44} />
          )}
          <span className="style-small">
            {schema.lastShort}% of the paragraphs close on a short sentence
            {all("shortAfterLong")
              ? ` · after a long sentence, a short one ${all("shortAfterLong")} of the time`
              : ""}
          </span>
        </>
      );
      break;
    case "sentence":
      body = (
        <span className="style-small">
          {all("sentenceLength")} words per sentence
          {most("sentenceLength") ? ` (most passages ${most("sentenceLength")})` : ""}
          {all("shortSentences") ? ` · short sentences ${all("shortSentences")}` : ""}
          {all("commas") ? ` · ${all("commas")} commas per sentence` : ""}
        </span>
      );
      break;
    case "links":
      if (schema.connectives.length || schema.unused.length) {
        body = <Words used={schema.connectives.slice(0, 6)} never={schema.unused} />;
      }
      break;
    case "words":
      if (schema.recurring.length) body = <Words used={schema.recurring} />;
      break;
    case "time": {
      const tenses = tenseDefs(schema);
      if (tenses.length) {
        body = (
          <span className="style-small">
            {tenses.map((d) => `${d.label} ${formatMeasure(d, r[d.id]!.all)}`).join(" · ")}
          </span>
        );
      }
      break;
    }
    case "voice": {
      const said = [
        all("firstPerson") && `first person ${all("firstPerson")}`,
        all("questions") && `${all("questions")} questions per 1,000 words`,
        all("dialogue") && `dialogue ${all("dialogue")}`,
      ].filter(Boolean);
      if (said.length) body = <span className="style-small">{said.join(" · ")}</span>;
      break;
    }
  }
  if (!body) return null;
  return (
    <div className="proc-ev">
      <span className="proc-ev-label">The numbers beside it</span>
      {body}
    </div>
  );
}

/** A procedure of the style, whole: where it works, how often, a passage, the numbers, its state. */
export function ProcedureCard({
  procedure,
  style,
  sentences,
  schema,
  onState,
}: {
  procedure: Procedure;
  style: Pick<Style, "pieces">;
  sentences: PieceSentence[];
  schema: StyleSchema;
  onState: (state: State) => void;
}) {
  const located = useLocated(style, procedure, sentences);
  const off = procedure.state === "off";
  return (
    <section className="proc-card" data-state={procedure.state ?? "active"}>
      <div className="proc-top">
        <span className="proc-part">
          {procedure.part ? PART_LABEL[procedure.part] : "Procedure"}
        </span>
        {!off && <PieceDots pieces={style.pieces.length} located={located} />}
      </div>
      <h3 className="proc-name">{procedure.name}</h3>
      {procedure.text && <p className="proc-text">{procedure.text}</p>}
      {!off && located.length > 0 && <PassageSlip passages={located} />}
      {!off && <ProcedureEvidence procedure={procedure} schema={schema} />}
      <StateRow state={procedure.state} onState={onState} />
    </section>
  );
}
