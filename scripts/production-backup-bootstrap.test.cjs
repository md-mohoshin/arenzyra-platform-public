"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  HELPER_IMAGE,
  BACKUP_ROOT,
  REMOTE,
  updateEnvText,
} = require("./configure-production-backup-env.cjs");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const recipient = `age1${"a".repeat(58)}`;

test("backup env update is additive, exact, and idempotent", () => {
  const legacyRecipient = `age1${"b".repeat(58)}`;
  const initial =
    "PUBLIC_WEB_HOST=arenzyra.com\n" +
    `ARENZYRA_BACKUP_AGE_RECIPIENT=${legacyRecipient}\n` +
    "ARENZYRA_BACKUP_RCLONE_REMOTE=legacy-remote:preserved\n" +
    "ARENZYRA_BACKUP_ROOT=/opt/arenzyra-backups\n";
  const once = updateEnvText(initial, recipient);
  const twice = updateEnvText(once, recipient);
  assert.equal(once, twice);
  assert.match(once, new RegExp(`ARENZYRA_RECOVERY_V1_AGE_RECIPIENT=${recipient}`));
  assert.match(once, new RegExp(`ARENZYRA_RECOVERY_V1_RCLONE_REMOTE=${REMOTE}`));
  assert.match(once, new RegExp(`ARENZYRA_RECOVERY_V1_ROOT=${BACKUP_ROOT}`));
  assert.equal(once.includes(`ARENZYRA_RECOVERY_V1_HELPER_IMAGE=${HELPER_IMAGE}`), true);
  assert.match(once, new RegExp(`ARENZYRA_BACKUP_AGE_RECIPIENT=${legacyRecipient}`));
  assert.match(once, /ARENZYRA_BACKUP_RCLONE_REMOTE=legacy-remote:preserved/);
  assert.match(once, /ARENZYRA_BACKUP_ROOT=\/opt\/arenzyra-backups/);
  assert.equal(once.includes("PUBLIC_WEB_HOST=arenzyra.com"), true);
});

test("backup env update rejects replacement, duplicate, and invalid recipient", () => {
  assert.throws(
    () =>
      updateEnvText(
        "ARENZYRA_RECOVERY_V1_RCLONE_REMOTE=somewhere-else:path\n",
        recipient,
      ),
    /different non-empty value/,
  );
  assert.throws(
    () =>
      updateEnvText(
        "ARENZYRA_RECOVERY_V1_ROOT=\nARENZYRA_RECOVERY_V1_ROOT=\n",
        recipient,
      ),
    /duplicated/,
  );
  assert.throws(() => updateEnvText("A=B\n", "age1invalid"), /recipient is invalid/);
});

test("legacy backup settings are preserved byte-for-byte", () => {
  const oldRecipient = `age1${"b".repeat(58)}`;
  const legacy =
    `ARENZYRA_BACKUP_AGE_RECIPIENT=${oldRecipient}\n` +
    "ARENZYRA_BACKUP_RCLONE_REMOTE=unknown-existing:backup\n" +
    "ARENZYRA_BACKUP_ROOT=/srv/legacy-backups\n";
  const updated = updateEnvText(legacy, recipient);
  assert.equal(updated.startsWith(legacy), true);
  assert.match(updated, new RegExp(`ARENZYRA_RECOVERY_V1_AGE_RECIPIENT=${recipient}`));
});

test("backup bootstrap is preflighted, hash pinned, descriptor-only, and non-service-mutating", () => {
  const configure = read("scripts/configure-production-backup.sh");
  const sharedLock = configure.indexOf("source scripts/acquire-production-deploy-lock.sh");
  const firstPreflight = configure.indexOf(
    "production-deploy-preflight.sh --allow-read-only-legacy-backup",
  );
  const firstInstall = configure.indexOf('install_tool age');
  const probeUpload = configure.indexOf('rclone copyto "$RUN_ROOT/probe.bin.age"');
  const secondPreflight = configure.lastIndexOf(
    "production-deploy-preflight.sh --allow-read-only-legacy-backup",
  );
  const helperPull = configure.indexOf('docker pull "$HELPER_IMAGE"');
  const envMutation = configure.indexOf("configure-production-backup-env.cjs");
  assert.ok(sharedLock >= 0 && sharedLock < firstPreflight);
  assert.ok(firstPreflight < firstInstall);
  assert.ok(firstInstall < probeUpload);
  assert.ok(probeUpload < secondPreflight && secondPreflight < helperPull);
  assert.ok(helperPull < envMutation);
  assert.match(configure, /AGE_SHA256="[0-9a-f]{64}"/);
  assert.match(configure, /RCLONE_SHA256="[0-9a-f]{64}"/);
  assert.match(configure, /\/proc\/self\/fd\/3/);
  assert.match(configure, /read -r secret_access_key <&3/);
  assert.match(configure, /credential rotation requires a separately reviewed action/);
  assert.match(configure, /--immutable --no-traverse --s3-no-check-bucket/);
  assert.match(configure, /sha256sum "\$RUN_ROOT\/downloaded\.bin\.age"/);
  assert.match(configure, /MANAGED_BACKUP_ROOT="\/opt\/arenzyra-backups\/encrypted-v1"/);
  assert.match(configure, /existing managed backup prevents initial recovery configuration/);
  assert.match(configure, /backup_lock_identity" = "0:0:600:1:0"/);
  assert.match(configure, /non-probe off-host object prevents initial recovery configuration/);
  assert.match(configure, /--preserve-legacy-backup-config/);
  assert.doesNotMatch(configure, /docker\s+(?:compose|restart|start|stop|rm)\b/);
});

test("backup inventory is bounded, sanitized, read-only, and lock aware", () => {
  const inventory = read("scripts/production-backup-inventory.sh");
  const launcher = read("scripts/production-reviewed-entrypoint.sh");
  const lock = inventory.indexOf("source scripts/acquire-production-deploy-lock.sh");
  const preflight = inventory.indexOf(
    "production-deploy-preflight.sh --allow-read-only-legacy-backup",
  );
  assert.ok(lock >= 0 && lock < preflight);
  assert.match(inventory, /BACKUP_ROOT="\/opt\/arenzyra-backups"/);
  assert.match(inventory, /BACKUP_CONFIG_INVENTORY recipient=%s remote=%s root=%s/);
  assert.match(inventory, /MANAGED_RECOVERY_INVENTORY recipient=%s remote=%s root=%s/);
  assert.match(inventory, /recipient_state="placeholder-or-other"/);
  assert.match(inventory, /remote_state="other"/);
  assert.match(inventory, /root_state="other"/);
  assert.match(inventory, /safe_regular_file "\$entry" 0/);
  assert.match(inventory, /completed_sets=/);
  assert.match(inventory, /incomplete_sets=/);
  assert.match(inventory, /unexpected_entries=/);
  assert.match(inventory, /unexpected_children=/);
  assert.match(inventory, /lock_only=/);
  assert.doesNotMatch(inventory, /cat\s|head\s|tail\s|docker\s+(?:compose|run|exec|pull|restart|start|stop|rm)\b/);
  assert.match(
    launcher,
    /backup-inventory\)[\s\S]*backup-inventory accepts no arguments[\s\S]*production-backup-inventory\.sh/,
  );
});

test("credential loader accepts only the root-only fixed private B2 policy", () => {
  const loader = read("scripts/load-production-backup-rclone-env.sh");
  assert.match(loader, /\/etc\/arenzyra-backup-rclone\.env/);
  assert.match(loader, /stat -Lc '%u:%g:%a:%h:%s'/);
  assert.match(loader, /backup_rclone_uid" != "0"/);
  assert.match(loader, /backup_rclone_gid" != "0"/);
  assert.match(loader, /backup_rclone_mode" != "600"/);
  assert.match(loader, /backup_rclone_links" != "1"/);
  assert.match(loader, /s3\.eu-central-003\.backblazeb2\.com/);
  assert.match(loader, /RCLONE_CONFIG_ARENZYRAB2_ACL.*private/s);
  assert.match(loader, /RCLONE_CONFIG_ARENZYRAB2_NO_CHECK_BUCKET.*true/s);
  assert.doesNotMatch(loader, /\bsource\s+"?\$BACKUP_RCLONE_ENV_FILE/);
});

test("legacy backup is a narrow read-only profile and normal backup remains strict", () => {
  const backup = read("scripts/production-backup.sh");
  const deploy = read("scripts/deploy-production.sh");
  const launcher = read("scripts/production-reviewed-entrypoint.sh");
  const lock = read("scripts/acquire-production-deploy-lock.sh");
  const verifier = read("scripts/verify-production-database-container.sh");
  const preflight = read("scripts/production-deploy-preflight.sh");
  const legacyPreflight = backup.indexOf(
    "production-deploy-preflight.sh\" --allow-read-only-legacy-backup",
  );
  const backupDirectory = backup.indexOf("mkdir -p -- \"$BACKUP_ROOT\"");
  const databaseDump = backup.indexOf("pg_dump -U");
  const backupLock = backup.indexOf("source \"$SCRIPT_DIR/acquire-production-deploy-lock.sh\"");
  assert.ok(backupLock >= 0 && backupLock < legacyPreflight);
  assert.ok(legacyPreflight >= 0 && legacyPreflight < backupDirectory);
  assert.ok(legacyPreflight < databaseDump);
  assert.match(backup, /else\n  bash "\$SCRIPT_DIR\/production-deploy-preflight\.sh"\n/);
  assert.match(backup, /--allow-running-legacy-backup/);
  assert.match(backup, /load-production-backup-rclone-env\.sh/);
  assert.match(
    backup,
    /BACKUP_ROOT="\$\{ARENZYRA_RECOVERY_V1_ROOT:-\$\{ARENZYRA_BACKUP_ROOT/,
  );
  assert.match(
    backup,
    /AGE_RECIPIENT="\$\{ARENZYRA_RECOVERY_V1_AGE_RECIPIENT:-\$\{ARENZYRA_BACKUP_AGE_RECIPIENT/,
  );
  assert.match(
    backup,
    /RCLONE_REMOTE="\$\{ARENZYRA_RECOVERY_V1_RCLONE_REMOTE:-\$\{ARENZYRA_BACKUP_RCLONE_REMOTE/,
  );
  assert.match(
    launcher,
    /backup\)[\s\S]*ARENZYRA_BACKUP_REQUIRE_OFFSITE=1[\s\S]*production-backup\.sh/,
  );
  assert.match(
    launcher,
    /backup-legacy\)[\s\S]*ARENZYRA_BACKUP_REQUIRE_OFFSITE=1[\s\S]*--allow-running-legacy-backup/,
  );
  assert.match(verifier, /expected_runtime_image="postgres:16-alpine"/);
  assert.match(verifier, /expected_runtime_version_num="160013"/);
  assert.match(verifier, /expected_runtime_image="\$EXPECTED_POSTGRES_IMAGE"/);
  assert.match(preflight, /--allow-read-only-legacy-backup/);
  assert.match(preflight, /does not authorize a build, pull, recreate, restart/);
  assert.match(
    preflight,
    /ALLOW_READ_ONLY_LEGACY_BACKUP[\s\S]*service" = "proxy"[\s\S]*not-configured/,
  );
  assert.match(lock, /\/run\/arenzyra-production-deploy\.lock/);
  assert.match(lock, /ARENZYRA_DEPLOY_LOCK_INHERITED/);
  assert.match(lock, /flock -w "\$PRODUCTION_DEPLOY_LOCK_TIMEOUT_SECONDS" 8/);
  assert.match(deploy, /"ARENZYRA_DEPLOY_LOCK_INHERITED=1"/);
});
