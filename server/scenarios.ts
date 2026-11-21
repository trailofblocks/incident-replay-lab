import type { Replay, Scenario, ScenarioId, Telemetry } from "../shared/contracts.js";

type Input = Omit<Telemetry, "id">;

export const scenarios: Scenario[] = [
  { id: "queue", name: "Queue backlog", description: "Requests queue faster than the worker can process them." },
  { id: "upstream", name: "Slow upstream", description: "An external gateway stalls checkout requests." },
  { id: "worker", name: "Worker exit", description: "A worker exits while jobs are still in flight." },
  { id: "database", name: "Database pool exhaustion", description: "Requests time out waiting for a connection." },
  { id: "telemetry-gap", name: "Telemetry gap", description: "Several requests fail while tracing coverage drops." },
  { id: "competing", name: "Competing signals", description: "Two services show independent signs of trouble." },
];

function queue(seed: number): Input[] {
  return [
    { offset: 1660, kind: "metric", severity: "warning", service: "Queue", signal: "queue_depth", value: 175 + seed % 17, unit: "jobs", message: "Pending jobs exceeded the queue target of 100." },
    { offset: 2190, kind: "log", severity: "warning", service: "Worker", signal: "worker_at_capacity", message: "Workers remained active, with all consumer slots occupied." },
    { offset: 2960, kind: "span", severity: "error", service: "Queue", signal: "queue_wait", value: 2400, unit: "ms", traceId: "trace-checkout", message: "Checkout waited for the fulfillment message and timed out." },
  ];
}

function database(seed: number): Input[] {
  return [
    { offset: 1690, kind: "metric", severity: "warning", service: "Database", signal: "pool_utilization", value: 98 + seed % 3, unit: "%", message: "Nearly all database connections were in use." },
    { offset: 2330, kind: "log", severity: "error", service: "Database", signal: "db_acquire_timeout", message: "The connection pool rejected a waiting request after its deadline." },
    { offset: 3040, kind: "span", severity: "error", service: "API", signal: "db_acquire", value: 850, unit: "ms", traceId: "trace-checkout", message: "Checkout stopped before executing its database query." },
  ];
}

const otherPatterns: Partial<Record<ScenarioId, Input[]>> = {
  upstream: [
    { offset: 1660, kind: "metric", severity: "warning", service: "Gateway", signal: "gateway_latency", value: 1600, unit: "ms", message: "Gateway request p95 rose above the 500 ms objective." },
    { offset: 2210, kind: "span", severity: "error", service: "Gateway", signal: "gateway_timeout", value: 1200, unit: "ms", traceId: "trace-checkout", message: "The gateway call exceeded the outgoing request timeout." },
    { offset: 2880, kind: "log", severity: "warning", service: "API", signal: "gateway_retry", message: "The API stopped retrying the stalled gateway request." },
  ],
  worker: [
    { offset: 1660, kind: "log", severity: "error", service: "Worker", signal: "worker_exited", message: "The worker process exited during job execution." },
    { offset: 2210, kind: "metric", severity: "error", service: "Worker", signal: "active_workers", value: 0, unit: "workers", message: "The worker count dropped to zero." },
    { offset: 3020, kind: "span", severity: "warning", service: "Queue", signal: "lease_timeout", value: 1600, unit: "ms", traceId: "trace-checkout", message: "The in-flight lease expired and the job was queued for another worker." },
  ],
  "telemetry-gap": [
    { offset: 1660, kind: "log", severity: "warning", service: "Collector", signal: "sample_dropped", message: "The collector dropped diagnostic spans during this window." },
    { offset: 2320, kind: "metric", severity: "warning", service: "API", signal: "request_latency", value: 1390, unit: "ms", message: "API latency rose, with no corresponding dependency spans." },
  ],
};

export function simulate(scenario: ScenarioId, seed: number): Pick<Replay, "events" | "duration"> {
  const incident = scenario === "queue" ? queue(seed) : scenario === "database" ? database(seed)
    : scenario === "competing" ? [...queue(seed), ...database(seed)] : otherPatterns[scenario] ?? [];
  const input: Input[] = [
    { offset: 180, kind: "log", severity: "info", service: "API", signal: "started", message: "Checkout began processing requests." },
    { offset: 710, kind: "metric", severity: "info", service: "API", signal: "request_latency", value: 112 + seed % 23, unit: "ms", message: "Checkout request latency was within the objective." },
    { offset: 1010, kind: "span", severity: "info", service: "API", signal: "checkout_started", traceId: "trace-checkout", message: "The checkout request entered the service." },
    ...incident,
    { offset: 3410, kind: "log", severity: "error", service: "API", signal: "checkout_failed", traceId: "trace-checkout", message: "Checkout returned HTTP 504." },
    { offset: 3920, kind: "metric", severity: "warning", service: "API", signal: "error_rate", value: 13 + seed % 8, unit: "%", message: "The checkout error rate exceeded its objective." },
    { offset: 4870, kind: "log", severity: "info", service: "Collector", signal: "window_closed", message: "The simulator closed the observation window." },
  ];
  const events = input
    .map((entry, index) => ({ ...entry, offset: entry.offset + ((seed * (index + 3)) % 37) }))
    .sort((a, b) => a.offset - b.offset)
    .map((entry, index) => ({ ...entry, id: `T${String(index + 1).padStart(2, "0")}` }));
  return { events, duration: 5200 };
}
