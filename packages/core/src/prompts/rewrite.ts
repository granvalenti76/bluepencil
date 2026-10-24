import { REWRITE_GOALS } from "../languages/pack.ts";
import { fill } from "../languages/template.ts";
import type { ChatMessage } from "../model/types.ts";
import { renderDraftContext, type DraftContext } from "../review/context.ts";

export const REWRITE_STYLES = REWRITE_GOALS;
export type RewriteStyle = (typeof REWRITE_STYLES)[number];

export const REWRITE_STYLE_LABEL: Record<RewriteStyle, string> = {
  concise: "Concise",
  clear: "Clearer",
  fluent: "Smoother",
  creative: "Creative",
};

export interface RewriteRequest {
  style: RewriteStyle;
  /** The passage selected by the author. */
  passage: string;
  /** The whole text of the draft: to understand the passage and make it fit. */
  text: string;
}

/**
 * "Rephrase" on the selection: one to three rewrite **proposals** for the passage, which the
 * author can use (one click, undoable) or discard. Does not touch the file. The text lives in
 * the language pack.
 */
export function rewriteMessages(ctx: DraftContext, req: RewriteRequest): ChatMessage[] {
  const { pack } = ctx;
  const l = pack.labels.rewrite;
  const system = fill(pack.prompts.rewrite, {
    goal: l.goals[req.style],
    context: renderDraftContext(ctx),
  });
  const user = [l.text, "<<<", req.text, ">>>", "", l.passage, "<<<", req.passage, ">>>"];
  return [
    { role: "system", content: system },
    { role: "user", content: user.join("\n") },
  ];
}
