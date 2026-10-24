export const STAGE_LABEL: Record<string, string> = {
  structure: "Structure",
  writing: "Writing",
  review: "Review",
};

/**
 * Names of the types of text in the interface. The core's ones (in Italian) stay for the prompts.
 */
const ARCHETYPE_LABEL: Record<string, { name: string; short: string }> = {
  article: { name: "News article", short: "Article" },
  blog: { name: "Blog post", short: "Blog" },
  report: { name: "Report", short: "Report" },
  docs: { name: "Documentation", short: "Docs" },
};

export function archetypeShortName(id: string): string {
  return ARCHETYPE_LABEL[id]?.short ?? "Not chosen";
}

export function archetypeName(id: string): string {
  return ARCHETYPE_LABEL[id]?.name ?? "Not chosen";
}
