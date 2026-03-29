import { serve } from "bun";

const port = Number(process.env.PORT ?? 3001);
const service = "reliverse-api";
const databaseEngine = "postgresql";

async function dbPing() {
  const startedAt = Date.now();
  const proc = Bun.spawn([
    "psql",
    process.env.SERVER_DATABASE_URL as string,
    "-Atqc",
    "select 1",
  ], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  if (exitCode !== 0 || stdout.trim() !== "1") {
    throw new Error(stderr.trim() || stdout.trim() || `psql exited with code ${exitCode}`);
  }

  return {
    ok: true,
    engine: databaseEngine,
    transport: "psql",
    latencyMs: Date.now() - startedAt,
  };
}

serve({
  port,
  async fetch(req) {
    const u = new URL(req.url);
    const host = req.headers.get("host") ?? "unknown";

    if (u.pathname === "/health" || u.pathname === "/db/ping") {
      try {
        const database = await dbPing();
        return Response.json({ ok: true, service, port, host, database });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Response.json(
          {
            ok: false,
            service,
            port,
            host,
            database: {
              ok: false,
              engine: databaseEngine,
              transport: "psql",
              error: message,
            },
          },
          { status: 500 },
        );
      }
    }

    return Response.json({ ok: true, service, path: u.pathname, host, port });
  },
});

console.log(`⚡️ [${service}] http://localhost:${port}/`);
