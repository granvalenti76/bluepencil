import { execFile } from "node:child_process";
import { dirname } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DraftsRepo } from "../drafts/repo.ts";

const Body = z.object({ path: z.string().optional() }).strict();

/** Opens the Finder (or the file manager) on the file: a process without a shell, fixed arguments. */
export type Opener = (abs: string, isFile: boolean) => Promise<void>;

export const systemOpener: Opener = (abs, isFile) =>
  new Promise((resolve, reject) => {
    const [cmd, args] =
      process.platform === "darwin"
        ? ["open", isFile ? ["-R", abs] : [abs]]
        : process.platform === "win32"
          ? ["explorer.exe", isFile ? [`/select,${abs}`] : [abs]]
          : ["xdg-open", [isFile ? dirname(abs) : abs]];
    execFile(cmd, args, (e) => (e ? reject(e) : resolve()));
  });

/**
 * `POST /api/reveal` (at the author's request): shows a draft (selected) in the Finder or,
 * without `path`, the drafts folder. The path goes through the same validation as the other
 * routes: nothing outside the drafts folder.
 */
export function registerRevealRoutes(
  app: FastifyInstance,
  { repo, opener = systemOpener }: { repo: DraftsRepo; opener?: Opener },
): void {
  app.get("/api/folder", async () => ({ path: await repo.root() }));

  app.post<{ Body: unknown }>("/api/reveal", async (req, reply) => {
    const parsed = Body.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    const { path } = parsed.data;
    const abs = path ? await repo.resolve(path, { mustExist: true }) : await repo.root();
    try {
      await opener(abs, path !== undefined);
    } catch {
      return reply.code(500).send({ error: "reveal_failed", message: "Couldn’t open Finder" });
    }
    return reply.code(204).send();
  });
}
