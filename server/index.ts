import { createApp } from "./app.js";
import { createPool, migrate } from "./database.js";
import { modelConfig } from "./investigator.js";
import { schema } from "./replays.js";

const pool = createPool();
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 8792);
try {
  await migrate(pool, "incident-replay-lab", schema);
  const server = createApp(pool, modelConfig()).listen(port, host, () => console.log(`Replay Lab ready at http://${host}:${port}`));
  const stop = () => server.close(() => void pool.end());
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, stop);
  server.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
    void pool.end();
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Startup failed.");
  process.exitCode = 1;
  await pool.end();
}
