/**
 * Shortcuts across systems. The app is written with macOS in mind (⌘, ⌃⌘, ⇧⌘, ⌥⌘); elsewhere ⌘
 * becomes Ctrl and ⌃ becomes Alt, the same mapping CodeMirror's "Mod" uses for the editor keys.
 */
export const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** ⌘ alone (⌘O, ⌘S…): Cmd on macOS, Ctrl elsewhere. */
export function mod(e: KeyboardEvent, mac = isMac): boolean {
  return mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey && !e.altKey;
}

/** ⌃⌘ (⌃⌘N, ⌃⌘S): Ctrl+Cmd on macOS, Ctrl+Alt elsewhere. */
export function ctrlMod(e: KeyboardEvent, mac = isMac): boolean {
  return mac ? e.metaKey && e.ctrlKey : e.ctrlKey && e.altKey && !e.metaKey;
}

/** The text of a shortcut in the system's way: "⇧⌘P" stays on macOS, "Ctrl+Shift+P" elsewhere. */
export function shortcut(text: string, mac = isMac): string {
  if (mac) return text;
  return text.replace(/([⌃⌥⇧]*)⌘(\S)/g, (_, mods: string, key: string) =>
    [
      "Ctrl",
      ...(mods.includes("⌃") || mods.includes("⌥") ? ["Alt"] : []),
      ...(mods.includes("⇧") ? ["Shift"] : []),
      key,
    ].join("+"),
  );
}
