import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { EvalSuiteSchema, type Pass } from "@desk/core";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { EVAL_PASSES, prepareCase, renderReport, runEval } from "../src/eval/run.ts";
import { EventBus } from "../src/events.ts";
import { ModelService } from "../src/model/service.ts";
import { cleanupAll, makeServer } from "./helpers.ts";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  replyWith,
  replyWithTools,
  startFakeLlm,
  type ChatHandler,
  type FakeLlm,
} from "./fake-llm.ts";

const ROOT = fileURLToPath(new URL("../../../fixtures/eval", import.meta.url));
let fake: FakeLlm | undefined;
afterEach(async () => {
  await cleanupAll();
  await fake?.close();
  fake = undefined;
});

const ESITO: Record<string, string> = {
  verified: "verificato",
  to_check: "da_verificare",
  unsourced: "senza_fonte",
};

/** A "perfect" model: for every case it annotates exactly the expected judgments. */
async function oracle(): Promise<ChatHandler> {
  const answers: { text: string; notes: Record<string, unknown>[] }[] = [];
  for (const pass of EVAL_PASSES) {
    const suite = EvalSuiteSchema.parse(
      JSON.parse(readFileSync(join(ROOT, pass, "expected.json"), "utf8")),
    );
    for (const c of suite.cases) {
      const { input } = await prepareCase(pass, join(ROOT, pass, c.file));
      const notes = c.expected.map((e) =>
        pass === "grammar"
          ? { citazione: e.quote, correzione: `${e.quote}!` }
          : pass === "prose"
            ? { citazione: e.quote, problema: "p" }
            : { citazione: e.quote, esito: ESITO[e.type ?? ""] ?? "senza_fonte" },
      );
      answers.push({ text: `<<<\n${input.text}\n>>>`, notes });
    }
  }
  return (body) => {
    const user = (body.messages as { content: string }[]).at(-1)!.content;
    const a = answers.find((x) => user.includes(x.text));
    return replyWithTools((a?.notes ?? []).map((args) => ({ name: "annota", args })));
  };
}

async function service(chat: ChatHandler) {
  fake = await startFakeLlm({ chat });
  const model = new ModelService(
    { ...DEFAULT_CONFIG, model: { baseUrl: fake.url } },
    new EventBus(),
    { pollMs: 0, env: {} },
  );
  await model.refresh();
  return model;
}

describe("evaluation suite", () => {
  it("at least 8 cases per analysis, with expected quotes present in the text", async () => {
    const report = await runEval({ root: ROOT, model: await service(await oracle()) });
    for (const pass of EVAL_PASSES) {
      const p = report.passes.find((x) => x.pass === pass)!;
      expect(p.cases).toBeGreaterThanOrEqual(8);
      // With the expected answers: all correct (also checks the suite's format).
      expect(p, pass).toMatchObject({ fp: 0, fn: 0, discarded: 0, errors: 0, enabled: true });
      expect(p.tp).toBeGreaterThan(0);
    }
    expect(report.partial).toBe(false);
    expect(report.model).toBe("fake-model");
  });

  it("a model that finds nothing: recall 0, precision undefined", async () => {
    const report = await runEval({
      root: ROOT,
      model: await service(() => replyWith("[]")),
      passes: ["grammar"] as Pass[],
    });
    expect(report.passes[0]).toMatchObject({ tp: 0, fp: 0, precision: null, recall: 0 });
    expect(report.partial).toBe(true);
    const md = renderReport(report);
    expect(md).toContain("| Grammar | 8 |");
    expect(md).toContain("Missed: «un'altro»");
  });

  it("wrong notes lower the precision", async () => {
    const report = await runEval({
      root: ROOT,
      model: await service(() =>
        replyWithTools([{ name: "annota", args: { citazione: "e", problema: "p" } }]),
      ),
      passes: ["prose"] as Pass[],
      only: "01",
    });
    expect(report.cases).toHaveLength(1);
    expect(report.passes[0]).toMatchObject({ fp: 1, precision: 0 });
  });

  it("the facts sources and the footnotes reach the prompt", async () => {
    const { input } = await prepareCase("facts", join(ROOT, "facts", "04-nota-a-pie.md"));
    expect(input.sources![0]!.text).toContain("- Il server gestisce fino a 64 connessioni");
    expect(input.footnotes).toEqual([{ id: "1", text: "fonti/lumen.md" }]);
    // The text is the whole draft, footnote definitions included.
    expect(input.text).toContain("[^1]: fonti/lumen.md");
  });
});

describe("GET /api/eval", () => {
  it("report summary for the chips; without a report, null", async () => {
    const file = join(tmpdir(), `desk-eval-${process.pid}.json`);
    const report = await runEval({
      root: ROOT,
      model: await service(() => replyWith("[]")),
      passes: ["prose"] as Pass[],
      only: "01",
    });
    await writeFile(file, JSON.stringify(report));
    const s = await makeServer({ evalReport: file });
    const r = (await s.inject({ method: "GET", url: "/api/eval" })).json();
    expect(r.report).toMatchObject({ model: "fake-model", partial: true });
    expect(r.report.passes).toEqual([{ pass: "prose", precision: null, recall: 0, enabled: true }]);
    const none = await makeServer({ evalReport: join(tmpdir(), "non-esiste.json") });
    expect((await none.inject({ method: "GET", url: "/api/eval" })).json()).toEqual({
      report: null,
    });
  });
});
