import type { ReviewStep } from "../judgments/schema.ts";
import type { LanguagePack } from "../languages/pack.ts";

export { focusInstructions, stepInstructions, stepTools } from "./passes.ts";
export { systemPrompt } from "./system.ts";
export { outlineMessages } from "./outline.ts";
export { sectionMessages, type SectionRequest } from "./section.ts";
export { repairMessage } from "./repair.ts";
export {
  rewriteMessages,
  REWRITE_STYLE_LABEL,
  REWRITE_STYLES,
  type RewriteRequest,
  type RewriteStyle,
} from "./rewrite.ts";

/**
 * Prompt version of a pass: system + instructions, from the language pack. Part of
 * `chunkHash`. For Italian it is the long-standing one (`s4-grammar2`).
 */
export function promptVersion(pack: LanguagePack, step: ReviewStep): string {
  const v = pack.promptVersions;
  return `s${v.system}-${step}${v[step]}${pack.versionSuffix}`;
}
