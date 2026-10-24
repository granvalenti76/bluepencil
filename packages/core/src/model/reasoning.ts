const OPEN = "<think>";
const CLOSE = "</think>";

/**
 * Separates the reasoning written inside `content` (`<think>…</think>`) from the response.
 * Some templates open the reasoning in the prompt: then the response holds only `</think>`
 * and everything before it is reasoning.
 */
export function splitThink(content: string): { reasoning: string; answer: string } {
  const close = content.lastIndexOf(CLOSE);
  if (close !== -1) {
    let reasoning = content.slice(0, close);
    const open = reasoning.indexOf(OPEN);
    if (open !== -1 && reasoning.slice(0, open).trim() === "")
      reasoning = reasoning.slice(open + OPEN.length);
    return { reasoning: reasoning.trim(), answer: content.slice(close + CLOSE.length).trim() };
  }
  const trimmed = content.trimStart();
  if (trimmed.startsWith(OPEN)) {
    // Reasoning never closed: the response did not arrive (usually it was truncated).
    return { reasoning: trimmed.slice(OPEN.length).trim(), answer: "" };
  }
  return { reasoning: "", answer: content.trim() };
}

/**
 * Guesses while streaming whether `content` is still reasoning: used only for the
 * "thinking…" / "writing the notes" indicator. `splitThink` does the real split at the end.
 */
export class ThinkTracker {
  private text = "";
  private closed = false;

  push(delta: string): "reasoning" | "answer" {
    this.text += delta;
    if (!this.closed && this.text.includes(CLOSE)) this.closed = true;
    if (this.closed) return this.text.endsWith(CLOSE) ? "reasoning" : "answer";
    const head = this.text.trimStart();
    if (head.startsWith(OPEN) || OPEN.startsWith(head)) return "reasoning";
    return "answer";
  }
}
