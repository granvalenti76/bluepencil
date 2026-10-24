import { expect, test, type Page } from "@playwright/test";
import { openLab, posOf, withView } from "./helpers.ts";

// Typewriter. The scroll arrives in the frames after the edit: it is measured once it has
// settled (that is what you see), with `centered`.
const offCenter = (page: Page) =>
  withView(page, (v: any) => {
    const rect = v.scrollDOM.getBoundingClientRect();
    const c = v.coordsAtPos(v.state.selection.main.head);
    return {
      delta: Math.abs((c.top + c.bottom) / 2 - (rect.top + rect.bottom) / 2),
      lineHeight: c.bottom - c.top,
    };
  });

/** Within half a second the cursor is within ±1 line of the centre. */
const centered = (page: Page) =>
  expect
    .poll(
      async () => {
        const { delta, lineHeight } = await offCenter(page);
        return lineHeight > 10 && delta <= lineHeight;
      },
      { timeout: 500, intervals: [16, 32, 50, 100] },
    )
    .toBe(true);

test.describe("Typewriter", () => {
  test("the cursor line stays within ±1 line of the centre while typing", async ({ page }) => {
    await openLab(page, "?stress=1");
    await page.getByRole("button", { name: "Focus" }).click(); // typewriter on together with focus
    await withView(page, (v: any) => v.dispatch({ selection: { anchor: v.state.doc.length } }));
    await page.locator(".cm-content").focus();

    for (let i = 0; i < 12; i++) {
      await page.keyboard.type("Una nuova riga di prova per il typewriter.");
      await page.keyboard.press("Enter");
      await centered(page);
    }
  });

  test("the first and last lines can sit in the centre", async ({ page }) => {
    await openLab(page);
    await page.getByRole("button", { name: "Focus" }).click();
    // The first visible line (the front matter is hidden) and the last of the document.
    const first = await posOf(page, "# Turbocode");
    for (const anchor of [first, await withView(page, (v: any) => v.state.doc.length)]) {
      await withView(page, (v: any, a: number) => v.dispatch({ selection: { anchor: a } }), anchor);
      await centered(page);
    }
  });

  test("switched on with the cursor mid-document, the line goes to the centre at once", async ({
    page,
  }) => {
    await openLab(page, "?stress=1");
    await withView(page, (v: any) =>
      v.dispatch({ selection: { anchor: Math.floor(v.state.doc.length / 2) } }),
    );
    await page.getByRole("button", { name: "Focus" }).click();
    await centered(page);
  });

  test("off, no extra space and no forced scrolling", async ({ page }) => {
    await openLab(page);
    const pad = await withView(page, (v: any) => v.contentDOM.style.paddingTop);
    await page.getByRole("button", { name: "Focus" }).click();
    await expect
      .poll(() => withView(page, (v: any) => v.contentDOM.style.paddingTop))
      .not.toBe(pad);
    await page.getByRole("button", { name: "Focus" }).click();
    await expect.poll(() => withView(page, (v: any) => v.contentDOM.style.paddingTop)).toBe(pad);
  });
});
