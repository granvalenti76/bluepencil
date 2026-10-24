import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { INDEX_DIR, type DraftsRepo } from "../drafts/repo.ts";

/**
 * Authorship: the stretches that entered the text from an accepted suggestion, in a file next to
 * the drafts (`.bluepencil/authorship/<draft>.json`), not in the index: rebuilding the index must
 * not silently bring the figure back to 100%. Each stretch is found again like the notes, with
 * quote, prefix and suffix.
 */
const Span = z.object({
  quote: z.string().min(1),
  prefix: z.string(),
  suffix: z.string(),
  /** Offset in the body when it was saved: helps to find it again. */
  from: z.number().int().min(0),
  words: z.number().int().min(0),
  /** Where it comes from: a review pass, "rewrite" or "section". */
  source: z.string().max(20),
});
export type AuthoredSpan = z.infer<typeof Span>;
const Body = z.object({ spans: z.array(Span).max(5000) }).strict();
/** The file: `{ v: 1, spans }`. */
const File = z.object({ v: z.literal(1), spans: z.array(Span) });

export function registerAuthorshipRoutes(
  app: FastifyInstance,
  { repo, draftsDir }: { repo: DraftsRepo; draftsDir: string },
): void {
  // The draft's path is already checked by `repo.resolve` (only .md inside the folder).
  const fileOf = (path: string) => join(draftsDir, INDEX_DIR, "authorship", `${path}.json`);

  app.get<{ Params: { "*": string } }>("/api/authorship/*", async (req) => {
    const path = req.params["*"];
    await repo.resolve(path, { mustExist: true });
    try {
      const parsed = File.safeParse(JSON.parse(await readFile(fileOf(path), "utf8")));
      return { spans: parsed.success ? parsed.data.spans : [] };
    } catch {
      return { spans: [] };
    }
  });

  app.put<{ Params: { "*": string }; Body: unknown }>("/api/authorship/*", async (req, reply) => {
    const parsed = Body.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request", message: "Invalid request" });
    }
    const path = req.params["*"];
    await repo.resolve(path, { mustExist: true });
    const file = fileOf(path);
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    await writeFile(tmp, `${JSON.stringify({ v: 1, spans: parsed.data.spans }, null, 2)}\n`);
    await rename(tmp, file);
    return { spans: parsed.data.spans };
  });
}
