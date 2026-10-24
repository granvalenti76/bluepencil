import { useEffect, useRef, useState } from "react";
import {
  archetypeIn,
  defaultOutline,
  fromProposal,
  skeletonBody,
  toOutline,
  type OutlineDraftEntry,
  type ProposedOutline,
  type ProposedSection,
} from "@desk/core";
import { api, postEvents } from "../app/api.ts";
import { useDoc } from "../app/docStore.ts";
import { useModel } from "../app/modelStore.ts";
import { archetypeName } from "../app/labels.ts";
import { LanguageField } from "../app/NewDraftDialog.tsx";
import { packFor, usePack } from "../app/languages.ts";
import { session } from "../app/session.ts";

type Proposing = {
  phase: "start" | "queued" | "busy" | "reasoning" | "writing";
  reasoningTokens: number;
};

/** Where the outline comes from: while it is the default one it follows archetype and target. */
type Origin = "default" | "model" | "edited";

/** Structure screen: archetype, topic, target, proposed and editable outline. */
export function StructureScreen() {
  const doc = useDoc();
  const cloud = useModel((s) => s.cloud);
  const [lang, setLang] = useState(doc.lang.code);
  // A code the app does not know stays in the file until one is chosen here.
  const [langTouched, setLangTouched] = useState(false);
  // Archetypes (names, sections, checklist) in the language chosen here.
  const pack = usePack(lang);
  const getArchetype = (id: string | undefined) => archetypeIn(pack, id);
  const initialArch = getArchetype(doc.archetype);
  const [archetype, setArchetype] = useState(initialArch?.id ?? null);
  const [topic, setTopic] = useState(doc.brief);
  const [target, setTarget] = useState(doc.target || initialArch?.defaultTarget || 900);
  const [rows, setRows] = useState<OutlineDraftEntry[]>(() =>
    doc.outline.length
      ? doc.outline.map((o, i) => ({
          id: o.id,
          title: o.title,
          target: o.target,
          guidance: "",
          withHeading: o.heading !== undefined || i > 0,
        }))
      : initialArch
        ? defaultOutline(initialArch, doc.target || initialArch.defaultTarget)
        : [],
  );
  const [origin, setOrigin] = useState<Origin>(doc.outline.length ? "edited" : "default");
  const [modelChecks, setModelChecks] = useState<string[]>([]);
  const [proposing, setProposing] = useState<Proposing | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const arch = archetype ? getArchetype(archetype) : undefined;
  const sum = rows.reduce((a, r) => a + (Number.isFinite(r.target) ? r.target : 0), 0);

  const chooseArchetype = (id: string) => {
    setArchetype(id as typeof archetype);
    const a = getArchetype(id)!;
    const t = origin === "default" && !doc.target ? a.defaultTarget : target;
    setTarget(t);
    if (origin === "default" || rows.length === 0) {
      setRows(defaultOutline(a, t));
      setOrigin("default");
    }
    setModelChecks([]);
  };

  const changeTarget = (t: number) => {
    setTarget(t);
    if (origin === "default" && arch && t > 0) setRows(defaultOutline(arch, t));
  };

  const edit = (i: number, patch: Partial<OutlineDraftEntry>) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setOrigin("edited");
  };
  const move = (i: number, d: -1 | 1) => {
    setRows((rs) => {
      const next = [...rs];
      const [r] = next.splice(i, 1);
      next.splice(i + d, 0, r!);
      return next;
    });
    setOrigin("edited");
  };
  const remove = (i: number) => {
    setRows((rs) => rs.filter((_, j) => j !== i));
    setOrigin("edited");
  };
  const add = () => {
    setRows((rs) => [
      ...rs,
      {
        id: `section-${rs.length + 1}`,
        title: "New section",
        target: 0,
        guidance: "",
        withHeading: true,
      },
    ]);
    setOrigin("edited");
  };

  const propose = async () => {
    if (!arch) return;
    const controller = new AbortController();
    abort.current = controller;
    setMessage(null);
    setProposing({ phase: "start", reasoningTokens: 0 });
    const streamed: ProposedSection[] = [];
    let failed: string | null = null;
    try {
      await postEvents(
        "/api/structure/propose",
        { archetype: arch.id, topic, target, cloud, lang },
        (event, data) => {
          if (event === "progress") {
            const p = data as { phase: Proposing["phase"]; reasoningTokens?: number };
            setProposing({ phase: p.phase, reasoningTokens: p.reasoningTokens ?? 0 });
          } else if (event === "section") {
            streamed.push(data as ProposedSection);
            setRows(fromProposal(streamed, arch));
            setOrigin("model");
          } else if (event === "done") {
            const o = data as ProposedOutline;
            setRows(fromProposal(o.sections, arch));
            setModelChecks(o.checks);
            setOrigin("model");
          } else if (event === "error") {
            failed = (data as { message: string }).message;
          }
        },
        controller.signal,
      );
    } catch (e) {
      if (!controller.signal.aborted) failed = "Couldn’t reach the server";
      void e;
    } finally {
      abort.current = null;
      setProposing(null);
    }
    if (failed) {
      setMessage(`${failed}. You can start from the default sections and edit them by hand.`);
      if (streamed.length === 0 && origin !== "edited") setRows(defaultOutline(arch, target));
    }
  };

  const accept = async () => {
    if (!arch || !doc.path || rows.length === 0) return;
    setSaving(true);
    setMessage(null);
    const outline = toOutline(rows);
    const detail = await api.getDraft(doc.path);
    const body = skeletonBody(detail.body, doc.title, outline);
    const patch: Record<string, unknown> = {
      archetype: arch.id,
      target,
      outline,
      stage: "writing",
    };
    if (topic.trim()) patch.brief = topic.trim();
    if (langTouched || doc.lang.declared === undefined) patch.lang = lang;
    try {
      const res = await api.putDraft(doc.path, body, detail.contentHash, patch);
      if (!res.ok) throw new Error("conflict");
      await session.open(doc.path);
      void session.refreshList();
    } catch {
      setMessage("Couldn’t save the structure. Try again.");
      setSaving(false);
    }
  };

  /** Structure is optional: you move on to writing without it, the file stays as it is. */
  const skip = async () => {
    if (!doc.path) return;
    setSaving(true);
    setMessage(null);
    try {
      const detail = await api.getDraft(doc.path);
      const res = await api.putDraft(doc.path, detail.body, detail.contentHash, {
        stage: "writing",
      });
      if (!res.ok) throw new Error("conflict");
      await session.open(doc.path);
      void session.refreshList();
    } catch {
      setMessage("Couldn’t switch to writing. Try again.");
      setSaving(false);
    }
  };

  const valid = rows.length > 0 && rows.every((r) => r.title.trim() !== "" && r.target >= 0);

  return (
    <div className="structure" data-testid="structure">
      <section className="structure-step">
        <h2 className="structure-h">Type of text</h2>
        <div className="arch-cards" role="group" aria-label="Type of text">
          {pack.archetypes.map((a) => (
            <button
              key={a.id}
              type="button"
              className="arch-card"
              aria-pressed={archetype === a.id}
              onClick={() => chooseArchetype(a.id)}
            >
              <span className="arch-name">{archetypeName(a.id)}</span>
              <span className="arch-sections">
                {a.defaultSections.map((s) => s.title).join(" · ")}
              </span>
            </button>
          ))}
        </div>
        <div className="structure-fields">
          <label className="structure-topic">
            What is it about?
            <textarea
              value={topic}
              rows={3}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Topic, reader, goal: two or three lines."
            />
          </label>
          <div className="structure-lang">
            <LanguageField
              value={lang}
              onChange={(code) => {
                setLang(code);
                setLangTouched(true);
                // The default sections follow the language; proposed or edited ones stay.
                const a = archetypeIn(packFor(code), archetype ?? undefined);
                if (a && origin === "default") setRows(defaultOutline(a, target));
              }}
            />
          </div>
          <label className="structure-target">
            Target (words)
            <input
              type="number"
              min={50}
              step={50}
              value={target}
              onChange={(e) => changeTarget(Number(e.target.value))}
            />
          </label>
        </div>
        <div className="structure-actions">
          {proposing ? (
            <>
              <span className="structure-progress" role="status">
                {proposingText(proposing)}
              </span>
              <button
                type="button"
                className="btn-secondary btn-large"
                onClick={() => abort.current?.abort()}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn-secondary btn-large"
              disabled={!arch || target < 50}
              onClick={() => void propose()}
            >
              Suggest a structure
            </button>
          )}
          <button
            type="button"
            className="btn-secondary btn-large"
            disabled={saving || proposing !== null}
            onClick={() => void skip()}
          >
            Write without one
          </button>
        </div>
        {message && (
          <p className="structure-message" role="alert">
            {message}
          </p>
        )}
      </section>

      {arch && (
        <section className="structure-step">
          <div className="structure-outline-head">
            <h2 className="structure-h">Sections</h2>
            <span className="structure-sum" data-mismatch={sum !== target} aria-live="polite">
              Total <b>{sum}</b> / {target} words
            </span>
          </div>
          <ol className="outline-rows">
            {rows.map((r, i) => (
              <li key={`${r.id}-${i}`} className="outline-row">
                <div className="outline-row-main">
                  <input
                    className="outline-row-title"
                    aria-label={`Section ${i + 1} title`}
                    value={r.title}
                    onChange={(e) => edit(i, { title: e.target.value })}
                  />
                  <input
                    className="outline-row-target"
                    type="number"
                    min={0}
                    step={10}
                    aria-label={`Section ${i + 1} target`}
                    value={r.target}
                    onChange={(e) => edit(i, { target: Math.max(0, Number(e.target.value) || 0) })}
                  />
                  <label className="outline-row-heading">
                    <input
                      type="checkbox"
                      checked={r.withHeading}
                      onChange={(e) => edit(i, { withHeading: e.target.checked })}
                    />
                    Heading in text
                  </label>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Move up ${r.title}`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Move down ${r.title}`}
                    disabled={i === rows.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove ${r.title}`}
                    onClick={() => remove(i)}
                  >
                    ×
                  </button>
                </div>
                {r.guidance && <p className="outline-row-guidance">{r.guidance}</p>}
              </li>
            ))}
          </ol>
          <button type="button" className="btn-secondary btn-small" onClick={add}>
            + Add section
          </button>

          <h2 className="structure-h">Review checks</h2>
          <ul className="structure-checks">
            {arch.checklist.map((c) => (
              <li key={c.id}>{c.description}</li>
            ))}
            {modelChecks.map((c, i) => (
              <li key={`m${i}`}>{c}</li>
            ))}
          </ul>

          <div className="structure-actions">
            <button
              type="button"
              className="btn-primary btn-large"
              disabled={!valid || saving || proposing !== null}
              onClick={() => void accept()}
            >
              Accept structure
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function proposingText(p: Proposing): string {
  switch (p.phase) {
    case "writing":
      return "The model is writing the structure…";
    case "queued":
      return "Queued behind another request to the model…";
    case "busy":
      return "The server is busy with another app, waiting…";
    default:
      return `The model is thinking…${p.reasoningTokens ? ` (${p.reasoningTokens} tokens)` : ""}`;
  }
}
