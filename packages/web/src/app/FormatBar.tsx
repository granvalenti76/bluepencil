import { useEffect, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { formatCommands, runFormat, setStyle, type BlockStyle } from "../editor/formatting.ts";
import { openLinkField } from "../editor/linkTools.ts";
import { openSelectionMenu } from "../editor/selectionActions.ts";
import { api, type DraftSources, type SearchHit } from "./api.ts";
import { useDoc } from "./docStore.ts";
import { cite } from "./footnotes.ts";
import {
  ChevronDownIcon,
  CodeIcon,
  LinkIcon,
  ListIcon,
  MoreIcon,
  NumberedIcon,
  QuoteIcon,
  SourceIcon,
  SparkIcon,
} from "./icons.tsx";
import { packFor } from "./languages.ts";
import { useMenu } from "./Menu.tsx";
import { Marked } from "./SourcePanels.tsx";
import { useUi } from "./store.ts";
import { shortcut } from "./keys.ts";

/** The styles menu: every item with its look and its shortcut. */
const STYLES: [BlockStyle, string, string][] = [
  ["title", "Title", "⌥⌘1"],
  ["heading", "Heading", "⌥⌘2"],
  ["subheading", "Subheading", "⌥⌘3"],
  ["body", "Body text", "⌥⌘0"],
  ["quote", "Quote", "⇧⌘9"],
  ["code", "Code block", ""],
  ["bullet", "Bulleted list", "⇧⌘8"],
  ["numbered", "Numbered list", "⇧⌘7"],
];

const label = (style: BlockStyle) => STYLES.find(([s]) => s === style)![1];

/** A click on the bar takes neither focus nor selection away from the editor. */
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

/**
 * Formatting bar, in Write above the page: style ▾, bold, italic, code, link, lists, quote,
 * Source, more, Ask the editor. Every command has its shortcut and a single-step ⌘Z.
 */
export function FormatBar({ view }: { view: EditorView | null }) {
  const preview = useUi((s) => s.preview);
  const caret = useUi((s) => s.caret);
  const off = !view || preview;
  const run = (fn: (v: EditorView) => boolean) => {
    if (!view) return;
    fn(view);
    view.focus();
  };
  const tool = (name: string, keys: string, icon: React.ReactNode, onClick: () => void) => (
    <button
      className="fmt-btn"
      aria-label={name}
      aria-keyshortcuts={keys || undefined}
      data-tip={keys ? `${name} · ${keys}` : name}
      disabled={off}
      onMouseDown={keepFocus}
      onClick={onClick}
    >
      {icon}
    </button>
  );
  return (
    <div className="format-bar" role="toolbar" aria-label="Formatting">
      <StyleMenu view={view} disabled={off} current={caret.style} />
      <span className="fmt-sep" aria-hidden />
      {tool("Bold", "⌘B", <b className="fmt-glyph">B</b>, () => runFormat(view, "bold"))}
      {tool("Italic", "⌘I", <i className="fmt-glyph">I</i>, () => runFormat(view, "italic"))}
      {tool("Code", "⌘E", <CodeIcon />, () => runFormat(view, "code"))}
      {tool("Link", "⌘K", <LinkIcon />, () => run(openLinkField))}
      <span className="fmt-sep" aria-hidden />
      {tool("Bulleted list", "⇧⌘8", <ListIcon />, () => run(setStyle("bullet")))}
      {tool("Numbered list", "⇧⌘7", <NumberedIcon />, () => run(setStyle("numbered")))}
      {tool("Quote", "⇧⌘9", <QuoteIcon />, () => run(setStyle("quote")))}
      <span className="fmt-sep" aria-hidden />
      <SourceMenu view={view} disabled={off} />
      <MoreFormats view={view} disabled={off} />
      <span className="fmt-sep" aria-hidden />
      <button
        className="fmt-btn fmt-ask"
        disabled={off || !caret.selection}
        data-tip={
          caret.selection
            ? "Ask the editor about the selected passage: rephrase or check it"
            : "Select a passage, then ask the editor about it"
        }
        onMouseDown={keepFocus}
        onClick={() => run((v) => openSelectionMenu(v, useDoc.getState().bodyOffset))}
      >
        <SparkIcon />
        Ask the editor
      </button>
    </div>
  );
}

function StyleMenu({
  view,
  disabled,
  current,
}: {
  view: EditorView | null;
  disabled: boolean;
  current: BlockStyle;
}) {
  const { open, setOpen, box } = useMenu();
  return (
    <div className="menu-anchor" ref={box}>
      <button
        className="fmt-btn fmt-style"
        aria-label={`Paragraph style: ${label(current)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onMouseDown={keepFocus}
        onClick={() => setOpen((o) => !o)}
      >
        {label(current)}
        <ChevronDownIcon />
      </button>
      {open && (
        <div className="menu style-menu" role="menu" aria-label="Paragraph style">
          {STYLES.map(([style, name, keys]) => (
            <button
              key={style}
              className="menu-item style-item"
              role="menuitemradio"
              aria-checked={style === current}
              data-style={style}
              onMouseDown={keepFocus}
              onClick={() => {
                setOpen(false);
                if (!view) return;
                setStyle(style)(view);
                view.focus();
              }}
            >
              <span className="style-sample">{name}</span>
              {keys && <kbd>{shortcut(keys)}</kbd>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** More: separator, image, table. */
function MoreFormats({ view, disabled }: { view: EditorView | null; disabled: boolean }) {
  const { open, setOpen, box } = useMenu();
  const items: [string, keyof typeof formatCommands][] = [
    ["Separator", "separator"],
    ["Image", "image"],
    ["Table", "table"],
  ];
  return (
    <div className="menu-anchor" ref={box}>
      <button
        className="fmt-btn"
        aria-label="More formats"
        aria-haspopup="menu"
        aria-expanded={open}
        data-tip="Separator, image, table"
        disabled={disabled}
        onMouseDown={keepFocus}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreIcon />
      </button>
      {open && (
        <div className="menu" role="menu" aria-label="More formats">
          {items.map(([name, cmd]) => (
            <button
              key={cmd}
              className="menu-item"
              role="menuitem"
              onMouseDown={keepFocus}
              onClick={() => {
                setOpen(false);
                runFormat(view, cmd);
              }}
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type SourceTab = "yours" | "web" | "estimate";

/**
 * Source: three tabs. "Your sources" searches the source files and shows the passages, "Cite"
 * adds the footnote; "Web address" cites an address; "My estimate" marks the point as the
 * author's opinion. The footnote goes at the end of the selection, or at the cursor.
 */
function SourceMenu({ view, disabled }: { view: EditorView | null; disabled: boolean }) {
  const { open, setOpen, box } = useMenu();
  const [tab, setTab] = useState<SourceTab>("yours");
  const done = async (note: string, kind: "file" | "url" | "estimate") => {
    setOpen(false);
    if (view) await cite(view, note, kind);
  };
  const tabs: [SourceTab, string][] = [
    ["yours", "Your sources"],
    ["web", "Web address"],
    ["estimate", "My estimate"],
  ];
  return (
    <div className="menu-anchor" ref={box}>
      <button
        className="fmt-btn fmt-text"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-tip="Cite a source, a web address or your own estimate"
        disabled={disabled}
        onMouseDown={keepFocus}
        onClick={() => setOpen((o) => !o)}
      >
        <SourceIcon />
        Source
      </button>
      {open && (
        <div className="menu source-menu" role="dialog" aria-label="Source">
          <div className="source-tabs" role="tablist" aria-label="Kind of source">
            {tabs.map(([key, name]) => (
              <button
                key={key}
                role="tab"
                id={`source-tab-${key}`}
                aria-selected={tab === key}
                aria-controls="source-tabpanel"
                className="source-tab"
                onClick={() => setTab(key)}
              >
                {name}
              </button>
            ))}
          </div>
          <div id="source-tabpanel" role="tabpanel" aria-labelledby={`source-tab-${tab}`}>
            {tab === "yours" && <YourSources onCite={(ref) => void done(ref, "file")} />}
            {tab === "web" && <WebAddress onCite={(url) => void done(url, "url")} />}
            {tab === "estimate" && <MyEstimate onCite={(note) => void done(note, "estimate")} />}
          </div>
        </div>
      )}
    </div>
  );
}

function YourSources({ onCite }: { onCite: (ref: string) => void }) {
  const path = useDoc((s) => s.path);
  const [data, setData] = useState<DraftSources | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  useEffect(() => {
    if (!path) return;
    let live = true;
    api.sources(path).then(
      (d) => live && setData(d),
      () => live && setData({ sources: [], files: [] }),
    );
    return () => {
      live = false;
    };
  }, [path]);
  useEffect(() => {
    if (!query.trim()) {
      setHits(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      api.search(query).then(
        (r) => live && setHits(r.filter((h) => !h.isDraft)),
        () => live && setHits([]),
      );
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);
  const files = [
    ...(data?.sources.filter((s) => s.kind === "file" && s.exists).map((s) => s.ref) ?? []),
    ...(data?.files.map((f) => f.ref) ?? []),
  ];
  return (
    <div className="source-pane">
      <input
        type="search"
        aria-label="Search your sources"
        placeholder="Search your sources"
        value={query}
        autoFocus
        onChange={(e) => setQuery(e.target.value)}
      />
      {hits === null && data && files.length === 0 && (
        <p className="source-panel-empty">No source files in the folder yet.</p>
      )}
      <ul className="source-list" aria-label={hits ? "Passages" : "Source files"}>
        {hits?.map((h) => (
          <li key={h.path} className="source-passage">
            <span className="source-ref">{h.path}</span>
            <span className="source-text">
              <Marked text={h.snippet} />
            </span>
            <button className="note-primary" onClick={() => onCite(h.path)}>
              Cite
            </button>
          </li>
        ))}
        {hits === null &&
          files.map((ref) => (
            <li key={ref} className="source-passage">
              <span className="source-ref">{ref}</span>
              <button className="note-primary" onClick={() => onCite(ref)}>
                Cite
              </button>
            </li>
          ))}
      </ul>
      {hits?.length === 0 && <p className="source-panel-empty">No passages found.</p>}
    </div>
  );
}

function WebAddress({ onCite }: { onCite: (url: string) => void }) {
  const [url, setUrl] = useState("");
  const valid = /^https?:\/\/\S+\.\S+/.test(url.trim());
  return (
    <form
      className="source-pane source-other"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onCite(url.trim());
      }}
    >
      <input
        type="url"
        aria-label="Web address"
        placeholder="https://"
        value={url}
        autoFocus
        onChange={(e) => setUrl(e.target.value)}
      />
      <button className="note-primary" type="submit" disabled={!valid}>
        Cite
      </button>
    </form>
  );
}

function MyEstimate({ onCite }: { onCite: (note: string) => void }) {
  const lang = useDoc((s) => s.lang.code);
  const note = packFor(lang).opinionNote;
  return (
    <div className="source-pane">
      <p className="source-panel-empty">
        No source for this: it is your own judgment. The note says so to the reader:
      </p>
      <p className="source-estimate">«{note}»</p>
      <button className="note-primary" onClick={() => onCite(note)}>
        Cite as my estimate
      </button>
    </div>
  );
}
