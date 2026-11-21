import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createApp } from "../server/app.js";
import { createPool, migrate } from "../server/database.js";
import { investigate } from "../server/investigator.js";
import { schema } from "../server/replays.js";
import { simulate } from "../server/scenarios.js";

test("scenario is deterministic and emits chronologically ordered telemetry", () => {
  const first = simulate("competing", 73);
  assert.deepEqual(first, simulate("competing", 73));
  assert.notDeepEqual(first, simulate("competing", 4));
  assert.ok(first.events.every((event, index) => index === 0 || event.offset >= first.events[index - 1].offset));
  assert.deepEqual(new Set(first.events.map((event) => event.kind)), new Set(["log", "metric", "span"]));
  assert.equal(new Set(first.events.map((event) => event.id)).size, first.events.length);
});

test("missing and competing evidence require abstention", async () => {
  const gap = await investigate(simulate("telemetry-gap", 4).events, "rules");
  assert.equal(gap.status, "inconclusive");
  assert.equal(gap.evidence.length, 0);
  const competing = await investigate(simulate("competing", 4).events, "rules");
  assert.equal(competing.cause, null);
  assert.equal(competing.evidence.length, 4);
});

test("invalid model citations are rejected and labeled", async (t) => {
  const events = simulate("worker", 4).events;
  const fake = t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    message: { content: JSON.stringify({ cause: "worker_exit", evidence: ["T99", "T98"] }) },
  })));
  const result = await investigate(events, "ollama", { url: "http://127.0.0.1:11434", model: "fixture" });
  assert.equal(fake.mock.callCount(), 1);
  assert.equal(result.mode, "rules");
  assert.match(result.notice ?? "", /invalid evidence/);
  assert.equal(result.cause, "worker_exit");
  assert.equal(result.evidence.length, 2);
  assert.ok(result.evidence.every((item) => events.includes(item)));
});

test("unavailable model recovers to rules and preserves original citations", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("", { status: 503 }));
  const result = await investigate(simulate("database", 4).events, "ollama",
    { url: "http://127.0.0.1:11434", model: "fixture" });
  assert.equal(result.mode, "rules");
  assert.equal(result.cause, "database_pool");
  assert.match(result.notice ?? "", /unavailable/);
});

test("persisted replay is recoverable through the API with source evidence", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const pool = createPool(process.env.TEST_DATABASE_URL);
  t.after(() => pool.end());
  await migrate(pool, "incident-ci", schema);
  const server = createApp(pool).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const to = (endpoint: string, json: unknown) => fetch(url + endpoint, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(json),
  });
  assert.equal((await to("/api/runs", { scenario: "unsupported" })).status, 400);
  const create = await to("/api/runs", { scenario: "upstream", seed: 73 });
  assert.equal(create.status, 201);
  const replay = await create.json();
  assert.deepEqual(await (await fetch(url + "/api/runs/" + replay.id)).json(), replay);
  const result = await (await to(`/api/runs/${replay.id}/investigate`, { mode: "rules" })).json();
  assert.equal(result.cause, "upstream_latency");
  assert.equal(result.evidence.length, 2);
  for (const record of result.evidence) assert.deepEqual(replay.events.find((event: { id: string }) => event.id === record.id), record);
  assert.equal((await fetch(url + "/api/health")).status, 200);
});
