import pg, { type Pool, type PoolClient } from "pg";

export function createPool(connectionString = process.env.DATABASE_URL): Pool {
  const pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 3000, statement_timeout: 8000 });
  pool.on("error", (error) => console.error("PostgreSQL connection error:", error.message));
  return pool;
}

export async function transaction<T>(pool: Pool, execute: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await execute(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function migrate(pool: Pool, namespace: string, schema: string): Promise<void> {
  await transaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [namespace]);
    await client.query(schema);
  });
}
