import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Replay, ScenarioId } from "../shared/contracts.js";
import { simulate } from "./scenarios.js";

export const schema = `
  CREATE TABLE IF NOT EXISTS incident_replays (
    id uuid PRIMARY KEY,
    scenario text NOT NULL,
    seed integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    duration integer NOT NULL CHECK (duration > 0),
    events jsonb NOT NULL CHECK (jsonb_typeof(events) = 'array')
  );
`;

export class ReplayStore {
  constructor(private readonly pool: Pool) {}

  async create(scenario: ScenarioId, seed: number): Promise<Replay> {
    const id = randomUUID();
    const { events, duration } = simulate(scenario, seed);
    const result = await this.pool.query<{ created_at: Date }>(`
      INSERT INTO incident_replays (id, scenario, seed, duration, events) VALUES ($1,$2,$3,$4,$5) RETURNING created_at
    `, [id, scenario, seed, duration, JSON.stringify(events)]);
    return { id, scenario, seed, events, duration, createdAt: result.rows[0].created_at.toISOString() };
  }

  async get(id: string): Promise<Replay | null> {
    const { rows } = await this.pool.query<Omit<Replay, "createdAt"> & { createdAt: Date }>(`
      SELECT id, scenario, seed, duration, events, created_at AS "createdAt" FROM incident_replays WHERE id=$1
    `, [id]);
    const row = rows[0];
    return row ? { ...row, createdAt: row.createdAt.toISOString() } : null;
  }
}
