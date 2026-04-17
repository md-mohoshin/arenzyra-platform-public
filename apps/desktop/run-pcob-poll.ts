import { fetchPcobEvents } from "./sources/pcobSource";
import { runOnce } from "./core/runtime";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry<T>(fn: () => Promise<T>, label: string, max = 3) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt >= max) {
        throw err;
      }
      const delay = Math.min(30000, 1000 * 2 ** (attempt - 1));
      console.warn(`${label} failed (attempt ${attempt}/${max}), retrying in ${delay}ms`, err);
      await sleep(delay);
    }
  }
}

async function main() {
  const apiBaseUrl = process.env.API_BASE_URL || "http://localhost:3000";
  const apiToken = process.env.API_TOKEN;
  const pcobBaseUrl = process.env.PCOB_BASE_URL || "http://localhost:4000";
  const pcobToken = process.env.PCOB_TOKEN;
  const matchId = process.env.MATCH_ID;
  const pollMs = Number(process.env.POLL_MS ?? 5000);

  if (!apiToken) {
    throw new Error("REQUIRED ENV VARIABLE MISSING: API_TOKEN");
  }

  if (!pcobToken) {
    throw new Error("REQUIRED ENV VARIABLE MISSING: PCOB_TOKEN");
  }

  if (!matchId) {
    throw new Error("MATCH_ID env var is required");
  }

  console.log(`Starting PCOB poller for match ${matchId} every ${pollMs}ms`);

  while (true) {
    try {
      const events = await withRetry(
        () => fetchPcobEvents(pcobBaseUrl, pcobToken, matchId),
        "pcob-fetch"
      );

      if (events.length) {
        await withRetry(
          () => runOnce({ apiBaseUrl, token: apiToken, events }),
          "ingest-send"
        );
        console.log(`Sent ${events.length} events at ${new Date().toISOString()}`);
      } else {
        console.log(`No events to send at ${new Date().toISOString()}`);
      }
    } catch (err) {
      console.error("PCOB poll iteration failed after retries", err);
    }

    await sleep(pollMs);
  }
}

main().catch((err) => {
  console.error("PCOB poller failed to start", err);
  process.exit(1);
});
