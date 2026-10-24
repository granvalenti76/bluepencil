import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ModelClient,
  ModelError,
  ModelJudgmentSchema,
  repairMessage,
  type ChatProgress,
} from "@desk/core";
import { Languages } from "../src/languages.ts";
import { replyWith, sse, startFakeLlm, type FakeLlm } from "./fake-llm.ts";

const Judgments = z.array(ModelJudgmentSchema);
const ONE = JSON.stringify([
  {
    kind: "repetition",
    quote: "risultato",
    title: "Ripetizione",
    rationale: "«risultato» due volte.",
    proposal: { action: "replace", text: "esito", label: "Applica" },
  },
]);
const messages = [
  { role: "system" as const, content: "Sei un revisore." },
  { role: "user" as const, content: "Brano" },
];

let fake: FakeLlm;
afterEach(async () => {
  await fake?.close();
});

function client(opts: { idleTimeoutMs?: number } = {}) {
  return new ModelClient({ endpoint: { kind: "local", baseUrl: fake.url }, ...opts });
}

const waitFor = async (cond: () => boolean, ms = 2000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("timeout waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("model client", () => {
  it("reasoning in reasoning_content: kept apart from the response, progress visible", async () => {
    fake = await startFakeLlm({
      chat: () => replyWith(ONE, "Devo cercare ripetizioni. ".repeat(10)),
    });
    const progress: ChatProgress[] = [];
    const { value, result } = await client().completeJson(Judgments, {
      messages,
      onProgress: (p) => progress.push(p),
    });
    expect(value).toHaveLength(1);
    expect(result.reasoning).toContain("Devo cercare ripetizioni.");
    expect(result.content).not.toContain("Devo cercare");
    expect(result.reasoningTokens).toBeGreaterThan(10);
    expect(progress[0]).toEqual({ phase: "reasoning", reasoningTokens: 1 });
    expect(progress.at(-1)?.phase).toBe("writing");
  });

  it("inline reasoning <think>…</think>, even split across chunks", async () => {
    const text = `<think>\nCerco errori. Il JSON è [1,2]?\n</think>\n\n${ONE}`;
    fake = await startFakeLlm({
      chat: () => ({ stream: [...sse.tokens(text, "content", 3), sse.finish(), sse.done()] }),
    });
    const phases: string[] = [];
    const { value, result } = await client().completeJson(Judgments, {
      messages,
      onProgress: (p) => phases.push(p.phase),
    });
    expect(value[0]?.quote).toBe("risultato");
    expect(result.reasoning).toBe("Cerco errori. Il JSON è [1,2]?");
    expect(result.content).toBe(ONE);
    expect(phases[0]).toBe("reasoning");
    expect(phases.at(-1)).toBe("writing");
  });

  it("reasoning opened by the template: only </think> in the response", async () => {
    fake = await startFakeLlm({ chat: () => replyWith(`Penso [3].</think>${ONE}`, "") });
    const { result } = await client().completeJson(Judgments, { messages });
    expect(result.reasoning).toBe("Penso [3].");
    expect(result.content).toBe(ONE);
  });

  it("JSON inside a ```json block, with surrounding text", async () => {
    fake = await startFakeLlm({
      chat: () => replyWith("Ecco i giudizi:\n```json\n" + ONE + "\n```\nFine."),
    });
    const { value, repaired } = await client().completeJson(Judgments, { messages });
    expect(value).toHaveLength(1);
    expect(repaired).toBe(false);
  });

  it("invalid JSON: a single repair attempt, without the reasoning", async () => {
    let n = 0;
    fake = await startFakeLlm({
      chat: () => (n++ === 0 ? replyWith('[{"kind": "x", "quote": ', "segreto") : replyWith(ONE)),
    });
    const itPack = new Languages().get("it")!;
    const { value, repaired } = await client().completeJson(Judgments, { messages }, (e) =>
      repairMessage(itPack, e),
    );
    expect(repaired).toBe(true);
    expect(value).toHaveLength(1);
    const second = fake.chatRequests()[1]!.body!.messages as { role: string; content: string }[];
    expect(second).toHaveLength(4);
    expect(second.slice(0, 2)).toEqual(messages); // same start: the prompt cache holds
    expect(second[2]).toEqual({ role: "assistant", content: '[{"kind": "x", "quote":' });
    expect(second[3]!.content).toMatch(/^Il JSON non è valido: /);
    expect(JSON.stringify(second)).not.toContain("segreto");
  });

  it("JSON that fails the schema twice → invalid_json error", async () => {
    fake = await startFakeLlm({ chat: () => replyWith('[{"kind": 1}]') });
    const err = await client()
      .completeJson(Judgments, { messages })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect((err as ModelError).code).toBe("invalid_json");
    expect(fake.chatRequests()).toHaveLength(2);
  });

  it("truncated response (finish_reason: length) → truncated error, no repair", async () => {
    fake = await startFakeLlm({
      chat: () => ({
        stream: [
          ...sse.tokens("<think>lungo ragionamento", "content"),
          sse.finish("length"),
          sse.done(),
        ],
      }),
    });
    const err = await client()
      .completeJson(Judgments, { messages })
      .catch((e: unknown) => e);
    expect((err as ModelError).code).toBe("truncated");
    expect(fake.chatRequests()).toHaveLength(1);
  });

  it("silence beyond the idle timeout → timeout error and connection closed", async () => {
    fake = await startFakeLlm({
      chat: () => ({
        stream: [sse.reasoning("comincio"), sse.delay(100), sse.reasoning("…")],
        hang: true,
      }),
    });
    const started = Date.now();
    const err = await client({ idleTimeoutMs: 300 })
      .chat({ messages })
      .catch((e: unknown) => e);
    expect((err as ModelError).code).toBe("timeout");
    // The timer restarts at every token: the error comes ~300 ms after the last one, not after the start.
    expect(Date.now() - started).toBeGreaterThanOrEqual(380);
    await waitFor(() => fake.chatRequests()[0]!.closedEarly);
  });

  it("before the first token (queued on the server) the first-token timeout applies, not the idle one", async () => {
    fake = await startFakeLlm({
      chat: () => ({ stream: [sse.delay(400), ...replyWith(ONE).stream!] }),
    });
    const c = new ModelClient({
      endpoint: { kind: "local", baseUrl: fake.url },
      idleTimeoutMs: 150,
    });
    const { value } = await c.completeJson(Judgments, { messages });
    expect(value).toHaveLength(1);
    const strict = new ModelClient({
      endpoint: { kind: "local", baseUrl: fake.url },
      idleTimeoutMs: 150,
      firstTokenTimeoutMs: 200,
    });
    const err = await strict.chat({ messages }).catch((e: unknown) => e);
    expect((err as ModelError).code).toBe("timeout");
  });

  it("a first chunk with only the role does not start the idle timeout (server loading the model)", async () => {
    const role = { data: { choices: [{ index: 0, delta: { role: "assistant" } }] } };
    fake = await startFakeLlm({
      chat: () => ({ stream: [role, sse.delay(400), ...replyWith(ONE, "").stream!] }),
    });
    const { value } = await client({ idleTimeoutMs: 150 }).completeJson(Judgments, { messages });
    expect(value).toHaveLength(1);
  });

  it("a long reasoning that keeps going does not time out", async () => {
    const stream = Array.from({ length: 8 }, () => [sse.reasoning("."), sse.delay(80)]).flat();
    fake = await startFakeLlm({ chat: () => ({ stream: [...stream, ...replyWith(ONE).stream!] }) });
    const { value } = await client({ idleTimeoutMs: 200 }).completeJson(Judgments, { messages });
    expect(value).toHaveLength(1);
  });

  it("abort really closes the connection", async () => {
    fake = await startFakeLlm({
      chat: () => ({ stream: [sse.reasoning("inizio"), sse.delay(5000), sse.reasoning("mai")] }),
    });
    const controller = new AbortController();
    const p = client()
      .chat({
        messages,
        signal: controller.signal,
        onProgress: () => controller.abort(),
      })
      .catch((e: unknown) => e);
    const err = await p;
    const abortedAt = Date.now();
    expect((err as ModelError).code).toBe("aborted");
    await waitFor(() => fake.chatRequests()[0]!.closedEarly, 1000);
    expect(fake.chatRequests()[0]!.closedAt! - abortedAt).toBeLessThan(1000);
  });

  it("abort before the server's response", async () => {
    fake = await startFakeLlm({ chat: () => ({ stream: [sse.delay(5000)] }) });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const err = await client()
      .chat({ messages, signal: controller.signal })
      .catch((e: unknown) => e);
    expect((err as ModelError).code).toBe("aborted");
    await waitFor(() => fake.chatRequests()[0]?.closedEarly === true, 1000);
  });

  it("sends cache_prompt and id_slot to llama-server, generous max_tokens and temperature", async () => {
    fake = await startFakeLlm();
    await client().chat({ messages, slot: 2, temperature: 0.2 });
    const body = fake.chatRequests()[0]!.body!;
    expect(body).toMatchObject({
      stream: true,
      cache_prompt: true,
      id_slot: 2,
      max_tokens: 4096,
      temperature: 0.2,
    });
    expect(body).not.toHaveProperty("response_format");
  });

  it("slot rejected: drops it, retries, and never sends it again", async () => {
    fake = await startFakeLlm({
      chat: (body) =>
        body.id_slot !== undefined
          ? {
              status: 400,
              json: {
                error: { code: 400, message: "Invalid id_slot", type: "invalid_request_error" },
              },
            }
          : replyWith(ONE),
    });
    const c = client();
    const r = await c.chat({ messages, slot: 7 });
    expect(r.slot).toBeUndefined();
    await c.chat({ messages, slot: 7 });
    expect(fake.chatRequests().map((q) => q.body!.id_slot)).toEqual([7, undefined, undefined]);
  });

  it("the cloud does not receive llama-server's extensions and gets the key", async () => {
    fake = await startFakeLlm();
    const cloud = new ModelClient({
      endpoint: { kind: "cloud", baseUrl: fake.url, model: "big", apiKey: "k" },
    });
    await cloud.chat({ messages, slot: 1 });
    const body = fake.chatRequests()[0]!.body!;
    expect(body.model).toBe("big");
    expect(body).not.toHaveProperty("cache_prompt");
    expect(body).not.toHaveProperty("id_slot");
  });

  it("server HTTP error → ModelError http with the message", async () => {
    fake = await startFakeLlm({
      chat: () => ({ status: 503, json: { error: { message: "Loading model" } } }),
    });
    const err = await client()
      .chat({ messages })
      .catch((e: unknown) => e);
    expect((err as ModelError).code).toBe("http");
    expect((err as ModelError).message).toContain("Loading model");
  });

  it("server down → unreachable", async () => {
    fake = await startFakeLlm();
    const url = fake.url;
    await fake.close();
    const c = new ModelClient({ endpoint: { kind: "local", baseUrl: url } });
    const err = await c.chat({ messages }).catch((e: unknown) => e);
    expect((err as ModelError).code).toBe("unreachable");
  });

  it("model name, /props, token count with /tokenize and fallback estimate", async () => {
    fake = await startFakeLlm({ models: ["Qwen3.6-35B-3B-Q3_XSS"] });
    const c = client();
    expect(await c.listModels()).toEqual(["Qwen3.6-35B-3B-Q3_XSS"]);
    expect(await c.props()).toEqual({ totalSlots: 4, nCtx: 16384 });
    expect(await c.countTokens("a".repeat(40))).toEqual({ count: 10, exact: true });
    await fake.close();
    fake = await startFakeLlm({ tokenize: false, props: null });
    const c2 = client();
    expect(await c2.countTokens("a".repeat(35))).toEqual({ count: 10, exact: false });
    expect(await c2.props()).toBeNull();
  });
});
