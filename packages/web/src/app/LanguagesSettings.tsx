import { useState } from "react";
import { api, errorMessage } from "./api.ts";
import { useLanguages } from "./languages.ts";

/**
 * Settings ▸ Languages: the installed language packs, the user's packs that fail to load (with
 * the reason), and how to add one: "New language…" copies the English pack into the user's
 * folder and opens it in the Finder, to translate with any editor.
 */
export function LanguagesSettings() {
  const { packs, problems, userDir } = useLanguages();
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await fn();
      await useLanguages.getState().load();
    } catch (e) {
      setError(errorMessage(e, fallback));
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      const r = await api.createLanguage(code.trim(), name.trim());
      setAdding(false);
      setCode("");
      setName("");
      setDone(`Created in ${r.created}. Translate its files, then Reload.`);
    }, "Couldn’t create the language.");

  return (
    <section className="settings-languages" aria-labelledby="settings-languages-title">
      <h3 id="settings-languages-title">Languages</h3>
      <ul className="language-list">
        {packs.map((p) => (
          <li key={p.code}>
            <span className="language-name">{p.name}</span> <code>{p.code}</code>
            <span className="language-kind">{p.builtIn ? "built-in" : "yours"}</span>
          </li>
        ))}
      </ul>
      {problems.length > 0 && (
        <ul className="language-problems" role="alert" aria-label="Language packs with problems">
          {problems.map((p) => (
            <li key={p.dir}>
              <b>{p.dir.split(/[\\/]/).pop()}</b> isn’t loaded:
              <ul>
                {p.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {userDir && (
        <p className="modal-note">
          To add a language, Bluepencil copies the English pack into your folder: translate its
          files with any text editor. The guide is <code>docs/languages.md</code>.
        </p>
      )}
      {adding && (
        <div className="language-new" role="group" aria-label="New language">
          <label>
            Code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="es"
              spellCheck={false}
              autoFocus
            />
          </label>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Español" />
          </label>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !code.trim() || !name.trim()}
            onClick={() => void create()}
          >
            Create
          </button>
          <button type="button" className="btn-secondary" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </div>
      )}
      {error && (
        <p className="modal-error" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="modal-confirm" role="status">
          {done}
        </p>
      )}
      {userDir && (
        <div className="language-actions">
          {!adding && (
            <button type="button" className="btn-secondary" onClick={() => setAdding(true)}>
              New language…
            </button>
          )}
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => void run(() => api.revealLanguages(), "Couldn’t open Finder.")}
          >
            Show folder
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => void run(() => api.reloadLanguages(), "Couldn’t reload the languages.")}
          >
            Reload
          </button>
        </div>
      )}
    </section>
  );
}
