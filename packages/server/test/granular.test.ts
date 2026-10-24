import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Judgment } from "@desk/core";
import type { DeskEvent } from "../src/events.ts";
import { startFakeLlm, type FakeLlm } from "./fake-llm.ts";
import { FAKE_SCORES, scriptedChat } from "./fake-llm-script.ts";
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
  const events: DeskEvent[] = [];
  s.bus.subscribe((e) => events.push(e));
  const review = async (payload: Record<string, unknown> = {}) => {
    const res = await s.inject({ method: "POST", url: `/api/review/${TURBO}`, payload });
    expect(res.statusCode).toBe(202);
    const { runId } = res.json() as { runId: string };
    const from = events.length;
    await s.runner.wait(runId);
    return events.slice(from).filter((e) => "runId" in e && e.runId === runId);
  };
  const body = async () =>
    (await s.inject({ method: "GET", url: `/api/drafts/${TURBO}` })).json().body as string;
  const open = async () =>
    (
      (await s.inject({ method: "GET", url: `/api/drafts/${TURBO}/judgments` })).json() as {
        judgments: Judgment[];
      }
    ).judgments.filter((j) => j.status === "open");
  const scores = async () =>
    (await s.inject({ method: "GET", url: `/api/scores/${TURBO}` })).json().scores as {
      kind: string;
      value: number;
      bodyHash: string;
      updatedAt: string;
    }[];
  const users = () =>
    fake!.chatRequests().map((r) => (r.body!.messages as { content: string }[])[1]!.content);
  const tools = () =>
    fake!
      .chatRequests()
      .map((r) =>
        ((r.body!.tools ?? []) as { function: { name: string } }[]).map((t) => t.function.name),
      );
  return { s, review, body, open, scores, users, tools };
}

const created = (evs: DeskEvent[]) =>
  evs.flatMap((e) => (e.type === "judgment.created" ? e.judgments : []));

describe("granular review", () => {
  it("grammar only: one call, only grammar notes; the others stay", async () => {
    const { review, open, users, tools } = await setup();
    const events = await review({ types: ["grammar"] });
    expect(users()).toHaveLength(1);
    expect(users()[0]).toContain("\nANALISI GRAMMATICALE.");
    expect(tools()[0]).toEqual(["annota", "lettera"]);
    expect(new Set(created(events).map((j) => j.pass))).toEqual(new Set(["grammar"]));
    const grammar = (await open()).map((j) => j.id);

    // Then prose: the grammar notes are not touched.
    await review({ types: ["prose"] });
    const after = await open();
    expect(after.filter((j) => j.pass === "grammar").map((j) => j.id)).toEqual(grammar);
    expect(after.some((j) => j.pass === "prose")).toBe(true);

    // The full review reuses grammar and prose already done on the same text.
    const n = users().length;
    await review();
    expect(users().length - n).toBe(2);
  });

  it("prose only: a dedicated call with the prose score", async () => {
    const { review, users, scores, tools } = await setup();
    const events = await review({ types: ["prose"] });
    expect(users()).toHaveLength(1);
    expect(users()[0]).toContain("\nANALISI DELLA PROSA.");
    expect(tools()[0]).toEqual(["annota", "valuta", "lettera"]);
    expect(new Set(created(events).map((j) => j.pass))).toEqual(new Set(["prose"]));
    expect((await scores()).map((x) => x.kind)).toEqual(["prose"]);
  });

  it("full review: prose and structure scores, with the body's fingerprint", async () => {
    const { review, body, scores } = await setup();
    const events = await review();
    const hash = createHash("sha256")
      .update(await body())
      .digest("hex");
    const list = await scores();
    expect(list).toEqual([
      expect.objectContaining({ kind: "prose", value: FAKE_SCORES.prose, bodyHash: hash }),
      expect.objectContaining({ kind: "structure", value: FAKE_SCORES.structure, bodyHash: hash }),
    ]);
    const emitted = events.flatMap((e) => (e.type === "review.score" ? [e.score.kind] : []));
    expect(emitted.sort()).toEqual(["prose", "structure"]);
  });

  it("selection: the model sees everything, checks the passage, and only its notes are touched", async () => {
    const { review, body, open, users, scores, tools } = await setup();
    await review();
    const scoresBefore = await scores();
    const text = await body();
    const para = text.split("\n\n").find((p) => p.includes("si può integrare"))!;
    const from = text.indexOf(para);
    const outside = (await open()).filter(
      (j) => j.range && (j.range.to <= from || j.range.from >= from + para.length),
    );
    const n = users().length;

    const events = await review({
      types: ["grammar", "prose", "structure"],
      selection: { from, to: from + para.length, text: para },
    });
    const calls = users().slice(n);
    // No structure on a selection: grammar and prose, without a score.
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c).toContain("Turbocode è un agent harness locale"); // the whole text
      expect(c).toContain("Lavora solo sul tratto selezionato");
      expect(c).toContain(`<<<\n${para}\n>>>`);
    }
    expect(tools().slice(n)).toEqual([["annota"], ["annota"]]);

    const js = created(events);
    expect(js.some((j) => j.pass === "grammar")).toBe(true);
    for (const j of js) {
      expect(j.range!.from).toBeGreaterThanOrEqual(from);
      expect(j.range!.to).toBeLessThanOrEqual(from + para.length);
    }
    const ids = new Set((await open()).map((j) => j.id));
    for (const j of outside) expect(ids.has(j.id)).toBe(true);
    // The scores of the whole text do not change.
    expect(await scores()).toEqual(scoresBefore);
  });

  it("selection no longer in the text: clear error, no call", async () => {
    const { review, users } = await setup();
    const events = await review({
      types: ["grammar"],
      selection: { from: 0, to: 10, text: "testo che non c'è" },
    });
    expect(users()).toHaveLength(0);
    expect(events.find((e) => e.type === "review.error")).toMatchObject({
      code: "selection_changed",
      fatal: true,
    });
  });

  it("selection moved (late save): the passage is found again", async () => {
    const { review, body, users } = await setup();
    const text = await body();
    const quote = "si può integrare";
    const at = text.indexOf(quote);
    await review({
      types: ["grammar"],
      selection: { from: at + 7, to: at + 7 + quote.length, text: quote },
    });
    expect(users()).toHaveLength(1);
  });

  it('"Clear suggestions": all the notes go, and the next review starts from the model again', async () => {
    const { s, review, open, users } = await setup();
    await review({ types: ["grammar", "prose"] });
    expect((await open()).length).toBeGreaterThan(0);
    const res = await s.inject({ method: "DELETE", url: `/api/drafts/${TURBO}/judgments` });
    expect(res.statusCode).toBe(200);
    expect(res.json().removed).toBeGreaterThan(0);
    expect(await open()).toEqual([]);
    const n = users().length;
    await review({ types: ["grammar", "prose"] });
    expect(users().length - n).toBe(2); // no cache: asked again
    expect((await open()).length).toBeGreaterThan(0);
    expect(
      (await s.inject({ method: "DELETE", url: "/api/drafts/..%2Ffuori.md/judgments" })).statusCode,
    ).toBe(400);
  });

  it("routes: invalid types or selection → 400", async () => {
    const { s } = await setup();
    for (const payload of [
      { types: [] },
      { steps: ["facts"] },
      { selection: { from: 5, to: 2, text: "x" } },
      { selection: { from: 0, to: 2, text: "" } },
    ]) {
      const res = await s.inject({ method: "POST", url: `/api/review/${TURBO}`, payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });
});

describe('"Rephrase" on the selection', () => {
  const sse = (raw: string) =>
    [...raw.matchAll(/^event: (.*)\ndata: (.*)$/gm)].map((m) => ({
      event: m[1]!,
      data: JSON.parse(m[2]!) as Record<string, unknown>,
    }));

  it("proposes alternatives without touching the file", async () => {
    const { s, body, users } = await setup();
    const file = join(s.dir, TURBO);
    const before = await readFile(file, "utf8");
    const text = await body();
    const passage = "È un harness completamente scritto in Swift";
    const from = text.indexOf(passage);
    const res = await s.inject({
      method: "POST",
      url: "/api/proposals/rewrite",
      payload: { path: TURBO, from, to: from + passage.length, text: passage, style: "concise" },
    });
    expect(res.statusCode).toBe(200);
    const done = sse(res.body).find((e) => e.event === "done")!;
    expect(done.data.alternatives).toEqual([
      "È un harness scritto in Swift",
      `In breve: ${passage}`,
    ]);
    expect(await readFile(file, "utf8")).toBe(before);
    // The model reads the whole text and the passage.
    expect(users()[0]).toContain("Turbocode è un agent harness locale");
    expect(users()[0]).toContain(`Tratto da riformulare:\n<<<\n${passage}\n>>>`);
    const system = (fake!.chatRequests()[0]!.body!.messages as { content: string }[])[0]!.content;
    expect(system).toContain("più concisa");
  });

  it("selected text changed → 409; unknown style → 400", async () => {
    const { s } = await setup();
    const base = { path: TURBO, from: 0, to: 5 };
    const gone = await s.inject({
      method: "POST",
      url: "/api/proposals/rewrite",
      payload: { ...base, text: "non c'è", style: "clear" },
    });
    expect(gone.statusCode).toBe(409);
    const bad = await s.inject({
      method: "POST",
      url: "/api/proposals/rewrite",
      payload: { ...base, text: "Turbo", style: "barocco" },
    });
    expect(bad.statusCode).toBe(400);
  });
});
