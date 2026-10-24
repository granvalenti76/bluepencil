import type { FastifyInstance } from "fastify";
import {
  archetypeIn,
  isModelError,
  outlineMessages,
  repairMessage,
  partialSections,
  ProposedOutlineSchema,
} from "@desk/core";
import { z } from "zod";
import type { Languages } from "../languages.ts";
import type { ModelService } from "../model/service.ts";

const Body = z.object({
  archetype: z.string(),
  topic: z.string().max(4000).default(""),
  target: z.number().int().min(50).max(50_000),
  cloud: z.boolean().optional(),
  /** The draft's language (`lang`); Italian if missing. */
  lang: z.string().optional(),
});

/** Reasoning about a structure may need more budget than reviewing a block. */
const OUTLINE_MAX_TOKENS = 8192;

/**
 * `POST /api/structure/propose`: the outline proposed by the model, streamed over SSE.
 * Events: `progress` (thinking/writing), `section` (a complete section as soon as it arrives),
 * `done` (validated outline), `error`. Closing the connection cancels the model request.
 */
export function registerStructureRoutes(
  app: FastifyInstance,
  model: ModelService,
  languages: Languages,
): void {
  app.post<{ Body: unknown }>("/api/structure/propose", async (req, reply) => {
    const parsed = Body.safeParse(req.body);
    const pack = languages.forDraft(parsed.success ? parsed.data.lang : undefined);
    const archetype = parsed.success ? archetypeIn(pack, parsed.data.archetype) : undefined;
    if (!parsed.success || !archetype) {
      return reply.code(400).send({ error: "bad_request", message: "Invalid request" });
    }
    const { topic, target, cloud } = parsed.data;

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    const send = (event: string, data: unknown) => {
      if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });

    let sent = 0;
    try {
      const { value } = await model.run(
        (client) =>
          client.completeJson(
            ProposedOutlineSchema,
            {
              messages: outlineMessages(pack, archetype, topic, target),
              temperature: 0.6,
              maxTokens: OUTLINE_MAX_TOKENS,
              signal: controller.signal,
              onProgress: (p) => send("progress", p),
              onAnswer: (answer) => {
                const sections = partialSections(answer);
                for (; sent < sections.length; sent++) send("section", sections[sent]);
              },
            },
            (error) => repairMessage(pack, error),
          ),
        { cloud, signal: controller.signal, onWait: (w) => send("progress", { phase: w }) },
      );
      send("done", value);
    } catch (e) {
      if (!controller.signal.aborted) {
        send("error", {
          code: isModelError(e) ? e.code : "internal",
          message: (e as Error).message,
        });
      }
    } finally {
      res.end();
    }
  });
}
