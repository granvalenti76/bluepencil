import { fill } from "../languages/template.ts";
import type { ChatMessage } from "../model/types.ts";
import { renderDraftContext, type DraftContext } from "../review/context.ts";

export interface SectionRequest {
  mode: "draft" | "regenerate";
  title: string;
  target: number;
  /** Current text of the section (for `regenerate`). */
  current?: string;
  /** Why it is asked: the note's reason. */
  reason?: string;
  /** End of the previous section and start of the next: to make it fit. */
  before?: string;
  after?: string;
}

/**
 * Proposed text for a section (`draft_section` / `regenerate_section`). It is a proposal: it
 * goes into the file only with "Insert". The text lives in the language pack.
 */
export function sectionMessages(ctx: DraftContext, req: SectionRequest): ChatMessage[] {
  const { pack } = ctx;
  const l = pack.labels.section;
  const system = fill(pack.prompts.section, { context: renderDraftContext(ctx) });
  const user: string[] = [
    fill(req.mode === "draft" ? l.draft : l.regenerate, { title: req.title, target: req.target }),
  ];
  if (req.reason) user.push("", fill(l.reason, { reason: req.reason }));
  if (req.before?.trim()) user.push("", l.before, "<<<", req.before.trim(), ">>>");
  if (req.current?.trim()) user.push("", l.current, "<<<", req.current.trim(), ">>>");
  if (req.after?.trim()) user.push("", l.after, "<<<", req.after.trim(), ">>>");
  return [
    { role: "system", content: system },
    { role: "user", content: user.join("\n") },
  ];
}
