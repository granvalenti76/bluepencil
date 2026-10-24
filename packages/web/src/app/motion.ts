/**
 * The animations: short, never blocking, and only for what happens now (a pass starting, notes
 * and letter arriving, the sign-off just given), never when reopening a draft. With "Reduce
 * motion" none of them runs: design.css turns off the CSS ones, the JavaScript ones ask here.
 */

export const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Between one note (or mark) and the next; after eight, all together. */
export const STAGGER = 110;
export const staggerDelay = (order: number) => Math.min(order, 8) * STAGGER;

/** When the author signed off in this page: the signature is written only then. */
let signedAt = 0;
/** Notes that arrived from the model in this page: id → delay before they appear on the card. */
const arrived = new Map<string, number>();
const serveListeners = new Set<() => void>();

export const motion = {
  signed() {
    signedAt = Date.now();
  },
  /** The sign-off has just been given (signature, date and stamp animate). */
  justSigned: () => Date.now() - signedAt < 4000,

  /** A group of newly arrived notes, in text order: they appear one at a time. */
  arrive(ids: string[]) {
    ids.forEach((id, i) => arrived.set(id, staggerDelay(i)));
  },
  noteDelay: (id: string) => arrived.get(id),

  /** A pass starts: the card is served. */
  serve() {
    for (const fn of serveListeners) fn();
  },
  onServe(fn: () => void) {
    serveListeners.add(fn);
    return () => void serveListeners.delete(fn);
  },
};
