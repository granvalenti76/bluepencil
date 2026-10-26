import { isStylePath } from "@desk/core";
import { useDoc } from "./docStore.ts";
import { useUi, type Mode } from "./store.ts";

/**
 * The mode the desk shows. A style file is not reviewed and looks at no style: it is always in
 * Write, with its labels on the left and what it does on the right.
 */
export function useMode(): Mode {
  const mode = useUi((s) => s.mode);
  const isStyle = useDoc((s) => (s.path ? isStylePath(s.path) : false));
  return isStyle ? "write" : mode;
}
