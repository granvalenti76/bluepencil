import { describe, expect, it } from "vitest";
import {
  buildMessages,
  parseLanguagePack,
  readAnalysis,
  reviewTools,
  type ChatResult,
  type DraftContext,
  type PackFiles,
} from "../src/index.ts";
import { IT, LANGUAGES_DIR, readPackFiles } from "./packs.ts";
import { join } from "node:path";

const result = (over: Partial<ChatResult>): ChatResult => ({
  content: "",
  toolCalls: [],
  reasoning: "",
  reasoningTokens: 0,
  contentTokens: 0,
  finishReason: "stop",
  model: null,
  slot: undefined,
  elapsedMs: 0,
  ...over,
});
const call = (name: string, args: unknown) => ({ name, arguments: JSON.stringify(args) });
const ctx = (pack = IT): DraftContext => ({
  pack,
  outline: [],
  glossary: [],
  style: [],
  ignored: [],
});

describe("the editor's letter", () => {
  it("asked on the whole text, at the end of the instructions; never on a selection", () => {
    const [, whole] = buildMessages("grammar", ctx(), { text: "T" });
    expect(whole!.content.trimEnd().endsWith(IT.prompts.letter!.trimEnd())).toBe(true);
    const [, focused] = buildMessages("grammar", ctx(), { text: "T", focus: "x" });
    expect(focused!.content).not.toContain('"lettera"');
    const tool = reviewTools(IT, "facts", { text: "T" }).find((t) => t.function.name === "lettera");
    expect(tool?.function.parameters).toMatchObject({ required: ["testo"] });
  });

  it("arrives with the «lettera» tool, or as a field in the JSON", () => {
    const viaTool = readAnalysis(
      "grammar",
      result({
        toolCalls: [
          call("annota", { citazione: "perchè", correzione: "perché" }),
          call("lettera", { testo: "  Pulito, salvo un accento.  " }),
        ],
      }),
      IT,
    );
    expect(viaTool.letter).toBe("Pulito, salvo un accento.");
    expect(viaTool.judgments).toHaveLength(1);
    expect(viaTool.dropped).toBe(0);

    const viaJson = readAnalysis(
      "prose",
      result({
        content:
          '```json\n{"note": [{"citazione": "a", "problema": "b"}], "voto": 70, "lettera": "Scorre bene."}\n```',
      }),
      IT,
    );
    expect(viaJson.letter).toBe("Scorre bene.");
    expect(viaJson.score?.value).toBe(70);
    expect(viaJson.judgments).toHaveLength(1);

    const nested = readAnalysis(
      "facts",
      result({ content: '[{"lettera": {"testo": "Tutto torna con le fonti."}}]' }),
      IT,
    );
    expect(nested.letter).toBe("Tutto torna con le fonti.");
  });

  it("without a letter the analysis works as before", () => {
    const a = readAnalysis(
      "grammar",
      result({ toolCalls: [call("annota", { citazione: "perchè", correzione: "perché" })] }),
      IT,
    );
    expect(a.letter).toBeUndefined();
    expect(a.judgments).toHaveLength(1);
    const empty = readAnalysis(
      "grammar",
      result({ toolCalls: [call("lettera", { testo: " " })] }),
      IT,
    );
    expect(empty.letter).toBeUndefined();
  });

  it("a pack without a letter loads and does not ask for it; a half-defined one does not load", () => {
    const files = readPackFiles(join(LANGUAGES_DIR, "en"));
    const tools = JSON.parse(files["prompts/tools.json"]!) as Record<string, unknown>;
    const { letter, letterText, ...toolsWithout } = tools;
    expect(letter && letterText).toBeTruthy();
    const without: PackFiles = { ...files, "prompts/tools.json": JSON.stringify(toolsWithout) };
    delete without["prompts/letter.md"];
    const parsed = parseLanguagePack(without, { builtIn: false });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.pack.prompts.letter).toBeUndefined();
    expect(reviewTools(parsed.pack, "grammar", { text: "T" }).map((t) => t.function.name)).toEqual([
      "annota",
    ]);
    const [, user] = buildMessages("grammar", ctx(parsed.pack), { text: "T" });
    expect(user!.content).not.toContain("lettera");

    const half = { ...files, "prompts/tools.json": JSON.stringify(toolsWithout) };
    const broken = parseLanguagePack(half, { builtIn: false });
    expect(broken.ok).toBe(false);
    if (broken.ok) return;
    expect(broken.errors.join("\n")).toContain("prompts/letter.md");
  });
});
