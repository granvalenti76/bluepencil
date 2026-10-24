import { execFile } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { expandHome, saveSettings, type Config } from "../config.ts";

/** The system folder picker: the chosen path, or `null` if the author cancels. */
export type FolderPicker = (prompt: string) => Promise<string | null>;

/**
 * macOS: AppleScript's `choose folder`, opened by the frontmost app (the browser or the app's
 * window) so that it does not end up behind. A process without a shell; the text is passed as
 * an argument.
 */
export const systemPicker: FolderPicker | undefined =
  process.platform === "darwin"
    ? (prompt) =>
        new Promise((resolve, reject) => {
          const script = [
            "on run argv",
            "  tell application (path to frontmost application as text)",
            "    activate",
            "    return POSIX path of (choose folder with prompt (item 1 of argv))",
            "  end tell",
            "end run",
          ].join("\n");
          execFile("osascript", ["-e", script, prompt], (err, stdout, stderr) => {
            if (!err) return resolve(stdout.trim().replace(/(.)\/$/, "$1"));
            if (/-128/.test(stderr)) return resolve(null); // "Cancel"
            reject(err);
          });
        })
    : undefined;

const Path = z
  .string()
  .trim()
  .refine((p) => p === "" || p === "~" || p.startsWith("~/") || isAbsolute(p), {
    message: "A full path is required (for example ~/Blog/posts).",
  });

const Patch = z
  .object({
    draftsDir: Path.refine((p) => p !== "", { message: "The drafts folder is required." }),
    modelBaseUrl: z
      .string()
      .trim()
      .url()
      .refine((u) => /^https?:\/\//.test(u), { message: "An http address is required." }),
    publishDir: Path,
    push: z.boolean(),
  })
  .partial()
  .strict();

const PickBody = z.object({ prompt: z.string().max(200).optional() }).strict();

const home = (p: string) => p.replace(/^\/(Users|home)\/[^/]+(?=\/|$)/, "~");

/**
 * Settings from the interface: no hand-editing of `config.json`. Publishing changes at once;
 * drafts folder and model address from the next start, because index, watcher and model client
 * are created at startup.
 */
export function registerSettingsRoutes(
  app: FastifyInstance,
  {
    config,
    configPath,
    picker,
  }: { config: Config; configPath?: string; picker: FolderPicker | null | undefined },
): void {
  // What applies now; what has been saved but applies from the next start is in `next`.
  const next = { draftsDir: home(config.draftsDir), modelBaseUrl: config.model.baseUrl };
  const view = () => ({
    draftsDir: next.draftsDir,
    modelBaseUrl: next.modelBaseUrl,
    publishDir: config.publish.dir,
    push: config.publish.push,
    restartNeeded:
      resolveDir(next.draftsDir) !== config.draftsDir || next.modelBaseUrl !== config.model.baseUrl,
    canPick: Boolean(picker),
  });

  app.get("/api/settings", async () => view());

  app.put<{ Body: unknown }>("/api/settings", async (req, reply) => {
    const parsed = Patch.safeParse(req.body ?? {});
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid settings";
      return reply.code(400).send({ error: "bad_request", message });
    }
    const patch = parsed.data;
    if (configPath) {
      try {
        saveSettings(configPath, patch);
      } catch (e) {
        return reply.code(500).send({ error: "save_failed", message: (e as Error).message });
      }
    }
    if (patch.draftsDir !== undefined) next.draftsDir = patch.draftsDir;
    if (patch.modelBaseUrl !== undefined) next.modelBaseUrl = patch.modelBaseUrl;
    // The same object the Publisher reads: applies from the next preview.
    if (patch.publishDir !== undefined) config.publish.dir = patch.publishDir;
    if (patch.push !== undefined) config.publish.push = patch.push;
    return view();
  });

  app.post<{ Body: unknown }>("/api/pick-folder", async (req, reply) => {
    const parsed = PickBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    if (!picker) {
      return reply.code(501).send({ error: "no_picker", message: "Type the folder path." });
    }
    try {
      const path = await picker(parsed.data.prompt ?? "Choose a folder");
      return { path: path === null ? null : home(path) };
    } catch {
      return reply.code(500).send({ error: "pick_failed", message: "Couldn’t open Finder." });
    }
  });
}

function resolveDir(p: string): string {
  return resolve(expandHome(p));
}
