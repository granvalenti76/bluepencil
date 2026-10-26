import { toAscii } from "@desk/core";

/** File name from the title; `untitled` if no letter is left (e.g. a title in Greek). */
export function slugify(title: string, untitled: string): string {
  const slug = toAscii(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || untitled;
}

/**
 * A free path for a new file: `<base>.md`, else `<base>-2.md` and on. Compared without case: on
 * macOS and Windows `Esempio.md` and `esempio.md` are the same file.
 */
export function freePath(base: string, existing: Iterable<string>): string {
  const taken = new Set([...existing].map((p) => p.toLowerCase()));
  let path = `${base}.md`;
  for (let n = 2; taken.has(path.toLowerCase()); n++) path = `${base}-${n}.md`;
  return path;
}
