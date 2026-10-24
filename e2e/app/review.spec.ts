import { expect, test, type APIRequestContext } from "@playwright/test";
import { parseDraft } from "@desk/core";
import {
  card,
  copyTurbo,
  docText,
  finishPass,
  mark,
  openApp,
  passButton,
  passOpen,
  readDisk,
  startReview,
} from "./helpers.ts";

test.use({ viewport: { width: 1440, height: 900 } });

/** The cache is by content: a unique brief avoids the results of the other browser, which runs the same tests. */
const uniqueTurbo = (request: APIRequestContext) =>
  copyTurbo(request, (t) =>
    t.replace("brief: >\n  ", `brief: >\n  Prova ${Date.now()}-${Math.random()}. `),
  );

test.describe("pass-by-pass review", () => {
  // The server sends one request at a time to the model: in parallel the reviews would queue up.
  test.describe.configure({ mode: "serial" });

  test("one pass at a time, top to bottom; the later ones wait; the state persists", async ({
    page,
    request,
  }) => {
    const { path } = await uniqueTurbo(request);
    await openApp(page, path);
    await expect(page.locator(".note")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Review passes" })).toHaveCount(0);
    const original = await docText(page);

    // Structure: only its notes and its underlines; the other passes wait.
    await page.getByRole("button", { name: "Start review" }).click();
    await expect(page.getByRole("button", { name: /^Cancel review/ })).toBeVisible();
    await passOpen(page, "Structure");
    await expect(page.locator(".doctitle .stage-current")).toHaveText("Review");
    expect(parseDraft(await readDisk(path)).data.stage).toBe("review");
    await expect(passButton(page, "Structure")).toHaveAttribute("aria-current", "step");
    for (const name of ["Facts", "Prose", "Grammar"]) {
      await expect(passButton(page, name)).toHaveAccessibleName(`${name}: waiting`);
      await expect(passButton(page, name)).toBeDisabled();
    }
    await expect(card(page, "Il lead non dice «perché»")).toContainText("Structure");
    await expect(card(page, "Sezione «Chiusura» mancante")).toBeVisible();
    await expect(page.locator(".note")).toHaveCount(2);
    await expect(mark(page, "completamente")).toHaveCount(0);

    // "Finish pass": the open notes stay, and facts start by themselves.
    await finishPass(page, "Facts");
    await expect(passButton(page, "Structure")).toHaveAccessibleName("Structure: done");
    await expect(passButton(page, "Facts")).toHaveAttribute("aria-current", "step");
    await expect(card(page, "No source")).toContainText("Facts");
    await expect(card(page, "To verify")).toBeVisible();
    await expect(card(page, "Il lead non dice")).toHaveCount(0);
    await expect(mark(page, "contesto di 100k token").first()).toHaveClass(/cm-j-fact-ok/);

    // "Skip" skips facts; then prose and grammar, in order.
    await page
      .getByRole("group", { name: "Facts pass" })
      .getByRole("button", { name: "Skip" })
      .click();
    await passOpen(page, "Prose");
    await expect(passButton(page, "Facts")).toHaveAccessibleName("Facts: skipped");
    await expect(card(page, "Avverbio superfluo")).toContainText("Prose");
    await expect(passButton(page, "Grammar")).toHaveAccessibleName("Grammar: waiting");

    await finishPass(page, "Grammar");
    await expect(card(page, "si può integrare → si possono integrare")).toContainText("Grammar");
    await expect(page.locator(".note")).toHaveCount(1);

    // The last one: review finished, all the notes still open are visible.
    await page
      .getByRole("group", { name: "Grammar pass" })
      .getByRole("button", { name: "Finish pass" })
      .click();
    const complete = page.getByRole("group", { name: "Review" });
    await expect(complete).toContainText("Review complete");
    await expect(complete).toContainText("left open");
    await expect(card(page, "Il lead non dice «perché»")).toBeVisible();
    await expect(card(page, "Avverbio superfluo")).toBeVisible();
    await expect(page.getByRole("button", { name: "Review again" })).toBeVisible();

    // The passes' state lives on the server: a reload finds it again.
    await page.reload();
    await page.locator(".cm-content").waitFor();
    await expect(passButton(page, "Structure")).toHaveAccessibleName("Structure: done");
    await expect(passButton(page, "Facts")).toHaveAccessibleName("Facts: skipped");
    await expect(passButton(page, "Prose")).toHaveAccessibleName("Prose: done");
    await expect(passButton(page, "Grammar")).toHaveAccessibleName("Grammar: done");
    // The model has not touched the text (only `stage` in the front matter changes).
    expect(parseDraft(await docText(page)).body).toBe(parseDraft(original).body);
  });

  test('"Check again" with the text unchanged: from the cache, no duplicate notes', async ({
    page,
    request,
  }) => {
    const { path } = await uniqueTurbo(request);
    await openApp(page, path);
    await startReview(page);
    await expect(page.locator(".note")).toHaveCount(2);
    await page.getByRole("button", { name: "Check again" }).click();
    await expect(page.locator(".review-state")).toContainText("Review finished in 1 s", {
      timeout: 5000,
    });
    await expect(page.locator(".note")).toHaveCount(2);
  });

  test("a closed pass can be viewed and reopened", async ({ page, request }) => {
    const { path } = await uniqueTurbo(request);
    await openApp(page, path);
    await startReview(page);
    await finishPass(page, "Facts");

    await passButton(page, "Structure").click();
    const head = page.getByRole("group", { name: "Structure pass" });
    await expect(head).toContainText("done");
    await expect(card(page, "Il lead non dice «perché»")).toBeVisible();
    await expect(card(page, "No source")).toHaveCount(0);
    await head.getByRole("button", { name: "Back to Facts" }).click();
    await expect(card(page, "No source")).toBeVisible();

    await passButton(page, "Structure").click();
    await head.getByRole("button", { name: "Reopen" }).click();
    await passOpen(page, "Structure");
    await expect(passButton(page, "Structure")).toHaveAttribute("aria-current", "step");
    await expect(passButton(page, "Facts")).toHaveAccessibleName(/^Facts: \d+ open$/);
  });

  test('"Cancel review" stops it', async ({ page, request }) => {
    const { path } = await uniqueTurbo(request);
    await openApp(page, path);
    await page.getByRole("button", { name: "Start review" }).click();
    const running = page.getByRole("button", { name: /^Cancel review/ });
    await expect(running).toBeEnabled();
    await running.click();
    await expect(page.locator(".review-state")).toHaveText("Review cancelled", {
      timeout: 2000,
    });
    // No pass computed: start over.
    await expect(page.getByRole("button", { name: "Start review" })).toBeVisible();
  });

  test('"Add to glossary" writes the acronym into the front matter and ignores the note', async ({
    page,
    request,
  }) => {
    const { path } = await copyTurbo(request, (t) => t.replace("  - Qwen3.6-35B-3B\n", ""));
    await openApp(page, path);
    await startReview(page);
    await finishPass(page, "Facts");
    const sigla = card(page, "To verify");
    await sigla.getByRole("button", { name: "Add to glossary" }).click();
    await expect(sigla).toHaveAttribute("data-status", "ignored");
    await expect
      .poll(async () => parseDraft(await readDisk(path)).data.glossary)
      .toContain("Qwen3.6-35B-3B");
    // The body has not changed.
    expect(parseDraft(await readDisk(path)).body).toBe(parseDraft(await docText(page)).body);
  });
});
