import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { EventBus } from "../events.ts";
import type { Languages } from "../languages.ts";
import { systemOpener, type Opener } from "./reveal.ts";

const NewPack = z.strictObject({
  code: z
    .string()
    .trim()
    .regex(
      /^[a-z]{2,3}(-[A-Za-z0-9]{1,8})*$/,
      "Use a language code such as es, pt-BR or it-x-mine.",
    ),
  name: z.string().trim().min(1, "The name is required.").max(60),
});

/**
 * The language packs: the list for the interface (archetypes, readability, opinion note), those
 * that could not be loaded, and the user's folder: create a pack from English, reload, show it
 * in the Finder.
 */
export function registerLanguageRoutes(
  app: FastifyInstance,
  {
    languages,
    bus,
    opener = systemOpener,
  }: { languages: Languages; bus: EventBus; opener?: Opener },
): void {
  const view = () => ({
    packs: languages.list(),
    problems: languages.problems,
    userDir: languages.userDir ?? null,
  });

  app.get("/api/languages", async () => view());

  app.post("/api/languages/reload", async () => {
    languages.reload();
    bus.emit({ type: "languages.changed" });
    return view();
  });

  app.post<{ Body: unknown }>("/api/languages", async (req, reply) => {
    const parsed = NewPack.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "bad_request", message: parsed.error.issues[0]?.message ?? "Invalid" });
    }
    const { code, name } = parsed.data;
    if (!languages.userDir) {
      return reply.code(501).send({ error: "no_folder", message: "No folder for language packs." });
    }
    if (languages.get(code) || existsSync(join(languages.userDir, code))) {
      return reply
        .code(409)
        .send({ error: "exists", message: `A language "${code}" already exists.` });
    }
    let dir: string;
    try {
      dir = languages.create(code, name);
    } catch (e) {
      return reply.code(500).send({ error: "create_failed", message: (e as Error).message });
    }
    bus.emit({ type: "languages.changed" });
    // Opens in the Finder: the pack is translated with any editor.
    await opener(dir, false).catch(() => {});
    return reply.code(201).send({ ...view(), created: dir });
  });

  app.post("/api/languages/reveal", async (_req, reply) => {
    if (!languages.userDir) return reply.code(501).send({ error: "no_folder" });
    mkdirSync(languages.userDir, { recursive: true });
    try {
      await opener(languages.userDir, false);
    } catch {
      return reply.code(500).send({ error: "reveal_failed", message: "Couldn’t open Finder." });
    }
    return reply.code(204).send();
  });
}
