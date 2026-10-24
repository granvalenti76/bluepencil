import { expect, test, type Page } from "@playwright/test";
import { parseDraft } from "@desk/core";
import {
  MOD,
  copyTurbo,
  createDraft,
  docText,
  format,
  openApp,
  readDisk,
  saveState,
  view,
} from "./helpers.ts";

test.use({ viewport: { width: 1440, height: 900 } });

// Formatting bar and sources.

const bar = (page: Page) => page.getByRole("toolbar", { name: "Formatting" });

/** A new draft with a paragraph «parola altra» at the end, the cursor on «parola». */
async function setup(page: Page, request: import("@playwright/test").APIRequestContext) {
  const d = await createDraft(request);
  await openApp(page, d.path, { mode: "write" });
  await page.locator(".cm-content").click();
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.type("\n\nparola altra");
  await selectWord(page, "parola");
  return d;
}

async function selectWord(page: Page, word: string) {
  await view(
    page,
    (v, w: string) => {
      const from = v.state.doc.toString().lastIndexOf(w);
      v.dispatch({ selection: { anchor: from, head: from + w.length } });
    },
    word,
  );
}

const lastBlock = (page: Page) =>
  view(page, (v) =>
    v.state.doc
      .toString()
      .trimEnd()
      .split(/\n{2,}/)
      .at(-1),
  );

test.describe("formatting bar", () => {
  test("every command is undone with ⌘Z in one step", async ({ page, request }) => {
    await setup(page, request);
    const original = await docText(page);
    const steps: [string, () => Promise<void>][] = [
      ["Bold", () => format(page, "Bold")],
      ["Italic", () => format(page, "Italic")],
      ["Code", () => format(page, "Code")],
      ["Title", () => format(page, "Title")],
      ["Heading", () => format(page, "Heading")],
      ["Subheading", () => format(page, "Subheading")],
      ["Quote", () => format(page, "Quote")],
      ["Code block", () => format(page, "Code block")],
      ["Bulleted list", () => format(page, "Bulleted list")],
      ["Numbered list", () => format(page, "Numbered list")],
      [
        "Link",
        async () => {
          await bar(page).getByRole("button", { name: "Link" }).click();
          await page.getByLabel("Link address").fill("https://example.org");
          await page.getByLabel("Link address").press("Enter");
        },
      ],
      ...(["Separator", "Image", "Table"] as const).map(
        (name) =>
          [
            name,
            async () => {
              await bar(page).getByRole("button", { name: "More formats" }).click();
              await page.getByRole("menuitem", { name }).click();
            },
          ] as [string, () => Promise<void>],
      ),
      [
        "Cite",
        async () => {
          await bar(page).getByRole("button", { name: "Source" }).click();
          await page.getByRole("tab", { name: "My estimate" }).click();
          await page.getByRole("button", { name: "Cite as my estimate" }).click();
        },
      ],
    ];
    for (const [name, run] of steps) {
      await selectWord(page, "parola");
      await run();
      await expect.poll(() => docText(page), name).not.toBe(original);
      await page.locator(".cm-content").focus();
      await page.keyboard.press(`${MOD}+z`);
      await expect.poll(() => docText(page), `${name}: ⌘Z`).toBe(original);
    }
  });

  test("style ▾ shows the style of the cursor's line", async ({ page, request }) => {
    const { path } = await copyTurbo(request);
    await openApp(page, path, { mode: "write" });
    const style = bar(page).getByRole("button", { name: /^Paragraph style/ });
    const at = async (text: string, name: string) => {
      await view(
        page,
        (v, t: string) =>
          v.dispatch({ selection: { anchor: v.state.doc.toString().indexOf(t) + 3 } }),
        text,
      );
      await expect(style).toHaveAccessibleName(`Paragraph style: ${name}`);
    };
    await at("# Turbocode V0.6", "Title");
    await at("## Cosa è Turbocode", "Heading");
    await at("È un harness", "Body text");
    // Headings, lists, quotes and code typed in Markdown: the style is recognised all the same.
    await view(page, (v) =>
      v.dispatch({
        changes: {
          from: v.state.doc.length,
          insert: "\n### Sotto\n\n- voce\n\n1. primo\n\n> detto\n\n```\ncodice\n```\n",
        },
      }),
    );
    await at("### Sotto", "Subheading");
    await at("- voce", "Bulleted list");
    await at("1. primo", "Numbered list");
    await at("> detto", "Quote");
    await at("```\ncodice", "Code block");
    // And the menu marks the style in use.
    await style.click();
    await expect(page.getByRole("menuitemradio", { name: /^Code block/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("typing # , - and > at the start of a line applies the style by itself", async ({
    page,
    request,
  }) => {
    await setup(page, request);
    await page.keyboard.press(`${MOD}+End`);
    for (const [md, cls] of [
      ["# Titolo", "cm-lp-h1"],
      ["- voce", "cm-lp-li"],
      ["> detto", "cm-lp-quote"],
    ]) {
      await page.keyboard.type(`\n\n${md}`);
      await expect(page.locator(`.cm-line.${cls}`).last()).toContainText(md.slice(2));
    }
    await expect(page.locator(".cm-content")).not.toContainText("# Titolo");
  });

  test('link: on hover the address with "Open", "Edit", "Remove"', async ({ page, request }) => {
    await setup(page, request);
    await page.keyboard.press(`${MOD}+k`);
    await page.getByLabel("Link address").fill("https://example.org/uno");
    await page.getByLabel("Link address").press("Enter");
    const link = page.locator(".cm-lp-link").last();
    await expect(link).toHaveText("parola");

    await link.hover();
    const hover = page.locator(".cm-link-hover");
    await expect(hover).toContainText("https://example.org/uno");
    await expect(hover.getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      "https://example.org/uno",
    );
    await hover.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByLabel("Link address")).toHaveValue("https://example.org/uno");
    await page.getByLabel("Link address").fill("https://example.org/due");
    await page.getByLabel("Link address").press("Enter");
    expect(await lastBlock(page)).toBe("[parola](https://example.org/due) altra");

    await page.mouse.move(100, 100);
    await link.hover();
    await page.locator(".cm-link-hover").getByRole("button", { name: "Remove" }).click();
    expect(await lastBlock(page)).toBe("parola altra");
    await page.keyboard.press(`${MOD}+z`);
    expect(await lastBlock(page)).toBe("[parola](https://example.org/due) altra");
  });

  test('"Ask the editor": disabled without a selection, with a selection it opens the actions on the passage', async ({
    page,
    request,
  }) => {
    await setup(page, request);
    const ask = bar(page).getByRole("button", { name: "Ask the editor" });
    await expect(ask).toBeEnabled();
    await ask.click();
    await expect(page.getByRole("region", { name: "Ask the editor" })).toBeVisible();
    await page.keyboard.press("Escape");
    await view(page, (v) => v.dispatch({ selection: { anchor: v.state.doc.length } }));
    await expect(ask).toBeDisabled();
  });
});

test.describe('Source and "Notes and sources"', () => {
  test('"Cite" adds [^n] and the definition; the footnotes at the end with their type', async ({
    page,
    request,
  }) => {
    const { path } = await copyTurbo(request);
    await openApp(page, path, { mode: "write" });
    const cite = async (tab: string, act: () => Promise<void>, after: string) => {
      await view(
        page,
        (v, t: string) => {
          const at = v.state.doc.toString().indexOf(t) + t.length;
          v.dispatch({ selection: { anchor: at } });
        },
        after,
      );
      await bar(page).getByRole("button", { name: "Source" }).click();
      await page.getByRole("tab", { name: tab }).click();
      await act();
    };
    await cite(
      "Your sources",
      async () => {
        await page.getByLabel("Search your sources").fill("quantizzazione");
        const hit = page.locator(".source-passage").filter({ hasText: "fatti.md" });
        await expect(hit.locator("mark")).toHaveText("quantizzazione");
        await hit.getByRole("button", { name: "Cite" }).click();
      },
      "150 MB di RAM",
    );
    await cite(
      "Web address",
      async () => {
        await page
          .getByRole("textbox", { name: "Web address" })
          .fill("https://github.com/turbocode");
        await page.getByRole("button", { name: "Cite", exact: true }).click();
      },
      "Qwen3.6-35B-3B Q3_XSS",
    );
    await cite(
      "My estimate",
      () => page.getByRole("button", { name: "Cite as my estimate" }).click(),
      "loop autonomo completo",
    );
    const text = await docText(page);
    expect(text).toContain("150 MB di RAM[^1]");
    expect(text).toContain("Qwen3.6-35B-3B Q3_XSS[^2]");
    expect(text).toContain("loop autonomo completo[^3]");
    expect(
      text
        .trimEnd()
        .endsWith(
          "[^1]: fatti.md\n[^2]: https://github.com/turbocode\n[^3]: Valutazione dell'autore.",
        ),
    ).toBe(true);

    // At the end of the page: "Notes and sources", and the type of each note. First wait for the
    // sources to be saved in the front matter, which rewrites the start of the document.
    await expect(saveState(page)).toHaveAttribute("aria-label", "Saved", { timeout: 4000 });
    const first = page.locator(".cm-lp-fn-first");
    await expect(async () => {
      await page.locator(".cm-scroller").evaluate((el) => (el.scrollTop = el.scrollHeight));
      await expect(first).toContainText("fatti.md", { timeout: 300 });
    }).toPass();
    expect(await first.evaluate((el) => getComputedStyle(el, "::before").content)).toBe(
      '"Notes and sources"',
    );
    for (const kind of ["Source file", "Web address", "Your estimate"])
      await expect(page.getByRole("img", { name: kind })).toHaveCount(1);

    // The file and the address join the draft's sources; the text is standard Markdown.
    await expect(saveState(page)).toHaveAttribute("aria-label", "Saved", { timeout: 4000 });
    const saved = parseDraft(await readDisk(path));
    expect(saved.data.sources).toEqual(
      expect.arrayContaining(["fatti.md", "https://github.com/turbocode"]),
    );
    expect(saved.data.sources).not.toContain("Valutazione dell'autore.");
  });
});

test("every style is saved as standard Markdown and reads back the same", async ({
  page,
  request,
}) => {
  const d = await createDraft(request);
  await openApp(page, d.path, { mode: "write" });
  await page.locator(".cm-content").click();
  await page.keyboard.press(`${MOD}+End`);
  const paragraphs: [string, string][] = [
    ["Title", "# Titolo"],
    ["Heading", "## Capitolo"],
    ["Subheading", "### Paragrafetto"],
    ["Quote", "> Detto"],
    ["Bulleted list", "- Voce"],
    ["Numbered list", "1. Primo"],
    ["Code block", "```\nCodice\n```"],
  ];
  // One paragraph at a time at the end (when typing, Enter in a quote or a list would continue
  // them), then the style from the bar.
  const append = (text: string) =>
    view(
      page,
      (v, t: string) => {
        const end = v.state.doc.length;
        v.dispatch({ changes: { from: end, insert: t }, selection: { anchor: end + t.length } });
      },
      text,
    );
  await view(page, (v) => {
    const t = v.state.doc.toString();
    v.dispatch({ changes: { from: t.trimEnd().length, to: t.length } });
  });
  for (const [style, md] of paragraphs) {
    await append(`\n\n${md.replace(/^[#>\-\d. `\n]+/, "").replace(/\n```$/, "")}`);
    await format(page, style);
  }
  await append("\n\nUn grassetto, un corsivo, un codice e un link.");
  for (const [w, name] of [
    ["grassetto", "Bold"],
    ["corsivo", "Italic"],
    ["codice", "Code"],
  ] as const) {
    await selectWord(page, w);
    await format(page, name);
  }
  await selectWord(page, "link");
  await page.keyboard.press(`${MOD}+k`);
  await page.getByLabel("Link address").fill("https://example.org");
  await page.getByLabel("Link address").press("Enter");
  for (const name of ["Separator", "Table"]) {
    await bar(page).getByRole("button", { name: "More formats" }).click();
    await page.getByRole("menuitem", { name }).click();
  }

  const expected = [
    ...paragraphs.map(([, md]) => md),
    "Un **grassetto**, un *corsivo*, un `codice` e un [link](https://example.org).",
    "---",
    "| Column | Column |\n| --- | --- |\n| | |",
  ].join("\n\n");
  expect(await docText(page)).toContain(expected);
  await expect(saveState(page)).toHaveAttribute("aria-label", "Saved", { timeout: 4000 });
  const disk = await readDisk(d.path);
  expect(disk).toContain(expected);
  // The front matter stays as it was.
  expect(disk.split("\n---\n")[0]).toBe(d.text.split("\n---\n")[0]);

  // Reopened, the draft is identical and the styles come back as before.
  await page.reload();
  await page.locator(".cm-content").waitFor();
  expect(await docText(page)).toBe(disk);
  for (const cls of [
    "cm-lp-h1",
    "cm-lp-h2",
    "cm-lp-h3",
    "cm-lp-quote",
    "cm-lp-li",
    "cm-lp-codeblock",
  ])
    await expect(page.locator(`.cm-line.${cls}`).first()).toBeVisible();
  await expect(page.locator(".cm-lp-strong", { hasText: "grassetto" })).toBeVisible();
  await expect(page.locator(".cm-lp-link", { hasText: "link" })).toBeVisible();
});
