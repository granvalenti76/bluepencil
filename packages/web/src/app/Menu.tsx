import { useEffect, useRef, useState, type ReactNode } from "react";

/** A popup menu: closes with Esc, with a click outside or after a choice. */
export function useMenu() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (
        e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  return { open, setOpen, box };
}

/**
 * Icon button that opens a menu (progressive disclosure): the less frequent actions sit behind
 * it, a single icon in view.
 */
export function MenuButton(props: {
  icon: ReactNode;
  label: string;
  tip: string;
  active?: boolean;
  className?: string;
  children: (close: () => void) => ReactNode;
}) {
  const { open, setOpen, box } = useMenu();
  return (
    <div className={`menu-anchor ${props.className ?? ""}`} ref={box}>
      <button
        className="icon-btn"
        aria-label={props.label}
        aria-expanded={open}
        aria-haspopup="menu"
        data-active={props.active ?? false}
        data-tip={props.tip}
        onClick={() => setOpen((o) => !o)}
      >
        {props.icon}
      </button>
      {open && (
        <div className="menu" role="menu" aria-label={props.label}>
          {props.children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
