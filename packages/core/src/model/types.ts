export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Where a request goes: llama-server on the LAN, or the cloud when chosen explicitly. */
export interface ModelEndpoint {
  kind: "local" | "cloud";
  /** OpenAI-compatible base, with `/v1`. */
  baseUrl: string;
  /** Model name to send; optional for llama-server (it reads it from `/models`). */
  model?: string;
  apiKey?: string;
}

export type ChatProgress =
  | { phase: "reasoning"; reasoningTokens: number }
  | { phase: "writing"; reasoningTokens: number; contentTokens: number };

export interface ChatRequest {
  messages: ChatMessage[];
  temperature?: number;
  /** Reasoning eats into the budget: start generous. */
  maxTokens?: number;
  /** llama-server slot for the draft's session. Ignored for the cloud. */
  slot?: number;
  /** Only if the server applies it after the reasoning. */
  responseFormat?: unknown;
  /** Tools (function calling, OpenAI format) through which the model delivers its notes. */
  tools?: ToolDefinition[];
  signal?: AbortSignal;
  onProgress?: (p: ChatProgress) => void;
  /** The response (without reasoning) as it arrives: to show partial results. */
  onAnswer?: (answerSoFar: string) => void;
}

/** A tool offered to the model: name, purpose, JSON schema of the arguments. */
export interface ToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/** A tool call received: the arguments are JSON still to be parsed. */
export interface ToolCall {
  name: string;
  arguments: string;
}

export interface ChatResult {
  /** The response, without the reasoning. */
  content: string;
  /** The tool calls, in order (empty if the model answered with text only). */
  toolCalls: ToolCall[];
  /** The separated reasoning (never shown, never sent back to the model). */
  reasoning: string;
  reasoningTokens: number;
  contentTokens: number;
  finishReason: string | null;
  model: string | null;
  /** Slot actually requested (undefined if dropped). */
  slot: number | undefined;
  elapsedMs: number;
  /** llama-server `timings`, if present (used by the probe). */
  timings?: Record<string, number>;
  usage?: Record<string, unknown>;
}

export type ModelDebugEvent =
  | { type: "request"; body: unknown }
  | { type: "reasoning"; text: string }
  | { type: "response"; content: string; finishReason: string | null };

/** Model status for the interface (`GET /api/model/status`, `model.status` event). */
export interface ModelStatus {
  local: {
    baseUrl: string;
    reachable: boolean;
    /** Name read from `GET {baseUrl}/models`. */
    model: string | null;
    error?: string;
    checkedAt: string | null;
  };
  cloud: {
    /** `cloud.enabled` in the configuration file. */
    enabled: boolean;
    /** Enabled, with key and address: the author can choose it. */
    available: boolean;
    model: string | null;
    reason?: string;
  };
}
