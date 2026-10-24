import { useState } from "react";
import { api, errorMessage } from "./api.ts";

interface Props {
  label: string;
  value: string;
  onChange: (path: string) => void;
  /** The title of the Finder's picker. */
  prompt: string;
  /** Without a system picker (outside macOS) only the text field remains. */
  canPick: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}

/** A folder: "Choose…" opens the Finder; the path can also be typed by hand. */
export function FolderField({
  label,
  value,
  onChange,
  prompt,
  canPick,
  placeholder,
  autoFocus,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    setBusy(true);
    setError(null);
    try {
      const path = await api.pickFolder(prompt);
      if (path) onChange(path);
    } catch (e) {
      setError(errorMessage(e, "Couldn’t open Finder."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <label>
      {label}
      <span className="folder-field">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          autoFocus={autoFocus}
        />
        {canPick && (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => void pick()}
          >
            Choose…
          </button>
        )}
      </span>
      {error && <span className="modal-error">{error}</span>}
    </label>
  );
}
