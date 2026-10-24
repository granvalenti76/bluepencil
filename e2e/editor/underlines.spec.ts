import { expect, test } from "@playwright/test";
import { allMarks, markText, openLab, ORIGINAL_MARKS, posOf, withView } from "./helpers.ts";

test.describe("judgment underlines", () => {
  test.beforeEach(async ({ page }) => openLab(page));

  test("all the fake judgments are mapped onto the right text", async ({ page }) => {
    expect(await allMarks(page)).toEqual(ORIGINAL_MARKS);
    // Structure: tracked but without an underline
    await expect(page.locator('[data-j="s1"]')).toHaveCount(0);
  });

  test("pencil marks: one colour, the type reads from the shape", async ({ page }) => {
    const style = (id: string) =>
      page
        .locator(`[data-j="${id}"]`)
        .first()
        .evaluate((el) => {
          const s = getComputedStyle(el);
          return {
            line: s.textDecorationLine,
            style: s.textDecorationStyle,
            thickness: s.textDecorationThickness,
            color: s.textDecorationColor,
            offset: s.textUnderlineOffset,
          };
        });
    const pencil = "rgb(43, 79, 140)";

    // Verified: the green, solid and thin.
    expect(await style("f1")).toMatchObject({
      line: "underline",
      style: "solid",
      thickness: "1.5px",
      color: "rgb(27, 127, 85)",
      offset: "5px",
    });
    expect(await style("f4")).toMatchObject({ style: "dotted", thickness: "2px", color: pencil });
    expect(await style("g1")).toMatchObject({ style: "dotted", thickness: "2px", color: pencil });
    expect(await style("r2")).toMatchObject({ style: "wavy", thickness: "1.5px", color: pencil });
  });

  test("insertion before: the underlines follow the text", async ({ page }) => {
    const start = await posOf(page, "# Turbocode V0.6");
    await withView(
      page,
      (v: any, p: number) => v.dispatch({ changes: { from: p, insert: "PRIMA " } }),
      start,
    );
    // even right before a range: the insertion stays outside the underline
    const r1 = await posOf(page, "completamente");
    await withView(
      page,
      (v: any, p: number) => v.dispatch({ changes: { from: p, insert: "quasi " } }),
      r1,
    );

    expect(await allMarks(page)).toEqual(ORIGINAL_MARKS);
    await expect(page.getByTestId("status-r1")).toHaveText("open");
    expect(
      await withView(page, (v: any) => v.state.doc.toString().includes("quasi completamente")),
    ).toBe(true);
  });

  test("insertion after: the underlines stay where they are", async ({ page }) => {
    const r1End = (await posOf(page, "completamente")) + "completamente".length;
    await withView(
      page,
      (v: any, p: number) => v.dispatch({ changes: { from: p, insert: "!!" } }),
      r1End,
    );
    await withView(page, (v: any) =>
      v.dispatch({ changes: { from: v.state.doc.length, insert: "Coda.\n" } }),
    );

    expect(await allMarks(page)).toEqual(ORIGINAL_MARKS);
    await expect(page.getByTestId("status-r1")).toHaveText("open");
  });

  test("insertion inside: the judgment becomes stale, the others stay", async ({ page }) => {
    const mid = (await posOf(page, "si può integrare")) + 4;
    await withView(
      page,
      (v: any, p: number) => v.dispatch({ changes: { from: p, insert: "XX" } }),
      mid,
    );

    expect(await markText(page, "g1")).toBe("");
    await expect(page.getByTestId("status-g1")).toHaveText("stale");
    expect(await allMarks(page)).toEqual({ ...ORIGINAL_MARKS, g1: "" });
  });

  test("deleting inside the range makes it stale; deleting right before does not", async ({
    page,
  }) => {
    const r1 = await posOf(page, "completamente");
    await withView(
      page,
      (v: any, p: number) => v.dispatch({ changes: { from: p - 1, to: p } }),
      r1,
    );
    await expect(page.getByTestId("status-r1")).toHaveText("open");
    expect(await markText(page, "r1")).toBe("completamente");

    await withView(
      page,
      (v: any, p: number) => v.dispatch({ changes: { from: p + 3, to: p + 4 } }),
      r1 - 1,
    );
    await expect(page.getByTestId("status-r1")).toHaveText("stale");
    expect(await markText(page, "r1")).toBe("");
  });

  test('"Apply" changes the text and does not leave the judgment stale', async ({ page }) => {
    await page.getByTestId("apply-g1").click();
    expect(
      await withView(page, (v: any) =>
        v.state.doc.toString().includes("si possono integrare modelli"),
      ),
    ).toBe(true);
    await expect(page.getByTestId("status-g1")).toHaveText("applied");
    expect(await markText(page, "g1")).toBe("");
  });

  test('the "Show" chips hide the underlines by type', async ({ page }) => {
    await page.getByRole("button", { name: "Prose" }).click();
    expect(await markText(page, "r1")).toBe("");
    expect(await markText(page, "r2")).toBe("");
    expect(await markText(page, "g1")).toBe("si può integrare");
    await page.getByRole("button", { name: "Facts" }).click();
    expect(await markText(page, "f1")).toBe("");
    expect(await markText(page, "f4")).toBe("");
    await page.getByRole("button", { name: "Prose" }).click();
    await page.getByRole("button", { name: "Facts" }).click();
    expect(await allMarks(page)).toEqual(ORIGINAL_MARKS);
  });
});
