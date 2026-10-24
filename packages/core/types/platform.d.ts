/* eslint-disable no-var -- ambient global declarations: `declare var` is the right form */
// Standard web APIs (WHATWG) available both in Node ≥ 22 and in browsers: fetch, AbortController,
// TextDecoder, timers. The core uses neither `node:*` nor the DOM; this declares the minimum the
// model client needs. This file is only part of the core's typecheck: server and web have the
// full types (@types/node, DOM lib).

interface DeskAbortSignal {
  readonly aborted: boolean;
  readonly reason: unknown;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}
declare var AbortController: {
  new (): { readonly signal: AbortSignal; abort(reason?: unknown): void };
};
type AbortSignal = DeskAbortSignal;

interface DeskReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(reason?: unknown): Promise<void>;
}
interface Response {
  readonly ok: boolean;
  readonly status: number;
  readonly body: { getReader(): DeskReader } | null;
  text(): Promise<string>;
  json(): Promise<unknown>;
}
interface RequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}
declare function fetch(url: string, init?: RequestInit): Promise<Response>;

declare var TextDecoder: {
  new (label?: string): { decode(input?: Uint8Array, options?: { stream?: boolean }): string };
};

declare function setTimeout(handler: () => void, ms: number): unknown;
declare function clearTimeout(id: unknown): void;
