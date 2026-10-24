import { z } from "zod";
import {
  withoutNulls,
  type ModelJudgment,
  type ReviewStep,
  type Score,
} from "../judgments/schema.ts";
import type { LanguagePack } from "../languages/pack.ts";
import { fill } from "../languages/template.ts";
import { ModelError } from "../model/errors.ts";
import { extractAllJson } from "../model/json.ts";
import type { ChatResult } from "../model/types.ts";

// Notes arrive as calls to the "annotate" tool (or, if the server has no tools, as a JSON array
// in the text). Each note is read on its own: a malformed one is discarded, the others stay.
// No second repair call.

const str = z.preprocess((v) => (typeof v === "number" ? String(v) : v), z.string());
const opt = str.optional().transform((v) => v?.trim() || undefined);

const NOTE: Record<ReviewStep, z.ZodType<Record<string, unknown>>> = {
  grammar: z.object({ citazione: str, correzione: str, spiegazione: opt }),
  prose: z.object({ citazione: str, problema: str, proposta: opt }),
  structure: z.object({ citazione: opt, osservazione: str, proposta: opt }),
  facts: z.object({
    citazione: str,
    esito: z.preprocess(
      (v) =>
        typeof v === "string"
          ? v
              .trim()
              .toLowerCase()
              .replace(/[\s-]+/g, "_")
          : v,
      z.enum(["verificato", "da_verificare", "senza_fonte"]),
    ),
    spiegazione: opt,
    correzione: opt,
  }),
};

/** The letter: `{"testo": …}` with the tool, a string, or `{"lettera": …}` in the JSON. */
function letterOf(v: unknown): string | undefined {
  const raw = withoutNulls(v);
  const text =
    typeof raw === "string"
      ? raw
      : raw && typeof raw === "object"
        ? ((raw as Record<string, unknown>).testo ?? (raw as Record<string, unknown>).lettera)
        : undefined;
  if (typeof text === "string") return text.trim() || undefined;
  return text && typeof text === "object" ? letterOf(text) : undefined;
}

const SCORE = z.object({
  voto: z.coerce.number().transform((n) => Math.round(Math.min(100, Math.max(0, n)))),
  motivo: opt,
});

/** From a model note to the app's judgment: title, action and label are decided by the app. */
function toJudgment(
  step: ReviewStep,
  n: Record<string, unknown>,
  pack: LanguagePack,
): ModelJudgment | null {
  const get = (k: string) => (typeof n[k] === "string" ? (n[k] as string).trim() : "");
  const quote = get("citazione");
  switch (step) {
    case "grammar": {
      const fix = get("correzione");
      if (!quote || fix === quote) return null;
      return {
        kind: "grammar",
        quote,
        title: `${quote} → ${fix}`,
        rationale: get("spiegazione"),
        proposal: { action: "replace", text: fix, label: "Fix" },
      };
    }
    case "prose": {
      const proposal = get("proposta");
      if (!quote) return null;
      return {
        kind: "prose",
        quote,
        title: get("problema"),
        rationale: "",
        proposal:
          proposal && proposal !== quote
            ? { action: "replace", text: proposal, label: "Use suggestion" }
            : { action: "none", label: "Got it" },
      };
    }
    case "structure": {
      const proposal = get("proposta");
      return {
        kind: "structure",
        quote,
        title: get("osservazione"),
        rationale: proposal ? fill(pack.labels.notes.suggestion, { text: proposal }) : "",
        proposal: { action: "none", label: "Got it" },
      };
    }
    case "facts": {
      const esito = n.esito as "verificato" | "da_verificare" | "senza_fonte";
      const fix = get("correzione");
      const why = get("spiegazione");
      if (esito === "verificato") {
        return {
          kind: "verified",
          quote,
          title: "Verified",
          rationale: why,
          proposal: { action: "none", label: "" },
          factStatus: "verified",
        };
      }
      if (esito === "da_verificare") {
        return {
          kind: "to-check",
          quote,
          title: "To verify",
          rationale: why,
          proposal:
            fix && fix !== quote
              ? { action: "replace", text: fix, label: "Fix" }
              : { action: "compare_sources", label: "Compare sources" },
          factStatus: "to_check",
        };
      }
      return {
        kind: "unsourced",
        quote,
        title: "No source",
        rationale: why,
        proposal: { action: "add_source", label: "Add source" },
        factStatus: "unsourced",
      };
    }
  }
}

export interface Analysis {
  judgments: ModelJudgment[];
  score?: Score;
  letter?: string;
  /** Notes received but unreadable (missing or wrong fields): discarded one by one. */
  dropped: number;
  /** The model answered in words only, without notes (usually: nothing to report). */
  textOnly?: boolean;
}

/** Reads an analysis response: tool calls, or JSON in the text. */
export function readAnalysis(step: ReviewStep, result: ChatResult, pack: LanguagePack): Analysis {
  const notes: unknown[] = [];
  const scores: unknown[] = [];
  let letter: string | undefined;
  let dropped = 0;

  if (result.toolCalls.length) {
    for (const call of result.toolCalls) {
      let args: unknown;
      try {
        args = JSON.parse(call.arguments || "{}");
      } catch {
        dropped++;
        continue;
      }
      if (call.name === "valuta") scores.push(args);
      else if (call.name === "lettera") letter ??= letterOf(args);
      else notes.push(args);
    }
  } else if (result.content.trim() !== "") {
    const values = extractAllJson(result.content);
    if (values.length === 0) {
      if (result.finishReason === "length") throw new ModelError("truncated");
      // Text only, no notes: the model found nothing to report.
      return { judgments: [], dropped: 0, textOnly: true };
    }
    // Notes and score may arrive in separate blocks (small models): read them all.
    const items = values.flatMap((value) => {
      const v = withoutNulls(value);
      if (Array.isArray(v)) return v;
      if (!v || typeof v !== "object") return [];
      const o = v as Record<string, unknown>;
      return [...((o.note ?? o.notes ?? o.judgments ?? []) as unknown[]), v];
    });
    for (const raw of items) {
      // `{"voto": {"voto": 62, "motivo": …}}`: the score nested one level too deep.
      const inner = (raw as { voto?: unknown } | null)?.voto;
      const item = inner && typeof inner === "object" && "voto" in inner ? inner : raw;
      if (item && typeof item === "object" && "lettera" in item) letter ??= letterOf(item);
      if (item && typeof item === "object" && "voto" in item) scores.push(item);
      else if (item && typeof item === "object" && ("citazione" in item || "osservazione" in item))
        notes.push(item);
    }
  }

  const judgments: ModelJudgment[] = [];
  for (const raw of notes) {
    const parsed = NOTE[step].safeParse(withoutNulls(raw));
    const j = parsed.success ? toJudgment(step, parsed.data, pack) : null;
    if (j) judgments.push(j);
    else dropped++;
  }
  const s = scores.map((x) => SCORE.safeParse(withoutNulls(x))).find((p) => p.success);
  return {
    judgments,
    ...(s?.success ? { score: { value: s.data.voto, reason: s.data.motivo ?? "" } } : {}),
    ...(letter ? { letter } : {}),
    dropped,
  };
}
