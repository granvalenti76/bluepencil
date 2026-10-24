import { create } from "zustand";

/**
 * "Three things to try" next to the sample draft: the boxes tick themselves, "Hide tips" removes
 * it. A browser preference.
 */
export interface Tips {
  hidden: boolean;
  wrote: boolean;
  asked: boolean;
  reviewed: boolean;
}

const KEY = "desk-tips";
/** The sample draft's names (server, welcome/sample.ts). */
export const SAMPLE_PATHS = ["Esempio.md", "Example.md"];

function load(): Tips {
  const none = { hidden: false, wrote: false, asked: false, reviewed: false };
  try {
    return { ...none, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Tips>) };
  } catch {
    return none;
  }
}

export const useTips = create<Tips & { mark: (patch: Partial<Tips>) => void }>()((set, get) => ({
  ...load(),
  mark: (patch) => {
    const changed = Object.entries(patch).some(([k, v]) => get()[k as keyof Tips] !== v);
    if (!changed) return;
    set(patch);
    const { hidden, wrote, asked, reviewed } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ hidden, wrote, asked, reviewed }));
    } catch {
      /* without localStorage they hold while the page stays open */
    }
  },
}));

/** First start finished: the sample draft, in Write, with the tips next to it. */
export function openSample(path: string | null) {
  try {
    localStorage.setItem("desk-mode", "write");
    localStorage.removeItem(KEY);
  } catch {
    /* it opens anyway */
  }
  // The other parameters stay (`shell=desktop` in the desktop app).
  const url = new URL(location.href);
  if (path) url.searchParams.set("d", path);
  else url.searchParams.delete("d");
  location.href = url.pathname + url.search;
}
