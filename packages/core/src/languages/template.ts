/** Placeholder in a text template: `{{name}}`. */
const PLACEHOLDER = /\{\{([a-zA-Z]+)\}\}/g;

/** The placeholders a text uses, without repeats. */
export function placeholdersIn(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1]!))];
}

/**
 * Fills the placeholders in a single pass: a value that contains `{{…}}` (a draft's text, for
 * example) is not read again. Placeholders were already validated at load time.
 */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(PLACEHOLDER, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}
