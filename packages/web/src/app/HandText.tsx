import { useLayoutEffect, useRef } from "react";
import { reducedMotion } from "./motion.ts";

/** A line takes this long to write; the whole text, at most this long. */
const LINE_MS = 650;
const TEXT_MS = 3600;

/**
 * A handwritten text, word by word (the editor's letter, their first words). With `writing` it is
 * written line by line, each word left to right as the pen reaches it. It is all in the DOM from
 * the first moment: it can be read and selected even while it is being written.
 */
export function HandText({
  text,
  writing,
  onWritten,
  className,
}: {
  text: string;
  writing: boolean;
  /** Finished writing (at once, with "Reduce motion"). */
  onWritten?: () => void;
  className: string;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const written = useRef(onWritten);
  written.current = onWritten;
  useLayoutEffect(() => {
    const p = ref.current;
    if (!p || !writing) return;
    const done = () => {
      delete p.dataset.writing;
      written.current?.();
    };
    if (reducedMotion()) return done();
    const box = p.getBoundingClientRect();
    const words = Array.from(p.querySelectorAll<HTMLElement>(".w")).map((el) => ({
      el,
      r: el.getBoundingClientRect(),
    }));
    const tops: number[] = [];
    for (const { r } of words)
      if (!tops.some((t) => Math.abs(t - r.top) < r.height / 2)) tops.push(r.top);
    const line = Math.min(LINE_MS, TEXT_MS / Math.max(1, tops.length));
    for (const { el, r } of words) {
      const row = tops.findIndex((t) => Math.abs(t - r.top) < r.height / 2);
      el.style.animationDelay = `${Math.round(row * line + ((r.left - box.left) / box.width) * line)}ms`;
      el.style.animationDuration = `${Math.max(60, Math.round((r.width / box.width) * line))}ms`;
    }
    p.dataset.writing = "true";
    const t = window.setTimeout(done, tops.length * line + 200);
    return () => window.clearTimeout(t);
  }, [writing]);
  return (
    <p ref={ref} className={className}>
      {text.split(/(\s+)/).map((part, i) =>
        part.trim() ? (
          <span key={i} className="w">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </p>
  );
}
