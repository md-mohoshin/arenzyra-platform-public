#!/usr/bin/env node
const path = require("node:path");
const axios = require("axios");

const {
  boolArg,
  numberArg,
  parseArgs,
  resolveRecordingPacketsPath,
  sleep,
  stringArg,
} = require("./pcob-live-utils.cjs");
const {
  SnapshotRawEventReconstructor,
  readJsonl,
} = require("./pcob-recording-schema.cjs");

function printHelp() {
  console.log(`PCOB local connector replay

Reconstructs the recoverable route-event lower bound from an observer-snapshot
recording and replays the canonical JSON bodies into an isolated local ob.js.
It is dry-run/no-network by default.

Usage:
  node tools/pcob-local-connector-replay.cjs --recording DIR_OR_JSONL
  node tools/pcob-local-connector-replay.cjs --recording DIR_OR_JSONL --send --confirm-local-send --confirm-isolated-connector

Options:
  --recording PATH              Recording directory or packets.jsonl
  --connector-base URL          Loopback connector base. Default: http://127.0.0.1:10086
  --speed N                     1=recorded event timing, 10=10x, 0=no waits. Default: 1
  --from-index N                Consume earlier state, start POSTs at packet index N
  --max-events N                Optional reconstructed-event limit
  --timeout-ms N                Per-request timeout. Default: 5000
  --stream-id ID                Override deterministic synthetic stream id
  --send                        Enable local HTTP POSTs
  --confirm-local-send          Required with --send
  --confirm-isolated-connector  Attest connector outbound forwarding is disabled or loopback-only
  --json                        Print only the final JSON report
  --help                        Show this help

Safety:
  * Non-loopback connector URLs are rejected.
  * Before sending, /health must report forwardEnabled=false or a loopback
    forwardBaseUrl.
  * Start ob.js with OBSERVER_FORWARD_ENABLE=false. If legacy forwarding is
    enabled, point FORWARD_BASE_URL only at a fake loopback API.
`);
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

function parseLoopbackBase(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Connector URL must use HTTP(S): ${value}`);
  }
  if (!isLoopbackHostname(url.hostname)) {
    throw new Error(`Connector URL must be loopback-only: ${value}`);
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

async function verifyLocalConnector(client, connectorBase) {
  const response = await client.get(`${connectorBase}/health`, {
    validateStatus: () => true,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Local connector health check failed: HTTP ${response.status}`,
    );
  }
  if (response.data?.status !== "ok") {
    throw new Error(
      `Local connector health response was not ok: ${JSON.stringify(response.data)}`,
    );
  }
  if (response.data?.forwardEnabled === true) {
    const forwardBase = String(response.data?.forwardBaseUrl || "").trim();
    if (!forwardBase) {
      throw new Error(
        "Connector forwarding is enabled but /health did not expose forwardBaseUrl",
      );
    }
    parseLoopbackBase(forwardBase);
  }
  return response.data;
}

function eventWaitMs(previousReceivedAt, receivedAt, speed) {
  if (speed <= 0 || !previousReceivedAt) return 0;
  const previous = Date.parse(previousReceivedAt);
  const current = Date.parse(receivedAt);
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return 0;
  return Math.max(0, Math.trunc((current - previous) / speed));
}

async function replayRecordingToConnector(options) {
  const packetsPath = resolveRecordingPacketsPath(options.recording);
  const send = options.send === true;
  const speed = Math.max(0, Number(options.speed ?? 1));
  const fromIndex = Math.max(0, Math.trunc(Number(options.fromIndex || 0)));
  const maxEvents = Math.max(0, Math.trunc(Number(options.maxEvents || 0)));
  const connectorBase = parseLoopbackBase(
    options.connectorBase || "http://127.0.0.1:10086",
  ).toString().replace(/\/$/, "");
  const client = axios.create({
    timeout: Number(options.timeoutMs || 5000),
    proxy: false,
    maxRedirects: 0,
  });
  let health = null;
  if (send) {
    health = await verifyLocalConnector(client, connectorBase);
  }

  const reconstructor = new SnapshotRawEventReconstructor({
    streamId: options.streamId || null,
    fallbackSeed: packetsPath,
  });
  const byEndpoint = {};
  let packetsRead = 0;
  let parseErrors = 0;
  let reconstructedEvents = 0;
  let postedEvents = 0;
  let firstSequence = null;
  let lastSequence = null;
  let previousReceivedAt = null;
  let stoppedAtLimit = false;

  outer: for await (const { line, lineNumber } of readJsonl(packetsPath)) {
    let packet;
    try {
      packet = JSON.parse(line);
    } catch (error) {
      parseErrors += 1;
      throw new Error(`Invalid JSON at ${packetsPath}:${lineNumber}: ${error.message}`);
    }
    packetsRead += 1;
    if (packet.status !== "ok" || !packet.raw) continue;
    const packetIndex = Number(packet.index || 0);
    if (packetIndex < fromIndex) {
      reconstructor.consume(packet, { materialize: false });
      continue;
    }
    const batch = reconstructor.consume(packet);
    if (!batch) continue;

    for (const event of batch.events) {
      if (maxEvents > 0 && reconstructedEvents >= maxEvents) {
        stoppedAtLimit = true;
        break outer;
      }
      reconstructedEvents += 1;
      firstSequence ??= event.sequence;
      lastSequence = event.sequence;
      byEndpoint[event.endpoint] = (byEndpoint[event.endpoint] || 0) + 1;
      if (!send) continue;
      if (!event.endpoint.startsWith("/") || event.endpoint.startsWith("//")) {
        throw new Error(`Unsafe reconstructed endpoint: ${event.endpoint}`);
      }
      const waitMs = eventWaitMs(
        previousReceivedAt,
        event.receivedAt,
        speed,
      );
      if (waitMs > 0) await sleep(waitMs);
      previousReceivedAt = event.receivedAt;
      const body = Buffer.from(event.rawBodyBase64, "base64");
      const response = await client.post(
        `${connectorBase}${event.endpoint}`,
        body,
        {
          headers: {
            "Content-Type": event.contentType || "application/json",
            "Content-Length": String(body.length),
            "X-Arenzyra-Synthetic-Replay": "true",
            "X-Arenzyra-Raw-Event-Id": event.eventId,
            "X-Arenzyra-Raw-Event-Sequence": String(event.sequence),
          },
          maxBodyLength: Infinity,
          validateStatus: () => true,
        },
      );
      if (response.status < 200 || response.status >= 300) {
        throw new Error(
          `Connector rejected sequence ${event.sequence} ${event.endpoint}: HTTP ${response.status}`,
        );
      }
      postedEvents += 1;
    }
  }

  return {
    mode: send ? "local-send" : "dry-run",
    packetsPath: path.resolve(packetsPath),
    connectorBase,
    packetsRead,
    parseErrors,
    reconstructedEvents,
    postedEvents,
    stoppedAtLimit,
    streamId: reconstructor.streamId,
    firstSequence,
    lastSequence,
    byEndpoint: Object.fromEntries(
      Object.entries(byEndpoint).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    syntheticFromSnapshot: true,
    connectorHealth: health,
  };
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  if (boolArg(args, "help")) {
    printHelp();
    return;
  }
  const recording = stringArg(args, "recording", "");
  if (!recording) throw new Error("--recording is required");
  const send = boolArg(args, "send");
  if (send && !boolArg(args, "confirm-local-send")) {
    throw new Error("--confirm-local-send is required with --send");
  }
  if (send && !boolArg(args, "confirm-isolated-connector")) {
    throw new Error("--confirm-isolated-connector is required with --send");
  }

  const report = await replayRecordingToConnector({
    recording,
    connectorBase: stringArg(
      args,
      "connector-base",
      "http://127.0.0.1:10086",
    ),
    speed: Number(args.speed ?? 1),
    fromIndex: numberArg(args, "from-index", 0, { min: 0 }),
    maxEvents: numberArg(args, "max-events", 0, { min: 0 }),
    timeoutMs: numberArg(args, "timeout-ms", 5000, {
      min: 100,
      max: 120000,
    }),
    streamId: stringArg(args, "stream-id", ""),
    send,
  });

  if (!boolArg(args, "json")) {
    console.log(
      send
        ? `Posted ${report.postedEvents} synthetic events to ${report.connectorBase}`
        : `Dry-run reconstructed ${report.reconstructedEvents} synthetic events; no network requests made.`,
    );
  }
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  eventWaitMs,
  isLoopbackHostname,
  parseLoopbackBase,
  replayRecordingToConnector,
  verifyLocalConnector,
};
