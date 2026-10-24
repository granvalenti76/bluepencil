import type { LanguagePack } from "../languages/pack.ts";

// The prompt text lives in the language packs (`packages/core/languages/<code>/prompts/`).
// Every text change requires bumping the version in `language.json` (`promptVersions`):
// the version is part of the fingerprint and invalidates the cache.

/** The system message of the analyses. */
export const systemPrompt = (pack: LanguagePack): string => pack.prompts.system;
