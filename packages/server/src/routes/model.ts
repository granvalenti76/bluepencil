import type { FastifyInstance } from "fastify";
import type { ModelService } from "../model/service.ts";

export function registerModelRoutes(app: FastifyInstance, model: ModelService): void {
  /** llama-server reachability, model name, cloud availability. `?refresh=1` checks again. */
  app.get<{ Querystring: { refresh?: string } }>("/api/model/status", async (req) =>
    req.query.refresh === "1" ? model.refresh() : model.status(),
  );
}
