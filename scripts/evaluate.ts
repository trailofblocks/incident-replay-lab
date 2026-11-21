import assert from "node:assert/strict";
import type { AnalysisMode, Cause, ScenarioId } from "../shared/contracts.js";
import { investigate, modelConfig } from "../server/investigator.js";
import { simulate } from "../server/scenarios.js";

const cases: { scenario: ScenarioId; expected: Cause | null }[] = [
  { scenario: "queue", expected: "queue_saturation" },
  { scenario: "upstream", expected: "upstream_latency" },
  { scenario: "worker", expected: "worker_exit" },
  { scenario: "database", expected: "database_pool" },
  { scenario: "telemetry-gap", expected: null },
  { scenario: "competing", expected: null },
];
const mode: AnalysisMode = process.argv.includes("--ollama") ? "ollama" : "rules";
const model = modelConfig();
if (mode === "ollama") assert.ok(model, "Set OLLAMA_MODEL to run the local model evaluation.");

const results = [];
for (const seed of [4, 73]) {
  for (const { scenario, expected } of cases) {
    const { events } = simulate(scenario, seed);
    const start = performance.now();
    const result = await investigate(events, mode, model);
    const matchesSource = result.evidence.every((item) => {
      const source = events.find((event) => event.id === item.id);
      return source && JSON.stringify(source) === JSON.stringify(item);
    });
    const status = expected ? "suspected" : "inconclusive";
    const passed = result.cause === expected && result.status === status && matchesSource
      && (expected === null || result.evidence.length >= 2) && result.mode === mode && !result.notice;
    results.push({ scenario, seed, expected, actual: result.cause, cited: result.evidence.map((item) => item.id),
      milliseconds: Math.round(performance.now() - start), passed, ...(result.notice ? { notice: result.notice } : {}) });
  }
}
const passed = results.filter((item) => item.passed).length;
console.log(JSON.stringify({ mode, model: mode === "ollama" ? model?.model : undefined, passed, total: results.length, cases: results }, null, 2));
if (passed !== results.length) process.exitCode = 1;
