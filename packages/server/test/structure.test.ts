import { afterEach, describe, expect, it } from "vitest";
import { sse, startFakeLlm, type FakeLlm } from "./fake-llm.ts";
import { scriptedChat } from "./fake-llm-script.ts";
import { cleanupAll, freePort, makeServer } from "./helpers.ts";

let fake: FakeLlm | undefined;
afterEach(async () => {
  await fake?.close();
  fake = undefined;
  await cleanupAll();
});

function events(payload: string) {
  return payload
    .split("\n\n")
    .filter((b) => b.startsWith("event:"))
    .map((b) => {
      const [ev, data] = b.split("\n");
      return { event: ev!.slice(7), data: JSON.parse(data!.slice(6)) };
    });
}

describe("POST /api/structure/propose", () => {
  it("sends the sections as a stream, then the validated outline", async () => {
    fake = await startFakeLlm({ chat: scriptedChat });
    const s = await makeServer({ modelUrl: fake.url });
    const res = await s.inject({
      method: "POST",
      url: "/api/structure/propose",
      payload: { archetype: "report", topic: "Consumi di memoria", target: 2000 },
    });
    expect(res.headers["content-type"]).toBe("text/event-stream");
    const ev = events(res.payload);
    expect(ev.filter((e) => e.event === "progress").length).toBeGreaterThan(5);
    const sections = ev.filter((e) => e.event === "section").map((e) => e.data.title);
    expect(sections).toEqual(["Sintesi", "Metodo", "Risultati", "Limiti", "Conclusioni"]);
    const done = ev.at(-1)!;
    expect(done.event).toBe("done");
    expect(done.data.sections.reduce((a: number, x: { target: number }) => a + x.target, 0)).toBe(
      2000,
    );
    expect(done.data.checks).toHaveLength(1);
    // Higher temperature for proposing, the type of text and the topic in the prompt.
    const body = fake.chatRequests()[0]!.body!;
    expect(body.temperature).toBe(0.6);
    expect(JSON.stringify(body.messages)).toContain("Consumi di memoria");
  });

  it("model unreachable → error event", async () => {
    const s = await makeServer();
    const res = await s.inject({
      method: "POST",
      url: "/api/structure/propose",
      payload: { archetype: "article", topic: "x", target: 900 },
    });
    expect(events(res.payload)).toEqual([
      { event: "error", data: expect.objectContaining({ code: "unreachable" }) },
    ]);
  });

  it("invalid request → 400", async () => {
    const s = await makeServer();
    for (const payload of [{ archetype: "boh", target: 900 }, { archetype: "article" }]) {
      const res = await s.inject({ method: "POST", url: "/api/structure/propose", payload });
      expect(res.statusCode).toBe(400);
    }
  });

  it("closing the connection cancels the model request", async () => {
    fake = await startFakeLlm({
      chat: () => ({ stream: [sse.reasoning("penso"), sse.delay(5000)] }),
    });
    const port = await freePort();
    const s = await makeServer({ modelUrl: fake.url, port });
    await s.app.listen({ port, host: "127.0.0.1" });
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/structure/propose`, {
      method: "POST",
      headers: { ...s.headers, "content-type": "application/json" },
      body: JSON.stringify({ archetype: "blog", topic: "x", target: 700 }),
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    await reader.read(); // first event: the model is thinking
    controller.abort();
    const start = Date.now();
    while (!fake.chatRequests()[0]?.closedEarly) {
      if (Date.now() - start > 1000) throw new Error("connection to the model still open");
      await new Promise((r) => setTimeout(r, 10));
    }
  });
});
