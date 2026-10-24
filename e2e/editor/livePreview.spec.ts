import { expect, test, type Page } from "@playwright/test";
import { markText, openLab, posOf, withView } from "./helpers.ts";

// Hidden syntax, on the lab's styles sample.

test.use({ viewport: { width: 1440, height: 3600 } });

const doc = (page: Page) => withView(page, (v: any) => v.state.doc.toString());
const head = (page: Page) => withView(page, (v: any) => v.state.selection.main.head);
const place = (page: Page, anchor: number, h = anchor) =>
  withView(
    page,
    (v: any, a: [number, number]) => v.dispatch({ selection: { anchor: a[0], head: a[1] } }),
    [anchor, h],
  );
const caretX = (page: Page) =>
  withView(page, (v: any) => v.coordsAtPos(v.state.selection.main.head)?.left as number);
const content = (page: Page) => page.locator(".cm-content");

test.describe("hidden syntax", () => {
  test.beforeEach(async ({ page }) => {
    await openLab(page, "?doc=styles");
    await content(page).focus();
  });

  test("markers are not visible and the text takes on the style", async ({ page }) => {
    // The initial cursor is on the heading: move it to the end, outside any element.
    await withView(page, (v: any) => v.dispatch({ selection: { anchor: v.state.doc.length } }));
    const text = await content(page).innerText();
    for (const raw of ["**", "# ", "](", "[^1]", "```", "> ", "- Una", "1. Primo", "---"])
      expect(text, raw).not.toContain(raw);

    await expect(page.locator(".cm-lp-h1")).toHaveText("Prova degli stili");
    await expect(page.locator(".cm-lp-strong").first()).toHaveText("grassetto");
    await expect(page.locator(".cm-lp-strong").first()).toHaveCSS("font-weight", "600");
    await expect(page.locator(".cm-lp-em").first()).toHaveCSS("font-style", "italic");
    await expect(page.locator(".cm-lp-code").first()).toHaveText("codice in linea");
    await expect(page.locator(".cm-lp-link")).toHaveText("un collegamento");
    // Lists: dashes and numbers drawn, hanging indent on wrapped lines.
    await expect(page.locator(".cm-lp-bullet")).toHaveText(["–", "–", "–", "–", "1.", "2.", "3."]);
    const hanging = await page
      .locator(".cm-lp-li", { hasText: "rientro sospeso" })
      .evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const rects = Array.from(range.getClientRects()).filter((r) => r.width > 1);
        const bullet = el.querySelector(".cm-lp-bullet")!.getBoundingClientRect();
        const lines = [...new Set(rects.map((r) => Math.round(r.top)))].length;
        const secondLine = rects.find((r) => r.top > bullet.bottom)!;
        return {
          lines,
          bulletLeft: bullet.left,
          bulletRight: bullet.right,
          second: secondLine.left,
        };
      });
    expect(hanging.lines).toBeGreaterThan(1);
    expect(hanging.second).toBeGreaterThan(hanging.bulletLeft + 5);
    expect(Math.abs(hanging.second - hanging.bulletRight)).toBeLessThan(3);
    // Quote with a rule; footnotes as superscript numbers; code blocks drawn.
    expect(
      await page
        .locator(".cm-lp-quote")
        .first()
        .evaluate((el) => getComputedStyle(el).boxShadow),
    ).toContain("inset");
    await expect(page.locator(".cm-lp-fn")).toHaveText(["1", "2", "1", "2"]);
    await expect(page.locator(".cm-lp-codeblock")).toHaveCount(4);
  });

  test("the cursor crosses markers one visible character at a time", async ({ page }) => {
    const s = await posOf(page, "**grassetto**");
    await place(page, s - 1);
    const heads = [await head(page)];
    const xs = [await caretX(page)];
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press("ArrowRight");
      heads.push(await head(page));
      xs.push(await caretX(page));
    }
    for (let i = 1; i < heads.length; i++) {
      expect(heads[i]! - heads[i - 1]!, `passo ${i}`).toBeGreaterThan(0);
      expect(heads[i]! - heads[i - 1]!, `passo ${i}`).toBeLessThanOrEqual(3);
      // Every key moves the cursor on screen: no dead key presses.
      expect(xs[i]!, `passo ${i}`).toBeGreaterThan(xs[i - 1]!);
    }
    // And backwards, back to the starting point.
    for (let i = 0; i < 40 && (await head(page)) > s - 1; i++) {
      const [h0, x0] = [await head(page), await caretX(page)];
      await page.keyboard.press("ArrowLeft");
      expect(await head(page)).toBeLessThan(h0);
      expect(await caretX(page)).toBeLessThan(x0);
    }
    expect(await head(page)).toBe(s - 1);
  });

  test("the selection extends one visible character at a time", async ({ page }) => {
    const s = await posOf(page, "**davvero importante**");
    await place(page, s - 1);
    const visible = () =>
      withView(page, (v: any) => {
        const r = v.state.selection.main;
        return v.state.doc.sliceString(r.from, r.to).replace(/\*/g, "");
      });
    for (let i = 1; i <= 22; i++) {
      await page.keyboard.press("Shift+ArrowRight");
      expect((await visible()).length, `passo ${i}`).toBe(i);
    }
    expect(await visible()).toBe(" davvero importante si");
  });

  test("with the mouse the selection follows the visible text", async ({ page }) => {
    const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
    const bold = await box(".cm-lp-strong");
    const em = await box(".cm-lp-em");
    await page.mouse.move(bold.x + 1, bold.y + bold.height / 2);
    await page.mouse.down();
    await page.mouse.move(em.x + em.width / 2, em.y + em.height / 2, { steps: 8 });
    await page.mouse.move(em.x + em.width - 1, em.y + em.height / 2, { steps: 4 });
    await page.mouse.up();
    const selected = await withView(page, (v: any) => {
      const r = v.state.selection.main;
      return v.state.doc.sliceString(r.from, r.to).replace(/[*_]/g, "");
    });
    expect(selected).toBe("grassetto, corsivo");
    await expect(content(page)).not.toContainText("**");
  });

  test("the cursor inside an element shows no markers and does not move the text", async ({
    page,
  }) => {
    const after = () =>
      page
        .locator(".cm-lp-em")
        .first()
        .evaluate((el) => el.getBoundingClientRect().left);
    const x0 = await after();
    const s = await posOf(page, "**grassetto**");
    for (const p of [s, s + 2, s + 5, s + 11, s + 13]) {
      await place(page, p);
      await expect(page.locator(".cm-lp-syntax")).toHaveCount(0);
      expect(await after()).toBe(x0);
    }
    await expect(content(page)).not.toContainText("**");
  });

  test("Backspace after bold deletes the letter, not the markers", async ({ page }) => {
    const e = (await posOf(page, "**grassetto**")) + "**grassetto**".length;
    await place(page, e);
    await page.keyboard.press("Backspace");
    expect(await doc(page)).toContain("**grassett**,");
    await page.keyboard.press("ControlOrMeta+z");
    expect(await doc(page)).toContain("**grassetto**,");
  });

  test("deleting a selection that cuts through bold keeps the style of the rest", async ({
    page,
  }) => {
    const s = await posOf(page, "**davvero importante**");
    const end = await posOf(page, "si legge");
    await place(page, s + 5, end + 3);
    await page.keyboard.press("Backspace");
    expect(await doc(page)).toContain("Una scelta **dav**legge meglio");
    await expect(content(page)).not.toContainText("**");
    await expect(page.locator(".cm-lp-strong", { hasText: "dav" })).toHaveCount(1);
    // Typing over the selection puts the text inside the bold, as in a word processor.
    await page.keyboard.press("ControlOrMeta+z");
    await place(page, s + 5, end + 3);
    await page.keyboard.type("X");
    expect(await doc(page)).toContain("Una scelta **davX**legge meglio");
  });

  test("⌘B makes bold and ⌘Z undoes it in one step", async ({ page }) => {
    const before = await doc(page);
    const p = await posOf(page, "ultimo paragrafo");
    await place(page, p, p + "ultimo".length);
    await page.keyboard.press("ControlOrMeta+b");
    expect(await doc(page)).toContain("Un **ultimo** paragrafo");
    await expect(page.locator(".cm-lp-strong", { hasText: "ultimo" })).toBeVisible();
    await expect(content(page)).not.toContainText("**ultimo**");
    await page.keyboard.press("ControlOrMeta+z");
    expect(await doc(page)).toBe(before);
  });

  test("Backspace at the start of a heading makes it a paragraph; ⌘Z puts it back", async ({
    page,
  }) => {
    const before = await doc(page);
    const p = await posOf(page, "Elenchi e citazioni");
    await place(page, p);
    await page.keyboard.press("Backspace");
    expect(await doc(page)).toContain("\n\nElenchi e citazioni\n");
    await page.keyboard.press("ControlOrMeta+z");
    expect(await doc(page)).toBe(before);
  });

  test("the cursor does not enter the hidden prefixes of headings and lists", async ({ page }) => {
    const item = await posOf(page, "- Una voce breve.");
    await place(page, item);
    expect(await head(page)).toBe(item + 2);
    // Left arrow from the start of the item: to the line before, not inside the dash.
    await page.keyboard.press("ArrowLeft");
    expect(await head(page)).toBe(item - 1);
    await page.keyboard.press("ArrowRight");
    expect(await head(page)).toBe(item + 2);
    // Typing at the start of an item writes into the item.
    await page.keyboard.type("Ecco: ");
    expect(await doc(page)).toContain("- Ecco: Una voce breve.");
    // Enter continues the list, Backspace on the empty item removes it.
    await withView(page, (v: any) =>
      v.dispatch({ selection: { anchor: v.state.doc.lineAt(v.state.selection.main.head).to } }),
    );
    await page.keyboard.press("Enter");
    await page.keyboard.type("Nuova voce");
    expect(await doc(page)).toContain("- Ecco: Una voce breve.\n- Nuova voce\n");
    await expect(page.locator(".cm-lp-bullet")).toHaveCount(8);
  });

  test("accents, «» and dashes are typed inside and outside the styles", async ({ page }) => {
    const s = await posOf(page, "**grassetto**");
    await place(page, s + 6);
    await page.keyboard.type("à è ì ò ù «così» — perché ");
    expect(await doc(page)).toContain("**grasà è ì ò ù «così» — perché setto**");
    await place(page, (await posOf(page, "così.")) + 5);
    await page.keyboard.type(" Città è più «vera».");
    expect(await doc(page)).toContain("così. Città è più «vera».");
  });

  test("IME: the composed text goes entirely inside a styled element", async ({
    page,
    browserName,
  }) => {
    const s = await posOf(page, "*corsivo*");
    await place(page, s + 4);
    if (browserName === "chromium") {
      // Chromium's real IME (Japanese): multi-step composition, then confirmation.
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Input.imeSetComposition", { text: "に", selectionStart: 1, selectionEnd: 1 });
      await cdp.send("Input.imeSetComposition", {
        text: "にほん",
        selectionStart: 3,
        selectionEnd: 3,
      });
      await cdp.send("Input.imeSetComposition", {
        text: "日本",
        selectionStart: 2,
        selectionEnd: 2,
      });
      await cdp.send("Input.insertText", { text: "日本" });
    } else {
      // WebKit has no IME Playwright can drive: the composition events Safari sends are replayed
      // (compositionstart, insertions, compositionend).
      await page.evaluate(() => {
        const el = document.querySelector(".cm-content")!;
        el.dispatchEvent(new CompositionEvent("compositionstart", { data: "" }));
        document.execCommand("insertText", false, "にほん");
        const sel = getSelection()!;
        sel.modify("extend", "backward", "character");
        sel.modify("extend", "backward", "character");
        sel.modify("extend", "backward", "character");
        document.execCommand("insertText", false, "日本");
        el.dispatchEvent(new CompositionEvent("compositionend", { data: "日本" }));
      });
    }
    await expect.poll(() => doc(page)).toContain("*cor日本sivo*");
    await expect(page.locator(".cm-lp-em").first()).toHaveText(/cor日本sivo/);
  });

  test('"Show Markdown" (⌥⌘M) shows all the Markdown and hides it again', async ({ page }) => {
    await page.keyboard.press("Alt+Meta+m");
    for (const raw of [
      "**grassetto**",
      "# Prova",
      "[un collegamento](https://example.org/carta)",
      "[^1]",
    ])
      await expect(content(page)).toContainText(raw);
    await expect(page.locator(".cm-lp-bullet")).toHaveCount(0);
    await page.keyboard.press("Alt+Meta+m");
    await expect(content(page)).not.toContainText("**grassetto**");
  });

  test("judgment marks stay on the right text with hidden syntax", async ({ page }) => {
    await withView(page, (v: any) => v.dispatch({ selection: { anchor: v.state.doc.length } }));
    expect(await markText(page, "p1")).toBe("davvero importante");
    expect(await markText(page, "g2")).toBe("un collegamento");
    expect(await markText(page, "f6")).toBe("con il llama-server locale");
    expect(await markText(page, "r3")).toBe("annidata con corsivo");
    // With the Markdown shown the mark also covers the markers: it is the same range.
    await page.keyboard.press("Alt+Meta+m");
    expect(await markText(page, "p1")).toBe("**davvero importante**");
    await page.keyboard.press("Alt+Meta+m");
    // "Apply" replaces the text with its markers.
    await page.getByTestId("apply-p1").click();
    expect(await doc(page)).toContain("Una scelta importante si legge");
    await expect(page.getByTestId("status-p1")).toHaveText("applied");
    // The other marks do not move.
    expect(await markText(page, "g2")).toBe("un collegamento");
  });
});
