import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  activeTraits,
  appendPiece,
  DEFAULT_LANGUAGE,
  isModelError,
  isStylePath,
  mergeTraits,
  newStyleText,
  parseDraft,
  patchFrontMatter,
  readStyle,
  repairMessage,
  STYLES_DIR,
  ModelError,
  readTipsAnswer,
  readTraitsAnswer,
  styleTipsMessages,
  styleTraitsMessages,
  styleQuote,
  traitsForFile,
  type ChatRequest,
  type ModelClient,
} from "@desk/core";
import { z } from "zod";
import type { DraftWatcher } from "../drafts/watcher.ts";
import type { DraftsRepo } from "../drafts/repo.ts";
import type { IndexDb } from "../index-db/index.ts";
import type { Languages } from "../languages.ts";
import type { ModelService } from "../model/service.ts";
import { slugify } from "../slug.ts";

/** A style in the library (`GET /api/styles`). */
export interface StyleSummary {
  path: string;
  name: string;
  author: string;
  source: string;
  lang?: string;
  tags: string[];
  pieces: number;
  words: number;
  traits: number;
  /** A first sentence, for the card: a trait's example or the start of a piece. */
  quote: string;
  /** How many drafts look at it. */
  usedIn: number;
}

const Piece = z.object({
  title: z.string().max(200).optional(),
  text: z.string().max(100_000),
});
const CreateBody = z.object({
  name: z.string().trim().min(1).max(120),
  lang: z.string().optional(),
  author: z.string().max(200).optional(),
  source: z.string().max(200).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  pieces: z.array(Piece).max(20).optional(),
});
const PieceBody = Piece.extend({
  path: z.string().min(1),
  text: z.string().trim().min(1).max(100_000),
});
/** `save`: write the traits into the file (when it is not open in the editor). */
const TraitsBody = z.object({ path: z.string().min(1), save: z.boolean().optional() });
const TipsBody = z.object({ style: z.string().min(1), draft: z.string().max(400_000) });

/** Reading a style or a draft against it may take a while with reasoning on. */
const MAX_TOKENS = 8192;

/**
 * Styles: files in `Styles/` inside the drafts folder, opened and edited like drafts. Here the
 * library, a new style (labels and pasted pieces, written into the file by Bluepencil), a piece
 * added from a selection, and the two model calls: reading a style's traits and cues for a draft.
 * The traits are saved here when the style is not open; when it is, the page saves them in the
 * open file, so the editor and the file never disagree.
 */
export function registerStyleRoutes(
  app: FastifyInstance,
  deps: {
    repo: DraftsRepo;
    index: IndexDb;
    watcher: DraftWatcher;
    languages: Languages;
    model: ModelService;
  },
): void {
  const { repo, index, watcher, languages, model } = deps;

  app.get("/api/styles", async () => {
    const paths = await repo.list();
    const used = new Map<string, number>();
    const styles: StyleSummary[] = [];
    for (const path of paths) {
      let text: string;
      try {
        text = (await repo.read(path)).text;
      } catch {
        continue;
      }
      if (isStylePath(path)) {
        const s = readStyle(text);
        styles.push({
          path,
          name: s.name,
          author: s.author,
          source: s.source,
          ...(s.lang ? { lang: s.lang } : {}),
          tags: s.tags,
          pieces: s.pieces.length,
          words: s.words,
          traits: s.traits.filter((t) => t.state !== "off").length,
          quote: styleQuote(s),
          usedIn: 0,
        });
      } else {
        const ref = parseDraft(text).data.reference;
        if (ref) used.set(ref, (used.get(ref) ?? 0) + 1);
      }
    }
    for (const s of styles) s.usedIn = used.get(s.path) ?? 0;
    return { styles: styles.sort((a, b) => a.name.localeCompare(b.name)) };
  });

  app.post<{ Body: unknown }>("/api/styles", async (req, reply) => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request", message: "A name is required" });
    }
    const lang = parsed.data.lang ?? DEFAULT_LANGUAGE;
    if (!languages.get(lang)) {
      return reply.code(400).send({ error: "bad_request", message: "Unknown language" });
    }
    const base = `${STYLES_DIR}/${slugify(parsed.data.name, "style")}`;
    const existing = new Set(await repo.list());
    let path = `${base}.md`;
    for (let n = 2; existing.has(path); n++) path = `${base}-${n}.md`;
    // The folder is created with the first style; `repo.write` still checks where it leads.
    await mkdir(join(await repo.root(), STYLES_DIR), { recursive: true });
    const { name, author, source, tags, pieces } = parsed.data;
    const text = newStyleText({ name, author, source, lang, tags }, pieces);
    const file = await repo.write(path, text, null);
    watcher.noteSelfWrite(path, file.hash);
    index.upsert(path, file.text, file.mtimeMs);
    return reply.code(201).send({ path, pieces: readStyle(file.text).pieces.length });
  });

  app.post<{ Body: unknown }>("/api/styles/piece", async (req, reply) => {
    const parsed = PieceBody.safeParse(req.body);
    if (!parsed.success || !isStylePath(parsed.data.path)) {
      return reply.code(400).send({ error: "bad_request", message: "Not a style" });
    }
    const { path, title, text } = parsed.data;
    const current = await repo.read(path);
    const file = await repo.write(path, appendPiece(current.text, { title, text }), current.hash);
    watcher.noteSelfWrite(path, file.hash);
    index.upsert(path, file.text, file.mtimeMs);
    return { path, pieces: readStyle(file.text).pieces.length };
  });

  app.post<{ Body: unknown }>("/api/styles/traits", async (req, reply) => {
    const parsed = TraitsBody.safeParse(req.body);
    if (!parsed.success || !isStylePath(parsed.data.path)) {
      return reply.code(400).send({ error: "bad_request", message: "Not a style" });
    }
    const style = readStyle((await repo.read(parsed.data.path)).text);
    if (style.pieces.length === 0) {
      return reply.code(409).send({ error: "empty", message: "Add a piece to the style first" });
    }
    const pack = languages.forDraft(style.lang);
    const messages = styleTraitsMessages(pack, style);
    if (!messages) return noPrompts(reply, pack.name);
    return ask(reply, async (signal) => {
      const traits = await model.run(
        (client) =>
          readAnswer(
            client,
            { messages, temperature: 0.4, maxTokens: MAX_TOKENS, signal },
            readTraitsAnswer,
            (error) => repairMessage(pack, error),
          ),
        { signal },
      );
      if (!parsed.data.save) return { traits };
      // Read again: the author may have added a trait while the model was reading.
      const now = await repo.read(parsed.data.path);
      const merged = mergeTraits(readStyle(now.text).traits, traits);
      const next = patchFrontMatter(now.text, { traits: traitsForFile(merged) });
      const file = await repo.write(parsed.data.path, next, now.hash);
      watcher.noteSelfWrite(parsed.data.path, file.hash);
      index.upsert(parsed.data.path, file.text, file.mtimeMs);
      return { traits: merged };
    });
  });

  app.post<{ Body: unknown }>("/api/styles/tips", async (req, reply) => {
    const parsed = TipsBody.safeParse(req.body);
    if (!parsed.success || !isStylePath(parsed.data.style)) {
      return reply.code(400).send({ error: "bad_request", message: "Not a style" });
    }
    const style = readStyle((await repo.read(parsed.data.style)).text);
    if (style.pieces.length === 0) {
      return reply.code(409).send({ error: "empty", message: "The style has no pieces yet" });
    }
    const pack = languages.forDraft(style.lang);
    const messages = styleTipsMessages(pack, style, parsed.data.draft);
    if (!messages) return noPrompts(reply, pack.name);
    return ask(reply, async (signal) => {
      return model.run(
        (client) =>
          readAnswer(
            client,
            { messages, temperature: 0.4, maxTokens: MAX_TOKENS, signal },
            (content) => readTipsAnswer(content, activeTraits(style)),
            (error) => repairMessage(pack, error),
          ),
        { signal },
      );
    });
  });
}

/**
 * One request, read leniently (`readTraitsAnswer`, `readTipsAnswer`); if nothing at all can be
 * read, the model is asked once to fix its answer, as for the outline.
 */
async function readAnswer<T>(
  client: ModelClient,
  req: ChatRequest,
  read: (content: string) => T | null,
  repair: (error: string) => string,
): Promise<T> {
  const first = await client.chat(req);
  if (first.finishReason === "length") throw new ModelError("truncated");
  const value = read(first.content);
  if (value !== null) return value;
  const second = await client.chat({
    ...req,
    messages: [
      ...req.messages,
      { role: "assistant", content: first.content },
      { role: "user", content: repair("no readable JSON object") },
    ],
  });
  if (second.finishReason === "length") throw new ModelError("truncated");
  const again = read(second.content);
  if (again !== null) return again;
  throw new ModelError("invalid_json", "no readable JSON object");
}

const noPrompts = (reply: FastifyReply, language: string) =>
  reply.code(409).send({
    error: "no_prompts",
    message: `The ${language} language pack has no style prompts`,
  });

/** A model call tied to the request: closing the page cancels it. */
async function ask<T>(reply: FastifyReply, fn: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  reply.raw.on("close", () => {
    if (!reply.raw.writableEnded) controller.abort();
  });
  try {
    return await fn(controller.signal);
  } catch (e) {
    if (isModelError(e)) {
      return reply.code(503).send({ error: e.code, message: (e as Error).message });
    }
    throw e;
  }
}
