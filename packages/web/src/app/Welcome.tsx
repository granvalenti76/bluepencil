import { useEffect, useState, type ReactNode } from "react";
import {
  api,
  errorMessage,
  type FolderSummary,
  type ProbeResult,
  type WelcomeState,
} from "./api.ts";
import { HandText } from "./HandText.tsx";
import { lastLanguage } from "./lastLanguage.ts";
import { useLanguages } from "./languages.ts";
import { openSample } from "./tips.ts";
import { shortcut } from "./keys.ts";

/**
 * The first start: a single screen, on the desk. On the left the welcome, on the right the
 * review's deck of cards with three tabs: the folder of texts, the editor, the test. It does not
 * repeat.
 */
export function Welcome({ state }: { state: WelcomeState }) {
  const step = state.folder ? 2 : 1;
  useEffect(() => {
    void useLanguages.getState().load();
  }, []);
  return (
    <div className="welcome">
      <section className="welcome-intro" aria-label="Welcome">
        <div>
          <h1>Bluepencil</h1>
          <p className="welcome-motto">You write. The editor reads it back.</p>
        </div>
        <ul className="welcome-promises">
          <li>
            <FolderGlyph />
            <span>Your texts stay plain Markdown files, in a folder you choose.</span>
          </li>
          <li>
            <ScreenGlyph />
            <span>
              The editor runs on this Mac or on your network. Nothing leaves without your say-so.
            </span>
          </li>
          <li>
            <PencilGlyph />
            <span>
              It suggests, you decide. Every change is one click, and {shortcut("⌘Z")} undoes it.
            </span>
          </li>
        </ul>
      </section>
      <div className="welcome-deck">
        <div className="welcome-tabs" role="tablist" aria-label="Setup">
          <Tab n={1} label="Your writing" step={step} />
          <Tab n={2} label="The editor" step={step} />
          <Tab n={3} label="Try it" step={step} />
        </div>
        <div className="welcome-behind" aria-hidden />
        <section
          className="welcome-card"
          role="tabpanel"
          id="welcome-step"
          aria-labelledby={`welcome-tab-${step}`}
        >
          <div className="welcome-card-inner">
            {step === 1 ? <FolderStep state={state} /> : <EditorStep state={state} />}
          </div>
        </section>
      </div>
    </div>
  );
}

function Tab({ n, label, step }: { n: number; label: string; step: number }) {
  return (
    <button
      type="button"
      role="tab"
      id={`welcome-tab-${n}`}
      className="welcome-tab"
      aria-selected={n === step}
      aria-controls="welcome-step"
      // The cards go in order: "Continue" leads to the next one.
      disabled={n !== step}
      tabIndex={n === step ? 0 : -1}
    >
      {n} · {label}
      {n < step && (
        <span className="welcome-tick" aria-label="done">
          ✓
        </span>
      )}
    </button>
  );
}

/** The server restarts with the choice made: wait for the new start, then the page reloads. */
async function afterRestart(boot: string | null): Promise<void> {
  const until = Date.now() + 20_000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 150));
    try {
      const h = await api.health();
      if (h.boot !== boot) return;
    } catch {
      /* the server is restarting */
    }
  }
}

const bootNow = () =>
  api
    .health()
    .then((h) => h.boot)
    .catch(() => null);

/** "Where is your writing?" */
function FolderStep({ state }: { state: WelcomeState }) {
  const [choice, setChoice] = useState<"fresh" | "existing">("fresh");
  const [path, setPath] = useState("");
  const [summary, setSummary] = useState<FolderSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inspect = async (p: string) => {
    setSummary(null);
    setError(null);
    if (!p.trim()) return;
    try {
      setSummary(await api.inspectFolder(p.trim()));
    } catch (e) {
      setError(errorMessage(e, "Couldn’t read that folder."));
    }
  };

  const choose = async () => {
    setChoice("existing");
    try {
      const picked = await api.pickFolder("Choose the folder with your writing");
      if (picked) {
        setPath(picked);
        await inspect(picked);
      }
    } catch (e) {
      setError(errorMessage(e, "Couldn’t open Finder: type the folder path."));
    }
  };

  const ready = choice === "fresh" || (path.trim() !== "" && summary !== null);
  const next = async () => {
    setBusy(true);
    setError(null);
    try {
      const boot = await bootNow();
      const res = await api.chooseFolder(
        choice === "fresh" ? { fresh: true } : { path: path.trim() },
      );
      if (res.relaunching) await afterRestart(boot);
      location.reload();
    } catch (e) {
      setError(errorMessage(e, "Couldn’t use that folder."));
      setBusy(false);
    }
  };

  return (
    <>
      <h2>Where is your writing?</h2>
      <div className="welcome-choices" role="radiogroup" aria-label="Folder">
        <label className="welcome-choice" data-checked={choice === "fresh"}>
          <input
            type="radio"
            name="folder"
            checked={choice === "fresh"}
            onChange={() => setChoice("fresh")}
          />
          <span className="welcome-choice-text">
            <strong>A new folder</strong>
            <span>
              Start fresh in <code>{state.newFolder}</code>. A sample draft will be waiting.
            </span>
          </span>
        </label>
        <label className="welcome-choice" data-checked={choice === "existing"}>
          <input
            type="radio"
            name="folder"
            checked={choice === "existing"}
            onChange={() => setChoice("existing")}
          />
          <span className="welcome-choice-text">
            <strong>A folder you already use</strong>
            <span>Your blog’s posts, a notes folder, an Obsidian vault.</span>
            <span className="welcome-path">
              <input
                type="text"
                aria-label="Folder path"
                placeholder="~/Sites/blog/content/posts"
                value={path}
                spellCheck={false}
                onFocus={() => setChoice("existing")}
                onChange={(e) => {
                  setPath(e.target.value);
                  setSummary(null);
                }}
                onBlur={() => void inspect(path)}
                onKeyDown={(e) => e.key === "Enter" && void inspect(path)}
              />
              <button type="button" className="welcome-btn" onClick={() => void choose()}>
                Choose…
              </button>
            </span>
            {summary && <FolderFound summary={summary} />}
          </span>
        </label>
      </div>
      <p className="welcome-note">
        Every <code>.md</code> file is a text you can open. Nothing is moved or renamed; Bluepencil
        keeps its own notes in a hidden <code>.bluepencil</code> folder, and adds details to a file
        only when you use them.
      </p>
      {error && (
        <p className="welcome-error" role="alert">
          {error}
        </p>
      )}
      <Footer
        hint={shortcut("You can change this later in Settings (⌘,)")}
        action={
          <button
            type="button"
            className="welcome-btn welcome-btn-primary"
            disabled={!ready || busy}
            onClick={() => void next()}
          >
            {busy ? "Opening…" : "Continue"}
          </button>
        }
      />
    </>
  );
}

function FolderFound({ summary }: { summary: FolderSummary }) {
  if (!summary.exists) {
    return (
      <span className="welcome-found" role="status">
        No folder there yet: Bluepencil will create it.
      </span>
    );
  }
  return (
    <span className="welcome-found" role="status">
      <span>
        <strong>{summary.texts}</strong> {summary.texts === 1 ? "text" : "texts"}
      </span>
      <span>
        <strong>{summary.sources}</strong> {summary.sources === 1 ? "source" : "sources"}, cited by
        your texts
      </span>
      {summary.lastEdited !== null && (
        <span className="welcome-muted">last edited {ago(summary.lastEdited)}</span>
      )}
    </span>
  );
}

function ago(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(ms).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

/** "Connect your editor": the real test, the editor's first words. */
function EditorStep({ state }: { state: WelcomeState }) {
  const [address, setAddress] = useState(state.modelBaseUrl);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const test = async () => {
    setTesting(true);
    setResult(null);
    setError(null);
    try {
      setResult(await api.probeModel(address.trim(), lastLanguage()));
    } catch (e) {
      setError(errorMessage(e, "That doesn’t look like an address."));
    } finally {
      setTesting(false);
    }
  };

  /** Closes the first start: with the editor (saving the address) or without. */
  const finish = async (withEditor: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (withEditor) await api.saveSettings({ modelBaseUrl: address.trim() });
      const boot = await bootNow();
      const res = await api.finishWelcome(true, lastLanguage());
      if (res.relaunching) await afterRestart(boot);
      openSample(res.sample);
    } catch (e) {
      setError(errorMessage(e, "Couldn’t finish the setup."));
      setBusy(false);
    }
  };

  const ok = result?.ok === true;
  const failed = result !== null && !result.ok;
  return (
    <>
      <h2>Connect your editor</h2>
      <p className="welcome-note">
        The editor is a language model served by llama-server, on this Mac or on a computer in your
        house. Your texts go there and nowhere else.
      </p>
      <form
        className="welcome-address"
        onSubmit={(e) => {
          e.preventDefault();
          void test();
        }}
      >
        <label>
          Address
          <input
            type="url"
            value={address}
            spellCheck={false}
            aria-invalid={failed}
            onChange={(e) => setAddress(e.target.value)}
          />
        </label>
        <button
          type="submit"
          className={`welcome-btn${failed ? " welcome-btn-primary" : ""}`}
          disabled={testing || !address.trim()}
        >
          {testing ? "Testing…" : failed ? "Try again" : ok ? "Test again" : "Test connection"}
        </button>
      </form>

      {testing && (
        <p className="welcome-muted" role="status">
          Asking the editor to introduce itself… a large model can take a minute.
        </p>
      )}
      {result?.ok && <ProbeOk result={result} />}
      {result && !result.ok && <ProbeFailed result={result} />}
      {(failed || (!ok && !testing)) && (
        <p className="welcome-note">
          Without the editor you can still write, format, search and publish. Review waits until
          it’s connected.
        </p>
      )}
      {error && (
        <p className="welcome-error" role="alert">
          {error}
        </p>
      )}
      <Footer
        hint={
          ok ? (
            <button
              type="button"
              className="welcome-link"
              disabled={busy}
              onClick={() => void finish(false)}
            >
              Write without the editor for now
            </button>
          ) : (
            shortcut("You can connect later in Settings (⌘,)")
          )
        }
        action={
          ok ? (
            <button
              type="button"
              className="welcome-btn welcome-btn-primary"
              disabled={busy}
              onClick={() => void finish(true)}
            >
              {busy ? "Opening…" : "Continue"}
            </button>
          ) : (
            <button
              type="button"
              className="welcome-btn"
              disabled={busy || testing}
              onClick={() => void finish(false)}
            >
              {busy ? "Opening…" : "Write without the editor"}
            </button>
          )
        }
      />
    </>
  );
}

function ProbeOk({ result }: { result: Extract<ProbeResult, { ok: true }> }) {
  const [written, setWritten] = useState(false);
  return (
    <>
      <div className="welcome-probe" role="status">
        <span>
          <span className="welcome-dot" aria-hidden>
            ●
          </span>
          Reachable · {result.ms} ms
        </span>
        <span>{result.model ?? "Model loaded"}</span>
        <span>
          {result.context === null
            ? "Context: not reported"
            : `Context ${result.context.toLocaleString("en")} tokens: enough for pieces up to ${result.minutes} minutes`}
        </span>
        <span>Thinks before answering: {result.reasoning ? "yes" : "no"}</span>
      </div>
      <div className="welcome-words">
        <span className="welcome-muted">Its first words to you</span>
        <HandText
          className="first-words"
          text={result.words}
          writing={!written}
          onWritten={() => setWritten(true)}
        />
      </div>
    </>
  );
}

function ProbeFailed({ result }: { result: Extract<ProbeResult, { ok: false }> }) {
  return (
    <div className="welcome-alert" role="alert">
      <strong className="welcome-alert-title">
        {result.reason === "unreachable"
          ? `Nobody answered at ${result.address}.`
          : result.reason === "no_model"
            ? `llama-server answered at ${result.address}, but no model is loaded.`
            : `The editor at ${result.address} didn’t manage to answer.`}
      </strong>
      {result.reason === "failed" ? (
        <span>{result.message}</span>
      ) : (
        <>
          <span>
            <strong>Is llama-server running?</strong> On the computer with the model, start it with:
          </span>
          <code className="welcome-command">
            llama-server -m model.gguf --host 0.0.0.0 --port 8080 --jinja
          </code>
          <span>
            <strong>Same network?</strong> This Mac has to reach that address. If the model runs
            here, use <code>http://127.0.0.1:8080/v1</code>.
          </span>
        </>
      )}
    </div>
  );
}

function Footer({ hint, action }: { hint: ReactNode; action: ReactNode }) {
  return (
    <div className="welcome-footer">
      <span className="welcome-muted">{hint}</span>
      {action}
    </div>
  );
}

const glyph = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};
const FolderGlyph = () => (
  <svg {...glyph}>
    <path d="M3 7h6l2 2h10v10H3z" />
  </svg>
);
const ScreenGlyph = () => (
  <svg {...glyph}>
    <rect x="4" y="5" width="16" height="11" rx="1.5" />
    <path d="M9 20h6M12 16v4" />
  </svg>
);
const PencilGlyph = () => (
  <svg {...glyph}>
    <path d="M4 20l4-1L19 8l-3-3L5 16z" />
  </svg>
);
