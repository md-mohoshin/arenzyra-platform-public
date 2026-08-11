"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function legacyBranch() {
  const deploy = read("scripts/deploy-production.sh");
  const start = deploy.indexOf(
    "else\n  # One-time forward-only conversion of the exact reviewed legacy profile.",
  );
  const end = deploy.indexOf("\nfi\n\nverify_running_release_images", start);
  assert.ok(start >= 0 && end > start);
  return deploy.slice(start, end);
}

test("reviewed launcher exposes an argument-free one-time legacy cutover", () => {
  const launcher = read("scripts/production-reviewed-entrypoint.sh");
  assert.match(
    launcher,
    /legacy-cutover\)\s*\n\s*\[ "\$#" -eq 0 \][\s\S]*require_nested_assembly[\s\S]*exec \/bin\/bash scripts\/deploy-production\.sh --legacy-cutover/,
  );
});

test("legacy cutover completes immutable images and a fresh off-site backup before stopping writers", () => {
  const branch = legacyBranch();
  const apiBuild = branch.indexOf('"${compose[@]}" build api media-ai web');
  const botBuild = branch.indexOf(
    '"${compose[@]}" --profile discord-bot build discord-bot',
  );
  const pin = branch.indexOf("create_pinned_compose_override legacy-cutover");
  const pull = branch.indexOf('"${compose[@]}" pull postgres redis proxy');
  const backup = branch.indexOf("create_pre_migration_backup");
  const stop = branch.indexOf(
    '"${compose[@]}" --profile discord-bot stop -t 60',
  );
  assert.ok(apiBuild >= 0 && apiBuild < botBuild);
  assert.ok(botBuild < pin && pin < pull && pull < backup && backup < stop);
  assert.match(
    branch.slice(pull, stop),
    /create_pre_migration_backup[\s\S]*verify-production-entitlement-invariants\.sh[\s\\]*\n\s*--allow-running-legacy-cutover[\s\S]*production-deploy-preflight\.sh/,
  );
  assert.match(
    read("scripts/deploy-production.sh"),
    /ARENZYRA_BACKUP_REQUIRE_OFFSITE=1/,
  );
});

test("legacy cutover preserves volumes and fences all writers through migrations and IDP closure", () => {
  const branch = legacyBranch();
  const stop = branch.indexOf(" stop -t 60");
  const partialAdoption = branch.indexOf("--legacy-cutover-partial");
  const remediation = branch.indexOf(
    "production-api-data-volume-remediation.sh",
  );
  const down = branch.indexOf(" down --remove-orphans");
  const transitionUp = branch.indexOf(
    '"${compose[@]}" up --no-build -d --pull never postgres redis',
  );
  const engage = branch.indexOf("--engage --release-id");
  const ledgerReconcile = branch.indexOf(
    "reconcile-production-legacy-prisma-ledger.sh",
  );
  const entitlementPostcondition = branch.indexOf(
    "verify-production-entitlement-invariants.sh",
    ledgerReconcile,
  );
  const apiMigration = branch.indexOf("api-migrate", engage);
  const studioMigration = branch.indexOf("studio-migrate", apiMigration);
  const idpApply = branch.indexOf("run_idp_cutover_action apply");
  const idpValidate = branch.indexOf("run_idp_cutover_action validate");
  const idpDryRun = branch.indexOf("run_idp_cutover_action dry-run");
  const release = branch.indexOf("--release --release-id");
  const applicationUp = branch.indexOf(
    '"${compose[@]}" up --no-build -d --pull never',
    transitionUp + 1,
  );
  assert.ok(
    stop < partialAdoption &&
      partialAdoption < remediation &&
      remediation < down &&
      down < transitionUp &&
      transitionUp < engage &&
      engage < ledgerReconcile &&
      ledgerReconcile < entitlementPostcondition &&
      entitlementPostcondition < apiMigration &&
      apiMigration < studioMigration &&
      studioMigration < idpApply &&
      idpApply < idpValidate &&
      idpValidate < idpDryRun &&
      idpDryRun < release &&
      release < applicationUp,
  );
  assert.doesNotMatch(branch, /down[^\n]*(?:--volumes|-v(?:\s|$))/);
  assert.doesNotMatch(
    branch,
    /docker\s+system\s+prune|docker\s+volume\s+(?:prune|rm)/,
  );
  assert.match(
    read("scripts/production-database-writer-fence.sh"),
    /ALTER ROLE :"api_runtime_role" :role_action;[\s\S]*ALTER ROLE :"studio_runtime_role" :role_action;[\s\S]*pg_terminate_backend/,
  );
});

test("legacy entitlement and zero-step ledger reconciliation is exact, fenced, and operation-adjacent", () => {
  const reconcile = read("scripts/reconcile-production-legacy-prisma-ledger.sh");
  const preflight = reconcile.indexOf(
    "production-deploy-preflight.sh --allow-cutover-transition",
  );
  const write = reconcile.indexOf('UPDATE "_prisma_migrations"', preflight);
  assert.ok(preflight >= 0 && write > preflight);
  assert.match(
    reconcile,
    /EXPECTED_MIGRATION="20260308132829_widget_instance_permanent_keys"/,
  );
  assert.match(
    reconcile,
    /EXPECTED_CHECKSUM="c573af92b312df565eaf1d490dfafa3d6cc8a20220c87f39d659a62826628163"/,
  );
  assert.match(reconcile, /writer-fence marker/);
  assert.match(reconcile, /postgres_schema="\$\{database_binding\[4\]\}"/);
  assert.doesNotMatch(reconcile, /read-dotenv-value\.cjs[^\n]*POSTGRES_SCHEMA/);
  assert.match(reconcile, /bool_and\(NOT rolcanlogin\)/);
  assert.match(reconcile, /pg_stat_activity/);
  assert.match(reconcile, /pg_prepared_xacts/);
  assert.match(reconcile, /stale_active_trial BETWEEN 0 AND 4096/);
  assert.match(
    reconcile,
    /UPDATE "Organization"[\s\S]*SET "trialEndsAt" = NULL/,
  );
  assert.doesNotMatch(
    reconcile,
    /SET\s+"(?:subscriptionStatus|paidUntil|updatedAt)"\s*=/,
  );
  assert.match(reconcile, /LEGACY_ENTITLEMENT_RECONCILED before=/);
  assert.match(reconcile, /attname = 'widgetKey'/);
  assert.match(reconcile, /attname = 'widgetType'/);
  assert.match(reconcile, /WidgetInstance_widgetKey_idx/);
  assert.match(
    reconcile,
    /WidgetInstance_organizationId_widgetKey_key/,
  );
  assert.match(
    reconcile,
    /SET applied_steps_count = 1[\s\S]*applied_steps_count = 0/,
  );
  assert.match(reconcile, /applied_steps_count IN \(0, 1\)/);
  assert.match(reconcile, /count\(\*\) <= 1 AS ledger_updated/);
  assert.doesNotMatch(
    reconcile,
    /DELETE\s+FROM\s+"_prisma_migrations"|SET\s+(?:checksum|finished_at|rolled_back_at)\s*=/i,
  );
});

test("every legacy Compose mutation has a same-session preflight and pinned-image attestation", () => {
  const branch = legacyBranch();
  const operations = [
    /production-deploy-preflight\.sh[^\n]*\n\s*"\$\{compose\[@\]\}" build api media-ai web/,
    /production-deploy-preflight\.sh[^\n]*\n\s*"\$\{compose\[@\]\}" --profile discord-bot build discord-bot/,
    /production-deploy-preflight\.sh[^\n]*\n\s*attest_pinned_compose_override\s*\n\s*"\$\{compose\[@\]\}" pull postgres redis proxy/,
    /production-deploy-preflight\.sh[^\n]*\n\s*attest_pinned_compose_override\s*\n\s*"\$\{compose\[@\]\}" --profile discord-bot stop/,
    /production-deploy-preflight\.sh --allow-cutover-stopped\s*\n\s*attest_pinned_compose_override\s*\n\s*"\$\{compose\[@\]\}" --profile discord-bot down/,
    /production-deploy-preflight\.sh --allow-cutover-transition\s*\n\s*attest_pinned_compose_override\s*\n\s*"\$\{compose\[@\]\}" up --no-build -d --pull never postgres redis/,
    /production-deploy-preflight\.sh --allow-cutover-transition\s*\n\s*attest_pinned_compose_override\s*\n\s*"\$\{compose\[@\]\}" --profile migration run[^\n]*api-migrate/,
    /production-deploy-preflight\.sh --allow-cutover-transition\s*\n\s*attest_pinned_compose_override\s*\n\s*"\$\{compose\[@\]\}" --profile migration run[^\n]*studio-migrate/,
  ];
  for (const operation of operations) assert.match(branch, operation);
});

test("cutover failure refuses to restart incompatible old writers", () => {
  const deploy = read("scripts/deploy-production.sh");
  assert.match(
    deploy,
    /if \[ "\$schema_change_possible" -eq 1 \]; then[\s\S]*Do not start an older API image[\s\S]*Keep incompatible old writers stopped/,
  );
  const partial = deploy.indexOf("--legacy-cutover-partial");
  const schemaBoundary = deploy.indexOf("schema_change_possible=1", partial);
  const engage = deploy.indexOf("--engage --release-id", schemaBoundary);
  assert.ok(partial < schemaBoundary && schemaBoundary < engage);
});
