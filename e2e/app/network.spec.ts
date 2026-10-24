import { expect, test } from "@playwright/test";
import { copyTurbo, openApp, openDrafts } from "./helpers.ts";

test.use({ viewport: { width: 1440, height: 900 } });

// No external network (bundled fonts, no CDN). The server calls the model, not the browser: the
// page talks only to 127.0.0.1.
test("the page makes no requests outside 127.0.0.1", async ({ page, request }) => {
  const hosts = new Set<string>();
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.protocol.startsWith("http")) hosts.add(u.hostname);
  });
  const { path } = await copyTurbo(request);
  await openApp(page, path);
  await openDrafts(page);
  await page.getByLabel("Search drafts and sources").fill("RAM");
  await expect(page.locator(".search-hit").first()).toBeVisible();
  await page.goto("/lab");
  await page.locator(".cm-content").waitFor();
  // All the typefaces, even those the page does not use yet (the editor's hand, the signature):
  // they come from the package, not from the network.
  const faces = await page.evaluate(async () => {
    await Promise.all([...document.fonts].map((f) => f.load()));
    return [...document.fonts].map((f) => `${f.family.replace(/"/g, "")} ${f.style} ${f.status}`);
  });
  expect(faces.sort()).toEqual([
    "EB Garamond italic loaded",
    "EB Garamond normal loaded",
    "JetBrains Mono normal loaded",
    "Mrs Saint Delafield normal loaded",
    "Pinyon Script normal loaded",
  ]);
  expect([...hosts]).toEqual(["127.0.0.1"]);
});
