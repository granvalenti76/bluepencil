import { ModelClient } from "@desk/core";
import type { Languages } from "../languages.ts";

/** The context for a 20-minute read, with prompt and response. */
const TOKENS_FOR_20_MINUTES = 100_000;
const LIST_TIMEOUT_MS = 4000;
/** The first words may come after the reasoning: a large model takes a while. */
const GREETING_TIMEOUT_MS = 120_000;

export type ProbeResult =
  | {
      ok: true;
      ms: number;
      model: string | null;
      context: number | null;
      /** How many minutes of reading the context is enough for (at most 20, the size of a piece). */
      minutes: number | null;
      /** The model reasoned before answering (`reasoning_content` or `<think>`). */
      reasoning: boolean;
      /** The editor's first words: the real test, an answer from the model. */
      words: string;
    }
  | {
      ok: false;
      /** `unreachable`: nobody answers; `no_model`: answers but without a model; `failed`: the
       *  test answer did not arrive. */
      reason: "unreachable" | "no_model" | "failed";
      /** Host e porta, per dirlo in chiaro. */
      address: string;
      message: string;
    };

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/**
 * "Test connection" on the first start: reachability and time, model, context, reasoning, and a
 * real answer, the editor's first words. Does not save the address.
 */
export async function probeModel(
  baseUrl: string,
  lang: string,
  languages: Languages,
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<ProbeResult> {
  const address = hostOf(baseUrl);
  const client = new ModelClient({
    endpoint: { kind: "local", baseUrl },
    idleTimeoutMs: GREETING_TIMEOUT_MS,
    firstTokenTimeoutMs: GREETING_TIMEOUT_MS,
    ...(fetchFn ? { fetch: fetchFn } : {}),
  });

  const started = Date.now();
  let models: string[];
  try {
    models = await client.listModels(AbortSignal.timeout(LIST_TIMEOUT_MS));
  } catch (e) {
    return { ok: false, reason: "unreachable", address, message: (e as Error).message };
  }
  const ms = Date.now() - started;
  if (models.length === 0) {
    return { ok: false, reason: "no_model", address, message: "No model loaded" };
  }
  const props = await client.props(AbortSignal.timeout(LIST_TIMEOUT_MS)).catch(() => null);
  const context = props?.nCtx ?? null;

  const pack = languages.forDraft(lang);
  const greeting = pack.prompts.greeting ?? languages.forDraft("en").prompts.greeting;
  try {
    const res = await client.chat({
      messages: [
        { role: "system", content: pack.prompts.system },
        { role: "user", content: greeting ?? "Introduce yourself in two sentences." },
      ],
      temperature: 0.7,
      maxTokens: 2048,
      signal: AbortSignal.timeout(GREETING_TIMEOUT_MS),
    });
    const words = res.content.trim().replace(/^["«“]|["»”]$/g, "");
    if (!words) throw new Error("The model answered with nothing");
    return {
      ok: true,
      ms,
      // The name the server declares: the one in the response is often an alias.
      model: models[0] ?? res.model ?? null,
      context,
      minutes:
        context === null ? null : Math.min(20, Math.floor((context / TOKENS_FOR_20_MINUTES) * 20)),
      reasoning: res.reasoning.trim() !== "" || res.reasoningTokens > 0,
      words,
    };
  } catch (e) {
    return { ok: false, reason: "failed", address, message: (e as Error).message };
  }
}
