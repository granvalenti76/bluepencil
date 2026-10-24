import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, ApiError, errorMessage, type PublishPreview, type PublishResult } from "./api.ts";
import { useDoc } from "./docStore.ts";
import { FolderField } from "./FolderField.tsx";
import { session } from "./session.ts";

type State =
  | { step: "loading" }
  /** The publish folder is missing (or the author wants to change it): it is chosen here. */
  | { step: "folder"; folder: string; canPick: boolean; error?: string; back?: PublishPreview }
  | { step: "error"; message: string; preview?: PublishPreview }
  | { step: "preview"; preview: PublishPreview }
  | { step: "confirm-push"; preview: PublishPreview }
  | { step: "busy"; preview: PublishPreview }
  | ({ step: "done" } & PublishResult);

const notConfigured = (e: unknown) =>
  e instanceof ApiError && (e.body as { error?: unknown })?.error === "not_configured";

/** A diff line, coloured as in git. */
function DiffLine({ line }: { line: string }) {
  const kind = line.startsWith("@@")
    ? "hunk"
    : line.startsWith("+++") || line.startsWith("---")
      ? "file"
      : line.startsWith("+")
        ? "add"
        : line.startsWith("-")
          ? "del"
          : "ctx";
  return <span data-kind={kind}>{line + "\n"}</span>;
}

/**
 * "Publish". The first time it asks for the folder; then the diff of the file that will be
 * written, and the copy (with the commit if the folder is in a git repository). The push only if
 * enabled and confirmed here.
 */
export function PublishDialog({ onClose }: { onClose: () => void }) {
  const path = useDoc((s) => s.path);
  const [state, setState] = useState<State>({ step: "loading" });

  const askFolder = useCallback(async (back?: PublishPreview) => {
    const settings = await api.settings().catch(() => null);
    setState({
      step: "folder",
      folder: settings?.publishDir ?? "",
      canPick: settings?.canPick ?? false,
      back,
    });
  }, []);

  const load = useCallback(async () => {
    if (!path) return;
    setState({ step: "loading" });
    await session.saveNow(); // what is on disk gets published: first the editor's text
    try {
      setState({ step: "preview", preview: await api.publishPreview(path) });
    } catch (e) {
      if (notConfigured(e)) await askFolder();
      else setState({ step: "error", message: errorMessage(e, "Preview failed.") });
    }
  }, [path, askFolder]);

  useEffect(() => {
    void load();
  }, [load]);

  const chooseFolder = async (folder: string) => {
    if (state.step !== "folder") return;
    try {
      await api.saveSettings({ publishDir: folder.trim() });
      await load();
    } catch (e) {
      setState({ ...state, error: errorMessage(e, "Couldn’t save the folder.") });
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const go = async (preview: PublishPreview, push: boolean) => {
    if (!path) return;
    setState({ step: "busy", preview });
    try {
      const r = await api.publish(path, preview.draftHash, push);
      setState({ step: "done", ...r });
    } catch (e) {
      setState({
        step: "error",
        message: errorMessage(e, "Publishing failed."),
        preview,
      });
    }
  };

  const preview = "preview" in state ? state.preview : undefined;
  // Without the sign-off it publishes anyway, but says so.
  const signedOff = useDoc((d) => d.signoff !== null && d.signoff.body === d.bodyHash.slice(0, 12));

  // In the body: the toolbar (where it is created) would act as the box for `position: fixed`.
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="pub-title">
        <h2 id="pub-title">Publish</h2>
        {!signedOff && (
          <p className="modal-note" role="note">
            Not signed off yet: finish the review and sign it off first, or publish anyway.
          </p>
        )}
        {state.step === "loading" && <p className="modal-note">Preparing the preview…</p>}
        {state.step === "folder" && (
          <>
            <FolderField
              label="Where should published articles go?"
              value={state.folder}
              onChange={(folder) => setState({ ...state, folder, error: undefined })}
              prompt="Where should published articles go?"
              canPick={state.canPick}
              placeholder="~/Blog/posts"
              autoFocus
            />
            <p className="modal-note">
              I’ll copy the article here, without your working notes. If the folder is inside a git
              repository, I’ll commit it too. You can change this later in Settings.
            </p>
            {state.error && (
              <p className="modal-error" role="alert">
                {state.error}
              </p>
            )}
          </>
        )}
        {preview && (
          <>
            <p className="modal-note">
              Destination: <code>{preview.file}</code>
              {preview.isNew ? " (new file)" : ""}
              {preview.git ? " · git repository: commits this file only" : ""}
            </p>
            {preview.removedNotes.length > 0 && (
              <p className="modal-note">
                Footnotes removed (local files or opinions):{" "}
                {preview.removedNotes.map((n) => `[^${n.id}] ${n.text}`).join(", ")}
              </p>
            )}
            {preview.changed ? (
              <pre className="diff" aria-label="Differenze">
                {preview.diff.split("\n").map((l, i) => (
                  <DiffLine key={i} line={l} />
                ))}
              </pre>
            ) : (
              <p className="modal-note">Already published: no changes to send.</p>
            )}
          </>
        )}
        {state.step === "confirm-push" && (
          <p className="modal-confirm" role="alert">
            The commit will be sent to the blog’s remote with <code>git push</code>. Continue?
          </p>
        )}
        {state.step === "error" && (
          <p className="modal-error" role="alert">
            {state.message}
          </p>
        )}
        {state.step === "done" && (
          <p className="modal-note" role="status">
            {state.commit
              ? `Published: commit ${state.commit}`
              : state.git
                ? "No changes: nothing to commit"
                : "Published"}
            {state.pushed ? " · pushed" : ""} ({state.file}).
          </p>
        )}
        <div className="modal-actions">
          {state.step === "preview" && (
            <button
              type="button"
              className="btn-secondary modal-action-left"
              onClick={() => void askFolder(state.preview)}
            >
              Change folder…
            </button>
          )}
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              state.step === "folder" && state.back
                ? setState({ step: "preview", preview: state.back })
                : onClose()
            }
          >
            {state.step === "done" ? "Close" : "Cancel"}
          </button>
          {state.step === "folder" && (
            <button
              className="btn-primary"
              disabled={state.folder.trim() === ""}
              onClick={() => void chooseFolder(state.folder)}
            >
              Use this folder
            </button>
          )}
          {(state.step === "preview" || state.step === "busy") && preview && (
            <>
              {preview.canPush && (
                <button
                  className="btn-secondary"
                  disabled={state.step === "busy"}
                  onClick={() => setState({ step: "confirm-push", preview })}
                >
                  Publish and push…
                </button>
              )}
              <button
                className="btn-primary"
                disabled={state.step === "busy"}
                onClick={() => void go(preview, false)}
              >
                {preview.changed && preview.git ? "Publish (commit)" : "Publish"}
              </button>
            </>
          )}
          {state.step === "confirm-push" && (
            <button className="btn-primary" onClick={() => void go(state.preview, true)}>
              Yes, commit and push
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
