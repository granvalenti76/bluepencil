import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  E2E_LLM_PORT,
  E2E_TOKEN,
  E2E_WELCOME_DIR,
  E2E_WELCOME_NEW,
  E2E_WELCOME_NOTES,
} from "../env.ts";
import { format, MOD } from "./helpers.ts";

/**
 * The first start: the folder of texts, the editor with its test, the sample draft. Runs on the
 * first-start server (playwright.config.ts), one engine at a time.
 */

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 900 } });

const headers = { "x-desk-token": E2E_TOKEN };
/** Outside the Bluepencil repository: inside it, git would ignore the published file. */
const PUBLISHED = join(tmpdir(), `bluepencil-e2e-published-${process.pid}`);

/** Start over: no configuration, no folders; the server restarts. */
async function resetWelcome(page: Page) {
  await rm(E2E_WELCOME_NOTES, { recursive: true, force: true });
  await rm(join(E2E_WELCOME_NEW, ".."), { recursive: true, force: true });
  await rm(PUBLISHED, { recursive: true, force: true });
  await page.request.post("/api/dev/reset-welcome", { headers });
  await expect
    .poll(
      async () => {
        const r = await page.request.get("/api/welcome", { headers }).catch(() => null);
        return r?.ok() ? ((await r.json()) as { folder: string | null }).folder : "down";
      },
      { timeout: 20_000 },
    )
    .toBeNull();
}

/** A folder of notes without front matter: two texts, one cites the third (the source). */
async function notesFolder() {
  await mkdir(join(E2E_WELCOME_NOTES, "fonti"), { recursive: true });
  await writeFile(
    join(E2E_WELCOME_NOTES, "pane.md"),
    "# Il pane\n\nCosta meno.[^1]\n\n[^1]: fonti/prezzi.md\n",
  );
  await writeFile(join(E2E_WELCOME_NOTES, "orto.md"), "# L'orto\n\nI pomodori di agosto.\n");
  await writeFile(join(E2E_WELCOME_NOTES, "fonti", "prezzi.md"), "Il pane costa 4 euro.\n");
}

const card = (page: Page) => page.getByRole("tabpanel");
/** How the server shows a path: the home folder as `~`. */
const tilde = (p: string) => p.replace(/^\/(Users|home)\/[^/]+/, "~");

test.afterAll(() => rm(PUBLISHED, { recursive: true, force: true }));

test.beforeEach(async ({ page }) => {
  await resetWelcome(page);
  await page.goto(`/#t=${E2E_TOKEN}`);
});

test("a folder you already use: texts and sources, the editor answers, the sample draft", async ({
  page,
}) => {
  await notesFolder();
  await expect(page.getByRole("heading", { name: "Bluepencil" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "1 · Your writing" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(card(page).getByRole("heading")).toHaveText("Where is your writing?");

  // "Choose…" (the fake Finder picks the notes folder): what is inside.
  await card(page).getByRole("button", { name: "Choose…" }).click();
  await expect(card(page).getByRole("textbox", { name: "Folder path" })).toHaveValue(
    tilde(E2E_WELCOME_NOTES),
  );
  const found = card(page).getByRole("status");
  await expect(found).toContainText("2 texts");
  await expect(found).toContainText("1 source, cited by your texts");
  await expect(found).toContainText("last edited today");
  // Before "Continue" the folder is not touched.
  expect(existsSync(join(E2E_WELCOME_NOTES, ".bluepencil"))).toBe(false);

  await card(page).getByRole("button", { name: "Continue" }).click();
  await expect(card(page).getByRole("heading")).toHaveText("Connect your editor", {
    timeout: 20_000,
  });
  await expect(page.getByRole("tab", { name: /1 · Your writing/ })).toContainText("✓");

  // The test: the fake llama-server answers, with its first words.
  await card(page)
    .getByRole("textbox", { name: "Address" })
    .fill(`http://127.0.0.1:${E2E_LLM_PORT}/v1`);
  await card(page).getByRole("button", { name: "Test connection" }).click();
  await expect(card(page).getByRole("status")).toContainText(/Reachable · \d+ ms/, {
    timeout: 20_000,
  });
  await expect(card(page)).toContainText("Qwen3.6-35B");
  await expect(card(page)).toContainText("enough for pieces up to");
  await expect(card(page)).toContainText("Thinks before answering: yes");
  await expect(card(page).locator(".first-words")).toContainText("Le virgole per ultime");

  await card(page).getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\?d=Esempio\.md/, { timeout: 20_000 });
  await expect(page.locator(".cm-content")).toContainText("Il pane della domenica");
  await expect(page.getByRole("button", { name: "Write", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const tips = page.getByRole("complementary", { name: "Tips" });
  await expect(tips).toContainText("Three things to try");

  // Every .md is a text; the cited source is not.
  await page.getByRole("button", { name: "Drafts", exact: true }).click();
  const list = page.locator(".drafts-layer .sidebar");
  await expect(list).toContainText("Il pane della domenica");
  await expect(list).toContainText("Il pane");
  await expect(list).toContainText("L'orto");
  await expect(list).not.toContainText("prezzi");
  await page.keyboard.press("Escape");

  // The boxes tick themselves.
  await page.locator(".cm-content").click();
  await page.keyboard.press(`${MOD}+ArrowDown`);
  await page.keyboard.type(" Una frase mia.");
  await expect(tips.getByRole("checkbox").first()).toBeChecked();
  await page.getByRole("button", { name: /^Review/ }).click();
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expect(tips.getByRole("checkbox").nth(2)).toBeChecked();
  await tips.getByRole("button", { name: "Hide tips" }).click();
  await expect(tips).toHaveCount(0);

  // The first start does not repeat; the tested address is the saved one.
  await page.reload();
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(page.getByRole("tab", { name: "1 · Your writing" })).toHaveCount(0);
  const config = JSON.parse(await readFile(join(E2E_WELCOME_DIR, "config.json"), "utf8"));
  expect(config).toMatchObject({
    welcome: "done",
    model: { baseUrl: `http://127.0.0.1:${E2E_LLM_PORT}/v1` },
  });
});

test("editor off: says so; without an editor you can write, format and publish", async ({
  page,
}) => {
  // "A new folder": created only after "Continue".
  expect(existsSync(E2E_WELCOME_NEW)).toBe(false);
  await expect(card(page)).toContainText(tilde(E2E_WELCOME_NEW));
  await card(page)
    .getByRole("radio", { name: /A new folder/ })
    .check();
  await card(page).getByRole("button", { name: "Continue" }).click();
  await expect(card(page).getByRole("heading")).toHaveText("Connect your editor", {
    timeout: 20_000,
  });
  expect(existsSync(E2E_WELCOME_NEW)).toBe(true);

  // Nobody answers: what is wrong, the command to start it, "Try again".
  await card(page).getByRole("textbox", { name: "Address" }).fill("http://127.0.0.1:4598/v1");
  await card(page).getByRole("button", { name: "Test connection" }).click();
  const alert = card(page).getByRole("alert");
  await expect(alert).toContainText("Nobody answered at 127.0.0.1:4598.", { timeout: 20_000 });
  await expect(alert).toContainText("llama-server -m model.gguf");
  await expect(card(page).getByRole("button", { name: "Try again" })).toBeVisible();

  await card(page).getByRole("button", { name: "Write without the editor" }).click();
  await expect(page).toHaveURL(/\?d=Esempio\.md/, { timeout: 20_000 });
  expect(existsSync(join(E2E_WELCOME_NEW, "Esempio.md"))).toBe(true);

  // Write and format.
  await page.locator(".cm-content").click();
  await page.keyboard.press(`${MOD}+ArrowDown`);
  await page.keyboard.type(" Croccante");
  await page.keyboard.press("Shift+Alt+ArrowLeft");
  await format(page, "Bold");
  await expect(page.locator(".cm-content .cm-lp-strong")).toHaveText("Croccante");

  // Publish.
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: /Publish/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("textbox", { name: "Where should published articles go?" })
    .fill(PUBLISHED);
  await dialog.getByRole("button", { name: "Use this folder" }).click();
  await dialog.getByRole("button", { name: /^Publish/ }).click();
  await expect(dialog.getByRole("status")).toContainText("Published", { timeout: 10_000 });
  expect(await readFile(join(PUBLISHED, "Esempio.md"), "utf8")).toContain("**Croccante**");
});
