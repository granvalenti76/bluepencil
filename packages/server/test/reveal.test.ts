import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupAll, makeServer } from "./helpers.ts";

afterEach(cleanupAll);

describe('"Show in Finder"', () => {
  it("a draft (selected in the Finder) or the folder; never outside the folder", async () => {
    const calls: [string, boolean][] = [];
    const s = await makeServer({ opener: async (abs, isFile) => void calls.push([abs, isFile]) });
    const root = await realpath(s.dir);

    const one = await s.inject({
      method: "POST",
      url: "/api/reveal",
      payload: { path: "turbocode-draft-12-settembre.md" },
    });
    expect(one.statusCode).toBe(204);
    expect(calls.at(-1)).toEqual([join(root, "turbocode-draft-12-settembre.md"), true]);

    expect((await s.inject({ method: "POST", url: "/api/reveal", payload: {} })).statusCode).toBe(
      204,
    );
    expect(calls.at(-1)).toEqual([root, false]);
    expect((await s.inject({ method: "GET", url: "/api/folder" })).json()).toEqual({ path: root });

    for (const path of ["../fuori.md", "/etc/passwd", ".bluepencil/x.md", "non-esiste.md"]) {
      const res = await s.inject({ method: "POST", url: "/api/reveal", payload: { path } });
      expect(res.statusCode, path).toBeGreaterThanOrEqual(400);
    }
    expect(calls).toHaveLength(2);
  });

  it("without a token it opens nothing", async () => {
    const calls: string[] = [];
    const s = await makeServer({ opener: async (abs) => void calls.push(abs) });
    const res = await s.inject({
      method: "POST",
      url: "/api/reveal",
      payload: {},
      headers: { "x-desk-token": "sbagliato" },
    });
    expect(res.statusCode).toBe(401);
    expect(calls).toHaveLength(0);
  });
});
