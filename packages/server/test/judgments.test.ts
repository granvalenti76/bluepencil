import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { parseDraft } from "@desk/core";
import { cleanupAll, makeServer, SEED_FILE, tempDrafts, TOKEN } from "./helpers.ts";

afterEach(cleanupAll);

const TURBO = "turbocode-draft-12-settembre.md";
const list = async (s: Awaited<ReturnType<typeof makeServer>>, path = TURBO) =>
  (
    await s.inject({ method: "GET", url: `/api/drafts/${encodeURIComponent(path)}/judgments` })
  ).json().judgments as {
    id: string;
    kind: string;
    pass: string;
    status: string;
    quote: string;
    range: { from: number; to: number } | null;
    anchor: { quote: string };
    applied?: unknown;
    proposal: { action: string; text?: string };
    sectionId?: string;
  }[];
const byQuote = (js: Awaited<ReturnType<typeof list>>, q: string) => js.find((j) => j.quote === q)!;

async function bodyOf(s: Awaited<ReturnType<typeof makeServer>>) {
  return parseDraft(await readFile(join(s.dir, TURBO), "utf8")).body;
}

describe("judgments: fixture and reading", () => {
  test("without a fixture there is nothing and the seed route does not exist", async () => {
    const s = await makeServer();
    expect(await list(s)).toEqual([]);
    const res = await s.inject({
      method: "POST",
      url: "/api/dev/seed-judgments",
      payload: { path: TURBO },
    });
    expect(res.statusCode).toBe(404);
  });

  test("the sample fixture is resolved on the real text (body offsets)", async () => {
    const s = await makeServer({ seedFile: SEED_FILE });
    const js = await list(s);
    expect(js).toHaveLength(10);
    const body = await bodyOf(s);
    for (const j of js.filter((x) => x.range)) {
      expect(body.slice(j.range!.from, j.range!.to), j.quote).toBe(j.quote);
      expect(j.status).toBe("open");
    }
    expect(js.filter((j) => j.range === null)).toHaveLength(1);
    const closing = js.find((j) => j.range === null)!;
    expect(closing).toMatchObject({
      pass: "structure",
      sectionId: "closing",
      proposal: { action: "draft_section" },
    });
    expect(byQuote(js, "si può integrare")).toMatchObject({
      pass: "grammar",
      proposal: { action: "replace", text: "si possono integrare" },
    });
    expect(js.filter((j) => j.pass === "facts")).toHaveLength(5);
  });

  test("the seed does not duplicate on restart", async () => {
    const dir = await tempDrafts();
    await (await makeServer({ dir, seedFile: SEED_FILE })).close();
    const s = await makeServer({ dir, seedFile: SEED_FILE });
    expect(await list(s)).toHaveLength(10);
  });

  test("seed on request for another draft with the same text", async () => {
    const dir = await tempDrafts();
    const text = await readFile(join(dir, TURBO), "utf8");
    await writeFile(join(dir, "copia.md"), text);
    const s = await makeServer({ dir, seedFile: SEED_FILE });
    expect(await list(s, "copia.md")).toEqual([]);
    const res = await s.inject({
      method: "POST",
      url: "/api/dev/seed-judgments",
      payload: { path: "copia.md" },
    });
    expect(res.json()).toEqual({ draft: "copia.md", inserted: 10 });
    expect(await list(s, "copia.md")).toHaveLength(10);
  });

  test("invalid paths → 400", async () => {
    const s = await makeServer({ seedFile: SEED_FILE });
    const res = await s.inject({
      method: "GET",
      url: "/api/drafts/..%2F..%2Fetc%2Fpasswd/judgments",
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("PATCH /api/judgments/:id", () => {
  test("the state is saved and survives a new read", async () => {
    const s = await makeServer({ seedFile: SEED_FILE });
    const r2 = byQuote(
      await list(s),
      "con modelli linguistici locali, con opzione di fallback cloud",
    );
    const res = await s.inject({
      method: "PATCH",
      url: `/api/judgments/${r2.id}`,
      payload: { status: "ignored" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ignored");
    expect(byQuote(await list(s), r2.quote).status).toBe("ignored");
  });

  test("even after the server restarts", async () => {
    const dir = await tempDrafts();
    const s1 = await makeServer({ dir, seedFile: SEED_FILE });
    const g1 = byQuote(await list(s1), "si può integrare");
    await s1.inject({
      method: "PATCH",
      url: `/api/judgments/${g1.id}`,
      payload: { status: "ignored" },
    });
    await s1.close();
    const s2 = await makeServer({ dir, seedFile: SEED_FILE });
    expect(byQuote(await list(s2), "si può integrare").status).toBe("ignored");
  });

  test("stale: the note is no longer returned", async () => {
    const s = await makeServer({ seedFile: SEED_FILE });
    const r1 = byQuote(await list(s), "completamente");
    await s.inject({
      method: "PATCH",
      url: `/api/judgments/${r1.id}`,
      payload: { status: "stale" },
    });
    expect((await list(s)).map((j) => j.quote)).not.toContain("completamente");
  });

  test("invalid requests", async () => {
    const s = await makeServer({ seedFile: SEED_FILE });
    const j = (await list(s))[0]!;
    expect(
      (
        await s.inject({
          method: "PATCH",
          url: `/api/judgments/${j.id}`,
          payload: { status: "boh" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await s.inject({ method: "PATCH", url: `/api/judgments/${j.id}`, payload: {} })).statusCode,
    ).toBe(400);
    expect(
      (
        await s.inject({
          method: "PATCH",
          url: `/api/judgments/${j.id}`,
          payload: { status: "open", applied: { from: "x" } },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await s.inject({
          method: "PATCH",
          url: "/api/judgments/NONESISTE",
          payload: { status: "open" },
        })
      ).statusCode,
    ).toBe(404);
    const noToken = await s.app.inject({
      method: "PATCH",
      url: `/api/judgments/${j.id}`,
      headers: { host: s.headers.host },
      payload: { status: "open" },
    });
    expect(noToken.statusCode).toBe(401);
    void TOKEN;
  });
});

describe("anchor updated by the client", () => {
  test('a judgment whose text changed through "Apply" inside it stays valid after reloading', async () => {
    const s = await makeServer({ seedFile: SEED_FILE });
    const lead = (await list(s)).find((j) => j.sectionId === "lead" && j.pass === "structure")!;
    const d = (await s.inject({ method: "GET", url: `/api/drafts/${TURBO}` })).json();
    const body = d.body.replace(
      "con modelli linguistici locali, con opzione di fallback cloud",
      "su modelli linguistici locali, con fallback cloud opzionale",
    );
    await s.inject({
      method: "PUT",
      url: `/api/drafts/${TURBO}`,
      payload: { body, baseHash: d.contentHash },
    });

    // without re-anchoring, the lead's quote can no longer be found
    expect((await list(s)).map((j) => j.id)).not.toContain(lead.id);
  });

  test("with the new anchor the judgment is found again", async () => {
    const s = await makeServer({ seedFile: SEED_FILE });
    const lead = (await list(s)).find((j) => j.sectionId === "lead" && j.pass === "structure")!;
    const d = (await s.inject({ method: "GET", url: `/api/drafts/${TURBO}` })).json();
    const body = d.body.replace(
      "con modelli linguistici locali, con opzione di fallback cloud",
      "su modelli linguistici locali, con fallback cloud opzionale",
    );
    const from = body.indexOf("Turbocode è un agent");
    const quote = body.slice(
      from,
      body.indexOf("cloud opzionale.", from) + "cloud opzionale.".length,
    );
    await s.inject({
      method: "PUT",
      url: `/api/drafts/${TURBO}`,
      payload: { body, baseHash: d.contentHash },
    });
    const res = await s.inject({
      method: "PATCH",
      url: `/api/judgments/${lead.id}`,
      payload: {
        status: "open",
        range: { from, to: from + quote.length },
        anchor: {
          quote,
          prefix: body.slice(Math.max(0, from - 32), from),
          suffix: body.slice(from + quote.length, from + quote.length + 32),
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const after = (await list(s)).find((j) => j.id === lead.id)!;
    expect(after.status).toBe("open");
    expect(body.slice(after.range!.from, after.range!.to)).toBe(quote);
  });
});

describe("positions after changes to the text", () => {
  async function save(s: Awaited<ReturnType<typeof makeServer>>, edit: (body: string) => string) {
    const d = (await s.inject({ method: "GET", url: `/api/drafts/${TURBO}` })).json();
    const res = await s.inject({
      method: "PUT",
      url: `/api/drafts/${TURBO}`,
      payload: { body: edit(d.body), baseHash: d.contentHash },
    });
    expect(res.statusCode).toBe(200);
    return edit(d.body);
  }

  test("an insertion before shifts the positions and the quotes stay right", async () => {
    const s = await makeServer({ seedFile: SEED_FILE });
    const before = await list(s);
    const body = await save(s, (b) =>
      b.replace("# Turbocode V0.6\n", "# Turbocode V0.6\n\nUn sottotitolo aggiunto dopo.\n"),
    );
    const after = await list(s);
    expect(after).toHaveLength(10);
    for (const j of after.filter((x) => x.range))
      expect(body.slice(j.range!.from, j.range!.to)).toBe(j.quote);
    const g1b = byQuote(before, "si può integrare").range!.from;
    expect(byQuote(after, "si può integrare").range!.from).toBe(
      g1b + "\nUn sottotitolo aggiunto dopo.\n".length,
    );
  });

  test("if the quote disappears or changes, the judgment becomes stale (and stays so)", async () => {
    const s = await makeServer({ seedFile: SEED_FILE });
    await save(s, (b) =>
      b.replace("completamente ", "").replace("si può integrare", "si può integrar"),
    );
    const after = (await list(s)).map((j) => j.quote);
    expect(after).not.toContain("completamente");
    expect(after).not.toContain("si può integrare");
    expect(after).toContain("per macOS");
    await save(s, (b) => b.replace("si può integrar", "si può integrare"));
    expect((await list(s)).map((j) => j.quote)).not.toContain("si può integrare");
  });

  test("applied: found where the replacement is, even after other changes", async () => {
    const s = await makeServer({ seedFile: SEED_FILE });
    const g1 = byQuote(await list(s), "si può integrare");
    const old = await bodyOf(s);
    const edited = await save(s, (b) => b.replace("si può integrare", "si possono integrare"));
    const from = edited.indexOf("si possono integrare");
    const applied = {
      from,
      to: from + "si possono integrare".length,
      original: "si può integrare",
      replacement: "si possono integrare",
      before: edited.slice(from - 32, from),
      after: edited.slice(from + 20, from + 52),
    };
    const patch = await s.inject({
      method: "PATCH",
      url: `/api/judgments/${g1.id}`,
      payload: { status: "applied", applied, range: { from, to: applied.to } },
    });
    expect(patch.statusCode).toBe(200);

    await save(s, (b) => "Un'altra riga all'inizio.\n\n" + b);
    const j = byQuote(await list(s), "si può integrare");
    expect(j.status).toBe("applied");
    const nowBody = await bodyOf(s);
    expect(nowBody.slice(j.range!.from, j.range!.to)).toBe("si possono integrare");
    expect(old).not.toBe(nowBody);
  });

  test("applied but never saved to disk: back to open", async () => {
    const s = await makeServer({ seedFile: SEED_FILE });
    const g1 = byQuote(await list(s), "si può integrare");
    const body = await bodyOf(s);
    const from = body.indexOf("si può integrare");
    const applied = {
      from,
      to: from + 20,
      original: "si può integrare",
      replacement: "si possono integrare",
      before: body.slice(from - 32, from),
      after: body.slice(from + 16, from + 48),
    };
    await s.inject({
      method: "PATCH",
      url: `/api/judgments/${g1.id}`,
      payload: { status: "applied", applied },
    });

    const j = byQuote(await list(s), "si può integrare");
    expect(j.status).toBe("open");
    expect(j.applied).toBeUndefined();
    expect(j.range).toEqual({ from, to: from + 16 });
  });

  test("applied and then the text was changed by hand: stays applied, without losing it", async () => {
    const s = await makeServer({ seedFile: SEED_FILE });
    const g1 = byQuote(await list(s), "si può integrare");
    const edited = await save(s, (b) => b.replace("si può integrare", "si possono integrare"));
    const from = edited.indexOf("si possono integrare");
    const applied = {
      from,
      to: from + 20,
      original: "si può integrare",
      replacement: "si possono integrare",
      before: edited.slice(from - 32, from),
      after: edited.slice(from + 20, from + 52),
    };
    await s.inject({
      method: "PATCH",
      url: `/api/judgments/${g1.id}`,
      payload: { status: "applied", applied },
    });
    await save(s, (b) => b.replace("si possono integrare", "si devono integrare"));
    const j = byQuote(await list(s), "si può integrare");
    expect(j.status).toBe("applied");
  });
});
