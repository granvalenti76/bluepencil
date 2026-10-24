export interface ArchetypeSection {
  id: string;
  title: string;
  /** Share of the total target (the shares of an archetype add up to 1). */
  share: number;
  guidance: string;
}

export interface ChecklistItem {
  id: string;
  description: string;
  sectionId?: string;
  severity: "warn" | "missing";
}

export interface Archetype {
  id: "article" | "blog" | "report" | "docs";
  name: string;
  shortName: string;
  defaultTarget: number;
  defaultSections: ArchetypeSection[];
  checklist: ChecklistItem[];
  proseRules: string[];
}

/** The part of an archetype that does not depend on the language (see `skeletons.ts`). */
export interface ArchetypeSkeleton {
  id: Archetype["id"];
  defaultTarget: number;
  sections: { id: string; share: number }[];
  checklist: { id: string; sectionId?: string; severity: ChecklistItem["severity"] }[];
}
