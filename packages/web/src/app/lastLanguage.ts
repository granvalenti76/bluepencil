import { DEFAULT_LANGUAGE } from "@desk/core";
import { useLanguages } from "./languages.ts";

const KEY = "desk.lastLanguage";

/**
 * The language of the last draft created in this browser: the default for the next one, if its
 * pack still exists.
 */
export function lastLanguage(): string {
  let v: string | null = null;
  try {
    v = localStorage.getItem(KEY);
  } catch {
    /* without localStorage, start again from Italian */
  }
  return v && useLanguages.getState().packs.some((p) => p.code === v) ? v : DEFAULT_LANGUAGE;
}

export function rememberLanguage(code: string): void {
  try {
    localStorage.setItem(KEY, code);
  } catch {
    /* without localStorage, start again from Italian */
  }
}
