import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { patchFrontMatter } from "@desk/core";
import { afterEach, describe, expect, it } from "vitest";
import { startFakeLlm, type FakeLlm } from "./fake-llm.ts";
import { cleanupAll, makeServer, tempDrafts } from "./helpers.ts";

/**
 * For an Italian draft the requests to the model stay what they were, byte for byte. The
 * reference is the four requests of a full review of Turbocode captured before the language packs
 * (`fixtures/requests/turbocode-review-it.json`). If this test fails, what the model receives for
 * Italian has changed: do not update the reference lightly.
 */
const REFERENCE = fileURLToPath(
  new URL("../../../fixtures/requests/turbocode-review-it.json", import.meta.url),
);
const TURBO = "turbocode-draft-12-settembre.md";

let fake: FakeLlm | undefined;
afterEach(async () => {
  await fake?.close();
  fake = undefined;
  await cleanupAll();
});

async function reviewRequests(edit: (text: string) => string = (t) => t) {
  const dir = await tempDrafts();
  const file = join(dir, TURBO);
  await writeFile(file, edit(await readFile(file, "utf8")));
  // As when the reference was captured: no `/props` (default context and slots).
  fake = await startFakeLlm({ models: ["Qwen3.6-35B-A3B"], props: null });
  const s = await makeServer({ dir, modelUrl: fake.url });
  await s.inject({ method: "GET", url: "/api/model/status?refresh=1" });
  const res = await s.inject({ method: "POST", url: `/api/review/${TURBO}`, payload: {} });
  expect(res.statusCode).toBe(202);
  await s.runner.wait(res.json().runId);
  return fake.chatRequests().map((r) => r.body);
}

describe("Italian: model requests identical to the reference", () => {
  it("draft without `lang`", async () => {
    const reference: unknown = JSON.parse(await readFile(REFERENCE, "utf8"));
    expect(await reviewRequests()).toEqual(reference);
  });

  it("draft with `lang: it`", async () => {
    const reference: unknown = JSON.parse(await readFile(REFERENCE, "utf8"));
    const requests = await reviewRequests((t) => patchFrontMatter(t, { lang: "it" }));
    expect(requests).toEqual(reference);
  });

  it("byte for byte: the same JSON, not just the same values", async () => {
    const reference = JSON.parse(await readFile(REFERENCE, "utf8")) as unknown[];
    const requests = await reviewRequests((t) => patchFrontMatter(t, { lang: "it" }));
    expect(requests.map((r) => JSON.stringify(r))).toEqual(reference.map((r) => JSON.stringify(r)));
  });
});
