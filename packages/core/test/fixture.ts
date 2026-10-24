import { readFileSync } from "node:fs";

export function fixture(name: string): string {
  return readFileSync(new URL(`../../../fixtures/drafts/${name}`, import.meta.url), "utf8");
}
export const TURBOCODE = "turbocode-draft-12-settembre.md";
