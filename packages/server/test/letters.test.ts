import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { DeskEvent } from "../src/events.ts";
import type { StoredLetter } from "../src/index-db/letters.ts";
import { replyWithTools, startFakeLlm, type FakeLlm } from "./fake-llm.ts";
import { FAKE_LETTERS, scriptedChat } from "./fake-llm-script.ts";
import { cleanupAll, makeServer } from "./helpers.ts";

const TURBO = "turbocode-draft-12-settembre.md";
let fake: FakeLlm | undefined;
afterEach(async () => {
  await fake?.close();
  fake = undefined;
  await cleanupAll();
});

async function setup(chat = scriptedChat) {
  fake = await startFakeLlm({ chat });
  const s = await makeServer({ modelUrl: fake.url });
  const events: DeskEvent[] = [];
  s.bus.subscribe((e) => events.push(e));
  const review = async (payload: Record<string, unknown> = {}) => {
    const res = await s.inject({ method: "POST", url: `/api/review/${TURBO}`, payload });
    expect(res.statusCode).toBe(202);
    await s.runner.wait((res.json() as { runId: string }).runId);
  };
  const letters = async () =>
    (
      (await s.inject({ method: "GET", url: `/api/letters/${TURBO}` })).json() as {
        letters: StoredLetter[];
      }
    ).letters;
  const body = async () =>
    (await s.inject({ method: "GET", url: `/api/drafts/${TURBO}` })).json().body as string;
  return { s, events, review, letters, body };
}

const byPass = (ls: StoredLetter[]) => Object.fromEntries(ls.map((l) => [l.pass, l.text]));

describe("the editor's letter", () => {
  it("one per pass, with the fingerprint of the body that was read, also as an event", async () => {
    const { events, review, letters, body } = await setup();
    await review();
    const ls = await letters();
    expect(byPass(ls)).toEqual(FAKE_LETTERS);
    const hash = createHash("sha256")
      .update(await body())
      .digest("hex");
    expect(new Set(ls.map((l) => l.bodyHash))).toEqual(new Set([hash]));
    expect(events.filter((e) => e.type === "review.letter")).toHaveLength(4);
  });

  it("from the cache the same letter comes back, without calling the model", async () => {
    const { review, letters } = await setup();
    await review({ types: ["prose"] });
    const first = await letters();
    await review({ types: ["prose"] });
    expect(fake!.chatRequests()).toHaveLength(1);
    expect(byPass(await letters())).toEqual(byPass(first));
  });

  it("a check on a selection neither asks for nor changes the letter", async () => {
    const { review, letters, body } = await setup();
    const text = await body();
    const sel = "Per lavori più complessi si può integrare modelli cloud.";
    const from = text.indexOf(sel);
    await review({ types: ["grammar"], selection: { from, to: from + sel.length, text: sel } });
    expect(await letters()).toEqual([]);
    const tools = (fake!.chatRequests()[0]!.body!.tools ?? []) as { function: { name: string } }[];
    expect(tools.map((t) => t.function.name)).toEqual(["annota"]);
  });

  it("a response without a letter does not break the pass", async () => {
    const { review, letters, s } = await setup(() =>
      replyWithTools([
        {
          name: "annota",
          args: { citazione: "si può integrare", correzione: "si possono integrare" },
        },
      ]),
    );
    await review({ types: ["grammar"] });
    expect(await letters()).toEqual([]);
    const judgments = (
      await s.inject({ method: "GET", url: `/api/drafts/${TURBO}/judgments` })
    ).json().judgments as { pass: string; status: string }[];
    expect(judgments.some((j) => j.pass === "grammar" && j.status === "open")).toBe(true);
  });

  it('"Clear suggestions" also removes the letters', async () => {
    const { review, letters, s } = await setup();
    await review({ types: ["structure"] });
    expect(await letters()).toHaveLength(1);
    await s.inject({ method: "DELETE", url: `/api/drafts/${encodeURIComponent(TURBO)}/judgments` });
    expect(await letters()).toEqual([]);
  });
});
