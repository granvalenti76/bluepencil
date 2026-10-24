import { expect, test } from "@playwright/test";
import { parseDraft } from "@desk/core";
import {
  card,
  copyTurbo,
  docText,
  finishPass,
  fullReview,
  MOD,
  openApp,
  passButton,
  passOpen,
  readDisk,
  seededTurbo,
  startReview,
  view,
} from "./helpers.ts";

test.use({ viewport: { width: 1440, height: 900 } });

/** The page and the pencil. */
test.describe("pencil marks on the page", () => {
  test("same numbers in the text and in the margin; each leads to the other", async ({
    page,
    request,
  }) => {
    const { path } = await seededTurbo(request);
    await openApp(page, path);
    const marks = page.locator(".cm-jn[data-jn]");
    await expect(marks.first()).toBeVisible();
    const pairs = await marks.evaluateAll((els) =>
      els.map((e) => [(e as HTMLElement).dataset.jn!, (e as HTMLElement).dataset.n!]),
    );
    expect(pairs.length).toBeGreaterThanOrEqual(4);
    for (const [id, n] of pairs) {
      await expect(page.getByTestId(`margin-card-${id}`).locator(".note-number")).toHaveText(n!);
    }
    // One number per note. (In the text they sit at the end of the passage: two notes ending at the
    // same spot, or one inside the other, may appear in a different order from the start.)
    const numbers = pairs.map(([, n]) => n);
    expect(new Set(numbers).size).toBe(numbers.length);

    // From the number in the text to the note…
    const [id] = pairs[2]!;
    await page.locator(`.cm-jn[data-jn="${id}"]`).click();
    await expect(page.getByTestId(`margin-card-${id}`)).toHaveAttribute("data-flash", "true");
    // …and from the note to the text: the missing part, at the end of the page.
    const missing = page.locator(".cm-missing");
    await card(page, "Sezione «Chiusura» mancante").locator(".note-title").click();
    await expect(missing).toBeInViewport();
    await expect(missing).toContainText("Chiusura goes here");
  });

  test("grammar marks do not change the text until accepted", async ({ page, request }) => {
    const { path } = await seededTurbo(request);
    await openApp(page, path);
    await expect(page.locator(".cm-proof-del")).toHaveText("può");
    await expect(page.locator(".cm-proof-ins")).toHaveAttribute("data-ins", "possono");
    const text = await docText(page);
    expect(text).toContain("si può integrare");
    expect(text).not.toContain("si possono integrare");

    await card(page, "Concordanza").getByRole("button", { name: "Applica" }).click();
    expect(await docText(page)).toContain("si possono integrare");
    await expect(page.locator(".cm-proof-del")).toHaveCount(0);
  });

  test('"Add empty section": the heading of the missing part, no text from the model', async ({
    page,
    request,
  }) => {
    const { path } = await seededTurbo(request);
    await openApp(page, path);
    const original = await docText(page);
    const note = card(page, "Sezione «Chiusura» mancante");
    await expect(note.getByRole("button", { name: "Propose a draft" })).toBeVisible();
    await note.getByRole("button", { name: "Add empty section" }).click();
    expect(await docText(page)).toBe(`${original.trimEnd()}\n\n<!-- section: closing -->\n\n`);
    await expect(note).toContainText("Empty section added");
    await expect(page.locator(".cm-missing")).toHaveCount(0);
    await note.getByRole("button", { name: "Undo" }).click();
    expect(await docText(page)).toBe(original);
    await expect(note).toHaveAttribute("data-status", "open");
  });
});

test("in a pass, the notes of the later ones are faint dots", async ({ page, request }) => {
  const { path } = await seededTurbo(request);
  await openApp(page, path);
  await expect(page.locator(".cm-j-waiting")).toHaveCount(0);
  await startReview(page);
  // Structure: the facts, prose and grammar marks are not visible, but you know they are there.
  await expect(page.locator(".cm-proof-del")).toHaveCount(0);
  await expect(page.locator(".cm-j-waiting").first()).toBeVisible();
  expect(await page.locator(".cm-j-waiting").count()).toBeGreaterThanOrEqual(4);
});

test.describe('"Accept all" in the grammar pass', () => {
  test.describe.configure({ mode: "serial" });

  test("all corrections in one change; a single ⌘Z undoes them and the notes reopen", async ({
    page,
    request,
  }) => {
    // A second error the fake model recognises (fixture «perchè»), and a unique brief for the cache.
    const { path } = await copyTurbo(request, (t) =>
      t
        .replace(
          "si può integrare modelli cloud.",
          "si può integrare modelli cloud, perchè servono.",
        )
        .replace("brief: >\n  ", `brief: >\n  Prova ${Date.now()}-${Math.random()}. `),
    );
    await openApp(page, path);
    await startReview(page);
    // Structure notes without a change say who does what.
    await expect(card(page, "Il lead non dice")).toContainText("I’ll rework it");
    await finishPass(page, "Facts");
    await finishPass(page, "Prose");
    await finishPass(page, "Grammar");
    const original = await docText(page);
    await expect(page.locator(".note")).toHaveCount(2);

    const head = page.getByRole("group", { name: "Grammar pass" });
    await head.getByRole("button", { name: "Accept all 2" }).click();
    const text = await docText(page);
    expect(text).toContain("si possono integrare modelli cloud, perché servono.");
    await expect(page.locator('.note[data-status="applied"]')).toHaveCount(2);

    await page.locator(".cm-content").focus();
    await page.keyboard.press(`${MOD}+z`);
    expect(await docText(page)).toBe(original);
    await expect(page.locator('.note[data-status="open"]')).toHaveCount(2);
  });
});

test.describe("the editor's letter", () => {
  test.describe.configure({ mode: "serial" });

  test('one per pass, at the top of the margin, with the score; "Out of date" when the text changes', async ({
    page,
    request,
  }) => {
    const { path } = await copyTurbo(request, (t) =>
      t.replace("brief: >\n  ", `brief: >\n  Prova ${Date.now()}-${Math.random()}. `),
    );
    await openApp(page, path);
    await startReview(page);
    const structure = page.getByRole("region", { name: "Editor’s letter · structure" });
    await expect(structure).toContainText("Al lead manca il perché");
    await expect(structure.locator(".letter-score")).toHaveText("72");
    await expect(structure).toContainText("Whole text · read at");

    await finishPass(page, "Facts");
    const facts = page.getByRole("region", { name: "Editor’s letter · facts" });
    await expect(facts).toContainText("I numeri portano il pezzo");
    // Facts have no score.
    await expect(facts.locator(".letter-score")).toHaveCount(0);

    await view(page, (v) =>
      v.dispatch({ changes: { from: v.state.doc.length, insert: " Fine." } }),
    );
    await expect(facts).toContainText("Out of date");
    await expect(facts).toHaveAttribute("data-stale", "true");
  });
});

test("authorship: an accepted suggestion lowers the figure, ⌘Z restores it, it survives a reload", async ({
  page,
  request,
}) => {
  const { path } = await seededTurbo(request);
  await openApp(page, path);
  const share = page.getByRole("button", { name: /Written by you/ });
  await expect(share).toHaveText("By you · 100%");

  await card(page, "Ripetizione").getByRole("button", { name: "Applica" }).click();
  await expect(share).not.toHaveText("By you · 100%");
  await share.click();
  await expect(page.locator(".cm-authored")).toContainText("fallback cloud opzionale");

  await page.locator(".cm-content").focus();
  await page.keyboard.press(`${MOD}+z`);
  await expect(share).toHaveText("By you · 100%");
  await expect(page.locator(".cm-authored")).toHaveCount(0);

  await card(page, "Ripetizione").getByRole("button", { name: "Applica" }).click();
  const after = await share.textContent();
  expect(after).not.toBe("By you · 100%");
  await expect(page.locator(".save-dot")).toHaveAttribute("aria-label", "Saved", {
    timeout: 4000,
  });
  await page.waitForTimeout(800); // the authorship file is written shortly after
  await page.reload();
  await page.locator(".cm-content").waitFor();
  await expect(share).toHaveText(after!);
});

test.describe("the sign-off", () => {
  test.describe.configure({ mode: "serial" });

  test("open facts block it; once signed, stamp and summary; changing the text, it must be given again", async ({
    page,
    request,
  }) => {
    const { path } = await copyTurbo(request, (t) =>
      t.replace("brief: >\n  ", `brief: >\n  Prova ${Date.now()}-${Math.random()}. `),
    );
    await openApp(page, path);
    await startReview(page);
    const skip = async (pass: string, next?: string) => {
      await page
        .getByRole("group", { name: `${pass} pass` })
        .getByRole("button", { name: "Skip" })
        .click();
      if (next) await passOpen(page, next);
    };
    await skip("Structure", "Facts");
    await skip("Facts", "Prose");
    await skip("Prose", "Grammar");
    await skip("Grammar");

    const review = page.getByRole("group", { name: "Review" });
    await expect(review).toContainText("Review complete");
    await expect(review.getByRole("button", { name: "Sign off" })).toBeDisabled();

    // The claims still open are closed (here: ignored), then the sign-off can be given.
    await passButton(page, "Facts").click();
    for (const title of ["No source", "To verify"]) {
      await card(page, title).getByRole("button", { name: "Ignore" }).click();
    }
    await page.getByRole("button", { name: "Back to the review" }).click();
    await review.getByRole("button", { name: "Sign off" }).click();

    const signed = page.getByRole("region", { name: "Signed off" });
    await expect(signed.getByRole("img", { name: /^Signed off on / })).toBeVisible();
    await expect(signed).toContainText("written by you");
    await expect
      .poll(async () => parseDraft(await readDisk(path)).data.signoff?.body)
      .toMatch(/^[0-9a-f]{12}$/);

    await signed.getByRole("button", { name: "Publish…" }).click();
    await expect(page.getByRole("dialog")).not.toContainText("Not signed off");
    await page.keyboard.press("Escape");

    await view(page, (v) =>
      v.dispatch({ changes: { from: v.state.doc.length, insert: " Fine." } }),
    );
    await expect(review).toContainText("signed off on an earlier version");
    await expect(review.getByRole("button", { name: "Sign off again" })).toBeEnabled();
  });
});

test("habits: in the prose pass, how many times they come back here and across drafts", async ({
  page,
  request,
}) => {
  const { path } = await copyTurbo(request, (t) =>
    t.replace("brief: >\n  ", `brief: >\n  Prova ${Date.now()}-${Math.random()}. `),
  );
  await openApp(page, path);
  await fullReview(page);
  await expect(page.getByRole("region", { name: "Your habits" })).toHaveCount(0);
  await passButton(page, "Prose").click();
  const habits = page.getByRole("region", { name: "Your habits" });
  await expect(habits).toContainText("Intensifying adverbs");
  await expect(habits).toContainText(/\d+ in \d+ drafts/);
});
