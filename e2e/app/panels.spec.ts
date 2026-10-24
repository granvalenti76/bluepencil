import { expect, test } from "@playwright/test";
import {
  card,
  docText,
  mark,
  openApp,
  openDrafts,
  openNotes,
  seededTurbo,
  view,
} from "./helpers.ts";

test.use({ viewport: { width: 1440, height: 900 } });

// Progressive disclosure: collapsible panels, note type filter in a menu, Markdown preview.
test.describe("panels and preview", () => {
  test.beforeEach(async ({ page, request }) => {
    const { path } = await seededTurbo(request);
    await openApp(page, path);
    await page.locator(".note").first().waitFor();
  });

  test("Write / Review: the choice survives a reload", async ({ page }) => {
    const write = page.getByRole("button", { name: "Write", exact: true });
    await expect(openNotes(page)).toHaveAttribute("aria-pressed", "true");
    await write.click();
    await expect(write).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".notes-panel")).toHaveCount(0);
    await page.reload();
    await page.locator(".cm-content").waitFor();
    await expect(page.getByRole("button", { name: "Write", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.keyboard.press("Control+Meta+n");
    await expect(page.locator(".note").first()).toBeVisible();
  });

  test("in Write the notes are hidden (the underlines stay); a click on the text switches to Review", async ({
    page,
  }) => {
    await expect(openNotes(page)).toHaveAccessibleName("Review (7 open)");
    await page.getByRole("button", { name: "Write", exact: true }).click();
    await expect(page.locator(".note")).toHaveCount(0);
    await expect(mark(page, "completamente").first()).toBeVisible();
    await expect(page.locator(".outline-card")).toBeVisible();

    await mark(page, "completamente").first().click();
    await expect(card(page, "Avverbio")).toBeVisible();
    await expect(openNotes(page)).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Control+Meta+n");
    await expect(page.locator(".note")).toHaveCount(0);
  });

  test("preview: the text as the reader reads it; in Review the notes stay with their numbers", async ({
    page,
  }) => {
    await view(page, (v) =>
      v.dispatch({
        changes: {
          from: v.state.doc.length,
          insert:
            "\n\nUn **grassetto**, un [link](https://example.org) e <b>html</b>[^9].\n\n[^9]: fatti.md\n",
        },
      }),
    );
    const text = await docText(page);
    await page.getByRole("button", { name: "View", exact: true }).click();
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await page.keyboard.press("Escape");
    const preview = page.getByRole("article", { name: "Preview" });
    await expect(preview.locator("h1")).toHaveText("Turbocode V0.6");
    await expect(preview.locator("h2").first()).toHaveText("Cosa è Turbocode");
    await expect(preview).not.toContainText("section:");
    await expect(preview).not.toContainText("##");
    await expect(preview.locator("strong")).toHaveText("grassetto");
    await expect(preview.locator('a[href="https://example.org"]')).toHaveText("link");
    // The draft's HTML shows as text, it is not executed.
    await expect(preview.locator("b")).toHaveCount(0);
    await expect(preview).toContainText("<b>html</b>");
    await expect(preview.locator(".fn-ref")).toHaveText("1");
    await expect(preview.locator(".footnotes li")).toHaveText("fatti.md");
    // In Review the panel stays alongside and the notes stay attached to the text with their numbers.
    await expect(page.locator(".note").first()).toBeVisible();
    const refs = await preview.locator(".note-ref").allTextContents();
    expect(refs.length).toBeGreaterThanOrEqual(5);
    const numbers = await page.locator(".notes-list .note-number").allTextContents();
    for (const n of refs) expect(numbers).toContain(n);
    // The preview does not touch the document.
    expect(await docText(page)).toBe(text);

    // In Write no numbers or formatting tools while reading.
    await page.getByRole("button", { name: "Write", exact: true }).click();
    await expect(preview.locator(".note-ref")).toHaveCount(0);
    await expect(
      page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Bold" }),
    ).toBeDisabled();

    await page.keyboard.press("Shift+Meta+p");
    await expect(preview).toHaveCount(0);
    await expect(page.locator(".cm-content")).toBeVisible();
    expect(await docText(page)).toBe(text);
  });

  test('"Show in Finder" asks the server for the open draft', async ({ page }) => {
    await openDrafts(page);
    const button = page.getByRole("button", { name: "Show in Finder" });
    await expect(button).toHaveAttribute("data-tip", /Show the draft in Finder \(.+\)/);
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith("/api/reveal") && r.method() === "POST"),
      button.click(),
    ]);
    const path = new URL(page.url()).searchParams.get("d");
    expect(req.postDataJSON()).toEqual({ path });
    expect((await req.response())!.status()).toBe(204);
  });

  test("resolved notes with long titles: the panel does not widen over the editor", async ({
    page,
  }) => {
    // Prose notes have a whole sentence as their title: here the longest possible.
    const long =
      "L'inserimento di un commento personale e informale rompe completamente il tono professionale e distoglie l'attenzione dal contenuto del testo";
    const panel = page.locator("#editor-card");
    const width = async () => (await panel.boundingBox())!.width;
    const before = await width();
    await page.route("**/judgments", async (route) => {
      const res = await route.fetch();
      const json = (await res.json()) as { judgments: { title: string }[] };
      for (const j of json.judgments) j.title = `${j.title}: ${long}`;
      await route.fulfill({ json });
    });
    await page.reload();
    await card(page, "Avverbio").getByRole("button", { name: "Ignore" }).click();
    await expect(card(page, "Avverbio")).toHaveAttribute("data-status", "ignored");
    expect(await width()).toBeLessThanOrEqual(before + 1);
    expect(await width()).toBeLessThanOrEqual(442);
    // The editor keeps its 620 px measure.
    expect((await page.locator(".cm-content").boundingBox())!.width).toBe(620);
  });

  test("notes: title on a full line, actions below", async ({ page }) => {
    const c = card(page, "Avverbio");
    const title = (await c.locator(".note-title").boundingBox())!;
    const primary = (await c.getByRole("button", { name: "Elimina" }).boundingBox())!;
    expect(primary.y).toBeGreaterThan(title.y + title.height);
  });
});
