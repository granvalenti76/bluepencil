import { expect, test, type Page } from "@playwright/test";
import { bodyLines, lineNumbers, numbersReady } from "../editor/helpers.ts";
import { copyTurbo, MOD, openApp, toggleView, view } from "./helpers.ts";

/**
 * "Handwriting" and "Typing sounds" in the View menu.
 */

test.use({ viewport: { width: 1440, height: 700 } });

const font = (page: Page, sel: string) =>
  page
    .locator(sel)
    .first()
    .evaluate((el) => getComputedStyle(el).fontFamily);

async function lastNumber(page: Page) {
  const nums = await lineNumbers(page);
  return Math.max(...nums.map((n) => Number(n.text)));
}

async function jumpToEnd(page: Page) {
  await view(page, (v) =>
    v.dispatch({ selection: { anchor: v.state.doc.length }, scrollIntoView: true }),
  );
  await numbersReady(page);
}

/**
 * Turbocode with the body repeated: long enough to have lines never drawn. At the end a paragraph
 * of narrow words, which wraps quite differently in the two typefaces (the rest, by chance, gives
 * almost the same number of lines).
 */
const longTurbo = (t: string) => {
  const body = t.slice(t.indexOf("\n---", 3) + 4);
  return `${t}${body.repeat(3)}\n${"il mini fili, ".repeat(300)}\n`;
};

test.describe("Handwriting", () => {
  test("in Write the text is in the author's hand, the numbers stay in EB Garamond", async ({
    page,
    request,
  }) => {
    const { path } = await copyTurbo(request);
    await openApp(page, path, { mode: "write" });
    await page.getByRole("button", { name: "View", exact: true }).click();
    const item = page.getByRole("button", { name: "Handwriting" });
    await expect(item).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Escape");
    expect(await font(page, ".cm-line")).toContain("EB Garamond");

    await toggleView(page, "Handwriting");
    await expect.poll(() => font(page, ".cm-line")).toContain("Mrs Saint Delafield");
    await expect(page.locator(".cm-scroller")).toHaveCSS("font-size", "32px");
    await expect(page.locator(".cm-scroller")).toHaveCSS("line-height", "42px");
    expect(await font(page, ".cm-vln")).toContain("EB Garamond");
    // Every visual line has its number, counted in sequence.
    const nums = await lineNumbers(page);
    const lines = await bodyLines(page);
    for (const l of lines.filter((l) => l.plain && l.text)) {
      const inside = nums.filter((n) => n.mid >= l.top && n.mid < l.bottom);
      expect(inside.length, `«${l.text.slice(0, 30)}…»`).toBe(l.visual);
    }
    expect(nums.map((n) => n.text)).toEqual(nums.map((_, i) => String(i + 1)));

    // In Review the text goes back to EB Garamond and the item is absent; back in Write, the hand.
    await page.getByRole("button", { name: /^Review \(/ }).click();
    await expect.poll(() => font(page, ".cm-line")).toContain("EB Garamond");
    await page.getByRole("button", { name: "View", exact: true }).click();
    await expect(page.getByRole("button", { name: "Handwriting" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Write", exact: true }).click();
    await expect.poll(() => font(page, ".cm-line")).toContain("Mrs Saint Delafield");

    // It is a browser preference: it survives a reload.
    await page.reload();
    await page.locator(".cm-content").waitFor();
    await expect.poll(() => font(page, ".cm-line")).toContain("Mrs Saint Delafield");
  });

  test("off-screen lines are counted again when the typeface changes", async ({
    page,
    request,
  }) => {
    const { path } = await copyTurbo(request, longTurbo);
    await openApp(page, path, { mode: "write" });
    await numbersReady(page);
    await jumpToEnd(page);
    const garamond = await lastNumber(page);

    // At the top, with the lines at the end already counted in EB Garamond: switch to the hand and jump down.
    await page.reload();
    await page.locator(".cm-content").waitFor();
    await numbersReady(page);
    await toggleView(page, "Handwriting");
    await numbersReady(page);
    await jumpToEnd(page);
    const switched = await lastNumber(page);

    // Reopened with the hand already chosen: the lines are counted only in the hand.
    await page.reload();
    await page.locator(".cm-content").waitFor();
    await numbersReady(page);
    await jumpToEnd(page);
    expect(await lastNumber(page)).toBe(switched);
    expect(switched).not.toBe(garamond);
  });
});

test.describe("Typing sounds", () => {
  test("off by default; on, one click per typed key, nothing for commands and arrows", async ({
    page,
    request,
  }) => {
    // Every click starts a filtered noise: count those.
    await page.addInitScript(() => {
      const w = window as unknown as { __clicks: number };
      w.__clicks = 0;
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
        w.__clicks++;
        return start.apply(this, args);
      };
    });
    const clicks = () => page.evaluate(() => (window as unknown as { __clicks: number }).__clicks);
    const { path } = await copyTurbo(request);
    await openApp(page, path, { mode: "write" });
    await page.locator(".cm-content").click();
    await page.keyboard.type("ab");
    expect(await clicks()).toBe(0);

    await toggleView(page, "Typing sounds");
    await page.locator(".cm-content").click();
    await page.keyboard.type("ab c");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Backspace");
    await expect.poll(clicks).toBe(6);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press(`${MOD}+z`);
    await page.keyboard.press("Shift");
    expect(await clicks()).toBe(6);

    // It stays on after a reload; off, it is silent.
    await page.reload();
    await page.locator(".cm-content").click();
    await page.keyboard.type("x");
    await expect.poll(clicks).toBe(1);
    await toggleView(page, "Typing sounds");
    await page.locator(".cm-content").click();
    await page.keyboard.type("y");
    expect(await clicks()).toBe(1);
  });

  test("with the hand you hear the fountain pen, not the keyboard; in Review the keyboard comes back", async ({
    page,
    request,
  }) => {
    // The keyboard plays a short noise, the fountain pen the grain of the paper (two seconds).
    await page.addInitScript(() => {
      const w = window as unknown as { __voices: string[] };
      w.__voices = [];
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
        w.__voices.push(this.buffer!.duration > 1 ? "pen" : "keys");
        return start.apply(this, args);
      };
    });
    const voices = () =>
      page.evaluate(() => (window as unknown as { __voices: string[] }).__voices.join(" "));
    const { path } = await copyTurbo(request);
    await openApp(page, path, { mode: "write" });
    await toggleView(page, "Typing sounds");
    await page.locator(".cm-content").click();
    await page.keyboard.type("a");
    await toggleView(page, "Handwriting");
    await page.locator(".cm-content").click();
    await page.keyboard.type("b c");
    await page.keyboard.press("Enter");
    await expect.poll(voices).toBe("keys pen pen pen pen");
    await page.getByRole("button", { name: /^Review \(/ }).click();
    await page.locator(".cm-content").click();
    await page.keyboard.type("d");
    await expect.poll(voices).toBe("keys pen pen pen pen keys");
  });
});
