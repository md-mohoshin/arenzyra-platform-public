"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  IDP_CONFIRMATION,
  YOUTUBE_CONFIRMATION,
  parseMaintenanceArguments,
} = require("./production-api-maintenance-plan.cjs");
const {
  assertImageProvenance,
  assertMaintenanceBinding,
  pinMaintenanceImage,
} = require("./production-api-maintenance-binding.cjs");

const repositoryRoot = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");

function reviewedBindingFixture() {
  const target =
    "postgres:5432/arenzyra?schema=public&options=-c%20search_path%3Dpublic";
  const releaseEnv = {
    ARENZYRA_RELEASE_ID: "git-20260805-120000000-aaaaaaaaaaaa",
    ARENZYRA_SOURCE_DIGEST: `sha256:${"a".repeat(64)}`,
    ARENZYRA_GIT_COMMIT: "abcdef123456",
    ARENZYRA_BUILD_AT: "2026-08-05T12:00:00.000Z",
    ARENZYRA_BUILD_SOURCE: "git",
  };
  const image = `arenzyra-api:${releaseEnv.ARENZYRA_RELEASE_ID}`;
  const publishEnv = {
    POSTGRES_DB: "arenzyra",
    POSTGRES_USER: "postgres_admin",
    POSTGRES_PASSWORD: "admin-secret-material-000001",
    ARENZYRA_DEPLOY_COMPOSE_PROJECT: "arenzyra",
    DATABASE_URL: `postgresql://api_runtime:runtime-secret-material-000002@${target}`,
    MIGRATION_DATABASE_URL: `postgresql://api_migration:migration-secret-material-000003@${target}`,
    STUDIO_DATABASE_URL: `postgresql://studio_runtime:studio-secret-material-000004@${target}`,
    STUDIO_MIGRATION_DATABASE_URL: `postgresql://studio_migration:studio-migration-secret-000005@${target}`,
    MAINTENANCE_READ_DATABASE_URL: `postgresql://maintenance_read:maintenance-read-secret-000006@${target}`,
    IDP_MAINTENANCE_DATABASE_URL: `postgresql://idp_maintenance:idp-maintenance-secret-000007@${target}`,
    YOUTUBE_MAINTENANCE_DATABASE_URL: `postgresql://youtube_maintenance:youtube-maintenance-secret-000008@${target}`,
    IDP_CREDENTIAL_ENCRYPTION_KEY: "idp-secret-material-at-least-32-bytes",
    YOUTUBE_TOKEN_ENCRYPTION_KEY_ID: "yt-current",
    YOUTUBE_TOKEN_ENCRYPTION_KEY: "youtube-current-secret",
    YOUTUBE_TOKEN_ENCRYPTION_PREVIOUS_KEYS: "{}",
    YOUTUBE_TOKEN_ENCRYPTION_LEGACY_V1_KEY: "",
  };
  const isolatedService = (environment, entrypoint) => ({
    image,
    profiles: ["maintenance"],
    environment,
    entrypoint,
    command: [],
    read_only: true,
    tmpfs: ["/tmp:rw,noexec,nosuid,size=64m"],
    cap_drop: ["ALL"],
    security_opt: ["no-new-privileges:true"],
    logging: {
      driver: "local",
      options: { "max-size": "20m", "max-file": "5" },
    },
    networks: { default: null },
    restart: "no",
  });
  return {
    publishEnv,
    releaseEnv,
    compose: {
      services: {
        postgres: { environment: { POSTGRES_DB: publishEnv.POSTGRES_DB } },
        api: {
          image,
          build: {
            args: {
              ARENZYRA_RELEASE_ID: releaseEnv.ARENZYRA_RELEASE_ID,
              ARENZYRA_SOURCE_DIGEST: releaseEnv.ARENZYRA_SOURCE_DIGEST,
              ARENZYRA_GIT_COMMIT: releaseEnv.ARENZYRA_GIT_COMMIT,
              ARENZYRA_BUILD_AT: releaseEnv.ARENZYRA_BUILD_AT,
              ARENZYRA_BUILD_SOURCE: releaseEnv.ARENZYRA_BUILD_SOURCE,
            },
          },
          environment: {
            DATABASE_URL: publishEnv.DATABASE_URL,
          },
        },
        "api-migrate": {
          environment: { DATABASE_URL: publishEnv.MIGRATION_DATABASE_URL },
        },
        web: {
          environment: {
            STUDIO_DATABASE_URL: publishEnv.STUDIO_DATABASE_URL,
          },
        },
        "studio-migrate": {
          environment: {
            STUDIO_MIGRATION_DATABASE_URL:
              publishEnv.STUDIO_MIGRATION_DATABASE_URL,
          },
        },
        "api-maintenance-idp-read": isolatedService(
          {
            NODE_ENV: "production",
            DATABASE_URL: publishEnv.MAINTENANCE_READ_DATABASE_URL,
            IDP_CREDENTIAL_ENCRYPTION_KEY:
              publishEnv.IDP_CREDENTIAL_ENCRYPTION_KEY,
          },
          ["node", "dist-maintenance/scripts/backfill-idp-credentials.js"],
        ),
        "api-maintenance-idp-apply": isolatedService(
          {
            NODE_ENV: "production",
            DATABASE_URL: publishEnv.IDP_MAINTENANCE_DATABASE_URL,
            IDP_CREDENTIAL_ENCRYPTION_KEY:
              publishEnv.IDP_CREDENTIAL_ENCRYPTION_KEY,
          },
          ["node", "dist-maintenance/scripts/backfill-idp-credentials.js"],
        ),
        "api-maintenance-youtube-read": isolatedService(
          {
            NODE_ENV: "production",
            DATABASE_URL: publishEnv.MAINTENANCE_READ_DATABASE_URL,
            YOUTUBE_TOKEN_ENCRYPTION_KEY_ID:
              publishEnv.YOUTUBE_TOKEN_ENCRYPTION_KEY_ID,
            YOUTUBE_TOKEN_ENCRYPTION_KEY:
              publishEnv.YOUTUBE_TOKEN_ENCRYPTION_KEY,
            YOUTUBE_TOKEN_ENCRYPTION_PREVIOUS_KEYS:
              publishEnv.YOUTUBE_TOKEN_ENCRYPTION_PREVIOUS_KEYS,
            YOUTUBE_TOKEN_ENCRYPTION_LEGACY_V1_KEY:
              publishEnv.YOUTUBE_TOKEN_ENCRYPTION_LEGACY_V1_KEY,
          },
          [
            "node",
            "dist-maintenance/scripts/rotate-youtube-token-encryption.js",
          ],
        ),
        "api-maintenance-youtube-apply": isolatedService(
          {
            NODE_ENV: "production",
            DATABASE_URL: publishEnv.YOUTUBE_MAINTENANCE_DATABASE_URL,
            YOUTUBE_TOKEN_ENCRYPTION_KEY_ID:
              publishEnv.YOUTUBE_TOKEN_ENCRYPTION_KEY_ID,
            YOUTUBE_TOKEN_ENCRYPTION_KEY:
              publishEnv.YOUTUBE_TOKEN_ENCRYPTION_KEY,
            YOUTUBE_TOKEN_ENCRYPTION_PREVIOUS_KEYS:
              publishEnv.YOUTUBE_TOKEN_ENCRYPTION_PREVIOUS_KEYS,
            YOUTUBE_TOKEN_ENCRYPTION_LEGACY_V1_KEY:
              publishEnv.YOUTUBE_TOKEN_ENCRYPTION_LEGACY_V1_KEY,
          },
          [
            "node",
            "dist-maintenance/scripts/rotate-youtube-token-encryption.js",
          ],
        ),
      },
    },
  };
}

test("IDP dry-run is read-only and uses the immutable maintenance runner", () => {
  assert.deepEqual(parseMaintenanceArguments(["idp-credentials", "dry-run"]), {
    task: "idp-credentials",
    action: "dry-run",
    apply: false,
    requireStoppedApi: false,
    runner: "dist-maintenance/scripts/backfill-idp-credentials.js",
    runnerArguments: [],
  });
});

test("IDP apply requires both stopped-writer acceptance and exact confirmation", () => {
  const plan = parseMaintenanceArguments([
    "idp-credentials",
    "apply",
    "--writers-stopped",
    `--confirm=${IDP_CONFIRMATION}`,
  ]);
  assert.equal(plan.apply, true);
  assert.equal(plan.requireStoppedApi, true);
  assert.deepEqual(plan.runnerArguments, [
    "--apply",
    `--confirm=${IDP_CONFIRMATION}`,
  ]);

  assert.throws(
    () =>
      parseMaintenanceArguments([
        "idp-credentials",
        "apply",
        `--confirm=${IDP_CONFIRMATION}`,
      ]),
    /writers-stopped/,
  );
  assert.throws(
    () =>
      parseMaintenanceArguments([
        "idp-credentials",
        "apply",
        "--writers-stopped",
        "--confirm=wrong",
      ]),
    /exact task confirmation/,
  );
});

test("YouTube dry-run, scan, and apply preserve only bounded safe arguments", () => {
  const scan = parseMaintenanceArguments([
    "youtube-tokens",
    "scan",
    "--batch-size=500",
    "--max-rows=10000",
    "--start-after=channel_cursor-1",
  ]);
  assert.equal(scan.apply, false);
  assert.deepEqual(scan.runnerArguments, [
    "--batch-size=500",
    "--max-rows=10000",
    "--start-after=channel_cursor-1",
  ]);

  const apply = parseMaintenanceArguments([
    "youtube-tokens",
    "apply",
    `--confirm=${YOUTUBE_CONFIRMATION}`,
    "--batch-size=100",
  ]);
  assert.deepEqual(apply.runnerArguments, [
    "--apply",
    `--confirm=${YOUTUBE_CONFIRMATION}`,
    "--batch-size=100",
  ]);
  assert.equal(
    parseMaintenanceArguments(["youtube-tokens", "dry-run"]).apply,
    false,
  );
});

test("maintenance parser rejects ambiguous, out-of-range, and injectable input", () => {
  for (const argumentsToReject of [
    [
      "youtube-tokens",
      "apply",
      `--confirm=${YOUTUBE_CONFIRMATION}`,
      "--batch-size=0",
    ],
    ["youtube-tokens", "scan", "--batch-size=501"],
    ["youtube-tokens", "scan", "--max-rows=10001"],
    ["youtube-tokens", "scan", "--start-after=$(touch_bad)"],
    ["youtube-tokens", "scan", "--batch-size=10", "--batch-size=20"],
    ["youtube-tokens", "scan", `--confirm=${YOUTUBE_CONFIRMATION}`],
    ["idp-credentials", "dry-run", "--writers-stopped"],
    ["idp-credentials", "dry-run", "--batch-size=10"],
    ["unknown", "apply"],
  ]) {
    assert.throws(() => parseMaintenanceArguments(argumentsToReject));
  }
});

test("resolved maintenance environment and immutable image must match reviewed files", () => {
  const fixture = reviewedBindingFixture();
  assert.doesNotThrow(() =>
    assertMaintenanceBinding({
      ...fixture,
      task: "idp-credentials",
      action: "dry-run",
    }),
  );
  assert.doesNotThrow(() =>
    assertMaintenanceBinding({
      ...fixture,
      task: "youtube-tokens",
      action: "scan",
    }),
  );
  assert.doesNotThrow(() =>
    assertMaintenanceBinding({
      ...fixture,
      task: "idp-credentials",
      action: "apply",
    }),
  );
  assert.doesNotThrow(() =>
    assertMaintenanceBinding({
      ...fixture,
      task: "youtube-tokens",
      action: "apply",
    }),
  );

  const wrongApplyRole = reviewedBindingFixture();
  wrongApplyRole.compose.services["api-maintenance-idp-apply"].environment[
    "DATABASE_URL"
  ] = wrongApplyRole.publishEnv.MAINTENANCE_READ_DATABASE_URL;
  assert.throws(
    () =>
      assertMaintenanceBinding({
        ...wrongApplyRole,
        task: "idp-credentials",
        action: "apply",
      }),
    /DATABASE_URL/,
  );

  const wrongSecret = reviewedBindingFixture();
  wrongSecret.compose.services[
    "api-maintenance-youtube-read"
  ].environment.YOUTUBE_TOKEN_ENCRYPTION_KEY = "ambient-unreviewed-secret";
  assert.throws(
    () =>
      assertMaintenanceBinding({
        ...wrongSecret,
        task: "youtube-tokens",
        action: "dry-run",
      }),
    (error) =>
      /YOUTUBE_TOKEN_ENCRYPTION_KEY/.test(error.message) &&
      !error.message.includes("ambient-unreviewed-secret"),
  );

  const wrongImage = reviewedBindingFixture();
  wrongImage.compose.services.api.image = "arenzyra-api:ambient-release";
  assert.throws(
    () =>
      assertMaintenanceBinding({
        ...wrongImage,
        task: "idp-credentials",
        action: "dry-run",
      }),
    /reviewed release/,
  );

  const excessiveEnvironment = reviewedBindingFixture();
  excessiveEnvironment.compose.services[
    "api-maintenance-idp-read"
  ].environment.JWT_SECRET = "must-not-be-forwarded";
  assert.throws(
    () =>
      assertMaintenanceBinding({
        ...excessiveEnvironment,
        task: "idp-credentials",
        action: "dry-run",
      }),
    (error) =>
      /least privilege/.test(error.message) &&
      !error.message.includes("must-not-be-forwarded"),
  );

  const rootOverride = reviewedBindingFixture();
  rootOverride.compose.services["api-maintenance-idp-read"].user = "0";
  assert.throws(
    () =>
      assertMaintenanceBinding({
        ...rootOverride,
        task: "idp-credentials",
        action: "dry-run",
      }),
    /unreviewed fields/,
  );
});

test("maintenance services reject every unreviewed field and dangerous lifecycle escape", () => {
  for (const field of [
    "volumes_from",
    "use_api_socket",
    "pre_start",
    "post_start",
    "depends_on",
    "volumes",
    "ports",
    "privileged",
    "user",
    "unknown_extension",
  ]) {
    const fixture = reviewedBindingFixture();
    fixture.compose.services["api-maintenance-idp-read"][field] =
      field === "privileged" ? false : [];
    assert.throws(
      () =>
        assertMaintenanceBinding({
          ...fixture,
          task: "idp-credentials",
          action: "dry-run",
        }),
      /unreviewed fields/,
      field,
    );
  }
});

test("maintenance services reject malformed allowed fields", () => {
  const mutations = [
    (service) => {
      service.environment = ["NODE_ENV=production"];
    },
    (service) => {
      service.entrypoint = "node";
    },
    (service) => {
      service.logging.options["max-size"] = "unlimited";
    },
    (service) => {
      service.networks = { default: null, hostile: null };
    },
  ];
  for (const mutate of mutations) {
    const fixture = reviewedBindingFixture();
    mutate(fixture.compose.services["api-maintenance-idp-read"]);
    assert.throws(
      () =>
        assertMaintenanceBinding({
          ...fixture,
          task: "idp-credentials",
          action: "dry-run",
        }),
      /field shapes/,
    );
  }
});

test("local API image labels and tag must match reviewed release provenance", () => {
  const { releaseEnv } = reviewedBindingFixture();
  const imageReference = `arenzyra-api:${releaseEnv.ARENZYRA_RELEASE_ID}`;
  const imageInspect = [
    {
      Id: `sha256:${"b".repeat(64)}`,
      RepoTags: [imageReference],
      Config: {
        User: "node",
        WorkingDir: "/app",
        Cmd: ["node", "dist/main"],
        Entrypoint: ["docker-entrypoint.sh"],
        Env: [
          "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
          "NODE_ENV=production",
          "PORT=3000",
        ],
        Labels: {
          "org.opencontainers.image.version": releaseEnv.ARENZYRA_RELEASE_ID,
          "org.opencontainers.image.revision": releaseEnv.ARENZYRA_GIT_COMMIT,
          "org.opencontainers.image.created": releaseEnv.ARENZYRA_BUILD_AT,
          "com.arenzyra.source-digest": releaseEnv.ARENZYRA_SOURCE_DIGEST,
          "com.arenzyra.release-source": releaseEnv.ARENZYRA_BUILD_SOURCE,
        },
      },
    },
  ];
  assert.equal(
    assertImageProvenance({ imageInspect, imageReference, releaseEnv }),
    imageInspect[0].Id,
  );

  const binding = reviewedBindingFixture();
  const pinned = pinMaintenanceImage({
    compose: binding.compose,
    task: "idp-credentials",
    action: "apply",
    imageId: imageInspect[0].Id,
  });
  assert.equal(
    pinned.services["api-maintenance-idp-apply"].image,
    imageInspect[0].Id,
  );
  assert.equal(
    pinned.services["api-maintenance-youtube-read"].image,
    imageReference,
  );
  assert.equal(
    binding.compose.services["api-maintenance-idp-apply"].image,
    imageReference,
  );

  const wrongLabel = structuredClone(imageInspect);
  wrongLabel[0].Config.Labels["com.arenzyra.source-digest"] =
    `sha256:${"c".repeat(64)}`;
  assert.throws(
    () =>
      assertImageProvenance({
        imageInspect: wrongLabel,
        imageReference,
        releaseEnv,
      }),
    (error) =>
      /source-digest/.test(error.message) &&
      !error.message.includes("c".repeat(64)),
  );

  const bakedSecret = structuredClone(imageInspect);
  bakedSecret[0].Config.Env.push("DATABASE_URL=must-never-be-baked");
  assert.throws(
    () =>
      assertImageProvenance({
        imageInspect: bakedSecret,
        imageReference,
        releaseEnv,
      }),
    (error) =>
      /runtime policy/.test(error.message) &&
      !error.message.includes("must-never-be-baked"),
  );
});

test("production wrapper shares the deploy lock and binds every command to reviewed infrastructure", () => {
  const wrapper = read("scripts/production-api-maintenance.sh");
  const dockerGuard = read("scripts/require-local-production-docker.sh");
  assert.match(wrapper, /EXPECTED_ROOT="\/opt\/arenzyra"/);
  assert.match(
    wrapper,
    /LOCAL_DOCKER_HOST="unix:\/\/\/var\/run\/docker\.sock"/,
  );
  assert.match(wrapper, /\. scripts\/require-local-production-docker\.sh/);
  assert.match(dockerGuard, /DOCKER_HOST.*reviewed local socket/s);
  assert.match(dockerGuard, /DOCKER_CONTEXT.*default/s);
  assert.match(wrapper, /env -i/);
  assert.match(wrapper, /getent passwd "\$\(id -u\)"/);
  assert.match(wrapper, /"PATH=\$SAFE_PATH"/);
  assert.match(wrapper, /"HOME=\$safe_home"/);
  assert.match(wrapper, /LOCK_FILE="\/run\/arenzyra-production-deploy\.lock"/);
  assert.match(wrapper, /basename bash cat chmod/);
  assert.match(wrapper, /Production API maintenance requires effective UID 0/);
  assert.match(wrapper, /verify_lock_directory_safety/);
  assert.match(wrapper, /resolved_lock_directory" != "\/run"/);
  assert.match(wrapper, /verify_lock_file_safety/);
  assert.match(wrapper, /\[ -L "\$LOCK_FILE" \]/);
  assert.match(wrapper, /stat -Lc '%d:%i:%h'/);
  assert.match(wrapper, /8#\$lock_mode & 8#022/);
  assert.match(wrapper, /8#\$existing_lock_mode & 8#022/);
  assert.match(wrapper, /ARENZYRA_DEPLOY_LOCK_INHERITED/);
  assert.match(wrapper, /readlink -f "\/proc\/\$\$\/fd\/8"/);
  assert.match(wrapper, /flock -w "\$LOCK_TIMEOUT_SECONDS" 8/);
  assert.match(wrapper, /Process environment file differs from reviewed/);
  assert.match(wrapper, /Process Compose project differs from the reviewed/);
  assert.match(
    wrapper,
    /production-database-target\.cjs --env "\$ENV_FILE" --check/,
  );
  assert.match(
    wrapper,
    /--profile migration --profile maintenance config --format json/,
  );
  assert.match(wrapper, /--assert-compose-json/);
  assert.match(wrapper, /production-api-maintenance-binding\.cjs/);
  assert.match(wrapper, /--action "\$action"/);
  assert.match(
    wrapper,
    /idp-credentials:dry-run\) maintenance_service="api-maintenance-idp-read"/,
  );
  assert.match(
    wrapper,
    /idp-credentials:apply\) maintenance_service="api-maintenance-idp-apply"/,
  );
  assert.match(
    wrapper,
    /youtube-tokens:dry-run\|youtube-tokens:scan\) maintenance_service="api-maintenance-youtube-read"/,
  );
  assert.match(
    wrapper,
    /youtube-tokens:apply\) maintenance_service="api-maintenance-youtube-apply"/,
  );
  assert.match(wrapper, /--env-file "\$RELEASE_FILE"/);
  assert.match(wrapper, /docker image inspect "\$image_reference"/);
  assert.match(wrapper, /--assert-image-json --print-image-id/);
  assert.match(
    wrapper,
    /RELEASE_ARCHIVE_ROOT="\/opt\/arenzyra-release-metadata"/,
  );
  assert.match(wrapper, /validate-publish-release-env\.cjs/);
  assert.match(wrapper, /validate-release-image-manifest\.cjs/);
  assert.match(wrapper, /--service api/);
  assert.match(wrapper, /--print-image-id/);
  assert.match(wrapper, /cmp -s -- "\$RELEASE_FILE" "\$archived_release_file"/);
  assert.match(wrapper, /stat -c '%u:%g:%a:%h'/);
  assert.match(wrapper, /0:0:600:1/);
  assert.match(wrapper, /reviewed_archive_files=\(/);
  assert.match(wrapper, /"\$image_id" != "\$expected_archived_image_id"/);
  assert.match(wrapper, /--pin-maintenance-image-json/);
  assert.match(wrapper, /resolved-compose\.json/);
  assert.match(wrapper, /reviewed_compose_digest/);
  assert.match(wrapper, /pinned_compose_digest/);
  assert.match(wrapper, /sha256sum -- "\/proc\/\$\$\/fd\/7"/);
  assert.match(wrapper, /exec 7<"\$pinned_compose_file"/);
  assert.match(wrapper, /docker compose[\s\S]*-f -/);
  assert.match(
    wrapper,
    /"\$\{pinned_compose\[@\]\}" --profile maintenance run[\s\S]*<&7/,
  );
  assert.match(wrapper, /verify-production-database-container\.sh/);
  assert.match(wrapper, /com\.docker\.compose\.service=api/);
  assert.match(wrapper, /pg_catalog\.pg_stat_activity/);
  assert.match(wrapper, /PGCONNECT_TIMEOUT=10/);
  assert.match(wrapper, /default_transaction_read_only=on/);
  assert.match(wrapper, /statement_timeout=30000/);
  assert.match(wrapper, /lock_timeout=5000/);
  assert.match(
    wrapper,
    /read-postgres-url-field\.cjs[\s\\]*\n[\s\\]*"\$ENV_FILE" DATABASE_URL username/,
  );
  assert.match(wrapper, /active_api_sessions[\s\S]*-ne 0/);
  assert.match(wrapper, /--allow-stopped-api-maintenance/);
  assert.match(wrapper, /verify-production-database-roles\.sh/);
  assert.match(wrapper, /verify-production-idp-encryption\.sh/);
  assert.match(
    wrapper,
    /"ARENZYRA_DEPLOY_LOCK_INHERITED=1"[\s\\]*\n[\s\\]*bash scripts\/verify-production-database-roles\.sh/,
  );
  assert.match(
    wrapper,
    /if \[ "\$action" = "apply" \]; then\s+create_verified_apply_backup\s+fi/,
  );
  assert.match(wrapper, /ARENZYRA_BACKUP_REQUIRE_OFFSITE=1/);
  assert.match(wrapper, /ARENZYRA_BACKUP_ALLOW_MISSING_APP_VOLUMES=0/);
  assert.match(wrapper, /ARENZYRA_BACKUP_RESULT_FILE=\$result_file/);
  assert.match(wrapper, /database\.dump\.age/);
  assert.match(wrapper, /database-globals\.sql\.age/);
  assert.match(wrapper, /manifest\.sha256\.age/);
  assert.match(wrapper, /OFFSITE_VERIFIED/);
  assert.match(wrapper, /BACKUP_COMPLETE/);
  assert.match(wrapper, /run --rm --no-deps --pull never -T/);
  assert.doesNotMatch(wrapper, /-e PGCONNECT_TIMEOUT|-e "PGOPTIONS=/);
  assert.doesNotMatch(wrapper, /\bsource\s+.*\.env|npm --prefix apps\/api/);
  assert.doesNotMatch(wrapper, /DATABASE_URL=.*read-dotenv/);

  const rootGate = wrapper.indexOf('if [ "$(id -u)" -ne 0 ]');
  const lockAcquisition = wrapper.indexOf('exec 8>"$LOCK_FILE"');
  const dockerHelper = wrapper.indexOf(
    ". scripts/require-local-production-docker.sh",
  );
  const planHelper = wrapper.indexOf(
    "node scripts/production-api-maintenance-plan.cjs",
  );
  assert.ok(rootGate >= 0);
  assert.ok(rootGate < lockAcquisition);
  assert.ok(lockAcquisition < dockerHelper);
  assert.ok(lockAcquisition < planHelper);

  for (const reviewedFile of [
    "infra/.env.publish",
    "infra/.env.release",
    "infra/docker-compose.publish.yml",
    "infra/production-api-migration-safety.json",
    "scripts/production-api-maintenance.sh",
    "scripts/production-api-maintenance-binding.cjs",
    "scripts/production-api-maintenance-plan.cjs",
    "scripts/production-backup.sh",
    "scripts/production-database-target.cjs",
    "scripts/production-deploy-preflight.sh",
    "scripts/preflight-publish.cjs",
    "scripts/read-dotenv-value.cjs",
    "scripts/read-postgres-url-field.cjs",
    "scripts/require-local-production-docker.sh",
    "scripts/validate-publish-release-env.cjs",
    "scripts/validate-release-image-manifest.cjs",
    "scripts/verify-production-database-container.sh",
    "scripts/verify-production-database-roles.sh",
    "scripts/verify-idp-credential-storage.cjs",
    "scripts/verify-production-idp-encryption.sh",
    "scripts/verify-production-migration-safety.cjs",
  ]) {
    assert.match(wrapper, new RegExp(reviewedFile.replaceAll(".", "\\.")));
  }
  assert.match(wrapper, /\[ -L "\$expected_file" \]/);
  assert.match(wrapper, /\[ "\$file_owner" != "0" \]/);
  assert.match(wrapper, /8#\$file_mode & 8#022/);
  assert.match(wrapper, /reviewed_file_digest="\$\(sha256sum/);

  const releaseValidation = wrapper.indexOf(
    "node scripts/validate-publish-release-env.cjs",
  );
  const archiveManifestValidation = wrapper.indexOf(
    "node scripts/validate-release-image-manifest.cjs",
  );
  const maintenancePlan = wrapper.indexOf(
    "node scripts/production-api-maintenance-plan.cjs",
  );
  const imageInspection = wrapper.indexOf(
    'docker image inspect "$image_reference"',
  );
  assert.ok(releaseValidation > lockAcquisition);
  assert.ok(archiveManifestValidation > releaseValidation);
  assert.ok(archiveManifestValidation < maintenancePlan);
  assert.ok(archiveManifestValidation < imageInspection);

  const writerBoundary = wrapper.slice(
    wrapper.indexOf("verify_idp_writer_boundary()"),
    wrapper.indexOf("verify_runtime_database_roles()"),
  );
  assert.doesNotMatch(
    writerBoundary,
    /com\.docker\.compose\.project=/,
    "the running API check must be host-wide, not project-scoped",
  );

  const backupFunction = wrapper.slice(
    wrapper.indexOf("create_verified_apply_backup()"),
    wrapper.indexOf("\nverify_local_api_image\n"),
  );
  const backupPreflights = [
    ...backupFunction.matchAll(/\n  run_production_preflight\n/g),
  ].map((match) => match.index);
  assert.equal(backupPreflights.length, 2);
  const backupCommand = backupFunction.indexOf(
    "bash scripts/production-backup.sh",
  );
  assert.ok(backupPreflights[0] < backupCommand);
  assert.ok(backupPreflights[1] > backupCommand);

  const execution = wrapper.slice(
    wrapper.indexOf("\nverify_local_api_image\n"),
  );
  const initialPreflight = execution.indexOf("run_production_preflight");
  const databaseAttestation = execution.indexOf(
    "verify_physical_database_binding",
  );
  const backupGate = execution.indexOf('if [ "$action" = "apply" ]');
  const roleGate = execution.indexOf("verify_runtime_database_roles");
  const finalPreflight = execution.lastIndexOf("run_production_preflight");
  const finalWriterBoundary = execution.lastIndexOf(
    "verify_idp_writer_boundary",
  );
  const preTargetInputAttestation = execution.indexOf(
    "verify_reviewed_inputs_unchanged",
    finalWriterBoundary,
  );
  const boundaryInputAttestation = execution.lastIndexOf(
    "verify_reviewed_inputs_unchanged",
  );
  const finalDatabaseAttestation = execution.lastIndexOf(
    "verify_physical_database_binding",
  );
  const finalPreRunRoleGate = execution.indexOf(
    "verify_runtime_database_roles",
    finalDatabaseAttestation,
  );
  const finalImageAttestation = execution.lastIndexOf("verify_local_api_image");
  const imagePin = execution.indexOf(
    "pin_verified_maintenance_image",
    finalImageAttestation,
  );
  const maintenanceRun = execution.indexOf(
    '"${pinned_compose[@]}" --profile maintenance run --rm --no-deps --pull never -T',
  );
  const postconditionGate = execution.indexOf(
    "verify_idp_encryption_postcondition",
    maintenanceRun,
  );
  const postconditionRoleGate = execution.indexOf(
    "verify_runtime_database_roles",
    postconditionGate,
  );
  assert.ok(initialPreflight < databaseAttestation);
  assert.ok(databaseAttestation < backupGate);
  assert.ok(backupGate < roleGate);
  assert.ok(roleGate < finalPreflight);
  assert.ok(finalPreflight < finalWriterBoundary);
  assert.ok(finalWriterBoundary < preTargetInputAttestation);
  assert.ok(preTargetInputAttestation < finalDatabaseAttestation);
  assert.ok(finalDatabaseAttestation < finalPreRunRoleGate);
  assert.ok(finalPreRunRoleGate < finalImageAttestation);
  assert.ok(finalImageAttestation < imagePin);
  assert.ok(imagePin < boundaryInputAttestation);
  assert.ok(boundaryInputAttestation < maintenanceRun);
  assert.ok(maintenanceRun < postconditionGate);
  assert.ok(postconditionGate < postconditionRoleGate);

  const statusCapture = execution.indexOf(
    "maintenance_exit_status=$?",
    maintenanceRun,
  );
  const originalStatusExit = execution.indexOf(
    'if [ "$maintenance_exit_status" -ne 0 ]',
    maintenanceRun,
  );
  const postconditionStatusExit = execution.indexOf(
    'if [ "$postcondition_exit_status" -ne 0 ]',
    originalStatusExit,
  );
  assert.ok(statusCapture > maintenanceRun);
  assert.ok(postconditionGate > statusCapture);
  assert.ok(originalStatusExit > postconditionRoleGate);
  assert.ok(postconditionStatusExit > originalStatusExit);
});

test("IDP backfill runner never emits caught exception details", () => {
  const runner = read("apps/api/scripts/backfill-idp-credentials.ts");
  const catchBoundary = runner.slice(runner.lastIndexOf(".catch("));
  assert.match(
    catchBoundary,
    /console\.error\('IDP credential backfill failed'\)/,
  );
  assert.doesNotMatch(
    catchBoundary,
    /error\.message|String\(error\)|JSON\.stringify/,
  );
});

test("maintenance preflight permits only one reviewed exited API and retains the disk floor", () => {
  const preflight = read("scripts/production-deploy-preflight.sh");
  assert.match(preflight, /--allow-stopped-api-maintenance/);
  assert.match(
    preflight,
    /--skip-health and --allow-stopped-api-maintenance are mutually exclusive/,
  );
  assert.match(preflight, /\[ "\$DISK_PATH" != "\/" \]/);
  assert.match(preflight, /\[ "\$MIN_FREE_GIB" -lt 30 \]/);
  assert.match(
    preflight,
    /\[ "\$service" = "api" \].*\[ "\$status" = "exited" \]/s,
  );
  assert.match(preflight, /api_container_count.*-ne 1/s);
  assert.match(preflight, /stopped_api_count.*-ne 1/s);
  assert.match(preflight, /maintenance_api=exited/);
  assert.match(preflight, /CONTAINER INVENTORY FAILED/);
  assert.doesNotMatch(preflight, /mapfile -t containers < <\(/);
});

test("immutable API image contains compiled copies of the reviewed maintenance scripts", () => {
  const dockerfile = read("apps/api/Dockerfile");
  const dockerignore = read("apps/api/.dockerignore");
  const compose = read("infra/docker-compose.publish.yml");
  const tsconfig = JSON.parse(read("apps/api/tsconfig.maintenance.json"));
  assert.match(dockerfile, /tsc --project tsconfig\.maintenance\.json/);
  assert.match(
    dockerfile,
    /--from=builder \/app\/dist-maintenance \.\/dist-maintenance/,
  );
  assert.deepEqual(tsconfig.include, [
    "scripts/backfill-idp-credentials.ts",
    "scripts/rotate-youtube-token-encryption.ts",
  ]);
  assert.match(dockerignore, /^dist-maintenance$/m);
  for (const buildArgument of [
    "ARENZYRA_RELEASE_ID",
    "ARENZYRA_SOURCE_DIGEST",
    "ARENZYRA_GIT_COMMIT",
    "ARENZYRA_BUILD_AT",
    "ARENZYRA_BUILD_SOURCE",
  ]) {
    assert.match(dockerfile, new RegExp(`^ARG ${buildArgument}=`, "m"));
    assert.match(compose, new RegExp(`^        ${buildArgument}:`, "m"));
  }
  for (const imageLabel of [
    "org.opencontainers.image.version",
    "org.opencontainers.image.revision",
    "org.opencontainers.image.created",
    "com.arenzyra.source-digest",
    "com.arenzyra.release-source",
  ]) {
    assert.match(dockerfile, new RegExp(`^LABEL ${imageLabel}=`, "m"));
  }

  const idpService = compose.slice(
    compose.indexOf("  api-maintenance-idp-read:"),
    compose.indexOf("  api-maintenance-youtube-read:"),
  );
  const youtubeService = compose.slice(
    compose.indexOf("  api-maintenance-youtube-read:"),
    compose.indexOf("  media-ai:"),
  );
  for (const service of [idpService, youtubeService]) {
    assert.match(service, /profiles: \["maintenance"\]/);
    assert.match(service, /read_only: true/);
    assert.match(service, /no-new-privileges:true/);
    assert.doesNotMatch(service, /^    build:/m);
    assert.doesNotMatch(service, /^    volumes:/m);
    assert.doesNotMatch(service, /^    ports:/m);
    assert.doesNotMatch(service, /JWT_SECRET|SUPERADMIN|COLLECTOR|PCOB_SECRET/);
  }
  assert.match(
    idpService,
    /dist-maintenance\/scripts\/backfill-idp-credentials\.js/,
  );
  assert.doesNotMatch(idpService, /YOUTUBE_TOKEN/);
  assert.match(
    youtubeService,
    /dist-maintenance\/scripts\/rotate-youtube-token-encryption\.js/,
  );
  assert.doesNotMatch(youtubeService, /IDP_CREDENTIAL/);

  const manifest = JSON.parse(read("package.json"));
  assert.equal(
    manifest.scripts["deploy:api-maintenance"],
    "bash scripts/production-api-maintenance.sh",
  );
  assert.equal(
    manifest.scripts["test:production-api-maintenance"],
    "node --test scripts/production-api-maintenance.test.cjs",
  );
  assert.equal(
    manifest.scripts["deploy:ps"],
    "bash scripts/production-compose-observe.sh ps",
  );
  assert.equal(
    manifest.scripts["deploy:logs"],
    "bash scripts/production-compose-observe.sh logs",
  );
});

test("API maintenance runners use bounded server, lock, query, and connection timeouts", () => {
  const poolOptions = read(
    "apps/api/src/common/db/maintenance-pool-options.ts",
  );
  for (const runner of [
    "apps/api/scripts/backfill-idp-credentials.ts",
    "apps/api/scripts/rotate-youtube-token-encryption.ts",
  ]) {
    const source = read(runner);
    assert.match(
      source,
      /maintenancePoolConfig\(connectionString, \{ readOnly: !apply \}\)/,
    );
    assert.match(source, /current_setting\('default_transaction_read_only'\)/);
    assert.match(source, /readOnly !== 'on'/);
  }
  assert.match(poolOptions, /startupUrl\.searchParams\.delete/);
  assert.match(poolOptions, /connectionString: startupUrl\.toString\(\)/);
  assert.match(poolOptions, /-c default_transaction_read_only=on/);
  assert.match(poolOptions, /options: startupOptions/);
  assert.match(poolOptions, /connectionTimeoutMillis: 10_000/);
  assert.match(poolOptions, /statementTimeoutMillis: 120_000/);
  assert.match(poolOptions, /lockTimeoutMillis: 10_000/);
  assert.match(poolOptions, /idleInTransactionSessionTimeoutMillis: 30_000/);
  assert.match(poolOptions, /queryTimeoutMillis: 130_000/);
  assert.match(poolOptions, /statement_timeout:/);
  assert.match(poolOptions, /lock_timeout:/);
  assert.match(poolOptions, /idle_in_transaction_session_timeout:/);
  assert.match(poolOptions, /query_timeout:/);
});

test("IDP apply keeps the stopped-writer, exact-constraint, serializable CAS boundary", () => {
  const runner = read("apps/api/scripts/backfill-idp-credentials.ts");
  const cipher = read("apps/api/src/common/crypto/credential-cipher.util.ts");
  const wrapper = read("scripts/production-api-maintenance.sh");
  assert.match(runner, /if \(encryptionSecret\.length < 32\)/);
  assert.doesNotMatch(runner, /if \(apply && encryptionSecret\.length < 32\)/);
  assert.match(runner, /const invalidEncrypted = encrypted\.filter/);
  assert.doesNotMatch(runner, /const invalidEncrypted = apply/);
  assert.match(runner, /invalidEncryptedSchedules:/);
  assert.doesNotMatch(runner, /candidateIds|candidateIdsTruncated/);
  assert.match(runner, /prisma\.\$transaction/);
  assert.match(
    runner,
    /const IDP_ENVELOPE_CONSTRAINT =\s+'DiscordIdpSchedule_roomPassword_v1_envelope_check'/,
  );
  assert.match(
    runner,
    /const IDP_ENVELOPE_SQL_PATTERN =\s+'\^v1:\[A-Za-z0-9_-\]\{16\}:\[A-Za-z0-9_-\]\{22\}:\[A-Za-z0-9_-\]\*\$'/,
  );
  assert.match(runner, /pg_get_constraintdef\(constraint\.oid, true\)/);
  assert.match(runner, /constraint\.conname = \$\{IDP_ENVELOPE_CONSTRAINT\}/);
  assert.match(runner, /constraint\.conislocal/);
  assert.match(runner, /constraint\.coninhcount = 0/);
  assert.match(runner, /constraint\.conparentid = 0/);
  assert.match(runner, /NOT constraint\.connoinherit/);
  assert.match(
    runner,
    /constraint\.conkey = ARRAY\[attribute\.attnum\]::smallint\[\]/,
  );
  assert.match(runner, /envelopeConstraints\.length === 1/);
  assert.match(runner, /IDP_ENVELOPE_CONSTRAINT_DEFINITIONS\.has\(/);
  assert.doesNotMatch(runner, /definition\.includes\(/);
  assert.doesNotMatch(runner, /LOCK TABLE|ACCESS EXCLUSIVE/);

  const transactionRead = runner.indexOf(
    "const transactionState = await inspectState(transaction)",
  );
  const firstCasUpdate = runner.indexOf(
    "transaction.discordIdpSchedule.updateMany",
    transactionRead,
  );
  const casWhere = runner.slice(
    firstCasUpdate,
    runner.indexOf("data:", firstCasUpdate),
  );
  for (const key of ["id", "roomPassword", "updatedAt"]) {
    assert.match(casWhere, new RegExp(`${key}: schedule\\.${key}`));
  }
  const casCountCheck = runner.indexOf(
    "updateResult.count !== 1",
    firstCasUpdate,
  );
  const postconditionRead = runner.indexOf(
    "const postconditionState = await inspectState(transaction)",
    casCountCheck,
  );
  const postconditionApplicability = runner.indexOf(
    "assertApplicable(postconditionState)",
    postconditionRead,
  );
  const zeroLegacyPostcondition = runner.indexOf(
    "postconditionState.legacy.length !== 0",
    postconditionApplicability,
  );
  assert.ok(transactionRead >= 0);
  assert.ok(transactionRead < firstCasUpdate);
  assert.ok(firstCasUpdate < casCountCheck);
  assert.ok(casCountCheck < postconditionRead);
  assert.ok(postconditionRead < postconditionApplicability);
  assert.ok(postconditionApplicability < zeroLegacyPostcondition);
  assert.match(
    runner,
    /isolationLevel: Prisma\.TransactionIsolationLevel\.Serializable/,
  );
  assert.match(runner, /maxWait: 10_000/);
  assert.match(runner, /timeout: 600_000/);

  const execution = wrapper.slice(
    wrapper.indexOf("\nverify_local_api_image\n"),
  );
  const finalStoppedWriterCheck = execution.lastIndexOf(
    "verify_idp_writer_boundary",
  );
  const maintenanceRun = execution.indexOf(
    '"${pinned_compose[@]}" --profile maintenance run',
  );
  assert.ok(finalStoppedWriterCheck >= 0);
  assert.ok(finalStoppedWriterCheck < maintenanceRun);
  assert.match(wrapper, /com\.docker\.compose\.service=api/);
  assert.match(wrapper, /pg_catalog\.pg_stat_activity/);
  assert.match(cipher, /decodeCanonicalBase64Url/);
  assert.match(cipher, /iv\.length === CREDENTIAL_CIPHER_IV_BYTES/);
  assert.match(cipher, /tag\.length === 16/);
});

test("production guidance uses only the target-bound wrapper for IDP and YouTube writes", () => {
  const publish = read("infra/PUBLISH.md");
  const youtube = read("docs/YOUTUBE_TOKEN_KEY_ROTATION.md");
  assert.match(publish, /deploy:api-maintenance -- idp-credentials dry-run/);
  assert.match(
    publish,
    /idp-credentials apply[\s\\]*\n[\s\\]*--writers-stopped --confirm=BACKFILL_IDP_CREDENTIALS/,
  );
  assert.match(publish, /exactly one API container in the `exited`/);
  assert.match(publish, /fresh encrypted production backup/);
  assert.match(publish, /dedicated, network-minimized Compose service/);
  assert.match(publish, /default_transaction_read_only=on/);
  assert.match(publish, /exact NOT VALID envelope CHECK/);
  assert.match(publish, /SERIALIZABLE/);
  assert.match(publish, /compare-and-swap/);
  assert.match(
    publish,
    /final in-transaction re-read requires zero legacy rows/,
  );
  assert.doesNotMatch(publish, /ACCESS EXCLUSIVE/);
  assert.match(publish, /automatically reattests the physical target/);
  assert.doesNotMatch(publish, /npm run idp-credentials:backfill/);
  assert.match(youtube, /deploy:api-maintenance -- youtube-tokens dry-run/);
  assert.match(youtube, /deploy:api-maintenance -- youtube-tokens apply/);
  assert.match(youtube, /deploy:api-maintenance -- youtube-tokens scan/);
  assert.match(youtube, /fresh encrypted off-host backup/);
  assert.match(youtube, /dedicated read-only maintenance service/);
  assert.match(youtube, /never\s+builds or pulls an image/);
  assert.match(youtube, /default_transaction_read_only=on/);
  assert.doesNotMatch(
    youtube,
    /npm --prefix apps\/api run youtube-tokens:rotate/,
  );
});
