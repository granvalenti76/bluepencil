import { expect, test, type Page } from "@playwright/test";
import { parseDraft, patchFrontMatter } from "@desk/core";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { E2E_LANGUAGES_DIR, E2E_TOKEN } from "../env.ts";
import {
  copyTurbo,
  createDraft,
  diskPath,
  openApp,
  openDrafts,
  openReadability,
  readDisk,
} from "./helpers.ts";

/** The draft's language. */

async function openNewDraftDialog(page: Page) {
  await openDrafts(page);
  await page.getByRole("button", { name: "+ New" }).click();
  return page.getByRole("dialog", { name: "New draft" });
}

const uniqueTitle = () => `Lingua ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function openPreview(page: Page) {
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.keyboard.press("Escape");
  return page.getByRole("article", { name: "Preview" });
}

test.describe("draft language", () => {
  test('"New draft": Italian by default, English ends up in the file and becomes the default', async ({
    page,
  }) => {
    await openApp(page);
    let dialog = await openNewDraftDialog(page);
    await expect(dialog.getByLabel("Language")).toHaveValue("it");
    await dialog.getByLabel("Title").fill(uniqueTitle());
    await dialog.getByLabel("Language").selectOption("en");
    await dialog.getByLabel("Plan the sections first").check();
    await dialog.getByRole("button", { name: "Create draft" }).click();
    await expect(page.getByTestId("structure")).toBeVisible();
    const path = new URL(page.url()).searchParams.get("d")!;
    expect(parseDraft(await readDisk(path)).data.lang).toBe("en");
    await expect(page.getByTestId("structure").getByLabel("Language")).toHaveValue("en");

    dialog = await openNewDraftDialog(page);
    await expect(dialog.getByLabel("Language")).toHaveValue("en");
  });

  test("Structure: the chosen language is saved with the structure; editor and preview declare it", async ({
    page,
  }) => {
    await openApp(page);
    const dialog = await openNewDraftDialog(page);
    await dialog.getByLabel("Title").fill(uniqueTitle());
    await dialog.getByLabel("Type of text").selectOption("blog");
    await dialog.getByLabel("Plan the sections first").check();
    await dialog.getByRole("button", { name: "Create draft" }).click();
    const screen = page.getByTestId("structure");
    await expect(screen).toBeVisible();
    const path = new URL(page.url()).searchParams.get("d")!;

    await screen.getByLabel("Language").selectOption("en");
    await screen.getByRole("button", { name: "Accept structure" }).click();
    await expect(page.locator(".cm-content")).toHaveAttribute("lang", "en");
    expect(parseDraft(await readDisk(path)).data).toMatchObject({ lang: "en", stage: "writing" });
    await expect(await openPreview(page)).toHaveAttribute("lang", "en");
  });

  test("draft without `lang`: Italian, no warnings", async ({ page, request }) => {
    const { path } = await copyTurbo(request);
    await openApp(page, path);
    await expect(page.locator(".cm-content")).toHaveAttribute("lang", "it");
    await expect(page.locator(".reading-lang")).toHaveCount(0);
  });

  test("code the app does not know: treated as Italian, with a warning, and kept in the file", async ({
    page,
    request,
  }) => {
    const { path } = await copyTurbo(request, (t) => patchFrontMatter(t, { lang: "pt-BR" }));
    await openApp(page, path);
    await expect(page.locator(".cm-content")).toHaveAttribute("lang", "it");
    await expect(page.locator(".reading-lang")).toHaveText(
      "Language “pt-BR” isn’t supported yet: treated as Italian.",
    );
    // Writing and saving does not touch `lang`.
    await page.locator(".cm-content").click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Ancora.");
    await expect.poll(async () => (await readDisk(path)).includes(" Ancora.")).toBe(true);
    expect(parseDraft(await readDisk(path)).data.lang).toBe("pt-BR");
  });

  test("Structure with an unknown code: accepting without choosing the language does not change it", async ({
    page,
    request,
  }) => {
    const created = await createDraft(request, uniqueTitle(), "blog", "structure");
    await writeFile(diskPath(created.path), patchFrontMatter(created.text, { lang: "pt-BR" }));
    // In the Structure phase there is no editor: `openApp` would wait for it.
    await page.goto(`/?d=${encodeURIComponent(created.path)}#t=${E2E_TOKEN}`);
    const screen = page.getByTestId("structure");
    await expect(screen).toBeVisible();
    await screen.getByRole("button", { name: /^Blog post/ }).click();
    await screen.getByRole("button", { name: "Accept structure" }).click();
    await expect(page.locator(".cm-content")).toBeVisible();
    expect(parseDraft(await readDisk(created.path)).data).toMatchObject({
      lang: "pt-BR",
      stage: "writing",
    });
  });
});

test.describe("English", () => {
  test("English draft: editor in English, Flesch in the panel, no proposal", async ({
    page,
    request,
  }) => {
    const { path } = await copyTurbo(request);
    await writeFile(
      diskPath(path),
      await readFile(join("fixtures/drafts", "writing-with-a-local-model.md"), "utf8"),
    );
    await openApp(page, path);
    await expect(page.locator(".cm-content")).toHaveAttribute("lang", "en");
    await openReadability(page);
    const clarity = page.getByTestId("score-clarity");
    await expect(clarity).toHaveAttribute("data-tip", /^Flesch Reading Ease/);
    await expect(clarity.locator(".reading-value")).toHaveText(/^\d+$/);
    await expect(page.locator(".reading-suggest")).toHaveCount(0);
  });

  test("new draft in English: archetypes and section headings in English", async ({ page }) => {
    await openApp(page);
    const dialog = await openNewDraftDialog(page);
    await dialog.getByLabel("Title").fill(uniqueTitle());
    await dialog.getByLabel("Type of text").selectOption("blog");
    await dialog.getByLabel("Language").selectOption("en");
    await dialog.getByLabel("Plan the sections first").check();
    await dialog.getByRole("button", { name: "Create draft" }).click();
    const screen = page.getByTestId("structure");
    await expect(screen).toBeVisible();
    const path = new URL(page.url()).searchParams.get("d")!;
    await expect(screen.getByRole("button", { name: /^Blog post/ })).toContainText(
      "Opening · Body · Conclusion",
    );
    await expect
      .poll(() =>
        page
          .locator(".outline-row-title")
          .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)),
      )
      .toEqual(["Opening", "Body", "Conclusion"]);
    await screen.getByRole("button", { name: "Accept structure" }).click();
    await expect(page.locator(".cm-content")).toBeVisible();
    const text = await readDisk(path);
    expect(text).toContain("## Body");
    expect(text).toContain("## Conclusion");
  });

  test("Structure: changing language, the default sections follow it", async ({ page }) => {
    await openApp(page);
    const dialog = await openNewDraftDialog(page);
    await dialog.getByLabel("Title").fill(uniqueTitle());
    await dialog.getByLabel("Type of text").selectOption("report");
    await dialog.getByLabel("Language").selectOption("it");
    await dialog.getByLabel("Plan the sections first").check();
    await dialog.getByRole("button", { name: "Create draft" }).click();
    const screen = page.getByTestId("structure");
    const titles = () =>
      page
        .locator(".outline-row-title")
        .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    await expect.poll(titles).toEqual(["Sintesi", "Metodo", "Risultati", "Limiti", "Conclusioni"]);
    await screen.getByLabel("Language").selectOption("en");
    await expect
      .poll(titles)
      .toEqual(["Summary", "Method", "Results", "Limitations", "Conclusions"]);
  });

  test("text in another language: proposes changing `lang`, writes only on click", async ({
    page,
    request,
  }) => {
    const { path } = await copyTurbo(request, (t) => patchFrontMatter(t, { lang: "en" }));
    await openApp(page, path);
    const suggest = page.locator(".reading-suggest");
    await expect(suggest).toHaveText(
      "This draft looks written in Italian. Set language · Keep English",
    );
    expect(parseDraft(await readDisk(path)).data.lang).toBe("en");

    await suggest.getByRole("button", { name: "Set language" }).click();
    await expect(page.locator(".cm-content")).toHaveAttribute("lang", "it");
    await expect(suggest).toHaveCount(0);
    expect(parseDraft(await readDisk(path)).data.lang).toBe("it");
  });

  test('"Keep": the proposal disappears and the file does not change', async ({
    page,
    request,
  }) => {
    const { path } = await copyTurbo(request, (t) => patchFrontMatter(t, { lang: "en" }));
    await openApp(page, path);
    const suggest = page.locator(".reading-suggest");
    await suggest.getByRole("button", { name: "Keep English" }).click();
    await expect(suggest).toHaveCount(0);
    await page.locator(".cm-content").click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Ancora.");
    await expect.poll(async () => (await readDisk(path)).includes(" Ancora.")).toBe(true);
    await expect(suggest).toHaveCount(0);
    expect(parseDraft(await readDisk(path)).data.lang).toBe("en");
  });
});

test.describe("user packs", () => {
  /** One code per test: Chromium and WebKit run together on the same folder. */
  const uniqueCode = () => `es-x-${Math.random().toString(36).slice(2, 8)}`;

  async function openSettings(page: Page) {
    await openApp(page);
    await page.getByRole("button", { name: "Settings" }).click();
    return page.getByRole("dialog", { name: "Settings" });
  }

  test('"New language…": the pack is born from English and the language appears in the menu', async ({
    page,
  }) => {
    const code = uniqueCode();
    const dialog = await openSettings(page);
    const section = dialog.getByRole("region", { name: "Languages" });
    await expect(section.locator(".language-list")).toContainText("English");
    await expect(section.locator(".language-list")).toContainText("built-in");
    await section.getByRole("button", { name: "New language…" }).click();
    await section.getByLabel("Code").fill(code);
    await section.getByLabel("Name").fill("Español de prueba");
    await section.getByRole("button", { name: "Create" }).click();
    await expect(section.getByRole("status")).toContainText(`${code}. Translate its files`);
    await expect(section.locator(".language-list li").filter({ hasText: code })).toContainText(
      "yours",
    );
    const meta = JSON.parse(
      await readFile(join(E2E_LANGUAGES_DIR, code, "language.json"), "utf8"),
    ) as { code: string; readability: { formula: string } };
    expect(meta).toMatchObject({ code, readability: { formula: "sentences" } });
    await dialog.getByRole("button", { name: "Close" }).click();

    const newDraft = await openNewDraftDialog(page);
    await newDraft.getByLabel("Title").fill(uniqueTitle());
    await newDraft.getByLabel("Language").selectOption(code);
    await newDraft.getByLabel("Plan the sections first").check();
    await newDraft.getByRole("button", { name: "Create draft" }).click();
    await expect(page.getByTestId("structure")).toBeVisible();
    const path = new URL(page.url()).searchParams.get("d")!;
    expect(parseDraft(await readDisk(path)).data.lang).toBe(code);
  });

  test("readability without a language formula: words per sentence", async ({ page, request }) => {
    const code = uniqueCode();
    await request.post("/api/languages", {
      headers: { "x-desk-token": E2E_TOKEN },
      data: { code, name: "Prueba" },
    });
    const { path } = await copyTurbo(request, (t) => patchFrontMatter(t, { lang: code }));
    await openApp(page, path);
    await openReadability(page);
    const clarity = page.getByTestId("score-clarity");
    await expect(clarity).toHaveAttribute("data-tip", /^Average words per sentence/);
    await expect(clarity.locator(".reading-value")).toHaveText(/^\d+$/);
    await expect(clarity.locator(".reading-note")).toContainText("words/sentence");
  });

  test('a broken pack does not load: Settings say why; "Reload" tries again', async ({
    page,
    request,
  }) => {
    const code = uniqueCode();
    await request.post("/api/languages", {
      headers: { "x-desk-token": E2E_TOKEN },
      data: { code, name: "Rotto" },
    });
    const grammar = join(E2E_LANGUAGES_DIR, code, "prompts", "grammar.md");
    const original = await readFile(grammar, "utf8");
    await writeFile(grammar, "Revisa {{texto}}.");
    const dialog = await openSettings(page);
    const section = dialog.getByRole("region", { name: "Languages" });
    await section.getByRole("button", { name: "Reload" }).click();
    const problems = section.getByRole("alert", { name: "Language packs with problems" });
    await expect(problems).toContainText(`${code} isn’t loaded`);
    await expect(problems).toContainText("prompts/grammar.md: unknown placeholder {{texto}}");
    await writeFile(grammar, original);
    await section.getByRole("button", { name: "Reload" }).click();
    await expect(section.locator(".language-list li").filter({ hasText: code })).toHaveCount(1);
  });
});
