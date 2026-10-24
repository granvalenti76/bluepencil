import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import type { EvalReport } from "../eval/run.ts";

/**
 * Outcome of the latest evaluation (`npm run eval`), for the "Show" chips: a pass with precision
 * below the threshold starts switched off. Without a report, all on.
 */
export function registerEvalRoutes(app: FastifyInstance, reportFile?: string): void {
  app.get("/api/eval", async () => {
    if (!reportFile) return { report: null };
    try {
      const r = JSON.parse(await readFile(reportFile, "utf8")) as EvalReport;
      return {
        report: {
          date: r.date,
          model: r.model,
          partial: r.partial,
          passes: r.passes.map((p) => ({
            pass: p.pass,
            precision: p.precision,
            recall: p.recall,
            enabled: p.enabled,
          })),
        },
      };
    } catch {
      return { report: null };
    }
  });
}
