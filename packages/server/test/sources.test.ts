import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Judgment } from "@desk/core";
import type { DeskEvent } from "../src/events.ts";
import { startFakeLlm, type FakeLlm } from "./fake-llm.ts";
import { scriptedChat, sourcesOf } from "./fake-llm-script.ts";
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
  const review = async () => {
    const res = await s.inject({
      method: "POST",
      url: `/api/review/${TURBO}`,
      payload: { types: ["facts"] },
    });
    const { runId } = res.json() as { runId: string };
    const from = events.length;
    await s.runner.wait(runId);
    return events.slice(from).filter((e) => "runId" in e && e.runId === runId);
  };
  const open = async () =>
    (
      (await s.inject({ method: "GET", url: `/api/drafts/${TURBO}/judgments` })).json() as {
        judgments: Judgment[];
      }
    ).judgments.filter((j) => j.pass === "facts");
  /** Changes a file outside the app and updates the index (in tests the watcher is off). */
  const edit = async (name: string, fn: (t: string) => string) => {
    const file = join(s.dir, name);
    await writeFile(file, fn(await readFile(file, "utf8")));
    await s.index.scan(s.repo);
  };
  const factCalls = () =>
    fake!
      .chatRequests()
      .map((c) => (c.body!.messages as { content: string }[])[1]!.content)
      .filter((u) => u.includes("\nANALISI DEI FATTI."));
  return { s, review, open, edit, factCalls };
}

const byQuote = (js: Judgment[], q: string) => js.find((j) => j.anchor.quote === q);

describe("sources", () => {
  it("the facts pass receives the passages of fatti.md chosen by full-text search", async () => {
    const { review, factCalls } = await setup();
    await review();
    const [call] = factCalls();
    const src = sourcesOf(call!);
    expect(src.map((x) => x.ref)).toEqual(["fatti.md"]);
    expect(src[0]!.text).toContain("100–150 MB di RAM");
    expect(src[0]!.text).toContain("Qwen3.6-35B-A3B");
    // Only the relevant passages, not the whole file (the heading is not a passage).
    expect(src[0]!.text).not.toContain("# Fatti");
  });

  it("«100–150 MB di RAM» in fatti.md → verified; «Qwen3.6-35B-3B» → to check", async () => {
    const { review, open } = await setup();
    await review();
    const js = await open();
    expect(byQuote(js, "tra i 100 e i 150 MB di RAM")).toMatchObject({ factStatus: "verified" });
    const qwen = byQuote(js, "Qwen3.6-35B-3B")!;
    expect(qwen).toMatchObject({ factStatus: "to_check", proposal: { action: "compare_sources" } });
    expect(qwen.rationale).toContain("Qwen3.6-35B-A3B");
  });

  it("without fatti.md among the sources the same figure stays unsourced", async () => {
    const { review, open, edit } = await setup();
    await edit(TURBO, (t) => t.replace("  - fatti.md\n", ""));
    await review();
    expect(byQuote(await open(), "tra i 100 e i 150 MB di RAM")).toMatchObject({
      factStatus: "unsourced",
      proposal: { action: "add_source" },
    });
  });

  it('after "Add source" ([^1] + definition) the claim is no longer unsourced', async () => {
    const { review, open, edit, factCalls } = await setup();
    await review();
    const quote = "non garantiscono un loop autonomo completo";
    expect(byQuote(await open(), quote)).toMatchObject({ factStatus: "unsourced", status: "open" });

    await edit(TURBO, (t) => t.replace(quote, `${quote}[^1]`).trimEnd() + "\n\n[^1]: fatti.md\n");
    const before = factCalls().length;
    const events = await review();
    // The pass is checked again on the whole text, with the footnote in the prompt.
    const calls = factCalls().slice(before);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("Note a piè di pagina del testo:\n[^1]: fatti.md");
    expect(byQuote(await open(), quote)).toBeUndefined();
    const removed = events.flatMap((e) => (e.type === "judgment.created" ? e.removed : []));
    expect(removed.length).toBeGreaterThan(0);
  });

  it("changing the source file checks the facts pass again", async () => {
    const { review, edit, factCalls } = await setup();
    await review();
    const before = factCalls().length;
    await review();
    expect(factCalls().length).toBe(before); // cache
    await edit("fatti.md", (t) => t.replace("Qwen3.6-35B-A3B", "Qwen3.6-35B-3B"));
    await review();
    expect(factCalls().length).toBeGreaterThan(before);
  });

  it("GET /api/sources: the draft's sources with a preview, and other files", async () => {
    const { s } = await setup();
    await writeFile(join(s.dir, "appunti.md"), "Appunti sparsi su Swift.\n");
    await s.index.scan(s.repo);
    const r = (await s.inject({ method: "GET", url: `/api/sources/${TURBO}` })).json();
    expect(r.sources).toEqual([
      expect.objectContaining({ ref: "fatti.md", kind: "file", exists: true }),
      { ref: "https://github.com/turbocode", kind: "url" },
    ]);
    expect(r.sources[0].preview).toContain("Fatti di riferimento");
    // Sources first (cited by another file), then the other files: citing one makes it a source.
    expect(r.files.slice(0, 2)).toEqual([
      {
        path: "local-models-facts.md",
        title: "Reference facts for local models",
        ref: "local-models-facts.md",
        isSource: true,
      },
      { path: "appunti.md", title: "appunti", ref: "appunti.md", isSource: false },
    ]);
    expect(r.files.map((f: { path: string }) => f.path)).not.toContain(TURBO);
  });

  it('"Compare sources": passages with similar terms, terms highlighted', async () => {
    const { s, review, open } = await setup();
    await review();
    const qwen = byQuote(await open(), "Qwen3.6-35B-3B")!;
    const r = (
      await s.inject({ method: "GET", url: `/api/compare?path=${TURBO}&judgmentId=${qwen.id}` })
    ).json();
    expect(r.query).toBe("Qwen3.6-35B-3B");
    expect(r.passages[0]).toMatchObject({ ref: "fatti.md", path: "fatti.md" });
    expect(r.passages[0].text).toContain("Qwen3.6-35B-A3B");
    expect(r.passages[0].marked).toContain("\u0001Qwen3\u0002");
  });

  it("full-text search over drafts and sources, with prefix and without accents", async () => {
    const { s } = await setup();
    const q = async (t: string) =>
      (await s.inject({ method: "GET", url: `/api/search?q=${encodeURIComponent(t)}` })).json()
        .results as { path: string; isDraft: boolean; snippet: string }[];
    const res = await q("quantizz");
    expect(res.map((r) => r.path)).toEqual(expect.arrayContaining(["fatti.md"]));
    expect(res.find((r) => r.path === "fatti.md")!.isDraft).toBe(false);
    expect((await q("perche"))[0]).toBeDefined();
    const turbo = (await q("harness")).find((r) => r.path === TURBO)!;
    expect(turbo).toMatchObject({ isDraft: true });
    expect(turbo.snippet).toContain("\u0001harness\u0002");
    expect(await q("   ")).toEqual([]);
    expect(await q('"(')).toEqual([]);
  });
});
