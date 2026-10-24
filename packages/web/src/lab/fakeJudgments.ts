import { resolveQuote, splitFrontMatter } from "@desk/core";
import type { JudgmentKind, TrackedJudgment } from "../editor/judgmentsField.ts";

/** The fake sample judgments: s1, f1–f5, g1, r1, r2. */
export interface Fake {
  id: string;
  kind: JudgmentKind;
  quote: string;
  title?: string;
  /** Text that replaces the quote with "Apply" (empty string = delete). */
  fix?: string;
}

const FAKES: Fake[] = [
  {
    id: "s1",
    kind: "struct",
    title: "Il lead non dice «perché»",
    quote:
      "Turbocode è un agent harness locale per macOS che gira con modelli linguistici locali, con opzione di fallback cloud.",
  },
  { id: "f1", kind: "fact-ok", quote: "per macOS" },
  { id: "f2", kind: "fact-ok", quote: "tra i 100 e i 150 MB di RAM" },
  { id: "f3", kind: "fact-ok", quote: "contesto di 100k token" },
  {
    id: "f4",
    kind: "fact",
    title: "Affermazione senza fonte",
    quote: "non garantiscono un loop autonomo completo",
  },
  { id: "f5", kind: "fact", title: "Sigla da controllare", quote: "Qwen3.6-35B-3B" },
  {
    id: "g1",
    kind: "grammar",
    title: "Concordanza",
    quote: "si può integrare",
    fix: "si possono integrare",
  },
  { id: "r1", kind: "prose", title: "Avverbio superfluo", quote: "completamente", fix: "" },
  {
    id: "r2",
    kind: "prose",
    title: "Ripetizione",
    quote: "con modelli linguistici locali, con opzione di fallback cloud",
    fix: "su modelli linguistici locali, con fallback cloud opzionale",
  },
];

/** Judgments on the text with hidden syntax: the marks must stay on the right text. */
export const STYLE_FAKES: Fake[] = [
  {
    id: "p1",
    kind: "prose",
    title: "Rafforzativo",
    quote: "**davvero importante**",
    fix: "importante",
  },
  {
    id: "g2",
    kind: "grammar",
    title: "Collegamento",
    quote: "[un collegamento](https://example.org/carta)",
  },
  { id: "f6", kind: "fact", title: "Nome del server", quote: "con il `llama-server` locale" },
  { id: "r3", kind: "prose", title: "Corsivo", quote: "annidata con *corsivo*" },
];

export interface FakeMeta {
  id: string;
  kind: JudgmentKind;
  quote: string;
  title?: string;
  fix?: string;
}

export function buildFakeJudgments(
  doc: string,
  fakes: Fake[] = FAKES,
): {
  judgments: TrackedJudgment[];
  meta: FakeMeta[];
} {
  const { body, bodyOffset } = splitFrontMatter(doc);
  const judgments: TrackedJudgment[] = [];
  for (const f of fakes) {
    // Search in the body: «Qwen3.6-35B-3B» also appears in the front matter's glossary.
    const r = resolveQuote(body, f.quote);
    if (!r) throw new Error(`Quote not found in the draft: ${f.id}`);
    judgments.push({
      id: f.id,
      kind: f.kind,
      from: bodyOffset + r.from,
      to: bodyOffset + r.to,
      status: "open",
    });
  }
  return {
    judgments,
    meta: fakes.map(({ id, kind, quote, title, fix }) => ({ id, kind, quote, title, fix })),
  };
}
