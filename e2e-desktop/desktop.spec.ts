import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";

const TURBO = "turbocode-draft-12-settembre.md";
let dir: string;
let app: ElectronApplication;

test.beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "desk-desktop-"));
  await cp("fixtures/drafts", join(dir, "bozze"), { recursive: true });
  // The model points to a closed port: no network in tests.
  await writeFile(
    join(dir, "config.json"),
    JSON.stringify({ model: { baseUrl: "http://127.0.0.1:9/v1" } }),
  );
  app = await electron.launch({
    args: ["packages/desktop"],
    env: {
      ...process.env,
      DESK_DRAFTS_DIR: join(dir, "bozze"),
      DESK_CONFIG: join(dir, "config.json"),
      DESK_USER_DATA: join(dir, "user-data"),
    },
  });
});

test.afterEach(async () => {
  await app.close().catch(() => {});
  await rm(dir, { recursive: true, force: true });
});

test("the window opens the app with its server, in macOS style", async () => {
  const page = await app.firstWindow();
  await expect(page.locator(".sidebar-head")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.dataset.shell)).toBe("desktop");
  await page.locator(`.draft-card[data-path="${TURBO}"]`).click();
  await expect(page.locator(".cm-content")).toContainText("Turbocode è un agent harness");
  // The server rejects requests without a token anyway.
  const origin = new URL(page.url()).origin;
  expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  const res = await fetch(`${origin}/api/drafts`);
  expect(res.status).toBe(401);
});

test("nothing under the macOS traffic lights: the top bar leaves their space", async () => {
  const page = await app.firstWindow();
  await page.locator(".sidebar-head").waitFor();
  for (const draft of [false, true]) {
    if (draft) {
      await page.locator(`.draft-card[data-path="${TURBO}"]`).click();
      await page.locator(".cm-content").waitFor();
    }
    // The traffic lights sit at x 18–70 (trafficLightPosition in main.ts).
    const left = await page
      .getByRole("toolbar", { name: "Tools" })
      .getByRole("button")
      .first()
      .evaluate((b) => b.getBoundingClientRect().left);
    expect(left).toBeGreaterThanOrEqual(80);
  }
});

test("the page's typefaces load in the app too", async () => {
  const page = await app.firstWindow();
  await page.locator(`.draft-card[data-path="${TURBO}"]`).click();
  await page.locator(".cm-content").waitFor();
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
  expect(
    await page.evaluate(() => getComputedStyle(document.querySelector(".cm-content")!).fontFamily),
  ).toMatch(/^"?EB Garamond"?,/);
});

test("menu following the HIG; ⌘Z stays with the editor", async () => {
  const page = await app.firstWindow();
  const menus = await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()!.items.map((i) => ({
      label: i.label,
      items: (i.submenu?.items ?? []).map((s) => ({
        label: s.label,
        role: s.role,
        accel: s.accelerator,
        registered: s.registerAccelerator,
      })),
    })),
  );
  expect(menus.map((m) => m.label)).toEqual([
    "Bluepencil",
    "File",
    "Edit",
    "View",
    "Window",
    "Help",
  ]);
  const item = (menu: string, label: string) =>
    menus.find((m) => m.label === menu)!.items.find((i) => i.label === label);
  expect(item("Bluepencil", "Settings…")?.accel).toBe("CmdOrCtrl+,");
  expect(item("File", "New Draft…")?.accel).toBe("CmdOrCtrl+N");
  expect(item("Help", "Bluepencil Help")).toBeTruthy();
  // Undo in the menu, but the shortcut is not registered: ⌘Z reaches the editor.
  expect(item("Edit", "Undo")).toMatchObject({ accel: "CmdOrCtrl+Z", registered: false });

  await page.locator(`.draft-card[data-path="${TURBO}"]`).click();
  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type(" Prova desktop.");
  await expect(content).toContainText("Prova desktop.");
  await page.keyboard.press("Meta+z");
  await expect(content).not.toContainText("Prova desktop.");
});

test('Help ▸ Bluepencil Help opens the help; without a draft "Publish…" is disabled', async () => {
  const page = await app.firstWindow();
  await page.locator(".sidebar-head").waitFor();
  const enabled = await app.evaluate(
    ({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById("publish")!.enabled,
  );
  expect(enabled).toBe(false);
  await app.evaluate(({ Menu }) => {
    const help = Menu.getApplicationMenu()!.items.find((i) => i.label === "Help")!;
    help.submenu!.items[0]!.click();
  });
  await expect(page.getByRole("dialog", { name: "Bluepencil Help" })).toBeVisible();
});

test("closing the window saves the pending text and the server shuts down", async () => {
  const page = await app.firstWindow();
  await page.locator(`.draft-card[data-path="${TURBO}"]`).click();
  const origin = new URL(page.url()).origin;
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type(" Scritto prima di chiudere.");
  // At once, before the autosave (800 ms).
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
  await app.waitForEvent("close");
  expect(await readFile(join(dir, "bozze", TURBO), "utf8")).toContain("Scritto prima di chiudere.");
  await expect
    .poll(async () =>
      fetch(`${origin}/api/health`).then(
        () => "su",
        () => "giù",
      ),
    )
    .toBe("giù");
});

test("external links do not take the window away", async () => {
  const page = await app.firstWindow();
  await page.locator(".sidebar-head").waitFor();
  const before = page.url();
  await page.evaluate(() => (location.href = "https://example.org/"));
  await page.waitForTimeout(500);
  expect(page.url()).toBe(before);
});
