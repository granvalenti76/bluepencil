import { expect, test } from "@playwright/test";
import { E2E_WEB_PORT } from "../env.ts";
import { TURBO, copyTurbo, openApp, openDrafts, openNotes, view } from "./helpers.ts";

test.use({ viewport: { width: 1440, height: 900 } });

test.describe("shell (1440×900, Turbocode draft)", () => {
  test.beforeEach(async ({ page }) => openApp(page, TURBO, { mode: "write" }));

  test("layout and sizes", async ({ page }, info) => {
    const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;

    // Top bar 52 + 1, thin status bar 28 + 1; no fixed column: the drafts list opens over the
    // desk.
    expect((await box(".toolbar")).height).toBe(53);
    expect((await box(".statusbar")).height).toBe(29);
    await expect(page.locator(".sidebar")).toHaveCount(0);

    // Write / Review in the centre of the bar.
    const mode = await box(".mode-switch");
    expect(Math.abs(mode.x + mode.width / 2 - 720)).toBeLessThanOrEqual(1);

    // Write: the outline on an index card to the left of the page; the page at a fixed 620 px
    // measure with the line numbers to the left of the text.
    const outline = await box(".outline-card");
    const col = await box(".editor-col");
    const content = await box(".cm-content");
    expect(content.width).toBe(620);
    expect(outline.x + outline.width).toBeLessThan(col.x);
    const number = await box(".cm-vln");
    expect(number.x + number.width).toBeLessThanOrEqual(content.x - 20);
    expect(number.x).toBeGreaterThanOrEqual(col.x);

    // Review: the page on the left, the notes on the right.
    await page.getByRole("button", { name: /^Review/ }).click();
    await expect(page.locator(".outline-card")).toHaveCount(0);
    const notes = await box(".notes-panel");
    const sheet = await box(".editor-col");
    expect(notes.x).toBeGreaterThanOrEqual(sheet.x + sheet.width);
    expect((await box(".cm-content")).width).toBe(620);

    // no requests to the outside
    const hosts = new Set<string>();
    page.on("request", (r) => hosts.add(new URL(r.url()).host));
    await page.reload();
    await page.locator(".cm-content").waitFor();
    expect([...hosts]).toEqual([`127.0.0.1:${E2E_WEB_PORT}`]);

    if (process.env.UPDATE_SCREENSHOTS) {
      const file = info.project.name === "webkit" ? "m4.png" : `m4-${info.project.name}.png`;
      await page.screenshot({ path: `docs/screens/${file}` });
    }
  });

  test("drafts list and outline: drafts, phase, progress and sections", async ({ page }) => {
    await openDrafts(page);
    const cards = page.locator(".draft-card");
    const turbo = page.locator(`.draft-card[data-path="${TURBO}"]`);
    await expect(turbo).toContainText("Article");
    await expect(turbo).toContainText("Writing");
    await expect(turbo).toContainText("812/900");
    await expect(turbo).toHaveAttribute("aria-current", "true");
    await expect(cards.filter({ hasText: "Modelli locali su Mac" })).toContainText("Report");
    await expect(cards.filter({ hasText: "Making of" })).toContainText("752/700");
    await expect(cards.filter({ hasText: "Guida: installare Turbocode" })).toContainText("new");
    // fatti.md is a source (no front matter): not a draft
    await expect(page.locator(".draft-list")).not.toContainText("Fatti di riferimento");
    await expect(page.locator(".draft-list")).not.toContainText("fatti.md");
    await page.keyboard.press("Escape");
    await expect(page.locator(".drafts-layer")).toHaveCount(0);

    await expect(page.locator(".outline-title")).toHaveText("Article · outline");
    const sec = (name: string) => page.locator(".section-card").filter({ hasText: name });
    await expect(sec("Lead")).toContainText("19 / 70");
    await expect(sec("Lead")).toContainText("in progress");
    await expect(sec("Contesto")).toContainText("29 / 130");
    await expect(sec("Sviluppo")).toContainText("762 / 650");
    await expect(sec("Sviluppo")).toContainText("over target");
    await expect(sec("Chiusura")).toContainText("0 / 50");
    await expect(sec("Chiusura")).toContainText("to write");
  });

  test("the drafts list opens with ⌘O and from the title, closes with Esc, outside or by choosing", async ({
    page,
  }) => {
    const layer = page.locator(".drafts-layer");
    await page.keyboard.press("Meta+o");
    await expect(layer).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(layer).toHaveCount(0);
    await page.getByRole("button", { name: "Drafts", exact: true }).click();
    await expect(layer).toBeVisible();
    await page.mouse.click(900, 600);
    await expect(layer).toHaveCount(0);
    await openDrafts(page);
    await page.locator(".draft-card").filter({ hasText: "Making of" }).click();
    await expect(layer).toHaveCount(0);
    await expect(page.locator(".doctitle")).toContainText("Making of");
  });

  test("title, phase and reading: at the top and in the Review panel", async ({ page }) => {
    const title = page.locator(".doctitle");
    await expect(title).toContainText("Turbocode V0.6");
    await expect(title).toContainText("News article");
    await expect(title.locator(".stage-current")).toHaveText("Writing");
    await expect(page.locator(".save-dot")).toHaveAttribute("aria-label", "Saved");
    await expect(openNotes(page)).toHaveAccessibleName("Review (7 open)");
    await openNotes(page).click();
    await expect(page.locator(".reading-time")).toHaveText("4 min · 812 words");
  });

  test("a click on a section takes the cursor to its start", async ({ page }) => {
    const line = () => view(page, (v) => v.state.doc.lineAt(v.state.selection.main.head).text);
    await page.locator(".section-card").filter({ hasText: "Contesto" }).click();
    expect(await line()).toBe("## Cosa è Turbocode");
    await page.locator(".section-card").filter({ hasText: "Sviluppo" }).click();
    expect(await line()).toMatch(/^<!-- section: development -->In una sessione tipica/);
    await expect(page.locator(".section-card").filter({ hasText: "Chiusura" })).toBeDisabled();
    expect(await view(page, (v) => v.hasFocus)).toBe(true);
  });

  test("phase filters", async ({ page }) => {
    await openDrafts(page);
    await page.getByRole("button", { name: "Structure", exact: true }).first().click();
    const stages = await page.locator(".draft-card .draft-stage").allTextContents();
    expect(stages.length).toBeGreaterThanOrEqual(2);
    expect(new Set(stages)).toEqual(new Set(["Structure"]));
    // Drafts in review exist only if other tests created them: check the filter.
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await expect(
      page.locator(".draft-card .draft-stage", { hasText: /Struttura|Scrittura/ }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "All" }).click();
    await expect(page.locator(".draft-card").first()).toBeVisible();
  });

  test("from Write to Review and back: cursor and scroll stay", async ({ page }) => {
    const p = await view(page, (v) => v.state.doc.toString().indexOf("Il loop agentico") + 12);
    await view(page, (v, pos) => v.dispatch({ selection: { anchor: pos } }), p);
    await page.locator(".cm-scroller").evaluate((el) => (el.scrollTop = 420));
    const where = () =>
      view(page, (v) => ({
        head: v.state.selection.main.head,
        scroll: Math.round(v.scrollDOM.scrollTop),
      }));
    const before = await where();
    expect(before.scroll).toBe(420);
    for (const name of [/^Review/, /^Write$/, /^Review/, /^Write$/]) {
      await page.getByRole("button", { name }).click();
      await page.waitForTimeout(50);
      expect(await where()).toEqual(before);
    }
    // with the keyboard too (⌃⌘N)
    await page.keyboard.press("Control+Meta+n");
    await expect(openNotes(page)).toHaveAttribute("aria-pressed", "true");
    expect(await where()).toEqual(before);
  });

  test("focus: tools and outline go away, bars dimmed, Esc to leave", async ({ page }) => {
    await page.getByRole("button", { name: "View", exact: true }).click();
    await page.getByRole("button", { name: "Focus" }).click();
    await page.keyboard.press("Escape"); // closes the menu
    await expect(page.getByRole("toolbar", { name: "Formatting" })).toHaveCount(0);
    await expect(page.locator(".outline-card")).toHaveCount(0);
    await page.mouse.move(720, 600);
    await expect(page.locator(".shell > .toolbar")).toHaveCSS("opacity", "0.55");
    await expect(page.locator(".shell > .statusbar")).toHaveCSS("opacity", "0.55");
    await page.locator(".cm-content").click();
    await page.keyboard.press("Escape");
    await expect(page.locator(".outline-card")).toBeVisible();
    await expect(page.locator(".shell > .toolbar")).toHaveCSS("opacity", "1");
  });

  test("without a token the warning appears", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await expect(page.getByText("The access token is missing")).toBeVisible();
  });

  test("the token is removed from the address", async ({ page }) => {
    expect(page.url()).not.toContain("#t=");
    expect(page.url()).toContain("?d=");
  });

  test("focus and Hemingway (View menu) are toggles with aria-pressed", async ({ page }) => {
    await page.getByRole("button", { name: "View", exact: true }).click();
    for (const name of ["Focus", "Hemingway"]) {
      const b = page.getByRole("button", { name });
      await expect(b).toHaveAttribute("aria-pressed", "false");
      await b.click();
      await expect(b).toHaveAttribute("aria-pressed", "true");
    }
  });
});

test("with no open draft you are invited to choose one", async ({ page }) => {
  await openApp(page);
  await expect(page.getByText("Pick a draft from the list")).toBeVisible();
  await expect(page.locator(".draft-card").first()).toBeVisible();
});

test("a draft that does not exist shows an error", async ({ page }) => {
  await openApp(page);
  await page.goto("/?d=non-esiste.md");
  await expect(page.getByText("The draft no longer exists")).toBeVisible();
});

test('"+ New" creates a draft and opens it in Write; structure is optional', async ({ page }) => {
  await openApp(page, undefined, { mode: "write" });
  const title = `Nuova ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await page.getByRole("button", { name: "+ New" }).click();
  const dialog = page.getByRole("dialog", { name: "New draft" });
  await expect(dialog.getByRole("button", { name: "Create draft" })).toBeDisabled();
  await expect(dialog.getByLabel("Plan the sections first")).not.toBeChecked();
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Type of text").selectOption("report");
  await dialog.getByRole("button", { name: "Create draft" }).click();

  await expect(dialog).toBeHidden();
  // Without structure you start writing at once.
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(page.locator(".doctitle")).toContainText("Report");
  await openDrafts(page);
  const card = page.locator(".draft-card").filter({ hasText: title });
  await expect(card).toHaveAttribute("aria-current", "true");
  await expect(card).toContainText("Report");
  await expect(card).toContainText("new");
  await page.keyboard.press("Escape");
  expect(new URL(page.url()).searchParams.get("d")).toMatch(/\.md$/);

  // Structure can be asked for later, from the outline, and left without choosing one.
  await page
    .getByRole("navigation", { name: "Outline" })
    .getByRole("button", { name: "Plan the sections" })
    .click();
  await expect(page.getByTestId("structure")).toBeVisible();
  await expect(page.locator(".doctitle .stage-current")).toHaveText("Structure");
  await expect(page.getByRole("button", { name: /^Report/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Write without one" }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(page.getByTestId("structure")).toBeHidden();
});

test('the "New draft" window closes with Esc and with Cancel', async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "+ New" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "+ New" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("the toolbar stays on one line down to 1200 px (no wrapped or overflowing buttons)", async ({
  page,
}) => {
  for (const width of [1200, 1280, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await openApp(page, TURBO);
    const m = await page.locator(".toolbar").evaluate((el) => {
      const kids = [...el.children].map((c) => c.getBoundingClientRect());
      return {
        overflow: el.scrollWidth - el.clientWidth,
        maxHeight: Math.max(...kids.map((k) => k.height)),
        right: Math.max(...kids.map((k) => k.right)),
        edge: el.getBoundingClientRect().right,
      };
    });
    expect(m.overflow, `larghezza ${width}`).toBe(0);
    expect(m.maxHeight, `larghezza ${width}`).toBeLessThanOrEqual(34);
    expect(m.right, `larghezza ${width}`).toBeLessThanOrEqual(m.edge);
  }
});

test("the evaluation hides no note type", async ({ page }) => {
  await page.route("**/api/eval", (route) =>
    route.fulfill({
      json: {
        report: {
          model: "prova",
          date: "2026-10-03",
          partial: false,
          passes: [{ pass: "prose", precision: 0.5, recall: 0.6, enabled: false }],
        },
      },
    }),
  );
  await openApp(page, TURBO);
  // One note per type: none is hidden.
  for (const title of ["Il lead", "senza fonte", "Concordanza", "Ripetizione"]) {
    await expect(page.locator(".note").filter({ hasText: title })).toBeVisible();
  }
});

test("the pass tabs all fit on the card down to 1200 px", async ({ page }) => {
  // Simulated pass state: the full row, without calling the model.
  const at = "2026-10-22T00:00:00Z";
  await page.route("**/api/passes/**", (route) =>
    route.fulfill({
      json: {
        passes: [
          { pass: "structure", state: "done", bodyHash: "h", words: 812, updatedAt: at },
          { pass: "facts", state: "skipped", bodyHash: "h", words: 812, updatedAt: at },
          { pass: "prose", state: "open", bodyHash: "h", words: 812, updatedAt: at },
        ],
      },
    }),
  );
  for (const width of [1200, 1280, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await openApp(page, TURBO);
    // In Review the passes are the tabs of the editor's card.
    const tabs = page.getByRole("tablist", { name: "Review passes" });
    await expect(tabs.getByRole("tab")).toHaveCount(5);
    const m = await page.locator(".pass-tabs").evaluate((el) => {
      const box = el.getBoundingClientRect();
      const kids = [...el.children].map((c) => c.getBoundingClientRect());
      return {
        overflow: 0,
        maxHeight: Math.max(...kids.map((k) => k.height)),
        right: Math.max(...kids.map((k) => k.right)),
        edge: box.right,
        clipped: kids.filter((k) => k.left < box.left - 0.5 || k.right > box.right + 0.5).length,
      };
    });
    expect(m.overflow, `larghezza ${width}`).toBe(0);
    expect(m.maxHeight, `larghezza ${width}`).toBeLessThanOrEqual(34);
    expect(m.right, `larghezza ${width}`).toBeLessThanOrEqual(m.edge);
    expect(m.clipped, `passaggi tagliati a ${width}`).toBe(0);
  }
});

test("the desk holds down to 1200 px, in Write and in Review", async ({ page }) => {
  for (const mode of ["write", "review"] as const) {
    for (const width of [1200, 1280, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await openApp(page, TURBO, { mode });
      const m = await page.locator(".desk").evaluate((el) => {
        const boxes = [...el.children].map((c) => c.getBoundingClientRect());
        const overlaps = boxes.some((a, i) =>
          boxes.some((b, j) => j > i && a.right > b.left + 0.5),
        );
        return { overflow: el.scrollWidth - el.clientWidth, overlaps };
      });
      expect(m.overflow, `${mode} a ${width}`).toBe(0);
      expect(m.overlaps, `${mode} a ${width}`).toBe(false);
      // The page keeps its measure.
      expect((await page.locator(".cm-content").boundingBox())!.width, `${mode} a ${width}`).toBe(
        620,
      );
    }
  }
});

test('"Start review" leads to Review, where the passes and notes are visible', async ({
  page,
  request,
}) => {
  // A copy: the review changes the draft's phase.
  const { path } = await copyTurbo(request);
  await openApp(page, path, { mode: "write" });
  await page.getByRole("button", { name: "Start review" }).click();
  await expect(openNotes(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".notes-panel")).toBeVisible();
});
