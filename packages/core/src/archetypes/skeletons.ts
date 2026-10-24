import type { ArchetypeSkeleton } from "./types.ts";

/**
 * The language-independent part of a type of text: sections (id and share of the target),
 * default target, checklist items. Names, titles, hints and rules live in the language packs
 * (`packages/core/languages/<code>/archetypes/`).
 */
export const ARCHETYPE_SKELETONS: readonly ArchetypeSkeleton[] = [
  {
    id: "article",
    defaultTarget: 900,
    sections: [
      {
        id: "lead",
        share: 0.08,
      },
      {
        id: "context",
        share: 0.14,
      },
      {
        id: "development",
        share: 0.72,
      },
      {
        id: "closing",
        share: 0.06,
      },
    ],
    checklist: [
      {
        id: "lead-answers",
        sectionId: "lead",
        severity: "warn",
      },
      {
        id: "figures-sourced",
        severity: "warn",
      },
      {
        id: "has-closing",
        sectionId: "closing",
        severity: "missing",
      },
      {
        id: "no-hidden-opinions",
        severity: "warn",
      },
    ],
  },
  {
    id: "blog",
    defaultTarget: 700,
    sections: [
      {
        id: "opening",
        share: 0.15,
      },
      {
        id: "body",
        share: 0.7,
      },
      {
        id: "conclusion",
        share: 0.15,
      },
    ],
    checklist: [
      {
        id: "point-of-view",
        severity: "warn",
      },
      {
        id: "closing-call",
        sectionId: "conclusion",
        severity: "missing",
      },
    ],
  },
  {
    id: "report",
    defaultTarget: 2000,
    sections: [
      {
        id: "summary",
        share: 0.1,
      },
      {
        id: "method",
        share: 0.15,
      },
      {
        id: "results",
        share: 0.45,
      },
      {
        id: "limits",
        share: 0.15,
      },
      {
        id: "conclusions",
        share: 0.15,
      },
    ],
    checklist: [
      {
        id: "summary-results",
        sectionId: "summary",
        severity: "warn",
      },
      {
        id: "has-limits",
        sectionId: "limits",
        severity: "missing",
      },
      {
        id: "figures-sourced",
        severity: "warn",
      },
    ],
  },
  {
    id: "docs",
    defaultTarget: 1200,
    sections: [
      {
        id: "intro",
        share: 0.1,
      },
      {
        id: "prerequisites",
        share: 0.1,
      },
      {
        id: "procedure",
        share: 0.5,
      },
      {
        id: "verification",
        share: 0.15,
      },
      {
        id: "known-issues",
        share: 0.15,
      },
    ],
    checklist: [
      {
        id: "numbered-steps",
        sectionId: "procedure",
        severity: "warn",
      },
      {
        id: "commands-in-code",
        severity: "warn",
      },
      {
        id: "has-verification",
        sectionId: "verification",
        severity: "missing",
      },
    ],
  },
];
