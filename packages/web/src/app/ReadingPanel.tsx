import { useState } from "react";
import {
  LONG_SENTENCE,
  readabilityLevel,
  sentenceLengthLevel,
  type ReadabilityConfig,
  type ScoreKind,
} from "@desk/core";
import { useDoc } from "./docStore.ts";
import { languageName, usePack } from "./languages.ts";
import { shownPass, usePasses } from "./passes.ts";
import { session } from "./session.ts";
import { isCurrent, useScores } from "./scores.ts";

const LEVEL_LABEL = { easy: "easy", medium: "demanding", hard: "hard" } as const;

const SCORE_LABEL: Record<ScoreKind, string> = { prose: "Prose", structure: "Structure" };

const R = 19;
const C = 2 * Math.PI * R;

/** A circular 0–100 indicator that fills with an animation. */
function Ring(props: {
  label: string;
  value: number | null;
  /** What to write in the centre, if not `value` (e.g. words per sentence). */
  display?: string;
  note: string;
  tip: string;
  tone: "clarity" | "prose" | "structure";
  stale?: boolean;
  testId: string;
}) {
  const { label, value, display, note, tip, tone, stale, testId } = props;
  const filled = value === null ? 0 : (value / 100) * C;
  return (
    <div
      className="ring"
      data-testid={testId}
      data-tone={tone}
      data-stale={stale ?? false}
      data-tip={tip}
      tabIndex={0}
      aria-label={`${label}: ${display ?? value ?? "no value"}, ${note}`}
    >
      <svg viewBox="0 0 48 48" aria-hidden>
        <circle className="ring-track" cx="24" cy="24" r={R} />
        <circle
          className="ring-fill"
          cx="24"
          cy="24"
          r={R}
          strokeDasharray={`${filled} ${C}`}
          transform="rotate(-90 24 24)"
        />
      </svg>
      <span className="ring-value reading-value">{display ?? value ?? "—"}</span>
      <span className="ring-label">{label}</span>
      <span className="ring-note reading-note">{note}</span>
    </div>
  );
}

const CLARITY_TIP: Record<ReadabilityConfig["formula"], string> = {
  gulpease: "Gulpease index: short sentences and words = clearer text. Updates as you type.",
  flesch:
    "Flesch Reading Ease: short sentences and words with few syllables = clearer text. Updates as you type.",
  sentences: `Average words per sentence: up to 20 reads easily, over ${LONG_SENTENCE} is demanding. Updates as you type.`,
};

/** With the "sentences" formula the ring fills by level: there is no score. */
const LEVEL_FILL = { easy: 85, medium: 55, hard: 25 } as const;

/**
 * Reading the text: reading time, clarity from the readability index of the draft's language
 * (computed while writing) and the model's scores on prose and structure (from the last analysis;
 * "outdated" if the text has changed since). The indices belong to the prose pass: elsewhere they
 * show only when opened.
 */
export function ReadingPanel() {
  const { counts, lang } = useDoc();
  const prose = usePasses((s) => shownPass(s) === "prose");
  const [opened, setOpened] = useState(false);
  const open = prose || opened;
  const formula = usePack(lang.code).readability.formula;
  useDoc((s) => s.bodyHash); // redraw when the fingerprint changes (scores outdated)
  const byKind = useScores((s) => s.byKind);
  const g = counts.readability;
  return (
    <section className="reading" aria-label="Readability">
      <div className="reading-head">
        {prose ? (
          <span className="panel-title">Readability</span>
        ) : (
          <button
            type="button"
            className="panel-title reading-toggle"
            aria-expanded={opened}
            onClick={() => setOpened((o) => !o)}
          >
            Readability
          </button>
        )}
        <span className="reading-time">
          {counts.minutes} min · {counts.words.toLocaleString("en-US")} words
        </span>
      </div>
      {lang.unknown && (
        <p className="reading-lang" data-tone="warn" role="note">
          Language “{lang.declared}” isn’t supported yet: treated as Italian.
        </p>
      )}
      <LanguageSuggestion />
      {open && (
        <div className="rings">
          {formula === "sentences" ? (
            <SentenceRing average={counts.averageSentence} long={counts.longSentences ?? 0} />
          ) : (
            <Ring
              testId="score-clarity"
              tone="clarity"
              label="Clarity"
              value={g}
              note={g === null ? "text too short" : LEVEL_LABEL[readabilityLevel(g, formula)]}
              tip={CLARITY_TIP[formula]}
            />
          )}
          {(["prose", "structure"] as const).map((kind) => {
            const s = byKind[kind];
            const stale = s ? isCurrent(s) === false : false;
            return (
              <Ring
                key={kind}
                testId={`score-${kind}`}
                tone={kind}
                label={SCORE_LABEL[kind]}
                value={s?.value ?? null}
                stale={stale}
                note={!s ? "not checked" : stale ? "out of date" : "by the model"}
                tip={
                  s
                    ? `${s.reason || "The model’s score."}${stale ? " The text has changed: run the check again." : ""}`
                    : `The model’s score: run the ${kind === "prose" ? "prose" : "structure"} check.`
                }
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

/** The languages the author chose to keep, per draft: the proposal does not come back. */
const kept = new Map<string, string>();

/**
 * The text looks like another language: proposes changing `lang`. Writes to the front matter
 * only on click.
 */
function LanguageSuggestion() {
  const { path, lang, detectedLang } = useDoc();
  const [, redraw] = useState(0);
  if (!path || !detectedLang || detectedLang === lang.code) return null;
  if (kept.get(path) === `${lang.code}>${detectedLang}`) return null;
  const name = languageName(detectedLang);
  const current = lang.unknown ? lang.declared : languageName(lang.code);
  const set = async () => {
    if (await session.patchFrontMatter({ lang: detectedLang })) await session.open(path, true);
  };
  const keep = () => {
    kept.set(path, `${lang.code}>${detectedLang}`);
    redraw((n) => n + 1);
  };
  return (
    <p className="reading-lang reading-suggest" role="note">
      This draft looks written in {name}.{" "}
      <button type="button" className="link-btn" onClick={() => void set()}>
        Set language
      </button>{" "}
      ·{" "}
      <button type="button" className="link-btn" onClick={keep}>
        Keep {current}
      </button>
    </p>
  );
}

/** Without a formula for the language: average words per sentence, and how many sentences are long. */
function SentenceRing({ average, long }: { average: number | undefined; long: number }) {
  const level = average === undefined ? null : sentenceLengthLevel(average);
  return (
    <Ring
      testId="score-clarity"
      tone="clarity"
      label="Clarity"
      value={level ? LEVEL_FILL[level] : null}
      display={average === undefined ? undefined : String(Math.round(average))}
      note={
        average === undefined ? "text too short" : `words/sentence${long ? ` · ${long} long` : ""}`
      }
      tip={CLARITY_TIP.sentences}
    />
  );
}
