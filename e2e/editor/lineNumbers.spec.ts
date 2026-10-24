import { expect, test, type Page } from "@playwright/test";
import { bodyLines, lineNumbers, numbersReady, openLab, posOf, withView } from "./helpers.ts";

test.use({ viewport: { width: 1440, height: 3600 } });

/** Numbers that fall inside one line of the file. */
async function numbersPerLine(page: Page) {
  const nums = await lineNumbers(page);
  const lines = await bodyLines(page);
  return lines.map((l) => ({
    ...l,
    numbers: nums.filter((n) => n.mid >= l.top && n.mid < l.bottom).map((n) => n.text),
  }));
}

/** Every visual line of a paragraph has its number; blank lines none; counted in sequence. */
async function expectVisualNumbering(page: Page) {
  const lines = await numbersPerLine(page);
  for (const l of lines) {
    if (l.text === "") expect(l.numbers, "riga vuota senza numero").toEqual([]);
    else if (l.plain) expect(l.numbers.length, `«${l.text.slice(0, 30)}…»`).toBe(l.visual);
    else expect(l.numbers.length, `«${l.text.slice(0, 30)}…»`).toBeGreaterThan(0);
  }
  const all = lines.flatMap((l) => l.numbers);
  expect(all).toEqual(all.map((_, i) => String(i + 1)));
  return lines;
}

test.describe("numbers on the page's lines", () => {
  test.beforeEach(async ({ page }) => openLab(page));

  test("the front matter is hidden, numbers start at 1 and count the visual lines", async ({
    page,
  }) => {
    await expect(page.locator(".cm-content")).not.toContainText("archetype:");
    await expect(page.locator(".cm-content")).not.toContainText("glossary");

    const lines = await expectVisualNumbering(page);
    // The draft has long paragraphs: more visual lines than file lines.
    const wrapped = lines.filter((l) => l.visual > 1);
    expect(wrapped.length).toBeGreaterThan(4);
    expect(lines.flatMap((l) => l.numbers).length).toBeGreaterThan(40);
  });

  test("numbers update while typing", async ({ page }) => {
    const before = await numbersPerLine(page);
    const total = before.flatMap((l) => l.numbers).length;
    const p = await posOf(page, "Modelli più piccoli");
    const end = await withView(page, (v: any, pos: number) => v.state.doc.lineAt(pos).to, p);
    await withView(page, (v: any, pos: number) => v.dispatch({ selection: { anchor: pos } }), end);
    await page.locator(".cm-content").focus();
    // Enough text for at least one more line.
    await page.keyboard.type(
      " Una frase in più che allunga il paragrafo fino a farlo andare a capo.",
    );
    await expect.poll(async () => (await lineNumbers(page)).length).toBeGreaterThan(total);
    await expectVisualNumbering(page);
  });

  test("numbers update when the page width changes", async ({ page }) => {
    const before = (await lineNumbers(page)).length;
    await page.evaluate(() =>
      document.querySelector<HTMLElement>(".lab-carta")!.style.setProperty("--measure", "420px"),
    );
    await expect.poll(async () => (await lineNumbers(page)).length).toBeGreaterThan(before + 10);
    await expectVisualNumbering(page);
  });

  test("the cursor line's number is darker", async ({ page }) => {
    const p = await posOf(page, "tra i 100");
    await withView(page, (v: any, pos: number) => v.dispatch({ selection: { anchor: pos } }), p);
    const nums = await lineNumbers(page);
    const active = nums.filter((n) => n.active);
    expect(active).toHaveLength(1);
    const caret = await withView(page, (v: any) => {
      const c = v.coordsAtPos(v.state.selection.main.head);
      return (c.top + c.bottom) / 2;
    });
    expect(Math.abs(active[0]!.mid - caret)).toBeLessThan(12);
    const color = (sel: string) =>
      page
        .locator(sel)
        .first()
        .evaluate((el) => getComputedStyle(el).color);
    expect(await color(".cm-vln-active")).not.toBe(await color(".cm-vln:not(.cm-vln-active)"));
  });

  test('with "Show Markdown" the file\'s line numbers come back', async ({ page }) => {
    await page.getByRole("button", { name: "Show Markdown" }).click();
    await expect(page.getByRole("button", { name: "Show Markdown" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect
      .poll(async () => (await lineNumbers(page)).map((n) => n.text))
      .toEqual(["1", "3", "5", "7", "9", "11", "13", "15", "17", "19", "21", "23", "25"]);
    await page.keyboard.press("Alt+Meta+m");
    await expect.poll(async () => (await lineNumbers(page)).length).toBeGreaterThan(40);
  });

  test("the cursor starts on the first heading's text and the front matter cannot be edited from here", async ({
    page,
  }) => {
    const bodyStart = await posOf(page, "# Turbocode V0.6");
    // The heading's prefix is hidden: the cursor is at the start of the heading's text.
    expect(await withView(page, (v: any) => v.state.selection.main.head)).toBe(bodyStart + 2);

    // With the Markdown shown, Backspace at the start of the body does not touch the front matter.
    const before = await withView(page, (v: any) => v.state.doc.toString());
    await page.locator(".cm-content").focus();
    await page.keyboard.press("Alt+Meta+m");
    await withView(
      page,
      (v: any, p: number) => v.dispatch({ selection: { anchor: p } }),
      bodyStart,
    );
    await page.keyboard.press("Backspace");
    expect(await withView(page, (v: any) => v.state.doc.toString())).toBe(before);

    // typing at the start of the body is still possible
    await page.keyboard.type("x");
    expect(
      await withView(page, (v: any) =>
        v.state.doc.sliceString(v.state.selection.main.head - 1, v.state.selection.main.head + 3),
      ),
    ).toBe("x# T");
  });
});

test.describe("numbers on the long draft", () => {
  test("off-screen lines are counted right: jumping to the end or scrolling gives the same number", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLab(page, "?stress=1");
    // Direct jump to the end: the lines above were never drawn.
    await withView(page, (v: any) =>
      v.dispatch({ selection: { anchor: v.state.doc.length }, scrollIntoView: true }),
    );
    await numbersReady(page);
    const jumped = await lastNumber(page);

    // Reload and scroll to the end a bit at a time: every line is drawn and measured.
    await openLab(page, "?stress=1");
    for (let i = 0; i < 200; i++) {
      const done = await withView(page, (v: any) => {
        const s = v.scrollDOM;
        s.scrollTop += s.clientHeight * 0.8;
        return s.scrollTop + s.clientHeight >= s.scrollHeight - 2;
      });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
      if (done) break;
    }
    await numbersReady(page);
    expect(await lastNumber(page)).toBe(jumped);
    expect(jumped).toBeGreaterThan(300);
  });
});

async function lastNumber(page: Page): Promise<number> {
  const nums = await lineNumbers(page);
  return Math.max(...nums.map((n) => Number(n.text)));
}
