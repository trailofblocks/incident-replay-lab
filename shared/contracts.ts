import { z } from "zod";

export const scenarioId = z.enum(["queue", "upstream", "worker", "database", "telemetry-gap", "competing"]);
export const analysisMode = z.enum(["rules", "ollama"]);
export const startRequest = z.strictObject({ scenario: scenarioId, seed: z.number().int().min(0).max(999).default(4) });
export const analysisRequest = z.strictObject({ mode: analysisMode.default("rules") });
export const runId = z.uuid();
export type ScenarioId = z.infer<typeof scenarioId>;
export type AnalysisMode = z.infer<typeof analysisMode>;
export type Cause = "queue_saturation" | "upstream_latency" | "worker_exit" | "database_pool";
export type SignalKind = "log" | "metric" | "span";
export type Service = "API" | "Worker" | "Queue" | "Gateway" | "Database" | "Collector";
export type Severity = "info" | "warning" | "error";

export interface Telemetry {
  id: string;
  offset: number;
  service: Service;
  kind: SignalKind;
  severity: Severity;
  signal: string;
  message: string;
  value?: number;
  unit?: string;
  traceId?: string;
}

export interface Scenario {
  id: ScenarioId;
  name: string;
  description: string;
}

export interface Replay {
  id: string;
  scenario: ScenarioId;
  seed: number;
  createdAt: string;
  duration: number;
  events: Telemetry[];
}

export interface Diagnosis {
  status: "suspected" | "inconclusive";
  mode: AnalysisMode;
  cause: Cause | null;
  title: string;
  summary: string;
  evidence: Telemetry[];
  notice?: string;
}
