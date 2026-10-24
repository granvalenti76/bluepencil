import { expect, test, type Page } from "@playwright/test";
import { copyTurbo, openApp } from "./helpers.ts";

test.use({ viewport: { width: 1440, height: 900 } });

/**
 * The desktop app's menu talks to the page through `window.bluepencil` (the preload). Here the
 * bridge is fake: the states sent to the menu are recorded and commands are sent as the menu would.
 */
async function withFakeBridge(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      bluepencil: unknown;
      __menu: { send?: (c: string) => void; states: Record<string, boolean>[] };
    };
    w.__menu = { states: [] };
    w.bluepencil = {
      onMenu: (cb: (c: string) => void) => (w.__menu.send = cb),
      menuState: (s: Record<string, boolean>) => w.__menu.states.push(s),
    };
  });
}

const menu = (page: Page, command: string) =>
  page.evaluate((c) => (window as any).__menu.send(c), command);
const lastState = (page: Page) =>
  page.evaluate(() => (window as any).__menu.states.at(-1) as Record<string, boolean>);

test("menu commands open the dialogs, even without an open draft", async ({ page }) => {
  await withFakeBridge(page);
  await openApp(page);
  // Without an open draft the drafts list stays open.
  await expect.poll(() => lastState(page)).toMatchObject({ hasDraft: false, sidebar: true });

  await menu(page, "new-draft");
  const dialog = page.getByRole("dialog", { name: "New draft" });
  await expect(dialog.getByLabel("Title")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await menu(page, "settings");
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await page.keyboard.press("Escape");

  await menu(page, "help");
  const help = page.getByRole("dialog", { name: "Bluepencil Help" });
  await expect(help).toContainText("never changes your text by itself");
  // The help describes Write, Review, the editor's card and the first start.
  for (const heading of ["The first start", "Write", "Review and the editor’s card"]) {
    await expect(help.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  await expect(help).toContainText("Sign-off");
  await help.getByRole("button", { name: "Done" }).click();
  await expect(help).toHaveCount(0);

  // Without an open draft "Publish…" does nothing (it is disabled in the menu).
  await menu(page, "publish");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test('with a draft: checkmark state, "Publish…", Undo from the menu', async ({ page, request }) => {
  const { path } = await copyTurbo(request);
  await withFakeBridge(page);
  await openApp(page, path);
  await expect.poll(() => lastState(page)).toMatchObject({ hasDraft: true, focus: false });

  await menu(page, "toggle-focus");
  await expect.poll(() => lastState(page)).toMatchObject({ focus: true });
  await menu(page, "toggle-focus");

  // "Drafts" (⌘O) opens the list over the desk, "Review Mode" switches from Write to Review.
  await expect.poll(() => lastState(page)).toMatchObject({ sidebar: false, notes: true });
  await menu(page, "toggle-sidebar");
  await expect.poll(() => lastState(page)).toMatchObject({ sidebar: true });
  await expect(page.locator(".drafts-layer")).toBeVisible();
  await page.keyboard.press("Escape");
  await menu(page, "toggle-notes");
  await expect.poll(() => lastState(page)).toMatchObject({ sidebar: false, notes: false });

  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type(" Dal menu.");
  await expect(content).toContainText("Dal menu.");
  await menu(page, "undo");
  await expect(content).not.toContainText("Dal menu.");
  await menu(page, "redo");
  await expect(content).toContainText("Dal menu.");

  await menu(page, "publish");
  await expect(page.getByRole("dialog", { name: "Publish" })).toBeVisible();
});
