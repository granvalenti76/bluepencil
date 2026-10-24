import type { ReviewStep } from "../judgments/schema.ts";
import type { ChatMessage } from "../model/types.ts";
import { buildMessages, type DraftContext, type ReviewInput } from "./context.ts";

export type TokenCounter = (text: string) => Promise<number>;

export interface Fitted {
  messages: ChatMessage[];
  ctx: DraftContext;
  input: ReviewInput;
  tokens: number;
  /** What had to be cut. */
  trimmed: { sources: number; ignored: number };
}

/**
 * Trims the request until it fits the budget, in this order: source passages, list of
 * dismissed notes. System, context and the draft's text are never cut: if that is not enough,
 * the request stays over budget and `tokens` says so.
 */
export async function fitToBudget(
  step: ReviewStep,
  ctx: DraftContext,
  input: ReviewInput,
  budget: number,
  count: TokenCounter,
): Promise<Fitted> {
  let c = ctx;
  let i = input;
  const trimmed = { sources: 0, ignored: 0 };
  const measure = async () => {
    const messages = buildMessages(step, c, i);
    return { messages, tokens: await count(messages.map((m) => m.content).join("\n")) };
  };

  let m = await measure();
  while (m.tokens > budget) {
    if (i.sources?.length) {
      i = { ...i, sources: i.sources.slice(0, -1) };
      trimmed.sources++;
    } else if (c.ignored.length) {
      // A cut that changes the context also changes the start of the prompt: halve it each time.
      const keep = Math.floor(c.ignored.length / 2);
      trimmed.ignored += c.ignored.length - keep;
      c = { ...c, ignored: c.ignored.slice(0, keep) };
    } else break;
    m = await measure();
  }
  return { ...m, ctx: c, input: i, trimmed };
}
