"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  REQUIRED_MARKERS,
  REQUIRED_RUNTIME_FILES,
  verifyApiRuntime,
} = require("./verify-production-api-capabilities.cjs");

const apiDockerfile = path.resolve(__dirname, "../apps/api/Dockerfile");

function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "arenzyra-api-capabilities-"),
  );
  for (const relativePath of REQUIRED_RUNTIME_FILES) {
    const target = path.join(root, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      `${(REQUIRED_MARKERS[relativePath] ?? ["runtime"]).join("\n")}\n`,
    );
  }
  return root;
}

test("accepts a dependency-closed API runtime with raw ACK and ranking recovery", () => {
  const root = fixture();
  try {
    const result = verifyApiRuntime(root);
    assert.equal(result.ok, true, result.failures.join("\n"));
    assert.equal(result.verifiedFileCount, REQUIRED_RUNTIME_FILES.length);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("blocks an image that silently drops the durable raw processor", () => {
  const root = fixture();
  try {
    fs.rmSync(
      path.join(root, "dist/modules/observer/observer-raw-events.processor.js"),
    );
    const result = verifyApiRuntime(root);
    assert.equal(result.ok, false);
    assert.match(
      result.failures.join("\n"),
      /observer-raw-events\.processor\.js/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("blocks a healthy-looking image that regresses the results recovery code", () => {
  const root = fixture();
  try {
    const target = path.join(
      root,
      "dist/modules/broadcast/broadcast.gateway.js",
    );
    fs.writeFileSync(target, "module.exports = {};\n");
    const result = verifyApiRuntime(root);
    assert.equal(result.ok, false);
    assert.match(result.failures.join("\n"), /liveRankingRecoveryIntervalMs/);
    assert.match(result.failures.join("\n"), /tickInFlight/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("blocks an image that drops the durable quiet and exact-claim fence", () => {
  const root = fixture();
  try {
    const target = path.join(
      root,
      "dist/modules/observer/observer-raw-events.service.js",
    );
    fs.writeFileSync(
      target,
      fs.readFileSync(target, "utf8").replace("rawActivity", "raw_activity"),
    );
    const result = verifyApiRuntime(root);
    assert.equal(result.ok, false);
    assert.match(result.failures.join("\n"), /rawActivity/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("blocks lifecycle evidence from archive-only raw batches", () => {
  const root = fixture();
  try {
    const target = path.join(
      root,
      "dist/modules/observer/observer-raw-events.service.js",
    );
    fs.writeFileSync(
      target,
      fs
        .readFileSync(target, "utf8")
        .replace(
          "acceptsFinishedSnapshotEvidence = !archiveOnlyReason",
          "acceptsFinishedSnapshotEvidence = true",
        ),
    );
    const result = verifyApiRuntime(root);
    assert.equal(result.ok, false);
    assert.match(
      result.failures.join("\n"),
      /acceptsFinishedSnapshotEvidence = !archiveOnlyReason/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("blocks an image that drops terminal live-notification suppression", () => {
  const root = fixture();
  try {
    const target = path.join(
      root,
      "dist/modules/results/results-events.service.js",
    );
    fs.writeFileSync(
      target,
      fs.readFileSync(target, "utf8").replace("MATCH_NOT_LIVE", "MATCH_STALE"),
    );
    const result = verifyApiRuntime(root);
    assert.equal(result.ok, false);
    assert.match(result.failures.join("\n"), /MATCH_NOT_LIVE/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the API image verifies capabilities in both builder and runner stages", () => {
  const dockerfile = fs.readFileSync(apiDockerfile, "utf8");
  assert.equal(
    dockerfile.match(
      /RUN node scripts\/verify-runtime-capabilities\.cjs --root \/app/g,
    )?.length,
    2,
  );
  assert.match(
    dockerfile,
    /COPY --from=builder \/app\/scripts\/verify-runtime-capabilities\.cjs \.\/scripts\/verify-runtime-capabilities\.cjs/,
  );
});
