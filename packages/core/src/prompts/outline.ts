import type { Archetype } from "../archetypes/types.ts";
import type { LanguagePack } from "../languages/pack.ts";
import { fill } from "../languages/template.ts";
import type { ChatMessage } from "../model/types.ts";

/** Structure proposal. The text lives in the language pack. */
export function outlineMessages(
  pack: LanguagePack,
  archetype: Archetype,
  topic: string,
  target: number,
): ChatMessage[] {
  const l = pack.labels.outline;
  const user = [
    fill(l.type, { name: archetype.name }),
    fill(l.sections, {
      sections: archetype.defaultSections
        .map((s) =>
          fill(l.section, {
            title: s.title,
            percent: Math.round(s.share * 100),
            guidance: s.guidance,
          }),
        )
        .join(l.sectionSeparator),
    }),
    fill(l.checklist, { items: archetype.checklist.map((c) => c.description).join(" ") }),
    fill(l.rules, { rules: archetype.proseRules.join(" ") }),
    fill(l.target, { target }),
    "",
    l.topic,
    topic.trim() || l.noTopic,
  ].join("\n");

  return [
    { role: "system", content: pack.prompts.outline },
    { role: "user", content: user },
  ];
}
