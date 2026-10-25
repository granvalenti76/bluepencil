import { expect, test } from "@playwright/test";
import { TURBO, openApp, openNotes } from "./helpers.ts";

test.use({ viewport: { width: 1440, height: 900 } });

// Off macOS ⌘ becomes Ctrl and ⌃⌘ becomes Ctrl+Alt (keys.ts): here the page believes it runs on
// Linux, whatever the system the tests run on.
test.describe("shortcuts on Linux", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() =>
      Object.defineProperty(Navigator.prototype, "platform", { get: () => "Linux x86_64" }),
    );
    await openApp(page, TURBO, { mode: "write" });
  });

  test("Ctrl+O the drafts, Ctrl+Alt+N Write / Review, Ctrl+Shift+P preview", async ({ page }) => {
    const layer = page.locator(".drafts-layer");
    await page.keyboard.press("Control+o");
    await expect(layer).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(layer).toHaveCount(0);

    await page.keyboard.press("Control+Alt+n");
    await expect(openNotes(page)).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Control+Alt+n");
    await expect(openNotes(page)).toHaveAttribute("aria-pressed", "false");

    await page.keyboard.press("Control+Shift+p");
    await expect(page.locator(".editor-col")).toBeHidden();
    await page.keyboard.press("Control+Shift+p");
    await expect(page.locator(".editor-col")).toBeVisible();

    // ⌘ alone, on Linux the Super key, no longer opens anything.
    await page.keyboard.press("Meta+o");
    await expect(layer).toHaveCount(0);
  });

  test("the labels spell Ctrl", async ({ page }) => {
    await expect(page.locator(".show-md kbd")).toHaveText("Ctrl+Alt+M");
    await page.getByRole("button", { name: "Bold" }).hover();
    await expect(page.getByRole("tooltip")).toHaveText("Bold · Ctrl+B");
  });
});
