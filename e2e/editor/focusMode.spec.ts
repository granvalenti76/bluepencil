import { expect, test } from "@playwright/test";
import { openLab, posOf, withView } from "./helpers.ts";

test.use({ viewport: { width: 1440, height: 3600 } });

// 25 body lines plus the blank line after the last newline.
async function expectOnlyLines(page: import("@playwright/test").Page, bright: number[]) {
  const lines = page.locator(".cm-line");
  await expect(lines).toHaveCount(26);
  for (let n = 1; n <= 26; n++) {
    await expect(lines.nth(n - 1), `riga ${n}`).toHaveCSS(
      "opacity",
      bright.includes(n) ? "1" : "0.3",
    );
  }
}

test.describe("focus", () => {
  test.beforeEach(async ({ page }) => {
    await openLab(page);
    await page.getByRole("button", { name: "Focus" }).click();
  });

  test("dims everything except the cursor's paragraph", async ({ page }) => {
    const p = await posOf(page, "tra i 100");
    await withView(page, (v: any, pos: number) => v.dispatch({ selection: { anchor: pos } }), p);
    await expectOnlyLines(page, [9]);

    const q = await posOf(page, "Modelli più piccoli");
    await withView(
      page,
      (v: any, pos: number) => v.dispatch({ selection: { anchor: pos + 5 } }),
      q,
    );
    await expectOnlyLines(page, [11]);
  });

  test("on a heading only the heading line stays highlighted", async ({ page }) => {
    const h2 = await posOf(page, "## Cosa è Turbocode");
    await withView(
      page,
      (v: any, pos: number) => v.dispatch({ selection: { anchor: pos + 6 } }),
      h2,
    );
    await expectOnlyLines(page, [5]);
  });

  test("while typing, the current block follows the cursor; switching off, everything is full again", async ({
    page,
  }) => {
    const p = await posOf(page, "tra i 100");
    await withView(page, (v: any, pos: number) => v.dispatch({ selection: { anchor: pos } }), p);
    await page.locator(".cm-content").focus();
    await page.keyboard.type("ciao ");
    await expectOnlyLines(page, [9]);

    await page.getByRole("button", { name: "Focus" }).click();
    await expectOnlyLines(
      page,
      Array.from({ length: 26 }, (_, i) => i + 1),
    );
  });
});
