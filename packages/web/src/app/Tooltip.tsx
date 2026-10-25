import { useEffect, useRef, useState } from "react";
import { shortcut } from "./keys.ts";

/** How long the mouse must rest before the tooltip appears (like SwiftUI's `.help`). */
const DELAY_MS = 450;
/** Moving from one element to another, the next tooltip appears at once. */
const WARM_MS = 600;

interface Tip {
  text: string;
  /** Horizontal centre and edges of the element, in window coordinates. */
  x: number;
  top: number;
  bottom: number;
}

/**
 * The interface's tooltips: every element with `data-tip` shows, after a short rest of the mouse
 * or with keyboard focus, a small bubble that says what it does. Only one per page; the text is
 * also the element's accessible name (or completes it), so screen readers need nothing else.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const warmUntil = useRef(0);
  const current = useRef<Element | null>(null);

  useEffect(() => {
    const show = (el: Element) => {
      const tip = el.getAttribute("data-tip");
      if (!tip) return;
      const text = shortcut(tip);
      const r = el.getBoundingClientRect();
      setTip({ text, x: r.left + r.width / 2, top: r.top, bottom: r.bottom });
    };
    const hide = () => {
      clearTimeout(timer.current);
      if (current.current) warmUntil.current = Date.now() + WARM_MS;
      current.current = null;
      setTip(null);
    };
    const enter = (el: Element | null) => {
      if (el === current.current) return;
      hide();
      if (!el) return;
      current.current = el;
      const wait = Date.now() < warmUntil.current ? 0 : DELAY_MS;
      timer.current = setTimeout(() => current.current === el && show(el), wait);
    };
    const over = (e: Event) => enter((e.target as Element).closest?.("[data-tip]") ?? null);
    const focus = (e: FocusEvent) => {
      const el = (e.target as Element).closest?.("[data-tip]");
      // Keyboard focus only: after a click the tooltip is not needed.
      if (el && (e.target as Element).matches(":focus-visible")) enter(el);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && hide();
    // After a click the tooltip is no longer needed: it comes back only by leaving and re-entering with the mouse.
    const press = () => {
      clearTimeout(timer.current);
      setTip(null);
    };
    document.addEventListener("pointerover", over);
    document.addEventListener("focusin", focus);
    document.addEventListener("pointerdown", press, true);
    document.addEventListener("scroll", hide, true);
    document.addEventListener("keydown", key);
    window.addEventListener("blur", hide);
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener("pointerover", over);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("pointerdown", press, true);
      document.removeEventListener("scroll", hide, true);
      document.removeEventListener("keydown", key);
      window.removeEventListener("blur", hide);
    };
  }, []);

  if (!tip) return null;
  // Below the element; above if there is no room below. Never outside the window.
  const below = tip.bottom + 44 < window.innerHeight;
  const left = Math.min(Math.max(tip.x, 120), window.innerWidth - 120);
  return (
    <div
      className="tip"
      role="tooltip"
      data-side={below ? "below" : "above"}
      style={{
        left,
        top: below ? tip.bottom + 8 : undefined,
        bottom: below ? undefined : window.innerHeight - tip.top + 8,
        ["--arrow-x" as string]: `${tip.x - left}px`,
      }}
    >
      {tip.text}
    </div>
  );
}
