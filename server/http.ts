import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import express, { type ErrorRequestHandler, type Express } from "express";
import type { Pool } from "pg";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function createHttpApp(pool: Pool, mount: (app: Express) => void): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.set({
      "X-Request-Id": randomUUID(),
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'; form-action 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
    });
    next();
  });
  app.use("/api", express.json({ limit: "512kb" }), (_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });
  app.get("/api/health", async (_request, response) => {
    try {
      await pool.query("SELECT 1");
      response.json({ status: "ok" });
    } catch {
      response.status(503).json({ error: "Database unavailable." });
    }
  });
  mount(app);
  app.use("/api", (_request, response) => response.status(404).json({ error: "Route not found." }));
  app.use(express.static(resolve("web-dist"), { index: "index.html", maxAge: 0 }));
  const handleError: ErrorRequestHandler = (error, _request, response, next) => {
    if (response.headersSent) return next(error);
    if (error instanceof HttpError) {
      response.status(error.status).json({ error: error.message });
    } else if (error instanceof ZodError) {
      const issue = error.issues[0];
      response.status(400).json({ error: `${issue.path.join(".") || "Request"}: ${issue.message}` });
    } else if (error?.type === "entity.too.large" || error?.type === "entity.parse.failed") {
      response.status(error.status).json({ error: "Invalid or oversized JSON request." });
    } else {
      console.error("Request failed:", response.get("X-Request-Id"), error?.code ?? error?.name);
      response.status(500).json({ error: "The request could not be completed." });
    }
  };
  app.use(handleError);
  return app;
}
