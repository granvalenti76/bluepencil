import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { E2E_DRAFTS_DIR, E2E_TOKEN } from "../env.ts";

export const TURBO = "turbocode-draft-12-settembre.md";
export const MOD = process.platform === "darwin" ? "Meta" : "Control";

const headers = { "x-desk-token": E2E_TOKEN };

/**
 * Opens the app with the token in the fragment, as `npm start` does. The mode (Write / Review) is
 * a browser preference: tests choose it, usually Review, where the notes are.
 */
export async function openApp(
  page: Page,
  draft?: string,
  { mode = "review" }: { mode?: "write" | "review" } = {},
) {
  // Once per tab: a reload keeps the choice made in the page.
  await page.addInitScript((m) => {
    if (sessionStorage.getItem("e2e-mode")) return;
    sessionStorage.setItem("e2e-mode", "1");
    localStorage.setItem("desk-mode", m);
  }, mode);
  await page.goto(`/${draft ? `?d=${encodeURIComponent(draft)}` : ""}#t=${E2E_TOKEN}`);
  if (draft) await page.locator(".cm-content").waitFor();
}

/** The drafts list, over the desk (⌘O). */
export async function openDrafts(page: Page) {
  const panel = page.locator(".drafts-layer .sidebar");
  // Without an open draft the list is already open; as soon as a draft opens, it closes.
  await expect(async () => {
    if (!(await panel.isVisible()))
      await page.getByRole("button", { name: "Drafts", exact: true }).click();
    await expect(panel).toBeVisible({ timeout: 500 });
  }).toPass();
}

/** Creates a draft just for the test (tests run in parallel: none touches the fixtures). */
export async function createDraft(
  request: APIRequestContext,
  title = `Prova ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  archetype = "article",
  stage: "structure" | "writing" = "writing",
) {
  const plan = stage === "structure";
  const res = await request.post("/api/drafts", { headers, data: { title, archetype, plan } });
  return (await res.json()) as { path: string; contentHash: string; text: string; body: string };
}

export async function getDraft(request: APIRequestContext, path: string) {
  const res = await request.get(`/api/drafts/${encodeURIComponent(path)}`, { headers });
  return (await res.json()) as { text: string; body: string; contentHash: string };
}

export const diskPath = (path: string) => join(E2E_DRAFTS_DIR, path);
export const readDisk = (path: string) => readFile(diskPath(path), "utf8");
export const appendDisk = (path: string, text: string) => appendFile(diskPath(path), text);

export function view<T>(page: Page, fn: (v: any, a: any) => T, arg?: unknown): Promise<T> {
  return page.evaluate(
    ([src, a]) => new Function("v", "a", `return (${src})(v, a)`)((window as any).__lab.view, a),
    [fn.toString(), arg] as const,
  ) as Promise<T>;
}

export const docText = (page: Page) => view(page, (v) => v.state.doc.toString());

/**
 * A copy of Turbocode with the fake sample judgments, just for this test (tests run in parallel
 * and change the text: none touches the original draft).
 */
export async function seededTurbo(request: APIRequestContext) {
  const { path, text } = await copyTurbo(request);
  const seed = await request.post("/api/dev/seed-judgments", { headers, data: { path } });
  if (!seed.ok()) throw new Error(`seed non riuscito: ${seed.status()}`);
  return { path, text };
}

/** A copy of Turbocode without judgments (for the real review). */
export async function copyTurbo(
  request: APIRequestContext,
  edit: (t: string) => string = (t) => t,
) {
  const path = `turbo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.md`;
  const text = edit(await readFile(join("fixtures/drafts", TURBO), "utf8"));
  await writeFile(diskPath(path), text);
  // the watcher indexes it within a few hundred milliseconds
  for (let i = 0; i < 50; i++) {
    const res = await request.get("/api/drafts", { headers });
    if (((await res.json()).drafts as { path: string }[]).some((d) => d.path === path)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return { path, text };
}

export const card = (page: Page, title: string) => page.locator(".note").filter({ hasText: title });
export const mark = (page: Page, text: string) => page.locator(".cm-j").filter({ hasText: text });
/** The notes button says how many are open: "Review (N open)". */
export const openNotes = (page: Page) => page.getByRole("button", { name: /^Review \(/ });

/** Switches to Review: the page and the editor's notes. */
export async function reviewMode(page: Page) {
  const button = openNotes(page);
  if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
}

/** The save state: the dot next to the title, with its accessible name. */
export const saveState = (page: Page) => page.locator(".save-dot");

/** The formatting bar (Write): a button, or a style from the "style ▾" menu. */
export async function format(page: Page, name: string) {
  const bar = page.getByRole("toolbar", { name: "Formatting" });
  const styles = ["Title", "Heading", "Subheading", "Body text", "Code block"];
  if (styles.includes(name)) {
    await bar.getByRole("button", { name: /^Paragraph style/ }).click();
    await page.getByRole("menuitemradio", { name: new RegExp(`^${name}`) }).click();
    return;
  }
  const label = name === "List" ? "Bulleted list" : name;
  await bar.getByRole("button", { name: label, exact: true }).click();
}

/** View (the eye menu): preview, focus, Hemingway, the hand, typing sounds. */
export async function toggleView(page: Page, name: string) {
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByRole("button", { name }).click();
  await page.keyboard.press("Escape");
}

/** CodeMirror's scroller renders only what is in view: scroll for the end of the document. */
export const scrollToEnd = (page: Page) =>
  page.locator(".cm-scroller").evaluate((el) => (el.scrollTop = el.scrollHeight));

/** A tab on the editor's card: its accessible name says how it stands. */
export const passButton = (page: Page, name: string) =>
  page
    .getByRole("tablist", { name: "Review passes" })
    .getByRole("tab", { name: new RegExp(`^${name}:`) });

/** The pass has been computed (the server marked it "open"). */
export const passOpen = (page: Page, name: string) =>
  expect(passButton(page, name)).toHaveAccessibleName(new RegExp(`^${name}: \\d+ open$`), {
    timeout: 30_000,
  });

/** "Start review": begins with structure and waits for it to be computed. */
export async function startReview(page: Page) {
  await page.getByRole("button", { name: "Start review" }).click();
  await passOpen(page, "Structure");
}

/** Closes the pass shown and waits for the next one to be computed. */
export async function finishPass(page: Page, next: string) {
  await page
    .getByRole("group", { name: / pass$/ })
    .getByRole("button", { name: /^(Finish pass|Continue to )/ })
    .click();
  await passOpen(page, next);
}

/** All passes at once, from the menu next to the review button. */
export async function fullReview(page: Page) {
  await page.getByRole("button", { name: "Choose what to review" }).click();
  await page.getByRole("menuitem", { name: "Full review" }).click();
  await passOpen(page, "Grammar");
}

/** The readability indices: open in the prose pass, elsewhere with a click on the title. */
export async function openReadability(page: Page) {
  const toggle = page.getByRole("region", { name: "Readability" }).getByRole("button", {
    name: "Readability",
  });
  if ((await toggle.count()) > 0 && (await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
  await expect(page.getByTestId("score-clarity")).toBeVisible();
}
