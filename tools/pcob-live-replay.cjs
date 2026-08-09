#!/usr/bin/env node
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const readline = require("node:readline");
const zlib = require("node:zlib");
const axios = require("axios");
const {
  boolArg,
  buildObserverTelemetryPayload,
  ensureDir,
  numberArg,
  parseArgs,
  readLauncherSession,
  resolveRecordingPacketsPath,
  sleep,
  snapshotSummary,
  stringArg,
  timestampSlug,
} = require("./pcob-live-utils.cjs");
const {
  SnapshotRawEventReconstructor,
  validateRawEventsAck,
} = require("./pcob-recording-schema.cjs");

function printHelp() {
  console.log(`PCOB live replay

Replays a saved PCOB recording into Arenzyra. It is dry-run by default.

Usage:
  node tools/pcob-live-replay.cjs --recording DIR_OR_JSONL [options]

Dry-run:
  node tools/pcob-live-replay.cjs --recording recordings/pcob/<folder>

Actual send, intentionally guarded:
  node tools/pcob-live-replay.cjs --recording recordings/pcob/<folder> --match-id MATCH_ID --send --confirm-send

Options:
  --recording PATH         Recording folder or packets.jsonl file
  --match-id ID            Target Arenzyra match id. Required with --send
  --api-base URL           Override API base. Default: launcher session apiBase
  --session-id ID          Replay session id. Default: replay-<timestamp>
  --speed N                Timing multiplier. 1 = real time, 10 = 10x faster, 0 = no waits. Default: 1
  --max-packets N          Optional max successful packets to replay
  --from-index N           Start at packet index N
  --retries N              Retry network/5xx/429 telemetry posts. Default: 3
  --post-timeout-ms N      Telemetry post timeout. Default: 30000
  --gzip                   Gzip telemetry request bodies
  --keyframe-ms N          Send summary changes plus one snapshot every N source ms
  --raw-events             Reconstruct and send synthetic rawEvents with each snapshot
  --raw-events-stream-id ID  Override the deterministic synthetic stream id
  --send                   Actually post telemetry
  --confirm-send           Required with --send
  --help                   Show this help
`);
}

function summaryKey(summary) {
  return JSON.stringify({
    isInGame: summary.isInGame,
    mapName: summary.mapName,
    alivePlayers: summary.alivePlayers,
    aliveTeams: summary.aliveTeams,
    kills: summary.kills,
    phase: summary.phase,
  });
}

async function createObserverFeedToken(session, apiBase) {
  const response = await axios({
    method: "POST",
    url: `${apiBase}/launcher/observer-feed-token`,
    timeout: 15000,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json",
    },
    validateStatus: () => true,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Could not create observer feed token: HTTP ${response.status} ${JSON.stringify(
        response.data,
      )}`,
    );
  }
  const token = String(response.data?.accessToken || "").trim();
  if (!token) {
    throw new Error("Observer feed token response did not include accessToken");
  }
  return token;
}

function openJsonl(filePath) {
  return readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
}

async function writeLine(stream, entry) {
  if (!stream) {
    return;
  }
  await new Promise((resolve, reject) => {
    const ok = stream.write(`${JSON.stringify(entry)}\n`, "utf8", (error) => {
      if (error) reject(error);
    });
    if (ok) {
      resolve();
      return;
    }
    stream.once("drain", resolve);
  });
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  if (boolArg(args, "help")) {
    printHelp();
    return;
  }

  const recording = stringArg(args, "recording", "");
  if (!recording) {
    throw new Error("--recording is required");
  }

  const packetsPath = resolveRecordingPacketsPath(recording);
  if (!fs.existsSync(packetsPath)) {
    throw new Error(`Recording packets file not found: ${packetsPath}`);
  }

  const send = boolArg(args, "send");
  const confirmSend = boolArg(args, "confirm-send");
  const matchId = stringArg(args, "match-id", "");
  const speed = Math.max(0, Number(args.speed ?? 1));
  const maxPackets = numberArg(args, "max-packets", 0, { min: 0 });
  const fromIndex = numberArg(args, "from-index", 0, { min: 0 });
  const postRetries = numberArg(args, "retries", 3, { min: 0, max: 20 });
  const postTimeoutMs = numberArg(args, "post-timeout-ms", 30000, {
    min: 1000,
    max: 120000,
  });
  const keyframeMs = numberArg(args, "keyframe-ms", 0, { min: 0 });
  const gzipPosts = boolArg(args, "gzip");
  const includeRawEvents = boolArg(args, "raw-events");
  const rawEventsStreamId = stringArg(args, "raw-events-stream-id", "");
  const replaySessionId = stringArg(
    args,
    "session-id",
    `replay-${timestampSlug(new Date())}`,
  );

  let apiBase = stringArg(args, "api-base", "");
  let feedToken = null;
  let runLogStream = null;
  const httpAgent = send ? new http.Agent({ keepAlive: true }) : null;
  const httpsAgent = send ? new https.Agent({ keepAlive: true }) : null;

  if (send) {
    if (!confirmSend) {
      throw new Error("--confirm-send is required with --send");
    }
    if (!matchId) {
      throw new Error("--match-id is required with --send");
    }
    const session = readLauncherSession();
    apiBase = (apiBase || session.apiBase).replace(/\/$/, "");
    feedToken = await createObserverFeedToken(session, apiBase);

    const runDir = path.join(path.dirname(packetsPath), "replay-runs");
    ensureDir(runDir);
    runLogStream = fs.createWriteStream(
      path.join(runDir, `${timestampSlug(new Date())}.jsonl`),
      { flags: "a" },
    );
  }

  console.log(`Recording: ${packetsPath}`);
  console.log(send ? `Sending to ${apiBase} match ${matchId}` : "Dry-run only; no telemetry will be sent.");
  console.log(`Replay session: ${replaySessionId}`);
  if (send && gzipPosts) {
    console.log("Telemetry request gzip: enabled");
  }

  const rl = openJsonl(packetsPath);
  let previousCapturedAt = null;
  let processed = 0;
  let sent = 0;
  let skipped = 0;
  let firstSummary = null;
  let lastSummary = null;
  let lastSelectedCapturedAt = null;
  let lastSelectedSummaryKey = null;
  const rawEventReconstructor = includeRawEvents
    ? new SnapshotRawEventReconstructor({
        streamId: rawEventsStreamId || null,
        fallbackSeed: packetsPath,
      })
    : null;

  for await (const line of rl) {
    const normalizedLine = line.replace(/^\uFEFF/, "").trim();
    if (!normalizedLine) {
      continue;
    }

    let entry;
    try {
      entry = JSON.parse(normalizedLine);
    } catch {
      skipped += 1;
      continue;
    }

    if (entry.status !== "ok" || !entry.raw) {
      skipped += 1;
      continue;
    }
    const sourceIndex = Number(entry.index ?? 0);
    const beforeReplayWindow = sourceIndex < fromIndex;
    if (beforeReplayWindow) {
      rawEventReconstructor?.consume(entry, { materialize: false });
      skipped += 1;
      continue;
    }
    if (maxPackets > 0 && sent >= maxPackets) {
      break;
    }
    const reconstructedRawEvents = rawEventReconstructor
      ? rawEventReconstructor.consume(entry)
      : null;

    const capturedAt = new Date(entry.capturedAt).getTime();
    if (
      send &&
      previousCapturedAt !== null &&
      Number.isFinite(capturedAt) &&
      Number.isFinite(previousCapturedAt) &&
      speed > 0
    ) {
      const waitMs = Math.max(0, Math.trunc((capturedAt - previousCapturedAt) / speed));
      if (waitMs > 0) {
        await sleep(waitMs);
      }
    }
    previousCapturedAt = capturedAt;

    const summary = snapshotSummary(entry.raw);

    if (keyframeMs > 0 && lastSelectedCapturedAt !== null) {
      const currentSummaryKey = summaryKey(summary);
      const elapsedMs =
        Number.isFinite(capturedAt) && Number.isFinite(lastSelectedCapturedAt)
          ? capturedAt - lastSelectedCapturedAt
          : keyframeMs;
      if (
        currentSummaryKey === lastSelectedSummaryKey &&
        elapsedMs < keyframeMs &&
        !reconstructedRawEvents
      ) {
        skipped += 1;
        continue;
      }
    }
    lastSelectedCapturedAt = capturedAt;
    lastSelectedSummaryKey = summaryKey(summary);

    firstSummary = firstSummary ?? summary;
    lastSummary = summary;

    if (send) {
      const timestamp = Date.now();
      const payload = buildObserverTelemetryPayload(entry.raw, {
        matchId,
        sessionId: replaySessionId,
        sequence: timestamp + sent,
        timestamp,
      });
      if (reconstructedRawEvents) {
        payload.rawEvents = reconstructedRawEvents;
      }
      const requestData = gzipPosts
        ? zlib.gzipSync(Buffer.from(JSON.stringify(payload), "utf8"))
        : payload;
      let response = null;
      let attempt = 0;
      for (;;) {
        try {
          response = await axios({
            method: "POST",
            url: `${apiBase}/api/observer/telemetry`,
            data: requestData,
            timeout: postTimeoutMs,
            validateStatus: () => true,
            httpAgent,
            httpsAgent,
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${feedToken}`,
              "Content-Type": "application/json",
              ...(gzipPosts ? { "Content-Encoding": "gzip" } : {}),
            },
          });
        } catch (error) {
          if (attempt >= postRetries) {
            throw new Error(
              `Telemetry post request failed at source index ${entry.index}: ${error?.message ?? error}`,
            );
          }
          attempt += 1;
          await sleep(Math.min(10000, 500 * attempt * attempt));
          continue;
        }

        if (
          response &&
          (response.status === 429 || response.status >= 500) &&
          attempt < postRetries
        ) {
          attempt += 1;
          await sleep(Math.min(10000, 500 * attempt * attempt));
          continue;
        }
        break;
      }
      await writeLine(runLogStream, {
        at: new Date().toISOString(),
        sourceIndex: entry.index,
        status: response?.status ?? null,
        ok: response ? response.status >= 200 && response.status < 300 : false,
        ignored: response?.data?.ignored ?? null,
        reason: response?.data?.reason ?? null,
        matchId: response?.data?.matchId ?? null,
        attempts: attempt + 1,
        summary,
        ...(reconstructedRawEvents
          ? {
              rawEvents: {
                streamId: reconstructedRawEvents.streamId,
                firstSequence: reconstructedRawEvents.firstSequence,
                lastSequence: reconstructedRawEvents.lastSequence,
                count: reconstructedRawEvents.events.length,
              },
              rawEventsAck: response?.data?.rawEventsAck ?? null,
            }
          : {}),
      });
      if (!response || response.status < 200 || response.status >= 300) {
        throw new Error(
          `Telemetry post failed at source index ${entry.index}: HTTP ${response?.status ?? "NO_RESPONSE"} ${JSON.stringify(
            response?.data ?? null,
          )}`,
        );
      }
      const ignoredReason = response.data?.reason ?? "UNKNOWN_REASON";
      if (
        response.data?.ignored === true &&
        ignoredReason !== "NO_STATE_CHANGE"
      ) {
        throw new Error(
          `Telemetry post was ignored at source index ${entry.index}: ${ignoredReason}`,
        );
      }
      if (reconstructedRawEvents) {
        const acknowledgement = validateRawEventsAck(
          response.data?.rawEventsAck,
          reconstructedRawEvents,
        );
        if (!acknowledgement.ok) {
          throw new Error(
            `Invalid rawEvents acknowledgement at source index ${entry.index}: ${acknowledgement.errors.join("; ")}`,
          );
        }
      }
    }

    sent += 1;
    processed += 1;
    if (sent === 1 || sent % 50 === 0) {
      console.log(
        `#${entry.index} sent=${send ? sent : 0} dry=${send ? 0 : processed} alive=${summary.aliveTeams}/${summary.alivePlayers} kills=${summary.kills} phase=${summary.phase ?? "-"}`,
      );
    }
  }

  if (runLogStream) {
    await new Promise((resolve) => runLogStream.end(resolve));
  }

  console.log(
    JSON.stringify(
      {
        mode: send ? "sent" : "dry-run",
        packetsRead: processed,
        packetsSent: send ? sent : 0,
        skipped,
        firstSummary,
        lastSummary,
        ...(rawEventReconstructor
          ? {
              rawEvents: {
                ...rawEventReconstructor.stats,
                streamId: rawEventReconstructor.streamId,
                syntheticFromSnapshot: true,
              },
            }
          : {}),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
