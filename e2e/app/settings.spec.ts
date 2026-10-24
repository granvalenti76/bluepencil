import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { E2E_CONFIG } from "../env.ts";
import { openApp } from "./helpers.ts";

test.use({ viewport: { width: 1440, height: 900 } });

// The real saving is tested in the server tests (settings.test.ts): here the server is shared
// between WebKit and Chromium, and changing its settings in parallel would make the tests interfere.
test('Settings: current values; "Cancel" writes nothing', async ({ page }) => {
  // The "Change folder…" test may rewrite the file in parallel: only check that the value
  // cancelled here did not end up in it.
  const publishDir = async () =>
    (JSON.parse(await readFile(E2E_CONFIG, "utf8")) as { publish: { dir: string } }).publish.dir;
  await openApp(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog.getByLabel("Publish folder")).toHaveValue(/content\/posts$/);
  await expect(dialog.getByLabel("Drafts folder")).toHaveValue(/\.e2e\/drafts$/);
  await expect(dialog.getByLabel("Model address (llama-server)")).toHaveValue(/127\.0\.0\.1/);
  const save = dialog.getByRole("button", { name: "Save" });
  await expect(save).toBeDisabled();

  await dialog.getByLabel("Publish folder").fill("~/Altrove");
  await expect(save).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  expect(await publishDir()).not.toBe("~/Altrove");
});
