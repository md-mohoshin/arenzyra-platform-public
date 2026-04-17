const path = require("node:path");
const { createRequire } = require("node:module");

const apiRequire = createRequire(
  path.join(__dirname, "..", "apps", "api", "package.json"),
);
const { Client } = apiRequire("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
const matchId = String(process.argv[2] || "").trim();

if (!matchId) {
  console.error("Usage: node scripts/inspect-live-telemetry-db.cjs <matchId>");
  process.exit(1);
}

async function main() {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const [counts, recentEvents, controlState] = await Promise.all([
      client.query(
        `
          select now() as now, count(*)::int as count, max("receivedAt") as max_received
          from "TelemetryEventLog"
          where "matchId" = $1
        `,
        [matchId],
      ),
      client.query(
        `
          select source, sequence, "receivedAt", "processedAt"
          from "TelemetryEventLog"
          where "matchId" = $1
          order by "receivedAt" desc
          limit 10
        `,
        [matchId],
      ),
      client.query(
        `
          select "matchId", state, "updatedAt", "metaJson"
          from "MatchControlState"
          where "matchId" = $1
        `,
        [matchId],
      ),
    ]);

    console.log(
      JSON.stringify(
        {
          counts: counts.rows[0] ?? null,
          recentEvents: recentEvents.rows,
          controlState: controlState.rows[0] ?? null,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
