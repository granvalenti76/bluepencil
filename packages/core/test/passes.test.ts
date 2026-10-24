import { describe, expect, it } from "vitest";
import {
  changedSince,
  currentPass,
  nextPass,
  passStatus,
  type Pass,
  type PassRecord,
  type PassState,
} from "../src/index.ts";

const rec = (pass: Pass, state: PassState, words = 100): PassRecord => ({
  pass,
  state,
  bodyHash: "h",
  words,
  updatedAt: "2026-10-22T00:00:00Z",
});

describe("review passes", () => {
  it("with no states the review has not started", () => {
    expect(currentPass([])).toBeNull();
  });

  it("the current one is the first, in order, neither closed nor skipped", () => {
    expect(currentPass([rec("structure", "open")])).toBe("structure");
    expect(currentPass([rec("structure", "done")])).toBe("facts");
    expect(currentPass([rec("structure", "done"), rec("facts", "skipped")])).toBe("prose");
    // The pass order counts, not the order of the rows: grammar comes after prose.
    expect(
      currentPass([rec("grammar", "done"), rec("structure", "done"), rec("facts", "done")]),
    ).toBe("prose");
    // A reopened pass becomes current again even if the later ones are closed.
    expect(
      currentPass([rec("structure", "open"), rec("facts", "done"), rec("prose", "done")]),
    ).toBe("structure");
  });

  it("all finished: no current pass", () => {
    const all = (["structure", "facts", "prose", "grammar"] as Pass[]).map((p) => rec(p, "done"));
    expect(currentPass(all)).toBeNull();
  });

  it("order, state, «waiting»", () => {
    expect(nextPass("structure")).toBe("facts");
    expect(nextPass("facts")).toBe("prose");
    expect(nextPass("prose")).toBe("grammar");
    expect(nextPass("grammar")).toBeNull();
    expect(passStatus("facts", [rec("structure", "open")])).toBe("waiting");
    expect(passStatus("structure", [rec("structure", "skipped")])).toBe("skipped");
  });

  it("«the text has changed» only beyond 10% of the words, and only for a closed pass", () => {
    expect(changedSince(rec("structure", "done", 100), 110)).toBe(false);
    expect(changedSince(rec("structure", "done", 100), 111)).toBe(true);
    expect(changedSince(rec("structure", "done", 100), 85)).toBe(true);
    expect(changedSince(rec("structure", "open", 100), 300)).toBe(false);
  });
});
