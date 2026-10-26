import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { patchFrontMatter } from "@desk/core";
import type { StyleSummary } from "../src/routes/styles.ts";
import { loadDraftContext } from "../src/review/draft-context.ts";
import { replyWith, startFakeLlm, type FakeLlm } from "./fake-llm.ts";
import { cleanupAll, makeServer } from "./helpers.ts";

let fake: FakeLlm | undefined;
afterEach(async () => {
  await fake?.close();
  fake = undefined;
  await cleanupAll();
});

const TURBO = "turbocode-draft-12-settembre.md";
const PIECE = "Alle sei il bar era aperto. Il furgone no. È arrivato alle sette e venti.";

describe("styles", () => {
  it("creates a style, lists it, counts the drafts that look at it, gives its traits to the review", async () => {
    const s = await makeServer();
    const created = await s.inject({
      method: "POST",
      url: "/api/styles",
      payload: { name: "Cronaca asciutta", lang: "it" },
    });
    expect(created.statusCode).toBe(201);
    const { path } = created.json() as { path: string };
    expect(path).toBe("Styles/cronaca-asciutta.md");

    const file = join(s.dir, path);
    const text = (await readFile(file, "utf8")).replace(
      "## Piece 1",
      `## Articolo, marzo\n\n${PIECE}`,
    );
    await writeFile(
      file,
      patchFrontMatter(text, { author: "vari", traits: [{ text: "Apre su un dettaglio." }] }),
    );
    const draft = join(s.dir, TURBO);
    await writeFile(draft, patchFrontMatter(await readFile(draft, "utf8"), { reference: path }));

    const list = (await s.inject({ method: "GET", url: "/api/styles" })).json() as {
      styles: StyleSummary[];
    };
    expect(list.styles).toEqual([
      expect.objectContaining({
        path,
        name: "Cronaca asciutta",
        author: "vari",
        lang: "it",
        pieces: 1,
        traits: 1,
        usedIn: 1,
      }),
    ]);

    const { ctx } = await loadDraftContext(s.repo, s.judgments, s.dir, TURBO, s.languages);
    expect(ctx.style).toContain("Apre su un dettaglio.");
  });

  it("the model puts the measured schema into words, one sentence per dimension", async () => {
    fake = await startFakeLlm({
      chat: () =>
        replyWith(
          JSON.stringify({
            sintesi: "Cronaca secca.",
            ritmo: "Frasi corte.",
            lessico: "",
            costruzione: "Poche virgole.",
            voce: "Terza persona.",
          }),
        ),
    });
    const s = await makeServer({ modelUrl: fake.url });
    const { path } = (
      await s.inject({ method: "POST", url: "/api/styles", payload: { name: "Cronaca" } })
    ).json() as { path: string };
    const empty = await s.inject({ method: "POST", url: "/api/styles/traits", payload: { path } });
    expect(empty.statusCode).toBe(409);

    const file = join(s.dir, path);
    await writeFile(file, (await readFile(file, "utf8")).replace("## Piece 1", `## A\n\n${PIECE}`));
    const traits = await s.inject({ method: "POST", url: "/api/styles/traits", payload: { path } });
    expect(traits.json()).toEqual({
      traits: [
        { text: "Cronaca secca.", dim: "summary" },
        { text: "Frasi corte.", dim: "rhythm" },
        { text: "Poche virgole.", dim: "construction" },
        { text: "Terza persona.", dim: "voice" },
      ],
    });
    // The model reads the numbers, not the pieces.
    const body = fake.chatRequests()[0]!.body! as { messages: { content: string }[] };
    expect(body.messages[1]!.content).toContain("Words per sentence:");
    expect(body.messages[1]!.content).not.toContain(PIECE);
  });

  it("a style made in one go: labels, pasted pieces, a piece added later, traits saved in the file", async () => {
    fake = await startFakeLlm({
      chat: () => replyWith(JSON.stringify({ sintesi: "Cronaca secca.", ritmo: "Frasi corte." })),
    });
    const s = await makeServer({ modelUrl: fake.url });
    const created = await s.inject({
      method: "POST",
      url: "/api/styles",
      payload: {
        name: "Cronaca",
        lang: "it",
        author: "vari",
        source: "giornali",
        tags: ["breve"],
        pieces: [{ title: "Articolo, marzo", text: PIECE }, { text: "  " }],
      },
    });
    expect(created.json()).toEqual({ path: "Styles/cronaca.md", pieces: 1 });
    const path = "Styles/cronaca.md";

    const added = await s.inject({
      method: "POST",
      url: "/api/styles/piece",
      payload: { path, title: "Da una bozza", text: PIECE },
    });
    expect(added.json()).toEqual({ path, pieces: 2 });

    const traits = await s.inject({
      method: "POST",
      url: "/api/styles/traits",
      payload: { path, save: true },
    });
    expect(traits.json().traits).toEqual([
      { text: "Cronaca secca.", dim: "summary" },
      { text: "Frasi corte.", dim: "rhythm" },
    ]);
    const file = await readFile(join(s.dir, path), "utf8");
    expect(file).toContain("text: Frasi corte.");
    expect(file).toContain("dim: rhythm");
    expect(file).toContain("## Da una bozza");

    const list = (await s.inject({ method: "GET", url: "/api/styles" })).json() as {
      styles: StyleSummary[];
    };
    expect(list.styles[0]).toMatchObject({
      author: "vari",
      tags: ["breve"],
      quote: "Alle sei il bar era aperto.",
      summary: "Cronaca secca.",
    });
  });

  it("only files in Styles/ are styles", async () => {
    const s = await makeServer();
    const res = await s.inject({
      method: "POST",
      url: "/api/styles/traits",
      payload: { path: TURBO },
    });
    expect(res.statusCode).toBe(400);
  });
});
