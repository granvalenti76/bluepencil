import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildMessages, ModelClient, renderDraftContext, type Judgment } from "@desk/core";
import { loadDraftContext } from "../src/review/draft-context.ts";
import { replyWith, startFakeLlm, type FakeLlm } from "./fake-llm.ts";
import { cleanupAll, makeServer } from "./helpers.ts";

const TURBO = "turbocode-draft-12-settembre.md";
let fake: FakeLlm | undefined;
afterEach(async () => {
  await fake?.close();
  fake = undefined;
  await cleanupAll();
});

function ignored(id: string, quote: string, updatedOrder: number): Judgment {
  return {
    id,
    draftPath: TURBO,
    pass: "prose",
    kind: "adverb",
    quote,
    title: "Avverbio",
    rationale: "",
    proposal: { action: "delete", label: "Elimina" },
    range: { from: 0, to: quote.length },
    anchor: { quote, prefix: "", suffix: "" },
    status: "ignored",
    chunkHash: "h",
    model: "m",
    promptVersion: "p",
    createdAt: new Date(2026, 0, updatedOrder).toISOString(),
  };
}

describe("session context", () => {
  it("it is identical byte for byte between two calls for the same draft", async () => {
    const s = await makeServer();
    await mkdir(join(s.dir, ".bluepencil"), { recursive: true });
    await writeFile(
      join(s.dir, ".bluepencil", "style.md"),
      "# Stile\n- Niente punti esclamativi.\n\nVirgolette basse «».\n",
    );
    s.judgments.insert(ignored("01A", "completamente", 1));
    s.judgments.insert(ignored("01B", "esattamente", 2));

    fake = await startFakeLlm({ chat: () => replyWith("[]") });
    const client = new ModelClient({ endpoint: { kind: "local", baseUrl: fake.url } });

    const first = await loadDraftContext(s.repo, s.judgments, s.dir, TURBO, s.languages);
    await client.chat({
      messages: buildMessages("grammar", first.ctx, { text: "Turbocode è un agent harness." }),
    });
    // Between the two calls the author writes in the body: the context does not change.
    await appendFile(join(s.dir, TURBO), "\nUna riga in più.\n");
    const second = await loadDraftContext(s.repo, s.judgments, s.dir, TURBO, s.languages);
    await client.chat({
      messages: buildMessages("facts", second.ctx, { text: "Un altro testo." }),
    });

    const [a, b] = fake.chatRequests().map((r) => r.body!.messages as { content: string }[]);
    expect(Buffer.from(a![0]!.content).equals(Buffer.from(b![0]!.content))).toBe(true);
    expect(a![0]!.content).toMatchSnapshot();
    // The dismissed notes most recent first, the shared style before the draft's.
    expect(a![0]!.content).toContain("- «esattamente»\n- «completamente»");
    expect(a![0]!.content).toContain(
      "- Niente punti esclamativi.\n- Virgolette basse «».\n- Frasi brevi, niente prima persona nel lead.",
    );
    // The draft's body does not go into the context.
    expect(a![0]!.content).not.toContain("Una riga in più");
    expect(a![0]!.content).not.toContain("Turbocode è un agent harness.");
  });

  it("same text, different analyses: the user message starts the same too", async () => {
    const s = await makeServer();
    const { ctx } = await loadDraftContext(s.repo, s.judgments, s.dir, TURBO, s.languages);
    const text = "Testo intero della bozza.";
    const all = [
      buildMessages("structure", ctx, { text }),
      buildMessages("facts", ctx, { text, sources: [{ ref: "fatti.md", text: "x" }] }),
      buildMessages("grammar", ctx, { text }),
      buildMessages("prose", ctx, { text }),
    ];
    const head = `Testo della bozza:\n<<<\n${text}\n>>>\n\nANALISI`;
    for (const m of all) {
      expect(m[0]).toEqual(all[0]![0]);
      expect(m[1]!.content.startsWith(head)).toBe(true);
    }
    // Structure is judged on the type of text, not on words and headings.
    expect(all[0]![1]!.content).toContain("Il testo è un «Articolo giornalistico»");
    expect(all[0]![1]!.content).toContain("Non contare le parole");
  });

  it("the context does not depend on the order things are read in", async () => {
    const s = await makeServer();
    const a = await loadDraftContext(s.repo, s.judgments, s.dir, TURBO, s.languages);
    const text = await readFile(join(s.dir, TURBO), "utf8");
    await writeFile(join(s.dir, TURBO), text); // same file rewritten
    const b = await loadDraftContext(s.repo, s.judgments, s.dir, TURBO, s.languages);
    expect(renderDraftContext(a.ctx)).toBe(renderDraftContext(b.ctx));
  });
});
