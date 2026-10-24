/**
 * The language of a draft. The languages the app knows are those of the installed packs:
 * built-in (`it`, `en`) and the user's.
 */

/** Without `lang` a draft is Italian: older drafts stay as they are. */
export const DEFAULT_LANGUAGE = "it";

/** The packs built into the app. */
export const BUILTIN_LANGUAGES = ["it", "en"] as const;

export interface DraftLanguage {
  /** The language the app uses for the draft: the code of an installed pack. */
  code: string;
  /** What the front matter says, as is (even a code the app does not know). */
  declared: string | undefined;
  /** `declared` is set but has no pack: the app uses `code` and says so. */
  unknown: boolean;
}

/**
 * The language of a draft from the front matter's `lang` field, among the installed ones
 * (`known`). Case does not matter ("EN", "pt-br"): the code is the pack's.
 */
export function draftLanguage(
  lang: unknown,
  known: readonly string[] = BUILTIN_LANGUAGES,
): DraftLanguage {
  const declared = typeof lang === "string" && lang.trim() !== "" ? lang.trim() : undefined;
  if (declared === undefined) return { code: DEFAULT_LANGUAGE, declared, unknown: false };
  const code = known.find((k) => k.toLowerCase() === declared.toLowerCase());
  return code
    ? { code, declared, unknown: false }
    : { code: DEFAULT_LANGUAGE, declared, unknown: true };
}
