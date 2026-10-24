import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DeskEvent } from "../src/events.ts";
import { replyWith, replyWithTools, sse, startFakeLlm, type FakeLlm } from "./fake-llm.ts";
import { scriptedChat } from "./fake-llm-script.ts";
import { cleanupAll, makeServer } from "./helpers.ts";

const TURBO = "turbocode-draft-12-settembre.md";
let fake: FakeLlm | undefined;
afterEach(async () => {
  await fake?.close();
  fake = undefined;
  await cleanupAll();
});

async function setup(chat = scriptedChat, extra: Parameters<typeof startFakeLlm>[0] = {}) {
  fake = await startFakeLlm({ chat, ...extra });
  const s = await makeServer({ modelUrl: fake.url });
  const events: DeskEvent[] = [];
  s.bus.subscribe((e) => events.push(e));
  const review = async (body: Record<string, unknown> = {}, path = TURBO) => {
    const res = await s.inject({ method: "POST", url: `/api/review/${path}`, payload: body });
    expect(res.statusCode).toBe(202);
    const { runId } = res.json() as { runId: string };
    const from = events.length;
    await s.runner.wait(runId);
    const mine = events.slice(from).filter((e) => "runId" in e && e.runId === runId);
    const done = mine.find((e) => e.type === "review.done") as Extract<
      DeskEvent,
      { type: "review.done" }
    >;
    return { runId, events: mine, done };
  };
  return { s, events, review };
}

const created = (evs: DeskEvent[]) =>
  evs.flatMap((e) => (e.type === "judgment.created" ? e.judgments : []));

const userOf = (r: { body?: Record<string, unknown> | null }) =>
  (r.body!.messages as { content: string }[])[1]!.content;
const toolsOf = (r: { body?: Record<string, unknown> | null }) =>
  ((r.body!.tools ?? []) as { function: { name: string } }[]).map((t) => t.function.name);

describe("review: four analyses on the whole text", () => {
  it("structure, facts, prose, grammar: one call each, notes via «annota»", async () => {
    const { s, review } = await setup();
    const { events, done } = await review();
    expect(done.cancelled).toBe(false);
    const js = created(events);
    // One event per analysis, in order.
    const batches = events.flatMap((e) => (e.type === "judgment.created" ? [e.judgments] : []));
    expect(batches.map((b) => [...new Set(b.map((j) => j.pass))])).toEqual([
      ["structure"],
      ["facts"],
      ["prose"],
      ["grammar"],
    ]);

    const calls = fake!.chatRequests();
    expect(calls.map((c) => /\n(ANALISI [A-Z ]+)\./.exec(userOf(c))?.[1])).toEqual([
      "ANALISI DELLA STRUTTURA",
      "ANALISI DEI FATTI",
      "ANALISI DELLA PROSA",
      "ANALISI GRAMMATICALE",
    ]);
    // The score only for structure and prose.
    expect(calls.map(toolsOf)).toEqual([
      ["annota", "valuta", "lettera"],
      ["annota", "lettera"],
      ["annota", "valuta", "lettera"],
      ["annota", "lettera"],
    ]);
    for (const c of calls) {
      expect(userOf(c)).toContain("Turbocode è un agent harness locale");
      expect(userOf(c)).toContain("In una sessione tipica");
    }

    const agreement = js.find((j) => j.pass === "grammar")!;
    expect(agreement).toMatchObject({
      title: "si può integrare → si possono integrare",
      proposal: { action: "replace", text: "si possono integrare", label: "Fix" },
    });
    const body = (await s.inject({ method: "GET", url: `/api/drafts/${TURBO}` })).json()
      .body as string;
    expect(body.slice(agreement.range!.from, agreement.range!.to)).toBe("si può integrare");
    expect(agreement.sectionId).toBeDefined();
    expect(js.filter((j) => j.factStatus === "verified")).toHaveLength(3);
    // A structure observation without a quote stays, without an underline.
    expect(js.find((j) => j.title === "Sezione «Chiusura» mancante")).toMatchObject({
      pass: "structure",
      range: null,
    });
    expect(done.stats).toMatchObject({
      steps: 4,
      modelCalls: 4,
      cached: 0,
      errors: 0,
      judgments: js.length,
    });
    const listed = (
      await s.inject({ method: "GET", url: `/api/drafts/${encodeURIComponent(TURBO)}/judgments` })
    ).json().judgments;
    expect(listed).toHaveLength(js.length);
    expect(events.some((e) => e.type === "review.progress" && e.phase === "reasoning")).toBe(true);
  });

  it("the analyses share the start of the request: system, context and text", async () => {
    const { review } = await setup();
    await review();
    const all = fake!.chatRequests().map((r) => r.body!.messages as { content: string }[]);
    const head = (u: string) => u.slice(0, u.indexOf("\n>>>\n") + 5);
    for (const m of all) {
      expect(m[0]!.content).toBe(all[0]![0]!.content);
      expect(head(m[1]!.content)).toBe(head(all[0]![1]!.content));
    }
    // No word counts or checklist in the context.
    expect(all[0]![0]!.content).not.toMatch(/parole|Checklist/);
  });

  it("malformed notes: discarded one by one, without a second call", async () => {
    const { review } = await setup(() => ({
      stream: [
        ...sse.toolCall(
          0,
          "annota",
          JSON.stringify({ citazione: "si può integrare", correzione: "si possono integrare" }),
        ),
        ...sse.toolCall(1, "annota", JSON.stringify({ citazione: "Turbocode" })), // the correction is missing
        ...sse.toolCall(2, "annota", "{non è json"),
        sse.finish("tool_calls"),
        sse.done(),
      ],
    }));
    const { events, done } = await review({ types: ["grammar"] });
    expect(fake!.chatRequests()).toHaveLength(1);
    expect(done.stats.errors).toBe(0);
    expect(created(events).map((j) => j.quote)).toEqual(["si può integrare"]);
  });

  it("without tools the model can answer with a JSON array in the text", async () => {
    const { review } = await setup(() =>
      replyWith(
        "```json\n" +
          JSON.stringify([
            { citazione: "completamente", problema: "Avverbio che non aggiunge nulla." },
          ]) +
          "\n```",
      ),
    );
    const { events } = await review({ types: ["prose"] });
    expect(created(events)).toEqual([
      expect.objectContaining({ pass: "prose", title: "Avverbio che non aggiunge nulla." }),
    ]);
  });

  it("quote not found in the text: the note stays, without underline or change", async () => {
    const { review } = await setup(() =>
      replyWithTools([
        {
          name: "annota",
          args: {
            citazione: "una frase che non c'è",
            problema: "Periodo senza filo logico.",
            proposta: "altro",
          },
        },
      ]),
    );
    const { events } = await review({ types: ["prose"] });
    expect(created(events)).toEqual([
      expect.objectContaining({
        range: null,
        title: "Periodo senza filo logico.",
        proposal: { action: "none", label: "Got it" },
      }),
    ]);
  });

  it("the response gets at most half the server's context, and at most 16k tokens", async () => {
    const { review } = await setup(); // the fake server declares a 16k context
    await review({ types: ["grammar"] });
    expect(fake!.chatRequests().at(-1)!.body!.max_tokens).toBe(8192);
    await fake!.close();
    const big = await setup(scriptedChat, {
      props: { total_slots: 1, default_generation_settings: { n_ctx: 131072 } },
    });
    await big.review({ types: ["grammar"] });
    expect(fake!.chatRequests().at(-1)!.body!.max_tokens).toBe(16384);
  });

  it("a second review without changes uses the cache and ends in under 1 s", async () => {
    const { review } = await setup();
    const first = await review();
    const calls = fake!.chatRequests().length;
    const t = Date.now();
    const second = await review();
    expect(Date.now() - t).toBeLessThan(1000);
    expect(fake!.chatRequests()).toHaveLength(calls);
    expect(second.done.stats).toMatchObject({ modelCalls: 0, cached: first.done.stats.steps });
    expect(created(second.events)).toHaveLength(0); // no duplicates
  });

  it("changing the text checks every analysis again on the whole text and replaces the notes", async () => {
    const { s, review } = await setup();
    await review();
    const before = fake!.chatRequests().length;
    const file = join(s.dir, TURBO);
    const text = await readFile(file, "utf8");
    await writeFile(
      file,
      text.replace("concepito attorno a due principi", "pensato attorno a due principi"),
    );
    const { done, events } = await review();
    const calls = fake!.chatRequests().slice(before);
    expect(calls).toHaveLength(4);
    for (const c of calls) {
      expect(userOf(c)).toContain("pensato attorno a due principi");
      expect(userOf(c)).toContain("In una sessione tipica");
    }
    expect(done.stats).toMatchObject({ cached: 0, modelCalls: 4 });
    // The earlier open notes were replaced by the new ones.
    const removed = events.flatMap((e) => (e.type === "judgment.created" ? e.removed : []));
    expect(removed.length).toBeGreaterThan(0);
  });

  it("a dismissed judgment is not proposed again on the same text", async () => {
    const { s, review } = await setup();
    const { events } = await review();
    const adverb = created(events).find((j) => j.quote === "completamente")!;
    await s.inject({
      method: "PATCH",
      url: `/api/judgments/${adverb.id}`,
      payload: { status: "ignored" },
    });
    // Dismissing changes the context (list of dismissed notes): the next review checks everything again…
    const again = await review();
    expect(created(again.events).some((j) => j.quote === "completamente")).toBe(false);
    const prompt = JSON.stringify(fake!.chatRequests().at(-1)!.body!.messages);
    expect(prompt).toContain("- «completamente»");
  });

  it('"Cancel review" stops generation within 1 s and closes the connection', async () => {
    const { s, review } = await setup(() => ({
      stream: [sse.reasoning("penso"), sse.delay(10_000), sse.content("[]")],
    }));
    const res = await s.inject({ method: "POST", url: `/api/review/${TURBO}`, payload: {} });
    const { runId } = res.json() as { runId: string };
    while (fake!.chatRequests().length === 0) await new Promise((r) => setTimeout(r, 10));
    await new Promise((r) => setTimeout(r, 50));
    const t = Date.now();
    const del = await s.inject({ method: "DELETE", url: `/api/review/runs/${runId}` });
    expect(del.statusCode).toBe(204);
    await s.runner.wait(runId);
    expect(Date.now() - t).toBeLessThan(1000);
    while (!fake!.chatRequests()[0]!.closedEarly) {
      expect(Date.now() - t).toBeLessThan(1000);
      await new Promise((r) => setTimeout(r, 10));
    }
    void review;
  });

  it("a single request at a time to the model, even with two reviews together", async () => {
    let active = 0;
    let max = 0;
    const { s } = await setup((body, log) => {
      active++;
      max = Math.max(max, active);
      const r = scriptedChat(body, log);
      return { stream: [sse.delay(5), ...r.stream!] };
    });
    // The fake server does not know when the client has finished reading: count on close.
    const origRequests = fake!.requests;
    const timer = setInterval(() => {
      active = origRequests.filter(
        (r) => r.path === "/v1/chat/completions" && r.closedAt === undefined,
      ).length;
    }, 1);
    const other = "modelli-locali-su-mac.md";
    const a = (await s.inject({ method: "POST", url: `/api/review/${TURBO}`, payload: {} })).json()
      .runId;
    const b = (await s.inject({ method: "POST", url: `/api/review/${other}`, payload: {} })).json()
      .runId;
    await Promise.all([s.runner.wait(a), s.runner.wait(b)]);
    clearInterval(timer);
    expect(max).toBe(1);
  });

  it("server busy with another app: waits and says so", async () => {
    let polls = 0;
    const { review } = await setup(scriptedChat, { slots: () => [polls++ < 2] });
    const s2 = await review({ types: ["grammar"] });
    expect(s2.events.some((e) => e.type === "review.progress" && e.phase === "busy")).toBe(true);
    expect(s2.done.stats.errors).toBe(0);
  });

  it("truncated response: error for that analysis; answer in words: no notes", async () => {
    let n = 0;
    const { review } = await setup((body, log) => {
      n++;
      if (n === 1)
        return { stream: [sse.content('[{"citazione": "tron'), sse.finish("length"), sse.done()] };
      if (n === 2) return replyWith("Non ho trovato nulla di strano.");
      return scriptedChat(body, log);
    });
    const { done, events } = await review({ types: ["structure", "facts", "grammar"] });
    expect(fake!.chatRequests()).toHaveLength(3); // no second repair call
    const errors = events.filter((e) => e.type === "review.error");
    expect(errors.map((e) => (e as { code: string }).code)).toEqual(["truncated"]);
    expect(errors.every((e) => (e as { fatal: boolean }).fatal === false)).toBe(true);
    expect(done.cancelled).toBe(false);
    expect(created(events).some((j) => j.pass === "grammar")).toBe(true);
  });

  it("model unreachable: error and end", async () => {
    fake = await startFakeLlm();
    const url = fake.url;
    await fake.close();
    fake = undefined;
    const s = await makeServer({ modelUrl: url });
    const events: DeskEvent[] = [];
    s.bus.subscribe((e) => events.push(e));
    const { runId } = (
      await s.inject({ method: "POST", url: `/api/review/${TURBO}`, payload: {} })
    ).json();
    await s.runner.wait(runId);
    expect(events.find((e) => e.type === "review.error")).toMatchObject({
      code: "unreachable",
      fatal: true,
    });
    expect(events.at(-1)!.type).toBe("review.done");
  });

  it("routes: invalid path, invalid body, unknown run", async () => {
    const s = await makeServer();
    expect(
      (await s.inject({ method: "POST", url: "/api/review/.nascosto.md", payload: {} })).statusCode,
    ).toBe(400);
    expect(
      (
        await s.inject({
          method: "POST",
          url: `/api/review/${TURBO}`,
          payload: { types: ["boh"] },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await s.inject({
          method: "POST",
          url: `/api/review/${TURBO}`,
          payload: { passes: ["grammar"] },
        })
      ).statusCode,
    ).toBe(400);
    expect((await s.inject({ method: "DELETE", url: "/api/review/runs/nessuna" })).statusCode).toBe(
      404,
    );
  });
});
