import { expect, test } from "@playwright/test";
import {
  MOD,
  TURBO,
  card,
  docText,
  mark,
  openApp,
  openNotes,
  readDisk,
  saveState,
  seededTurbo,
  view,
} from "./helpers.ts";

test.use({ viewport: { width: 1440, height: 900 } });

const R2 = "con modelli linguistici locali, con opzione di fallback cloud";
const R2_FIX = "su modelli linguistici locali, con fallback cloud opzionale";

test.describe("margin notes", () => {
  test.beforeEach(async ({ page, request }) => {
    const { path } = await seededTurbo(request);
    await openApp(page, path);
    await expect(page.locator(".note").first()).toBeVisible();
  });

  test("the six sample notes, the three verified without a note, the section note", async ({
    page,
  }) => {
    await expect(page.locator(".note")).toHaveCount(7);
    for (const [title, chip] of [
      ["Il lead non dice «perché»", "Structure"],
      ["Affermazione senza fonte", "Facts"],
      ["Sigla da controllare", "Facts"],
      ["Concordanza", "Grammar"],
      ["Avverbio superfluo", "Prose"],
      ["Ripetizione", "Prose"],
    ] as [string, string][]) {
      await expect(card(page, title)).toContainText(chip);
    }
    await expect(card(page, "Ripetizione").getByRole("button", { name: "Applica" })).toBeVisible();
    await expect(card(page, "Ripetizione").getByRole("button", { name: "Ignore" })).toBeVisible();
    await expect(card(page, "Avverbio").getByRole("button", { name: "Elimina" })).toBeVisible();
    await expect(
      card(page, "Il lead").getByRole("button", { name: "Riscrivi lead" }),
    ).toBeVisible();
    await expect(
      card(page, "senza fonte").getByRole("button", { name: "Aggiungi fonte" }),
    ).toBeVisible();
    await expect(card(page, "Sigla").getByRole("button", { name: "Confronta" })).toBeVisible();
    await expect(card(page, "Ripetizione")).toContainText("ravvicinati");

    await expect(openNotes(page)).toHaveAccessibleName("Review (7 open)");

    // underlines: 8 (the verified facts, without a note, are the green ones); structure has none
    for (const t of ["per macOS", "tra i 100 e i 150 MB di RAM", "contesto di 100k token"]) {
      await expect(mark(page, t).first()).toHaveClass(/cm-j-fact-ok/);
    }
    await expect(mark(page, "non garantiscono un loop autonomo completo").first()).toHaveClass(
      /cm-j-fact\b/,
    );
    await expect(mark(page, "si può integrare").first()).toHaveClass(/cm-j-grammar/);
    await expect(mark(page, "completamente").first()).toHaveClass(/cm-j-prose/);

    // The section note, without a precise spot in the text, is at the bottom of the panel.
    const section = card(page, "Sezione «Chiusura» mancante");
    await expect(section.getByRole("button", { name: "Propose a draft" })).toBeVisible();
  });

  test("notes panel: in text order, on the right edge, with its own scrolling", async ({
    page,
  }) => {
    const titles = await page.locator(".notes-list .note-title").allTextContents();
    expect(titles).toEqual([
      "Il lead non dice «perché»",
      "Ripetizione",
      "Avverbio superfluo",
      "Sigla da controllare",
      "Affermazione senza fonte",
      "Concordanza",
      "Sezione «Chiusura» mancante",
    ]);
    // In Review the notes are to the right of the page.
    const panel = (await page.locator("#editor-card").boundingBox())!;
    const sheet = (await page.locator(".editor-col").boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(sheet.x + sheet.width);
    // Scrolling the text does not move the notes (and vice versa).
    const before = (await card(page, "Avverbio").boundingBox())!.y;
    await page.locator(".cm-scroller").evaluate((el) => (el.scrollTop = 200));
    await page.waitForTimeout(100);
    expect((await card(page, "Avverbio").boundingBox())!.y).toBe(before);
    const list = page.locator(".notes-list");
    expect(await list.evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
  });

  test("a click on a note takes the text to its quote", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 600 });
    const target = mark(page, "si può integrare").first();
    await card(page, "Concordanza").locator(".note-text").click();
    await expect
      .poll(async () => {
        const box = await target.boundingBox();
        const sc = (await page.locator(".cm-scroller").boundingBox())!;
        return box !== null && box.y > sc.y && box.y < sc.y + sc.height;
      })
      .toBe(true);
    // A click on the note's buttons does not: they do their own action.
    await expect(card(page, "Concordanza")).toHaveAttribute("data-status", "open");
  });

  test("Apply «Ripetizione»: changes the text and the words, the note collapses, Undo restores", async ({
    page,
  }) => {
    const status = page.locator(".reading-time");
    await expect(status).toContainText("812 words");
    const original = await docText(page);

    await card(page, "Ripetizione").getByRole("button", { name: "Applica" }).click();
    expect(await docText(page)).toContain(R2_FIX);
    expect(await docText(page)).not.toContain(R2);
    await expect(status).toContainText("811 words");
    await expect(openNotes(page)).toHaveAccessibleName("Review (6 open)");
    await expect(mark(page, R2_FIX)).toHaveCount(0);

    const done = card(page, "Ripetizione");
    await expect(done).toHaveAttribute("data-status", "applied");
    await expect(done).toContainText("Correction applied");
    await expect(done.getByRole("button", { name: "Ignore" })).toHaveCount(0);
    // the structure note on the lead, which contains the changed text, stays open
    await expect(card(page, "Il lead")).toHaveAttribute("data-status", "open");

    await done.getByRole("button", { name: "Undo" }).click();
    expect(await docText(page)).toBe(original);
    await expect(status).toContainText("812 words");
    await expect(openNotes(page)).toHaveAccessibleName("Review (7 open)");
    await expect(card(page, "Ripetizione")).toHaveAttribute("data-status", "open");
    await expect(mark(page, R2).first()).toHaveClass(/cm-j-prose/);
  });

  test("Cmd+Z also undoes the note's state", async ({ page }) => {
    const original = await docText(page);
    await card(page, "Concordanza").getByRole("button", { name: "Applica" }).click();
    expect(await docText(page)).toContain("si possono integrare modelli");
    await page.locator(".cm-content").focus();
    await page.keyboard.press(`${MOD}+z`);
    expect(await docText(page)).toBe(original);
    await expect(card(page, "Concordanza")).toHaveAttribute("data-status", "open");
    await expect(mark(page, "si può integrare").first()).toHaveClass(/cm-j-grammar/);
    await expect(openNotes(page)).toHaveAccessibleName("Review (7 open)");
  });

  test("Cmd+Z on «Ripetizione» (inside the lead) does not make the structure note stale", async ({
    page,
  }) => {
    await card(page, "Ripetizione").getByRole("button", { name: "Applica" }).click();
    await expect(card(page, "Il lead")).toHaveAttribute("data-status", "open");
    await page.locator(".cm-content").focus();
    await page.keyboard.press(`${MOD}+z`);
    expect(await docText(page)).toContain(R2);
    await expect(card(page, "Ripetizione")).toHaveAttribute("data-status", "open");
    await expect(card(page, "Il lead")).toHaveAttribute("data-status", "open");
    await expect(openNotes(page)).toHaveAccessibleName("Review (7 open)");
    await page.keyboard.press(`${MOD}+Shift+z`); // Redo
    expect(await docText(page)).toContain(R2_FIX);
    await expect(card(page, "Ripetizione")).toHaveAttribute("data-status", "applied");
    await expect(card(page, "Il lead")).toHaveAttribute("data-status", "open");
  });

  test("deleting «completamente» leaves no double spaces", async ({ page }) => {
    await card(page, "Avverbio").getByRole("button", { name: "Elimina" }).click();
    const text = await docText(page);
    expect(text).toContain("È un harness scritto in Swift");
    expect(text).not.toContain("harness  scritto");
    await expect(card(page, "Avverbio")).toContainText("Text removed");
    await card(page, "Avverbio").getByRole("button", { name: "Undo" }).click();
    expect(await docText(page)).toContain("È un harness completamente scritto in Swift");
  });

  test('Ignore shows "Ignored" and "Undo"', async ({ page }) => {
    await card(page, "Concordanza").getByRole("button", { name: "Ignore" }).click();
    const c = card(page, "Concordanza");
    await expect(c).toHaveAttribute("data-status", "ignored");
    await expect(c).toContainText("Ignored");
    await expect(mark(page, "si può integrare")).toHaveCount(0);
    await expect(openNotes(page)).toHaveAccessibleName("Review (6 open)");
    expect(await docText(page)).toContain("si può integrare");

    await c.getByRole("button", { name: "Undo" }).click();
    await expect(c).toHaveAttribute("data-status", "open");
    await expect(mark(page, "si può integrare").first()).toBeVisible();
    await expect(openNotes(page)).toHaveAccessibleName("Review (7 open)");
  });

  test('"Add source" and "Compare" open a panel and do not touch the text', async ({ page }) => {
    const original = await docText(page);
    const source = card(page, "senza fonte");
    await source.getByRole("button", { name: "Aggiungi fonte" }).click();
    await expect(source.getByTestId(/^sources-/)).toContainText("fatti.md");
    await expect(source).toHaveAttribute("data-status", "open");
    await card(page, "Sigla").getByRole("button", { name: "Confronta" }).click();
    await expect(card(page, "Sigla").getByTestId(/^compare-/)).toContainText("Qwen3.6-35B-A3B");
    expect(await docText(page)).toBe(original); // the model never writes by itself
  });

  test('"Rewrite lead": a proposal below the note, in the text only with "Insert"', async ({
    page,
  }) => {
    const original = await docText(page);
    const lead = card(page, "Il lead");
    await lead.getByRole("button", { name: "Riscrivi lead" }).click();
    const box = lead.getByTestId(/^proposal-/);
    await expect(box).toContainText("Turbocode 0.6 porta il loop agentico");
    expect(await docText(page)).toBe(original);

    // "Discard" touches nothing
    await box.getByRole("button", { name: "Discard" }).click();
    await expect(box).toHaveCount(0);
    expect(await docText(page)).toBe(original);

    await lead.getByRole("button", { name: "Riscrivi lead" }).click();
    await lead.getByRole("button", { name: "Insert" }).click();
    await expect(lead).toContainText("Suggestion inserted");
    const text = await docText(page);
    expect(text).toContain("# Turbocode V0.6\n\nTurbocode 0.6 porta il loop agentico");
    expect(text).not.toContain("agent harness locale per macOS");
    expect(text).toContain("## Cosa è Turbocode"); // the other sections stay

    await lead.getByRole("button", { name: "Undo" }).click();
    await expect(lead).toHaveAttribute("data-status", "open");
    expect(await docText(page)).toBe(original);
  });

  test("before the pass-by-pass review all notes are visible, without filters", async ({
    page,
  }) => {
    await expect(page.getByRole("group", { name: "Show" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Review passes" })).toHaveCount(0);
    await expect(page.locator(".note")).toHaveCount(7);
    for (const title of ["Ripetizione", "Concordanza", "Il lead", "senza fonte"]) {
      await expect(card(page, title)).toBeVisible();
    }
    await expect(mark(page, "completamente").first()).toBeVisible();
    await expect(mark(page, "per macOS").first()).toBeVisible();
  });

  test('section note: "Propose a draft" and Undo', async ({ page }) => {
    const section = card(page, "Sezione «Chiusura» mancante");
    const original = await docText(page);
    await section.getByRole("button", { name: "Propose a draft" }).click();
    await expect(section.getByTestId(/^proposal-/)).toContainText("La 0.6 è disponibile da oggi");
    expect(await docText(page)).toBe(original);
    await section.getByRole("button", { name: "Insert" }).click();
    await expect(section).toContainText("Suggestion inserted");
    // The missing section goes in at the end with its marker: now it is mapped.
    expect(await docText(page)).toBe(
      `${original.trimEnd()}\n\n<!-- section: closing -->\nLa 0.6 è disponibile da oggi. Chi usa già Turbocode la riceve con il prossimo aggiornamento.\n`,
    );
    // The outline lives in Write.
    await page.getByRole("button", { name: "Write", exact: true }).click();
    await expect(page.locator(".section-card").filter({ hasText: "Chiusura" })).toContainText(
      "16 / 50",
    );
    await expect(openNotes(page)).toHaveAccessibleName("Review (6 open)");
    await openNotes(page).click();
    await section.getByRole("button", { name: "Undo" }).click();
    await expect(section.getByRole("button", { name: "Propose a draft" })).toBeVisible();
    expect(await docText(page)).toBe(original);
  });

  test('the section note is at the bottom of the panel, "On the whole text"', async ({ page }) => {
    // Before the panel is complete the measurements mean nothing.
    await expect(page.locator(".notes-section")).toHaveText("On the whole text");
    await expect(card(page, "Sezione «Chiusura» mancante")).toBeVisible();
    const heading = (await page.locator(".notes-section").boundingBox())!;
    const note = (await card(page, "Sezione «Chiusura» mancante").boundingBox())!;
    expect(note.y).toBeGreaterThan(heading.y);
  });

  test("a click on an underline highlights its note (and the panel scrolls to it)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 500 });
    await page.locator(".notes-list").evaluate((el) => (el.scrollTop = el.scrollHeight));
    await mark(page, "completamente").first().click();
    await expect(card(page, "Avverbio")).toBeInViewport();
    await expect(card(page, "Avverbio")).toHaveAttribute("data-flash", "true");
    await expect(card(page, "Avverbio")).toHaveAttribute("data-flash", "false", { timeout: 4000 });
  });

  test("hovering the note highlights the text", async ({ page }) => {
    await card(page, "Avverbio").hover();
    await expect(mark(page, "completamente").first()).toHaveClass(/cm-j-active/);
    await page.mouse.move(5, 5);
    await expect(mark(page, "completamente").first()).not.toHaveClass(/cm-j-active/);
  });

  test("from the keyboard: Enter applies, Esc ignores (only with focus on the note)", async ({
    page,
  }) => {
    await card(page, "Concordanza").focus();
    await page.keyboard.press("Enter");
    expect(await docText(page)).toContain("si possono integrare");
    await card(page, "Avverbio").focus();
    await page.keyboard.press("Escape");
    await expect(card(page, "Avverbio")).toHaveAttribute("data-status", "ignored");

    // with focus on a button, Esc does not ignore the note
    await card(page, "Ripetizione").getByRole("button", { name: "Applica" }).focus();
    await page.keyboard.press("Escape");
    await expect(card(page, "Ripetizione")).toHaveAttribute("data-status", "open");
  });
});

test.describe("persistent and stale states", () => {
  test("reloading the page the states stay", async ({ page, request }) => {
    const { path } = await seededTurbo(request);
    await openApp(page, path);
    await card(page, "Ripetizione").getByRole("button", { name: "Applica" }).click();
    await card(page, "Concordanza").getByRole("button", { name: "Ignore" }).click();
    await page.getByRole("button", { name: "Propose a draft" }).click();
    await page.getByRole("button", { name: "Insert" }).click();
    await expect(saveState(page)).toHaveAttribute("aria-label", "Saved", { timeout: 4000 });

    await page.reload();
    await expect(page.locator(".note").first()).toBeVisible();
    await expect(card(page, "Ripetizione")).toHaveAttribute("data-status", "applied");
    await expect(card(page, "Ripetizione")).toContainText("Correction applied");
    await expect(card(page, "Concordanza")).toHaveAttribute("data-status", "ignored");
    await expect(card(page, "Concordanza")).toContainText("Ignored");
    await expect(card(page, "Sezione «Chiusura» mancante")).toContainText("Suggestion inserted");
    await page.locator(".cm-scroller").evaluate((el) => (el.scrollTop = 0));
    await expect(openNotes(page)).toHaveAccessibleName("Review (4 open)");
    expect(await docText(page)).toContain(R2_FIX);
    await expect(mark(page, "si può integrare")).toHaveCount(0);
    await expect(mark(page, "completamente").first()).toHaveClass(/cm-j-prose/);

    // it can still be undone after the reload
    await card(page, "Ripetizione").getByRole("button", { name: "Undo" }).click();
    expect(await docText(page)).toContain(R2);
    await expect(openNotes(page)).toHaveAccessibleName("Review (5 open)");
  });

  test('"Apply" never saved to disk: after the reload the note is open again', async ({
    page,
    request,
  }) => {
    const { path } = await seededTurbo(request);
    await openApp(page, path);
    await card(page, "Concordanza").getByRole("button", { name: "Applica" }).click();
    await expect(card(page, "Concordanza")).toHaveAttribute("data-status", "applied");
    await page.waitForTimeout(150); // the state request goes at once; the text is saved after 800 ms
    expect(await readDisk(path)).toContain("si può integrare");

    await page.reload();
    await expect(card(page, "Concordanza")).toHaveAttribute("data-status", "open");
    expect(await docText(page)).toContain("si può integrare");
  });

  test("typing inside a range makes the note stale; before and after do not", async ({
    page,
    request,
  }) => {
    const { path } = await seededTurbo(request);
    await openApp(page, path);
    await expect(page.locator(".note")).toHaveCount(7);

    // inside «si può integrare»
    await view(page, (v) => {
      const from = v.state.doc.toString().indexOf("si può integrare") + 5;
      v.dispatch({ selection: { anchor: from } });
    });
    await page.locator(".cm-content").focus();
    await page.keyboard.type("X");
    await expect(card(page, "Concordanza")).toHaveCount(0);
    await expect(mark(page, "integrare")).toHaveCount(0);
    await expect(page.locator(".note")).toHaveCount(6);
    await expect(openNotes(page)).toHaveAccessibleName("Review (6 open)");

    // right before and right after «completamente»: the note stays
    await view(page, (v) => {
      const t = v.state.doc.toString();
      const from = t.indexOf("completamente");
      v.dispatch({
        changes: { from: from + "completamente".length, insert: "," },
        userEvent: "input.type",
      });
      v.dispatch({ changes: { from, insert: "molto " }, userEvent: "input.type" });
    });
    await expect(card(page, "Avverbio")).toHaveAttribute("data-status", "open");
    await expect(mark(page, "completamente").first()).toBeVisible();

    // persists: after saving and reloading the stale note does not come back
    await expect(saveState(page)).toHaveAttribute("aria-label", "Saved", { timeout: 4000 });
    await page.reload();
    await expect(page.locator(".note").first()).toBeVisible();
    await expect(card(page, "Concordanza")).toHaveCount(0);
    await expect(card(page, "Avverbio")).toBeVisible();
    await expect(mark(page, "completamente").first()).toBeVisible();
  });

  test("an external change that shifts the text: the notes follow the quotes", async ({
    page,
    request,
  }) => {
    const { path } = await seededTurbo(request);
    await openApp(page, path);
    await expect(page.locator(".note")).toHaveCount(7);

    const text = await readDisk(path);
    const { writeFile } = await import("node:fs/promises");
    const { diskPath } = await import("./helpers.ts");
    await writeFile(
      diskPath(path),
      text.replace("# Turbocode V0.6\n", "# Turbocode V0.6\n\nUn sottotitolo arrivato da fuori.\n"),
    );

    await expect(page.locator(".cm-content")).toContainText("Un sottotitolo arrivato da fuori.", {
      timeout: 4000,
    });
    await expect(page.locator(".note")).toHaveCount(7);
    await expect(mark(page, "completamente").first()).toHaveClass(/cm-j-prose/);
    expect(await mark(page, "si può integrare").first().textContent()).toBe("si può integrare");
  });
});

test("the original draft has the sample judgments (visual reference)", async ({ page }, info) => {
  await openApp(page, TURBO);
  await expect(page.locator(".note")).toHaveCount(7);
  await expect(openNotes(page)).toHaveAccessibleName("Review (7 open)");
  if (process.env.UPDATE_SCREENSHOTS) {
    const file = info.project.name === "webkit" ? "m5.png" : `m5-${info.project.name}.png`;
    await page.waitForTimeout(300);
    await page.screenshot({ path: `docs/screens/${file}` });
  }
});

test("screen reader: the notes are a list, the passes are tabs on the card", async ({
  page,
  request,
}) => {
  const { path } = await seededTurbo(request);
  await openApp(page, path);
  await expect(page.getByRole("list", { name: "Notes" }).getByRole("listitem")).toHaveCount(6);
  await expect(
    page.getByRole("list", { name: "On the whole text" }).getByRole("listitem"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Start review" }).click();
  const tabs = page.getByRole("tablist", { name: "Review passes" });
  await expect(tabs.getByRole("tab")).toHaveCount(5);
  await expect(tabs.getByRole("tab", { selected: true })).toHaveAccessibleName(/^Structure:/);
  await expect(page.getByRole("tabpanel")).toHaveAttribute("id", "editor-card");
});
