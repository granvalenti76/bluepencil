// Evaluation suite: `npm run eval [-- --pass grammar --case 01 --base-url http://…/v1 --no-write]`.
// Uses the configured model (model.baseUrl) with the real prompts and writes docs/eval-report.{md,json}.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { PASSES, type Pass } from "@desk/core";
import { loadConfig } from "../src/config.ts";
import { EVAL_PASSES, renderReport, runEval } from "../src/eval/run.ts";
import { EventBus } from "../src/events.ts";
import { ModelService } from "../src/model/service.ts";

const { values } = parseArgs({
  options: {
    "base-url": { type: "string" },
    pass: { type: "string", multiple: true },
    case: { type: "string" },
    "no-write": { type: "boolean" },
  },
});
const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const passes = (values.pass ?? EVAL_PASSES) as Pass[];
for (const p of passes) if (!PASSES.includes(p)) throw new Error(`Unknown pass: ${p}`);

const config = loadConfig();
if (values["base-url"]) config.model.baseUrl = values["base-url"];
const model = new ModelService(config, new EventBus(), { pollMs: 0 });
const status = await model.refresh();
if (!status.local.reachable) {
  console.error(`Model unreachable at ${config.model.baseUrl}: ${status.local.error ?? ""}`);
  process.exit(1);
}
console.log(`Model: ${model.modelName()} (${config.model.baseUrl})`);

const controller = new AbortController();
process.on("SIGINT", () => controller.abort());

const report = await runEval({
  root: root("fixtures/eval"),
  model,
  passes,
  only: values.case,
  signal: controller.signal,
  onCase: (c) =>
    console.log(
      `${c.pass.padEnd(9)} ${c.file.padEnd(34)} ${c.tp} right · ${c.fp} wrong · ${c.fn} missed · ${c.seconds.toFixed(1)} s${c.error ? ` · error: ${c.error}` : ""}`,
    ),
});

for (const p of report.passes) {
  const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);
  console.log(`${p.pass}: precision ${pct(p.precision)}, recall ${pct(p.recall)}`);
}
if (!values["no-write"]) {
  await writeFile(root("docs/eval-report.md"), renderReport(report));
  await writeFile(root("docs/eval-report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log("Report in docs/eval-report.md and docs/eval-report.json");
}
