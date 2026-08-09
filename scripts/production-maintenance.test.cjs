"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  hasVerifiedRecoveryMarkers,
  runMaintenance,
  selectBackupEntriesToPrune,
} = require("./production-maintenance.cjs");

test("disk inspection failure causes zero cleanup mutations", async () => {
  let builderPrunes = 0;
  let backupPrunes = 0;
  const alerts = [];
  const status = await runMaintenance({
    inspectDisk: () => null,
    pruneBuilder: () => {
      builderPrunes += 1;
    },
    pruneBackups: () => {
      backupPrunes += 1;
    },
    alert: async (message) => alerts.push(message),
  });

  assert.equal(status, 3);
  assert.equal(builderPrunes, 0);
  assert.equal(backupPrunes, 0);
  assert.equal(alerts.length, 1);
});

test("retention always preserves the newest verified recovery point", () => {
  const entries = [
    { entryPath: "/backups/old-verified", mtimeMs: 10, verified: true },
    { entryPath: "/backups/new-verified", mtimeMs: 20, verified: true },
    { entryPath: "/backups/newer-unverified", mtimeMs: 30, verified: false },
  ];
  const pruned = selectBackupEntriesToPrune(entries, 100).map(
    (entry) => entry.entryPath,
  );
  assert.deepEqual(pruned, ["/backups/old-verified"]);
  assert.equal(pruned.includes("/backups/new-verified"), false);
  assert.equal(pruned.includes("/backups/newer-unverified"), false);
});

test("retention never selects a backup without both verification markers", () => {
  const entries = [
    { entryPath: "/backups/offsite-only", mtimeMs: 10, verified: false },
    { entryPath: "/backups/drill-only", mtimeMs: 20, verified: false },
  ];

  assert.deepEqual(selectBackupEntriesToPrune(entries, 100), []);
});

test("verification evidence requires two nonempty regular marker files", (t) => {
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-markers-"));
  t.after(() => fs.rmSync(backup, { recursive: true, force: true }));

  fs.writeFileSync(path.join(backup, "OFFSITE_VERIFIED"), "verified\n");
  assert.equal(hasVerifiedRecoveryMarkers(backup), false);

  fs.writeFileSync(path.join(backup, "RESTORE_DRILL_VERIFIED"), "drilled\n");
  assert.equal(hasVerifiedRecoveryMarkers(backup), true);

  fs.rmSync(path.join(backup, "RESTORE_DRILL_VERIFIED"));
  fs.symlinkSync(
    path.join(backup, "OFFSITE_VERIFIED"),
    path.join(backup, "RESTORE_DRILL_VERIFIED"),
  );
  assert.equal(hasVerifiedRecoveryMarkers(backup), false);
});

test("maintenance is reachable only through the reviewed dispatcher", () => {
  const repositoryRoot = path.resolve(__dirname, "..");
  const wrapper = fs.readFileSync(
    path.join(repositoryRoot, "scripts", "production-maintenance.sh"),
    "utf8",
  );
  const cron = fs.readFileSync(
    path.join(repositoryRoot, "infra", "arenzyra-maintenance.cron"),
    "utf8",
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
  );

  assert.match(wrapper, /EXPECTED_ROOT="\/opt\/arenzyra"/);
  assert.match(wrapper, /require-local-production-docker\.sh/);
  assert.match(wrapper, /exec node scripts\/production-maintenance\.cjs/);
  assert.doesNotMatch(wrapper, /\brm\s+-rf\b|docker builder prune/);
  assert.match(cron, /INTENTIONALLY NON-EXECUTABLE TEMPLATE/);
  assert.match(cron, /production_entry host-maintenance \[--check-only\]/);
  assert.doesNotMatch(cron, /^(?!#).*production-maintenance\.sh/m);
  assert.match(
    manifest.scripts["deploy:maintenance"],
    /^node scripts\/blocked-production-mutation-entrypoint\.cjs /,
  );
});
