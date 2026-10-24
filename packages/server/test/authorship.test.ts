import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupAll, makeServer } from "./helpers.ts";

const TURBO = "turbocode-draft-12-settembre.md";
afterEach(cleanupAll);

describe("authorship", () => {
  it("accepted stretches are saved next to the drafts, not in the index", async () => {
    const s = await makeServer();
    const url = `/api/authorship/${TURBO}`;
    expect((await s.inject({ method: "GET", url })).json()).toEqual({ spans: [] });
    const span = {
      quote: "si possono integrare",
      prefix: "complessi ",
      suffix: " modelli",
      from: 10,
      words: 3,
      source: "grammar",
    };
    const put = await s.inject({ method: "PUT", url, payload: { spans: [span] } });
    expect(put.statusCode).toBe(200);
    expect(existsSync(join(s.dir, ".bluepencil", "authorship", `${TURBO}.json`))).toBe(true);
    expect((await s.inject({ method: "GET", url })).json()).toEqual({ spans: [span] });
  });

  it("outside the folder or with bad data: no", async () => {
    const s = await makeServer();
    const bad = await s.inject({ method: "GET", url: "/api/authorship/../segreto.md" });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
    const wrong = await s.inject({
      method: "PUT",
      url: `/api/authorship/${TURBO}`,
      payload: { spans: [{ quote: "" }] },
    });
    expect(wrong.statusCode).toBe(400);
  });
});
