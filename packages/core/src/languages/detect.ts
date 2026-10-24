/** Recognising a language needs only its pack: code and most frequent words. */
export interface DetectableLanguage {
  code: string;
  commonWords: readonly string[];
}

/** Below this many words a text is too short to tell its language. */
const MIN_WORDS = 30;
/** How many common words the winning language needs, and by how much it must beat the second. */
const MIN_HITS = 8;
const MARGIN = 2;

/**
 * The language of a text among the installed packs, counting their most common words
 * (articles, prepositions, conjunctions). `null` if the text is short or no language beats the
 * others by a clear margin: better to propose nothing than the wrong language.
 */
export function detectLanguage(
  text: string,
  languages: readonly DetectableLanguage[],
): string | null {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < MIN_WORDS) return null;
  const scores = languages.map((l) => {
    const common = new Set(l.commonWords.map((w) => w.toLowerCase()));
    let hits = 0;
    for (const w of words) if (common.has(w)) hits++;
    return { code: l.code, hits };
  });
  scores.sort((a, b) => b.hits - a.hits);
  const [best, second] = scores;
  if (!best || best.hits < MIN_HITS) return null;
  if (second && best.hits < MARGIN * second.hits) return null;
  return best.code;
}
