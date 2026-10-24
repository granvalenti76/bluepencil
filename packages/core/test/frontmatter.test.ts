import { describe, expect, test } from "vitest";
import { parseDraft, patchFrontMatter, replaceBody } from "../src/index.ts";
import { fixture, TURBOCODE } from "./fixture.ts";

const WITH_UNKNOWN = `---
# commento in testa
title: Prova   # commento di riga
archetype: blog
custom_field:
  nested: [1, 2, 3]
date: 2026-09-12
tags: [a, b]
stage: writing
---
# Prova

Testo.
`;

describe("front matter", () => {
  test("reads the known fields from the Turbocode draft", () => {
    const d = parseDraft(fixture(TURBOCODE));
    expect(d.issues).toEqual([]);
    expect(d.data.title).toBe("Turbocode V0.6");
    expect(d.data.archetype).toBe("article");
    expect(d.data.target).toBe(900);
    expect(d.data.outline?.map((o) => o.id)).toEqual(["lead", "context", "development", "closing"]);
    expect(d.data.glossary).toContain("Q3_XSS");
    expect(d.body.startsWith("# Turbocode V0.6")).toBe(true);
  });

  test("with no changes the text is identical", () => {
    for (const text of [WITH_UNKNOWN, fixture(TURBOCODE)]) {
      expect(patchFrontMatter(text, {})).toBe(text);
    }
  });

  test("round-trip: one field changes, the rest (unknown fields, comments, order) stays", () => {
    const out = patchFrontMatter(WITH_UNKNOWN, { stage: "review" });
    expect(out).toBe(WITH_UNKNOWN.replace("stage: writing", "stage: review"));
    const d = parseDraft(out);
    expect(d.data.custom_field).toEqual({ nested: [1, 2, 3] });
    expect(d.data.stage).toBe("review");
  });

  test("round-trip on the Turbocode draft: only the touched line changes", () => {
    const text = fixture(TURBOCODE);
    const out = patchFrontMatter(text, { stage: "review" });
    expect(out).toBe(text.replace("stage: writing", "stage: review"));
  });

  test("appends a field and removes it with undefined", () => {
    const added = patchFrontMatter(WITH_UNKNOWN, { target: 500 });
    expect(added).toContain("target: 500");
    expect(added).toContain("# commento in testa");
    expect(patchFrontMatter(added, { target: undefined })).toBe(WITH_UNKNOWN);
  });

  test("the body does not change", () => {
    const out = patchFrontMatter(WITH_UNKNOWN, { stage: "review" });
    expect(parseDraft(out).body).toBe(parseDraft(WITH_UNKNOWN).body);
  });

  test("file without front matter and with CRLF", () => {
    const plain = parseDraft("# Solo corpo\n");
    expect(plain.hasFrontMatter).toBe(false);
    expect(plain.body).toBe("# Solo corpo\n");
    const crlf = parseDraft("---\r\ntitle: A\r\n---\r\ncorpo\r\n");
    expect(crlf.data.title).toBe("A");
    expect(crlf.body).toBe("corpo\r\n");
  });

  test("invalid values: the raw fields stay and the issues are reported", () => {
    const d = parseDraft("---\nstage: boh\ntarget: molti\n---\ncorpo\n");
    expect(d.issues.length).toBeGreaterThan(0);
    expect(d.data.stage).toBe("boh");
  });

  test("replaceBody keeps the front matter byte for byte", () => {
    const text = fixture(TURBOCODE);
    const out = replaceBody(text, "# Nuovo\n");
    expect(out.slice(0, parseDraft(text).bodyOffset)).toBe(
      text.slice(0, parseDraft(text).bodyOffset),
    );
    expect(parseDraft(out).body).toBe("# Nuovo\n");
  });
});

describe("front matter: changes to complex fields", () => {
  test("replaces the outline without touching the other lines", () => {
    const text = fixture(TURBOCODE);
    const outline = [{ id: "a", title: "A", target: 10 }];
    const out = patchFrontMatter(text, { outline });
    const d = parseDraft(out);
    expect(d.issues).toEqual([]);
    expect(d.data.outline).toEqual(outline);
    expect(d.data.glossary).toContain("Q3_XSS");
    expect(d.body).toBe(parseDraft(text).body);
    expect(out).toContain(
      "title: Turbocode V0.6\narchetype: article\nstage: writing\ntarget: 900\n",
    );
    expect(out).toContain("sources:\n  - fatti.md");
  });

  test("creates the front matter if missing", () => {
    const out = patchFrontMatter("# T\n", { stage: "structure" });
    expect(out).toBe("---\nstage: structure\n---\n# T\n");
  });
});
