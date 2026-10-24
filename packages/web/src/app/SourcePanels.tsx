import { useEffect, useState } from "react";
import type { EditorView } from "@codemirror/view";
import type { Judgment } from "@desk/core";
import { api, type ComparePassage, type DraftSources } from "./api.ts";
import { useDoc } from "./docStore.ts";
import { addSource } from "./footnotes.ts";

/** Text with the found terms (between \u0001 and \u0002) highlighted, without HTML. */
export function Marked({ text }: { text: string }) {
  const [first, ...rest] = text.split("\u0001");
  return (
    <>
      {first}
      {rest.map((chunk, i) => {
        const [hit, after] = chunk.split("\u0002");
        return (
          <span key={i}>
            <mark>{hit}</mark>
            {after}
          </span>
        );
      })}
    </>
  );
}

/**
 * "Add source": the draft's sources, the other files in the folder, or a URL. Once a source is
 * chosen, `[^n]` goes after the quote and the definition at the end of the file.
 */
export function SourcePicker({
  note,
  view,
  onClose,
}: {
  note: Judgment;
  view: EditorView | null;
  onClose: () => void;
}) {
  const path = useDoc((s) => s.path);
  const [data, setData] = useState<DraftSources | null>(null);
  const [failed, setFailed] = useState(false);
  const [other, setOther] = useState("");

  useEffect(() => {
    if (!path) return;
    let live = true;
    api.sources(path).then(
      (d) => live && setData(d),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [path]);

  const pick = (ref: string) => {
    if (!view) return;
    onClose();
    void addSource(view, note, ref);
  };
  const known = data?.sources.filter((s) => s.kind === "url" || s.exists) ?? [];

  return (
    <div className="source-panel" data-testid={`sources-${note.id}`}>
      <div className="source-panel-title">Link a source</div>
      {!data && !failed && <div className="source-panel-empty">Loading sources…</div>}
      {failed && <div className="source-panel-empty">Couldn’t read the sources.</div>}
      {known.length > 0 && (
        <ul className="source-list" aria-label="Draft sources">
          {known.map((s) => (
            <li key={s.ref}>
              <button className="source-option" onClick={() => pick(s.ref)}>
                <span className="source-ref">{s.ref}</span>
                {s.kind === "file" && s.preview && (
                  <span className="source-preview">{s.preview}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {data && data.files.length > 0 && (
        <>
          <div className="source-panel-sub">Other files in the folder</div>
          <ul className="source-list" aria-label="Other files">
            {data.files.map((f) => (
              <li key={f.path}>
                <button className="source-option" onClick={() => pick(f.ref)}>
                  <span className="source-ref">{f.ref}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <form
        className="source-other"
        onSubmit={(e) => {
          e.preventDefault();
          if (other.trim()) pick(other);
        }}
      >
        <input
          aria-label="URL or source file"
          placeholder="URL or file (e.g. facts.md)"
          value={other}
          onChange={(e) => setOther(e.target.value)}
        />
        <button className="note-primary" type="submit" disabled={!other.trim()}>
          Link
        </button>
      </form>
      <div className="proposal-actions">
        <button className="note-ignore" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/** "Compare sources": source passages with similar terms. Does not change the text. */
export function ComparePanel({ note, onClose }: { note: Judgment; onClose: () => void }) {
  const path = useDoc((s) => s.path);
  const [passages, setPassages] = useState<ComparePassage[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!path) return;
    let live = true;
    api.compare(path, note.id).then(
      (r) => live && setPassages(r.passages),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [path, note.id]);

  return (
    <div className="source-panel" data-testid={`compare-${note.id}`}>
      <div className="source-panel-title">In the sources</div>
      {!passages && !failed && <div className="source-panel-empty">Searching the sources…</div>}
      {failed && <div className="source-panel-empty">Couldn’t search the sources.</div>}
      {passages?.length === 0 && (
        <div className="source-panel-empty">No source passages with similar terms.</div>
      )}
      {passages && passages.length > 0 && (
        <ul className="source-list" aria-label="Source passages">
          {passages.map((p) => (
            <li key={`${p.path}:${p.text}`} className="source-passage">
              <span className="source-ref">{p.ref}</span>
              <span className="source-text">
                <Marked text={p.marked} />
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="proposal-actions">
        <button className="note-ignore" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
