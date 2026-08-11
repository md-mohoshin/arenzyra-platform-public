"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("production remediation is locked, preflighted, exact, and content preserving", () => {
  const wrapper = fs.readFileSync(
    path.join(__dirname, "production-api-data-volume-remediation.sh"),
    "utf8",
  );
  assert.match(wrapper, /ARENZYRA_DEPLOY_LOCK_INHERITED/);
  assert.match(wrapper, /flock -n 8/);
  assert.match(
    wrapper,
    /production-deploy-preflight\.sh --allow-legacy-cutover-stopped/,
  );
  assert.match(
    wrapper,
    /--legacy-cutover-interrupted[\s\S]*production-deploy-preflight\.sh --allow-legacy-cutover-interrupted/,
  );
  assert.match(wrapper, /api-uploads api-storage/);
  assert.match(wrapper, /remediate-api-data-volume-tree\.cjs/);
  assert.match(wrapper, /verify-production-api-data-volumes\.sh/);
  assert.doesNotMatch(
    wrapper,
    /\brm\b|docker\s+(?:volume\s+rm|system\s+prune)/,
  );
});

test("tree remediation preserves bytes and installs the exact nonroot policy", (t) => {
  if (
    process.platform === "win32" ||
    typeof process.getuid !== "function" ||
    process.getuid() !== 0
  ) {
    t.skip("exact POSIX root ownership is required");
    return;
  }
  const {
    remediateVolumeTree,
  } = require("./remediate-api-data-volume-tree.cjs");
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-remediate-"));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  fs.chmodSync(fixture, 0o777);
  const nested = path.join(fixture, "nested");
  fs.mkdirSync(nested, { mode: 0o755 });
  const file = path.join(nested, "asset.bin");
  fs.writeFileSync(file, Buffer.from([0, 1, 2, 255]), { mode: 0o666 });
  fs.chmodSync(file, 0o666);
  const before = fs.readFileSync(file);
  const result = remediateVolumeTree(fixture);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(fs.statSync(fixture).uid, 1000);
  assert.equal(fs.statSync(file).uid, 1000);
  assert.equal(fs.statSync(fixture).mode & 0o7777, 0o750);
  assert.equal(fs.statSync(file).mode & 0o7777, 0o640);
  assert.equal(result.files, 1);
});
