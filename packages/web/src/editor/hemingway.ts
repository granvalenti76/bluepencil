import type { Extension } from "@codemirror/state";

// Not implemented yet: the switch is wired (Editor.tsx reconfigures this extension), but there is
// no filter here. A full version needs a transactionFilter that blocks deletions, lets
// `deskAction` transactions through, and handles IME and dead keys.
export function hemingway(enabled: boolean): Extension {
  void enabled;
  return [];
}
