import { mockMatch } from "./sources/mockSource";
import { runOnce } from "./core/runtime";

async function main() {
  const apiBaseUrl = process.env.API_BASE_URL || "http://localhost:3000";
  const token = process.env.API_TOKEN;
  const matchId = process.env.MATCH_ID || "MATCH_UUID_1";

  if (!token) {
    throw new Error("REQUIRED ENV VARIABLE MISSING: API_TOKEN");
  }

  const events = mockMatch(matchId);
  await runOnce({ apiBaseUrl, token, events });
  console.log(`Sent ${events.length} events for match ${matchId}`);
}

main().catch((err) => {
  console.error("Run failed", err);
  process.exit(1);
});
