import type { FastifyInstance } from "fastify";
import type { EventBus } from "../events.ts";

/** SSE: `draft.changed` and the review events. */
export function registerEventRoutes(app: FastifyInstance, bus: EventBus): void {
  app.get("/api/events", (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    res.write("retry: 2000\n\n");

    const unsubscribe = bus.subscribe((e) => {
      res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
