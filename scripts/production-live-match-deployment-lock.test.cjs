"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");

test("stale recovery and API use one conflicting advisory-lock key and scope", () => {
  const helper = read("scripts/production-live-match-deployment-lock.sh");
  const recovery = read("scripts/end-production-stale-global-control-matches.sh");
  const apiBoundary = read(
    "apps/api/src/common/db/production-deployment-activation-lock.util.ts",
  );
  const service = read(
    "apps/api/src/modules/match-control/match-control.service.ts",
  );
  const lockName = "arenzyra.production.activation.v1";

  assert.match(helper, /pg_advisory_lock\(/);
  assert.match(helper, /pg_advisory_unlock\(/);
  assert.match(recovery, /source scripts\/production-live-match-deployment-lock\.sh/);
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

test("routine deploy warns without taking the activation advisory lock", () => {
  const deploy = read("scripts/deploy-production.sh");
  const initialPreflight = deploy.indexOf(
    'bash scripts/production-deploy-preflight.sh "${guard_args[@]}"',
  );
  const initialWarning = deploy.indexOf(
    "warn_production_live_match_deployment",
    initialPreflight,
  );
  const releaseArchive = deploy.indexOf("\nverify_release_archive_root\n");

  assert.ok(initialPreflight >= 0);
  assert.ok(initialWarning > initialPreflight);
  assert.ok(releaseArchive > initialWarning);
  assert.match(
    deploy,
    /LIVE MATCH DEPLOYMENT WARNING: routine deployment is allowed while matches are active/,
  );
  assert.match(
    deploy,
    /verify_production_activation_boundary\(\) \{[\s\S]*?verify-production-retired-widget-compatibility\.sh\s+fi\s+if \[ "\$MODE" = "legacy-cutover" \]; then\s+verify_production_live_match_quiescence/,
  );
  assert.doesNotMatch(
    deploy,
    /acquire_production_activation_lock|verify_production_activation_lock|release_production_activation_lock/,
  );
  assert.doesNotMatch(
    deploy,
    /source scripts\/production-live-match-deployment-lock\.sh/,
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
  assert.match(
    deploy,
    /if \[ -z "\$prior_release_id" \][\s\S]*A VERIFIED MANAGED RELEASE BASELINE IS REQUIRED[\s\S]*Use the separately reviewed legacy\/adoption workflow/,
  );
  assert.match(
    deploy,
    /\[ "\$MODE" = "legacy-cutover" \][\s\S]*\[ "\$MODE" = "discord-bot" \][\s\S]*\[ "\$FIRST_DEPLOY" -eq 1 \]/,
  );
  for (const recoveryMode of [
    "legacy-cutover-resume",
    "legacy-cutover-resume-interrupted",
    "legacy-cutover-resume-transition",
  ]) {
    assert.match(deploy, new RegExp(`\\[ "\\$MODE" = "${recoveryMode}" \\]`));
  }
});
