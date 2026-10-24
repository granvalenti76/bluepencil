import type { LanguagePack } from "../languages/pack.ts";
import { fill } from "../languages/template.ts";

/** The single JSON repair attempt. */
export const repairMessage = (pack: LanguagePack, error: string): string =>
  fill(pack.prompts.repair, { error });
