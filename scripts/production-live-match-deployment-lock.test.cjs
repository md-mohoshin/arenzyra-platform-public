"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");

test("deploy and API use one conflicting advisory-lock key and scope", () => {
  const helper = read("scripts/production-live-match-deployment-lock.sh");
  const apiBoundary = read(
    "apps/api/src/common/db/production-deployment-activation-lock.util.ts",
  );
  const service = read(
    "apps/api/src/modules/match-control/match-control.service.ts",
  );
  const lockName = "arenzyra.production.activation.v1";

  assert.match(helper, /pg_advisory_lock\(/);
  assert.match(helper, /pg_advisory_unlock\(/);
  assert.match(apiBoundary, /pg_try_advisory_xact_lock_shared\(/);
  assert.equal((helper.match(new RegExp(lockName, "g")) ?? []).length, 1);
  assert.equal((apiBoundary.match(new RegExp(lockName, "g")) ?? []).length, 1);
  assert.match(
    service,
    /\$transaction\(async \(tx\) => \{\s*await assertProductionDeploymentActivationAvailable\(tx\);[\s\S]*?status: MatchStatus\.LIVE/,
  );
  assert.match(
    service,
    /\$transaction\(async \(tx\) => \{\s*if \(newControlState === 'COUNTDOWN'\) \{\s*await assertProductionDeploymentActivationAvailable\(tx\);/,
  );
});

test("reviewed deploy holds and revalidates the activation boundary through release", () => {
  const deploy = read("scripts/deploy-production.sh");
  const initialPreflight = deploy.indexOf(
    'bash scripts/production-deploy-preflight.sh "${guard_args[@]}"',
  );
  const initialQuiescence = deploy.indexOf(
    "verify_production_live_match_quiescence",
    initialPreflight,
  );
  const releaseArchive = deploy.indexOf("\nverify_release_archive_root\n");
  const acquire = deploy.indexOf("acquire_production_activation_lock");
  const firstRoutineBuild = deploy.indexOf(
    '"${compose[@]}" build api media-ai web',
  );
  const healthWait = deploy.lastIndexOf('wait_for_health "${services[@]}"');
  const finalBoundary = deploy.indexOf(
    "verify_production_activation_boundary",
    healthWait,
  );
  const currentPointer = deploy.indexOf(
    'write_release_pointer CURRENT "$new_release_id"',
  );
  const cleanup = deploy.indexOf("cleanup_runtime_files", currentPointer);

  assert.ok(initialPreflight >= 0);
  assert.ok(initialQuiescence > initialPreflight);
  assert.ok(releaseArchive > initialQuiescence);
  assert.ok(acquire > releaseArchive && acquire < firstRoutineBuild);
  assert.ok(finalBoundary > healthWait && finalBoundary < currentPointer);
  assert.ok(cleanup > currentPointer);
  assert.match(
    deploy,
    /cleanup_runtime_files\(\) \{[\s\S]*release_production_activation_lock/,
  );
  assert.match(
    deploy,
    /verify_production_activation_boundary\s+bash scripts\/production-deploy-preflight\.sh "\$\{guard_args\[@\]\}"\s+"\$\{compose\[@\]\}" build api media-ai web/,
  );
});

test("routine activation leaves PostgreSQL and Redis out of Compose recreation", () => {
  const deploy = read("scripts/deploy-production.sh");
  assert.match(
    deploy,
    /"\$\{compose\[@\]\}" up --no-build -d --pull never --no-deps \\\n+    api media-ai web proxy/,
  );
  assert.doesNotMatch(
    deploy,
    /up --no-build -d --pull never --no-deps[^\n]*postgres/,
  );
});

test("lock session is bounded, private, identity checked, and fail-closed", () => {
  const helper = read("scripts/production-live-match-deployment-lock.sh");
  assert.match(helper, /verify-production-database-container\.sh/);
  assert.match(helper, /mktemp -d \/run\/arenzyra-live-match-lock\.XXXXXX/);
  assert.match(helper, /mkfifo -m 600/);
  assert.match(helper, /chmod 700/);
  assert.match(helper, /statement_timeout=20000/);
  assert.match(helper, /lock_timeout=15000/);
  assert.match(helper, /read -r -t 20/);
  assert.match(helper, /kill -0/);
  assert.match(helper, /count\(\*\) = 1/);
  assert.doesNotMatch(helper, /cat .*error|tail .*error|rm -rf|docker system prune/);
});

test("the aggregate SQL is included as reviewed release source", () => {
  const ignore = read(".gitignore");
  const metadata = read("scripts/create-publish-release-metadata.cjs");
  const reviewedSql = "infra/sql/production-live-match-quiescence.sql";
  assert.match(ignore, /!infra\/sql\/production-live-match-quiescence\.sql/);
  assert.ok(metadata.includes(`"${reviewedSql}"`));
  assert.equal((metadata.match(new RegExp(reviewedSql.replaceAll("/", "\\/"), "g")) ?? []).length, 2);
});

test("candidate history must contain all deployed Root, API, and Web fixes", () => {
  const deploy = read("scripts/deploy-production.sh");
  const previousPointer = deploy.indexOf('prior_release_id="$(read_release_pointer CURRENT)"');
  const forwardGate = deploy.indexOf(
    "verify-production-forward-release.cjs",
    previousPointer,
  );
  const metadata = deploy.indexOf("create-publish-release-metadata.cjs");
  assert.ok(previousPointer >= 0);
  assert.ok(forwardGate > previousPointer && forwardGate < metadata);
  for (const component of ["ROOT", "API", "WEB"]) {
    assert.match(deploy, new RegExp(`--candidate-${component.toLowerCase()} "\\$ARENZYRA_REVIEWED_${component}_COMMIT"`));
  }
});
