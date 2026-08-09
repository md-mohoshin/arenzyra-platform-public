"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const {
  findSensitiveBuildArguments,
  hasSensitiveComposeLabel,
  validateEnvRelationships,
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
