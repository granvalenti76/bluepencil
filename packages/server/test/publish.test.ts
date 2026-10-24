import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupAll, makeServer } from "./helpers.ts";

const TURBO = "turbocode-draft-12-settembre.md";
const dirs: string[] = [];
afterEach(async () => {
  await cleanupAll();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

async function blogRepo(withRemote = false) {
  const dir = await mkdtemp(join(tmpdir(), "desk-blog-"));
  dirs.push(dir);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.name", "Prova");
  git(dir, "config", "user.email", "prova@example.org");
  await writeFile(join(dir, "README.md"), "Blog\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "inizio");
  let remote: string | undefined;
  if (withRemote) {
    remote = await mkdtemp(join(tmpdir(), "desk-remote-"));
    dirs.push(remote);
    git(remote, "init", "-q", "--bare", "-b", "main");
    git(dir, "remote", "add", "origin", remote);
    git(dir, "push", "-q", "-u", "origin", "main");
  }
  return { dir, remote };
}

async function setup(push = false, withRemote = false) {
  const { dir, remote } = await blogRepo(withRemote);
  const s = await makeServer({
    config: { publish: { dir: join(dir, "content/posts"), push } },
  });
  const preview = async (path = TURBO) => s.inject({ method: "GET", url: `/api/publish/${path}` });
  const publish = async (payload: object, path = TURBO) =>
    s.inject({ method: "POST", url: `/api/publish/${path}`, payload });
  return { s, dir, remote, preview, publish };
}

describe("publishing", () => {
  it("preview: target file, diff, no writes", async () => {
    const { dir, preview } = await setup();
    const p = (await preview()).json();
    expect(p).toMatchObject({
      target: `content/posts/${TURBO}`,
      git: true,
      isNew: true,
      changed: true,
      title: "Turbocode V0.6",
      canPush: false,
    });
    expect(p.diff).toContain(`+++ b/content/posts/${TURBO}`);
    expect(p.diff).toContain("+title: Turbocode V0.6");
    expect(p.diff).not.toContain("archetype");
    expect(git(dir, "status", "--porcelain")).toBe("");
  });

  it("commit of the published file only, «Pubblica: <titolo>»; republishing without changes makes no commit", async () => {
    const { dir, preview, publish } = await setup();
    await writeFile(join(dir, "altro.md"), "lavoro in corso\n"); // must not end up in the commit
    git(dir, "add", "altro.md");
    const p = (await preview()).json();
    const r = await publish({ draftHash: p.draftHash });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ target: `content/posts/${TURBO}`, pushed: false });
    expect(r.json().commit).toMatch(/^[0-9a-f]{7,}$/);
    expect(git(dir, "log", "-1", "--format=%s")).toBe("Pubblica: Turbocode V0.6");
    expect(git(dir, "show", "--name-only", "--format=", "HEAD")).toBe(`content/posts/${TURBO}`);
    expect(git(dir, "status", "--porcelain")).toBe("A  altro.md");
    const out = await readFile(join(dir, "content/posts", TURBO), "utf8");
    expect(out.startsWith("---\ntitle: Turbocode V0.6\n---\n# Turbocode V0.6")).toBe(true);

    const again = (await preview()).json();
    expect(again).toMatchObject({ changed: false, isNew: false, diff: "" });
    expect((await publish({ draftHash: again.draftHash })).json().commit).toBeNull();
  });

  it("draft changed after the preview → 409", async () => {
    const { s, preview, publish } = await setup();
    const p = (await preview()).json();
    const file = join(s.dir, TURBO);
    await writeFile(file, (await readFile(file, "utf8")) + "\nAggiunta.\n");
    const r = await publish({ draftHash: p.draftHash });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("changed");
  });

  it("push only if configured and requested", async () => {
    const { remote, preview, publish } = await setup(true, true);
    const p = (await preview()).json();
    expect(p.canPush).toBe(true);
    const r = (await publish({ draftHash: p.draftHash })).json();
    expect(r.pushed).toBe(false);
    expect(git(remote!, "log", "-1", "--format=%s", "main")).toBe("inizio");
    const r2 = (await publish({ draftHash: p.draftHash, push: true })).json();
    expect(r2.pushed).toBe(true);
    expect(git(remote!, "log", "-1", "--format=%s", "main")).toBe("Pubblica: Turbocode V0.6");
  });

  it("push not configured → refused; failing push → 502 with the commit made", async () => {
    const off = await setup(false);
    const p = (await off.preview()).json();
    expect((await off.publish({ draftHash: p.draftHash, push: true })).statusCode).toBe(502);

    const on = await setup(true, false); // no remote
    const p2 = (await on.preview()).json();
    const r = await on.publish({ draftHash: p2.draftHash, push: true });
    expect(r.statusCode).toBe(502);
    expect(r.json().message).toContain("Committed, but the push failed");
    expect(git(on.dir, "log", "-1", "--format=%s")).toBe("Pubblica: Turbocode V0.6");
  });

  it('not configured → 409 "not_configured"', async () => {
    const s = await makeServer();
    const r = await s.inject({ method: "GET", url: `/api/publish/${TURBO}` });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("not_configured");
    expect((await s.inject({ method: "GET", url: "/api/publish/..%2Fx.md" })).statusCode).toBe(400);
  });

  it("folder without git (even one to create): copies the file, no commit or push", async () => {
    const plain = await mkdtemp(join(tmpdir(), "desk-plain-"));
    dirs.push(plain);
    const out = join(plain, "blog", "post");
    const s = await makeServer({ config: { publish: { dir: out, push: true } } });
    const p = (await s.inject({ method: "GET", url: `/api/publish/${TURBO}` })).json();
    expect(p).toMatchObject({ git: false, target: TURBO, isNew: true, canPush: false });
    expect(p.file.endsWith(`/blog/post/${TURBO}`)).toBe(true);
    expect(p.diff).toContain("+title: Turbocode V0.6");
    const r = await s.inject({
      method: "POST",
      url: `/api/publish/${TURBO}`,
      payload: { draftHash: p.draftHash },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ git: false, commit: null, pushed: false });
    const text = await readFile(join(out, TURBO), "utf8");
    expect(text.startsWith("---\ntitle: Turbocode V0.6\n---\n")).toBe(true);
    const push = await s.inject({
      method: "POST",
      url: `/api/publish/${TURBO}`,
      payload: { draftHash: p.draftHash, push: true },
    });
    expect(push.statusCode).toBe(502);
  });

  it("the chosen folder is the repository root", async () => {
    const { dir } = await blogRepo();
    const s = await makeServer({ config: { publish: { dir, push: false } } });
    const p = (await s.inject({ method: "GET", url: `/api/publish/${TURBO}` })).json();
    expect(p).toMatchObject({ git: true, target: TURBO });
    await s.inject({
      method: "POST",
      url: `/api/publish/${TURBO}`,
      payload: { draftHash: p.draftHash },
    });
    expect(git(dir, "show", "--name-only", "--format=", "HEAD")).toBe(TURBO);
  });
});
