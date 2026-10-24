import { expect, test, type Page } from "@playwright/test";
import { card, copyTurbo, docText, finishPass, openApp, passOpen, startReview } from "./helpers.ts";

/**
 * The animations: the card served, the marks drawn, the letter writing itself, the notes one at
 * a time, the nib and the sign-off's stamp. Short, never blocking; with "Reduce motion" none runs.
 */

test.use({ viewport: { width: 1440, height: 900 } });

/** Records, for the whole page, what was animated (even what lasts an instant). */
async function recordMotion(page: Page) {
  await page.addInitScript(() => {
    const seen = {
      maxAnimations: 0,
      names: [] as string[],
      served: 0,
      writing: false,
      letterWriting: false,
      drawing: 0,
      delayedNotes: 0,
    };
    (window as unknown as { __motion: typeof seen }).__motion = seen;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args: Parameters<typeof animate>) {
      if ((this as Element).id === "editor-card") seen.served++;
      return animate.apply(this, args);
    };
    const tick = () => {
      const all = document.getAnimations();
      seen.maxAnimations = Math.max(seen.maxAnimations, all.length);
      for (const a of all) {
        const name = (a as CSSAnimation).animationName;
        if (name && !seen.names.includes(name)) seen.names.push(name);
      }
      if (document.body?.textContent?.includes("The editor is writing")) seen.writing = true;
      if (document.querySelector('.letter-text[data-writing="true"]')) seen.letterWriting = true;
      seen.drawing = Math.max(seen.drawing, document.querySelectorAll(".cm-j-draw").length);
      seen.delayedNotes = Math.max(
        seen.delayedNotes,
        document.querySelectorAll('.notes-item[style*="--note-delay"]').length,
      );
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            __motion: {
              maxAnimations: number;
              names: string[];
              served: number;
              writing: boolean;
              letterWriting: boolean;
              drawing: number;
              delayedNotes: number;
            };
          }
        ).__motion,
    );
}

/** A copy of Turbocode with its own brief: the fake model has no ready answers. */
const freshTurbo = (t: string) =>
  t.replace("brief: >\n  ", `brief: >\n  Prova ${Date.now()}-${Math.random()}. `);

/** Skips the remaining passes, closes the open facts and signs off. */
async function signOff(page: Page) {
  const skip = async (pass: string, next?: string) => {
    await page
      .getByRole("group", { name: `${pass} pass` })
      .getByRole("button", { name: "Skip" })
      .click();
    if (next) await passOpen(page, next);
  };
  await skip("Facts", "Prose");
  await skip("Prose", "Grammar");
  await skip("Grammar");
  await expect(page.getByRole("group", { name: "Review" })).toContainText("Review complete");
  await page.getByRole("tab", { name: /^Facts:/ }).click();
  for (const title of ["No source", "To verify"]) {
    const note = card(page, title);
    if ((await note.getByRole("button", { name: "Ignore" }).count()) > 0)
      await note.getByRole("button", { name: "Ignore" }).click();
  }
  await page.getByRole("button", { name: "Back to the review" }).click();
  await page
    .getByRole("group", { name: "Review" })
    .getByRole("button", { name: "Sign off" })
    .click();
  await expect(page.getByRole("img", { name: /^Signed off on / })).toBeVisible();
}

test.describe("animations", () => {
  test.describe.configure({ mode: "serial" });

  test('card served, "is writing…", letter written, notes and marks one at a time, sign-off with the nib', async ({
    page,
    request,
  }) => {
    // Tests run with "Reduce motion" (playwright.config.ts): not here.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const motion = await recordMotion(page);
    const { path } = await copyTurbo(request, freshTurbo);
    await openApp(page, path);
    // Reopening a draft nothing animates: the animations are for what happens now.
    expect((await motion()).served).toBe(0);

    await startReview(page);
    const letter = page.getByRole("region", { name: "Editor’s letter · structure" });
    await expect(letter).toContainText("Al lead manca il perché");
    let seen = await motion();
    expect(seen.served).toBe(1);
    expect(seen.writing).toBe(true);
    expect(seen.letterWriting).toBe(true);
    expect(seen.names).toContain("write-in");
    // The letter is written line by line: the words of a line after those of the line above.
    const delays = await letter
      .locator(".w")
      .evaluateAll((els) => els.map((e) => parseFloat((e as HTMLElement).style.animationDelay)));
    expect(delays.length).toBeGreaterThan(5);
    expect(delays[delays.length - 1]).toBeGreaterThan(delays[0]!);
    // Once written, no clipping is left on the letter.
    await expect(letter.locator(".letter-text")).not.toHaveAttribute("data-writing", "true", {
      timeout: 5000,
    });

    await finishPass(page, "Facts");
    seen = await motion();
    expect(seen.served).toBe(2);
    expect(seen.drawing).toBeGreaterThan(0);
    expect(seen.delayedNotes).toBeGreaterThan(1);
    expect(seen.names).toEqual(expect.arrayContaining(["mark-draw", "note-in"]));

    // During the animations text and notes are already usable.
    expect(await page.evaluate(() => document.getAnimations().length)).toBeGreaterThan(0);
    await page.locator(".cm-content").focus();
    await page.keyboard.type("Z");
    expect(await docText(page)).toContain("Z");
    await card(page, "No source")
      .getByRole("button", { name: "Ignore" })
      .evaluate((b) => (b as HTMLButtonElement).click());
    await expect(card(page, "No source")).toHaveAttribute("data-status", "ignored");
    // The marks, once drawn, go back to normal: no class that would redraw them at every keystroke.
    await expect(page.locator(".cm-j-draw")).toHaveCount(0, { timeout: 3000 });
    await page.keyboard.press("Meta+z");

    await signOff(page);
    await expect(page.locator('.signature[data-fresh="true"]')).toBeVisible();
    await expect(page.locator('.dry-stamp[data-fresh="true"]')).toBeVisible();
    await expect
      .poll(async () => (await motion()).names)
      .toEqual(expect.arrayContaining(["nib-write", "nib-lift", "stamp-press"]));
    // Short: three seconds after the sign-off everything is still (apart from the blinking cursor).
    await page.waitForTimeout(3000);
    expect(
      await page.evaluate(() =>
        document
          .getAnimations()
          .filter((a) => a.playState === "running")
          .map((a) => (a as CSSAnimation).animationName)
          .filter((n) => n !== "cm-blink" && n !== "cm-blink2"),
      ),
    ).toEqual([]);
  });

  test('with "Reduce motion" no animation runs, and everything appears already still', async ({
    page,
    request,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" }); // as in every test, but stated
    const motion = await recordMotion(page);
    const { path } = await copyTurbo(request, freshTurbo);
    await openApp(page, path);
    await startReview(page);
    await expect(page.getByRole("region", { name: "Editor’s letter · structure" })).toContainText(
      "Al lead manca il perché",
    );
    await finishPass(page, "Facts");
    await expect(page.locator(".cm-j").first()).toBeVisible();
    await signOff(page);
    await expect(page.locator(".dry-stamp")).toBeVisible();
    await expect(page.locator(".nib")).toHaveCSS("opacity", "0");
    await page.waitForTimeout(500);

    const seen = await motion();
    expect(seen.maxAnimations).toBe(0);
    expect(seen.served).toBe(0);
    expect(seen.letterWriting).toBe(false);
  });
});
