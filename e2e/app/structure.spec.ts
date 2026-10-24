import { expect, test, type Page } from "@playwright/test";
import { parseDraft } from "@desk/core";
import { openApp, readDisk } from "./helpers.ts";

async function newDraft(page: Page, archetype = "undecided") {
  // After structure comes writing: the outline lives in Write.
  await openApp(page, undefined, { mode: "write" });
  const title = `Struttura ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await page.getByRole("button", { name: "+ New" }).click();
  const dialog = page.getByRole("dialog", { name: "New draft" });
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Type of text").selectOption(archetype);
  await dialog.getByLabel("Plan the sections first").check();
  await dialog.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByTestId("structure")).toBeVisible();
  const path = new URL(page.url()).searchParams.get("d")!;
  return { title, path };
}

const titles = (page: Page) =>
  page
    .locator(".outline-row-title")
    .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));

test.describe("Structure phase", () => {
  test('from "+ New" to a draft in Writing with sections and targets, without touching the file', async ({
    page,
  }) => {
    const { title, path } = await newDraft(page);
    const screen = page.getByTestId("structure");
    // Archetype to choose: no outline until one is chosen.
    await expect(screen.getByRole("button", { name: "Suggest a structure" })).toHaveCount(1);
    await expect(page.locator(".outline-row")).toHaveCount(0);

    await screen.getByRole("button", { name: /^News article/ }).click();
    await expect.poll(() => titles(page)).toEqual(["Lead", "Contesto", "Sviluppo", "Chiusura"]);
    await screen.getByLabel("What is it about?").fill("La memoria dei modelli locali su Mac");
    await screen.getByLabel("Target (words)").fill("1200");
    await expect(screen.locator(".structure-sum")).toContainText("Total 1200 / 1200");

    // The fake llama-server proposes the sections as a stream.
    await screen.getByRole("button", { name: "Suggest a structure" }).click();
    await expect(screen.getByRole("button", { name: "Suggest a structure" })).toBeVisible();
    await expect(page.locator(".outline-row-guidance").first()).toContainText(
      "La memoria dei modelli",
    );
    await expect(screen.locator(".structure-checks")).toContainText("perché il tema conta adesso");

    // Edits: rename, target, reorder, remove, add.
    await screen.getByLabel("Section 2 title").fill("Perché conta");
    await screen.getByLabel("Section 4 target").fill("60");
    await screen.getByRole("button", { name: "Move down Perché conta" }).click();
    await screen.getByRole("button", { name: "+ Add section" }).click();
    await screen.getByLabel("Section 5 title").fill("Da provare");
    await screen.getByLabel("Section 5 target").fill("40");
    await screen.getByRole("button", { name: "Remove Da provare" }).click();
    await expect.poll(() => titles(page)).toEqual(["Lead", "Sviluppo", "Perché conta", "Chiusura"]);
    await expect(screen.locator(".structure-sum")).toHaveAttribute("data-mismatch", "true");

    await screen.getByRole("button", { name: "Accept structure" }).click();

    // Writing screen with the sections in the sidebar.
    await expect(page.locator(".cm-content")).toBeVisible();
    await expect(page.locator(".doctitle .stage-current")).toHaveText("Writing");
    await expect(page.locator(".section-card")).toHaveCount(4);
    await expect(page.locator(".section-card").nth(2)).toContainText("Perché conta");

    const parsed = parseDraft(await readDisk(path));
    expect(parsed.data).toMatchObject({
      title,
      archetype: "article",
      stage: "writing",
      target: 1200,
      brief: "La memoria dei modelli locali su Mac",
    });
    expect(parsed.data.outline!.map((o) => [o.id, o.heading])).toEqual([
      ["lead", undefined],
      ["development", "Sviluppo"],
      ["context", "Perché conta"], // renaming does not change the id
      ["closing", "Chiusura"],
    ]);
    expect(parsed.data.outline![3]!.target).toBe(60);
    expect(parsed.body).toBe(
      `# ${title}\n\n<!-- section: lead -->\n\n## Sviluppo\n\n## Perché conta\n\n## Chiusura\n`,
    );
  });

  test("without a model it starts from the default sections", async ({ page }) => {
    await page.route("**/api/structure/propose", (r) =>
      r.fulfill({
        contentType: "text/event-stream",
        body: `event: error\ndata: ${JSON.stringify({ code: "unreachable", message: "Model unreachable" })}\n\n`,
      }),
    );
    const { path } = await newDraft(page, "docs");
    const screen = page.getByTestId("structure");
    await expect
      .poll(() => titles(page))
      .toEqual(["Introduzione", "Prerequisiti", "Procedura", "Verifica", "Problemi noti"]);
    await screen.getByRole("button", { name: "Suggest a structure" }).click();
    await expect(screen.getByRole("alert")).toContainText("Model unreachable");
    await expect.poll(() => titles(page)).toHaveLength(5);
    await screen.getByRole("button", { name: "Accept structure" }).click();
    await expect(page.locator(".section-card")).toHaveCount(5);
    const parsed = parseDraft(await readDisk(path));
    expect(parsed.data.stage).toBe("writing");
    expect(parsed.data.outline!.reduce((a, o) => a + o.target, 0)).toBe(1200);
  });

  test("the proposal can be cancelled while the model is thinking", async ({ page }) => {
    await page.route("**/api/structure/propose", async (r) => {
      await new Promise((res) => setTimeout(res, 300));
      await r.fulfill({
        contentType: "text/event-stream",
        body: `event: progress\ndata: {"phase":"reasoning","reasoningTokens":12}\n\n`,
      });
    });
    await newDraft(page, "blog");
    const screen = page.getByTestId("structure");
    await screen.getByRole("button", { name: "Suggest a structure" }).click();
    await expect(screen.getByRole("status")).toContainText("thinking");
    await screen.getByRole("button", { name: "Cancel" }).click();
    await expect(screen.getByRole("button", { name: "Suggest a structure" })).toBeVisible();
    await expect.poll(() => titles(page)).toEqual(["Apertura", "Corpo", "Conclusione"]);
  });
});
