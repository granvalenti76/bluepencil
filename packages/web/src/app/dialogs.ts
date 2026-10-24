import { create } from "zustand";

export type DialogName = "new-draft" | "publish" | "settings" | "help";

/**
 * The open dialog (one at a time). It lives outside the components that have the button because
 * the desktop app's menu opens it too, and because the closed sidebar is `inert`.
 */
export const useDialog = create<{
  open: DialogName | null;
  show: (name: DialogName) => void;
  close: () => void;
}>()((set) => ({
  open: null,
  show: (name) => set({ open: name }),
  close: () => set({ open: null }),
}));
