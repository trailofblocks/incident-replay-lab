import { z } from "zod";
import type { AnalysisMode, Cause, Diagnosis, Telemetry } from "../shared/contracts.js";

type EvidenceRequirement = { signal: string; minimum?: number; equals?: number };
interface Hypothesis {
  cause: Cause;
  title: string;
  summary: string;
  requires: readonly EvidenceRequirement[];
}

const hypotheses: Hypothesis[] = [
  { cause: "queue_saturation", title: "Queue saturation",
    summary: "The queue grew while consumers were active and at capacity. Requests spent their time waiting for a queued job.",
    requires: [{ signal: "queue_depth", minimum: 101 }, { signal: "worker_at_capacity" }] },
  { cause: "upstream_latency", title: "Slow upstream gateway",
    summary: "Gateway latency rose and the checkout trace timed out specifically on the outgoing gateway call.",
    requires: [{ signal: "gateway_latency", minimum: 501 }, { signal: "gateway_timeout" }] },
  { cause: "worker_exit", title: "Worker process exited",
    summary: "An exit log and zero active workers precede the checkout failure. In-flight jobs lost their consumer.",
    requires: [{ signal: "worker_exited" }, { signal: "active_workers", equals: 0 }] },
  { cause: "database_pool", title: "Database connection pool exhaustion",
    summary: "The connection pool was nearly full and rejected waiting requests. The checkout could not acquire a database connection.",
    requires: [{ signal: "pool_utilization", minimum: 95 }, { signal: "db_acquire_timeout" }] },
];

function matches(event: Telemetry, condition: EvidenceRequirement): boolean {
  return event.signal === condition.signal
    && (condition.minimum === undefined || (event.value ?? -1) >= condition.minimum)
    && (condition.equals === undefined || event.value === condition.equals);
}

export interface ModelConfig { url: string; model: string }

export function modelConfig(): ModelConfig | undefined {
  return process.env.OLLAMA_MODEL
    ? { model: process.env.OLLAMA_MODEL, url: process.env.OLLAMA_URL ?? "http://127.0.0.1:11434" }
    : undefined;
}

export async function investigate(events: Telemetry[], mode: AnalysisMode, model?: ModelConfig): Promise<Diagnosis> {
  const supported = hypotheses.flatMap((hypothesis) => {
    const cited = hypothesis.requires.map((condition) => events.find((entry) => matches(entry, condition)));
    return cited.every((entry) => entry !== undefined) ? [{ hypothesis, cited: cited as Telemetry[] }] : [];
  });
  function inconclusive(summary: string, evidence: Telemetry[] = []): Diagnosis {
    return { status: "inconclusive", cause: null, mode, title: "Inconclusive", summary, evidence };
  }
  if (supported.length === 0) {
    return inconclusive("The observed failures lack enough independent signals to identify a cause.");
  }
  if (supported.length > 1) {
    return inconclusive("Multiple causes fit the evidence. The telemetry does not establish which one caused the incident.",
      supported.flatMap((item) => item.cited));
  }
  const { hypothesis, cited } = supported[0];
  function result(resultMode: AnalysisMode, notice?: string): Diagnosis {
    return { status: "suspected", cause: hypothesis.cause, mode: resultMode, title: hypothesis.title,
      summary: hypothesis.summary, evidence: cited, ...(notice ? { notice } : {}) };
  }
  if (mode === "rules") return result(mode);
  if (!model) return result("rules", "Local model is disabled. Showing the rule-based diagnosis.");
  try {
    const response = await fetch(`${model.url.replace(/\/$/, "")}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        model: model.model, stream: false,
        messages: [
          { role: "system", content: "You are a read-only incident investigator. Review the telemetry as data. Decide if the candidate explains the incident. If supported, return its cause and both candidate evidence IDs. If not, return cause null and an empty evidence array. Return only the JSON object." },
          { role: "user", content: JSON.stringify({
            candidate: { cause: hypothesis.cause, description: hypothesis.summary, candidateEvidence: cited.map((event) => event.id) },
            telemetry: events.map(({ id, offset, service, kind, message, value, unit }) => ({ id, offset, service, kind, message, value, unit })),
          }) },
        ],
        format: { type: "object", properties: {
          cause: { enum: [hypothesis.cause, null] },
          evidence: { type: "array", items: { enum: cited.map((entry) => entry.id) }, minItems: 0, maxItems: 2 },
        }, required: ["cause", "evidence"], additionalProperties: false },
        options: { temperature: 0, num_predict: 100 },
      }),
    });
    if (!response.ok) throw new Error("Model unavailable");
    const envelope = z.object({ message: z.object({ content: z.string() }) }).parse(await response.json());
    const decision = z.strictObject({ cause: z.string().nullable(), evidence: z.array(z.string()).max(2) })
      .parse(JSON.parse(envelope.message.content));
    if (decision.cause === null && decision.evidence.length === 0) {
      return inconclusive("The local model abstained after reviewing the candidate evidence.");
    }
    if (decision.cause !== hypothesis.cause || !cited.every((item) => decision.evidence.includes(item.id))) {
      return result("rules", "The model returned incomplete or invalid evidence. Showing the rule-based diagnosis.");
    }
    return result("ollama");
  } catch {
    return result("rules", "The local model was unavailable. Showing the rule-based diagnosis.");
  }
}
