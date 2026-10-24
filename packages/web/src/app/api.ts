import type {
  Judgment,
  LanguagePack,
  ModelStatus,
  OutlineEntry,
  Pass,
  PassRecord,
  PassState,
  ScoreKind,
  SectionInfo,
} from "@desk/core";

/** The token arrives in the fragment (`#t=…`): it is saved in sessionStorage and removed from the address. */
const KEY = "desk-token";

export function initToken(): string | null {
  const m = /[#&]t=([^&]+)/.exec(location.hash);
  if (m) {
    try {
      sessionStorage.setItem(KEY, decodeURIComponent(m[1]!));
    } catch {
      /* sessionStorage unavailable: the token is valid only while the page stays open */
      memoryToken = decodeURIComponent(m[1]!);
    }
    history.replaceState(null, "", location.pathname + location.search);
  }
  return getToken();
}

let memoryToken: string | null = null;

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(KEY) ?? memoryToken;
  } catch {
    return memoryToken;
  }
}

export interface DraftRow {
  path: string;
  title: string;
  archetype: string;
  stage: "structure" | "writing" | "review" | string;
  target: number;
  words: number;
  lines: number;
  mtime: number;
  contentHash: string;
}

export interface DraftDetail {
  path: string;
  frontmatter: {
    title?: string;
    archetype?: string;
    stage?: string;
    target?: number;
    outline?: OutlineEntry[];
    signoff?: { at: string; body: string };
    [k: string]: unknown;
  };
  issues: string[];
  body: string;
  text: string;
  contentHash: string;
  sections: SectionInfo[];
}

export interface DraftSources {
  sources: (
    | { ref: string; kind: "url" }
    | {
        ref: string;
        kind: "file";
        path: string;
        exists: boolean;
        preview?: string;
      }
  )[];
  files: { path: string; title: string; ref: string }[];
}

/** Text with the found terms between \u0001 and \u0002 (FTS5): the browser shows them as `<mark>`. */
export interface ComparePassage {
  ref: string;
  path: string;
  text: string;
  marked: string;
}

export interface SearchHit {
  path: string;
  title: string;
  isDraft: boolean;
  snippet: string;
}

export interface PublishPreview {
  title: string;
  /** The file that will be written, in full (with `~`). */
  file: string;
  target: string;
  /** The folder is in a git repository: also commit. */
  git: boolean;
  content: string;
  diff: string;
  changed: boolean;
  isNew: boolean;
  removedNotes: { id: string; text: string }[];
  draftHash: string;
  canPush: boolean;
}

export interface PublishResult {
  file: string;
  target: string;
  git: boolean;
  commit: string | null;
  pushed: boolean;
}

/** A user language pack that could not be loaded. */
export interface LanguageProblem {
  dir: string;
  errors: string[];
}

export interface LanguagesView {
  packs: LanguagePack[];
  problems: LanguageProblem[];
  userDir: string | null;
}

export interface Settings {
  draftsDir: string;
  modelBaseUrl: string;
  publishDir: string;
  push: boolean;
  /** Drafts folder or model changed: they apply from the next start. */
  restartNeeded: boolean;
  /** The system folder picker is available (macOS). */
  canPick: boolean;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(`HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: {
      "X-Desk-Token": getToken() ?? "",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

/** The server's message, if any, otherwise the default one. */
export const errorMessage = (e: unknown, fallback: string) =>
  e instanceof ApiError && typeof (e.body as { message?: unknown })?.message === "string"
    ? (e.body as { message: string }).message
    : fallback;

const enc = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/** The first start. */
export interface WelcomeState {
  pending: boolean;
  /** The chosen folder; `null` until there is one. */
  folder: string | null;
  /** Where "A new folder" would go. */
  newFolder: string;
  modelBaseUrl: string;
}

export interface FolderSummary {
  exists: boolean;
  texts: number;
  sources: number;
  lastEdited: number | null;
}

/** The editor test: their first words, or why they do not answer. */
export type ProbeResult =
  | {
      ok: true;
      ms: number;
      model: string | null;
      context: number | null;
      minutes: number | null;
      reasoning: boolean;
      words: string;
    }
  | {
      ok: false;
      reason: "unreachable" | "no_model" | "failed";
      address: string;
      message: string;
    };

/** Model score on the whole text (prose, structure), with the fingerprint of the scored body. */
export interface StoredScore {
  kind: ScoreKind;
  value: number;
  reason: string;
  bodyHash: string;
  model: string;
  updatedAt: string;
}

/** The editor's letter for a pass, with the fingerprint of the body that was read. */
export interface StoredLetter {
  pass: Pass;
  text: string;
  bodyHash: string;
  model: string;
  promptVersion: string;
  updatedAt: string;
}

export const api = {
  listDrafts: async () => (await request<{ drafts: DraftRow[] }>("GET", "/api/drafts")).drafts,
  getDraft: (path: string) => request<DraftDetail>("GET", `/api/drafts/${enc(path)}`),
  /** "Clear suggestions": removes all the draft's notes (the text does not change). */
  clearJudgments: (path: string) =>
    request<{ removed: number }>("DELETE", `/api/drafts/${encodeURIComponent(path)}/judgments`),
  listJudgments: async (path: string) =>
    (
      await request<{ judgments: Judgment[] }>(
        "GET",
        `/api/drafts/${encodeURIComponent(path)}/judgments`,
      )
    ).judgments,
  patchJudgment: (
    id: string,
    body: {
      status: string;
      applied?: Judgment["applied"];
      range?: Judgment["range"];
      anchor?: Judgment["anchor"];
    },
  ) => request<Judgment>("PATCH", `/api/judgments/${encodeURIComponent(id)}`, body),
  languages: () => request<LanguagesView>("GET", "/api/languages"),
  reloadLanguages: () => request<LanguagesView>("POST", "/api/languages/reload"),
  createLanguage: (code: string, name: string) =>
    request<LanguagesView & { created: string }>("POST", "/api/languages", { code, name }),
  revealLanguages: () => request<void>("POST", "/api/languages/reveal"),
  modelStatus: (refresh = false) =>
    request<ModelStatus>("GET", `/api/model/status${refresh ? "?refresh=1" : ""}`),
  sources: (path: string) => request<DraftSources>("GET", `/api/sources/${enc(path)}`),
  /** "Show in Finder": the selected draft or, without a path, the drafts folder. */
  reveal: (path?: string) => request<void>("POST", "/api/reveal", path ? { path } : {}),
  folder: async () => (await request<{ path: string }>("GET", "/api/folder")).path,
  scores: async (path: string) =>
    (await request<{ scores: StoredScore[] }>("GET", `/api/scores/${enc(path)}`)).scores,
  letters: async (path: string) =>
    (await request<{ letters: StoredLetter[] }>("GET", `/api/letters/${enc(path)}`)).letters,
  /** The review passes: only those with a state. */
  passes: async (path: string) =>
    (await request<{ passes: PassRecord[] }>("GET", `/api/passes/${enc(path)}`)).passes,
  setPass: async (path: string, pass: Pass, state: PassState) =>
    (await request<{ passes: PassRecord[] }>("PUT", `/api/passes/${enc(path)}`, { pass, state }))
      .passes,
  restartPasses: async (path: string) =>
    (await request<{ passes: PassRecord[] }>("DELETE", `/api/passes/${enc(path)}`)).passes,
  compare: (path: string, judgmentId: string) =>
    request<{ query: string; passages: ComparePassage[] }>(
      "GET",
      `/api/compare?path=${encodeURIComponent(path)}&judgmentId=${encodeURIComponent(judgmentId)}`,
    ),
  search: async (q: string) =>
    (await request<{ results: SearchHit[] }>("GET", `/api/search?q=${encodeURIComponent(q)}`))
      .results,
  health: () => request<{ ok: boolean; boot: string }>("GET", "/api/health"),
  welcome: () => request<WelcomeState>("GET", "/api/welcome"),
  inspectFolder: (path: string) =>
    request<FolderSummary>("GET", `/api/welcome/inspect?path=${encodeURIComponent(path)}`),
  chooseFolder: (choice: { fresh: true } | { path: string }) =>
    request<{ folder: string; summary: FolderSummary; relaunching: boolean }>(
      "POST",
      "/api/welcome/folder",
      choice,
    ),
  finishWelcome: (sample: boolean, lang: string) =>
    request<{ sample: string | null; relaunching: boolean }>("POST", "/api/welcome/finish", {
      sample,
      lang,
    }),
  probeModel: (baseUrl: string, lang: string) =>
    request<ProbeResult>("POST", "/api/model/probe", { baseUrl, lang }),
  settings: () => request<Settings>("GET", "/api/settings"),
  saveSettings: (patch: Partial<Omit<Settings, "restartNeeded" | "canPick">>) =>
    request<Settings>("PUT", "/api/settings", patch),
  /** The system folder picker; `null` if the author cancels. */
  pickFolder: async (prompt: string) =>
    (await request<{ path: string | null }>("POST", "/api/pick-folder", { prompt })).path,
  publishPreview: (path: string) => request<PublishPreview>("GET", `/api/publish/${enc(path)}`),
  publish: (path: string, draftHash: string, push: boolean) =>
    request<PublishResult>("POST", `/api/publish/${enc(path)}`, { draftHash, push }),
  evalSummary: async () =>
    (
      await request<{
        report: {
          model: string;
          date: string;
          passes: { pass: string; precision: number | null; enabled: boolean }[];
        } | null;
      }>("GET", "/api/eval")
    ).report,
  createDraft: (title: string, archetype: string, lang: string, plan = false) =>
    request<DraftDetail>("POST", "/api/drafts", { title, archetype, lang, plan }),
  /** `conflict` when the file has changed on disk since the last read. */
  async putDraft(
    path: string,
    body: string,
    baseHash: string,
    frontmatterPatch?: Record<string, unknown>,
  ): Promise<
    { ok: true; detail: DraftDetail } | { ok: false; conflict: true; currentHash: string }
  > {
    try {
      return {
        ok: true,
        detail: await request<DraftDetail>("PUT", `/api/drafts/${enc(path)}`, {
          body,
          baseHash,
          frontmatterPatch,
        }),
      };
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        return {
          ok: false,
          conflict: true,
          currentHash: (e.body as { currentHash: string }).currentHash,
        };
      }
      throw e;
    }
  },
};

/** Reads an SSE stream that came from a POST (EventSource can only do GET). */
export async function postEvents(
  url: string,
  body: unknown,
  onEvent: (event: string, data: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "X-Desk-Token": getToken() ?? "", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new ApiError(res.status, await res.json().catch(() => null));
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const event = /^event: (.*)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (event && data) onEvent(event, JSON.parse(data));
    }
  }
}
