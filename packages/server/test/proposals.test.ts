import { afterEach, describe, expect, it } from "vitest";
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

const events = (payload: string) =>
  payload
    .split("\n\n")
    .filter((b) => b.startsWith("event:"))
    .map((b) => ({
      event: b.split("\n")[0]!.slice(7),
      data: JSON.parse(b.split("\n")[1]!.slice(6)),
    }));

describe("POST /api/proposals/section", () => {
  it("draft of a missing section: only a proposal, the file does not change", async () => {
    fake = await startFakeLlm({ chat: scriptedChat });
    const s = await makeServer({ modelUrl: fake.url });
    const before = (await s.inject({ method: "GET", url: `/api/drafts/${TURBO}` })).json()
      .contentHash;
    const res = await s.inject({
      method: "POST",
      url: "/api/proposals/section",
      payload: { path: TURBO, sectionId: "closing", mode: "draft" },
    });
    const ev = events(res.payload);
    expect(ev.at(-1)).toEqual({
      event: "done",
      data: { text: expect.stringContaining("La 0.6 è disponibile da oggi") },
    });
    const prompt = JSON.stringify(fake.chatRequests()[0]!.body!.messages);
    expect(prompt).toContain("prima stesura della sezione «Chiusura» (circa 50 parole)");
    expect(prompt).toContain("Testo subito prima");
    const after = (await s.inject({ method: "GET", url: `/api/drafts/${TURBO}` })).json()
      .contentHash;
    expect(after).toBe(before);
  });

  it("new version: sends the current text without the heading, and the note's reason", async () => {
    fake = await startFakeLlm({ chat: scriptedChat });
    const s = await makeServer({ modelUrl: fake.url });
    s.judgments.insert({
      id: "J1",
      draftPath: TURBO,
      pass: "structure",
      kind: "lead-why",
      quote: "",
      title: "Lead",
      rationale: "Manca il perché.",
      proposal: { action: "regenerate_section", label: "Riscrivi lead" },
      range: null,
      anchor: { quote: "", prefix: "", suffix: "" },
      status: "open",
      chunkHash: "x",
      model: "m",
      promptVersion: "p",
      createdAt: new Date().toISOString(),
    });
    const res = await s.inject({
      method: "POST",
      url: "/api/proposals/section",
      payload: { path: TURBO, sectionId: "context", mode: "regenerate", judgmentId: "J1" },
    });
    expect(events(res.payload).at(-1)!.event).toBe("done");
    const user = (fake.chatRequests()[0]!.body!.messages as { content: string }[])[1]!.content;
    expect(user).toContain("Motivo: Manca il perché.");
    expect(user).toContain("Testo attuale della sezione:\n<<<\nÈ un harness completamente");
    expect(user).not.toContain("## Cosa è Turbocode\n\nÈ");
  });

  it("unknown section → 404; invalid body → 400", async () => {
    const s = await makeServer();
    const r1 = await s.inject({
      method: "POST",
      url: "/api/proposals/section",
      payload: { path: TURBO, sectionId: "boh", mode: "draft" },
    });
    expect(r1.statusCode).toBe(404);
    const r2 = await s.inject({
      method: "POST",
      url: "/api/proposals/section",
      payload: { path: TURBO },
    });
    expect(r2.statusCode).toBe(400);
  });
});
