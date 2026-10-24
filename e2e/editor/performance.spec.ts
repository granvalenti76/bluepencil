import { expect, test } from "@playwright/test";
import { openLab, withView } from "./helpers.ts";

// 5,000 words and 100 decorations without visible lag. The time of an edit (dispatch + frame
// rendering) is a measurable approximation; the thresholds are generous because headless browsers
// are noisy. The real feel is judged by hand.
test("5,000 words and 100 underlines: typing stays smooth", async ({ page }) => {
  await openLab(page, "?stress=1");

  const stats = await withView(page, async (v: any) => {
    const words = v.state.doc.toString().split(/\s+/).length;
    const times: number[] = [];
    let pos = Math.floor(v.state.doc.length / 2);
    const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
    v.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    await frame();
    for (let i = 0; i < 80; i++) {
      const t0 = performance.now();
      v.dispatch({
        changes: { from: pos, insert: "a" },
        selection: { anchor: pos + 1 },
        userEvent: "input.type",
      });
      await frame();
      times.push(performance.now() - t0);
      pos++;
    }
    times.sort((a, b) => a - b);
    return {
      words,
      judgments: (window as any).__lab.judgmentCount as number,
      median: times[40]!,
      p95: times[75]!,
    };
  });

  expect(stats.words).toBeGreaterThan(5000);
  expect(stats.judgments).toBe(100);
  expect(stats.median).toBeLessThan(25);
  expect(stats.p95).toBeLessThan(80);
});

test("same load with Focus on", async ({ page }) => {
  await openLab(page, "?stress=1");
  await page.getByRole("button", { name: "Focus" }).click();
  const times = await withView(page, async (v: any) => {
    const out: number[] = [];
    let pos = Math.floor(v.state.doc.length / 2);
    const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
    for (let i = 0; i < 60; i++) {
      const t0 = performance.now();
      v.dispatch({
        changes: { from: pos, insert: "a" },
        selection: { anchor: pos + 1 },
        userEvent: "input.type",
      });
      await frame();
      out.push(performance.now() - t0);
      pos++;
    }
    return out.sort((a, b) => a - b);
  });
  expect(times[30]!).toBeLessThan(25);
  expect(times[57]!).toBeLessThan(80);
});
