"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const {
  inspectVolumeTree,
} = require("./verify-api-data-volume-tree.cjs");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("API data-volume gate is read-only and exact for the nonroot image", () => {
  const gate = read("scripts/verify-production-api-data-volumes.sh");
  const dockerGuard = gate.indexOf("source scripts/require-local-production-docker.sh");
  const firstDocker = gate.indexOf("docker ps");
  assert.ok(dockerGuard >= 0 && dockerGuard < firstDocker);
  assert.match(gate, /expected_uid=1000/);
  assert.match(gate, /expected_gid=1000/);
  assert.match(gate, /expected_root_mode=750/);
  assert.match(gate, /--allow-running-legacy-root-api/);
  assert.match(gate, /legacy_api_status.*running/);
  assert.match(gate, /legacy_api_health.*healthy/);
  assert.match(gate, /legacy_api_user/);
  assert.match(gate, /--legacy-root-profile/);
  assert.match(gate, /recovery_profile=legacy-root-read-only/);
  assert.match(gate, /com\.docker\.compose\.project/);
  assert.match(gate, /com\.docker\.compose\.volume/);
  assert.match(gate, /\[ "\$driver" != "local" \]/);
  assert.match(gate, /\[ "\$scope" != "local" \]/);
  assert.match(gate, /\[ "\$option_count" != "0" \]/);
  assert.match(gate, /present_volume_count.*-ne 2/);
  assert.match(gate, /first-deploy API volume inventory is partial/);
  assert.match(gate, /verify-api-data-volume-tree\.cjs/);
  assert.match(gate, /--uid "\$expected_uid"/);
  assert.match(gate, /--gid "\$expected_gid"/);
  assert.match(gate, /special node, multi-link file/);
  assert.match(gate, /volume\|\$\{volume_name\}\|true/);
  assert.doesNotMatch(
    gate,
    /\b(?:chown|chmod|rm|mv|docker\s+(?:run|exec|compose|volume\s+rm))\b/,
  );
});

test("volume tree accepts only single-link regular files and directories", (t) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-volume-tree-"));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  fs.chmodSync(fixture, 0o750);
  fs.mkdirSync(path.join(fixture, "nested"));
  fs.chmodSync(path.join(fixture, "nested"), 0o750);
  fs.writeFileSync(path.join(fixture, "nested", "asset.bin"), "reviewed\n");
  fs.chmodSync(path.join(fixture, "nested", "asset.bin"), 0o640);
  const identity = fs.lstatSync(fixture);
  assert.doesNotThrow(() =>
    inspectVolumeTree(fixture, {
      uid: identity.uid,
      gid: identity.gid,
      enforceMode: process.platform !== "win32",
    }),
  );

  fs.linkSync(
    path.join(fixture, "nested", "asset.bin"),
    path.join(fixture, "hardlink.bin"),
  );
  assert.throws(
    () => inspectVolumeTree(fixture, {
      uid: identity.uid,
      gid: identity.gid,
      enforceMode: process.platform !== "win32",
    }),
    /hard-linked regular files/,
  );
});

test("volume tree rejects FIFO/special nodes when the host can create them", (t) => {
  if (process.platform === "win32") {
    t.skip("Windows does not expose POSIX FIFO nodes");
    return;
  }
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-volume-fifo-"));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  fs.chmodSync(fixture, 0o750);
  const fifo = path.join(fixture, "unexpected.fifo");
  const created = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
  if (created.status !== 0) {
    t.skip("mkfifo is unavailable");
    return;
  }
  const identity = fs.lstatSync(fixture);
  assert.throws(
    () => inspectVolumeTree(fixture, { uid: identity.uid, gid: identity.gid }),
    /special filesystem nodes/,
  );
});

test("legacy recovery profile accepts only the observed root-owned modes", (t) => {
  if (process.platform === "win32") {
    t.skip("Windows does not expose exact POSIX ownership/modes");
    return;
  }
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-legacy-volume-"));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  fs.chmodSync(fixture, 0o777);
  const nested = path.join(fixture, "nested");
  fs.mkdirSync(nested, { mode: 0o755 });
  const asset = path.join(nested, "asset.bin");
  fs.writeFileSync(asset, "legacy\n", { mode: 0o666 });
  fs.chmodSync(asset, 0o666);
  const identity = fs.lstatSync(fixture);
  assert.doesNotThrow(() =>
    inspectVolumeTree(fixture, {
      uid: identity.uid,
      gid: identity.gid,
      legacyRootProfile: true,
    }),
  );
  fs.chmodSync(asset, 0o600);
  assert.throws(
    () => inspectVolumeTree(fixture, {
      uid: identity.uid,
      gid: identity.gid,
      legacyRootProfile: true,
    }),
    /legacy regular-file mode/,
  );
});

test("every production preflight enforces the API data-volume gate", () => {
  const preflight = read("scripts/production-deploy-preflight.sh");
  const inventory = preflight.indexOf("docker ps -a");
  const volumeGate = preflight.indexOf(
    "bash scripts/verify-production-api-data-volumes.sh",
  );
  const healthInspection = preflight.indexOf("docker inspect", volumeGate);
  assert.ok(inventory >= 0 && inventory < volumeGate);
  assert.ok(volumeGate < healthInspection);
  assert.match(preflight, /volume_gate_args\+=\(--allow-absent\)/);
  assert.match(
    preflight,
    /volume_gate_args\+=\(--allow-running-legacy-root-api\)/,
  );
  assert.match(preflight, /--allow-read-only-legacy-backup/);
  assert.match(preflight, /legacy_backup=pass services=healthy data_volumes=read_only/);
  assert.match(preflight, /API DATA VOLUME POLICY FAILED/);
  assert.match(preflight, /IDP MUTATION PREFLIGHT MODE IS UNAVAILABLE/);
  assert.doesNotMatch(preflight, /maintenance_api=exited maintenance_web=exited/);
});

test("release review records the observed 0777 production blocker", () => {
  const review = read("docs/codex/END_TO_END_REVIEW.md");
  assert.match(review, /API data-volume roots are owned by `0:0` with mode `0777`/);
  assert.match(review, /world-writable/);
  assert.match(review, /every descendant owned `1000:1000`/);
  assert.match(review, /No production write, cleanup, build/);
});
