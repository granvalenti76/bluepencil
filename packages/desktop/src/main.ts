// Desktop app: an Electron window around the web app. The server stays a separate process,
// started with the system Node as `npm start` does: this way the native better-sqlite3 module
// does not need rebuilding for Electron, and the server's security rules (127.0.0.1, token,
// Host/Origin) apply unchanged.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from "electron";

const APP_NAME = "Bluepencil";
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PRELOAD = fileURLToPath(new URL("./preload.cjs", import.meta.url));
/** App icon: `icon.icns` for a future package, the PNG for now. */
const ICON = fileURLToPath(new URL("../assets/icon.png", import.meta.url));
const SERVER = `${ROOT}packages/server/src/index.ts`;
const WEB_DIST = `${ROOT}packages/web/dist/index.html`;
const HOST = "127.0.0.1";
/** Window background before the page is ready: `--bg` from tokens.css. */
const BACKGROUND = "#fbfaf6";

let server: ChildProcess | null = null;
let origin = "";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, HOST, () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

/** Starts the server and waits for it to answer. */
async function startServer(token: string): Promise<string> {
  const port = Number(process.env.DESK_PORT) || (await freePort());
  server = spawn(process.env.DESK_NODE ?? "node", [SERVER], {
    // DESK_STATIC: the server serves the interface build; no DESK_OPEN (the browser tab).
    env: { ...process.env, DESK_PORT: String(port), DESK_TOKEN: token, DESK_STATIC: "1" },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const exited = new Promise<never>((_, reject) =>
    server!.once("exit", (code) => reject(new Error(`the server exited (code ${code})`))),
  );
  const url = `http://${HOST}:${port}`;
  const ready = (async () => {
    for (let i = 0; i < 200; i++) {
      try {
        const r = await fetch(`${url}/api/health`, { headers: { "X-Desk-Token": token } });
        if (r.ok) return url;
      } catch {
        /* not listening yet */
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("the server is not responding");
  })();
  return Promise.race([ready, exited]);
}

function stopServer(): Promise<void> {
  const s = server;
  server = null;
  if (!s || s.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      s.kill("SIGKILL");
      resolve();
    }, 3000);
    s.once("exit", () => {
      clearTimeout(t);
      resolve();
    });
    s.kill("SIGTERM");
  });
}

/** The page state the menu mirrors (checkmarks, items disabled with no open draft). */
interface MenuState {
  hasDraft: boolean;
  sidebar: boolean;
  notes: boolean;
  preview: boolean;
  focus: boolean;
  hemingway: boolean;
}
const MENU_STATE_KEYS = ["hasDraft", "sidebar", "notes", "preview", "focus", "hemingway"] as const;

/** Sends a menu command to the page (see `packages/web/src/app/desktopMenu.ts`). */
function send(command: string) {
  BrowserWindow.getAllWindows()[0]?.webContents.send("menu", command);
}

/**
 * App menu following the macOS Human Interface Guidelines: app menu, File, Edit, View, Window,
 * Help. Shortcuts the page already handles (⌘Z, ⌃⌘S, ⇧⌘P…) are shown but not registered
 * (`registerAccelerator: false`): this way ⌘Z stays with the editor's history and a key does not
 * act twice.
 */
function buildMenu() {
  const dev = !app.isPackaged && process.env.DESK_DEVTOOLS === "1";
  const shown = (accelerator: string) => ({ accelerator, registerAccelerator: false });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: APP_NAME,
        submenu: [
          { role: "about", label: `About ${APP_NAME}` },
          { type: "separator" },
          { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => send("settings") },
          { type: "separator" },
          { role: "services", label: "Services" },
          { type: "separator" },
          { role: "hide", label: `Hide ${APP_NAME}` },
          { role: "hideOthers", label: "Hide Others" },
          { role: "unhide", label: "Show All" },
          { type: "separator" },
          { role: "quit", label: `Quit ${APP_NAME}` },
        ],
      },
      {
        label: "File",
        submenu: [
          { label: "New Draft…", accelerator: "CmdOrCtrl+N", click: () => send("new-draft") },
          { type: "separator" },
          { id: "publish", label: "Publish…", click: () => send("publish") },
          { id: "reveal", label: "Show in Finder", click: () => send("reveal") },
          { type: "separator" },
          { role: "close", label: "Close Window" },
        ],
      },
      {
        label: "Edit",
        submenu: [
          { label: "Undo", ...shown("CmdOrCtrl+Z"), click: () => send("undo") },
          { label: "Redo", ...shown("Shift+CmdOrCtrl+Z"), click: () => send("redo") },
          { type: "separator" },
          { role: "cut", label: "Cut" },
          { role: "copy", label: "Copy" },
          { role: "paste", label: "Paste" },
          { role: "selectAll", label: "Select All" },
        ],
      },
      {
        label: "View",
        submenu: [
          {
            id: "sidebar",
            label: "Drafts",
            type: "checkbox",
            ...shown("CmdOrCtrl+O"),
            click: () => send("toggle-sidebar"),
          },
          {
            id: "notes",
            label: "Review Mode",
            type: "checkbox",
            ...shown(process.platform === "darwin" ? "Ctrl+Cmd+N" : "Ctrl+Alt+N"),
            click: () => send("toggle-notes"),
          },
          { type: "separator" },
          {
            id: "preview",
            label: "Preview",
            type: "checkbox",
            ...shown("Shift+CmdOrCtrl+P"),
            click: () => send("toggle-preview"),
          },
          { id: "focus", label: "Focus Mode", type: "checkbox", click: () => send("toggle-focus") },
          {
            id: "hemingway",
            label: "Hemingway Mode",
            type: "checkbox",
            click: () => send("toggle-hemingway"),
          },
          { type: "separator" },
          { role: "resetZoom", label: "Actual Size" },
          { role: "zoomIn", label: "Zoom In" },
          { role: "zoomOut", label: "Zoom Out" },
          { type: "separator" },
          { role: "togglefullscreen", label: "Enter Full Screen" },
          ...(dev ? [{ role: "toggleDevTools" as const }] : []),
        ],
      },
      { role: "windowMenu", label: "Window" },
      {
        role: "help",
        label: "Help",
        submenu: [
          { label: `${APP_NAME} Help`, accelerator: "CmdOrCtrl+?", click: () => send("help") },
        ],
      },
    ]),
  );
  applyMenuState({
    hasDraft: false,
    sidebar: true,
    notes: false,
    preview: false,
    focus: false,
    hemingway: false,
  });
}

function applyMenuState(state: MenuState) {
  const menu = Menu.getApplicationMenu();
  if (!menu) return;
  for (const key of ["sidebar", "notes", "preview", "focus", "hemingway"] as const) {
    const item = menu.getMenuItemById(key);
    if (item) item.checked = state[key];
  }
  for (const id of ["publish", "reveal", "preview", "focus", "hemingway"]) {
    const item = menu.getMenuItemById(id);
    if (item) item.enabled = state.hasDraft;
  }
}

async function createWindow() {
  if (!existsSync(WEB_DIST)) {
    dialog.showErrorBox(
      APP_NAME,
      "The interface build is missing: start with “npm run desktop”, which builds it.",
    );
    app.quit();
    return;
  }
  const token = randomBytes(32).toString("base64url");
  try {
    origin = await startServer(token);
  } catch (e) {
    dialog.showErrorBox(APP_NAME, `Couldn’t start the server: ${(e as Error).message}`);
    app.quit();
    return;
  }

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    show: false,
    title: APP_NAME,
    icon: ICON, // Windows and Linux; on macOS the Dock's icon counts
    backgroundColor: BACKGROUND,
    // Integrated title bar, like macOS apps: the traffic lights sit above the sidebar.
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 22 },
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: PRELOAD,
    },
  });
  buildMenu();
  // Only this page updates the menu, and only with boolean values.
  ipcMain.removeAllListeners("menu-state");
  ipcMain.on("menu-state", (event, raw: unknown) => {
    if (event.sender !== win.webContents || typeof raw !== "object" || raw === null) return;
    const state = Object.fromEntries(
      MENU_STATE_KEYS.map((k) => [k, (raw as Record<string, unknown>)[k] === true]),
    ) as unknown as MenuState;
    applyMenuState(state);
  });

  // The page stays on the app: links (from the preview) open in the browser, only if http(s).
  win.webContents.on("will-navigate", (e, url) => {
    if (new URL(url).origin !== origin) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && new URL(url).origin !== origin) void shell.openExternal(url);
    return { action: "deny" };
  });

  // On close, the pending text is saved first (autosave after 800 ms).
  let flushed = false;
  win.on("close", (e) => {
    if (flushed) return;
    e.preventDefault();
    const flush = win.webContents
      .executeJavaScript("window.__deskFlush ? window.__deskFlush() : null")
      .catch(() => {});
    const timeout = new Promise((r) => setTimeout(r, 2000));
    void Promise.race([flush, timeout]).then(() => {
      flushed = true;
      win.close();
    });
  });

  win.once("ready-to-show", () => win.show());
  await win.loadURL(`${origin}/?shell=desktop#t=${token}`);
}

app.setName(APP_NAME);
// In tests: separate data (and single-instance lock), so they run even with the app open.
if (process.env.DESK_USER_DATA) app.setPath("userData", process.env.DESK_USER_DATA);
app.setAboutPanelOptions({
  applicationName: APP_NAME,
  iconPath: ICON,
  credits: "A Markdown editor where a local model suggests and the author decides.",
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  void app.whenReady().then(() => {
    // Without a package the Dock would show Electron's icon.
    app.dock?.setIcon(ICON);
    // No permissions (microphone, notifications, location…): the app uses none.
    session.defaultSession.setPermissionRequestHandler((_wc, _p, done) => done(false));
    void createWindow();
  });
  // A single window: once it is closed, the app (and the server) quit.
  app.on("window-all-closed", () => app.quit());
  let quitting = false;
  app.on("before-quit", (e) => {
    if (quitting || !server) return;
    e.preventDefault();
    quitting = true;
    void stopServer().then(() => app.quit());
  });
}
