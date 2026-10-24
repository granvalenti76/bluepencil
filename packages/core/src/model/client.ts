import { z } from "zod";
import { ModelError } from "./errors.ts";
import { extractJson } from "./json.ts";
import { splitThink, ThinkTracker } from "./reasoning.ts";
import type {
  ChatMessage,
  ChatRequest,
  ChatResult,
  ModelDebugEvent,
  ModelEndpoint,
} from "./types.ts";

export const DEFAULT_MAX_TOKENS = 4096;
export const DEFAULT_IDLE_TIMEOUT_MS = 45_000;
/**
 * Before the first chunk of the response the server may be queued behind another app
 * (llama-server with `parallel 1`) or reading a long prompt: the idle timeout does not apply there.
 */
export const DEFAULT_FIRST_TOKEN_TIMEOUT_MS = 15 * 60_000;
/** Token estimate when `/tokenize` is not available. */
export const CHARS_PER_TOKEN = 3.5;

export interface ModelClientOptions {
  endpoint: ModelEndpoint;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Idle timeout: no bytes for this long → error (there is no total timeout). */
  idleTimeoutMs?: number;
  /** Maximum wait for the first chunk of the response. */
  firstTokenTimeoutMs?: number;
  /** Debug log (reasoning included). Off by default. */
  debug?: (e: ModelDebugEvent) => void;
}

export interface ServerProps {
  totalSlots?: number;
  nCtx?: number;
}

/**
 * OpenAI-compatible client for llama-server (and for the cloud, if chosen). Streaming with
 * manual SSE parsing, abort down to `fetch`, reasoning kept apart from the response.
 */
export class ModelClient {
  readonly endpoint: ModelEndpoint;
  private readonly fetchFn: (url: string, init?: RequestInit) => Promise<Response>;
  private readonly idleTimeoutMs: number;
  private readonly firstTokenTimeoutMs: number;
  private readonly debug?: (e: ModelDebugEvent) => void;
  /** The server rejected `id_slot`: stop sending it. */
  private slotsRejected = false;

  constructor(opts: ModelClientOptions) {
    this.endpoint = opts.endpoint;
    this.fetchFn = opts.fetch ?? ((url, init) => fetch(url, init));
    this.idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.firstTokenTimeoutMs = opts.firstTokenTimeoutMs ?? DEFAULT_FIRST_TOKEN_TIMEOUT_MS;
    this.debug = opts.debug;
  }

  get isLocal(): boolean {
    return this.endpoint.kind === "local";
  }

  /** Server root without `/v1`: llama-server's `/tokenize`, `/props`, `/slots` live there. */
  get root(): string {
    return this.endpoint.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  }

  private url(path: string): string {
    return this.endpoint.baseUrl.replace(/\/+$/, "") + path;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.endpoint.apiKey) h.Authorization = `Bearer ${this.endpoint.apiKey}`;
    return h;
  }

  /** Model names from `GET {baseUrl}/models`. */
  async listModels(signal?: AbortSignal): Promise<string[]> {
    const res = await this.simple("GET", this.url("/models"), undefined, signal);
    const data = (await res.json()) as { data?: { id?: unknown }[] };
    return (data.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string");
  }

  /** llama-server's `GET /props`: number of slots and context. `null` if missing. */
  async props(signal?: AbortSignal): Promise<ServerProps | null> {
    if (!this.isLocal) return null;
    try {
      const res = await this.simple("GET", `${this.root}/props`, undefined, signal);
      const p = (await res.json()) as {
        total_slots?: unknown;
        n_ctx?: unknown;
        default_generation_settings?: { n_ctx?: unknown };
      };
      const nCtx = p.default_generation_settings?.n_ctx ?? p.n_ctx;
      return {
        totalSlots: typeof p.total_slots === "number" ? p.total_slots : undefined,
        nCtx: typeof nCtx === "number" ? nCtx : undefined,
      };
    } catch {
      return null;
    }
  }

  /** llama-server's `GET /slots`: which slots are working. `null` if the endpoint is missing. */
  async slots(signal?: AbortSignal): Promise<{ id: number; busy: boolean }[] | null> {
    if (!this.isLocal) return null;
    try {
      const res = await this.simple("GET", `${this.root}/slots`, undefined, signal);
      const data = (await res.json()) as { id?: unknown; is_processing?: unknown }[];
      if (!Array.isArray(data)) return null;
      return data.map((s, i) => ({
        id: typeof s.id === "number" ? s.id : i,
        busy: s.is_processing === true,
      }));
    } catch (e) {
      if (signal?.aborted) throw e;
      return null;
    }
  }

  /** Tokens in a text via `POST /tokenize`; if missing, characters / 3.5. */
  async countTokens(
    text: string,
    signal?: AbortSignal,
  ): Promise<{ count: number; exact: boolean }> {
    if (this.isLocal) {
      try {
        const res = await this.simple("POST", `${this.root}/tokenize`, { content: text }, signal);
        const data = (await res.json()) as { tokens?: unknown };
        if (Array.isArray(data.tokens)) return { count: data.tokens.length, exact: true };
      } catch (e) {
        if (signal?.aborted) throw e;
      }
    }
    return { count: Math.ceil(text.length / CHARS_PER_TOKEN), exact: false };
  }

  private async simple(method: string, url: string, body: unknown, signal?: AbortSignal) {
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method,
        headers: this.headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (signal?.aborted) throw new ModelError("aborted", undefined, { cause: e });
      throw new ModelError("unreachable", errorText(e), { cause: e });
    }
    if (!res.ok) {
      throw new ModelError("http", `${res.status} ${(await safeText(res)).slice(0, 200)}`, {
        status: res.status,
      });
    }
    return res;
  }

  /** A streaming request. Validates nothing: returns response and reasoning separately. */
  async chat(req: ChatRequest): Promise<ChatResult> {
    const useSlot = this.isLocal && req.slot !== undefined && !this.slotsRejected;
    try {
      return await this.chatOnce(req, useSlot ? req.slot : undefined);
    } catch (e) {
      // A rejected slot is not an error: drop it and retry (the review is just slower).
      if (useSlot && e instanceof ModelError && e.code === "http" && /slot/i.test(e.detail ?? "")) {
        this.slotsRejected = true;
        return this.chatOnce(req, undefined);
      }
      throw e;
    }
  }

  private async chatOnce(req: ChatRequest, slot: number | undefined): Promise<ChatResult> {
    const started = Date.now();
    const body: Record<string, unknown> = {
      messages: req.messages,
      stream: true,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
    };
    if (this.endpoint.model) body.model = this.endpoint.model;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.responseFormat !== undefined) body.response_format = req.responseFormat;
    if (req.tools?.length) body.tools = req.tools;
    if (this.isLocal) {
      // llama-server extensions: the cloud would reject them.
      body.cache_prompt = true;
      if (slot !== undefined) body.id_slot = slot;
    }
    this.debug?.({ type: "request", body });

    const controller = new AbortController();
    let timedOut: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = ms;
        controller.abort(new Error("idle timeout"));
      }, ms);
    };
    const onAbort = () => controller.abort(req.signal?.reason);
    if (req.signal?.aborted) throw new ModelError("aborted");
    req.signal?.addEventListener("abort", onAbort, { once: true });

    const fail = (e: unknown): ModelError => {
      if (e instanceof ModelError) return e;
      if (timedOut)
        return new ModelError("timeout", `no tokens for ${this.idleTimeoutMs / 1000} s`);
      if (req.signal?.aborted) return new ModelError("aborted", undefined, { cause: e });
      return new ModelError("unreachable", errorText(e), { cause: e });
    };

    try {
      arm(this.firstTokenTimeoutMs);
      let res: Response;
      try {
        res = await this.fetchFn(this.url("/chat/completions"), {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (e) {
        throw fail(e);
      }
      if (!res.ok) {
        const text = await safeText(res);
        throw new ModelError("http", `${res.status} ${extractErrorMessage(text)}`, {
          status: res.status,
        });
      }
      if (!res.body) throw new ModelError("bad_stream", "response without a body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const tracker = new ThinkTracker();
      let buffer = "";
      let content = "";
      const calls: { name: string; arguments: string }[] = [];
      let reasoningField = "";
      let reasoningTokens = 0;
      let contentTokens = 0;
      let finishReason: string | null = null;
      let model: string | null = null;
      let timings: Record<string, number> | undefined;
      let usage: Record<string, unknown> | undefined;
      let done = false;
      let streaming = false;

      const handle = (payload: string) => {
        if (payload === "[DONE]") {
          done = true;
          return;
        }
        let chunk: StreamChunk;
        try {
          chunk = JSON.parse(payload) as StreamChunk;
        } catch {
          throw new ModelError("bad_stream", payload.slice(0, 120));
        }
        if (chunk.error) {
          throw new ModelError("http", chunk.error.message ?? JSON.stringify(chunk.error));
        }
        if (typeof chunk.model === "string") model = chunk.model;
        if (chunk.timings) timings = chunk.timings;
        if (chunk.usage) usage = chunk.usage;
        const choice = chunk.choices?.[0];
        if (!choice) return;
        const delta = choice.delta ?? {};
        // A chunk with only the role is not a response yet: some servers send it right away and
        // then spend even tens of seconds loading the model.
        if (
          delta.content ||
          delta.reasoning_content ||
          delta.reasoning ||
          delta.tool_calls?.length ||
          choice.finish_reason
        ) {
          streaming = true;
        }
        const r = delta.reasoning_content ?? delta.reasoning;
        if (typeof r === "string" && r !== "") {
          reasoningField += r;
          reasoningTokens++;
          req.onProgress?.({ phase: "reasoning", reasoningTokens });
        }
        if (typeof delta.content === "string" && delta.content !== "") {
          content += delta.content;
          if (tracker.push(delta.content) === "reasoning") {
            reasoningTokens++;
            req.onProgress?.({ phase: "reasoning", reasoningTokens });
          } else {
            contentTokens++;
            req.onProgress?.({ phase: "writing", reasoningTokens, contentTokens });
            req.onAnswer?.(splitThink(content).answer);
          }
        }
        // Tool calls: they arrive in pieces, by index (name once, arguments in fragments).
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const i = typeof tc.index === "number" ? tc.index : calls.length;
            const call = (calls[i] ??= { name: "", arguments: "" });
            if (typeof tc.function?.name === "string") call.name += tc.function.name;
            if (typeof tc.function?.arguments === "string") call.arguments += tc.function.arguments;
            contentTokens++;
            req.onProgress?.({ phase: "writing", reasoningTokens, contentTokens });
          }
        }
        if (choice.finish_reason) finishReason = choice.finish_reason;
      };

      try {
        while (!done) {
          const { done: end, value } = await reader.read();
          if (end) break;
          // The idle timeout starts from the first real chunk of the response.
          if (streaming) arm(this.idleTimeoutMs);
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, nl).replace(/\r$/, "");
            buffer = buffer.slice(nl + 1);
            const wasStreaming = streaming;
            if (line.startsWith("data:")) handle(line.slice(5).trim());
            if (streaming && !wasStreaming) arm(this.idleTimeoutMs);
            if (done) break;
          }
        }
        if (!done && buffer.startsWith("data:")) handle(buffer.slice(5).trim());
      } catch (e) {
        void reader.cancel().catch(() => {});
        throw fail(e);
      }
      if (done) void reader.cancel().catch(() => {});

      const split = splitThink(content);
      const reasoning = [reasoningField.trim(), split.reasoning].filter(Boolean).join("\n");
      if (reasoning) this.debug?.({ type: "reasoning", text: reasoning });
      this.debug?.({ type: "response", content: split.answer, finishReason });
      const toolCalls = calls.filter((c) => c && c.name !== "");
      if (toolCalls.length)
        this.debug?.({ type: "response", content: JSON.stringify(toolCalls), finishReason });
      return {
        content: split.answer,
        toolCalls,
        reasoning,
        reasoningTokens,
        contentTokens,
        finishReason,
        model,
        slot,
        elapsedMs: Date.now() - started,
        timings,
        usage,
      };
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener("abort", onAbort);
    }
  }

  /**
   * Asks for JSON in the prompt, extracts it from the final response and validates it. One
   * repair attempt, then an error. A truncated response (`finish_reason: length`) is a separate
   * error: the caller retries with a smaller block.
   */
  async completeJson<T>(
    schema: z.ZodType<T>,
    req: ChatRequest,
    /** The request to fix the JSON, in the draft's language (`repairMessage`). */
    repair: (error: string) => string = defaultRepair,
  ): Promise<{ value: T; result: ChatResult; repaired: boolean }> {
    const first = await this.chat(req);
    const err1 = check(schema, first);
    if (err1.ok) return { value: err1.value, result: first, repaired: false };

    const messages: ChatMessage[] = [
      ...req.messages,
      { role: "assistant", content: first.content },
      { role: "user", content: repair(err1.error) },
    ];
    const second = await this.chat({ ...req, messages });
    const err2 = check(schema, second);
    if (err2.ok) return { value: err2.value, result: second, repaired: true };
    throw new ModelError("invalid_json", err2.error);
  }
}

/** For callers without a language pack (tests, tools). */
const defaultRepair = (error: string) =>
  `The JSON is not valid: ${error}\nAnswer again with the corrected JSON only, in the same format, with no text before or after.`;

function check<T>(
  schema: z.ZodType<T>,
  result: ChatResult,
): { ok: true; value: T } | { ok: false; error: string } {
  if (result.finishReason === "length") throw new ModelError("truncated");
  const extracted = extractJson(result.content);
  if (!extracted.ok) return { ok: false, error: extracted.error };
  const parsed = schema.safeParse(extracted.value);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, error: z.prettifyError(parsed.error).slice(0, 600) };
}

interface StreamChunk {
  model?: unknown;
  error?: { message?: string };
  timings?: Record<string, number>;
  usage?: Record<string, unknown>;
  choices?: {
    delta?: {
      content?: unknown;
      reasoning_content?: unknown;
      reasoning?: unknown;
      tool_calls?: {
        index?: number;
        function?: { name?: unknown; arguments?: unknown };
      }[];
    };
    finish_reason?: string | null;
  }[];
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function extractErrorMessage(text: string): string {
  try {
    const j = JSON.parse(text) as { error?: { message?: string } | string };
    if (typeof j.error === "string") return j.error;
    if (j.error?.message) return j.error.message;
  } catch {
    /* plain text */
  }
  return text.slice(0, 200);
}

function errorText(e: unknown): string {
  const err = e as { message?: string; cause?: { code?: string; message?: string } };
  return err.cause?.code ?? err.cause?.message ?? err.message ?? String(e);
}

/** A fixed slot per draft: the same key always lands in the same slot. */
export function slotFor(key: string, totalSlots: number): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % Math.max(1, totalSlots);
}
