import type { FastifyInstance } from "fastify";
import type { Languages } from "../languages.ts";
import { parseDraft } from "@desk/core";
import type { DraftsRepo } from "../drafts/repo.ts";
import type { Search } from "../index-db/search.ts";
import type { JudgmentsStore } from "../index-db/judgments.ts";
import { localSourcePath, type FileSources } from "../review/sources.ts";

interface Deps {
  languages: Languages;
  repo: DraftsRepo;
  search: Search;
  sources: FileSources;
  store: JudgmentsStore;
}

const PREVIEW = 160;

/** A draft's sources, "Compare sources" and search. */
export function registerSourceRoutes(
  app: FastifyInstance,
  { repo, search, sources, store, languages }: Deps,
) {
  /** The draft's sources (`sources` in the front matter) with a preview, plus the other source files. */
  app.get<{ Params: { "*": string } }>("/api/sources/*", async (req) => {
    const path = req.params["*"];
    const { data } = parseDraft((await repo.read(path)).text);
    const refs = data.sources ?? [];
    const listed = await Promise.all(
      refs.map(async (ref) => {
        const rel = localSourcePath(path, ref);
        if (!rel) return { ref, kind: "url" as const };
        try {
          const body = parseDraft((await repo.read(rel)).text).body.trim();
          return {
            ref,
            kind: "file" as const,
            path: rel,
            exists: true,
            preview: body.slice(0, PREVIEW),
          };
        } catch {
          return { ref, kind: "file" as const, path: rel, exists: false };
        }
      }),
    );
    const known = new Set(listed.flatMap((s) => (s.kind === "file" ? [s.path] : [])));
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
    const files = search
      .citable()
      .filter((f) => f.path !== path && !known.has(f.path))
      // Reference relative to the draft, as it is written in the front matter.
      .map((f) => ({ ...f, ref: f.path.startsWith(dir) ? f.path.slice(dir.length) : f.path }))
      .filter((f) => localSourcePath(path, f.ref) === f.path);
    return { sources: listed, files };
  });

  /** Source passages with terms similar to a note's quote (or to a text). */
  app.get<{ Querystring: { path?: string; judgmentId?: string; q?: string } }>(
    "/api/compare",
    async (req, reply) => {
      const { path, judgmentId, q } = req.query;
      if (!path)
        return reply.code(400).send({ error: "bad_request", message: "The draft is missing" });
      const { data, body } = parseDraft((await repo.read(path)).text);
      let text = q ?? "";
      if (judgmentId) {
        const j = store.get(judgmentId);
        if (!j || j.draftPath !== path) return reply.code(404).send({ error: "not_found" });
        text = j.anchor.quote || j.quote;
      }
      const lang = languages.forDraft(data.lang);
      return { query: text, passages: sources.compare(path, data.sources ?? [], body, text, lang) };
    },
  );

  app.get<{ Querystring: { q?: string } }>("/api/search", async (req) => ({
    results: search.docs(req.query.q ?? ""),
  }));
}
