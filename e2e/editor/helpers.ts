import type { Page } from "@playwright/test";

export async function openLab(page: Page, query = "") {
  await page.goto(`/lab${query}`);
  await page.waitForFunction(() => !!(window as any).__lab?.view);
  await page.locator(".cm-content").waitFor();
  await numbersReady(page);
}

/** The typefaces are loaded and the line numbers use no estimates (off-screen lines counted). */
export async function numbersReady(page: Page) {
  // Two frames: the last change reaches the measure phase and the numbers layer redraws.
  const frames = () =>
    page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
    );
  await frames();
  await page.waitForFunction(
    () =>
      document.fonts.status === "loaded" &&
      document.querySelector(".cm-vln-layer")?.getAttribute("data-pending") === "false",
  );
  await frames();
  // WebKit applies a just-loaded typeface to the text already on the page with some delay: the
  // numbers settle afterwards. Wait until they stay still.
  const snapshot = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll(".cm-vln"))
        .map((e) => `${e.textContent}@${e.getBoundingClientRect().top}`)
        .join(" "),
    );
  for (let prev = await snapshot(), i = 0; i < 20; i++) {
    await page.waitForTimeout(250);
    const next = await snapshot();
    if (next === prev) break;
    prev = next;
  }
}

export interface LineNumber {
  text: string;
  /** Vertical centre, in page coordinates. */
  mid: number;
  active: boolean;
}

/** The drawn line numbers, top to bottom. */
export async function lineNumbers(page: Page): Promise<LineNumber[]> {
  await numbersReady(page);
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>(".cm-vln"))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          text: el.textContent ?? "",
          mid: (r.top + r.bottom) / 2,
          active: el.classList.contains("cm-vln-active"),
        };
      })
      .sort((a, b) => a.mid - b.mid),
  );
}

/**
 * The file's lines as they appear: for each `.cm-line`, how many visual lines it takes (height
 * divided by the body's line height, which paragraphs use without margins) and where it is.
 */
export async function bodyLines(page: Page) {
  return page.evaluate(() => {
    const lh = parseFloat(getComputedStyle(document.querySelector(".cm-scroller")!).lineHeight);
    return Array.from(document.querySelectorAll<HTMLElement>(".cm-content > .cm-line")).map(
      (el) => {
        const r = el.getBoundingClientRect();
        return {
          text: el.textContent ?? "",
          top: r.top,
          bottom: r.bottom,
          plain: el.classList.length === 1 || el.className === "cm-line cm-activeLine",
          visual: Math.round(r.height / lh),
        };
      },
    );
  });
}

/** Text of a judgment's underlines (it may be split across several elements). */
export async function markText(page: Page, id: string): Promise<string> {
  return (await page.locator(`[data-j="${id}"]`).allTextContents()).join("");
}

export const ORIGINAL_MARKS: Record<string, string> = {
  f1: "per macOS",
  f2: "tra i 100 e i 150 MB di RAM",
  f3: "contesto di 100k token",
  f4: "non garantiscono un loop autonomo completo",
  f5: "Qwen3.6-35B-3B",
  g1: "si può integrare",
  r1: "completamente",
  r2: "con modelli linguistici locali, con opzione di fallback cloud",
};

export async function allMarks(page: Page): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of Object.keys(ORIGINAL_MARKS)) out[id] = await markText(page, id);
  return out;
}

/** Runs `fn(view)` in the page (to place the cursor or insert text). */
export async function withView<T>(
  page: Page,
  fn: (view: any, arg: any) => T,
  arg?: unknown,
): Promise<T> {
  return page.evaluate(
    ([src, a]) =>
      new Function("view", "arg", `return (${src})(view, arg)`)((window as any).__lab.view, a),
    [fn.toString(), arg] as const,
  ) as Promise<T>;
}

/** Document position of a string in the body. */
export function posOf(page: Page, text: string, offset = 0): Promise<number> {
  return withView(
    page,
    (v: any, t: [string, number]) => v.state.doc.toString().indexOf(t[0]) + t[1],
    [text, offset],
  );
}
