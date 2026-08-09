#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_PCOB_ENDPOINT,
  boolArg,
  ensureDir,
  getJson,
  hashValue,
  numberArg,
  parseArgs,
  sanitizeSlug,
  sleep,
  snapshotSummary,
  stringArg,
  timestampSlug,
  writeJson,
} = require("./pcob-live-utils.cjs");

function printHelp() {
  console.log(`PCOB live recorder

Records raw local PCOB observer snapshots to JSONL for later replay/testing.

Usage:
  node tools/pcob-live-recorder.cjs [options]

Options:
  --label NAME             Optional folder label, for example scrim-g1
  --out DIR                Output folder. Default: recordings/pcob/<timestamp-label>
  --endpoint URL           PCOB snapshot URL. Default: ${DEFAULT_PCOB_ENDPOINT}
  --interval-ms N          Poll interval. Default: 250
  --timeout-ms N           HTTP timeout per poll. Default: 1500
  --idle-stop-ms N         Stop after this long without a good snapshot after recording started. Default: 45000
  --finish-grace-ms N      Stop this long after a finished/end phase is seen. Default: 15000
  --max-packets N          Optional safety limit
  --quiet                  Print less progress
  --help                   Show this help

Stop manually with Ctrl+C.
`);
}

function nowIso() {
  return new Date().toISOString();
}

function isFinishedPhase(phase) {
  return typeof phase === "string" && /^(finish|finished|ended|end)$/i.test(phase);
}

function compactSummary(summary) {
  return `alive=${summary.aliveTeams}/${summary.alivePlayers} kills=${summary.kills} phase=${summary.phase ?? "-"} map=${summary.mapName ?? "-"}`;
}

function writeLine(stream, entry) {
  return new Promise((resolve, reject) => {
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

  const start = new Date();
  const label = sanitizeSlug(stringArg(args, "label", ""));
  const defaultDir = path.join(
    process.cwd(),
    "recordings",
    "pcob",
    `${timestampSlug(start)}${label ? `-${label}` : ""}`,
  );
  const outDir = path.resolve(stringArg(args, "out", defaultDir));
  const endpoint = stringArg(args, "endpoint", DEFAULT_PCOB_ENDPOINT);
  const intervalMs = numberArg(args, "interval-ms", 250, { min: 50 });
  const timeoutMs = numberArg(args, "timeout-ms", 1500, { min: 100 });
  const idleStopMs = numberArg(args, "idle-stop-ms", 45000, { min: 0 });
  const finishGraceMs = numberArg(args, "finish-grace-ms", 15000, { min: 0 });
  const maxPackets = numberArg(args, "max-packets", 0, { min: 0 });
  const quiet = boolArg(args, "quiet");

  ensureDir(outDir);
  const packetsPath = path.join(outDir, "packets.jsonl");
  const metadataPath = path.join(outDir, "metadata.json");
  const stream = fs.createWriteStream(packetsPath, { flags: "a" });

  const metadata = {
    schema: "arenzyra.pcobRecording.v1",
    status: "recording",
    startedAt: start.toISOString(),
    endpoint,
    intervalMs,
    timeoutMs,
    idleStopMs,
    finishGraceMs,
    packetsPath,
    counts: {
      ok: 0,
      changed: 0,
      error: 0,
      total: 0,
    },
  };
  writeJson(metadataPath, metadata);

  let active = true;
  let stopReason = "manual";
  let firstOkAt = null;
  let lastOkAt = null;
  let finishedSeenAt = null;
  let lastHash = null;
  let index = 0;

  process.on("SIGINT", () => {
    active = false;
    stopReason = "ctrl-c";
  });
  process.on("SIGTERM", () => {
    active = false;
    stopReason = "sigterm";
  });

  console.log(`Recording PCOB snapshots to ${outDir}`);
  console.log(`Endpoint: ${endpoint}`);
  console.log("Stop manually with Ctrl+C.");

  while (active) {
    const tickStarted = Date.now();
    const capturedAt = nowIso();
    const elapsedMs = tickStarted - start.getTime();

    try {
      const raw = await getJson(endpoint, timeoutMs);
      const summary = snapshotSummary(raw);
      const hash = hashValue(raw);
      const changed = hash !== lastHash;
      lastHash = hash;
      firstOkAt = firstOkAt ?? capturedAt;
      lastOkAt = capturedAt;
      metadata.counts.ok += 1;
      metadata.counts.changed += changed ? 1 : 0;

      if (isFinishedPhase(summary.phase) && finishedSeenAt === null) {
        finishedSeenAt = Date.now();
      }

      await writeLine(stream, {
        schema: "arenzyra.pcobSnapshotPacket.v1",
        index,
        capturedAt,
        elapsedMs,
        endpoint,
        status: "ok",
        hash,
        changed,
        summary,
        raw,
      });

      if (!quiet && (changed || index % 40 === 0)) {
        console.log(`#${index} ${compactSummary(summary)} changed=${changed}`);
      }
    } catch (error) {
      metadata.counts.error += 1;
      await writeLine(stream, {
        schema: "arenzyra.pcobSnapshotPacket.v1",
        index,
        capturedAt,
        elapsedMs,
        endpoint,
        status: "error",
        error: {
          message: error?.message || String(error),
          code: error?.code || null,
        },
      });
      if (!quiet && index % 20 === 0) {
        console.log(`#${index} PCOB read failed: ${error?.message || error}`);
      }
    }

    index += 1;
    metadata.counts.total = index;

    if (maxPackets > 0 && index >= maxPackets) {
      stopReason = "max-packets";
      break;
    }

    if (firstOkAt && idleStopMs > 0 && lastOkAt) {
      const idleFor = Date.now() - new Date(lastOkAt).getTime();
      if (idleFor >= idleStopMs) {
        stopReason = "idle-timeout";
        break;
      }
    }

    if (finishedSeenAt && finishGraceMs > 0) {
      const finishedFor = Date.now() - finishedSeenAt;
      if (finishedFor >= finishGraceMs) {
        stopReason = "finished-phase";
        break;
      }
    }

    const spentMs = Date.now() - tickStarted;
    await sleep(Math.max(0, intervalMs - spentMs));
  }

  await new Promise((resolve) => stream.end(resolve));

  metadata.status = "finished";
  metadata.stoppedAt = nowIso();
  metadata.stopReason = stopReason;
  metadata.firstOkAt = firstOkAt;
  metadata.lastOkAt = lastOkAt;
  writeJson(metadataPath, metadata);

  console.log(
    `Recorder stopped (${stopReason}). ok=${metadata.counts.ok} changed=${metadata.counts.changed} errors=${metadata.counts.error}`,
  );
  console.log(`Saved: ${packetsPath}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
