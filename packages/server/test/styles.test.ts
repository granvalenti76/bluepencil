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
  it("creates a style, lists it, counts the drafts that look at it, gives it to the review", async () => {
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
      patchFrontMatter(text, {
        author: "vari",
        traits: [{ text: "Apre su un dettaglio." }],
        procedures: [
          {
            name: "Orari esatti",
            text: "Il tempo si dice con l’orario.",
            passages: ["Il furgone no."],
          },
          { name: "Tono ironico", state: "off" },
        ],
      }),
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
        procedures: 1,
        quote: "Il furgone no.",
        usedIn: 1,
      }),
    ]);

    const { ctx } = await loadDraftContext(s.repo, s.judgments, s.dir, TURBO, s.languages);
    expect(ctx.style).toContain("Apre su un dettaglio.");
    expect(ctx.style).toContain("Orari esatti: Il tempo si dice con l’orario.");
    expect(ctx.style.join("\n")).not.toContain("ironico");
  });

  it("the model reads the pieces whole, numbered; a procedure keeps the sentences it found", async () => {
    fake = await startFakeLlm({
      chat: () =>
        replyWith(
          JSON.stringify({
            sintesi: "Cronaca secca.",
            procedimenti: [
              { parte: "tempo", nome: "Orari esatti", descrizione: "Con l’orario.", passi: [1, 3] },
              { parte: "attacco", nome: "Inventato", passi: [40] },
            ],
          }),
        ),
    });
    const s = await makeServer({ modelUrl: fake.url });
    const { path } = (
      await s.inject({ method: "POST", url: "/api/styles", payload: { name: "Cronaca" } })
    ).json() as { path: string };
    const empty = await s.inject({
      method: "POST",
      url: "/api/styles/procedures",
      payload: { path },
    });
    expect(empty.statusCode).toBe(409);

    const file = join(s.dir, path);
    await writeFile(file, (await readFile(file, "utf8")).replace("## Piece 1", `## A\n\n${PIECE}`));
    const read = await s.inject({
      method: "POST",
      url: "/api/styles/procedures",
      payload: { path },
    });
    expect(read.json()).toEqual({
      summary: "Cronaca secca.",
      procedures: [
        {
          name: "Orari esatti",
          part: "time",
          text: "Con l’orario.",
          passages: ["Alle sei il bar era aperto.", "È arrivato alle sette e venti."],
        },
      ],
    });
    // The model reads the pieces, every sentence with its number.
    const body = fake.chatRequests()[0]!.body! as { messages: { content: string }[] };
    expect(body.messages[1]!.content).toContain(
      "¶1 [1] Alle sei il bar era aperto. [2] Il furgone no. [3] È arrivato alle sette e venti.",
    );
  });

  it("a style made in one go: labels, pasted pieces, a piece added later, its reading saved in the file", async () => {
    fake = await startFakeLlm({
      chat: () =>
        replyWith(
          JSON.stringify({
            sintesi: "Cronaca secca.",
            procedimenti: [{ parte: "frase", nome: "Frasi corte", passi: [2] }],
          }),
        ),
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

    const read = await s.inject({
      method: "POST",
      url: "/api/styles/procedures",
      payload: { path, save: true },
    });
    expect(read.json().procedures).toEqual([
      { name: "Frasi corte", part: "sentence", passages: ["Il furgone no."] },
    ]);
    const file = await readFile(join(s.dir, path), "utf8");
    expect(file).toContain("text: Cronaca secca.");
    expect(file).toContain("dim: summary");
    expect(file).toContain("name: Frasi corte");
    expect(file).toContain("part: sentence");
    expect(file).toContain("## Da una bozza");

    const list = (await s.inject({ method: "GET", url: "/api/styles" })).json() as {
      styles: StyleSummary[];
    };
    expect(list.styles[0]).toMatchObject({
      author: "vari",
      tags: ["breve"],
      procedures: 1,
      quote: "Il furgone no.",
      summary: "Cronaca secca.",
    });
  });

  it("the editor reads the draft by paragraph beside the procedures, never the pieces", async () => {
    fake = await startFakeLlm({
      chat: () =>
        replyWith(
          JSON.stringify({
            sintesi: "Somiglia nel finale.",
            paragrafi: [{ numero: 1, funzione: "attacco" }],
            spunti: [{ procedimento: 1, paragrafo: 1, esito: "diverso", nota: "Qui." }],
          }),
        ),
    });
    const s = await makeServer({ modelUrl: fake.url });
    const { path } = (
      await s.inject({
        method: "POST",
        url: "/api/styles",
        payload: { name: "Cronaca", lang: "it", pieces: [{ text: PIECE }] },
      })
    ).json() as { path: string };
    const draft = "Una frase che dura e dura senza mai finire davvero.\n\nPoi un’altra.";
    const ask = () =>
      s.inject({ method: "POST", url: "/api/styles/reading", payload: { style: path, draft } });
    // Not read yet: nothing to read the draft beside.
    expect((await ask()).statusCode).toBe(409);

    const file = join(s.dir, path);
    await writeFile(
      file,
      patchFrontMatter(await readFile(file, "utf8"), {
        procedures: [
          { name: "Orari esatti", part: "time", passages: ["Il furgone no."] },
          { name: "Tono ironico", state: "off" },
        ],
      }),
    );
    const res = await ask();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      summary: "Somiglia nel finale.",
      functions: ["attacco", ""],
      cues: [
        {
          id: "orari esatti:1",
          procedure: { name: "Orari esatti", part: "time" },
          paragraph: 1,
          outcome: "differs",
          note: "Qui.",
          words: [],
        },
      ],
    });
    const body = fake.chatRequests()[0]!.body! as { messages: { content: string }[] };
    expect(body.messages[1]!.content).toContain("1. [time] Orari esatti");
    expect(body.messages[1]!.content).not.toContain("Tono ironico");
    expect(body.messages[1]!.content).toContain("¶2 <<<Poi un’altra.>>>");
    expect(body.messages[1]!.content).not.toContain(PIECE);
  });

  it("only files in Styles/ are styles", async () => {
    const s = await makeServer();
    const res = await s.inject({
      method: "POST",
      url: "/api/styles/procedures",
      payload: { path: TURBO },
    });
    expect(res.statusCode).toBe(400);
  });
});
