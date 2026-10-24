import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";

export const TOKEN_HEADER = "x-desk-token";

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

function sameToken(given: unknown, expected: string): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface SecurityOptions {
  token: string;
  port: number;
  /** Extra allowed origins (development only: the page served by Vite). */
  extraOrigins?: string[];
}

/**
 * `Host` and `Origin` are checked on every request (defence against DNS rebinding), the token on
 * every API request. For SSE the token comes in the `t` parameter, because `EventSource` sends
 * no headers. No CORS.
 */
export function registerSecurity(app: FastifyInstance, opts: SecurityOptions): void {
  const hosts = new Set([`127.0.0.1:${opts.port}`, `localhost:${opts.port}`]);
  const origins = new Set([...[...hosts].map((h) => `http://${h}`), ...(opts.extraOrigins ?? [])]);

  app.addHook("onRequest", async (req, reply) => {
    if (!hosts.has(req.headers.host ?? "")) {
      return reply.code(403).send({ error: "forbidden_host" });
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !origins.has(origin)) {
      return reply.code(403).send({ error: "forbidden_origin" });
    }

    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/api/")) return;

    const given =
      url.pathname === "/api/events" ? url.searchParams.get("t") : req.headers[TOKEN_HEADER];
    if (!sameToken(given, opts.token)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });
}
