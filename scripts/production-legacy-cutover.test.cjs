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
      engage < apiMigration &&
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
