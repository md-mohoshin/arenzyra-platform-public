#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("80-percent deploy preparation removes only old dangling build cache", () => {
  const helper = read("scripts/prepare-production-deploy-capacity.sh");
  assert.match(helper, /CLEANUP_THRESHOLD_PERCENT=80/);
  assert.match(helper, /OLD_BUILD_CACHE_AGE="168h"/);
  assert.match(helper, /ARENZYRA_DEPLOY_LOCK_INHERITED/);
  assert.match(helper, /source scripts\/acquire-production-deploy-lock\.sh/);
  assert.match(
    helper,
    /production-deploy-preflight\.sh[\s\S]*docker builder prune -f --filter "until=\$OLD_BUILD_CACHE_AGE"[\s\S]*production-deploy-preflight\.sh/,
  );
  assert.doesNotMatch(helper, /builder prune -af|image prune|system prune|volume prune/);
  assert.doesNotMatch(
    helper,
    /production-backup\.sh|release-production-backup\.sh|journalctl\b|\brm\s|find\s+[^\n]*-delete/,
  );
});

test("automatic capacity preparation runs only for build-producing routine modes", () => {
  const deploy = read("scripts/deploy-production.sh");
  assert.match(
    deploy,
    /if \[ "\$MODE" = "full" \] \|\| \[ "\$MODE" = "discord-bot" \] \|\| \\\s+\[ "\$MODE" = "api-recovery" \]; then\s+ARENZYRA_DEPLOY_LOCK_INHERITED=1 \\\s+bash scripts\/prepare-production-deploy-capacity\.sh/,
  );
  const preparation = deploy.indexOf(
    "bash scripts/prepare-production-deploy-capacity.sh",
  );
  const releaseArchive = deploy.indexOf("\nverify_release_archive_root\n");
  assert.ok(preparation >= 0 && preparation < releaseArchive);
});

test("routine deployment warns but does not require live-match quiescence", () => {
  const deploy = read("scripts/deploy-production.sh");
  assert.match(
    deploy,
    /case "\$MODE" in\s+full\|discord-bot\|api-recovery\)\s+production_live_match_warning_required=1/,
  );
  assert.doesNotMatch(
    deploy,
    /production_activation_interlock_required|acquire_production_activation_lock/,
  );
  assert.match(
    deploy,
    /LIVE MATCH DEPLOYMENT WARNING: routine deployment is allowed while matches are active/,
  );
  const webBranch = deploy.slice(
    deploy.indexOf('elif [ "$MODE" = "web-candidate" ]; then'),
    deploy.indexOf("else\n  # One-time forward-only conversion"),
  );
  assert.match(webBranch, /--no-deps --force-recreate web/);
  assert.match(webBranch, /non_web_runtime_fingerprint/);
  assert.doesNotMatch(
    webBranch,
    /"\$\{compose\[@\]\}" build|api-migrate|studio-migrate|create_pre_migration_backup/,
  );
});
