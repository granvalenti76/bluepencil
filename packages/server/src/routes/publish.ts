import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PublishError, type Publisher } from "../publish/publisher.ts";

const Body = z.object({ draftHash: z.string(), push: z.boolean().optional() });

const STATUS: Record<PublishError["code"], number> = {
  not_configured: 409,
  changed: 409,
  git: 500,
  push: 502,
};

/** Preview (diff) and publishing (`POST /publish/:path`). */
export function registerPublishRoutes(app: FastifyInstance, publisher: Publisher): void {
  const fail = (e: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    if (e instanceof PublishError)
      return reply.code(STATUS[e.code]).send({ error: e.code, message: e.message });
    throw e;
  };

  app.get("/api/publish", async () => publisher.status());

  app.get<{ Params: { "*": string } }>("/api/publish/*", async (req, reply) => {
    try {
      return await publisher.preview(req.params["*"]);
    } catch (e) {
      return fail(e, reply);
    }
  });

  app.post<{ Params: { "*": string }; Body: unknown }>("/api/publish/*", async (req, reply) => {
    const parsed = Body.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request", message: "Invalid request" });
    }
    try {
      return await publisher.publish(req.params["*"], parsed.data);
    } catch (e) {
      return fail(e, reply);
    }
  });
}
