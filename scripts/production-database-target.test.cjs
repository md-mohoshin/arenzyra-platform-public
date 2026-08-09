"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  assertResolvedComposeTargets,
  parseEnvText,
  parsePostgresTarget,
  validateProductionDatabaseTargetContract,
} = require("./production-database-target.cjs");

function url(role, overrides = {}) {
  const host = overrides.host ?? "postgres";
  const port = overrides.port ?? "5432";
  const database = overrides.database ?? "pubg_prod";
  const schema = overrides.schema ?? "public";
  const options = overrides.options ?? `-c search_path=${schema}`;
  const query = new URLSearchParams({ schema, options });
  if (overrides.routingKey) query.append(overrides.routingKey, "elsewhere");
  const password = overrides.password ?? `private-password-for-${role}`;
  return `postgresql://${role}:${password}@${host}:${port}/${database}?${query}`;
}

function validEnv() {
  return {
    ARENZYRA_DEPLOY_COMPOSE_PROJECT: "infra",
    POSTGRES_USER: "arenzyra_admin",
    POSTGRES_PASSWORD: "admin-password-that-is-long-enough",
    POSTGRES_DB: "pubg_prod",
    DATABASE_URL: url("api_runtime"),
    MIGRATION_DATABASE_URL: url("api_migrator"),
    STUDIO_DATABASE_URL: url("studio_runtime"),
    STUDIO_MIGRATION_DATABASE_URL: url("studio_migrator"),
    MAINTENANCE_READ_DATABASE_URL: url("maintenance_read"),
    IDP_MAINTENANCE_DATABASE_URL: url("idp_maintenance"),
    YOUTUBE_MAINTENANCE_DATABASE_URL: url("youtube_maintenance"),
  };
}

function validCompose(env = validEnv()) {
  return {
    services: {
      postgres: { environment: { POSTGRES_DB: env.POSTGRES_DB } },
      api: {
        environment: { DATABASE_URL: env.DATABASE_URL },
        extra_hosts: { "host.docker.internal": "host-gateway" },
      },
      "api-migrate": {
        environment: { DATABASE_URL: env.MIGRATION_DATABASE_URL },
      },
      web: {
        environment: { STUDIO_DATABASE_URL: env.STUDIO_DATABASE_URL },
        extra_hosts: ["host.docker.internal:host-gateway"],
      },
      "studio-migrate": {
        environment: {
          STUDIO_MIGRATION_DATABASE_URL: env.STUDIO_MIGRATION_DATABASE_URL,
        },
      },
    },
  };
}

test("production database targets share one explicit backed-up identity", () => {
  const result = validateProductionDatabaseTargetContract(validEnv());
  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    parsePostgresTarget("DATABASE_URL", validEnv().DATABASE_URL),
    {
      host: "postgres",
      port: "5432",
      database: "pubg_prod",
      schema: "public",
    },
  );
});

test("production database contract includes the reviewed Compose project", () => {
  const missing = validEnv();
  delete missing.ARENZYRA_DEPLOY_COMPOSE_PROJECT;
  assert.match(
    validateProductionDatabaseTargetContract(missing).errors.join(" "),
    /COMPOSE_PROJECT/,
  );

  const unsafe = validEnv();
  unsafe.ARENZYRA_DEPLOY_COMPOSE_PROJECT = "other/project";
  assert.match(
    validateProductionDatabaseTargetContract(unsafe).errors.join(" "),
    /COMPOSE_PROJECT/,
  );
});

test("production database contract fails closed when any role URL is absent", () => {
  for (const key of [
    "DATABASE_URL",
    "MIGRATION_DATABASE_URL",
    "STUDIO_DATABASE_URL",
    "STUDIO_MIGRATION_DATABASE_URL",
    "MAINTENANCE_READ_DATABASE_URL",
    "IDP_MAINTENANCE_DATABASE_URL",
    "YOUTUBE_MAINTENANCE_DATABASE_URL",
  ]) {
    const env = validEnv();
    delete env[key];
    assert.match(
      validateProductionDatabaseTargetContract(env).errors.join(" "),
      new RegExp(`${key} is required`),
      key,
    );
  }
});

test("production database target contract fails closed on every identity drift", () => {
  for (const [key, replacement] of [
    ["MIGRATION_DATABASE_URL", url("api_migrator", { host: "other" })],
    ["STUDIO_DATABASE_URL", url("studio_runtime", { port: "5433" })],
    [
      "STUDIO_MIGRATION_DATABASE_URL",
      url("studio_migrator", { database: "other_db" }),
    ],
    ["STUDIO_DATABASE_URL", url("studio_runtime", { schema: "studio" })],
    [
      "MAINTENANCE_READ_DATABASE_URL",
      url("maintenance_read", { database: "other_db" }),
    ],
    ["IDP_MAINTENANCE_DATABASE_URL", url("idp_maintenance", { host: "other" })],
    [
      "YOUTUBE_MAINTENANCE_DATABASE_URL",
      url("youtube_maintenance", { port: "5433" }),
    ],
  ]) {
    const env = validEnv();
    env[key] = replacement;
    const result = validateProductionDatabaseTargetContract(env);
    assert.ok(result.errors.length > 0, key);
    assert.doesNotMatch(result.errors.join(" "), /private-password/);
  }
});

test("all database roles and strong credentials must remain separated", () => {
  const sharedRole = validEnv();
  sharedRole.STUDIO_DATABASE_URL = url("api_runtime");
  assert.match(
    validateProductionDatabaseTargetContract(sharedRole).errors.join(" "),
    /roles must be distinct/,
  );

  const sharedPassword = validEnv();
  sharedPassword.STUDIO_DATABASE_URL = url("studio_runtime", {
    password: "private-password-for-api_runtime",
  });
  assert.match(
    validateProductionDatabaseTargetContract(sharedPassword).errors.join(" "),
    /distinct secrets/,
  );

  const shortPassword = validEnv();
  shortPassword.MIGRATION_DATABASE_URL = url("api_migrator", {
    password: "too-short",
  });
  assert.match(
    validateProductionDatabaseTargetContract(shortPassword).errors.join(" "),
    /at least 24 bytes/,
  );

  const sharedMaintenanceRole = validEnv();
  sharedMaintenanceRole.IDP_MAINTENANCE_DATABASE_URL = url("api_runtime");
  assert.match(
    validateProductionDatabaseTargetContract(sharedMaintenanceRole).errors.join(
      " ",
    ),
    /seven application roles must be distinct/,
  );
});

test("database URLs reject query routing overrides and conflicting search paths", () => {
  for (const value of [
    url("api_runtime", { routingKey: "host" }),
    url("api_runtime", { routingKey: "port" }),
    url("api_runtime", { routingKey: "service" }),
    url("api_runtime", { routingKey: "password" }),
    url("api_runtime", { routingKey: "passfile" }),
    url("api_runtime", { routingKey: "sslpassword" }),
    url("api_runtime", { routingKey: "application_name" }),
    url("api_runtime", { options: "-c search_path=other" }),
  ]) {
    assert.throws(() => parsePostgresTarget("DATABASE_URL", value));
  }
});

test("production environment rejects duplicate keys before helpers can disagree", () => {
  assert.throws(
    () => parseEnvText("DATABASE_URL=first\nDATABASE_URL=second\n"),
    /defined more than once/,
  );
});

test("resolved Compose services receive exactly the reviewed database URLs", () => {
  const env = validEnv();
  const compose = validCompose(env);
  assert.doesNotThrow(() => assertResolvedComposeTargets(compose, env));
  compose.services.api.environment.DATABASE_URL = url("wrong_role");
  assert.throws(() => assertResolvedComposeTargets(compose, env));
});

test("resolved Compose database consumers reject alternate routing", () => {
  const env = validEnv();
  const mutations = [
    (compose) => {
      compose.services.api.networks = { default: { aliases: ["postgres"] } };
    },
    (compose) => {
      compose.services.api.network_mode = "host";
    },
    (compose) => {
      compose.services["api-migrate"].links = ["other:postgres"];
    },
    (compose) => {
      compose.services.web.dns_search = ["attacker.invalid"];
    },
    (compose) => {
      compose.services.web.extra_hosts = ["postgres:203.0.113.10"];
    },
    (compose) => {
      compose.services.api.environment.PGHOST = "other";
    },
    (compose) => {
      compose.services.unreviewed = {
        environment: { DATABASE_URL: env.DATABASE_URL },
      };
    },
  ];
  for (const mutate of mutations) {
    const compose = validCompose(env);
    mutate(compose);
    assert.throws(() => assertResolvedComposeTargets(compose, env));
  }
});

test("resolved Compose rejects unsupported API maintenance consumers", () => {
  const env = validEnv();
  for (const serviceName of [
    "api-maintenance-idp-read",
    "api-maintenance-idp-apply",
    "api-maintenance-youtube-read",
    "api-maintenance-youtube-apply",
  ]) {
    const compose = validCompose(env);
    compose.services[serviceName] = {
      environment: { DATABASE_URL: env.MAINTENANCE_READ_DATABASE_URL },
    };
    assert.throws(
      () => assertResolvedComposeTargets(compose, env),
      /unsupported API maintenance services/,
    );
  }
});
