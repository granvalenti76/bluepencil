import type { EditorView } from "@codemirror/view";
import { ARCHETYPE_SKELETONS, SECTION_STATE_LABEL } from "@desk/core";
import { useDoc } from "./docStore.ts";
import { archetypeShortName } from "./labels.ts";
import { session } from "./session.ts";

/**
 * The outline on an index card next to the page, in Write: the sections with the words written
 * against their target. A click takes the cursor to the start of the section.
 */
export function OutlineCard({ view }: { view: EditorView | null }) {
  const archetype = useDoc((s) => s.archetype);
  const title = ARCHETYPE_SKELETONS.some((a) => a.id === archetype)
    ? `${archetypeShortName(archetype)} · outline`
    : "Outline";
  return (
    <nav className="outline-card" aria-label="Outline">
      <p className="outline-title">{title}</p>
      <Outline view={view} />
    </nav>
  );
}

function Outline({ view }: { view: EditorView | null }) {
  const { sections, bodyOffset, path } = useDoc();
  if (!path)
    return <p className="outline-empty">Open a draft to see how its sections are coming along.</p>;
  if (sections.length === 0) {
    // Structure is optional: it can also be asked for after starting.
    return (
      <div className="outline-empty">
        <p>This draft has no structure yet.</p>
        <button
          type="button"
          className="btn-secondary btn-small"
          onClick={() => void session.patchFrontMatter({ stage: "structure" })}
        >
          Plan the sections
        </button>
      </div>
    );
  }
  return (
    <div className="outline-list">
      {sections.map((s) => {
        const ratio = s.target > 0 ? s.words / s.target : 0;
        return (
          <button
            key={s.id}
            className="section-card"
            data-state={s.state}
            disabled={s.range === null}
            onClick={() => {
              if (!view || !s.range) return;
              const pos = bodyOffset + s.range.from;
              view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
              view.focus();
            }}
          >
            <span className="section-head">
              <span>{s.title}</span>
              <span className="section-count">
                {s.words} / {s.target}
              </span>
            </span>
            <span className="bar">
              <span
                className="bar-fill"
                data-state={s.state}
                style={{ width: `${Math.min(100, Math.round(100 * ratio))}%` }}
              />
            </span>
            <span className="section-state">{SECTION_STATE_LABEL[s.state]}</span>
          </button>
        );
      })}
    </div>
  );
}
