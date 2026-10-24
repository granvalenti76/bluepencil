import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { countWords, type PassRecord } from "@desk/core";
import { startFakeLlm, type FakeLlm } from "./fake-llm.ts";
import { scriptedChat } from "./fake-llm-script.ts";
import { cleanupAll, makeServer } from "./helpers.ts";

const TURBO = "turbocode-draft-12-settembre.md";
let fake: FakeLlm | undefined;
afterEach(async () => {
  await fake?.close();
  fake = undefined;
  await cleanupAll();
});

async function setup() {
  fake = await startFakeLlm({ chat: scriptedChat });
  const s = await makeServer({ modelUrl: fake.url });
  const review = async (payload: Record<string, unknown> = {}) => {
    const res = await s.inject({ method: "POST", url: `/api/review/${TURBO}`, payload });
    expect(res.statusCode).toBe(202);
    await s.runner.wait((res.json() as { runId: string }).runId);
  };
  const passes = async () =>
    (
      (await s.inject({ method: "GET", url: `/api/passes/${TURBO}` })).json() as {
        passes: PassRecord[];
      }
    ).passes;
  const put = (payload: unknown) =>
    s.inject({ method: "PUT", url: `/api/passes/${TURBO}`, payload: payload as object });
  const body = async () =>
    (await s.inject({ method: "GET", url: `/api/drafts/${TURBO}` })).json().body as string;
  const calls = () => fake!.chatRequests().length;
  return { s, review, passes, put, body, calls };
}

const brief = (p: PassRecord) => [p.pass, p.state];

describe("review passes", () => {
  it("the full review goes top to bottom: structure, facts, prose, grammar", async () => {
    const { review, passes } = await setup();
    await review();
    const users = fake!
      .chatRequests()
      .map((r) => (r.body!.messages as { content: string }[])[1]!.content);
    const HEADS = {
      structure: "ANALISI DELLA STRUTTURA.",
      facts: "ANALISI DEI FATTI.",
      prose: "ANALISI DELLA PROSA.",
      grammar: "ANALISI GRAMMATICALE.",
    };
    const order = users.map((u) => Object.entries(HEADS).find(([, h]) => u.includes(h))?.[0]);
    expect(order).toEqual(["structure", "facts", "prose", "grammar"]);
    expect((await passes()).map(brief)).toEqual([
      ["structure", "open"],
      ["facts", "open"],
      ["prose", "open"],
      ["grammar", "open"],
    ]);
  });

  it('one pass at a time: once computed it becomes "open", re-entering with the text unchanged does not call the model', async () => {
    const { review, passes, calls } = await setup();
    expect(await passes()).toEqual([]);
    await review({ types: ["structure"] });
    expect(calls()).toBe(1);
    expect((await passes()).map(brief)).toEqual([["structure", "open"]]);
    await review({ types: ["structure"] });
    expect(calls()).toBe(1);
  });

  it("closing a pass saves the body's fingerprint and word count; recomputing it does not reopen it", async () => {
    const { review, passes, put, body } = await setup();
    await review({ types: ["structure"] });
    const res = await put({ pass: "structure", state: "done" });
    expect(res.statusCode).toBe(200);
    const text = await body();
    const [done] = await passes();
    expect(done).toMatchObject({
      pass: "structure",
      state: "done",
      bodyHash: createHash("sha256").update(text).digest("hex"),
      words: countWords(text),
    });
    await review({ types: ["structure"] });
    expect((await passes()).map(brief)).toEqual([["structure", "done"]]);

    await put({ pass: "facts", state: "skipped" });
    await put({ pass: "structure", state: "open" });
    expect((await passes()).map(brief)).toEqual([
      ["structure", "open"],
      ["facts", "skipped"],
    ]);
  });

  it("a check on a selection does not count as a pass", async () => {
    const { review, passes, body } = await setup();
    const text = await body();
    const sel = "Per lavori più complessi si può integrare modelli cloud.";
    const from = text.indexOf(sel);
    await review({ types: ["grammar"], selection: { from, to: from + sel.length, text: sel } });
    expect(await passes()).toEqual([]);
  });

  it('starting over: "Restart" removes the passes, "Clear suggestions" too', async () => {
    const { s, review, passes } = await setup();
    await review({ types: ["structure"] });
    await s.inject({ method: "DELETE", url: `/api/passes/${TURBO}` });
    expect(await passes()).toEqual([]);
    await review({ types: ["structure"] });
    await s.inject({
      method: "DELETE",
      url: `/api/drafts/${encodeURIComponent(TURBO)}/judgments`,
    });
    expect(await passes()).toEqual([]);
  });

  it("bad requests: 400", async () => {
    const { put } = await setup();
    expect((await put({ pass: "spelling", state: "done" })).statusCode).toBe(400);
    expect((await put({ pass: "facts", state: "finished" })).statusCode).toBe(400);
    expect((await put({ pass: "facts", state: "done", extra: 1 })).statusCode).toBe(400);
  });
});
