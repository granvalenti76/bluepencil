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
