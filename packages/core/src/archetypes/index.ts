import type { LanguagePack } from "../languages/pack.ts";
import type { Archetype } from "./types.ts";

export type { Archetype, ArchetypeSection, ArchetypeSkeleton, ChecklistItem } from "./types.ts";
export { ARCHETYPE_SKELETONS } from "./skeletons.ts";

/** A type of text in the pack's language; `undefined` if the id is unknown ("undecided"). */
export function archetypeIn(pack: LanguagePack, id: string | undefined): Archetype | undefined {
  return pack.archetypes.find((a) => a.id === id);
}
