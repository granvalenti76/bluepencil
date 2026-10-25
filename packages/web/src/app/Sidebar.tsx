import { useEffect, useState } from "react";
import { isStylePath } from "@desk/core";
import { styles } from "./styles.ts";
import { useUi } from "./store.ts";
import { useDoc, useDrafts } from "./docStore.ts";
import { api, type DraftRow, type SearchHit } from "./api.ts";
import { Marked } from "./SourcePanels.tsx";
import { useDialog } from "./dialogs.ts";
import { archetypeShortName, STAGE_LABEL } from "./labels.ts";
import { FolderIcon, GearIcon } from "./icons.tsx";

const FILTERS: ["all" | "structure" | "writing" | "review", string][] = [
  ["all", "All"],
  ["structure", "Structure"],
  ["writing", "Writing"],
  ["review", "Review"],
];

function DraftCard({
  d,
  selected,
  onPick,
}: {
  d: DraftRow;
  selected: boolean;
  onPick: () => void;
}) {
  const live = useDoc((s) => (s.path === d.path ? s.counts.words : null));
  const words = live ?? d.words;
  const over = d.target > 0 && words > d.target;
  const pct = d.target > 0 ? Math.min(100, Math.round((100 * words) / d.target)) : 0;
  return (
    <button className="draft-card" data-path={d.path} aria-current={selected} onClick={onPick}>
      <span className="draft-title">{d.title}</span>
      <span className="draft-meta">
        {isStylePath(d.path) ? (
          <span className="draft-stage" data-stage="style">
            Style
          </span>
        ) : (
          <>
            <span>{archetypeShortName(d.archetype)}</span>
            <span className="draft-stage" data-stage={d.stage}>
              {STAGE_LABEL[d.stage] ?? d.stage}
            </span>
          </>
        )}
        <span className="grow" />
        <span>
          {isStylePath(d.path) ? `${words} words` : d.target > 0 ? `${words}/${d.target}` : "new"}
        </span>
      </span>
      <span className="bar bar-thin">
        <span className="bar-fill" data-over={over} style={{ width: `${pct}%` }} />
      </span>
    </button>
  );
}

const SEARCH_DEBOUNCE_MS = 200;

/** Full-text search over drafts and sources (`/search`): the results take the place of the list. */
function useSearch(q: string): SearchHit[] | null {
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  useEffect(() => {
    if (!q.trim()) {
      setHits(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      api.search(q).then(
        (r) => live && setHits(r),
        () => live && setHits([]),
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);
  return hits;
}

function SearchResults({
  hits,
  current,
  onPick,
}: {
  hits: SearchHit[];
  current: string | null;
  onPick: (path: string) => void;
}) {
  if (hits.length === 0) return <p className="outline-empty">No results.</p>;
  return (
    <>
      {hits.map((h) => (
        <button
          key={h.path}
          className="draft-card search-hit"
          data-path={h.path}
          aria-current={h.path === current}
          onClick={() => onPick(h.path)}
        >
          <span className="draft-title">{h.title}</span>
          <span className="draft-meta">
            <span>{h.isDraft ? "Draft" : "Source"}</span>
            <span className="grow" />
            <span className="search-path">{h.path}</span>
          </span>
          <span className="search-snippet">
            <Marked text={h.snippet} />
          </span>
        </button>
      ))}
    </>
  );
}

/**
 * The drafts list: a panel that opens over the desk with ⌘O or from the draft's name at the top,
 * no longer a column. Search, filters, new draft.
 */
export function Sidebar({ onSelect }: { onSelect: (path: string) => void }) {
  const { drafts, filter, set } = useDrafts();
  const path = useDoc((s) => s.path);
  const showDialog = useDialog((s) => s.show);
  const [query, setQuery] = useState("");
  const hits = useSearch(query);

  // Styles are not drafts at a stage: they live in their library.
  const shown = drafts.filter(
    (d) => !isStylePath(d.path) && (filter === "all" || d.stage === filter),
  );

  return (
    <aside className="sidebar" aria-label="Drafts">
      <div className="sidebar-head">
        <span className="sidebar-title">Drafts</span>
        <RevealButton path={path} />
        <SettingsButton />
        <button
          className="new-btn"
          aria-label="+ New"
          data-tip="New draft"
          onClick={() => showDialog("new-draft")}
        >
          +
        </button>
      </div>
      <div className="sidebar-search">
        <input
          type="search"
          aria-label="Search drafts and sources"
          placeholder="Search drafts and sources"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Esc clears the search first, then (the second time) closes the list.
            if (e.key === "Escape" && query) {
              setQuery("");
              e.stopPropagation();
            }
          }}
        />
      </div>
      <div className="filters" role="group" aria-label="Filter by stage" hidden={hits !== null}>
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            className="seg"
            aria-pressed={filter === key}
            onClick={() => set({ filter: key })}
          >
            {label}
          </button>
        ))}
        <button
          className="seg seg-styles"
          data-tip="The styles you look at while writing"
          onClick={() => {
            useUi.getState().setDrafts(false);
            styles.openLibrary();
          }}
        >
          Styles
        </button>
      </div>
      <div className="draft-list" aria-label={hits ? "Search results" : undefined}>
        {hits && <SearchResults hits={hits} current={path} onPick={onSelect} />}
        {!hits &&
          shown.map((d) => (
            <DraftCard
              key={d.path}
              d={d}
              selected={d.path === path}
              onPick={() => onSelect(d.path)}
            />
          ))}
        {!hits && shown.length === 0 && <p className="outline-empty">No drafts at this stage.</p>}
      </div>
    </aside>
  );
}

/**
 * "Show in Finder": the open draft, selected in its folder; with no open draft, the drafts
 * folder. The tooltip says where the folder is.
 */
function RevealButton({ path }: { path: string | null }) {
  const [folder, setFolder] = useState<string | null>(null);
  useEffect(() => {
    void api
      .folder()
      .then(setFolder)
      .catch(() => {});
  }, []);
  const where = folder ? ` (${folder.replace(/^\/Users\/[^/]+/, "~")})` : "";
  return (
    <button
      className="icon-btn reveal-btn"
      aria-label="Show in Finder"
      data-tip={`${path ? "Show the draft in Finder" : "Open the drafts folder in Finder"}${where}`}
      onClick={() => void api.reveal(path ?? undefined).catch(() => {})}
    >
      <FolderIcon />
    </button>
  );
}

/** Settings (folders, model, publishing): no more hand-editing of `config.json`. */
function SettingsButton() {
  const show = useDialog((s) => s.show);
  return (
    <button
      className="icon-btn settings-btn"
      aria-label="Settings"
      data-tip="Settings: folders, model, publishing · ⌘,"
      onClick={() => show("settings")}
    >
      <GearIcon />
    </button>
  );
}
