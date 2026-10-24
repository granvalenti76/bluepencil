import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { cleanupAll, freePort, makeServer, TOKEN } from "./helpers.ts";

afterEach(cleanupAll);

const TURBO = "turbocode-draft-12-settembre.md";

/** Opens the SSE stream and returns the messages received so far. */
async function openSse(port: number) {
  const ctl = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}/api/events?t=${TOKEN}`, { signal: ctl.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: { type: string; data: Record<string, unknown> }[] = [];
  let buffer = "";
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        for (let i = buffer.indexOf("\n\n"); i !== -1; i = buffer.indexOf("\n\n")) {
          const block = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          const type = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (type && data) events.push({ type, data: JSON.parse(data) });
        }
      }
    } catch {
      /* closed */
    }
  })();
  const waitFor = async (pred: (e: (typeof events)[number]) => boolean, ms: number) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const hit = events.find(pred);
      if (hit) return { event: hit, elapsed: Date.now() - t0 };
      await new Promise((r) => setTimeout(r, 10));
    }
    return null;
  };
  return {
    res,
    events,
    waitFor,
    close: () => {
      ctl.abort();
      return pump;
    },
  };
}

describe("SSE draft.changed", () => {
  test("without a token the SSE is rejected", async () => {
    const port = await freePort();
    const s = await makeServer({ port });
    await s.app.listen({ host: "127.0.0.1", port });
    const res = await fetch(`http://127.0.0.1:${port}/api/events`);
    expect(res.status).toBe(401);
    const bad = await fetch(`http://127.0.0.1:${port}/api/events?t=sbagliato`);
    expect(bad.status).toBe(401);
  });

  test("an external change to the file arrives within 1 s and the index is updated", async () => {
    const port = await freePort();
    const s = await makeServer({ port, watch: true });
    await s.app.listen({ host: "127.0.0.1", port });
    const sse = await openSse(port);
    expect(sse.res.headers.get("content-type")).toContain("text/event-stream");

    const d = (await s.inject({ method: "GET", url: `/api/drafts/${TURBO}` })).json();
    await writeFile(join(s.dir, TURBO), d.text + "\nParole aggiunte da fuori.\n");

    const hit = await sse.waitFor((e) => e.type === "draft.changed" && e.data.path === TURBO, 1000);
    expect(hit, "evento draft.changed entro 1 s").not.toBeNull();
    expect(hit!.event.data).toMatchObject({ change: "change", path: TURBO });
    expect(hit!.event.data.contentHash).not.toBe(d.contentHash);
    expect(s.index.get(TURBO)?.words).toBe(812 + 4);
    await sse.close();
  });

  test("a new file and a deleted one raise add and unlink", async () => {
    const port = await freePort();
    const s = await makeServer({ port, watch: true });
    await s.app.listen({ host: "127.0.0.1", port });
    const sse = await openSse(port);

    await writeFile(join(s.dir, "arrivata.md"), "# Arrivata\n");
    expect(
      await sse.waitFor((e) => e.data.path === "arrivata.md" && e.data.change === "add", 1000),
    ).not.toBeNull();
    expect(s.index.get("arrivata.md")).toBeDefined();

    const { unlink } = await import("node:fs/promises");
    await unlink(join(s.dir, "arrivata.md"));
    expect(
      await sse.waitFor((e) => e.data.path === "arrivata.md" && e.data.change === "unlink", 1000),
    ).not.toBeNull();
    expect(s.index.get("arrivata.md")).toBeUndefined();
    await sse.close();
  });

  test("the server's own writes raise no events", async () => {
    const port = await freePort();
    const s = await makeServer({ port, watch: true });
    await s.app.listen({ host: "127.0.0.1", port });
    const sse = await openSse(port);

    const d = (await s.inject({ method: "GET", url: `/api/drafts/${TURBO}` })).json();
    const put = await s.inject({
      method: "PUT",
      url: `/api/drafts/${TURBO}`,
      payload: { body: d.body + "\nDal server.\n", baseHash: d.contentHash },
    });
    expect(put.statusCode).toBe(200);
    await s.inject({ method: "POST", url: "/api/drafts", payload: { title: "Creata dal server" } });

    expect(await sse.waitFor((e) => e.type === "draft.changed", 700)).toBeNull();

    // the stream is alive: an external change arrives
    await writeFile(join(s.dir, TURBO), "# Esterna\n");
    expect(await sse.waitFor((e) => e.data.path === TURBO, 1000)).not.toBeNull();
    await sse.close();
  });

  test("hidden and temporary files raise no events", async () => {
    const port = await freePort();
    const s = await makeServer({ port, watch: true });
    await s.app.listen({ host: "127.0.0.1", port });
    const sse = await openSse(port);
    await writeFile(join(s.dir, ".nascosto.md"), "x");
    await writeFile(join(s.dir, "note.txt"), "x");
    expect(await sse.waitFor(() => true, 500)).toBeNull();
    await sse.close();
  });
});
