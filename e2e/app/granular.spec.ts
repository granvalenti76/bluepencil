import { expect, test, type Page } from "@playwright/test";
import {
  card,
  copyTurbo,
  docText,
  fullReview,
  MOD,
  openApp,
  openReadability,
  passButton,
  startReview,
  view,
} from "./helpers.ts";

test.use({ viewport: { width: 1440, height: 900 } });

/** A copy with a unique brief: the cache is by content, and the other browser runs the same tests. */
const uniqueTurbo = (request: Parameters<typeof copyTurbo>[0]) =>
  copyTurbo(request, (t) =>
    t.replace("brief: >\n  ", `brief: >\n  Prova ${Date.now()}-${Math.random()}. `),
  );

/** Selects `text` in the editor (first occurrence) and opens the "Ask" box. */
async function selectAndOpen(page: Page, text: string) {
  await view(
    page,
    (v, q) => {
      const i = v.state.doc.toString().indexOf(q);
      v.focus();
      v.dispatch({ selection: { anchor: i, head: i + q.length } });
    },
    text,
  );
  // "Ask" next to the selection opens the editor's box below the paragraph.
  await page.getByRole("button", { name: "Ask the editor about the selection" }).click();
  await expect(askBox(page)).toBeVisible();
}

const askBox = (page: Page) => page.getByRole("region", { name: "Ask the editor" });

/** End of a check on a selection (the pass-by-pass review does not start). */
const finished = (page: Page) =>
  expect(page.locator(".review-state")).toContainText("Review finished", { timeout: 30_000 });

test.describe("granular review, selection, reading", () => {
  // The server sends one request at a time to the model: in parallel the tests would queue up.
  test.describe.configure({ mode: "serial" });

  test('"Full review" from the menu: all passes at once, then they are looked at one at a time', async ({
    page,
    request,
  }) => {
    const { path } = await uniqueTurbo(request);
    await openApp(page, path);
    await page.getByRole("button", { name: "Choose what to review" }).click();
    const items = page.getByRole("menu", { name: "What to review" }).getByRole("menuitem");
    await expect(items).toHaveText([/^Full review/]);
    await page.keyboard.press("Escape");

    await fullReview(page);
    // It still starts from structure; the others are already computed and can be looked at.
    await expect(passButton(page, "Structure")).toHaveAttribute("aria-current", "step");
    await expect(card(page, "Il lead non dice «perché»")).toBeVisible();
    await expect(card(page, "si può integrare → si possono integrare")).toHaveCount(0);
    await passButton(page, "Grammar").click();
    await expect(card(page, "si può integrare → si possono integrare")).toContainText("Grammar");
    await expect(page.locator(".note")).toHaveCount(1);

    // Once the review has started the menu also offers to start again.
    await page.getByRole("button", { name: "Choose what to review" }).click();
    await expect(items).toHaveText([/^Full review/, /^Restart review/]);
  });

  test('selection → "Check grammar": notes only in the passage', async ({ page, request }) => {
    const { path } = await uniqueTurbo(request);
    await openApp(page, path);
    await selectAndOpen(page, "Per lavori più complessi si può integrare modelli cloud.");
    await askBox(page).getByRole("button", { name: "Check grammar" }).click();
    await finished(page);
    await expect(card(page, "si può integrare")).toBeVisible();
    await expect(page.locator(".note")).toHaveCount(1);
  });

  test('selection → "Rephrase · Concise": proposals, "Use this", Cmd+Z and "Undo"', async ({
    page,
    request,
  }) => {
    const { path } = await uniqueTurbo(request);
    await openApp(page, path);
    const original = await docText(page);
    const passage = "È un harness completamente scritto in Swift";
    await selectAndOpen(page, passage);
    await expect(askBox(page).locator(".ask-btn")).toHaveText([
      "Concise",
      "Clearer",
      "Smoother",
      "Creative",
      "Check facts",
      "Check grammar",
      "Judge the prose",
    ]);
    await askBox(page).getByRole("button", { name: "Concise" }).click();

    const rewrite = page.getByLabel("Rephrasing");
    await expect(rewrite.locator(".rewrite-original")).toHaveText(passage);
    await expect(rewrite.locator(".rewrite-text")).toHaveText([
      "È un harness scritto in Swift",
      `In breve: ${passage}`,
    ]);
    // The model only proposed: the text has not changed.
    expect(await docText(page)).toBe(original);

    await rewrite.getByRole("button", { name: "Use this" }).first().click();
    await expect(rewrite).toContainText("Rephrasing applied");
    expect(await docText(page)).toBe(original.replace(passage, "È un harness scritto in Swift"));

    // Cmd+Z right after: the author's text comes back, and the card goes back to the proposals.
    await page.keyboard.press(`${MOD}+z`);
    expect(await docText(page)).toBe(original);
    await expect(rewrite.getByRole("button", { name: "Use this" })).toHaveCount(2);

    // "Undo" on the card too.
    await rewrite.getByRole("button", { name: "Use this" }).last().click();
    expect(await docText(page)).toBe(original.replace(passage, `In breve: ${passage}`));
    await rewrite.getByRole("button", { name: "Undo" }).click();
    expect(await docText(page)).toBe(original);

    await rewrite.getByRole("button", { name: "Close" }).click();
    await expect(rewrite).toHaveCount(0);
  });

  test("reading: time and clarity at once, prose and structure after the review", async ({
    page,
    request,
  }) => {
    const { path } = await uniqueTurbo(request);
    await openApp(page, path);
    const reading = page.getByRole("region", { name: "Readability" });
    await expect(reading).toContainText(" min · ");
    // Outside the prose pass the indices are closed.
    await expect(page.getByTestId("score-clarity")).toHaveCount(0);
    await openReadability(page);
    await expect(page.getByTestId("score-clarity").locator(".reading-value")).toHaveText(/^\d+$/);
    await expect(page.getByTestId("score-prose")).toContainText("not checked");

    await fullReview(page);
    await openReadability(page);
    await expect(page.getByTestId("score-prose").locator(".reading-value")).toHaveText("64");
    await expect(page.getByTestId("score-structure").locator(".reading-value")).toHaveText("72");
    await expect(page.getByTestId("score-prose")).toContainText("by the model");

    // The text changes: the scores stay but are outdated.
    await view(page, (v) =>
      v.dispatch({ changes: { from: v.state.doc.length, insert: " Fine." } }),
    );
    await expect(page.getByTestId("score-prose")).toContainText("out of date");
    await expect(page.getByTestId("score-structure")).toHaveAttribute("data-stale", "true");
  });
});

test.describe("right-hand panel: clearing the suggestions, hover tooltips", () => {
  test.describe.configure({ mode: "serial" });

  test('"Clear suggestions" asks for confirmation, removes notes and underlines, the text stays', async ({
    page,
    request,
  }) => {
    const { path } = await uniqueTurbo(request);
    await openApp(page, path);
    await startReview(page);
    await expect(page.locator(".note").first()).toBeVisible();
    const original = await docText(page);

    await page.getByRole("button", { name: "Clear suggestions" }).click();
    // A confirmation first: "No" leaves everything as it was.
    await page.getByRole("button", { name: "No", exact: true }).click();
    await expect(page.locator(".note").first()).toBeVisible();

    await page.getByRole("button", { name: "Clear suggestions" }).click();
    await page.getByRole("button", { name: "Clear all" }).click();
    await expect(page.locator(".note")).toHaveCount(0);
    await expect(page.locator(".cm-j")).toHaveCount(0);
    expect(await docText(page)).toBe(original);
    // The review starts again from structure.
    await expect(page.getByRole("navigation", { name: "Review passes" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start review" })).toBeVisible();
    // After a reload too: the notes are deleted on the server.
    await page.reload();
    await page.locator(".cm-content").waitFor();
    await expect(page.locator(".note")).toHaveCount(0);
  });

  test("resting on an icon shows a tooltip that says what it does", async ({ page }) => {
    await openApp(page, "turbocode-draft-12-settembre.md");
    await page.getByRole("button", { name: "View", exact: true }).hover();
    await expect(page.getByRole("tooltip")).toHaveText("View: preview, focus, handwriting, sounds");
    await page.mouse.move(600, 500);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    // From the keyboard too, with focus (Safari does not Tab to buttons: use the keyboard, then
    // focus).
    await page.keyboard.press("Shift");
    await page.getByRole("button", { name: "Drafts", exact: true }).focus();
    await expect(page.getByRole("tooltip")).toHaveText("All drafts · ⌘O");
  });
});
