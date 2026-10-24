import { describe, expect, it } from "vitest";
import { parseDraft, publishText } from "../src/index.ts";
import { fixture, TURBOCODE } from "./fixture.ts";

describe("publishing", () => {
  it("removes the editorial fields and keeps the others, with their order and comments", () => {
    const text =
      "---\ntitle: Prova\ndate: 2026-10-03 # giorno\narchetype: blog\nstage: review\ntags: [a, b]\ntarget: 500\noutline:\n  - id: x\n    title: X\n    target: 5\nsources:\n  - fatti.md\nglossary: [Desk]\nslug: prova\n---\n# Prova\n\nTesto.\n";
    const { text: out } = publishText(text);
    expect(out).toBe(
      "---\ntitle: Prova\ndate: 2026-10-03 # giorno\ntags: [a, b]\nslug: prova\n---\n# Prova\n\nTesto.\n",
    );
  });

  it("the review's sign-off is not published", () => {
    const { text } = publishText(
      "---\ntitle: Prova\nsignoff:\n  at: 2026-10-22T21:12:00Z\n  body: 3f9a1c0b7e21\n---\nTesto.\n",
    );
    expect(text).toBe("---\ntitle: Prova\n---\nTesto.\n");
  });

  it("`lang` stays in the published file: the site needs it", () => {
    const { text } = publishText("---\ntitle: Prova\nstage: review\nlang: en\n---\nText.\n");
    expect(text).toBe("---\ntitle: Prova\nlang: en\n---\nText.\n");
  });

  it("notes to local files and opinions removed, URLs kept; section markers removed", () => {
    const text =
      "---\ntitle: T\n---\n# T\n\n<!-- section: lead -->\nCifra[^1] e link[^2] e opinione[^3].\n\n<!-- section: dev -->Altro.\n\n[^1]: fatti.md\n[^2]: https://example.org/x\n[^3]: Valutazione dell'autore.\n";
    const r = publishText(text);
    expect(r.text).toBe(
      "---\ntitle: T\n---\n# T\n\nCifra e link[^2] e opinione.\n\nAltro.\n\n[^2]: https://example.org/x\n",
    );
    expect(r.removedNotes.map((n) => n.id)).toEqual(["1", "3"]);
  });

  it("Turbocode: no editorial fields, text intact", () => {
    const src = fixture(TURBOCODE);
    const { text } = publishText(src);
    const p = parseDraft(text);
    expect(Object.keys(p.data)).toEqual(["title"]);
    expect(text).not.toContain("<!-- section");
    expect(p.body).toContain("Turbocode è un agent harness locale per macOS");
  });

  it("without front matter it stays without", () => {
    expect(publishText("# A\n\nB.\n").text).toBe("# A\n\nB.\n");
  });
});
