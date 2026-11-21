import type { Pool } from "pg";
import { analysisRequest, runId, startRequest } from "../shared/contracts.js";
import { createHttpApp, HttpError } from "./http.js";
import { investigate, type ModelConfig } from "./investigator.js";
import { ReplayStore } from "./replays.js";
import { scenarios } from "./scenarios.js";

export function createApp(pool: Pool, model?: ModelConfig) {
  const store = new ReplayStore(pool);
  return createHttpApp(pool, (app) => {
    app.get("/api/scenarios", (_request, response) => response.json({ scenarios, modelEnabled: !!model }));
    app.post("/api/runs", async (request, response) => {
      const { scenario, seed } = startRequest.parse(request.body);
      response.status(201).json(await store.create(scenario, seed));
    });
    app.get("/api/runs/:id", async (request, response) => {
      const run = await store.get(runId.parse(request.params.id));
      if (!run) throw new HttpError(404, "Replay not found.");
      response.json(run);
    });
    app.post("/api/runs/:id/investigate", async (request, response) => {
      const { mode } = analysisRequest.parse(request.body ?? {});
      const run = await store.get(runId.parse(request.params.id));
      if (!run) throw new HttpError(404, "Replay not found.");
      response.json(await investigate(run.events, mode, model));
    });
  });
}
