import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { patchFrontMatter } from "@desk/core";
import { afterEach, describe, expect, it } from "vitest";
import { replyWith, startFakeLlm, type FakeLlm } from "./fake-llm.ts";
import { cleanupAll, makeServer } from "./helpers.ts";

/** The built-in English pack. */
const EN_DRAFT = "writing-with-a-local-model.md";

let fake: FakeLlm | undefined;
afterEach(async () => {
  await fake?.close();
  fake = undefined;
  await cleanupAll();
});

type Msg = { role: string; content: string };
const messagesOf = (r: { body?: Record<string, unknown> | null }) => r.body!.messages as Msg[];

async function setup() {
  fake = await startFakeLlm({ chat: () => replyWith("[]") });
  const s = await makeServer({ modelUrl: fake.url });
  const review = async (path: string, payload: object = {}) => {
    const res = await s.inject({ method: "POST", url: `/api/review/${path}`, payload });
    expect(res.statusCode).toBe(202);
    await s.runner.wait(res.json().runId);
  };
  return { s, review };
}

describe("English draft", () => {
  it("the review sends the English prompts, with the draft's sources", async () => {
    const { review } = await setup();
    await review(EN_DRAFT);
    const calls = fake!.chatRequests();
    expect(calls).toHaveLength(4);
    const [system, user] = messagesOf(calls[0]!);
    expect(system!.content).toMatch(/^You are an editorial reviewer\./);
    expect(system!.content).toContain(
      "# Draft\nTitle: Writing with a local model\nType of text: Blog post",
    );
    expect(user!.content).toMatch(/^Text of the draft:\n<<<\n/);
    expect(user!.content).toContain("STRUCTURE REVIEW.\nThe text is a “Blog post”.");
    const facts = messagesOf(calls[1]!)[1]!.content;
    expect(facts).toContain('<source ref="local-models-facts.md">');
    expect(facts).toContain("uses about 20 GB");
    const tools = calls[2]!.body!.tools as { function: { name: string; description: string } }[];
    expect(tools[0]!.function).toMatchObject({
      name: "annota",
      description: "Note a point of the draft. One call for each note.",
    });
  });

  it("cache per language: the same draft in another language is checked again", async () => {
    const { s, review } = await setup();
    await review(EN_DRAFT, { types: ["grammar"] });
    await review(EN_DRAFT, { types: ["grammar"] });
    expect(fake!.chatRequests()).toHaveLength(1); // second time: from the cache
    const file = join(s.dir, EN_DRAFT);
    await writeFile(file, patchFrontMatter(await readFile(file, "utf8"), { lang: "it" }));
    await review(EN_DRAFT, { types: ["grammar"] });
    expect(fake!.chatRequests()).toHaveLength(2);
    expect(messagesOf(fake!.chatRequests()[1]!)[0]!.content).toMatch(/^Sei un revisore/);
  });

  it("structure proposed with `lang: en`: English prompt and archetype", async () => {
    fake = await startFakeLlm({
      chat: () =>
        replyWith('{"sections":[{"title":"Opening","target":700,"guidance":"x"}],"checks":[]}'),
    });
    const s = await makeServer({ modelUrl: fake.url });
    await s.inject({
      method: "POST",
      url: "/api/structure/propose",
      payload: { archetype: "blog", topic: "", target: 700, lang: "en" },
    });
    const [system, user] = messagesOf(fake.chatRequests()[0]!);
    expect(system!.content).toMatch(/^You are the managing editor/);
    expect(user!.content).toContain("Type of text: Blog post\nTypical sections: Opening (15%");
    expect(user!.content).toContain("What it is about:\n(not given)");
  });

  it("fallback file name in the draft's language; `/api/languages` has English", async () => {
    const s = await makeServer();
    const post = (payload: object) => s.inject({ method: "POST", url: "/api/drafts", payload });
    expect((await post({ title: "Ελληνικά", lang: "en" })).json().path).toBe("draft.md");
    expect((await post({ title: "Ελληνικά" })).json().path).toBe("bozza.md");
    const packs = (await s.inject({ method: "GET", url: "/api/languages" })).json().packs;
    expect(packs.map((p: { code: string }) => p.code).sort()).toEqual(["en", "it"]);
  });
});
