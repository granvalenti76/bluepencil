import { expect, test } from "@playwright/test";
import { openLab, posOf, withView } from "./helpers.ts";

// These tests describe the expected behaviour of hemingway.ts; they stay `fixme` while the
// extension is not implemented.
const MOD = process.platform === "darwin" ? "Meta" : "Control";

test.describe("Hemingway", () => {
  test.beforeEach(async ({ page }) => {
    await openLab(page);
    await page.getByRole("button", { name: "Hemingway" }).click();
    const p = await posOf(page, "tra i 100");
    await withView(
      page,
      (v: any, pos: number) => v.dispatch({ selection: { anchor: pos + 10 } }),
      p,
    );
    await page.locator(".cm-content").focus();
  });

  const doc = (page: import("@playwright/test").Page) =>
    withView(page, (v: any) => v.state.doc.toString());

  test.fixme("Backspace, Delete and Cmd+Backspace have no effect", async ({ page }) => {
    const before = await doc(page);
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Delete");
    await page.keyboard.press(`${MOD}+Backspace`);
    expect(await doc(page)).toBe(before);
  });

  test.fixme("cut has no effect", async ({ page }) => {
    const before = await doc(page);
    await withView(page, (v: any) =>
      v.dispatch({
        selection: { anchor: v.state.selection.main.head, head: v.state.selection.main.head + 8 },
      }),
    );
    await page.keyboard.press(`${MOD}+x`);
    expect(await doc(page)).toBe(before);
  });

  test.fixme("typing over a selection has no effect", async ({ page }) => {
    const before = await doc(page);
    await withView(page, (v: any) =>
      v.dispatch({
        selection: { anchor: v.state.selection.main.head, head: v.state.selection.main.head + 8 },
      }),
    );
    await page.keyboard.type("z");
    expect(await doc(page)).toBe(before);
  });

  test.fixme("typing at the end still works", async ({ page }) => {
    await page.keyboard.type("ciao");
    expect(await doc(page)).toContain("ciao");
  });

  test.fixme('a note\'s "Apply" works even with Hemingway on', async ({ page }) => {
    await page.getByTestId("apply-r2").click();
    expect(await doc(page)).toContain(
      "su modelli linguistici locali, con fallback cloud opzionale",
    );
    await page.getByTestId("apply-r1").click(); // deletes «completamente»: a deletion allowed because it is an action of the note
    expect(await doc(page)).not.toContain("completamente");
  });

  test.fixme("Cmd+Z undoes even with Hemingway on", async ({ page }) => {
    const before = await doc(page);
    await page.getByTestId("apply-g1").click();
    expect(await doc(page)).not.toBe(before);
    await page.locator(".cm-content").focus();
    await page.keyboard.press(`${MOD}+z`);
    expect(await doc(page)).toBe(before);
  });
});
