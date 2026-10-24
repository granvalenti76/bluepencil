// Probe of the real LLM server: `npm run probe [-- --base-url http://…/v1] [--no-write]`.
// Measures how the server behaves (slots, cache, reasoning) and writes the results to
// docs/model-probe.md.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  buildMessages,
  archetypeIn,
  ModelClient,
  parseDraft,
  readAnalysis,
  reviewTools,
  slotFor,
  type ChatResult,
  type DraftContext,
  type ReviewInput,
  type ReviewStep,
} from "@desk/core";
import { loadConfig } from "../src/config.ts";
import { Languages } from "../src/languages.ts";
import { REVIEW_MAX_TOKENS, REVIEW_TEMPERATURE } from "../src/review/runner.ts";

const { values } = parseArgs({
  options: { "base-url": { type: "string" }, "no-write": { type: "boolean" } },
});
const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const baseUrl = values["base-url"] ?? loadConfig().model.baseUrl;
const client = new ModelClient({ endpoint: { kind: "local", baseUrl } });
const lines: string[] = [];
const say = (s = "") => {
  console.log(s);
  lines.push(s);
};

const text = await readFile(root("fixtures/drafts/turbocode-draft-12-settembre.md"), "utf8");
const facts = await readFile(root("fixtures/drafts/fatti.md"), "utf8");
const { data, body } = parseDraft(text);
const pack = new Languages().forDraft(data.lang);
const ctx: DraftContext = {
  pack,
  title: data.title,
  archetype: archetypeIn(pack, data.archetype),
  target: data.target,
  outline: data.outline ?? [],
  brief: data.brief,
  glossary: data.glossary ?? [],
  style: data.style ?? [],
  ignored: [],
};

say(`# Probe of the real server — results`);
say();
say(`Run on ${new Date().toISOString()} against \`${baseUrl}\`.`);
say();

let models: string[];
try {
  models = await client.listModels();
} catch (e) {
  say(`**Server unreachable:** ${(e as Error).message}`);
  await finish();
  process.exit(1);
}
say(`- Model from \`/models\`: **${models.join(", ") || "(none)"}**`);
const props = await client.props();
say(
  `- \`/props\`: ${props ? `slots ${props.totalSlots ?? "?"}, context ${props.nCtx ?? "?"} tokens` : "not available"}`,
);
const tok = await client.countTokens("Turbocode è un agent harness locale per macOS.");
say(
  `- \`/tokenize\`: ${tok.exact ? `available (${tok.count} tokens for the test sentence)` : "not available, the estimate is used"}`,
);
const slot = props?.totalSlots
  ? slotFor("turbocode-draft-12-settembre.md", props.totalSlots)
  : undefined;
say(`- \`id_slot\` used: ${slot ?? "none"}`);
say();

interface Row {
  label: string;
  r?: ChatResult;
  ok: string;
  format?: string;
}
const rows: Row[] = [];

async function run(label: string, step: ReviewStep, input: ReviewInput) {
  const messages = buildMessages(step, ctx, input);
  try {
    const r = await client.chat({
      messages,
      tools: reviewTools(pack, step, input),
      temperature: REVIEW_TEMPERATURE,
      maxTokens: REVIEW_MAX_TOKENS,
      slot,
    });
    const format = r.reasoning
      ? r.reasoningTokens > 0
        ? "reasoning_content or <think>"
        : "?"
      : "no separate reasoning";
    let ok: string;
    try {
      const a = readAnalysis(step, r, pack);
      const via = r.toolCalls.length ? `${r.toolCalls.length} tool calls` : "JSON in the text";
      ok = `${a.judgments.length} notes (${via})${a.score ? `, score ${a.score.value}` : ""}${a.dropped ? `, ${a.dropped} discarded` : ""}`;
    } catch (e) {
      ok = r.finishReason === "length" ? "truncated" : `unreadable: ${(e as Error).message}`;
    }
    rows.push({ label, r, ok, format });
  } catch (e) {
    rows.push({ label, ok: `error: ${(e as Error).message}` });
  }
}

// Like the review: every analysis reads the whole text; the start (system, context, text) is the
// same, so from the second call on the server should only process the instructions.
await run("grammar, whole text (first call of the session)", "grammar", { text: body });
await run("prose, whole text (same prompt start)", "prose", { text: body });
await run("grammar again (identical prompt)", "grammar", { text: body });
await run("facts, with fatti.md", "facts", {
  text: body,
  sources: [{ ref: "fatti.md", text: facts }],
});
await run("structure", "structure", { text: body });

say(
  `| Request | Time | Reasoning tokens | Response tokens | Prompt processed (prompt_n) | Outcome |`,
);
say(`|---|---|---|---|---|---|`);
for (const { label, r, ok } of rows) {
  const pn = r?.timings?.prompt_n;
  say(
    `| ${label} | ${r ? (r.elapsedMs / 1000).toFixed(1) + " s" : "—"} | ${r?.reasoningTokens ?? "—"} | ${r?.contentTokens ?? "—"} | ${pn ?? "—"} | ${ok} |`,
  );
}
say();
const [first, second, again] = rows;
if (first?.r && again?.r) {
  const pn1 = first.r.timings?.prompt_n;
  const pn3 = again.r.timings?.prompt_n;
  say(
    `- Prompt cache: first call ${(first.r.elapsedMs / 1000).toFixed(1)} s, same request repeated ${(again.r.elapsedMs / 1000).toFixed(1)} s` +
      (pn1 !== undefined && pn3 !== undefined ? `; prompt tokens processed ${pn1} → ${pn3}` : "") +
      ` (should go down).`,
  );
}
const shared = second?.r?.timings?.prompt_n;
if (first?.r?.timings?.prompt_n !== undefined && shared !== undefined) {
  say(
    `- Start shared across analyses: prose processed ${shared} prompt tokens against ${first.r.timings.prompt_n} for the first (should be much less: the text is not read again).`,
  );
}
const tools = rows.filter((x) => x.r).every((x) => x.r!.toolCalls.length > 0);
say(
  `- Tool calls: ${tools ? "the server returns them" : "at least one response without tools (the JSON in the text is used; llama-server needs --jinja)"}.`,
);
say(`- Reasoning format: ${rows.find((x) => x.format)?.format ?? "—"}`);
await finish();

async function finish() {
  if (values["no-write"]) return;
  const path = root("docs/model-probe.md");
  const doc = await readFile(path, "utf8").catch(() => "");
  const head = doc.split(/<!-- (?:results|risultati) -->/)[0] ?? "";
  await writeFile(path, `${head.trimEnd()}\n\n<!-- results -->\n\n${lines.join("\n")}\n`);
  console.log(`\nResults written to docs/model-probe.md`);
}
