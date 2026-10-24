import type { FastifyInstance } from "fastify";
import {
  ARCHETYPE_IDS,
  DEFAULT_LANGUAGE,
  mapSections,
  parseDraft,
  patchFrontMatter,
  replaceBody,
} from "@desk/core";
import type { DraftWatcher } from "../drafts/watcher.ts";
import { ConflictError, NotFoundError, PathError, type DraftsRepo } from "../drafts/repo.ts";
import type { IndexDb } from "../index-db/index.ts";
import type { Languages } from "../languages.ts";
import { slugify } from "../slug.ts";

interface Deps {
  languages: Languages;
  repo: DraftsRepo;
  index: IndexDb;
  watcher: DraftWatcher;
}

export function registerDraftRoutes(
  app: FastifyInstance,
  { repo, index, watcher, languages }: Deps,
): void {
  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof PathError)
      return reply.code(400).send({ error: "bad_path", message: err.message });
    if (err instanceof NotFoundError) return reply.code(404).send({ error: "not_found" });
    if (err instanceof ConflictError) {
      return reply.code(409).send({ error: "conflict", currentHash: err.currentHash });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.code(status).send({ error: "bad_request", message: (err as Error).message });
    }
    app.log.error(err);
    return reply.code(500).send({ error: "internal" });
  });

  const detail = (path: string, text: string, hash: string) => {
    const parsed = parseDraft(text);
    return {
      path,
      frontmatter: parsed.data,
      issues: parsed.issues,
      body: parsed.body,
      // The whole file, front matter included: the editor keeps all of it and hides the front matter.
      text,
      contentHash: hash,
      sections: mapSections(parsed.body, parsed.data.outline ?? []),
    };
  };

  app.get<{ Querystring: { stage?: string } }>("/api/drafts", async (req) => ({
    drafts: index.list(req.query.stage || undefined),
  }));

  app.post<{ Body: { title?: unknown; archetype?: unknown; lang?: unknown; plan?: unknown } }>(
    "/api/drafts",
    async (req, reply) => {
      const { title, archetype, lang = DEFAULT_LANGUAGE, plan = false } = req.body ?? {};
      if (typeof title !== "string" || title.trim() === "") {
        return reply.code(400).send({ error: "bad_request", message: "A title is required" });
      }
      const arch = archetype ?? "undecided";
      if (typeof arch !== "string" || !(ARCHETYPE_IDS as readonly string[]).includes(arch)) {
        return reply.code(400).send({ error: "bad_request", message: "Unknown text type" });
      }
      if (typeof lang !== "string" || !languages.get(lang)) {
        return reply.code(400).send({ error: "bad_request", message: "Unknown language" });
      }

      const clean = title.trim();
      const base = slugify(clean, languages.forDraft(lang).untitledSlug);
      const existing = new Set(await repo.list());
      let path = `${base}.md`;
      for (let n = 2; existing.has(path); n++) path = `${base}-${n}.md`;

      const text = patchFrontMatter(`# ${clean}\n`, {
        title: clean,
        archetype: arch,
        // Structure is optional: without it, you start writing.
        stage: plan === true ? "structure" : "writing",
        lang,
      });
      const file = await repo.write(path, text, null);
      watcher.noteSelfWrite(path, file.hash);
      index.upsert(path, file.text, file.mtimeMs);
      return reply.code(201).send(detail(path, file.text, file.hash));
    },
  );

  app.get<{ Params: { "*": string } }>("/api/drafts/*", async (req) => {
    const file = await repo.read(req.params["*"]);
    return detail(file.path, file.text, file.hash);
  });

  app.put<{
    Params: { "*": string };
    Body: { body?: unknown; frontmatterPatch?: unknown; baseHash?: unknown };
  }>("/api/drafts/*", async (req, reply) => {
    const { body, frontmatterPatch, baseHash } = req.body ?? {};
    if (typeof baseHash !== "string") {
      return reply.code(400).send({ error: "bad_request", message: "baseHash is missing" });
    }
    if (body !== undefined && typeof body !== "string") {
      return reply.code(400).send({ error: "bad_request", message: "Invalid body" });
    }
    if (
      frontmatterPatch !== undefined &&
      (typeof frontmatterPatch !== "object" ||
        frontmatterPatch === null ||
        Array.isArray(frontmatterPatch))
    ) {
      return reply.code(400).send({ error: "bad_request", message: "Invalid frontmatterPatch" });
    }

    const path = req.params["*"];
    const current = await repo.read(path);
    let next = current.text;
    if (typeof body === "string") next = replaceBody(next, body);
    if (frontmatterPatch)
      next = patchFrontMatter(next, frontmatterPatch as Record<string, unknown>);

    const file = await repo.write(path, next, baseHash);
    watcher.noteSelfWrite(path, file.hash);
    index.upsert(path, file.text, file.mtimeMs);
    return detail(path, file.text, file.hash);
  });
}
