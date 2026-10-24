import { useEffect, useState } from "react";
import { api, errorMessage, type Settings } from "./api.ts";
import { FolderField } from "./FolderField.tsx";
import { LanguagesSettings } from "./LanguagesSettings.tsx";
import { useModel } from "./modelStore.ts";

type Draft = Pick<Settings, "draftsDir" | "modelBaseUrl" | "publishDir" | "push">;

/**
 * Settings: what used to be changeable only in `config.json`. The server saves the file;
 * publishing changes at once, drafts folder and model from the next start.
 */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [saved, setSaved] = useState<Settings | null>(null);
  const [form, setForm] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .settings()
      .then((s) => {
        setSaved(s);
        setForm(s);
      })
      .catch((e) => setError(errorMessage(e, "Couldn’t read the settings.")));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (patch: Partial<Draft>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || !saved || busy) return;
    const patch: Partial<Draft> = {};
    for (const key of ["draftsDir", "modelBaseUrl", "publishDir", "push"] as const) {
      if (form[key] !== saved[key]) Object.assign(patch, { [key]: form[key] });
    }
    if (Object.keys(patch).length === 0) return onClose();
    setBusy(true);
    setError(null);
    try {
      const next = await api.saveSettings(patch);
      setSaved(next);
      setForm(next);
      if (!next.restartNeeded) onClose();
    } catch (err) {
      setError(errorMessage(err, "Couldn’t save the settings."));
    } finally {
      setBusy(false);
    }
  };

  const changed =
    form !== null &&
    saved !== null &&
    (["draftsDir", "modelBaseUrl", "publishDir", "push"] as const).some(
      (k) => form[k] !== saved[k],
    );

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="modal modal-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onSubmit={submit}
      >
        <h2 id="settings-title">Settings</h2>
        {form && saved && (
          <>
            <FolderField
              label="Drafts folder"
              value={form.draftsDir}
              onChange={(draftsDir) => set({ draftsDir })}
              prompt="Where do you keep your drafts?"
              canPick={saved.canPick}
            />
            <FolderField
              label="Publish folder"
              value={form.publishDir}
              onChange={(publishDir) => set({ publishDir })}
              prompt="Where should published articles go?"
              canPick={saved.canPick}
              placeholder="None yet: “Publish…” will ask"
            />
            <p className="modal-note">
              “Publish” copies the cleaned-up article here. If the folder is inside a git
              repository, it also commits it.
            </p>
            <label className="check-row">
              <input
                type="checkbox"
                checked={form.push}
                onChange={(e) => set({ push: e.target.checked })}
              />
              Also offer to push to the remote (always asks first)
            </label>
            <label>
              Model address (llama-server)
              <input
                value={form.modelBaseUrl}
                onChange={(e) => set({ modelBaseUrl: e.target.value })}
                spellCheck={false}
              />
            </label>
            <CloudField />
          </>
        )}
        <LanguagesSettings />
        {saved?.restartNeeded && (
          <p className="modal-confirm" role="status">
            Saved. The drafts folder and the model change the next time the app starts.
          </p>
        )}
        {error && (
          <p className="modal-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            {changed ? "Cancel" : "Close"}
          </button>
          <button type="submit" className="btn-primary" disabled={!changed || busy}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * The cloud fallback, if configured in `config.json`: applies at once and to the requests that
 * follow, until it is switched off (not saved).
 */
function CloudField() {
  const { status, cloud, toggleCloud } = useModel();
  if (!status?.cloud.available) return null;
  return (
    <label className="check-row">
      <input type="checkbox" checked={cloud} onChange={toggleCloud} />
      Use the cloud model ({status.cloud.model ?? "cloud"}) for the next requests
    </label>
  );
}
