import type { Judgment, OutlineEntry } from "@desk/core";
import type { FilterType } from "../editor/judgmentsField.ts";
import type { MarksInfo } from "../editor/proofMarks.ts";
import { hasCard, noteType } from "./notes.ts";

/**
 * The panel's notes in reading order: those tied to the text, in text order, then those on the
 * whole text. The same order numbers the marks on the page.
 */
export function orderedNotes(notes: Judgment[], visibleTypes: Record<FilterType, boolean>) {
  const shown = notes
    .filter((n) => n.status !== "stale" && hasCard(n) && visibleTypes[noteType(n)])
    .map((n, order) => ({ n, order }))
    .sort(
      (a, b) => (a.n.range?.from ?? Infinity) - (b.n.range?.from ?? Infinity) || a.order - b.order,
    )
    .map(({ n }) => n);
  return {
    anchored: shown.filter((n) => n.range !== null),
    loose: shown.filter((n) => n.range === null),
  };
}

/** The number of each note (from 1), the same in the panel and on the page. */
export function noteNumbers(order: ReturnType<typeof orderedNotes>): Record<string, number> {
  return Object.fromEntries([...order.anchored, ...order.loose].map((n, i) => [n.id, i + 1]));
}

/** A structure note on a section that does not exist yet: marked with ‸ at the end of the page. */
export const isMissingPart = (n: Judgment) =>
  n.pass === "structure" &&
  n.status === "open" &&
  n.range === null &&
  n.sectionId !== undefined &&
  n.proposal.action === "draft_section";

/** What the marks on the page need (proofMarks.ts). */
export function marksInfo(
  notes: Judgment[],
  visibleTypes: Record<FilterType, boolean>,
  outline: OutlineEntry[],
): MarksInfo {
  const order = orderedNotes(notes, visibleTypes);
  const numbers = noteNumbers(order);
  return {
    numbers,
    missing: order.loose.filter(isMissingPart).map((n) => {
      const title = outline.find((o) => o.id === n.sectionId)?.title ?? n.sectionId!;
      return { id: n.id, n: numbers[n.id]!, label: `${title} goes here` };
    }),
  };
}
