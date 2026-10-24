import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { parseDraft, publishText } from "@desk/core";
import { expandHome, type Config } from "../config.ts";
import type { DraftsRepo } from "../drafts/repo.ts";

export class PublishError extends Error {
  code: "not_configured" | "changed" | "git" | "push";
  constructor(code: PublishError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

interface Git {
  stdout: string;
  code: number;
}

function git(cwd: string, args: string[], allowCodes = [0]): Promise<Git> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", cwd, ...args],
      // No password prompts from the terminal: a push without credentials fails at once.
      { timeout: 60_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, maxBuffer: 8 << 20 },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === "number" ? err.code : -1) : 0;
        if (allowCodes.includes(code)) resolve({ stdout, code });
        else reject(new PublishError("git", (stderr || err?.message || "").trim()));
      },
    );
  });
}

export interface PublishPreview {
  title: string;
  /** The published file, in full (with `~` for the home folder). */
  file: string;
  /** File name in the repository (for the diff and the commit), or just the name without git. */
  target: string;
  /** The folder is in a git repository: publishing also commits. */
  git: boolean;
  content: string;
  /** Unified diff against the file already published (all new if there was none). */
  diff: string;
  changed: boolean;
  isNew: boolean;
  removedNotes: { id: string; text: string }[];
  /** Fingerprint of the draft as read: `publish` refuses if it has changed in the meantime. */
  draftHash: string;
  /** Push is possible (git and `publish.push`); the author decides anyway. */
  canPush: boolean;
}

/**
 * Publishing: copies the cleaned-up draft into the chosen folder. If the folder is in a git
 * repository, commits the published file only; pushes only if `publish.push` is true and the
 * author confirms.
 */
export class Publisher {
  private readonly cfg: Config["publish"];
  private readonly repo: DraftsRepo;
  /** One publish at a time: two commits together would fight over git's index. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(cfg: Config["publish"], repo: DraftsRepo) {
    this.cfg = cfg;
    this.repo = repo;
  }

  status() {
    return { configured: this.cfg.dir.trim() !== "", push: this.cfg.push };
  }

  private async where(
    path: string,
  ): Promise<{ root: string; target: string; abs: string; git: boolean }> {
    if (!this.cfg.dir.trim()) {
      throw new PublishError("not_configured", "Choose the folder to publish to.");
    }
    const dir = resolve(expandHome(this.cfg.dir));
    const abs = join(dir, basename(path));
    // The folder may not exist yet: the repository is looked up from the first one that exists.
    let existing = dir;
    while (!(await isDir(existing)) && dirname(existing) !== existing) existing = dirname(existing);
    const prefix = await git(existing, ["rev-parse", "--show-prefix"]).catch(() => null);
    if (!prefix) return { root: dir, target: basename(path), abs, git: false };
    const top = (await git(existing, ["rev-parse", "--show-toplevel"])).stdout.trim();
    // `--show-prefix` avoids comparing paths with and without symbolic links (/var and /private/var).
    const target = join(prefix.stdout.trim(), relative(existing, abs));
    return { root: top, target, abs, git: true };
  }

  async preview(path: string): Promise<PublishPreview> {
    const file = await this.repo.read(path); // the draft's path first (400/404)
    const { target, abs, git } = await this.where(path);
    const { text: content, removedNotes } = publishText(file.text);
    const old = await readFile(abs, "utf8").catch(() => null);
    return {
      title: parseDraft(file.text).data.title ?? basename(path, ".md"),
      file: tilde(abs),
      target,
      git,
      content,
      diff: old === content ? "" : await unifiedDiff(target, old ?? "", content),
      changed: old !== content,
      isNew: old === null,
      removedNotes,
      draftHash: file.hash,
      canPush: git && this.cfg.push,
    };
  }

  publish(path: string, opts: { draftHash: string; push?: boolean }): Promise<PublishResult> {
    const next = this.queue.then(() => this.publishNow(path, opts));
    this.queue = next.catch(() => {});
    return next;
  }

  private async publishNow(
    path: string,
    opts: { draftHash: string; push?: boolean },
  ): Promise<PublishResult> {
    const p = await this.preview(path);
    if (p.draftHash !== opts.draftHash) {
      throw new PublishError(
        "changed",
        "The draft changed after the preview: check the diff again.",
      );
    }
    const { root, abs } = await this.where(path);
    let commit: string | null = null;
    if (p.changed) {
      await mkdir(dirname(abs), { recursive: true });
      const tmp = `${abs}.desk-${process.pid}.tmp`;
      await writeFile(tmp, p.content);
      await rename(tmp, abs);
    }
    if (p.git && (p.changed || !(await tracked(root, p.target)))) {
      await git(root, ["add", "--", p.target]);
      const staged = await git(root, ["diff", "--cached", "--quiet", "--", p.target], [0, 1]);
      if (staged.code === 1) {
        // Only the published file: the author's other changes in the repository stay out.
        await git(root, ["commit", "-q", "-m", `Pubblica: ${p.title}`, "--", p.target]);
        commit = (await git(root, ["rev-parse", "--short", "HEAD"])).stdout.trim();
      }
    }
    let pushed = false;
    if (opts.push) {
      if (!p.canPush) throw new PublishError("push", "Push is not enabled for this folder.");
      try {
        await git(root, ["push", "-q"]);
      } catch (e) {
        throw new PublishError("push", `Committed, but the push failed: ${(e as Error).message}`);
      }
      pushed = true;
    }
    return { file: p.file, target: p.target, git: p.git, commit, pushed };
  }
}

export interface PublishResult {
  file: string;
  target: string;
  git: boolean;
  commit: string | null;
  pushed: boolean;
}

async function isDir(p: string): Promise<boolean> {
  return (await stat(p).catch(() => null))?.isDirectory() ?? false;
}

function tilde(p: string): string {
  const home = homedir();
  return p === home || p.startsWith(home + "/") ? "~" + p.slice(home.length) : p;
}

async function tracked(root: string, target: string): Promise<boolean> {
  const r = await git(root, ["ls-files", "--error-unmatch", "--", target], [0, 1]);
  return r.code === 0;
}

/**
 * Unified diff with `git diff --no-index` on two temporary files, with the real file's headers.
 * Works outside a repository too; without git installed, no diff.
 */
async function unifiedDiff(target: string, a: string, b: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "desk-publish-"));
  try {
    await writeFile(join(dir, "a"), a);
    await writeFile(join(dir, "b"), b);
    const r = await git(
      dir,
      ["diff", "--no-index", "--no-color", "--no-ext-diff", "--", join(dir, "a"), join(dir, "b")],
      [0, 1],
    );
    const hunks = r.stdout.slice(r.stdout.indexOf("\n@@") + 1);
    return r.stdout.includes("\n@@") ? `--- a/${target}\n+++ b/${target}\n${hunks}` : "";
  } catch {
    return "";
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
