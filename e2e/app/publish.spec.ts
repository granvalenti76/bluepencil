import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { E2E_BLOG_DIR, E2E_BLOG_REMOTE } from "../env.ts";
import { copyTurbo, openApp } from "./helpers.ts";

test.use({ viewport: { width: 1440, height: 900 } });

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

test.describe("publishing", () => {
  test("diff, then a commit of the file alone in the blog's repository", async ({
    page,
    request,
  }) => {
    const { path } = await copyTurbo(request);
    await openApp(page, path);
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Publish…" }).click();
    const dialog = page.getByRole("dialog", { name: "Publish" });
    await expect(dialog).toContainText(`content/posts/${path}`);
    await expect(dialog).toContainText("(new file)");
    await expect(dialog).toContainText("git repository");
    const diff = dialog.getByLabel("Differenze");
    await expect(diff).toContainText("+title: Turbocode V0.6");
    await expect(diff).not.toContainText("archetype");
    await expect(diff.locator('[data-kind="add"]').first()).toBeVisible();

    await dialog.getByRole("button", { name: "Publish (commit)" }).click();
    await expect(dialog.getByRole("status")).toContainText("Published: commit");
    const published = await readFile(join(E2E_BLOG_DIR, "content/posts", path), "utf8");
    expect(published.startsWith("---\ntitle: Turbocode V0.6\n---\n")).toBe(true);
    expect(git(E2E_BLOG_DIR, "log", "--format=%s", "-n", "20")).toContain(
      "Pubblica: Turbocode V0.6",
    );
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);

    // Again, without changes: nothing to send.
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Publish…" }).click();
    await expect(dialog).toContainText("Already published");
  });

  test("push only after confirmation", async ({ page, request }) => {
    const { path } = await copyTurbo(request);
    await openApp(page, path);
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Publish…" }).click();
    const dialog = page.getByRole("dialog", { name: "Publish" });
    await dialog.getByRole("button", { name: "Publish and push…" }).click();
    await expect(dialog.getByRole("alert")).toContainText("git push");
    expect(git(E2E_BLOG_DIR, "ls-files", `content/posts/${path}`)).toBe(""); // not yet
    await dialog.getByRole("button", { name: "Yes, commit and push" }).click();
    await expect(dialog.getByRole("status")).toContainText("pushed");
    expect(git(E2E_BLOG_REMOTE, "ls-tree", "-r", "--name-only", "main")).toContain(
      `content/posts/${path}`,
    );
  });

  test('"Change folder…": the Finder chooses, then the preview again', async ({
    page,
    request,
  }) => {
    const { path } = await copyTurbo(request);
    await openApp(page, path);
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Publish…" }).click();
    const dialog = page.getByRole("dialog", { name: "Publish" });
    await dialog.getByRole("button", { name: "Change folder…" }).click();
    const field = dialog.getByLabel("Where should published articles go?");
    await field.fill("");
    await expect(dialog.getByRole("button", { name: "Use this folder" })).toBeDisabled();
    await dialog.getByRole("button", { name: "Choose…" }).click();
    await expect(field).toHaveValue(/content\/posts$/);
    await dialog.getByRole("button", { name: "Use this folder" }).click();
    await expect(dialog).toContainText(`content/posts/${path}`);
    await expect(dialog.getByRole("button", { name: "Publish (commit)" })).toBeVisible();
  });
});
