import { REVIEW_ORDER } from "@desk/core";
import { useAuthorship, writtenByYou } from "./authorship.ts";
import { useDialog } from "./dialogs.ts";
import { useDoc } from "./docStore.ts";
import { motion } from "./motion.ts";
import { hasCard } from "./notes.ts";
import { passes } from "./passes.ts";
import { session } from "./session.ts";
import { useJudgments } from "./store.ts";

/** The sign-off is tied to a body: the first 12 characters of its sha256. */
const short = (hash: string) => hash.slice(0, 12);

/**
 * The sign-off, once the review is finished. Only an open facts note blocks it. Once signed:
 * stamp, review summary and publishing. If the text changes, the file is not touched: it says the
 * sign-off belongs to an earlier version.
 */
export function SignOff() {
  const notes = useJudgments((s) => s.notes);
  const { signoff, bodyHash } = useDoc();
  const words = useDoc((s) => s.counts.words);
  const { authoredWords, lost } = useAuthorship();
  const show = useDialog((s) => s.show);
  const cards = notes.filter((n) => n.status !== "stale" && hasCard(n));
  const openFacts = cards.filter((n) => n.pass === "facts" && n.status === "open").length;
  const leftOpen = cards.filter((n) => n.status === "open").length;
  const current = signoff !== null && bodyHash !== "" && signoff.body === short(bodyHash);

  // The front matter returned by the server also updates the draft's state (session.ts).
  const sign = () => {
    motion.signed();
    void session.patchFrontMatter({
      signoff: { at: new Date().toISOString(), body: short(bodyHash) },
    });
  };

  if (!current) {
    return (
      <div className="pass-head" role="group" aria-label="Review">
        <span className="pass-head-title">Review complete</span>
        <span className="pass-head-note">
          {signoff
            ? "signed off on an earlier version"
            : leftOpen
              ? `${leftOpen} left open`
              : "nothing left open"}
        </span>
        <span className="grow" />
        <button className="pass-link" onClick={() => void passes.restart()}>
          Restart
        </button>
        <button
          className="pass-btn pass-btn-primary"
          disabled={openFacts > 0 || !bodyHash}
          data-tip={
            openFacts > 0
              ? `${openFacts} claims still open: source them, mark them as your opinion, or ignore them`
              : "The piece is ready: sign it off for publishing"
          }
          onClick={sign}
        >
          {signoff ? "Sign off again" : "Sign off"}
        </button>
      </div>
    );
  }

  const at = new Date(signoff.at);
  const date = at.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
  const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const by = (status: string) => cards.filter((n) => n.status === status).length;
  const lostWords = lost.reduce((n, s) => n + s.words, 0);
  // The signature is the author's, in ink: two different hands.
  return (
    <section className="signoff" aria-label="Signed off">
      <dl className="record">
        <div>
          <dt>{cards.length}</dt>
          <dd>notes in {REVIEW_ORDER.length} passes</dd>
        </div>
        <div>
          <dt>{by("applied")}</dt>
          <dd>accepted</dd>
        </div>
        <div>
          <dt>{by("ignored")}</dt>
          <dd>kept your way</dd>
        </div>
        <div>
          <dt>{writtenByYou(words, authoredWords, lostWords)}%</dt>
          <dd>written by you</dd>
        </div>
      </dl>
      <div
        className="signature"
        role="img"
        aria-label={`Signed off on ${date} at ${time}`}
        data-fresh={motion.justSigned()}
      >
        <span className="signature-label">Your sign-off</span>
        <span className="signature-hand">
          {/* Right after signing off, the nib writes the signature. */}
          <span className="signature-pen">
            <span className="signature-ink">Visto, si stampi</span>
            <NibIcon />
          </span>
        </span>
        <span className="signature-date">
          {date} · {time}
        </span>
      </div>
      <div className="signoff-actions">
        <button className="pass-btn pass-btn-primary" onClick={() => show("publish")}>
          Publish…
        </button>
        <button className="pass-link" onClick={() => void passes.restart()}>
          Restart review
        </button>
      </div>
      <span className="letter-meta">Editing the text lifts the sign-off.</span>
    </section>
  );
}

/** The fountain pen's nib: the tip at the bottom left, on the stroke. */
function NibIcon() {
  return (
    <svg className="nib" viewBox="0 0 20 40" aria-hidden>
      <path d="M10 1 C15 9 18 18 17 26 L10 39 L3 26 C2 18 5 9 10 1 Z" />
      <path className="nib-slit" d="M10 18 L10 38" />
      <circle className="nib-hole" cx="10" cy="17" r="1.8" />
    </svg>
  );
}
