import { readFileSync } from "node:fs";
import { replyWith, replyWithTools, type ChatHandler, type FakeReply } from "./fake-llm.ts";

type Msg = { role: string; content: string };
type FixtureJudgment = { pass: string; quote: string; checkId?: string; [k: string]: unknown };

/** The sample notes, as a disciplined model would give them. */
const FIXTURE = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/judgments/turbocode-draft-12-settembre.json", import.meta.url),
    "utf8",
  ),
) as { judgments: FixtureJudgment[] };

/** A plausible outline: the typical sections named in the prompt, with the target split into parts. */
function outlineReply(user: string) {
  const target = Number(/Obiettivo totale: (\d+)/.exec(user)?.[1] ?? 900);
  const typical = /Sezioni tipiche: (.*)/.exec(user)?.[1] ?? "Apertura (50%: x); Corpo (50%: y)";
  const parts = typical.split("; ").map((p) => {
    const m = /^(.*?) \((\d+)%: (.*)\)$/.exec(p);
    return { title: m?.[1] ?? p, share: Number(m?.[2] ?? 50), guidance: m?.[3] ?? "" };
  });
  const topic = user.split("Di cosa parla:\n")[1]?.trim() ?? "";
  let left = target;
  const sections = parts.map((p, i) => {
    const t = i === parts.length - 1 ? left : Math.round((target * p.share) / 100);
    left -= t;
    return { title: p.title, target: t, guidance: `${p.guidance} (${topic.slice(0, 30)})` };
  });
  return JSON.stringify(
    { sections, checks: ["Il lead dice perché il tema conta adesso."] },
    null,
    1,
  );
}

/** Drops the fixture fields the model does not send. */
function strip(j: FixtureJudgment) {
  const out: Record<string, unknown> = { ...j };
  delete out.pass;
  delete out.sectionId;
  return out;
}

/** The analysis, from the first line of the instructions. */
const STEP_OF: Record<string, string> = {
  "ANALISI DELLA STRUTTURA": "structure",
  "ANALISI DEI FATTI": "facts",
  "ANALISI GRAMMATICALE": "grammar",
  "ANALISI DELLA PROSA": "prose",
};

/** The fake model's fixed scores, when the analysis asks for them. */
export const FAKE_SCORES = { structure: 72, prose: 64 };

/** The text after «Testo della bozza:» (at the start of the user message). */
export function textOf(user: string): string {
  const m = /^Testo della bozza[^\n]*:\n<<<\n([\s\S]*?)\n>>>/.exec(user);
  return m?.[1] ?? "";
}

/** The passage selected by the author, if the analysis is on that alone. */
export function focusOf(user: string): string | null {
  const m = /Lavora solo sul tratto selezionato[^\n]*\n<<<\n([\s\S]*?)\n>>>/.exec(user);
  return m?.[1] ?? null;
}

const ESITO: Record<string, string> = {
  verified: "verificato",
  to_check: "da_verificare",
  unsourced: "senza_fonte",
};

/** From the fixture's notes (the app's format) to those the model delivers with «annota». */
function asNote(step: string, j: Record<string, unknown>): Record<string, unknown> {
  const p = j.proposal as { text?: string } | undefined;
  switch (step) {
    case "grammar":
      return { citazione: j.quote, correzione: p?.text, spiegazione: j.rationale };
    case "prose":
      return { citazione: j.quote, problema: j.title, proposta: p?.text };
    case "structure":
      return { citazione: j.quote, osservazione: j.title };
    default:
      return {
        citazione: j.quote,
        esito: ESITO[j.factStatus as string] ?? "senza_fonte",
        spiegazione: j.rationale,
      };
  }
}

/**
 * The analyses as a disciplined model would do them: notes with «annota», score with «valuta»,
 * the letter with «lettera».
 */
function reviewReply(user: string, tools: string[]): FakeReply {
  const step = STEP_OF[Object.keys(STEP_OF).find((k) => user.includes(`\n${k}`)) ?? ""] ?? "";
  const text = focusOf(user) ?? textOf(user);
  const notes = FIXTURE.judgments
    .filter((j) => j.pass === step)
    .filter((j) =>
      step === "structure"
        ? j.quote === "" || text.includes(j.quote)
        : j.quote !== "" && text.includes(j.quote),
    )
    .map((j) => (step === "facts" ? factVerdict(j, text, user) : strip(j)))
    .filter((j): j is Record<string, unknown> => j !== null)
    .map((j) => ({ name: "annota", args: asNote(step, j) }));
  if (tools.includes("valuta")) {
    const voto = step === "structure" ? FAKE_SCORES.structure : FAKE_SCORES.prose;
    notes.push({
      name: "valuta",
      args: { voto, motivo: "Valutazione del finto modello." },
    } as never);
  }
  if (tools.includes("lettera")) {
    notes.push({ name: "lettera", args: { testo: FAKE_LETTERS[step] ?? "" } } as never);
  }
  return replyWithTools(notes, "Leggo il testo e annoto. ".repeat(4));
}

/** The fake model's letters, one per analysis, recognisable in tests. */
export const FAKE_LETTERS: Record<string, string> = {
  structure:
    "L'ordine regge: cosa è, com'è fatto, i numeri. Al lead manca il perché, e manca la chiusura.",
  facts: "I numeri portano il pezzo, e due non tornano con le tue fonti.",
  prose: "La voce è diretta. Gli avverbi che rafforzano la rallentano.",
  grammar: "Un errore solo, meccanico. Il resto è pulito.",
};

/** "Rephrase": two recognisable proposals, different from the passage. */
function rewriteReply(user: string): string {
  const passage = /Tratto da riformulare:\n<<<\n([\s\S]*?)\n>>>/.exec(user)?.[1] ?? "";
  const short = passage.replace(/\s*\b(completamente|davvero|molto)\b/g, "");
  return JSON.stringify({
    alternatives: [short === passage ? `${passage} (riformulato)` : short, `In breve: ${passage}`],
  });
}

/** The source passages in the prompt (`<fonte ref="…">…</fonte>`). */
export function sourcesOf(user: string): { ref: string; text: string }[] {
  return [...user.matchAll(/<fonte ref="([^"]*)">\n([\s\S]*?)\n<\/fonte>/g)].map((m) => ({
    ref: m[1]!,
    text: m[2]!,
  }));
}

/**
 * The facts pass as a disciplined model would do it, really looking at the sources in the
 * prompt: figures are confirmed if a passage contains all of them; an acronym is "to check" if a
 * source has a similar but different one; a claim with a footnote has a source.
 */
function factVerdict(j: FixtureJudgment, block: string, user: string) {
  const out = strip(j);
  const sources = sourcesOf(user);
  const at = block.indexOf(j.quote) + j.quote.length;
  const footnoted = /^[^.;!?\n]*?\[\^[^\]]+\]/.test(block.slice(at));
  const verified = (ref: string, why: string) => ({
    ...out,
    kind: "verified",
    title: "Verificato",
    rationale: `${why} (${ref}).`,
    proposal: { action: "none", label: "" },
    factStatus: "verified",
  });
  const unsourced = () =>
    footnoted
      ? null
      : {
          ...out,
          kind: "unsourced",
          title: "Affermazione senza fonte",
          rationale: `«${j.quote}»: nessuna fonte ne parla.`,
          proposal: { action: "add_source", label: "Aggiungi fonte" },
          factStatus: "unsourced",
        };

  if (j.kind === "check-name") {
    const exact = sources.find((s) => s.text.includes(j.quote));
    if (exact) return verified(exact.ref, "La sigla coincide con la fonte");
    const head = j.quote.split(/[-_]/)[0]!;
    for (const s of sources) {
      const similar = s.text.match(new RegExp(`${head.replace(/[.]/g, "\\.")}[\\w.\\-]*`));
      if (similar) {
        return {
          ...out,
          rationale: `La fonte ${s.ref} scrive «${similar[0]}», non «${j.quote}».`,
          proposal: { action: "compare_sources", label: "Confronta" },
          factStatus: "to_check",
        };
      }
    }
    return unsourced();
  }
  const numbers = j.quote.match(/\d+/g);
  if (numbers) {
    const hit = sources.find((s) =>
      s.text.split("\n").some((l) => numbers.every((n) => l.includes(n))),
    );
    return hit ? verified(hit.ref, "Le cifre coincidono con la fonte") : unsourced();
  }
  if (j.factStatus === "unsourced") return unsourced();
  return out;
}

/**
 * Hand-written responses for the fake llama-server used by the e2e tests and in development: it
 * recognises the request from the prompt and answers like a disciplined model.
 */
export const scriptedChat: ChatHandler = (body) => {
  const messages = (body.messages ?? []) as Msg[];
  const system = messages[0]?.content ?? "";
  const user = messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
  // The editor's first words on the first start.
  if (user.includes("per la prima volta") || user.includes("for the first time")) {
    return replyWith(
      user.includes("per la prima volta")
        ? "Piacere. Leggerò i tuoi pezzi come un caporedattore: prima la struttura, poi i fatti, poi la prosa. Le virgole per ultime."
        : "Pleased to meet you. I'll read your pieces like an editor-in-chief: structure first, then facts, then prose. Commas last.",
      "Mi presento in poche parole.",
    );
  }
  // The editor's reading of a draft beside a style: what each paragraph does, and a cue on the
  // opening, on the ending and on the whole draft.
  if (system.includes('"esito"')) {
    const it = system.includes("Scrivi in italiano");
    const procs = [...user.matchAll(/^(\d+)\. \[[^\]]*\] /gm)].length;
    const paras = [...user.matchAll(/^¶(\d+) <<<(.*)>>>$/gm)];
    const last = paras.length;
    const first = paras[0]?.[2]?.split(/\s+/).slice(0, 3).join(" ") ?? "";
    const fn = (n: number) =>
      n === 1
        ? it
          ? "attacco"
          : "opening"
        : n === last
          ? it
            ? "finale"
            : "ending"
          : it
            ? "scena"
            : "scene";
    const cues = [
      {
        procedimento: 1,
        paragrafo: 1,
        esito: "diverso",
        nota: it
          ? `L'attacco dice subito di che cosa parla il pezzo; lo stile entra da una cosa e lascia arrivare il tema dopo.`
          : "The opening says at once what the piece is about; the style opens on a thing and lets the subject come later.",
        parole: first ? [first] : [],
      },
      ...(procs >= 2 && last > 1
        ? [
            {
              procedimento: 2,
              paragrafo: last,
              esito: "come",
              nota: it
                ? "Il paragrafo si chiude su una frase breve, come negli spezzoni."
                : "The paragraph closes on a short sentence, as in the pieces.",
              parole: [],
            },
          ]
        : []),
      ...(procs >= 3
        ? [
            {
              procedimento: 3,
              paragrafo: 0,
              esito: "assente",
              nota: it
                ? "Nella bozza tutto è un'abitudine: non c'è ancora la volta che andò diversamente."
                : "In the draft everything is a habit: there is not yet the time it went otherwise.",
              parole: [],
            },
          ]
        : []),
    ];
    return replyWith(
      JSON.stringify({
        sintesi: it
          ? "Il finale è già quello dello stile; l'attacco invece dichiara il tema."
          : "The ending is already the style's; the opening states the subject instead.",
        paragrafi: paras.map((p) => ({ numero: Number(p[1]), funzione: fn(Number(p[1])) })),
        spunti: cues,
      }),
      "Leggo la bozza accanto allo stile.",
    );
  }
  // A style's procedures, read in its numbered pieces, before the outline (the prompts open the
  // same way).
  if (system.includes('"procedimenti"')) {
    const it = system.includes("Scrivi in italiano");
    const ids = [...user.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
    const max = Math.max(1, ...ids);
    const at = (...n: number[]) => [...new Set(n.map((x) => Math.min(x, max)))];
    return replyWith(
      JSON.stringify({
        sintesi: it
          ? "Prosa breve e asciutta: frasi corte, un dettaglio concreto in apertura."
          : "Short, dry prose: short sentences, a concrete detail to open.",
        procedimenti: [
          {
            parte: it ? "attacco" : "opening",
            nome: it ? "Entra da una cosa, non da un tema" : "Opens on a thing, not on a subject",
            descrizione: it
              ? "La prima frase mette davanti un fatto o un oggetto preciso."
              : "The first sentence puts a precise fact or object in front.",
            passi: at(1),
          },
          {
            parte: it ? "paragrafo" : "paragraph",
            nome: it ? "Chiude su una frase breve" : "Closes on a short sentence",
            descrizione: it
              ? "Il paragrafo si ferma su una frase di poche parole."
              : "The paragraph stops on a sentence of a few words.",
            passi: at(2, 3),
          },
          {
            parte: it ? "tempo" : "time",
            nome: it ? "Ore e minuti esatti" : "Exact hours and minutes",
            descrizione: it
              ? "Il tempo si dice con l'orario, non con gli aggettivi."
              : "Time is told by the clock, not with adjectives.",
            passi: at(1, 3),
          },
        ],
      }),
      "Leggo gli spezzoni.",
    );
  }
  if (system.includes("caporedattore")) {
    return replyWith(outlineReply(user), "Parto dalle sezioni tipiche e le adatto al tema.");
  }
  if (system.includes("ti chiede di proporne una versione")) {
    return replyWith(rewriteReply(user), "Cerco una versione più asciutta.");
  }
  if (system.includes("redattore che affianca")) {
    const title = /sezione «([^»]+)»/.exec(user)?.[1] ?? "";
    const text =
      title === "Chiusura"
        ? "La 0.6 è disponibile da oggi. Chi usa già Turbocode la riceve con il prossimo aggiornamento."
        : `Turbocode 0.6 porta il loop agentico sui modelli locali per macOS: meno memoria, più autonomia.`;
    return replyWith(JSON.stringify({ text }), "Tengo il registro della bozza.");
  }
  if (system.includes("Sei un revisore editoriale")) {
    const tools = ((body.tools ?? []) as { function: { name: string } }[]).map(
      (t) => t.function.name,
    );
    return reviewReply(user, tools);
  }
  return replyWith("[]");
};
