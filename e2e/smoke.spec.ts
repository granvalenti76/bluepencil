import { expect, test } from "@playwright/test";
import { E2E_TOKEN } from "./env.ts";

test("the page opens and the proxy reaches the server", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Bluepencil" })).toBeVisible();

  const res = await request.get("/api/health", { headers: { "x-desk-token": E2E_TOKEN } });
  expect(await res.json()).toEqual({ ok: true, boot: expect.any(String) });
});

test("without a token the API does not answer", async ({ request }) => {
  expect((await request.get("/api/health")).status()).toBe(401);
  expect((await request.get("/api/drafts")).status()).toBe(401);
});

test("the drafts list comes from the dev server", async ({ request }) => {
  const res = await request.get("/api/drafts", { headers: { "x-desk-token": E2E_TOKEN } });
  expect(res.status()).toBe(200);
  const { drafts } = await res.json();
  expect(drafts.map((d: { title: string }) => d.title)).toContain("Turbocode V0.6");
});
