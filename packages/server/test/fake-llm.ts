import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** A chunk of the SSE stream, or a pause. */
export type FakeChunk = { data: unknown } | { raw: string } | { delayMs: number };

export interface FakeReply {
  status?: number;
  /** Non-streaming JSON response (errors, `/models`…). */
  json?: unknown;
  /** SSE stream. */
  stream?: FakeChunk[];
  /** After the stream the connection stays open without sending anything. */
  hang?: boolean;
}

export interface FakeRequestLog {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  /** The client closed the connection before the end. */
  closedEarly: boolean;
  closedAt?: number;
}

export type ChatHandler = (body: Record<string, unknown>, log: FakeRequestLog) => FakeReply;

export interface FakeLlmOptions {
  models?: string[];
  chat?: ChatHandler;
  /** llama-server's `/props`; `null` = 404. */
  props?: Record<string, unknown> | null;
  /** `/tokenize`: `false` = 404 (falls back to the estimate). */
  tokenize?: boolean;
  /** Fixed port (e2e); default: a free one. */
  port?: number;
  /** Pause between one chunk of the stream and the next (e2e: to see the progress). */
  chunkDelayMs?: number;
  /** llama-server's `/slots`: the "working" state of each slot; `null` = 404. */
  slots?: (() => boolean[]) | null;
}

// Builders for the stream's chunks, in llama-server's format.
const chunk = (delta: Record<string, unknown>, finish: string | null = null, extra = {}) => ({
  data: {
    object: "chat.completion.chunk",
    model: "fake-model",
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...extra,
  },
});
export const sse = {
  reasoning: (text: string) => chunk({ reasoning_content: text }),
  content: (text: string) => chunk({ content: text }),
  finish: (reason = "stop", extra: Record<string, unknown> = {}) => chunk({}, reason, extra),
  done: (): FakeChunk => ({ raw: "data: [DONE]\n\n" }),
  delay: (ms: number): FakeChunk => ({ delayMs: ms }),
  /** A tool call as llama-server sends it: the name, then the arguments in pieces. */
  toolCall: (index: number, name: string, args: string, size = 12): FakeChunk[] => {
    const out: FakeChunk[] = [
      chunk({
        tool_calls: [
          { index, id: `call_${index}`, type: "function", function: { name, arguments: "" } },
        ],
      }),
    ];
    for (let i = 0; i < args.length; i += size) {
      out.push(
        chunk({ tool_calls: [{ index, function: { arguments: args.slice(i, i + size) } }] }),
      );
    }
    return out;
  },
  /** Splits a text into chunks of `size` characters (like tokens). */
  tokens: (text: string, kind: "content" | "reasoning", size = 4): FakeChunk[] => {
    const out: FakeChunk[] = [];
    for (let i = 0; i < text.length; i += size) out.push(sse[kind](text.slice(i, i + size)));
    return out;
  },
};

/** Complete response: reasoning in `reasoning_content`, then the content, then `stop`. */
export function replyWith(content: string, reasoning = "Ragiono in breve."): FakeReply {
  return {
    stream: [
      ...sse.tokens(reasoning, "reasoning"),
      ...sse.tokens(content, "content"),
      sse.finish(),
      sse.done(),
    ],
  };
}

/** Response with tool calls (function calling), after the reasoning. */
export function replyWithTools(
  calls: { name: string; args: unknown }[],
  reasoning = "Ragiono in breve.",
): FakeReply {
  return {
    stream: [
      ...sse.tokens(reasoning, "reasoning"),
      ...calls.flatMap((c, i) => sse.toolCall(i, c.name, JSON.stringify(c.args))),
      sse.finish(calls.length ? "tool_calls" : "stop"),
      sse.done(),
    ],
  };
}

/**
 * Fake OpenAI-compatible server (with the llama-server extensions the client uses):
 * `/v1/models`, streaming `/v1/chat/completions`, `/props`, `/tokenize`.
 */
export async function startFakeLlm(opts: FakeLlmOptions = {}) {
  const requests: FakeRequestLog[] = [];
  const sockets = new Set<import("node:net").Socket>();
  let chat: ChatHandler = opts.chat ?? (() => replyWith("[]"));

  const server = createServer(async (req, res) => {
    const body = await readBody(req);
    const url = new URL(req.url ?? "/", "http://x");
    const log: FakeRequestLog = {
      method: req.method ?? "GET",
      path: url.pathname,
      body,
      closedEarly: false,
    };
    requests.push(log);
    let finished = false;
    res.on("close", () => {
      log.closedAt = Date.now();
      if (!finished) log.closedEarly = true;
    });

    const reply = route(url.pathname, body, log);
    await send(res, reply, opts.chunkDelayMs ?? 0);
    finished = !reply.hang;
    if (!reply.hang) res.end();
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });

  function route(
    path: string,
    body: Record<string, unknown> | null,
    log: FakeRequestLog,
  ): FakeReply {
    if (path === "/v1/models") {
      return {
        json: {
          object: "list",
          data: (opts.models ?? ["fake-model"]).map((id) => ({ id, object: "model" })),
        },
      };
    }
    if (path === "/props") {
      return opts.props === null
        ? { status: 404, json: { error: "not found" } }
        : { json: opts.props ?? { total_slots: 4, default_generation_settings: { n_ctx: 16384 } } };
    }
    if (path === "/slots") {
      if (opts.slots === null) return { status: 404, json: { error: "not found" } };
      const busy = opts.slots?.() ?? [false];
      return { json: busy.map((b, id) => ({ id, is_processing: b })) };
    }
    if (path === "/tokenize") {
      if (opts.tokenize === false) return { status: 404, json: { error: "not found" } };
      const content = String(body?.content ?? "");
      return {
        json: { tokens: Array.from({ length: Math.ceil(content.length / 4) }, (_, i) => i) },
      };
    }
    if (path === "/v1/chat/completions") return chat(body ?? {}, log);
    return { status: 404, json: { error: "not found" } };
  }

  await new Promise<void>((r) => server.listen(opts.port ?? 0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    chatRequests: () => requests.filter((r) => r.path === "/v1/chat/completions"),
    setChat(handler: ChatHandler) {
      chat = handler;
    },
    close: () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
      }),
  };
}
export type FakeLlm = Awaited<ReturnType<typeof startFakeLlm>>;

async function readBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const parts: Buffer[] = [];
  for await (const p of req) parts.push(p as Buffer);
  if (!parts.length) return null;
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function send(res: ServerResponse, reply: FakeReply, chunkDelayMs: number) {
  if (!reply.stream) {
    res.writeHead(reply.status ?? 200, { "Content-Type": "application/json" });
    res.write(JSON.stringify(reply.json ?? {}));
    return;
  }
  res.writeHead(reply.status ?? 200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
  });
  res.flushHeaders();
  for (const c of reply.stream) {
    if (res.destroyed) return;
    if ("delayMs" in c) await new Promise((r) => setTimeout(r, c.delayMs));
    else if ("raw" in c) res.write(c.raw);
    else {
      res.write(`data: ${JSON.stringify(c.data)}\n\n`);
      if (chunkDelayMs) await new Promise((r) => setTimeout(r, chunkDelayMs));
    }
  }
}
