#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const {
  boolArg,
  parseArgs,
  stringArg,
  writeJson,
} = require("./pcob-live-utils.cjs");
const {
  OBSERVED_SCHEMA_MANIFEST,
  analyzeRecording,
  buildObservedManifest,
  compareObservedManifest,
} = require("./pcob-recording-schema.cjs");

const DEFAULT_MANIFEST = path.resolve(
  __dirname,
  "pcob-observed-schema.v1.json",
);

function printHelp() {
  console.log(`PCOB recording/schema verifier

Streams observer-snapshot JSONL recordings, reconstructs the recoverable route
event lower bound, and verifies it against a versioned observed schema manifest.
Multi-gigabyte packets files are never loaded into memory as a whole.

Usage:
  node tools/pcob-recording-verify.cjs
  node tools/pcob-recording-verify.cjs --recording PATH[,PATH]
  node tools/pcob-recording-verify.cjs PATH [PATH]

Options:
  --manifest PATH          Manifest to verify. Default: tools/pcob-observed-schema.v1.json
  --recording PATHS        Recording directories/JSONL files, comma separated
  --routes-only            Skip the derived observer-snapshot schema traversal
  --allow-subset           Permit manifest paths/routes absent from compact fixtures
  --skip-source-counts     Do not compare full-recording packet/event counts
  --json                   Print the verification report as JSON
  --print-manifest         Print the deterministic observed manifest to stdout
  --write-manifest PATH    Write a regenerated manifest (requires --confirm-write)
  --confirm-write          Required with --write-manifest
  --help                   Show this help

The default invocation verifies both recordings named by the checked-in manifest.
No network requests are made.
`);
}

function normalizeRecordingArgument(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function portableRelative(filePath) {
  const relative = path.relative(process.cwd(), path.resolve(filePath));
  return relative.split(path.sep).join("/");
}

function loadManifest(filePath) {
  const manifest = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (manifest.schema !== OBSERVED_SCHEMA_MANIFEST || manifest.version !== 1) {
    throw new Error(
      `Unsupported manifest ${String(manifest.schema)} version ${String(manifest.version)}`,
    );
  }
  return manifest;
}

function integrityErrors(analyses) {
  const errors = [];
  for (const analysis of analyses) {
    if (analysis.parseErrors.length) {
      errors.push({
        scope: `${analysis.recordingId}.parseErrors`,
        errors: analysis.parseErrors,
      });
    }
    if (analysis.indexErrors.length) {
      errors.push({
        scope: `${analysis.recordingId}.indexErrors`,
        errors: analysis.indexErrors,
      });
    }
    for (const key of ["hashErrors", "changeFlagErrors", "metadataErrors"]) {
      if (analysis[key].length) {
        errors.push({
          scope: `${analysis.recordingId}.${key}`,
          errors: analysis[key].slice(0, 20),
          total: analysis[key].length,
        });
      }
    }
    if (analysis.rawReducedRouteMismatches.length) {
      errors.push({
        scope: `${analysis.recordingId}.rawReducedRouteMismatches`,
        errors: analysis.rawReducedRouteMismatches.slice(0, 20),
        total: analysis.rawReducedRouteMismatches.length,
      });
    }
    const nonOk = Object.entries(analysis.statuses).filter(
      ([status, count]) => status !== "ok" && count > 0,
    );
    if (nonOk.length) {
      errors.push({ scope: `${analysis.recordingId}.statuses`, nonOk });
    }
  }
  return errors;
}

function compactAnalysis(analysis) {
  return {
    recordingId: analysis.recordingId,
    packetsPath: analysis.packetsPath,
    packetCount: analysis.packetCount,
    okPacketCount: analysis.okPacketCount,
    changedPacketCount: analysis.changedPacketCount,
    hashErrors: analysis.hashErrors.length,
    changeFlagErrors: analysis.changeFlagErrors.length,
    metadataErrors: analysis.metadataErrors.length,
    endpoints: analysis.endpoints,
    maps: analysis.maps,
    phases: analysis.phases,
    routes: Object.fromEntries(
      Object.entries(analysis.routes).map(([endpoint, route]) => [
        endpoint,
        {
          observedVersions: route.observedVersions,
          phases: route.phases,
          rawFieldPaths: Object.keys(route.rawPayloadPaths).length,
          reducedFieldPaths: Object.keys(route.reducedPayloadPaths).length,
        },
      ]),
    ),
    observerSnapshotFieldPaths: Object.keys(analysis.snapshotPaths).length,
    reconstructedRawEvents: analysis.reconstructedRawEvents,
  };
}

async function main() {
  const { args, rest } = parseArgs(process.argv.slice(2));
  if (boolArg(args, "help")) {
    printHelp();
    return;
  }

  const manifestPath = path.resolve(
    stringArg(args, "manifest", DEFAULT_MANIFEST),
  );
  const writeManifestPath = stringArg(args, "write-manifest", "");
  const shouldLoadManifest = !writeManifestPath || fs.existsSync(manifestPath);
  const baseline = shouldLoadManifest ? loadManifest(manifestPath) : null;
  const explicitRecordings = [
    ...normalizeRecordingArgument(args.recording),
    ...rest,
  ];
  const recordingLabels = explicitRecordings.length
    ? explicitRecordings
    : (baseline?.sources || []).map((source) => source.recording);
  if (!recordingLabels.length) {
    throw new Error(
      "No recordings supplied and the manifest has no source recordings",
    );
  }

  const analyses = [];
  for (const recording of recordingLabels) {
    const absolute = path.resolve(recording);
    process.stderr.write(`Analyzing ${absolute}\n`);
    analyses.push(
      await analyzeRecording(absolute, {
        includeSnapshotSchema: !boolArg(args, "routes-only"),
      }),
    );
  }

  const candidate = buildObservedManifest(analyses, {
    recordingPaths: recordingLabels.map((recording) =>
      explicitRecordings.length ? portableRelative(recording) : recording,
    ),
  });
  const integrity = integrityErrors(analyses);

  if (boolArg(args, "print-manifest")) {
    process.stdout.write(`${JSON.stringify(candidate, null, 2)}\n`);
  }

  if (writeManifestPath) {
    if (!boolArg(args, "confirm-write")) {
      throw new Error("--confirm-write is required with --write-manifest");
    }
    const target = path.resolve(writeManifestPath);
    writeJson(target, candidate);
    process.stderr.write(`Wrote ${target}\n`);
  }

  let comparison = { ok: true, errors: [] };
  if (baseline && !writeManifestPath) {
    comparison = compareObservedManifest(baseline, candidate, {
      exact: !boolArg(args, "allow-subset"),
      compareSnapshot: !boolArg(args, "routes-only"),
      compareSources:
        explicitRecordings.length === 0 &&
        !boolArg(args, "skip-source-counts"),
    });
  }

  const report = {
    ok: integrity.length === 0 && comparison.ok,
    manifest: baseline ? manifestPath : null,
    streaming: true,
    analyses: analyses.map(compactAnalysis),
    integrityErrors: integrity,
    schemaErrors: comparison.errors,
    limitations: candidate.limitations,
  };

  if (boolArg(args, "json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (!boolArg(args, "print-manifest")) {
    for (const analysis of report.analyses) {
      console.log(
        `${analysis.recordingId}: packets=${analysis.packetCount} changed=${analysis.changedPacketCount} routes=${Object.keys(analysis.routes).length} reconstructedRawEvents=${analysis.reconstructedRawEvents.events}`,
      );
    }
    console.log(
      report.ok
        ? "PCOB observed schema verification passed."
        : `PCOB observed schema verification failed (${integrity.length} integrity group(s), ${comparison.errors.length} schema regression(s)).`,
    );
  }

  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
