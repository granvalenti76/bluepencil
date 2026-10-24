import { afterEach, describe, expect, it } from "vitest";
import type { DeskEvent } from "../src/events.ts";
import { replyWith, sse, startFakeLlm, type FakeLlm } from "./fake-llm.ts";
import { cleanupAll, makeServer } from "./helpers.ts";

let fake: FakeLlm | undefined;
afterEach(async () => {
  await fake?.close();
  fake = undefined;
  await cleanupAll();
});

describe("/api/model/status", () => {
  it("llama-server reachable: model name from /models", async () => {
    fake = await startFakeLlm({ models: ["Qwen3.6-35B-3B"] });
    const s = await makeServer({ modelUrl: fake.url });
    const res = await s.inject({ method: "GET", url: "/api/model/status?refresh=1" });
    expect(res.statusCode).toBe(200);
    expect(res.json().local).toMatchObject({ reachable: true, model: "Qwen3.6-35B-3B" });
    expect(res.json().cloud).toMatchObject({ enabled: false, available: false });
  });

  it("unreachable, then reachable: a model.status event at every change", async () => {
    fake = await startFakeLlm();
    const url = fake.url;
    await fake.close();
    const s = await makeServer({ modelUrl: url });
    let st = (await s.inject({ method: "GET", url: "/api/model/status?refresh=1" })).json();
    expect(st.local.reachable).toBe(false);
    const events: DeskEvent[] = [];
    s.bus.subscribe((e) => events.push(e));
    await s.inject({ method: "GET", url: "/api/model/status?refresh=1" }); // no change

    // llama-server comes back on the same port
    const port = Number(new URL(url).port);
    const { createServer } = await import("node:http");
    const srv = createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "tornato" }] }));
    });
    await new Promise<void>((r) => srv.listen(port, "127.0.0.1", r));
    try {
      st = (await s.inject({ method: "GET", url: "/api/model/status?refresh=1" })).json();
      expect(st.local).toMatchObject({ reachable: true, model: "tornato" });
      await s.inject({ method: "GET", url: "/api/model/status?refresh=1" }); // no change
    } finally {
      srv.close();
    }
    const statusEvents = events.filter((e) => e.type === "model.status");
    expect(statusEvents).toHaveLength(1);
  });

  it("cloud: available only if enabled, with an address and the key in the environment variable", async () => {
    const cloud = {
      enabled: true,
      baseUrl: "https://api.example.invalid/v1",
      model: "grande",
      apiKeyEnv: "K",
    };
    const noKey = await makeServer({ config: { cloud } });
    expect(
      (await noKey.inject({ method: "GET", url: "/api/model/status" })).json().cloud,
    ).toMatchObject({
      enabled: true,
      available: false,
      reason: "the K environment variable is missing",
    });
    const withKey = await makeServer({ config: { cloud }, env: { K: "segreta" } });
    const st = (await withKey.inject({ method: "GET", url: "/api/model/status" })).json();
    expect(st.cloud).toMatchObject({ enabled: true, available: true, model: "grande" });
    expect(JSON.stringify(st)).not.toContain("segreta");
    expect(withKey.model.client(true).endpoint.kind).toBe("cloud");
    expect(() => noKey.model.client(true)).toThrow(/cloud unavailable/);
  });

  it("requires the token like every API", async () => {
    const s = await makeServer();
    const res = await s.app.inject({
      method: "GET",
      url: "/api/model/status",
      headers: { host: "127.0.0.1:4317" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("single queue to the model", () => {
  it("a request cancelled while queued does not start", async () => {
    fake = await startFakeLlm({
      chat: () => ({ stream: [sse.delay(300), ...replyWith("[]").stream!] }),
    });
    const s = await makeServer({ modelUrl: fake.url });
    const first = s.model.run((c) => c.chat({ messages: [{ role: "user", content: "a" }] }));
    const controller = new AbortController();
    const waits: string[] = [];
    const second = s.model
      .run((c) => c.chat({ messages: [{ role: "user", content: "b" }] }), {
        signal: controller.signal,
        onWait: (w) => waits.push(w),
      })
      .catch((e: unknown) => e);
    controller.abort();
    expect(((await second) as { code: string }).code).toBe("aborted");
    expect(waits).toEqual(["queued"]);
    await first;
    expect(fake.chatRequests()).toHaveLength(1);
  });

  it("with a single slot it does not send id_slot", async () => {
    fake = await startFakeLlm({
      props: { total_slots: 1, default_generation_settings: { n_ctx: 8192 } },
    });
    const s = await makeServer({ modelUrl: fake.url });
    expect(await s.model.slotFor("a.md")).toBeUndefined();
  });
});
