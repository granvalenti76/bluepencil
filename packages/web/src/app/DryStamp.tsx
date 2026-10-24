import { useDoc } from "./docStore.ts";
import { motion } from "./motion.ts";

/**
 * The sign-off's blind stamp: embossed in the corner of the page, only if the sign-off is for the
 * current text.
 */
export function DryStamp() {
  const { signoff, bodyHash } = useDoc();
  if (!signoff || !bodyHash || signoff.body !== bodyHash.slice(0, 12)) return null;
  const year = new Date(signoff.at).getFullYear();
  return (
    <svg
      className="dry-stamp"
      viewBox="0 0 128 128"
      role="img"
      aria-label="Dry seal: Visto si stampi"
      data-fresh={motion.justSigned()}
    >
      <defs>
        <path id="dry-ring" d="M64 64 m-44 0 a44 44 0 1 1 88 0 a44 44 0 1 1 -88 0" />
      </defs>
      <circle cx="64" cy="64" r="58" fill="none" strokeWidth="2.4" />
      <circle cx="64" cy="64" r="53" fill="none" strokeWidth="1" />
      <circle cx="64" cy="64" r="34" fill="none" strokeWidth="1" />
      <text fontSize="11.5" letterSpacing="2.6">
        <textPath href="#dry-ring">{`VISTO SI STAMPI · BLUEPENCIL · ${year} ·`}</textPath>
      </text>
      <text x="64" y="78" textAnchor="middle" fontStyle="italic" fontSize="42">
        B
      </text>
    </svg>
  );
}
