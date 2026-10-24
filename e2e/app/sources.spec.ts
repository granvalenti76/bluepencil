import { expect, test, type Page } from "@playwright/test";
import { parseDraft } from "@desk/core";
import {
  card,
  copyTurbo,
  docText,
  finishPass,
  MOD,
  openApp,
  readDisk,
  startReview,
} from "./helpers.ts";

test.use({ viewport: { width: 1440, height: 900 } });

const UNSOURCED = "non garantiscono un loop autonomo completo";

/** Review up to the facts pass (structure is closed as it is). */
async function reviewed(page: Page, path: string) {
  await openApp(page, path);
  await startReview(page);
  await finishPass(page, "Facts");
}

const openCard = (page: Page, title: string) =>
  page.locator('.note[data-status="open"]').filter({ hasText: title });

test.describe("sources", () => {
  // Reviews go through a single queue to the model.
  test.describe.configure({ mode: "serial" });

  test('"Add source": [^1] and definition, then the review no longer flags it', async ({
    page,
    request,
  }) => {
    const { path } = await copyTurbo(request);
    await reviewed(page, path);
    const note = openCard(page, "No source");
    await expect(note).toBeVisible();

    await note.getByRole("button", { name: "Add source" }).click();
    const picker = page.getByTestId(/^sources-/);
    await expect(picker.getByRole("button", { name: /fatti\.md/ })).toBeVisible();
    await expect(picker).toContainText("Fatti di riferimento");
    await picker.getByRole("button", { name: /fatti\.md/ }).click();

    const text = await docText(page);
    expect(text).toContain(`${UNSOURCED}[^1].`);
    expect(text.endsWith("\n\n[^1]: fatti.md\n")).toBe(true);
    await expect(card(page, "No source")).toContainText("Source added: fatti.md");
    await expect.poll(() => readDisk(path), { timeout: 5000 }).toContain("[^1]: fatti.md");

    await page.getByRole("button", { name: "Check again" }).click();
    await expect(page.locator(".review-state")).toContainText("Review finished", {
      timeout: 30_000,
    });
    await expect(openCard(page, "No source")).toHaveCount(0);
    await expect(card(page, "No source")).toContainText("Source added");
  });

  test('"Undo" and Cmd+Z remove reference and definition', async ({ page, request }) => {
    const { path } = await copyTurbo(request);
    await reviewed(page, path);
    const original = await docText(page);
    const note = card(page, "No source");

    await note.getByRole("button", { name: "Add source" }).click();
    await page
      .getByTestId(/^sources-/)
      .getByRole("button", { name: /fatti\.md/ })
      .click();
    await expect(note.getByRole("button", { name: "Undo" })).toBeVisible();
    await note.getByRole("button", { name: "Undo" }).click();
    expect(await docText(page)).toBe(original);
    await expect(note).toHaveAttribute("data-status", "open");

    await note.getByRole("button", { name: "Add source" }).click();
    await page
      .getByTestId(/^sources-/)
      .getByRole("button", { name: /fatti\.md/ })
      .click();
    expect(await docText(page)).not.toBe(original);
    await page.locator(".cm-content").focus();
    await page.keyboard.press(`${MOD}+z`);
    expect(await docText(page)).toBe(original);
    await expect(note).toHaveAttribute("data-status", "open");
  });

  test("a new URL also ends up in `sources`", async ({ page, request }) => {
    const { path } = await copyTurbo(request);
    await reviewed(page, path);
    const note = card(page, "No source");
    await note.getByRole("button", { name: "Add source" }).click();
    await page.getByLabel("URL or source file").fill("https://example.org/loop");
    await page.getByRole("button", { name: "Link" }).click();
    expect(await docText(page)).toContain("[^1]: https://example.org/loop\n");
    await expect
      .poll(async () => parseDraft(await readDisk(path)).data.sources, { timeout: 5000 })
      .toContain("https://example.org/loop");
  });

  test('"Mark as opinion"', async ({ page, request }) => {
    const { path } = await copyTurbo(request);
    await reviewed(page, path);
    const note = card(page, "No source");
    await note.getByRole("button", { name: "Mark as opinion" }).click();
    const text = await docText(page);
    expect(text).toContain(`${UNSOURCED}[^1].`);
    expect(text).toContain("[^1]: Valutazione dell'autore.\n");
    await expect(note).toContainText("Marked as the author’s opinion");
  });

  test('"Compare sources" shows similar passages without touching the text', async ({
    page,
    request,
  }) => {
    const { path } = await copyTurbo(request);
    await reviewed(page, path);
    const original = await docText(page);
    const note = card(page, "To verify");
    await expect(note).toContainText("Qwen3.6-35B-A3B");
    await note.getByRole("button", { name: "Compare sources" }).click();
    const panel = page.getByTestId(/^compare-/);
    await expect(panel).toContainText("fatti.md");
    await expect(panel).toContainText("Qwen3.6-35B-A3B");
    await expect(panel.locator("mark").first()).toHaveText("Qwen3");
    await panel.getByRole("button", { name: "Close" }).click();
    await expect(panel).toHaveCount(0);
    await expect(note).toHaveAttribute("data-status", "open");
    expect(await docText(page)).toBe(original);
  });

  test("search in drafts and sources", async ({ page }) => {
    await openApp(page);
    const search = page.getByLabel("Search drafts and sources");
    await search.fill("quantizzazione");
    const results = page.getByLabel("Search results");
    const hit = results.locator(".search-hit").filter({ hasText: "fatti.md" });
    await expect(hit).toContainText("Source");
    await expect(hit.locator("mark")).toHaveText("quantizzazione");
    await hit.click();
    await expect(page.locator(".cm-content")).toContainText("Fatti di riferimento");
    // Opening a result closes the list: reopen it (⌘O).
    await page.keyboard.press("Meta+o");
    await search.fill("harness");
    await expect(results.locator(".search-hit").first()).toContainText("Draft");
    await expect(page.getByRole("group", { name: "Filter by stage" })).toBeHidden();
    await search.press("Escape");
    await expect(page.locator(".draft-list .search-hit")).toHaveCount(0);
    await expect(page.locator(".draft-card").first()).toBeVisible();
  });
});
