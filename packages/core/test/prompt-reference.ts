// The reference for the identity of the Italian prompts: every function that builds a prompt,
// called on cases that cover every branch. Used by `prompts-identity.test.ts`.
// `fixtures/requests/prompts-it.json` was generated from this file on the code from before the
// language packs, and is not regenerated lightly. It was regenerated once for the editor's
// letter: only the letter request, the «lettera» tool and the prompt versions changed.
import * as core from "../src/index.ts";

export function promptCases(pack: core.LanguagePack): Record<string, unknown> {
  const c = core;
  const out: Record<string, unknown> = {};
  const full = (archetype: core.Archetype | undefined): core.DraftContext => ({
    pack,
    title: "Turbocode  V0.6\n",
    archetype,
    target: 900,
    outline: [{ id: "lead", title: "Lead", target: 100 }],
    brief: "  Presentare la 0.6 a chi usa modelli locali.  ",
    glossary: ["Turbocode", "llama-server"],
    style: ["Frasi brevi.", "Niente   prima persona\nnel lead."],
    ignored: [
      { kind: "grammar", quote: "perchè  " },
      { kind: "prose", quote: "una frase\nlunga" },
    ],
  });
  const bare: core.DraftContext = { pack, outline: [], glossary: [], style: [], ignored: [] };
  const contexts: [string, core.DraftContext][] = [
    ["bare", bare],
    ["none", full(undefined)],
    ...pack.archetypes.map((a) => [a.id, full(a)] as [string, core.DraftContext]),
  ];
  const text = "# Titolo\n\nUn testo con un errore perchè sì.[^1]\n\n[^1]: fatti.md";
  const inputs: [string, core.ReviewInput][] = [
    ["whole", { text }],
    ["focus", { text, focus: "un errore perchè" }],
    [
      "sources",
      {
        text,
        sources: [
          { ref: "fatti.md#1", text: "  Consuma 100–150 MB.  " },
          { ref: "fatti.md#2", text: "Versione 0.6." },
        ],
        footnotes: [{ id: "1", text: "fatti.md\n  riga due" }],
      },
    ],
  ];
  for (const [cn, ctx] of contexts) {
    out[`context/${cn}`] = c.renderDraftContext(ctx);
    for (const step of ["structure", "facts", "grammar", "prose"] as const) {
      for (const [inName, input] of inputs) {
        if (cn !== "none" && cn !== "article" && step !== "structure" && inName !== "whole")
          continue;
        out[`review/${cn}/${step}/${inName}`] = {
          messages: c.buildMessages(step, ctx, input),
          tools: c.reviewTools(pack, step, input),
        };
      }
    }
  }
  for (const step of ["structure", "facts", "grammar", "prose"] as const) {
    out[`version/${step}`] = c.promptVersion(pack, step);
  }
  for (const a of pack.archetypes) {
    out[`outline/${a.id}`] = c.outlineMessages(pack, a, "  La memoria dei modelli locali  ", 1200);
  }
  out["outline/no-topic"] = c.outlineMessages(pack, pack.archetypes[0]!, "   ", 900);
  const ctx = full(pack.archetypes[0]);
  out["section/draft"] = c.sectionMessages(ctx, { mode: "draft", title: "Contesto", target: 150 });
  out["section/regenerate"] = c.sectionMessages(ctx, {
    mode: "regenerate",
    title: "Contesto",
    target: 150,
    current: "  Testo attuale.  ",
    reason: "La sezione è vuota.",
    before: " Fine della precedente. ",
    after: " Inizio della successiva. ",
  });
  out["section/blank-parts"] = c.sectionMessages(full(undefined), {
    mode: "draft",
    title: "X",
    target: 50,
    current: "   ",
    before: "",
    after: "  ",
  });
  for (const style of ["concise", "clear", "fluent", "creative"] as const) {
    out[`rewrite/${style}`] = c.rewriteMessages(ctx, {
      style,
      passage: "Per lavori più complessi si può integrare modelli cloud.",
      text,
    });
  }
  out["repair"] = c.repairMessage(pack, "Unexpected token } in JSON at position 12");
  out["opinion-note"] = pack.opinionNote;
  out["archetypes"] = pack.archetypes;
  for (const [name, t] of Object.entries(SAMPLES)) {
    out[`gulpease/${name}`] = c.readability(t, pack.readability);
    out[`sourceQuery/${name}`] = c.sourceQuery(t, pack);
    out[`sourceQuery/${name}/3`] = c.sourceQuery(t, pack, 3);
  }
  return out;
}

const SAMPLES: Record<string, string> = {
  breve: "Una frase.",
  turbocode:
    "# Turbocode V0.6\n\nTurbocode è un agent harness locale per macOS che gira con modelli linguistici locali, con opzione di fallback cloud. In una sessione tipica consuma tra i 100 e i 150 MB di RAM, una cifra che permette l’uso prolungato senza pesare sul sistema.\n\n## Cosa è Turbocode\n\n- Funziona con llama-server abbinato a modelli come Qwen3.6-35B-3B Q3_XSS.\n- Per lavori più complessi si può integrare modelli cloud\n\nLa versione 0.6 porta soprattutto tre cambiamenti, «e il resto».",
  fonti:
    "Secondo l'ISTAT nel 2024 la popolazione era di 58,9 milioni; Giorgio Parisi ha vinto il Nobel nel 2021, perché la fisica dei sistemi complessi è anche questo.",
};
