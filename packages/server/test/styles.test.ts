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

  it("reads the traits and finds cues with the model", async () => {
    let calls = 0;
    fake = await startFakeLlm({
      chat: () =>
        replyWith(
          calls++ === 0
            ? JSON.stringify({
                tratti: [{ tratto: "Frasi corte che smentiscono.", esempio: "Il furgone no." }],
              })
            : JSON.stringify({
                spunti: [
                  {
                    citazione: "partecipazione numerosa",
                    spunto: "Lo stile apre su una cosa vista.",
                    esempio: "Alle sei il bar era aperto.",
                  },
                ],
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
      traits: [{ text: "Frasi corte che smentiscono.", quote: "Il furgone no." }],
    });

    const tips = await s.inject({
      method: "POST",
      url: "/api/styles/tips",
      payload: { style: path, draft: "Una partecipazione numerosa." },
    });
    expect(tips.json()).toEqual({
      checks: [],
      tips: [
        {
          quote: "partecipazione numerosa",
          tip: "Lo stile apre su una cosa vista.",
          example: "Alle sei il bar era aperto.",
        },
      ],
    });
    // The style is in the system message, the draft in the user one.
    const body = fake.chatRequests()[1]!.body! as { messages: { content: string }[] };
    expect(body.messages[0]!.content).toContain(PIECE);
    expect(body.messages[1]!.content).toContain("Una partecipazione numerosa.");
  });

  it("a style made in one go: labels, pasted pieces, a piece added later, traits saved in the file", async () => {
    let call = 0;
    fake = await startFakeLlm({
      chat: () =>
        replyWith(
          call++ === 0
            ? JSON.stringify({ tratti: [{ tratto: "Frasi corte.", esempio: "Il furgone no." }] })
            : JSON.stringify({
                tratti: [
                  { numero: 1, seguito: "no", citazione: "una partecipazione numerosa" },
                  { numero: 9, seguito: true },
                ],
                spunti: [],
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

    const traits = await s.inject({
      method: "POST",
      url: "/api/styles/traits",
      payload: { path, save: true },
    });
    expect(traits.json().traits).toEqual([{ text: "Frasi corte.", quote: "Il furgone no." }]);
    const file = await readFile(join(s.dir, path), "utf8");
    expect(file).toContain("text: Frasi corte.");
    expect(file).toContain("## Da una bozza");

    const list = (await s.inject({ method: "GET", url: "/api/styles" })).json() as {
      styles: StyleSummary[];
    };
    expect(list.styles[0]).toMatchObject({
      author: "vari",
      tags: ["breve"],
      quote: "Il furgone no.",
    });

    const tips = await s.inject({
      method: "POST",
      url: "/api/styles/tips",
      payload: { style: path, draft: "Una partecipazione numerosa." },
    });
    // Trait 9 does not exist: not checked.
    expect(tips.json()).toEqual({
      tips: [],
      checks: [{ text: "Frasi corte.", followed: false, quote: "una partecipazione numerosa" }],
    });
  });

  it("only files in Styles/ are styles", async () => {
    const s = await makeServer();
    const res = await s.inject({
      method: "POST",
      url: "/api/styles/tips",
      payload: { style: TURBO, draft: "x" },
    });
    expect(res.statusCode).toBe(400);
  });
});
