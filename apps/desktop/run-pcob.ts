import { fetchPcobEvents } from "./sources/pcobSource";
import { runOnce } from "./core/runtime";

async function main() {
  const apiBaseUrl = process.env.API_BASE_URL || "http://localhost:3000";
  const apiToken = process.env.API_TOKEN;
  const pcobBaseUrl = process.env.PCOB_BASE_URL || "http://localhost:4000";
  const pcobToken = process.env.PCOB_TOKEN;
  const matchId = process.env.MATCH_ID;

  if (!apiToken) {
    throw new Error("REQUIRED ENV VARIABLE MISSING: API_TOKEN");
  }

  if (!pcobToken) {
    throw new Error("REQUIRED ENV VARIABLE MISSING: PCOB_TOKEN");
  }

  if (!matchId) {
    throw new Error("MATCH_ID env var is required");
  }

  const events = await fetchPcobEvents(pcobBaseUrl, pcobToken, matchId);
  if (!events.length) {
    console.log("No events produced from PCOB snapshot; nothing sent.");
    return;
  }

  await runOnce({ apiBaseUrl, token: apiToken, events });
  console.log(`Sent ${events.length} events for match ${matchId}`);
}

main().catch((err) => {
  console.error("PCOB run failed", err);
  process.exit(1);
});
