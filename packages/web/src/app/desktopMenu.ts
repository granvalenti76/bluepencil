import { redo, undo } from "@codemirror/commands";
import { api } from "./api.ts";
import { useDialog } from "./dialogs.ts";
import { useDoc } from "./docStore.ts";
import { session } from "./session.ts";
import { useUi } from "./store.ts";

/** The desktop app's preload bridge (`packages/desktop/src/preload.cjs`); missing in the browser. */
interface Bridge {
  onMenu: (callback: (command: string) => void) => void;
  menuState: (state: Record<string, boolean>) => void;
}
declare global {
  interface Window {
    bluepencil?: Bridge;
  }
}

/** A text field outside the editor (a dialog) has focus: the native undo applies there. */
const inField = () => {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
};

function run(command: string) {
  const ui = useUi.getState();
  const dialogs = useDialog.getState();
  const { path } = useDoc.getState();
  switch (command) {
    case "new-draft":
    case "settings":
    case "help":
      return dialogs.show(command);
    case "publish":
      return path && dialogs.show("publish");
    case "reveal":
      return path && void api.reveal(path).catch(() => {});
    case "undo":
    case "redo": {
      const view = session.getView();
      if (inField() || !view) return void document.execCommand(command);
      return void (command === "undo" ? undo : redo)(view);
    }
    case "toggle-sidebar":
      return ui.setDrafts();
    case "toggle-notes":
      return ui.setMode(ui.mode === "review" ? "write" : "review");
    case "toggle-preview":
      return path && ui.togglePreview();
    case "toggle-focus":
      return path && ui.toggle("focus");
    case "toggle-hemingway":
      return path && ui.toggle("hemingway");
  }
}

/**
 * Desktop app menu: the commands arrive here; the state (checkmarks, items disabled with no open
 * draft) goes back to the menu at every change.
 */
export function connectDesktopMenu(): void {
  const bridge = window.bluepencil;
  if (!bridge) return;
  bridge.onMenu(run);
  let last = "";
  const push = () => {
    const ui = useUi.getState();
    const state = {
      hasDraft: useDoc.getState().path !== null,
      sidebar: ui.draftsOpen || useDoc.getState().path === null,
      notes: ui.mode === "review",
      preview: ui.preview,
      focus: ui.focus,
      hemingway: ui.hemingway,
    };
    const key = JSON.stringify(state);
    if (key === last) return;
    last = key;
    bridge.menuState(state);
  };
  useUi.subscribe(push);
  useDoc.subscribe(push);
  push();
}
