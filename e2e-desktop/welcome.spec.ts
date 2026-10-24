import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

// A configuration from before the first-start screen, with an empty folder: nothing to find, so
// the first start runs; once the folder is chosen, the server restarts and moves on to the editor.
test("an older configuration, with an empty folder, goes through the first start up to the sample", async () => {
  const dir = await mkdtemp(join(tmpdir(), "desk-desktop-welcome-"));
  const empty = join(dir, "vuota");
  await mkdir(empty);
  await writeFile(
    join(dir, "config.json"),
    JSON.stringify({ draftsDir: empty, model: { baseUrl: "http://127.0.0.1:9/v1" } }),
  );
  const env = { ...process.env, DESK_CONFIG: join(dir, "config.json") };
  env.DESK_USER_DATA = join(dir, "user-data");
  env.DESK_NEW_FOLDER = join(dir, "Bluepencil");
  delete env.DESK_DRAFTS_DIR;
  const app = await electron.launch({ args: ["packages/desktop"], env });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("region", { name: "Welcome" })).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Setup" })).toBeVisible();
    const card = page.getByRole("tabpanel");
    await card.getByRole("radio", { name: /A new folder/ }).check();
    await card.getByRole("button", { name: "Continue" }).click();
    await expect(card.getByRole("heading")).toHaveText("Connect your editor", { timeout: 20_000 });
    await expect(page.locator(".cm-content")).toHaveCount(0);

    // All the way: the sample opens by reloading the page, and it stays the desktop app (the
    // space for the window controls, x 18–70).
    await card.getByRole("button", { name: "Test connection" }).click();
    await card.getByRole("button", { name: "Write without the editor" }).click();
    await expect(page.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => document.documentElement.dataset.shell)).toBe("desktop");
    const left = await page
      .getByRole("toolbar", { name: "Tools" })
      .getByRole("button")
      .first()
      .evaluate((b) => b.getBoundingClientRect().left);
    expect(left).toBeGreaterThanOrEqual(80);
  } finally {
    await app.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});
