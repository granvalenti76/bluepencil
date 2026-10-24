import { expect, test, type Page } from "@playwright/test";
import { openApp, openDrafts, TURBO } from "./helpers.ts";

async function openSettings(page: Page) {
  await openDrafts(page);
  await page.getByRole("button", { name: "Settings" }).click();
}

const status = (over: Record<string, unknown> = {}, cloud: Record<string, unknown> = {}) => ({
  local: {
    baseUrl: "http://127.0.0.1:4499/v1",
    reachable: true,
    model: "Qwen3.6-35B",
    checkedAt: new Date().toISOString(),
    ...over,
  },
  cloud: { enabled: false, available: false, model: null, ...cloud },
});

test.describe("model status in the status bar", () => {
  test('name read from the fake llama-server\'s /models and "local"', async ({ page }) => {
    await openApp(page, TURBO);
    await expect(page.locator(".statusbar")).toContainText("Qwen3.6-35B · local");
  });

  test("llama-server unreachable: amber warning", async ({ page }) => {
    await page.route("**/api/model/status*", (r) =>
      r.fulfill({ json: status({ reachable: false, model: null, error: "ECONNREFUSED" }) }),
    );
    await openApp(page, TURBO);
    const warn = page.locator('.model-state[data-state="unreachable"]');
    await expect(warn).toHaveText("model unreachable");
    await expect(warn).toHaveCSS("color", "rgb(183, 121, 31)");
  });

  test('cloud only in Settings and only if available; "cloud" in the bar while it is on', async ({
    page,
  }) => {
    await openApp(page, TURBO);
    await openSettings(page);
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings.getByLabel(/Use the cloud model/)).toHaveCount(0);
    await settings.getByRole("button", { name: "Close" }).click();

    await page.route("**/api/model/status*", (r) =>
      r.fulfill({ json: status({}, { enabled: true, available: true, model: "grande" }) }),
    );
    await page.reload();
    await expect(page.locator(".statusbar").getByRole("button", { name: /cloud/i })).toHaveCount(0);
    await openSettings(page);
    const toggle = settings.getByLabel("Use the cloud model (grande) for the next requests");
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await settings.getByRole("button", { name: "Close" }).click();
    await expect(page.locator(".statusbar")).toContainText("grande · cloud");
    await openSettings(page);
    await toggle.uncheck();
    await settings.getByRole("button", { name: "Close" }).click();
    await expect(page.locator(".statusbar")).toContainText("Qwen3.6-35B · local");
  });
});
