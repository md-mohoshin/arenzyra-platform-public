"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");

test("full deploy verifies a fresh encrypted off-host backup before migrations", () => {
  const deploy = read("scripts/deploy-production.sh");
  const backupCall = deploy.lastIndexOf("create_pre_migration_backup");
  const preMigrationPreflight = deploy.indexOf(
    "bash scripts/production-deploy-preflight.sh",
    backupCall,
  );
  const apiMigration = deploy.indexOf("api-migrate", backupCall);
  const studioMigration = deploy.indexOf("studio-migrate", backupCall);

  assert.ok(
    backupCall >= 0,
    "full deploy should create a pre-migration backup",
  );
  assert.ok(
    preMigrationPreflight > backupCall,
    "the disk/service preflight must be repeated after backup creation",
  );
  assert.ok(
    apiMigration > preMigrationPreflight,
    "API migration must immediately follow the repeated preflight",
  );
  assert.ok(
    studioMigration > apiMigration,
    "Studio migration must follow API migration",
  );
  assert.match(deploy, /ARENZYRA_BACKUP_REQUIRE_OFFSITE=1/);
  assert.match(deploy, /PRE-MIGRATION BACKUP VERIFIED/);
  assert.match(
    deploy,
    /BACKUP_COMPLETE database\.dump\.age database-globals\.sql\.age metadata\.txt\.age manifest\.sha256\.age/,
  );
  assert.match(deploy, /marker_epoch.*backup_start_epoch/s);
});

test("routine deploy blocks pending old-writer-incompatible migrations before any release mutation", () => {
  const deploy = read("scripts/deploy-production.sh");
  const gate = deploy.indexOf("bash scripts/production-release-safety-gate.sh");
  const releaseArchiveMutation = deploy.lastIndexOf(
    "\nverify_release_archive_root\n",
  );
  const metadata = deploy.indexOf("create-publish-release-metadata.cjs");
  const build = deploy.indexOf('"${compose[@]}" build api media-ai web');

  assert.ok(gate >= 0);
  assert.ok(releaseArchiveMutation > gate);
  assert.ok(metadata > gate);
  assert.ok(build > gate);
  assert.doesNotMatch(deploy, /production-release-safety-gate\.sh --first-deploy/);

  const manifest = JSON.parse(
    read("infra/production-api-migration-safety.json"),
  );
  assert.equal(manifest.schemaVersion, 2);
  assert.deepEqual(
    manifest.contractMigrations.map(({ name }) => name),
    [
      "20260805021000_idp_encrypted_credential_storage",
      "20260809203000_secure_account_setup",
    ],
  );
  assert.deepEqual(
    manifest.dataImpactMigrations.map(({ name }) => name),
    [
      "20260805021000_idp_encrypted_credential_storage",
      "20260809203000_secure_account_setup",
    ],
  );
  assert.match(
    read("scripts/verify-production-migration-safety.cjs"),
    /unclassified-destructive-migrations/,
  );
  assert.match(
    read("scripts/verify-production-migration-safety.cjs"),
    /unclassified-data-impact-migrations/,
  );
});

test("full deploy verifies the canonical API image boundary before release mutation", () => {
  const deploy = read("scripts/deploy-production.sh");
  const imageBoundary = deploy.indexOf(
    '"${sanitized_environment[@]}" node scripts/verify-production-api-capabilities.cjs',
  );
  const publishPreflight = deploy.indexOf(
    "node scripts/preflight-publish.cjs --env infra/.env.publish",
  );
  const releaseArchiveMutation = deploy.lastIndexOf(
    "\nverify_release_archive_root\n",
  );
  const build = deploy.indexOf('"${compose[@]}" build api media-ai web');

  assert.ok(imageBoundary >= 0);
  assert.ok(publishPreflight > imageBoundary);
  assert.ok(releaseArchiveMutation > imageBoundary);
  assert.ok(build > imageBoundary);

  const adapter = read("scripts/verify-production-api-capabilities.cjs");
  assert.match(adapter, /verify-runtime-image-boundary\.cjs/);
  assert.match(adapter, /verifySourceBoundary/);
  assert.doesNotMatch(adapter, /verify-runtime-capabilities\.cjs/);
});

test("deploy trust-bootstrap verifies exact clean nested commits before checkout code", () => {
  const deploy = read("scripts/deploy-production.sh");
  const publish = read("infra/PUBLISH.md");
  const checkout = deploy.indexOf('cd "$resolved_root"');
  const bootstrap = deploy.indexOf(
    "verify_bootstrap_repository ROOT",
    checkout,
  );
  const firstSource = deploy.indexOf(
    "source scripts/require-local-production-docker.sh",
    checkout,
  );
  const firstNode = deploy.indexOf("node scripts/", checkout);

  assert.ok(checkout >= 0);
  assert.ok(bootstrap > checkout && bootstrap < firstSource);
  assert.ok(firstSource < firstNode);
  assert.match(deploy.slice(checkout, firstSource), /\/usr\/bin\/env -i/);
  assert.match(deploy.slice(checkout, firstSource), /\/usr\/bin\/git/);
  assert.match(deploy.slice(checkout, firstSource), /GIT_OPTIONAL_LOCKS=0/);
  assert.match(deploy.slice(checkout, firstSource), /GIT_NO_REPLACE_OBJECTS=1/);
  assert.match(deploy.slice(checkout, firstSource), /-c core\.fsmonitor=false/);
  assert.match(deploy.slice(checkout, firstSource), /--porcelain=v1 --untracked-files=all/);
  assert.match(deploy.slice(checkout, firstSource), /info\/grafts/);
  assert.match(deploy.slice(checkout, firstSource), /refs\/replace/);
  for (const component of ["ROOT", "API", "WEB"]) {
    assert.match(
      deploy.slice(checkout, firstSource),
      new RegExp(`ARENZYRA_REVIEWED_${component}_COMMIT`),
    );
  }
  assert.match(
    publish,
    /\/usr\/bin\/git[\s\S]*show[\s\S]*scripts\/production-reviewed-entrypoint\.sh[\s\S]*\/bin\/bash -s[\s\S]*production_entry deploy/,
  );
  assert.match(publish, /exact clean Root\/API\/Web (?:heads|assembly)/);
  assert.match(publish, /GIT_NO_REPLACE_OBJECTS=1/);
});

test("routine full deploy verifies canonical entitlements before every release mutation", () => {
  const deploy = read("scripts/deploy-production.sh");
  const initialSafetyPhase = deploy.indexOf("# Before release metadata");
  const entitlementGate = deploy.indexOf(
    "bash scripts/verify-production-entitlement-invariants.sh",
    initialSafetyPhase,
  );
  const releaseArchiveMutation = deploy.lastIndexOf(
    "\nverify_release_archive_root\n",
  );
  const metadata = deploy.indexOf("create-publish-release-metadata.cjs");
  const build = deploy.indexOf('"${compose[@]}" build api media-ai web');
  const backup = deploy.lastIndexOf("create_pre_migration_backup");
  const migration = deploy.indexOf("api-migrate", backup);

  assert.ok(entitlementGate > initialSafetyPhase);
  for (const mutation of [
    releaseArchiveMutation,
    metadata,
    build,
    backup,
    migration,
  ]) {
    assert.ok(mutation > entitlementGate);
  }
  assert.match(
    deploy.slice(initialSafetyPhase, releaseArchiveMutation),
    /if \[ "\$MODE" = "full" \]; then[\s\S]*verify-production-entitlement-invariants\.sh[\s\S]*fi/,
  );

  const gate = read("scripts/verify-production-entitlement-invariants.sh");
  const sql = gate.match(/<<'SQL'\r?\n([\s\S]*?)\r?\nSQL/);
  assert.ok(
    sql,
    "entitlement gate should contain one auditable aggregate query",
  );
  assert.match(gate, /default_transaction_read_only=on/);
  assert.match(gate, /ON_ERROR_STOP=1/);
  assert.match(gate, /verify-production-entitlement-invariants\.cjs/);
  assert.match(gate, /production-entitlement-inventory\.sql/);
  assert.match(gate, /parse-production-entitlement-inventory\.cjs/);
  assert.match(gate, /verify-production-entitlement-deployment\.cjs/);
  assert.match(sql[1], /FROM "Organization"/);
  assert.match(sql[1], /WHERE "deletedAt" IS NULL/);
  assert.match(
    sql[1],
    /status = 'ACTIVE'[\s\S]*"paidUntil" IS NULL[\s\S]*"trialEndsAt" IS NOT NULL/,
  );
  assert.match(
    sql[1],
    /status = 'TRIALING'[\s\S]*"trialEndsAt" IS NULL[\s\S]*"paidUntil" IS NOT NULL/,
  );
  assert.match(
    sql[1],
    /status = 'EXPIRED'[\s\S]*"paidUntil" IS NOT NULL[\s\S]*"trialEndsAt" IS NOT NULL/,
  );
  assert.doesNotMatch(sql[1], /CURRENT_TIMESTAMP/);
  assert.doesNotMatch(sql[1], /"(?:id|name|slug|email)"/i);
  assert.doesNotMatch(sql[1], /\b(?:UPDATE|INSERT|DELETE|TRUNCATE)\b/i);
});

test("both deploy modes preflight before archive or release metadata mutation", () => {
  const deploy = read("scripts/deploy-production.sh");
  const guardArguments = deploy.indexOf("guard_args=()");
  const initialPreflight = deploy.indexOf(
    'bash scripts/production-deploy-preflight.sh "${guard_args[@]}"',
    guardArguments,
  );
  const fullModeBranch = deploy.indexOf('if [ "$MODE" = "full" ]', initialPreflight);
  const archive = deploy.indexOf("\nverify_release_archive_root\n", initialPreflight);
  const metadata = deploy.indexOf("create-publish-release-metadata.cjs", archive);
  const discordBranch = deploy.indexOf('if [ "$MODE" = "discord-bot" ]', metadata);
  const repeatedDiscordPreflight = deploy.indexOf(
    'bash scripts/production-deploy-preflight.sh "${guard_args[@]}"',
    discordBranch,
  );
  const discordBuild = deploy.indexOf(
    '"${compose[@]}" --profile discord-bot build discord-bot',
    discordBranch,
  );

  assert.ok(guardArguments >= 0 && guardArguments < initialPreflight);
  assert.ok(initialPreflight < fullModeBranch);
  assert.ok(initialPreflight < archive && archive < metadata);
  assert.ok(repeatedDiscordPreflight > discordBranch);
  assert.ok(repeatedDiscordPreflight < discordBuild);
  assert.match(
    deploy.slice(guardArguments, initialPreflight),
    /FIRST_DEPLOY[\s\S]*guard_args\+?=\(--skip-health\)/,
  );
});

test("deploy binds Compose, gates, backup, runtimes, and migrators to one reviewed database", () => {
  const deploy = read("scripts/deploy-production.sh");
  assert.match(
    deploy,
    /reviewed_env_file="\$resolved_root\/infra\/\.env\.publish"/,
  );
  assert.match(deploy, /Process environment file differs from reviewed/);
  assert.match(deploy, /export ARENZYRA_DEPLOY_ENV_FILE="\$reviewed_env_file"/);
  assert.doesNotMatch(deploy, /for database_key in/);
  assert.doesNotMatch(deploy, /export "\$database_key"|export \$database_key/);
  assert.match(deploy, /-p "\$compose_project"/);
  assert.match(deploy, /--profile migration config --format json/);
  assert.match(deploy, /--assert-compose-json/);

  for (const script of [
    "scripts/production-release-safety-gate.sh",
    "scripts/verify-production-entitlement-invariants.sh",
    "scripts/verify-production-empty-target.sh",
    "scripts/production-backup.sh",
  ]) {
    assert.match(
      read(script),
      /verify-production-database-container\.sh/,
      script,
    );
  }

  const compose = read("infra/docker-compose.publish.yml");
  assert.match(compose, /DATABASE_URL: "\$\{DATABASE_URL:\?REQUIRED/);
  assert.match(compose, /DATABASE_URL: "\$\{MIGRATION_DATABASE_URL:\?REQUIRED/);
  assert.match(
    compose,
    /STUDIO_DATABASE_URL: "\$\{STUDIO_DATABASE_URL:\?REQUIRED/,
  );
  assert.match(
    compose,
    /STUDIO_MIGRATION_DATABASE_URL: "\$\{STUDIO_MIGRATION_DATABASE_URL:\?REQUIRED/,
  );
  assert.deepEqual(
    [...compose.matchAll(/^  (api-maintenance-[a-z0-9-]+):$/gm)].map(
      (match) => match[1],
    ),
    [
      "api-maintenance-idp-dry-run",
    ],
  );
  assert.doesNotMatch(compose, /api-maintenance-youtube/);
  assert.match(compose, /dist-maintenance\/scripts\/backfill-idp-credentials\.js/);

  const databaseContainer = read(
    "scripts/verify-production-database-container.sh",
  );
  const expectedImage = databaseContainer.match(
    /EXPECTED_POSTGRES_IMAGE="([^"]+)"/,
  )?.[1];
  assert.ok(expectedImage);
  assert.equal(compose.includes("image: " + expectedImage), true);
  assert.match(databaseContainer, /EXPECTED_POSTGRES_VERSION_NUM="160014"/);
  assert.match(databaseContainer, /EXPECTED_ROOT="\/opt\/arenzyra"/);
  assert.match(
    databaseContainer,
    /REVIEWED_ENV_FILE="\$REPOSITORY_ROOT\/infra\/\.env\.publish"/,
  );
  assert.match(databaseContainer, /ENV_FILE.*!=.*REVIEWED_ENV_FILE/s);
  assert.match(databaseContainer, /\$\{compose_project\}_postgres-data/);
  assert.match(databaseContainer, /\$\{compose_project\}_default/);
  assert.match(databaseContainer, /com\.docker\.compose\.volume/);
  assert.match(databaseContainer, /com\.docker\.compose\.network/);
  assert.match(databaseContainer, /\/var\/lib\/postgresql\/data/);
  assert.match(databaseContainer, /postgres_alias_found/);
  assert.match(databaseContainer, /local\|local\|0/);
  assert.match(databaseContainer, /bridge\|local/);
  assert.match(databaseContainer, /ARENZYRA_DOCKER_SUBNET/);
  assert.match(databaseContainer, /alias_endpoint_ids/);
  assert.match(databaseContainer, /selected_container_full_id/);
  assert.match(
    databaseContainer,
    /docker ps -a --no-trunc[\s\\]*\n[\s\S]*--filter "volume=\$\{expected_volume\}"/,
  );
  assert.match(databaseContainer, /volume_attachment_ids/);
  assert.match(databaseContainer, /\$\{#volume_attachment_ids\[@\]\}" -ne 1/);
  assert.match(
    databaseContainer,
    /\$\{volume_attachment_ids\[0\]:-\}" != "\$selected_container_full_id"/,
  );
  assert.match(databaseContainer, /\.HostConfig\.PublishAllPorts/);
  assert.match(databaseContainer, /\.HostConfig\.PortBindings/);
  assert.match(databaseContainer, /configured_port_policy" != "false\|0"/);
  assert.match(databaseContainer, /\.NetworkSettings\.Ports/);
  assert.match(databaseContainer, /\[ -n "\$runtime_published_ports" \]/);
  assert.match(databaseContainer, /has published host ports/);
});

test("physical Compose project and recovery destination cannot be overridden", () => {
  for (const script of [
    "scripts/deploy-production.sh",
    "scripts/production-compose-observe.sh",
    "scripts/production-deploy-preflight.sh",
    "scripts/verify-production-database-container.sh",
    "scripts/rollback-production-images.sh",
  ]) {
    const source = read(script);
    assert.match(
      source,
      /read-dotenv-value\.cjs[\s\S]*ARENZYRA_DEPLOY_COMPOSE_PROJECT/,
    );
    assert.match(
      source,
      /(?:override mismatch|differs from the reviewed production environment|COMPOSE PROJECT OVERRIDE MISMATCH)/i,
    );
  }

  for (const script of [
    "scripts/deploy-production.sh",
    "scripts/production-compose-observe.sh",
  ]) {
    assert.doesNotMatch(
      read(script),
      /ARENZYRA_ALLOW_NONSTANDARD_PRODUCTION_ROOT/,
      script,
    );
  }
  for (const script of [
    "scripts/deploy-production.sh",
    "scripts/rollback-production-images.sh",
  ]) {
    const source = read(script);
    assert.match(
      source,
      /EXPECTED_RELEASE_ARCHIVE_ROOT="\/opt\/arenzyra-release-metadata"/,
      script,
    );
    assert.match(
      source,
      /RELEASE_ARCHIVE_ROOT.*!=.*EXPECTED_RELEASE_ARCHIVE_ROOT/s,
      script,
    );
  }

  const backup = read("scripts/production-backup.sh");
  assert.match(backup, /bind_reviewed_backup_value/);
  for (const key of [
    "ARENZYRA_BACKUP_ROOT",
    "ARENZYRA_BACKUP_AGE_RECIPIENT",
    "ARENZYRA_BACKUP_RCLONE_REMOTE",
    "ARENZYRA_BACKUP_HELPER_IMAGE",
    "ARENZYRA_RECOVERY_V1_ROOT",
    "ARENZYRA_RECOVERY_V1_AGE_RECIPIENT",
    "ARENZYRA_RECOVERY_V1_RCLONE_REMOTE",
    "ARENZYRA_RECOVERY_V1_HELPER_IMAGE",
  ]) {
    assert.match(
      backup,
      new RegExp(`bind_reviewed_backup_value[\\s\\S]*${key}`),
    );
  }
});

test("release entrypoints reject path, HOME, timeout, archive, and metadata drift", () => {
  for (const script of [
    "scripts/deploy-production.sh",
    "scripts/rollback-production-images.sh",
    "scripts/production-compose-observe.sh",
  ]) {
    const source = read(script);
    assert.match(source, /SAFE_COMMAND_PATH="\/usr\/local\/sbin:/, script);
    assert.match(source, /export PATH="\$SAFE_COMMAND_PATH"/, script);
    assert.match(source, /id -u/, script);
    assert.match(source, /ambient_account_home.*safe_account_home/s, script);
    assert.doesNotMatch(source, /"PATH=\$PATH"|"HOME=\$\{HOME/, script);
  }

  for (const script of [
    "scripts/deploy-production.sh",
    "scripts/rollback-production-images.sh",
  ]) {
    const source = read(script);
    assert.match(source, /HEALTH_TIMEOUT_SECONDS=.*DEPLOY_HEALTH_TIMEOUT/);
    assert.match(source, /HEALTH_TIMEOUT_SECONDS" -lt 30/);
    assert.match(source, /HEALTH_TIMEOUT_SECONDS" -gt 1800/);
    assert.match(source, /SECONDS \+ 10#\$HEALTH_TIMEOUT_SECONDS/);
    assert.doesNotMatch(
      source,
      /\$\(\(SECONDS \+ \$\{ARENZYRA_DEPLOY_HEALTH_TIMEOUT_SECONDS/,
    );
    assert.match(source, /validate-publish-release-env\.cjs/);
    assert.match(source, /EXPECTED_RELEASE_ARCHIVE_ROOT/);
    assert.match(source, /stat -c '%u:%g:%a'/);
    assert.match(source, /mktemp -- "\$RELEASE_ARCHIVE_ROOT\/\./);
  }

  const deploy = read("scripts/deploy-production.sh");
  assert.match(
    deploy,
    /cmp -s -- "\$temporary_release_file" "\$archived_file"/,
  );
  assert.match(deploy, /ln -- "\$temporary_release_file" "\$archived_file"/);
  assert.match(deploy, /stat -c '%u:%g:%a:%h'/);
  assert.match(
    deploy,
    /release_env="\$RELEASE_ARCHIVE_ROOT\/\$new_release_id\.env"/,
  );
  assert.match(deploy, /--env-file "\$release_env"/);
  assert.doesNotMatch(deploy, /--env-file infra\/\.env\.release/);
  assert.match(deploy, /write_release_pointer CURRENT "\$new_release_id"/);

  const rollback = read("scripts/rollback-production-images.sh");
  assert.match(rollback, /--expected-release "\$RELEASE_ID"/);
  assert.match(rollback, /--assert-discord-compose-json/);
  assert.ok(
    rollback.indexOf("--assert-discord-compose-json") <
      rollback.indexOf("production-deploy-preflight.sh"),
  );
});

test("mutable release entrypoints harden the shared deployment lock identity", () => {
  for (const script of [
    "scripts/deploy-production.sh",
    "scripts/rollback-production-images.sh",
  ]) {
    const source = read(script);
    assert.match(
      source,
      /LOCK_FILE="\/run\/arenzyra-production-deploy\.lock"/,
      script,
    );
    assert.match(source, /verify_lock_directory_safety/, script);
    assert.match(source, /verify_lock_file_safety/, script);
    assert.match(source, /\[ -L "\$LOCK_FILE" \]/, script);
    assert.match(source, /stat -Lc '%d:%i:%h'/, script);
    assert.match(source, /"\/proc\/\$\$\/fd\/8"/, script);
    assert.match(source, /"\$\{lock_identity##\*:\}" != "1"/, script);
    assert.ok(
      source.indexOf("verify_lock_directory_safety") <
        source.indexOf('exec 8>"$LOCK_FILE"'),
      script,
    );
    assert.ok(
      source.indexOf('exec 8>"$LOCK_FILE"') <
        source.lastIndexOf("verify_lock_file_safety"),
      script,
    );
  }

  const rollback = read("scripts/rollback-production-images.sh");
  const acquired = rollback.indexOf('flock -w "$LOCK_TIMEOUT_SECONDS" 8');
  const currentRead = rollback.indexOf(
    'current="$(read_release_pointer CURRENT)"',
  );
  assert.ok(acquired >= 0);
  assert.ok(
    currentRead > acquired,
    "CURRENT must be read only after rollback owns the lock",
  );
  assert.ok(
    rollback.indexOf("verify_lock_file_safety", acquired) < currentRead,
    "rollback must re-attest the lock descriptor after flock",
  );
});

test("deploy archives immutable built-image identities before service mutation", () => {
  const deploy = read("scripts/deploy-production.sh");
  const helper = read("scripts/validate-release-image-manifest.cjs");
  const discordBuild = deploy.indexOf(
    '"${compose[@]}" --profile discord-bot build discord-bot',
  );
  const discordManifest = deploy.indexOf(
    "archive_built_image_manifest discord-bot",
    discordBuild,
  );
  const discordUp = deploy.indexOf(
    '"${compose[@]}" --profile discord-bot up',
    discordBuild,
  );
  const apiBuild = deploy.indexOf('"${compose[@]}" build api media-ai web');
  const apiManifest = deploy.indexOf(
    "archive_built_image_manifest api",
    apiBuild,
  );
  const webManifest = deploy.indexOf(
    "archive_built_image_manifest web",
    apiBuild,
  );
  const mediaManifest = deploy.indexOf(
    "archive_built_image_manifest media-ai",
    apiBuild,
  );
  const firstMigration = deploy.indexOf("api-migrate", apiBuild);

  assert.ok(discordBuild >= 0);
  assert.ok(discordManifest > discordBuild);
  assert.ok(discordUp > discordManifest);
  assert.ok(apiBuild >= 0);
  assert.ok(apiManifest > apiBuild);
  assert.ok(webManifest > apiManifest);
  assert.ok(mediaManifest > webManifest);
  assert.ok(firstMigration > mediaManifest);
  assert.match(deploy, /docker image inspect "\$image_reference"/);
  assert.match(deploy, /\$new_release_id\.\$\{service\}-image\.json/);
  assert.match(deploy, /stat -c '%u:%g:%a:%h'/);
  assert.match(deploy, /"0:0:600:1"/);
  assert.match(
    deploy,
    /cmp -s -- "\$temporary_manifest" "\$archived_manifest"/,
  );
  assert.match(deploy, /ln -- "\$temporary_manifest" "\$archived_manifest"/);
  assert.doesNotMatch(deploy, /mv[^\n]*"\$archived_manifest"/);
  assert.match(deploy, /--release-env "\$release_env"/);
  assert.match(deploy, /--expected-release "\$new_release_id"/);
  assert.match(helper, /MANIFEST_KEYS/);
  assert.match(helper, /REQUIRED_LABEL_KEYS/);
  assert.match(helper, /keys do not match the closed schema/);
  assert.match(helper, /releaseEnvironmentSha256/);
  assert.match(helper, /--print-image-id/);
  for (const service of ["api", "web", "media-ai", "discord-bot"]) {
    assert.match(helper, new RegExp(`"?${service.replace("-", "\\-")}"?`));
  }
});

test("mutable Compose operations consume only attested immutable image-ID overrides", () => {
  const deploy = read("scripts/deploy-production.sh");
  const rollback = read("scripts/rollback-production-images.sh");
  const override = read("scripts/production-pinned-image-override.cjs");

  for (const [service, image] of [
    ["api", "api"],
    ["api-migrate", "api"],
    ["web", "web"],
    ["studio-migrate", "web"],
    ["media-ai", "media-ai"],
    ["discord-bot", "discord-bot"],
  ]) {
    assert.match(
      override,
      new RegExp(
        `["']?${service.replace("-", "\\-")}["']?\\s*:\\s*["']${image.replace("-", "\\-")}["']`,
      ),
    );
  }
  assert.match(override, /keys do not match the closed schema/);
  assert.match(override, /Pinned Compose override is not canonical/);

  for (const source of [deploy, rollback]) {
    assert.match(source, /mktemp -- "\/run\/arenzyra-pinned-compose\./);
    assert.match(source, /stat -c '%u:%g:%a:%h'/);
    assert.match(source, /stat -Lc '%d:%i:%h'/);
    assert.match(source, /"\/proc\/\$\$\/fd\/9"/);
    assert.match(source, /pinned_override_digest/);
    assert.match(source, /--validate-stdin --print-sha256/);
    assert.match(source, /compose\+\=\( -f "\/proc\/\$\$\/fd\/9" \)/);
    assert.match(source, /attest_pinned_compose_override/);
    assert.doesNotMatch(source, /\bup\b(?![^\n]*--pull never)[^\n]*$/m);
  }

  assert.match(
    deploy,
    /attest_pinned_compose_override\s*\n\s*"\$\{compose\[@\]\}" --profile migration run --rm --no-deps --pull never api-migrate/,
  );
  assert.match(
    deploy,
    /attest_pinned_compose_override\s*\n\s*"\$\{compose\[@\]\}" --profile migration run --rm --no-deps --pull never studio-migrate/,
  );
  assert.match(
    deploy,
    /attest_pinned_compose_override\s*\n\s*"\$\{compose\[@\]\}" up --no-build -d --pull never/,
  );
  assert.match(
    rollback,
    /attest_pinned_compose_override\s*\n"\$\{compose\[@\]\}" --profile discord-bot up --no-build -d --pull never --no-deps discord-bot/,
  );
  assert.ok(
    deploy.lastIndexOf("verify_running_release_images") <
      deploy.indexOf("write_release_pointer CURRENT"),
  );
  assert.ok(
    rollback.lastIndexOf("verify_running_discord_image") <
      rollback.indexOf("write_release_pointer CURRENT"),
  );
});

test("Discord-only deploy and rollback never start or recreate dependencies", () => {
  const deploy = read("scripts/deploy-production.sh");
  const rollback = read("scripts/rollback-production-images.sh");
  const isolatedUp =
    /"\$\{compose\[@\]\}" --profile discord-bot up --no-build -d --pull never --no-deps discord-bot/;

  assert.match(deploy, isolatedUp);
  assert.match(rollback, isolatedUp);
  assert.equal(
    [...deploy.matchAll(/--profile discord-bot up[^\n]*/g)].every((match) =>
      /--no-deps discord-bot$/.test(match[0]),
    ),
    true,
  );
  assert.equal(
    [...rollback.matchAll(/--profile discord-bot up[^\n]*/g)].every((match) =>
      /--no-deps discord-bot$/.test(match[0]),
    ),
    true,
  );
});

test("post-build source provenance is recomputed exactly from a root-only checkout", () => {
  const deploy = read("scripts/deploy-production.sh");
  const sourceVerifier = read("scripts/verify-production-release-source.cjs");
  const metadata = read("scripts/create-publish-release-metadata.cjs");
  const checkoutSafety = deploy.indexOf(
    "node scripts/verify-production-release-source.cjs --check-checkout-only",
  );
  const metadataGeneration = deploy.indexOf(
    "node scripts/create-publish-release-metadata.cjs",
  );
  const verificationCalls = [
    ...deploy.matchAll(/verify_clean_release_source/g),
  ].map((match) => match.index);

  assert.ok(checkoutSafety >= 0);
  assert.ok(
    checkoutSafety < metadataGeneration,
    "checkout ownership and mode safety must be established before Git is invoked",
  );
  assert.equal(verificationCalls.length, 4);
  assert.ok(
    verificationCalls.some(
      (index) =>
        index > deploy.indexOf("build discord-bot") &&
        index < deploy.indexOf("archive_built_image_manifest discord-bot"),
    ),
  );
  assert.ok(
    verificationCalls.some(
      (index) =>
        index > deploy.indexOf("build api media-ai web") &&
        index < deploy.indexOf("archive_built_image_manifest api"),
    ),
  );
  assert.match(sourceVerifier, /EXPECTED_PRODUCTION_ROOT = "\/opt\/arenzyra"/);
  assert.match(sourceVerifier, /stat\.uid !== 0 \|\| stat\.gid !== 0/);
  assert.match(sourceVerifier, /\(stat\.mode & 0o022\) !== 0/);
  assert.match(sourceVerifier, /requireSingleLink/);
  assert.match(sourceVerifier, /must be a directory/);
  assert.match(sourceVerifier, /timingSafeEqual/);
  assert.match(sourceVerifier, /createReleaseMetadata\(\{/);
  assert.match(sourceVerifier, /authorizeReleaseProvenance\(recomputed\)/);
  assert.match(metadata, /Release input must not be a symbolic link/);
  assert.match(metadata, /"scripts",\s*\n\]\);/);
  assert.doesNotMatch(metadata, /"scripts\/[^"]+"/);
});

test("release pointer recovery documents the residual two-file atomicity gap", () => {
  const publish = read("infra/PUBLISH.md");
  assert.match(publish, /\/opt\/arenzyra-release-metadata/);
  assert.match(publish, /CURRENT[\s\S]*PREVIOUS[\s\S]*not\s+one\s+transaction/);
  assert.match(
    publish,
    /running container image IDs[\s\S]*archived\s+release manifests/,
  );
  assert.match(
    publish,
    /recovery hints, not authoritative transactional\s+state/,
  );
});

test("media AI image carries the same immutable release labels as other built images", () => {
  const dockerfile = read("apps/media-ai-service/Dockerfile");
  const compose = read("infra/docker-compose.publish.yml");
  for (const label of [
    "org.opencontainers.image.version",
    "org.opencontainers.image.revision",
    "org.opencontainers.image.created",
    "com.arenzyra.source-digest",
    "com.arenzyra.release-source",
  ]) {
    assert.match(dockerfile, new RegExp(label.replaceAll(".", "\\.")));
  }
  for (const argument of [
    "ARENZYRA_RELEASE_ID",
    "ARENZYRA_SOURCE_DIGEST",
    "ARENZYRA_GIT_COMMIT",
    "ARENZYRA_BUILD_AT",
    "ARENZYRA_BUILD_SOURCE",
  ]) {
    const mediaStart = compose.indexOf("  media-ai:");
    const webStart = compose.indexOf("  web:", mediaStart);
    assert.match(compose.slice(mediaStart, webStart), new RegExp(argument));
  }
});

test("production Docker commands are local-socket and ambient-env bound", () => {
  const dockerTarget = read("scripts/require-local-production-docker.sh");
  const processEnvironment = read(
    "scripts/require-clean-production-process-env.sh",
  );
  assert.match(processEnvironment, /BASH_ENV/);
  assert.match(processEnvironment, /\bENV\b/);
  assert.match(processEnvironment, /NODE_OPTIONS/);
  assert.match(processEnvironment, /NODE_PATH/);
  assert.match(processEnvironment, /\"\$\{!GIT_@\}\"/);
  assert.match(processEnvironment, /return 75/);
  assert.doesNotMatch(
    processEnvironment,
    /printf[^\n]*(?:NODE_OPTIONS|NODE_PATH|GIT_)[^\n]*\$\{?!/,
  );
  assert.ok(
    dockerTarget.indexOf("require-clean-production-process-env.sh") <
      dockerTarget.indexOf('expected_docker_host="'),
  );
  assert.match(dockerTarget, /unix:\/\/\/var\/run\/docker\.sock/);
  assert.match(dockerTarget, /DOCKER_HOST is not the reviewed local socket/);
  assert.match(dockerTarget, /DOCKER_CONTEXT is not default/);

  for (const script of [
    "scripts/deploy-production.sh",
    "scripts/production-compose-observe.sh",
    "scripts/production-deploy-preflight.sh",
    "scripts/production-backup.sh",
    "scripts/production-disk-guard.sh",
    "scripts/production-maintenance.sh",
    "scripts/production-release-safety-gate.sh",
    "scripts/production-restore-drill.sh",
    "scripts/verify-production-entitlement-invariants.sh",
    "scripts/verify-production-empty-target.sh",
    "scripts/rollback-production-images.sh",
  ]) {
    assert.match(read(script), /require-local-production-docker\.sh/, script);
  }
  for (const script of [
    "scripts/deploy-production.sh",
    "scripts/rollback-production-images.sh",
  ]) {
    const source = read(script);
    assert.match(source, /sanitized_environment=\([\s\S]*env -i/);
    assert.match(source, /compose=\([\s\S]*"\$\{sanitized_environment\[@\]\}"/);
  }
  const observe = read("scripts/production-compose-observe.sh");
  assert.match(
    observe,
    /read-dotenv-value\.cjs[\s\S]*ARENZYRA_DEPLOY_COMPOSE_PROJECT/,
  );
  assert.match(observe, /compose=\([\s\S]*env -i/);
  const diskGuard = read("scripts/production-disk-guard.sh");
  assert.match(diskGuard, /REPOSITORY_ROOT[\s\S]*\/opt\/arenzyra/);
  assert.match(
    diskGuard,
    /read-dotenv-value\.cjs[\s\S]*ARENZYRA_DEPLOY_COMPOSE_PROJECT/,
  );
  assert.match(diskGuard, /ALLOW_DEPLOY_BACKUP_PRUNE/);
  assert.match(
    diskGuard,
    /deploy-backup cleanup disabled; backups require separate explicit operator review/,
  );
});

test("production process override guard precedes Node and Git provenance calls", () => {
  for (const script of [
    "scripts/deploy-production.sh",
    "scripts/rollback-production-images.sh",
    "scripts/production-compose-observe.sh",
    "scripts/production-deploy-preflight.sh",
    "scripts/production-release-safety-gate.sh",
    "scripts/verify-production-empty-target.sh",
    "scripts/verify-production-entitlement-invariants.sh",
    "scripts/verify-production-database-roles.sh",
    "scripts/provision-production-database-roles.sh",
    "scripts/production-backup.sh",
    "scripts/verify-production-database-container.sh",
  ]) {
    const source = read(script);
    const guard = source.indexOf("require-local-production-docker.sh");
    const nodeOrGit = source.search(
      /(?:^|\n)\s*(?:[^\n|]+\|\s*)?(?:node|git)\s/m,
    );

    assert.ok(guard >= 0, `${script} must source the process override guard`);
    assert.ok(
      nodeOrGit < 0 || guard < nodeOrGit,
      `${script} must reject process overrides before Node or Git`,
    );
  }
});

test("production read-only database gates fail within bounded time", () => {
  for (const script of [
    "scripts/production-release-safety-gate.sh",
    "scripts/verify-production-database-container.sh",
    "scripts/verify-production-entitlement-invariants.sh",
    "scripts/verify-production-empty-target.sh",
  ]) {
    const source = read(script);
    assert.match(source, /PGCONNECT_TIMEOUT=10/, script);
    assert.match(source, /statement_timeout=30000/, script);
    assert.match(source, /lock_timeout=5000/, script);
  }
});

test("entitlements are rechecked after backup, before cutover, and after health", () => {
  const deploy = read("scripts/deploy-production.sh");
  const calls = [
    ...deploy.matchAll(
      /bash scripts\/verify-production-entitlement-invariants\.sh/g,
    ),
  ].map((match) => match.index);
  assert.equal(calls.length, 4);

  const backup = deploy.lastIndexOf("create_pre_migration_backup");
  const apiMigration = deploy.indexOf("api-migrate", backup);
  const studioMigration = deploy.indexOf("studio-migrate", apiMigration);
  const cutover = deploy.indexOf(
    '"${compose[@]}" up --no-build -d',
    studioMigration,
  );
  const health = deploy.lastIndexOf('wait_for_health "${services[@]}"');
  assert.ok(calls.some((index) => index > backup && index < apiMigration));
  assert.ok(calls.some((index) => index > studioMigration && index < cutover));
  assert.ok(calls.some((index) => index > health));
  assert.match(
    deploy.slice(backup, apiMigration),
    /production-deploy-preflight\.sh[\s\S]*verify-production-entitlement-invariants\.sh[\s\S]*production-deploy-preflight\.sh/,
  );
  assert.match(
    deploy.slice(studioMigration, cutover),
    /production-deploy-preflight\.sh[\s\S]*verify-production-entitlement-invariants\.sh[\s\S]*production-deploy-preflight\.sh/,
  );
});

test("normal full deploy rejects implicit first deployment before external action", () => {
  const deploy = read("scripts/deploy-production.sh");
  const block = deploy.indexOf(
    "DEPLOYMENT BLOCKED: FULL FIRST DEPLOY REQUIRES REVIEWED EMPTY-TARGET BOOTSTRAP",
  );
  const dockerGuard = deploy.indexOf(
    "source scripts/require-local-production-docker.sh",
  );
  assert.ok(block >= 0 && block < dockerGuard);
  assert.match(deploy, /normal deploy cannot implicitly migrate or validate/);
  assert.match(deploy, /No Docker, database, release, backup, or service action/);
  assert.doesNotMatch(deploy, /production-release-safety-gate\.sh --first-deploy/);
  assert.doesNotMatch(deploy, /--first-deploy-create-only/);
  assert.doesNotMatch(deploy, /ARENZYRA_OBJECT_POLICY_ALLOW_EMPTY=1/);
  assert.doesNotMatch(deploy, /verify-production-empty-target\.sh/);
});

test("database roles are verified before mutation, after migrations, before cutover, and after health", () => {
  const deploy = read("scripts/deploy-production.sh");
  const roleCalls = [
    ...deploy.matchAll(/bash scripts\/verify-production-database-roles\.sh/g),
  ].map((match) => match.index);
  const inheritedRoleCalls = [
    ...deploy.matchAll(
      /ARENZYRA_DEPLOY_LOCK_INHERITED=1\s*\\\r?\n(?:\s*ARENZYRA_OBJECT_POLICY_ALLOW_EMPTY=1\s*\\\r?\n)?\s*bash scripts\/verify-production-database-roles\.sh/g,
    ),
  ];
  const releaseMutation = deploy.lastIndexOf("\nverify_release_archive_root\n");
  const studioMigration = deploy.indexOf("studio-migrate");
  const cutover = deploy.indexOf(
    '"${compose[@]}" up --no-build -d',
    studioMigration,
  );
  const health = deploy.lastIndexOf('wait_for_health "${services[@]}"');
  const postMigrationProvision = deploy.indexOf(
    "provision-production-database-roles.sh",
    studioMigration,
  );
  const emptyObjectPolicyCalls = [
    ...deploy.matchAll(/ARENZYRA_OBJECT_POLICY_ALLOW_EMPTY=1/g),
  ].map((match) => match.index);

  assert.equal(roleCalls.length, 3);
  assert.equal(
    inheritedRoleCalls.length,
    roleCalls.length,
    "every in-deploy role verifier must inherit the already-held deployment lock",
  );
  assert.ok(roleCalls.some((index) => index < releaseMutation));
  assert.ok(postMigrationProvision > studioMigration);
  assert.ok(
    roleCalls.some(
      (index) => index > postMigrationProvision && index < cutover,
    ),
  );
  assert.ok(roleCalls.some((index) => index > health));
  assert.equal(emptyObjectPolicyCalls.length, 0);
  assert.match(
    deploy.slice(studioMigration, cutover),
    /production-deploy-preflight\.sh[\s\S]*provision-production-database-roles\.sh[\s\S]*verify-production-database-roles\.sh[\s\S]*production-deploy-preflight\.sh/,
  );
});

test("full release requires structural and compiled IDP evidence", () => {
  const deploy = read("scripts/deploy-production.sh");
  const releaseArchiveMutation = deploy.lastIndexOf(
    "\nverify_release_archive_root\n",
  );
  const initialGatePhase = deploy.indexOf("# Before release metadata");
  const firstIdpGate = deploy.indexOf(
    "bash scripts/verify-production-idp-encryption.sh",
    initialGatePhase,
  );

  assert.ok(firstIdpGate >= 0);
  assert.ok(releaseArchiveMutation > firstIdpGate);
  const imageBuild = deploy.indexOf('"${compose[@]}" build api media-ai web');
  const imageArchive = deploy.indexOf("archive_built_image_manifest api", imageBuild);
  const firstCompiled = deploy.indexOf("verify_compiled_idp_storage", imageArchive);
  const backup = deploy.lastIndexOf("create_pre_migration_backup");
  const health = deploy.lastIndexOf('wait_for_health "${services[@]}"');
  const finalCompiled = deploy.indexOf("verify_compiled_idp_storage", health);
  assert.ok(imageBuild > firstIdpGate);
  assert.ok(imageArchive > imageBuild);
  assert.ok(firstCompiled > imageArchive && firstCompiled < backup);
  assert.ok(finalCompiled > health);
  assert.equal(
    [...deploy.matchAll(/^\s*verify_compiled_idp_storage$/gm)].length,
    2,
  );

  const idpGateScript = read("scripts/verify-production-idp-encryption.sh");
  assert.match(idpGateScript, /IDP ENCRYPTION GATE BLOCKED/);
  assert.match(idpGateScript, /constraint_validated_count/);
  assert.match(idpGateScript, /legacy_count/);
  assert.match(idpGateScript, /verify-idp-credential-storage\.cjs/);

  const compiledGate = read("scripts/verify-production-idp-compiled.sh");
  assert.match(compiledGate, /ARENZYRA_DEPLOY_LOCK_INHERITED/);
  assert.match(compiledGate, /validate-release-image-manifest\.cjs/);
  assert.match(compiledGate, /verify-production-release-source\.cjs/);
  assert.match(compiledGate, /pg_catalog\.pg_control_system\(\)/);
  assert.match(compiledGate, /api-maintenance-idp-dry-run/);
  assert.match(compiledGate, /verify-idp-maintenance-summary\.cjs/);
  assert.match(compiledGate, /--require-clean/);

  const manifest = JSON.parse(
    read("infra/production-api-migration-safety.json"),
  );
  assert.ok(
    manifest.contractMigrations.some(
      ({ name }) => name === "20260805021000_idp_encrypted_credential_storage",
    ),
  );
  assert.ok(
    manifest.dataImpactMigrations.some(
      ({ name, impactKind }) =>
        name === "20260805021000_idp_encrypted_credential_storage" &&
        impactKind === "credential-encryption-backfill",
    ),
  );
});

test("restore drill extracts archives into isolated contained temporary targets", () => {
  const restore = read("scripts/production-restore-drill.sh");
  const listCheck = restore.indexOf("tar -tzf -");
  const extraction = restore.indexOf("tar -xozf -");
  const databaseRestore = restore.indexOf("pg_restore");

  assert.ok(listCheck >= 0);
  assert.ok(extraction > listCheck);
  assert.ok(databaseRestore > extraction);
  assert.match(
    restore,
    /mktemp -d \/tmp\/arenzyra-restore-drill-volumes\.XXXXXX/,
  );
  assert.match(restore, /--network none --read-only/);
  assert.match(restore, /--cap-drop ALL --security-opt no-new-privileges:true/);
  assert.match(
    restore,
    /type=bind,src=\$\{resolved_volume_target\},dst=\/restore,rw/,
  );
  assert.match(restore, /-type l -o -type b -o -type c -o -type p -o -type s/);
  assert.match(restore, /\/tmp\/arenzyra-restore-drill-volumes\.\*\)/);
  assert.match(restore, /extracted_volumes=%s/);
  assert.match(restore, /network_created=1/);
  assert.match(restore, /volume_created=1/);
  assert.match(restore, /container_created=1/);
  assert.match(restore, /od -An -N "\$bytes" -tx1 \/dev\/urandom/);
  assert.doesNotMatch(restore, /openssl rand/);
  assert.match(restore, /-e POSTGRES_PASSWORD[\s\\]*\n/);
  assert.doesNotMatch(restore, /-e POSTGRES_PASSWORD=/);
});

test("full-deploy failure guidance forbids image-only rollback once schema work starts", () => {
  const deploy = read("scripts/deploy-production.sh");
  assert.match(deploy, /schema_change_possible=1[\s\S]*api-migrate/);
  assert.match(
    deploy,
    /Do not start an older API image or perform an image-only rollback/,
  );
  assert.doesNotMatch(deploy, /Application-image rollback candidate/);
});

test("rollback helper blocks full old-image rollback before every mutable operation", () => {
  const rollback = read("scripts/rollback-production-images.sh");
  const fullBlock = rollback.indexOf('if [ "$MODE" != "discord-bot" ]');
  const checkoutSafety = rollback.indexOf(
    "node scripts/verify-production-release-source.cjs --check-checkout-only",
  );
  const lock = rollback.indexOf('exec 8>"$LOCK_FILE"');
  const preflight = rollback.indexOf("production-deploy-preflight.sh");
  const imageInspect = rollback.indexOf("docker image inspect");
  const composeUp = rollback.indexOf(
    '"${compose[@]}" --profile discord-bot up',
  );

  assert.ok(fullBlock >= 0);
  assert.ok(checkoutSafety > fullBlock);
  assert.ok(
    checkoutSafety < lock,
    "rollback checkout ownership and mode must be verified before lock mutation",
  );
  assert.ok(lock > fullBlock);
  assert.ok(preflight > fullBlock);
  assert.ok(imageInspect > fullBlock);
  assert.ok(composeUp > fullBlock);
  assert.match(rollback, /EXPECTED_ROOT="\/opt\/arenzyra"/);
  assert.match(rollback, /process environment file differs from reviewed/i);
  assert.match(
    rollback,
    /export ARENZYRA_DEPLOY_ENV_FILE="\$reviewed_env_file"/,
  );
  assert.match(
    rollback,
    /full application image-only rollback has no database-schema compatibility proof/,
  );
  assert.match(
    rollback,
    /reviewed forward recovery or coordinated database-and-application restore/,
  );
  assert.match(rollback, /-p "\$compose_project"/);
  assert.match(
    rollback,
    /"\$\{sanitized_environment\[@\]\}"\s*\\\r?\n\s*node scripts\/verify-production-release-source\.cjs --check-checkout-only/,
  );
  assert.doesNotMatch(
    rollback,
    /arenzyra-api:\$RELEASE_ID|arenzyra-web:\$RELEASE_ID|arenzyra-media-ai:\$RELEASE_ID/,
  );
});

test("Discord rollback starts from an exact clean committed Root wrapper", () => {
  const rollback = read("scripts/rollback-production-images.sh");
  const publish = read("infra/PUBLISH.md");
  const checkout = rollback.indexOf('cd "$resolved_root"');
  const rootHead = rollback.indexOf("ARENZYRA_REVIEWED_ROOT_COMMIT", checkout);
  const source = rollback.indexOf(
    "source scripts/require-local-production-docker.sh",
    checkout,
  );
  const checkoutOnly = rollback.indexOf(
    "verify-production-release-source.cjs --check-checkout-only",
    source,
  );

  assert.ok(checkout >= 0 && rootHead > checkout && rootHead < source);
  assert.ok(checkoutOnly > source);
  assert.match(rollback.slice(checkout, source), /\/usr\/bin\/env -i/);
  assert.match(rollback.slice(checkout, source), /\/usr\/bin\/git/);
  assert.match(rollback.slice(checkout, source), /GIT_NO_REPLACE_OBJECTS=1/);
  assert.match(rollback.slice(checkout, source), /--porcelain=v1 --untracked-files=all/);
  assert.match(rollback.slice(checkout, source), /refs\/replace/);
  assert.match(
    publish,
    /git[\s\S]*show[\s\S]*production-reviewed-entrypoint\.sh[\s\S]*production_entry rollback-discord/,
  );
  assert.match(publish, /ownership check is not content provenance/);
});

test("Discord rollback binds the archive, image labels, and running image ID", () => {
  const rollback = read("scripts/rollback-production-images.sh");
  const manifestRead = rollback.indexOf(
    'expected_discord_image_id="$(\n  verify_archived_discord_image_manifest',
  );
  const imageInspection = rollback.indexOf("docker image inspect");
  const manifestImageComparison = rollback.indexOf(
    '[ "$preflight_discord_image_id" != "$expected_discord_image_id" ]',
  );
  const productionPreflight = rollback.indexOf(
    "bash scripts/production-deploy-preflight.sh",
  );
  const composeUp = rollback.indexOf(
    '"${compose[@]}" --profile discord-bot up',
  );
  const firstRuntimeBinding = rollback.indexOf(
    "verify_running_discord_image",
    composeUp,
  );

  assert.match(
    rollback,
    /expected_manifest="\$RELEASE_ARCHIVE_ROOT\/\$expected_release\.discord-bot-image\.json"/,
  );
  assert.match(rollback, /stat -c '%u:%g:%a:%h'/);
  assert.match(rollback, /"0:0:600:1"/);
  assert.match(rollback, /validate-release-image-manifest\.cjs/);
  assert.match(rollback, /--release-env "\$release_environment"/);
  assert.match(rollback, /--expected-release "\$expected_release"/);
  assert.match(rollback, /--service discord-bot/);
  assert.match(rollback, /--print-image-id/);
  assert.match(
    rollback,
    /preflight_discord_image_id" != "\$expected_discord_image_id"/,
  );

  for (const key of [
    "ARENZYRA_SOURCE_DIGEST",
    "ARENZYRA_GIT_COMMIT",
    "ARENZYRA_BUILD_AT",
    "ARENZYRA_BUILD_SOURCE",
  ]) {
    assert.match(
      rollback,
      new RegExp(`read-dotenv-value\\.cjs \\"\\$release_env\\" ${key}`),
    );
  }
  for (const label of [
    "org.opencontainers.image.version",
    "com.arenzyra.source-digest",
    "org.opencontainers.image.revision",
    "org.opencontainers.image.created",
    "com.arenzyra.release-source",
  ]) {
    assert.match(rollback, new RegExp(label.replaceAll(".", "\\.")));
  }
  assert.match(rollback, /preflight_discord_image_id.*sha256:/s);
  assert.match(rollback, /docker inspect --format '\{\{\.Image\}\}'/);
  assert.match(rollback, /running_image_id" != "\$expected_discord_image_id"/);
  assert.ok(manifestRead >= 0);
  assert.ok(imageInspection > manifestRead);
  assert.ok(manifestImageComparison > imageInspection);
  assert.ok(productionPreflight > manifestImageComparison);
  assert.ok(composeUp > productionPreflight);
  assert.ok(firstRuntimeBinding > composeUp);
});

test("backup result is emitted only after immutable off-host checksum verification", () => {
  const backup = read("scripts/production-backup.sh");
  const immutableUpload = backup.indexOf("rclone copy");
  const checksum = backup.indexOf("rclone check", immutableUpload);
  const resultWrite = backup.indexOf('if [ -n "$RESULT_FILE" ]');

  assert.ok(immutableUpload >= 0);
  assert.ok(checksum > immutableUpload);
  assert.ok(resultWrite > checksum);
  assert.match(backup, /An off-host rclone destination is mandatory/);
  assert.match(backup, /age --encrypt --recipient/);
});

test("production runtime cannot receive bootstrap or seed credentials", () => {
  const compose = read("infra/docker-compose.publish.yml");
  const example = read("infra/.env.publish.example");
  const preflight = read("scripts/preflight-publish.cjs");

  assert.match(compose, /AUTH_DEV_BOOTSTRAP_ENABLED: "false"/);
  assert.match(compose, /SUPERADMIN_MFA_REQUIRED: "true"/);
  assert.match(
    compose,
    /SUPERADMIN_MFA_ENCRYPTION_KEY: "\$\{SUPERADMIN_MFA_ENCRYPTION_KEY:\?REQUIRED ENV VARIABLE MISSING/,
  );
  assert.match(
    compose,
    /SUPERADMIN_MFA_RECOVERY_PEPPER: "\$\{SUPERADMIN_MFA_RECOVERY_PEPPER:\?REQUIRED ENV VARIABLE MISSING/,
  );
  assert.match(
    compose,
    /YOUTUBE_TOKEN_ENCRYPTION_KEY: "\$\{YOUTUBE_TOKEN_ENCRYPTION_KEY:\?REQUIRED ENV VARIABLE MISSING/,
  );
  assert.match(
    compose,
    /YOUTUBE_TOKEN_ENCRYPTION_KEY_ID: "\$\{YOUTUBE_TOKEN_ENCRYPTION_KEY_ID:\?REQUIRED ENV VARIABLE MISSING/,
  );
  for (const key of [
    "SUPERADMIN_EMAIL",
    "SUPERADMIN_PASSWORD",
    "OP_EMAIL",
    "OP_PASSWORD",
    "PLATFORM_ADMIN_EMAIL",
    "PLATFORM_ADMIN_PASSWORD",
  ]) {
    assert.doesNotMatch(compose, new RegExp(`${key}:`));
    assert.doesNotMatch(example, new RegExp(`^${key}=`, "m"));
    assert.match(preflight, new RegExp(`"${key}"`));
  }
  assert.match(preflight, /AUTH_DEV_BOOTSTRAP_ENABLED is development-only/);
});

test("raw npm aliases cannot execute production mutation wrappers", () => {
  const manifest = JSON.parse(read("package.json"));
  const blocker = read("scripts/blocked-production-mutation-entrypoint.cjs");
  for (const scriptName of [
    "deploy:release-metadata",
    "deploy:verify-api-image-contract",
    "deploy:guard",
    "deploy:migration-safety",
    "deploy:verify-idp-encryption",
    "deploy:up",
    "deploy:up:discord-bot",
    "deploy:api-maintenance",
    "deploy:preflight",
    "deploy:maintenance",
    "deploy:maintenance:check",
    "backup:production",
    "backup:restore-drill",
    "media-ai:warm-model-cache",
    "deploy:ps",
    "deploy:logs",
    "deploy:verify",
    "deploy:studio-qa",
    "studio:qa:live",
  ]) {
    assert.match(
      manifest.scripts[scriptName],
      /^node scripts\/blocked-production-mutation-entrypoint\.cjs /,
    );
    assert.doesNotMatch(
      manifest.scripts[scriptName],
      /(?:deploy-production|production-api-maintenance|production-maintenance|rollback-production-images)\.sh/,
    );
  }
  assert.equal(Object.hasOwn(manifest.scripts, "deploy:rollback"), false);
  assert.match(blocker, /raw npm\/check-out script entrypoints cannot establish source trust/);
  assert.match(blocker, /infra\/PUBLISH\.md/);
  assert.match(blocker, /process\.exitCode = 75/);

  const agents = read("AGENTS.md");
  assert.match(agents, /reviewed-commit outer launcher/);
  assert.match(agents, /Raw production npm aliases intentionally[\s\S]*fail closed/);
  assert.doesNotMatch(agents, /Prefer the guarded `npm run deploy:up`/);
});

test("one reviewed production entrypoint exposes only the closed command allowlist", () => {
  const launcher = read("scripts/production-reviewed-entrypoint.sh");
  assert.deepEqual(
    [...launcher.matchAll(/^  ([a-z][a-z-]+)\)$/gm)].map((match) => match[1]),
    [
      "deploy",
      "deploy-discord",
      "rollback-discord",
      "recover-web",
      "idp-dry-run",
      "backup",
      "backup-configure",
      "backup-inventory",
      "backup-export",
      "backup-legacy",
      "backup-resume",
      "backup-resume-legacy",
      "restore-drill",
      "roles-dry-run",
      "host-maintenance",
      "observe",
      "verify",
      "studio-qa",
    ],
  );
  const rootGate = launcher.indexOf("verify_repository ROOT");
  const dispatch = launcher.indexOf('case "$command_id" in');
  const firstCheckoutExec = launcher.indexOf("exec /bin/bash scripts/");
  assert.ok(rootGate >= 0 && rootGate < dispatch && dispatch < firstCheckoutExec);
  assert.match(launcher.slice(0, dispatch), /\/usr\/bin\/env -i/);
  assert.match(launcher.slice(0, dispatch), /GIT_NO_REPLACE_OBJECTS=1/);
  assert.match(launcher.slice(0, dispatch), /--porcelain=v1 --untracked-files=all/);
  assert.match(launcher, /require_nested_assembly/);
  assert.doesNotMatch(launcher, /\beval\b|bash\s+-c/);
  assert.doesNotMatch(launcher, /idp-credentials (?:apply|validate)/);
});

test("reviewed web recovery starts only one existing container after the dedicated preflight", () => {
  const launcher = read("scripts/production-reviewed-entrypoint.sh");
  const recovery = read("scripts/recover-production-web.sh");
  const preflight = read("scripts/production-deploy-preflight.sh");

  assert.match(
    launcher,
    /recover-web\)[\s\S]*recover-web accepts no arguments[\s\S]*exec \/bin\/bash scripts\/recover-production-web\.sh/,
  );
  const guard = recovery.indexOf(
    "production-deploy-preflight.sh --allow-web-recovery",
  );
  const start = recovery.indexOf('docker start "$web_container_id"');
  const postGuard = recovery.indexOf(
    "production-deploy-preflight.sh --allow-web-recovery",
    guard + 1,
  );
  const publicHealth = recovery.indexOf(
    'node - "$public_web_origin"',
    postGuard,
  );
  assert.ok(guard >= 0 && guard < start);
  assert.ok(postGuard > start && publicHealth > postGuard);
  assert.match(recovery, /LOCK_FILE="\/run\/arenzyra-production-deploy\.lock"/);
  assert.match(recovery, /require-local-production-docker\.sh/);
  assert.match(
    recovery,
    /read-dotenv-value\.cjs infra\/\.env\.publish ARENZYRA_DEPLOY_COMPOSE_PROJECT/,
  );
  assert.match(recovery, /com\.docker\.compose\.service=web/);
  assert.match(recovery, /com\.docker\.compose\.oneoff/);
  assert.match(recovery, /project_fingerprint/);
  assert.match(recovery, /web image identity changed/);
  assert.match(recovery, /public_https=pass/);
  assert.match(recovery, /SOURCE_ARCHIVE_ROOT="\/opt\/arenzyra-source-archives"/);
  assert.match(recovery, /LAUNCHER_MOUNT_DESTINATION="\/app\/public\/downloads\/launcher"/);
  assert.match(recovery, /\[ -n "\$launcher_mount_record" \]/);
  assert.match(recovery, /at least one preserved launcher release is required/);
  assert.match(recovery, /preserved launcher releases disagree byte-for-byte/);
  assert.match(recovery, /-type d -perm 0755/);
  assert.match(recovery, /-type f -perm 0644/);
  assert.match(recovery, /cp -a --reflink=auto/);
  assert.match(recovery, /launcher_tree_digest/);
  assert.match(recovery, /failed byte-for-byte verification/);
  assert.match(recovery, /mv -- "\$temporary" "\$mount_source"/);
  assert.ok(recovery.lastIndexOf("restore_missing_launcher_mount", guard) >= 0);
  assert.doesNotMatch(
    recovery,
    /docker\s+(?:compose|build|pull|create|restart|stop|rm)|\b(?:up|down)\s+--/,
  );

  assert.match(preflight, /--allow-web-recovery/);
  assert.match(
    preflight,
    /--skip-health and --allow-web-recovery cannot be combined/,
  );
  assert.match(
    preflight,
    /required_services=\(proxy postgres redis api media-ai web\)/,
  );
  assert.match(preflight, /required_container_count=1/);
  assert.match(
    preflight,
    /status=exited or running\/healthy/,
  );
});

test("launcher release downloads remain server-only and fail closed", () => {
  const rootPackage = JSON.parse(read("package.json"));
  const publishCompose = read("infra/docker-compose.publish.yml");
  const localCompose = read("infra/docker-compose.yml");
  const publishExample = read("infra/.env.publish.example");
  const localExample = read("infra/.env.example");
  const generator = read("scripts/create-publish-env.cjs");
  const preflight = read("scripts/preflight-publish.cjs");
  const stageAdapter = read("scripts/sync-launcher-downloads.cjs");
  const launcherReleaseDocs = read(
    "apps/arenzyra-web/docs/launcher-release-downloads.md",
  );
  const publishGuide = read("infra/PUBLISH.md");
  const dockerIgnore = read(".dockerignore");
  const rootGitIgnore = read(".gitignore");
  const runtimeSources = [
    "apps/arenzyra-web/app/launcher/page.tsx",
    "apps/arenzyra-web/app/(protected)/organizer/launcher/page.tsx",
    "apps/arenzyra-web/src/features/launcher/LauncherDownloadCards.tsx",
    "apps/arenzyra-web/src/features/launcher/launcher-links.ts",
    "apps/arenzyra-web/src/lib/server/launcher-release.ts",
  ]
    .map(read)
    .join("\n");
  const binding =
    'ARENZYRA_LAUNCHER_RELEASE_JSON: "${ARENZYRA_LAUNCHER_RELEASE_JSON:-}"';

  assert.match(dockerIgnore, /^\.launcher-releases\/$/m);
  assert.match(rootGitIgnore, /^\.launcher-releases\/$/m);

  for (const [name, compose] of [
    ["publish", publishCompose],
    ["local", localCompose],
  ]) {
    const webService =
      compose.match(
        /\n  web:\r?\n([\s\S]*?)(?=\n  [a-zA-Z0-9_-]+:\r?\n|\nvolumes:\r?\n)/,
      )?.[1] ?? "";
    const environmentAt = webService.indexOf("\n    environment:");
    assert.ok(environmentAt >= 0, `${name} web environment is missing`);
    assert.equal(
      webService.split(binding).length - 1,
      1,
      `${name} must pass one optional launcher release value`,
    );
    assert.ok(
      webService.indexOf(binding) > environmentAt,
      `${name} launcher metadata must be runtime-only`,
    );
    assert.doesNotMatch(
      webService.slice(0, environmentAt),
      /ARENZYRA_LAUNCHER_RELEASE_JSON/,
      `${name} launcher metadata must not be a build argument`,
    );
  }

  const reviewedSources = [
    publishCompose,
    localCompose,
    publishExample,
    localExample,
    generator,
    runtimeSources,
  ].join("\n");
  assert.doesNotMatch(
    reviewedSources,
    /NEXT_PUBLIC_ARENZYRA_LAUNCHER_RELEASE/i,
  );
  assert.match(publishExample, /^ARENZYRA_LAUNCHER_RELEASE_JSON=$/m);
  assert.match(localExample, /^ARENZYRA_LAUNCHER_RELEASE_JSON=$/m);
  assert.match(generator, /line\("ARENZYRA_LAUNCHER_RELEASE_JSON", ""\)/);
  assert.match(preflight, /MAX_LAUNCHER_RELEASE_CONFIG_BYTES = 16 \* 1024/);
  assert.match(dockerIgnore, /^apps\/arenzyra-web\/public\/downloads\/?$/m);
  assert.doesNotMatch(runtimeSources, /\/downloads\/launcher\//);
  assert.equal(
    Object.hasOwn(rootPackage.scripts, "sync:launcher-downloads"),
    false,
  );
  assert.equal(
    rootPackage.scripts["stage:launcher-release"],
    "node scripts/blocked-launcher-release-entrypoint.cjs stage",
  );
  assert.equal(
    rootPackage.scripts["verify:launcher-release"],
    "node scripts/blocked-launcher-release-entrypoint.cjs verify",
  );
  assert.match(stageAdapter, /"deploy-artifacts",\s*"launcher"/);
  assert.doesNotMatch(stageAdapter, /public[\\/]downloads/i);
  assert.doesNotMatch(stageAdapter, /["'`]\/downloads\/launcher\//i);
  assert.match(stageAdapter, /schemaVersion:\s*0/);
  assert.match(stageAdapter, /runtimeValue:\s*null/);
  assert.match(
    stageAdapter,
    /pending-independent-upload-and-remote-verification/,
  );
  assert.match(launcherReleaseDocs, /reviewed outer Windows\s+launcher/i);
  assert.match(
    launcherReleaseDocs,
    /same-checkout npm commands.*fail closed/is,
  );
  assert.match(launcherReleaseDocs, /does not generate deploy-ready/i);
  assert.match(publishGuide, /reviewed outer Windows\s+launcher/i);
  assert.match(publishGuide, /same-checkout npm commands.*fail closed/is);
  assert.match(
    publishGuide,
    /must never be copied into the publish environment/i,
  );
});

test("Studio migration SQL and verified TLS settings reach the web migration image", () => {
  const dockerIgnore = read(".dockerignore");
  const migrationRunner = read(
    "apps/arenzyra-web/scripts/migrate-studio-postgres.cjs",
  );
  const publishCompose = read("infra/docker-compose.publish.yml");
  const sqlDeny = dockerIgnore.indexOf("**/*.sql");
  const studioAllow = dockerIgnore.indexOf(
    "!apps/arenzyra-web/scripts/studio-migrations/*.sql",
  );

  assert.ok(sqlDeny >= 0, "SQL files must remain denied by default");
  assert.ok(
    studioAllow > sqlDeny,
    "only the vetted Studio migration directory may be restored to the context",
  );
  assert.match(migrationRunner, /STUDIO_MIGRATION_DATABASE_SSL/);
  assert.match(migrationRunner, /STUDIO_DATABASE_SSL/);
  assert.match(migrationRunner, /STUDIO_MIGRATION_DATABASE_CA/);
  assert.match(migrationRunner, /STUDIO_DATABASE_CA/);
  assert.doesNotMatch(migrationRunner, /rejectUnauthorized:\s*false/);
  assert.match(migrationRunner, /refuse TLS modes/);
  assert.match(
    publishCompose,
    /studio-migrate:[\s\S]*STUDIO_DATABASE_SSL:[\s\S]*STUDIO_DATABASE_CA:/,
  );
});

test("web container context and deployed package exclude local source artifacts", () => {
  const dockerIgnore = read(".dockerignore");
  const webDockerfile = read("apps/arenzyra-web/Dockerfile");
  const webPackage = JSON.parse(read("apps/arenzyra-web/package.json"));
  const workspace = read("pnpm-workspace.yaml");
  const lockfile = read("pnpm-lock.yaml");
  const expectedFiles = [
    ".arenzyra-build.json",
    ".next-build/**",
    "!.next-build/cache/**",
    "!.next-build/dev/**",
    "next.config.mjs",
    "public/**",
    "scripts/migrate-studio-postgres.cjs",
    "scripts/start-prod.cjs",
    "scripts/studio-migrations/**",
  ];

  assert.deepEqual(webPackage.files, expectedFiles);
  for (const ignoredPath of [
    ".migration-rehearsal-*",
    "apps/arenzyra-web/.arenzyra-build.json",
    "apps/arenzyra-web/next-env.d.ts",
    "apps/arenzyra-web/tsconfig.tsbuildinfo",
    "apps/arenzyra-web/leaderboard-cdp.png",
    "apps/arenzyra-web/out",
    "apps/arenzyra-web/.vercel",
    "apps/arenzyra-web/.pnp*",
    "apps/arenzyra-web/.yarn",
  ]) {
    assert.match(
      dockerIgnore,
      new RegExp(
        `^${ignoredPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "m",
      ),
    );
  }
  for (const excludedRuntimeSource of [
    "app/**",
    "src/**",
    "e2e/**",
    "docs/**",
  ]) {
    assert.equal(
      webPackage.files.includes(excludedRuntimeSource),
      false,
      `${excludedRuntimeSource} must not enter the deployed package`,
    );
  }
  const deployAt = webDockerfile.indexOf(
    "pnpm --filter arenzyra-web deploy --prod /opt/arenzyra-web",
  );
  const packageBoundaryAt = webDockerfile.indexOf(
    "verify-web-runtime-package.cjs /opt/arenzyra-web",
  );
  const assetBoundaryAt = webDockerfile.indexOf(
    "verify-release-asset-boundary.cjs /opt/arenzyra-web",
  );
  assert.ok(deployAt >= 0);
  assert.ok(packageBoundaryAt > deployAt);
  assert.ok(assetBoundaryAt > packageBoundaryAt);
  assert.doesNotMatch(
    webDockerfile,
    /COPY[^\n]*\/repo\/apps\/arenzyra-web\/(?:public|\.next-build|\.arenzyra-build\.json)/,
  );
  assert.match(workspace, /^injectWorkspacePackages:\s*true$/m);
  assert.match(lockfile, /^\s{2}injectWorkspacePackages:\s*true$/m);
});

test("immediate production guard validates the MFA environment before runtime checks", () => {
  const guard = read("scripts/production-deploy-preflight.sh");
  const envGate = guard.indexOf("preflight-publish.cjs");
  const diskGate = guard.indexOf("df -Pk");
  const dockerGate = guard.indexOf("docker info");

  assert.ok(envGate >= 0);
  assert.ok(diskGate > envGate);
  assert.ok(dockerGate > diskGate);
  assert.match(guard, /PRODUCTION ENVIRONMENT PREFLIGHT FAILED/);
  assert.match(guard, /superadmin_mfa=required/);
  assert.match(
    guard,
    /read-dotenv-value\.cjs[\s\\]*\n[\s\\]*"\$PUBLISH_ENV_FILE" ARENZYRA_DEPLOY_COMPOSE_PROJECT/,
  );
  assert.match(guard, /INVALID COMPOSE PROJECT/);
});

test("production env generator creates independent MFA and YouTube material", () => {
  const generator = read("scripts/create-publish-env.cjs");
  assert.match(generator, /line\("SUPERADMIN_MFA_REQUIRED", "true"\)/);
  assert.match(
    generator,
    /line\("SUPERADMIN_MFA_ENCRYPTION_KEY", secret\(48\)\)/,
  );
  assert.match(
    generator,
    /line\("SUPERADMIN_MFA_RECOVERY_PEPPER", secret\(48\)\)/,
  );
  assert.match(
    generator,
    /line\("YOUTUBE_TOKEN_ENCRYPTION_KEY", secret\(48\)\)/,
  );
  assert.match(
    generator,
    /line\("YOUTUBE_TOKEN_ENCRYPTION_PREVIOUS_KEYS", "\{\}"\)/,
  );
  for (const [key, role] of [
    ["MAINTENANCE_READ_DATABASE_URL", "arenzyra_maintenance_read"],
    ["IDP_MAINTENANCE_DATABASE_URL", "arenzyra_idp_maintenance"],
    ["YOUTUBE_MAINTENANCE_DATABASE_URL", "arenzyra_youtube_maintenance"],
  ]) {
    assert.ok(generator.includes(`"${key}"`), key);
    assert.ok(generator.includes(`"${role}"`), role);
  }
});

test("API migrations use only the lockfile-installed Prisma CLI", () => {
  const dockerfile = read("apps/api/Dockerfile");
  const manifest = JSON.parse(read("apps/api/package.json"));
  const lockfile = JSON.parse(read("apps/api/package-lock.json"));
  const compose = read("infra/docker-compose.publish.yml");

  assert.match(manifest.dependencies.prisma, /^7\./);
  assert.equal(
    manifest.dependencies.prisma,
    lockfile.packages[""].dependencies.prisma,
  );
  assert.equal(
    manifest.dependencies.prisma,
    lockfile.packages["node_modules/prisma"].version,
  );
  assert.equal(Object.hasOwn(manifest.devDependencies, "prisma"), false);
  assert.match(dockerfile, /npm ci --omit=dev/);
  assert.match(dockerfile, /\.\/node_modules\/\.bin\/prisma generate/);
  assert.doesNotMatch(dockerfile, /\bnpx\s+prisma\b/);
  assert.match(
    compose,
    /command: \["\.\/node_modules\/\.bin\/prisma", "migrate", "deploy"\]/,
  );
  assert.doesNotMatch(compose, /command: \["npx", "prisma"/);
});
