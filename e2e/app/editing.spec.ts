import { expect, test } from "@playwright/test";
import {
  MOD,
  appendDisk,
  createDraft,
  docText,
  getDraft,
  openApp,
  openDrafts,
  readDisk,
  view,
  format,
  saveState,
} from "./helpers.ts";

test.describe("live counts", () => {
  test("words, reading time and sections update while typing", async ({ page, request }) => {
    const d = await createDraft(request);
    await openApp(page, d.path);
    const reading = page.locator(".reading-time");
    await expect(reading).toContainText("words");
    const before = Number(/(\d+) words/.exec((await reading.textContent())!)![1]);

    await page.locator(".cm-content").click();
    await page.keyboard.press(`${MOD}+End`);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("una due tre quattro cinque");

    await expect(reading).toContainText(`${before + 5} words`);
    await openDrafts(page);
    await expect(page.locator(".draft-card[aria-current=true]")).toContainText("new");
  });
});

test.describe("autosave", () => {
  test("800 ms after the last change the file on disk changes", async ({ page, request }) => {
    const d = await createDraft(request);
    await openApp(page, d.path);
    await page.locator(".cm-content").click();
    await page.keyboard.press(`${MOD}+End`);
    await page.keyboard.type("\n\nTesto salvato da solo.");

    await expect(saveState(page)).toHaveAttribute("aria-label", "Unsaved changes");
    expect(await readDisk(d.path)).not.toContain("Testo salvato da solo.");
    await expect(saveState(page)).toHaveAttribute("aria-label", "Saved", { timeout: 4000 });

    const onDisk = await readDisk(d.path);
    expect(onDisk).toContain("Testo salvato da solo.");
    // the front matter stays as it was
    expect(onDisk.split("\n---\n")[0]).toBe(d.text.split("\n---\n")[0]);
    expect((await getDraft(request, d.path)).body).toContain("Testo salvato da solo.");
    // the list updates
    await openDrafts(page);
    await expect(page.locator(".draft-card[aria-current=true]")).toContainText("new");
  });

  test("Cmd+S saves at once", async ({ page, request }) => {
    const d = await createDraft(request);
    await openApp(page, d.path);
    await page.locator(".cm-content").click();
    await page.keyboard.press(`${MOD}+End`);
    await page.keyboard.type("\n\nSubito.");
    await page.keyboard.press(`${MOD}+s`);
    await expect(saveState(page)).toHaveAttribute("aria-label", "Saved", { timeout: 600 });
    expect(await readDisk(d.path)).toContain("Subito.");
  });

  test("reloading the page the saved text is still there", async ({ page, request }) => {
    const d = await createDraft(request);
    await openApp(page, d.path);
    await page.locator(".cm-content").click();
    await page.keyboard.press(`${MOD}+End`);
    await page.keyboard.type("\n\nPersistente.");
    await page.keyboard.press(`${MOD}+s`);
    await expect(saveState(page)).toHaveAttribute("aria-label", "Saved");
    await page.reload();
    await expect(page.locator(".cm-content")).toContainText("Persistente.");
  });
});

test.describe("external changes to the file", () => {
  test("without local changes: reloads silently and keeps the cursor", async ({
    page,
    request,
  }) => {
    const d = await createDraft(request);
    await openApp(page, d.path);
    await page.locator(".cm-content").click();
    await page.keyboard.press(`${MOD}+End`);
    const head = await view(page, (v) => v.state.selection.main.head);

    await appendDisk(d.path, "\nParagrafo arrivato da fuori.\n");
    await expect(page.locator(".cm-content")).toContainText("Paragrafo arrivato da fuori.", {
      timeout: 3000,
    });
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(await view(page, (v) => v.state.selection.main.head)).toBe(head);
    await expect(saveState(page)).toHaveAttribute("aria-label", "Saved");
  });

  test('with unsaved changes the banner appears; "Reload" discards mine', async ({
    page,
    request,
  }) => {
    const d = await createDraft(request);
    await openApp(page, d.path);
    await page.locator(".cm-content").click();
    await page.keyboard.press(`${MOD}+End`);
    await page.keyboard.type("\n\nMia modifica.");
    await appendDisk(d.path, "\nModifica esterna.\n");

    const banner = page.getByRole("alert");
    await expect(banner).toContainText("The file changed on disk", { timeout: 4000 });
    await expect(saveState(page)).toHaveAttribute("aria-label", "Conflicts with the file on disk");
    // until the conflict is resolved nothing is overwritten
    await page.waitForTimeout(1200);
    expect(await readDisk(d.path)).not.toContain("Mia modifica.");

    await banner.getByRole("button", { name: "Reload" }).click();
    await expect(banner).toHaveCount(0);
    await expect(page.locator(".cm-content")).toContainText("Modifica esterna.");
    expect(await docText(page)).not.toContain("Mia modifica.");
    await expect(saveState(page)).toHaveAttribute("aria-label", "Saved");
  });

  test('"Keep my version" saves mine and replaces the one on disk', async ({ page, request }) => {
    const d = await createDraft(request);
    await openApp(page, d.path);
    await page.locator(".cm-content").click();
    await page.keyboard.press(`${MOD}+End`);
    await page.keyboard.type("\n\nMia modifica.");
    await appendDisk(d.path, "\nModifica esterna.\n");

    const banner = page.getByRole("alert");
    await expect(banner).toBeVisible({ timeout: 4000 });
    await banner.getByRole("button", { name: "Keep my version" }).click();
    await expect(banner).toHaveCount(0);
    await expect(saveState(page)).toHaveAttribute("aria-label", "Saved");
    const onDisk = await readDisk(d.path);
    expect(onDisk).toContain("Mia modifica.");
    expect(onDisk).not.toContain("Modifica esterna.");
  });
});

test.describe("formatting", () => {
  async function setup(
    page: import("@playwright/test").Page,
    request: import("@playwright/test").APIRequestContext,
  ) {
    const d = await createDraft(request);
    // Formatting lives in the Write bar.
    await openApp(page, d.path, { mode: "write" });
    await page.locator(".cm-content").click();
    await page.keyboard.press(`${MOD}+End`);
    await page.keyboard.type("\n\nparola");
    return d;
  }
  const select = (page: import("@playwright/test").Page, n: number) =>
    view(
      page,
      (v, k) => {
        const head = v.state.selection.main.head;
        v.dispatch({ selection: { anchor: head - k, head } });
      },
      n,
    );

  test("bold and italic with the buttons, undoable with Cmd+Z", async ({ page, request }) => {
    await setup(page, request);
    await select(page, 6);
    await format(page, "Bold");
    expect(await docText(page)).toContain("\n\n**parola**");
    await format(page, "Bold");
    expect(await docText(page)).toContain("\n\nparola");
    expect(await docText(page)).not.toContain("**");

    await format(page, "Italic");
    expect(await docText(page)).toContain("*parola*");
    await page.keyboard.press(`${MOD}+z`);
    expect(await docText(page)).not.toContain("*parola*");
  });

  test("Cmd+B, Cmd+I and Cmd+K shortcuts", async ({ page, request }) => {
    await setup(page, request);
    await select(page, 6);
    await page.keyboard.press(`${MOD}+b`);
    expect(await docText(page)).toContain("**parola**");
    await page.keyboard.press(`${MOD}+z`);
    await page.keyboard.press(`${MOD}+i`);
    expect(await docText(page)).toContain("*parola*");
    await page.keyboard.press(`${MOD}+z`);
    // ⌘K opens the address field.
    await page.keyboard.press(`${MOD}+k`);
    const address = page.getByLabel("Link address");
    await expect(address).toBeFocused();
    await address.fill("https://example.org");
    await address.press("Enter");
    expect(await docText(page)).toContain("[parola](https://example.org)");
    // the cursor goes back into the text, after the link
    expect(
      await view(page, (v) =>
        v.state.sliceDoc(v.state.selection.main.head - 1, v.state.selection.main.head),
      ),
    ).toBe(")");
  });

  test("heading, quote and list", async ({ page, request }) => {
    await setup(page, request);
    await format(page, "Heading");
    expect(await docText(page)).toContain("\n\n## parola");
    await format(page, "Heading");
    expect(await docText(page)).toContain("\n\nparola");

    await format(page, "Quote");
    expect(await docText(page)).toContain("\n\n> parola");
    await format(page, "Quote");
    expect(await docText(page)).not.toContain("> parola");

    await format(page, "List");
    expect(await docText(page)).toContain("\n\n- parola");
    await page.keyboard.press(`${MOD}+z`);
    expect(await docText(page)).not.toContain("- parola");
  });

  test("formatting is saved like any change", async ({ page, request }) => {
    const d = await setup(page, request);
    await select(page, 6);
    await format(page, "Bold");
    await expect(saveState(page)).toHaveAttribute("aria-label", "Saved", { timeout: 4000 });
    expect(await readDisk(d.path)).toContain("**parola**");
  });
});
