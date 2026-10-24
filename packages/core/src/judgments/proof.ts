/**
 * The proofreader's mark for a correction: inside the quote, the stretch to strike out and what
 * to write above it. Only the words that change, whole: "si può integrare" → "si possono
 * integrare" strikes "può" and writes "possono".
 */
export interface ProofEdit {
  /** Offset in the quote. */
  from: number;
  to: number;
  insert: string;
}

const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}'’]/u.test(c);
/** The boundary before `s[i]` falls inside a word. */
const midWord = (s: string, i: number) => isWordChar(s[i - 1]) && isWordChar(s[i]);

export function proofEdit(quote: string, replacement: string): ProofEdit {
  let pre = 0;
  while (pre < quote.length && pre < replacement.length && quote[pre] === replacement[pre]) pre++;
  let suf = 0;
  while (
    suf < quote.length - pre &&
    suf < replacement.length - pre &&
    quote[quote.length - 1 - suf] === replacement[replacement.length - 1 - suf]
  )
    suf++;
  // Whole words: never strike half a word.
  while (pre > 0 && (midWord(quote, pre) || midWord(replacement, pre))) pre--;
  while (
    suf > 0 &&
    (midWord(quote, quote.length - suf) || midWord(replacement, replacement.length - suf))
  )
    suf--;
  return {
    from: pre,
    to: quote.length - suf,
    insert: replacement.slice(pre, replacement.length - suf),
  };
}
