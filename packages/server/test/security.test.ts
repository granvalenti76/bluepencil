import { symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { cleanupAll, makeServer, TOKEN } from "./helpers.ts";

afterEach(cleanupAll);

describe("security", () => {
  test("with the right token and host the API answers", async () => {
    const s = await makeServer();
    const res = await s.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, boot: expect.any(String) });
  });

  test("missing or wrong token → 401", async () => {
    const s = await makeServer();
    const host = s.headers.host;
    const none = await s.app.inject({ method: "GET", url: "/api/drafts", headers: { host } });
    expect(none.statusCode).toBe(401);
    const wrong = await s.app.inject({
      method: "GET",
      url: "/api/drafts",
      headers: { host, "x-desk-token": TOKEN + "x" },
    });
    expect(wrong.statusCode).toBe(401);
    const short = await s.app.inject({
      method: "GET",
      url: "/api/drafts",
      headers: { host, "x-desk-token": "t" },
    });
    expect(short.statusCode).toBe(401);
  });

  test("the token in the query parameter is only valid for /api/events", async () => {
    const s = await makeServer();
    const res = await s.app.inject({
      method: "GET",
      url: `/api/drafts?t=${TOKEN}`,
      headers: { host: s.headers.host },
    });
    expect(res.statusCode).toBe(401);
  });

  test("foreign Host → 403, even with the right token (DNS rebinding)", async () => {
    const s = await makeServer();
    for (const host of ["evil.example.com", "127.0.0.1:9999", "127.0.0.1", "evil.localhost:4317"]) {
      const res = await s.inject({ method: "GET", url: "/api/drafts", headers: { host } });
      expect(res.statusCode, host).toBe(403);
    }
  });

  test("Host localhost:<port> is allowed", async () => {
    const s = await makeServer();
    const res = await s.inject({
      method: "GET",
      url: "/api/health",
      headers: { host: "localhost:4317" },
    });
    expect(res.statusCode).toBe(200);
  });

  test("Origin present and different → 403; same → ok", async () => {
    const s = await makeServer();
    const bad = await s.inject({
      method: "GET",
      url: "/api/health",
      headers: { origin: "https://evil.example.com" },
    });
    expect(bad.statusCode).toBe(403);
    const good = await s.inject({
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://127.0.0.1:4317" },
    });
    expect(good.statusCode).toBe(200);
  });

  test("the static part checks the Host too", async () => {
    const s = await makeServer();
    const res = await s.app.inject({
      method: "GET",
      url: "/",
      headers: { host: "evil.example.com" },
    });
    expect(res.statusCode).toBe(403);
  });

  test("no CORS", async () => {
    const s = await makeServer();
    const res = await s.inject({
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://127.0.0.1:4317" },
    });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    const pre = await s.app.inject({
      method: "OPTIONS",
      url: "/api/drafts",
      headers: { host: s.headers.host, origin: "https://evil.example.com" },
    });
    expect(pre.statusCode).toBe(403);
  });
});

describe("paths confined to the drafts folder", () => {
  test.each([
    ["..%2F..%2Fetc%2Fpasswd", "traversal con .."],
    ["%2Fetc%2Fpasswd", "assoluto"],
    ["..%2Fsegreto.md", "esce di una cartella"],
    ["sub%2F..%2F..%2Fx.md", "traversal in mezzo"],
    ["%2E%2E%2Fx.md", ".. codificato"],
    [".bluepencil%2Findex.sqlite", "cartella dell'indice"],
    ["turbocode-draft-12-settembre.txt", "estensione non md"],
    ["a%00.md", "byte nullo"],
  ])("GET %s → 400 (%s)", async (path) => {
    const s = await makeServer();
    const res = await s.inject({ method: "GET", url: `/api/drafts/${path}` });
    expect(res.statusCode).toBe(400);
  });

  test("PUT outside the folder → 400 and no file written", async () => {
    const s = await makeServer();
    const res = await s.inject({
      method: "PUT",
      url: "/api/drafts/..%2Fescape.md",
      payload: { body: "x", baseHash: "h" },
    });
    expect(res.statusCode).toBe(400);
  });

  test("a symbolic link leading out of the folder is rejected", async () => {
    const s = await makeServer();
    const outside = join(s.dir, "..", "desk-outside-secret.md");
    await writeFile(outside, "segreto");
    await symlink(outside, join(s.dir, "link.md"));
    const res = await s.inject({ method: "GET", url: "/api/drafts/link.md" });
    expect(res.statusCode).toBe(400);
    const put = await s.inject({
      method: "PUT",
      url: "/api/drafts/link.md",
      payload: { body: "x", baseHash: "h" },
    });
    expect(put.statusCode).toBe(400);
  });

  test("a missing file → 404", async () => {
    const s = await makeServer();
    const res = await s.inject({ method: "GET", url: "/api/drafts/non-esiste.md" });
    expect(res.statusCode).toBe(404);
  });
});
