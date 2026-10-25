import { describe, expect, it } from "vitest";
import { ctrlMod, mod, shortcut } from "./keys.ts";

const ev = (o: Partial<KeyboardEvent>) =>
  ({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...o }) as KeyboardEvent;

describe("shortcut", () => {
  it("leaves the macOS glyphs on macOS", () => {
    expect(shortcut("⌃⌘N · ⇧⌘P", true)).toBe("⌃⌘N · ⇧⌘P");
  });

  it("spells shortcuts with Ctrl elsewhere", () => {
    expect(shortcut("⌘O", false)).toBe("Ctrl+O");
    expect(shortcut("⌃⌘N", false)).toBe("Ctrl+Alt+N");
    expect(shortcut("⌥⌘1–3 · ⌥⌘0", false)).toBe("Ctrl+Alt+1–3 · Ctrl+Alt+0");
    expect(shortcut("⌘Z / ⇧⌘Z", false)).toBe("Ctrl+Z / Ctrl+Shift+Z");
    expect(shortcut("Settings (⌘,)", false)).toBe("Settings (Ctrl+,)");
    expect(shortcut("Enter · Esc", false)).toBe("Enter · Esc");
  });

  it("reads the modifiers of each system", () => {
    expect(mod(ev({ metaKey: true }), true)).toBe(true);
    expect(mod(ev({ ctrlKey: true }), true)).toBe(false);
    expect(mod(ev({ ctrlKey: true }), false)).toBe(true);
    expect(mod(ev({ ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(ctrlMod(ev({ metaKey: true, ctrlKey: true }), true)).toBe(true);
    expect(ctrlMod(ev({ ctrlKey: true, altKey: true }), false)).toBe(true);
    expect(ctrlMod(ev({ ctrlKey: true }), false)).toBe(false);
  });
});
