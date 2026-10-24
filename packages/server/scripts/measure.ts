// Non-functional measurements: `npm run measure [-- --no-write]`.
// Server with 200 indexed drafts, startup until the tab is ready, a tab with a 5,000-word draft
// and 100 notes, typing latency. Writes the results to docs/measures.md.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { countWords, parseDraft, type Judgment } from "@desk/core";
import { DraftsRepo } from "../src/drafts/repo.ts";
import { IndexDb } from "../src/index-db/index.ts";
import { JudgmentsStore } from "../src/index-db/judgments.ts";

const { values } = parseArgs({ options: { "no-write": { type: "boolean" } } });
const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const TOKEN = "measure-token";
const LIMITS = { serverMb: 120, startupMs: 2000, tabMb: 150 };

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
const rssMb = (pid: number) =>
  Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim()) / 1024;
/** RSS of the "renderer" processes descending from `pid` (the tab). */
function rendererMb(pid: number): number {
  return renderers(pid).reduce((a, r) => a + r, 0) / 1024;
}
/** A renderer process stays alive for every open page: measure with a single page. */
function renderers(pid: number): number[] {
  const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid=,rss=,command="], { encoding: "utf8" })
    .split("\n")
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l))
    .filter((m) => m !== null)
    .map((m) => ({ pid: +m[1]!, ppid: +m[2]!, rss: +m[3]!, cmd: m[4]! }));
  const mine = new Set([pid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const r of rows) {
      if (mine.has(r.ppid) && !mine.has(r.pid)) {
        mine.add(r.pid);
        grew = true;
      }
    }
  }
  return rows.filter((r) => mine.has(r.pid) && r.cmd.includes("--type=renderer")).map((r) => r.rss);
}

console.log("Building the interface…");
execFileSync("npm", ["run", "build"], { cwd: root("."), stdio: "ignore" });

// 1. Folder with 200 drafts, plus a long draft (5,000 words).
const dir = await mkdtemp(join(tmpdir(), "desk-measure-"));
await cp(root("fixtures/drafts"), dir, { recursive: true });
const turbo = await readFile(root("fixtures/drafts/turbocode-draft-12-settembre.md"), "utf8");
for (let i = 1; i <= 200; i++) {
  await writeFile(
    join(dir, `bozza-${String(i).padStart(3, "0")}.md`),
    turbo.replace("title: Turbocode V0.6", `title: Bozza ${i}`).replace(/Turbocode/g, `Prova${i}`),
  );
}
const { body } = parseDraft(turbo);
const paras = body.split("\n\n").filter((p) => p.length > 200);
let long = turbo.replace("title: Turbocode V0.6", "title: Bozza lunga").trimEnd() + "\n";
for (let i = 0; countWords(parseDraft(long).body) < 5000; i++)
  long += `\n${paras[i % paras.length]}\n`;
await writeFile(join(dir, "lunga.md"), long);
const longWords = countWords(parseDraft(long).body);

const config = join(dir, "..", `desk-measure-${process.pid}.json`);
const port = await freePort();
await writeFile(config, JSON.stringify({ model: { baseUrl: "http://127.0.0.1:9/v1" } }));
const env = {
  ...process.env,
  DESK_CONFIG: config,
  DESK_DRAFTS_DIR: dir,
  DESK_PORT: String(port),
  DESK_TOKEN: TOKEN,
  DESK_STATIC: "1",
  DESK_EVAL_REPORT: join(dir, "no-report.json"),
};
const base = `http://127.0.0.1:${port}`;

async function startServer(): Promise<{ proc: ChildProcess; readyMs: number }> {
  const t0 = performance.now();
  const proc = spawn("node", [root("packages/server/src/index.ts")], { env, stdio: "ignore" });
  for (;;) {
    try {
      const r = await fetch(`${base}/api/health`, { headers: { "X-Desk-Token": TOKEN } });
      if (r.ok) return { proc, readyMs: performance.now() - t0 };
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}
const stop = async (proc: ChildProcess) => {
  proc.kill("SIGTERM");
  await new Promise((r) => proc.once("exit", r));
};

const browserServer = await chromium.launchServer();
const browser = await chromium.connect(browserServer.wsEndpoint());
const results: string[] = [];
const row = (what: string, value: string, limit: string, ok: boolean | null) => {
  results.push(`| ${what} | ${value} | ${limit} | ${ok === null ? "—" : ok ? "yes" : "**no**"} |`);
  console.log(`${what}: ${value}${ok === false ? "  (OVER THE LIMIT)" : ""}`);
};

async function openTab(path: string) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const t0 = performance.now();
  await page.goto(`${base}/?d=${encodeURIComponent(path)}#t=${TOKEN}`);
  await page.locator(".cm-content").waitFor();
  return { page, ms: performance.now() - t0 };
}

try {
  // 2. Cold start (index to build) and warm start, until the tab is ready.
  const cold = await startServer();
  const coldTab = await openTab("turbocode-draft-12-settembre.md");
  const coldTotal = cold.readyMs + coldTab.ms;
  await coldTab.page.waitForTimeout(500);
  const smallTabMb = rendererMb(browserServer.process().pid!);
  await coldTab.page.close();
  const indexedRss = rssMb(cold.proc.pid!);
  await stop(cold.proc);

  // 100 notes on the long draft, written to the index as the review would save them.
  const index = new IndexDb(dir);
  await index.scan(new DraftsRepo(dir));
  const store = new JudgmentsStore(index);
  const longBody = parseDraft(long).body;
  const words = [...longBody.matchAll(/\p{L}{5,}/gu)];
  const passes = ["grammar", "prose", "facts"] as const;
  for (let i = 0; i < 100; i++) {
    const m = words[Math.floor(((i + 0.5) * words.length) / 100)]!;
    const from = m.index;
    const to = from + m[0].length;
    const pass = passes[i % 3]!;
    const j: Judgment = {
      id: `m${String(i).padStart(3, "0")}`,
      draftPath: "lunga.md",
      pass,
      kind: "prova",
      quote: m[0],
      title: `Nota ${i + 1}`,
      rationale: "Nota di prova per le misure.",
      proposal: { action: "replace", text: m[0].toUpperCase(), label: "Applica" },
      ...(pass === "facts" ? { factStatus: "unsourced" as const } : {}),
      range: { from, to },
      anchor: {
        quote: m[0],
        prefix: longBody.slice(Math.max(0, from - 32), from),
        suffix: longBody.slice(to, to + 32),
      },
      status: "open",
      chunkHash: "misure",
      model: "misure",
      promptVersion: "1",
      createdAt: new Date().toISOString(),
    };
    store.insert(j);
  }
  index.close();

  // Baseline: a Chromium renderer with an empty page.
  const blank = await browser.newPage();
  await blank.goto("about:blank");
  await blank.waitForTimeout(500);
  const blankMb = rendererMb(browserServer.process().pid!);
  await blank.close();

  const warm = await startServer();
  const { page, ms: tabMs } = await openTab("lunga.md");
  const warmTotal = warm.readyMs + tabMs;
  await page.locator(".note").first().waitFor();
  const notes = await page.locator(".note").count();

  // Typing latency: from the key to the second frame after (the text is on screen).
  // The code runs in the page (DOM), not in Node: it is passed as text.
  await page.evaluate(`
    window.__lat = [];
    document.addEventListener("keydown", () => {
      const t = performance.now();
      requestAnimationFrame(() => requestAnimationFrame(() => window.__lat.push(performance.now() - t)));
    }, true);
  `);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+End");
  for (const ch of " Una frase scritta per misurare la latenza di digitazione.") {
    await page.keyboard.type(ch);
  }
  await page.waitForTimeout(300);
  const lat = ((await page.evaluate("window.__lat")) as number[]).sort((a, b) => a - b);
  const median = lat[Math.floor(lat.length / 2)] ?? 0;
  const p95 = lat[Math.floor(lat.length * 0.95)] ?? 0;

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const metrics = (await cdp.send("Performance.getMetrics")).metrics;
  const heapMb = (metrics.find((m) => m.name === "JSHeapUsedSize")?.value ?? 0) / 1024 / 1024;
  const tabMb = rendererMb(browserServer.process().pid!);
  const tabProcs = renderers(browserServer.process().pid!).length;
  await page.waitForTimeout(1200); // autosave
  const serverRss = rssMb(warm.proc.pid!);
  await stop(warm.proc);

  row(
    "Server: RSS with 202 indexed files (cold)",
    `${indexedRss.toFixed(0)} MB`,
    `< ${LIMITS.serverMb} MB`,
    indexedRss < LIMITS.serverMb,
  );
  row(
    "Server: RSS with the long draft open and saved",
    `${serverRss.toFixed(0)} MB`,
    `< ${LIMITS.serverMb} MB`,
    serverRss < LIMITS.serverMb,
  );
  row(
    "Cold start (index to build) until the tab is ready",
    `${(coldTotal / 1000).toFixed(2)} s (server ${(cold.readyMs / 1000).toFixed(2)} s)`,
    `< ${LIMITS.startupMs / 1000} s`,
    coldTotal < LIMITS.startupMs,
  );
  row(
    "Warm start until the tab is ready (long draft)",
    `${(warmTotal / 1000).toFixed(2)} s (server ${(warm.readyMs / 1000).toFixed(2)} s)`,
    `< ${LIMITS.startupMs / 1000} s`,
    warmTotal < LIMITS.startupMs,
  );
  row(
    `Tab: memory of the renderer processes (${longWords} words, ${notes} notes)`,
    `${tabMb.toFixed(0)} MB (${tabProcs} process(es))`,
    `< ${LIMITS.tabMb} MB`,
    tabMb < LIMITS.tabMb,
  );
  row(
    "Baseline: tab with the Turbocode draft (~810 words, no notes)",
    `${smallTabMb.toFixed(0)} MB`,
    "—",
    null,
  );
  row("Baseline: renderer with an empty page", `${blankMb.toFixed(0)} MB`, "—", null);
  row("Tab: JavaScript heap used", `${heapMb.toFixed(0)} MB`, "—", null);
  row(
    "Typing: from key to frame, median / 95th",
    `${median.toFixed(0)} / ${p95.toFixed(0)} ms`,
    "no perceptible delay (≈ < 50 ms)",
    p95 < 50,
  );
} finally {
  await browser.close();
  await browserServer.close();
  await rm(dir, { recursive: true, force: true });
  await rm(config, { force: true });
}

const md = `# Measurements

Generated by \`npm run measure\` on ${new Date().toISOString()} on ${process.platform} ${process.arch}, Node ${process.version}, Playwright's Chromium. The model is not involved (closed port).

| Measure | Value | Limit | Within |
| --- | --- | --- | --- |
${results.join("\n")}

Notes:
- 200 drafts generated from the Turbocode draft (~810 words each) plus the fixtures; the long draft repeats Turbocode paragraphs; the 100 notes are written directly to the index.
- "Start" goes from the command \`node packages/server/src/index.ts\` (build excluded) to the tab with the editor loaded; the browser is already open.
- The tab's memory is the RSS of Chromium's renderer processes (WebKit/Safari does not expose the same measure).
- Latency is measured in the page, from \`keydown\` to the second frame after it.
`;
if (!values["no-write"]) {
  await writeFile(root("docs/measures.md"), md);
  console.log("Results in docs/measures.md");
}
