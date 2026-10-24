import { useEffect, useRef, useState } from "react";
import { ARCHETYPE_SKELETONS } from "@desk/core";
import { api } from "./api.ts";
import { archetypeName } from "./labels.ts";
import { useLanguages } from "./languages.ts";
import { lastLanguage, rememberLanguage } from "./lastLanguage.ts";

interface Props {
  onClose: () => void;
  onCreated: (path: string) => void;
}

export function NewDraftDialog({ onClose, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [archetype, setArchetype] = useState("undecided");
  const [lang, setLang] = useState(lastLanguage);
  const [plan, setPlan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim() === "" || busy) return;
    setBusy(true);
    setError(null);
    try {
      const d = await api.createDraft(title.trim(), archetype, lang, plan);
      rememberLanguage(lang);
      onCreated(d.path);
    } catch {
      setError("Couldn’t create the draft.");
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-title"
        onSubmit={submit}
      >
        <h2 id="new-title">New draft</h2>
        <label>
          Title
          <input
            ref={input}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What is it about?"
          />
        </label>
        <label>
          Type of text
          <select value={archetype} onChange={(e) => setArchetype(e.target.value)}>
            <option value="undecided">Not chosen yet</option>
            {ARCHETYPE_SKELETONS.map((a) => (
              <option key={a.id} value={a.id}>
                {archetypeName(a.id)}
              </option>
            ))}
          </select>
        </label>
        <LanguageField value={lang} onChange={setLang} />
        <label className="check-row">
          <input type="checkbox" checked={plan} onChange={(e) => setPlan(e.target.checked)} />
          Plan the sections first
        </label>
        {error && <p className="modal-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={title.trim() === "" || busy}>
            Create draft
          </button>
        </div>
      </form>
    </div>
  );
}

/** The draft's language: decides the prompts, the archetypes and the readability index. */
export function LanguageField({
  value,
  onChange,
}: {
  value: string;
  onChange: (code: string) => void;
}) {
  const packs = useLanguages((s) => s.packs);
  return (
    <label>
      Language
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {packs.map((l) => (
          <option key={l.code} value={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}
