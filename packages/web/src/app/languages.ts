import { create } from "zustand";
import { DEFAULT_LANGUAGE, draftLanguage, type LanguagePack } from "@desk/core";
import { api, type LanguageProblem } from "./api.ts";
import { useDoc } from "./docStore.ts";

interface LanguagesState {
  /** The language packs loaded by the server. */
  packs: LanguagePack[];
  /** User packs that could not be loaded, with the reasons. */
  problems: LanguageProblem[];
  /** The folder of the user's packs (`null` if the server has none). */
  userDir: string | null;
  ready: boolean;
  error: string | null;
  load: () => Promise<void>;
}

export const useLanguages = create<LanguagesState>()((set) => ({
  packs: [],
  problems: [],
  userDir: null,
  ready: false,
  error: null,
  load: async () => {
    try {
      const r = await api.languages();
      set({ packs: r.packs, problems: r.problems, userDir: r.userDir, ready: true, error: null });
      // The open draft's language depends on which packs exist.
      const doc = useDoc.getState();
      const lang = draftLanguage(
        doc.lang.declared,
        r.packs.map((p) => p.code),
      );
      if (lang.code !== doc.lang.code || lang.unknown !== doc.lang.unknown) doc.set({ lang });
    } catch {
      set({ error: "Couldn’t load the language packs." });
    }
  },
}));

/** A language's pack; if missing, Italian (as the server does). */
export function packFor(code: string): LanguagePack {
  const { packs } = useLanguages.getState();
  return packs.find((p) => p.code === code) ?? packs.find((p) => p.code === DEFAULT_LANGUAGE)!;
}

/** The same, as a hook: re-renders when the packs arrive. */
export function usePack(code: string): LanguagePack {
  useLanguages((s) => s.packs);
  return packFor(code);
}

/** The opinion note in any loaded language (a draft can change language). */
export const isOpinionNote = (text: string) =>
  useLanguages.getState().packs.some((p) => p.opinionNote === text);

/** A language's name in English, like the interface ("Italian"); without `Intl`, the pack's own. */
export function languageName(code: string): string {
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(code);
    if (name && name !== code) return name;
  } catch {
    /* code not valid for Intl */
  }
  return useLanguages.getState().packs.find((p) => p.code === code)?.name ?? code;
}
