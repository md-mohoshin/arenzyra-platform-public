"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const {
  findSensitiveBuildArguments,
  hasSensitiveComposeLabel,
  validateLauncherReleaseConfig,
  validateStudioDatabaseTls,
  validateEnvRelationships,
  validateUnsupportedApiMaintenanceServices,
} = require("./preflight-publish.cjs");

const repositoryRoot = path.resolve(__dirname, "..");

test("publish preflight validates the template without pathological regex work", () => {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/preflight-publish.cjs",
      "--env",
      "infra/.env.publish.example",
      "--allow-placeholders",
      "--skip-compose",
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 5_000,
    },
  );

  assert.equal(result.error?.code, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /IDP_CREDENTIAL_ENCRYPTION_KEY/);
  assert.match(result.stdout, /SUPERADMIN_MFA_ENCRYPTION_KEY/);
  assert.match(result.stdout, /YOUTUBE_TOKEN_ENCRYPTION_KEY/);
  assert.match(result.stdout, /\[publish-preflight\] OK/);
});

test("publish preflight finds sensitive build args without crossing YAML scopes", () => {
  const compose = `services:
  api:
    build:
      context: .
      args:
        SAFE_BUILD_VALUE: okay
        JWT_SECRET: forbidden
    environment:
      JWT_SECRET: runtime-only
  web:
    build:
      args:
        PUBLIC_VALUE: okay
`;
  assert.deepEqual(
    findSensitiveBuildArguments(compose, ["JWT_SECRET", "DATABASE_URL"]),
    ["JWT_SECRET"],
  );
});

test("publish preflight rejects every unsupported API maintenance surface", () => {
  for (const compose of [
    'services:\n  api-maintenance-idp-read:\n    image: "api"\n',
    'services:\n  task:\n    profiles: ["maintenance"]\n',
    'services:\n  task:\n    entrypoint: ["node", "dist-maintenance/task.js"]\n',
  ]) {
    const errors = [];
    validateUnsupportedApiMaintenanceServices(compose, errors);
    assert.equal(errors.length, 1, compose);
  }

  const errors = [];
  validateUnsupportedApiMaintenanceServices(
    'services:\n  api-migrate:\n    profiles: ["migration"]\n',
    errors,
  );
  assert.deepEqual(errors, []);
});

test("publish preflight rejects sensitive values in Compose labels", () => {
  assert.equal(
    hasSensitiveComposeLabel(
      'labels:\n  com.arenzyra.database: "${DATABASE_URL}"',
      ["DATABASE_URL"],
    ),
    true,
  );
  assert.equal(
    hasSensitiveComposeLabel('labels:\n  com.arenzyra.release: "release-123"', [
      "DATABASE_URL",
    ]),
    false,
  );
});

test("optional launcher release JSON is bounded and interpolation-safe", () => {
  const validErrors = [];
  validateLauncherReleaseConfig("", validErrors);
  validateLauncherReleaseConfig('{"schemaVersion":1}', validErrors);
  assert.deepEqual(validErrors, []);

  for (const [value, expected] of [
    ["x".repeat(16 * 1024 + 1), "must not exceed 16384 bytes"],
    ["{", "must be one valid JSON object"],
    ["[]", "must be one valid JSON object"],
    ['{"publisher":"Arenzyra$HOME"}', "interpolation markers"],
    ['{"publisher":"Arenzyra\'s"}', "literal apostrophes"],
    ['{"publisher":"Arenzyra"}\n', "compact one-line JSON"],
  ]) {
    const errors = [];
    validateLauncherReleaseConfig(value, errors);
    assert.equal(errors.length, 1, value.slice(0, 80));
    assert.match(errors[0], new RegExp(expected));
  }
});

test("publish preflight accepts only verified TLS or explicit trusted-network no-TLS modes", () => {
  for (const sslMode of [
    "",
    "true",
    "false",
    "1",
    "0",
    "require",
    "verify-ca",
    "verify-full",
    "disable",
    "disabled",
  ]) {
    const errors = [];
    validateStudioDatabaseTls(
      {
        STUDIO_DATABASE_SSL: sslMode,
        STUDIO_DATABASE_URL:
          "postgresql://studio:password@database.internal/arenzyra?application_name=studio",
      },
      errors,
    );
    assert.deepEqual(errors, [], sslMode);
  }

  for (const sslMode of ["insecure", "no-verify", "prefer", "unexpected"]) {
    const errors = [];
    validateStudioDatabaseTls({ STUDIO_DATABASE_SSL: sslMode }, errors);
    assert.equal(errors.length, 1, sslMode);
    assert.match(errors[0], /STUDIO_DATABASE_SSL/);
  }
});

test("publish preflight rejects Studio URL SSL overrides as errors without exposing values", () => {
  for (const query of [
    "ssl=true",
    "sslmode=no-verify",
    "sslcert=client.pem",
    "sslkey=client-secret.key",
    "sslrootcert=root-secret.pem",
    "sslnegotiation=direct",
    "uselibpqcompat=true",
    "%73slmode=verify-full",
  ]) {
    const errors = [];
    const credential = "preflight-password-must-not-be-logged";
    validateStudioDatabaseTls(
      {
        STUDIO_DATABASE_SSL: "verify-full",
        STUDIO_DATABASE_URL: `postgresql://studio:${credential}@database.internal/arenzyra?${query}`,
      },
      errors,
    );
    assert.equal(errors.length, 1, query);
    assert.match(
      errors[0],
      /STUDIO_DATABASE_URL must not contain SSL query parameters.*STUDIO_DATABASE_SSL.*STUDIO_DATABASE_CA/,
    );
    assert.doesNotMatch(
      errors[0],
      /preflight-password-must-not-be-logged|client-secret\.key|root-secret\.pem/,
    );
  }

  const errors = [];
  validateStudioDatabaseTls(
    {
      STUDIO_MIGRATION_DATABASE_URL:
        "postgresql://studio_migrate:secret@database.internal/arenzyra?SSLROOTCERT=private.pem",
    },
    errors,
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^STUDIO_MIGRATION_DATABASE_URL must not contain/);
  assert.doesNotMatch(errors[0], /secret|private\.pem/);
});

test("publish preflight rejects Docker and Compose process controls in publish env", () => {
  const errors = [];
  validateEnvRelationships(
    {
      DOCKER_HOST: "tcp://other-host:2375",
      DOCKER_CONTEXT: "remote-production",
      COMPOSE_PROJECT_NAME: "other-project",
    },
    errors,
    [],
  );
  assert.ok(errors.some((error) => error.startsWith("DOCKER_HOST ")));
  assert.ok(errors.some((error) => error.startsWith("DOCKER_CONTEXT ")));
  assert.ok(errors.some((error) => error.startsWith("COMPOSE_PROJECT_NAME ")));
});

test("publish preflight rejects reusing the IDP credential key", () => {
  const errors = [];
  validateEnvRelationships(
    {
      IDP_CREDENTIAL_ENCRYPTION_KEY: "same-production-secret-value",
      JWT_SECRET: "same-production-secret-value",
    },
    errors,
    [],
  );

  assert.ok(
    errors.includes("IDP_CREDENTIAL_ENCRYPTION_KEY must not reuse JWT_SECRET."),
  );
});

test("publish preflight requires MFA and distinct dedicated secrets", () => {
  const errors = [];
  validateEnvRelationships(
    {
      SUPERADMIN_MFA_REQUIRED: "false",
      SUPERADMIN_MFA_ENCRYPTION_KEY: "same-production-secret-value",
      SUPERADMIN_MFA_RECOVERY_PEPPER: "same-production-secret-value",
      JWT_SECRET: "different-production-secret",
    },
    errors,
    [],
  );

  assert.ok(
    errors.includes(
      "SUPERADMIN_MFA_REQUIRED must be exactly true in production.",
    ),
  );
  assert.ok(
    errors.includes(
      "SUPERADMIN_MFA_ENCRYPTION_KEY must not reuse SUPERADMIN_MFA_RECOVERY_PEPPER.",
    ),
  );
});

test("publish preflight requires a distinct canonical YouTube token keyring", () => {
  const errors = [];
  validateEnvRelationships(
    {
      YOUTUBE_TOKEN_ENCRYPTION_KEY_ID: "bad key id",
      YOUTUBE_TOKEN_ENCRYPTION_KEY: "same-production-secret-value-that-is-long",
      YOUTUBE_TOKEN_ENCRYPTION_PREVIOUS_KEYS: JSON.stringify({
        old: "same-production-secret-value-that-is-long",
      }),
      JWT_SECRET: "same-production-secret-value-that-is-long",
      SUPERADMIN_MFA_REQUIRED: "true",
    },
    errors,
    [],
  );

  assert.ok(
    errors.includes(
      "YOUTUBE_TOKEN_ENCRYPTION_KEY_ID must contain 1-48 letters, numbers, underscores, or hyphens.",
    ),
  );
  assert.ok(
    errors.includes("YOUTUBE_TOKEN_ENCRYPTION_KEY must not reuse JWT_SECRET."),
  );
  assert.ok(
    errors.includes(
      "YOUTUBE_TOKEN_ENCRYPTION_PREVIOUS_KEYS must not reuse key material.",
    ),
  );
});

test("publish preflight rejects unsafe Redis and EventBus capacity settings", () => {
  const errors = [];
  validateEnvRelationships(
    {
      DISTRIBUTED_RATE_LIMIT_REQUIRED: "false",
      REDIS_MAXMEMORY: "128mb",
      REDIS_READY_MAX_MEMORY_RATIO: "0.99",
      EVENT_BUS_MAX_PAYLOAD_BYTES: "1048577",
      EVENT_BUS_STREAM_MAXLEN: "99",
    },
    errors,
    [],
  );

  assert.ok(
    errors.includes(
      "DISTRIBUTED_RATE_LIMIT_REQUIRED must be exactly true in production.",
    ),
  );
  assert.ok(
    errors.includes(
      "REDIS_MAXMEMORY must be a Redis size of at least 256mb (for example 768mb).",
    ),
  );
  assert.ok(
    errors.includes(
      "REDIS_READY_MAX_MEMORY_RATIO must be between 0.5 and 0.9.",
    ),
  );
  assert.ok(
    errors.includes(
      "EVENT_BUS_MAX_PAYLOAD_BYTES must be between 1024 and 1048576.",
    ),
  );
  assert.ok(
    errors.includes("EVENT_BUS_STREAM_MAXLEN must be between 100 and 50000."),
  );
});

test("publish preflight accepts the bounded Redis and EventBus defaults", () => {
  const errors = [];
  validateEnvRelationships(
    {
      DISTRIBUTED_RATE_LIMIT_REQUIRED: "true",
      REDIS_MAXMEMORY: "768mb",
      REDIS_READY_MAX_MEMORY_RATIO: "0.85",
      EVENT_BUS_MAX_PAYLOAD_BYTES: "524288",
      EVENT_BUS_STREAM_MAXLEN: "10000",
    },
    errors,
    [],
  );

  const capacityErrors = errors.filter((error) =>
    /DISTRIBUTED_RATE_LIMIT_REQUIRED|REDIS_MAXMEMORY|REDIS_READY_MAX_MEMORY_RATIO|EVENT_BUS_MAX_PAYLOAD_BYTES|EVENT_BUS_STREAM_MAXLEN/.test(
      error,
    ),
  );
  assert.deepEqual(capacityErrors, []);
});
