#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DATABASE_URL_KEYS = [
  "DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "STUDIO_DATABASE_URL",
  "STUDIO_MIGRATION_DATABASE_URL",
  "MAINTENANCE_READ_DATABASE_URL",
  "IDP_MAINTENANCE_DATABASE_URL",
  "YOUTUBE_MAINTENANCE_DATABASE_URL",
];
const SAFE_DATABASE_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,62}$/;
const SAFE_SCHEMA_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const SAFE_ROLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const SAFE_COMPOSE_PROJECT = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const ALLOWED_QUERY_PARAMETERS = new Set(["schema", "options"]);

function parseEnvText(text) {
  const env = Object.create(null);
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const normalized = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trim()
      : trimmed;
    const equalsAt = normalized.indexOf("=");
    if (equalsAt < 1) {
      throw new Error(`Environment line ${index + 1} is not KEY=value.`);
    }
    const key = normalized.slice(0, equalsAt).trim();
    if (Object.hasOwn(env, key)) {
      throw new Error(`Environment key ${key} is defined more than once.`);
    }
    let value = normalized.slice(equalsAt + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function parsePostgresTarget(name, value) {
  if (!value) throw new Error(`${name} is required.`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid PostgreSQL URL.`);
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error(`${name} must use PostgreSQL.`);
  }
  if (!parsed.hostname || !parsed.username || !parsed.pathname) {
    throw new Error(`${name} is missing a required connection component.`);
  }
  if (parsed.hash) throw new Error(`${name} must not contain a URL fragment.`);

  let username;
  let password;
  let database;
  try {
    username = decodeURIComponent(parsed.username);
    password = decodeURIComponent(parsed.password);
    database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  } catch {
    throw new Error(`${name} contains invalid percent encoding.`);
  }
  if (
    !SAFE_ROLE_NAME.test(username) ||
    !password ||
    /[\0\r\n]/.test(password)
  ) {
    throw new Error(`${name} has an unsafe or missing database credential.`);
  }
  for (const key of parsed.searchParams.keys()) {
    if (!ALLOWED_QUERY_PARAMETERS.has(key)) {
      throw new Error(`${name} contains an unreviewed query parameter.`);
    }
  }
  const schemas = parsed.searchParams.getAll("schema");
  const options = parsed.searchParams.getAll("options");
  if (!SAFE_DATABASE_NAME.test(database)) {
    throw new Error(`${name} has an unsupported database name.`);
  }
  if (schemas.length !== 1 || !SAFE_SCHEMA_NAME.test(schemas[0])) {
    throw new Error(`${name} must contain one explicit safe schema parameter.`);
  }
  if (schemas[0] !== "public") {
    throw new Error(`${name} must use the supported production schema public.`);
  }
  const expectedOptions = `-c search_path=${schemas[0]}`;
  if (options.length !== 1 || options[0] !== expectedOptions) {
    throw new Error(
      `${name} must contain one options parameter matching its schema search_path.`,
    );
  }

  const port = parsed.port || "5432";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error(`${name} has an invalid PostgreSQL port.`);
  }
  return {
    host: parsed.hostname.toLowerCase(),
    port: String(Number(port)),
    database,
    schema: schemas[0],
  };
}

function identity(target) {
  return [target.host, target.port, target.database, target.schema].join(
    "\u0000",
  );
}

function validateProductionDatabaseTargetContract(env) {
  const errors = [];
  const targets = {};
  const credentials = {};
  const composeProject = env.ARENZYRA_DEPLOY_COMPOSE_PROJECT ?? "";
  for (const key of DATABASE_URL_KEYS) {
    if (!env[key]) continue;
    try {
      targets[key] = parsePostgresTarget(key, env[key]);
      const parsed = new URL(env[key]);
      credentials[key] = {
        username: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
      };
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (!env.POSTGRES_DB) {
    errors.push("POSTGRES_DB is required for production database binding.");
  } else if (!SAFE_DATABASE_NAME.test(env.POSTGRES_DB)) {
    errors.push("POSTGRES_DB has an unsupported database name.");
  }
  if (!SAFE_ROLE_NAME.test(env.POSTGRES_USER ?? "")) {
    errors.push("POSTGRES_USER must be one explicit safe administrator role.");
  }
  if (
    Buffer.byteLength(env.POSTGRES_PASSWORD ?? "", "utf8") < 24 ||
    /[\0\r\n]/.test(env.POSTGRES_PASSWORD ?? "")
  ) {
    errors.push(
      "POSTGRES_PASSWORD must be a safe secret of at least 24 bytes.",
    );
  }
  if (!SAFE_COMPOSE_PROJECT.test(composeProject)) {
    errors.push(
      "ARENZYRA_DEPLOY_COMPOSE_PROJECT must be one explicit safe project name.",
    );
  }

  const missingDatabaseUrls = DATABASE_URL_KEYS.filter((key) => !env[key]);
  for (const key of missingDatabaseUrls) {
    errors.push(`${key} is required.`);
  }
  if (missingDatabaseUrls.length > 0) {
    return { errors, targets, composeProject };
  }
  if (DATABASE_URL_KEYS.some((key) => !targets[key])) {
    return { errors, targets, composeProject };
  }

  const urlCredentials = DATABASE_URL_KEYS.map((key) => credentials[key]);
  if (
    new Set(urlCredentials.map(({ username }) => username)).size !==
      DATABASE_URL_KEYS.length ||
    urlCredentials.some(({ username }) => username === env.POSTGRES_USER)
  ) {
    errors.push(
      "PostgreSQL administrator and all seven application roles must be distinct.",
    );
  }
  const allPasswords = [
    env.POSTGRES_PASSWORD ?? "",
    ...urlCredentials.map(({ password }) => password),
  ];
  if (
    allPasswords.some((password) => Buffer.byteLength(password, "utf8") < 24)
  ) {
    errors.push("Every PostgreSQL credential must be at least 24 bytes.");
  }
  if (new Set(allPasswords).size !== allPasswords.length) {
    errors.push("All eight PostgreSQL credentials must use distinct secrets.");
  }

  const expected = targets.DATABASE_URL;
  if (expected.host !== "postgres") {
    errors.push("DATABASE_URL must target the Compose PostgreSQL host.");
  }
  if (expected.port !== "5432") {
    errors.push("DATABASE_URL must use the Compose PostgreSQL port 5432.");
  }
  if (expected.database !== env.POSTGRES_DB) {
    errors.push("DATABASE_URL database must exactly match POSTGRES_DB.");
  }
  for (const key of DATABASE_URL_KEYS.slice(1)) {
    if (identity(targets[key]) !== identity(expected)) {
      errors.push(
        `${key} must target the exact same backed-up host, port, database, and schema as DATABASE_URL.`,
      );
    }
  }
  return { errors, targets, composeProject };
}

function composeEnvironment(service) {
  if (!service || typeof service !== "object") return {};
  if (Array.isArray(service.environment)) {
    return Object.fromEntries(
      service.environment.map((entry) => {
        const equalsAt = String(entry).indexOf("=");
        return equalsAt < 0
          ? [String(entry), ""]
          : [
              String(entry).slice(0, equalsAt),
              String(entry).slice(equalsAt + 1),
            ];
      }),
    );
  }
  return service.environment ?? {};
}

function hasConfiguredValue(value) {
  if (value == null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function assertDefaultNetworkOnly(serviceName, service) {
  const networks = service.networks;
  if (networks == null) return;
  if (Array.isArray(networks)) {
    if (networks.length === 1 && networks[0] === "default") return;
    throw new Error(`${serviceName} must use only the default network.`);
  }
  if (typeof networks !== "object") {
    throw new Error(`${serviceName} has an invalid network binding.`);
  }
  const names = Object.keys(networks);
  const defaultConfig = networks.default;
  if (
    names.length !== 1 ||
    names[0] !== "default" ||
    (defaultConfig != null &&
      (typeof defaultConfig !== "object" ||
        Object.keys(defaultConfig).length !== 0))
  ) {
    throw new Error(
      `${serviceName} must use the default network without aliases or overrides.`,
    );
  }
}

function normalizedExtraHosts(serviceName, value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((entry) => {
      const text = String(entry);
      const separator = text.includes("=") ? "=" : ":";
      const at = text.indexOf(separator);
      if (at <= 0) {
        throw new Error(`${serviceName} has an invalid extra_hosts entry.`);
      }
      return [text.slice(0, at), text.slice(at + 1)];
    });
  }
  if (typeof value === "object") return Object.entries(value);
  throw new Error(`${serviceName} has an invalid extra_hosts binding.`);
}

function assertConsumerRouting(serviceName, service, allowHostGateway) {
  assertDefaultNetworkOnly(serviceName, service);
  for (const key of [
    "network_mode",
    "links",
    "external_links",
    "dns",
    "dns_search",
  ]) {
    if (hasConfiguredValue(service[key])) {
      throw new Error(
        `${serviceName} contains forbidden routing field ${key}.`,
      );
    }
  }

  const extraHosts = normalizedExtraHosts(serviceName, service.extra_hosts);
  const expected = [["host.docker.internal", "host-gateway"]];
  if (
    extraHosts.length > (allowHostGateway ? 1 : 0) ||
    extraHosts.some(
      ([host, target], index) =>
        !allowHostGateway ||
        host !== expected[index][0] ||
        target !== expected[index][1],
    )
  ) {
    throw new Error(`${serviceName} contains an unreviewed extra_hosts route.`);
  }

  const environment = composeEnvironment(service);
  for (const key of [
    "PGHOST",
    "PGPORT",
    "PGDATABASE",
    "PGSERVICE",
    "PGSERVICEFILE",
    "PGPASSFILE",
  ]) {
    if (Object.hasOwn(environment, key)) {
      throw new Error(
        `${serviceName} contains forbidden libpq routing ${key}.`,
      );
    }
  }
}

function assertResolvedComposeTargets(compose, env) {
  const services = compose?.services ?? {};
  const bindings = [
    ["api", "DATABASE_URL", "DATABASE_URL", true],
    ["api-migrate", "DATABASE_URL", "MIGRATION_DATABASE_URL", false],
    [
      "api-maintenance-idp-dry-run",
      "DATABASE_URL",
      "MAINTENANCE_READ_DATABASE_URL",
      false,
    ],
    [
      "api-maintenance-idp-apply",
      "DATABASE_URL",
      "IDP_MAINTENANCE_DATABASE_URL",
      false,
    ],
    [
      "api-maintenance-idp-validate",
      "DATABASE_URL",
      "MIGRATION_DATABASE_URL",
      false,
    ],
    ["web", "STUDIO_DATABASE_URL", "STUDIO_DATABASE_URL", true],
    [
      "studio-migrate",
      "STUDIO_MIGRATION_DATABASE_URL",
      "STUDIO_MIGRATION_DATABASE_URL",
      false,
    ],
  ];
  const reviewedServiceNames = new Set(bindings.map(([name]) => name));
  const unsupportedMaintenanceServices = Object.keys(services).filter(
    (serviceName) =>
      serviceName.startsWith("api-maintenance-") &&
      !reviewedServiceNames.has(serviceName),
  );
  if (unsupportedMaintenanceServices.length > 0) {
    throw new Error(
      "Resolved Compose advertises unsupported API maintenance services.",
    );
  }

  const postgresDatabase = composeEnvironment(services.postgres).POSTGRES_DB;
  if (postgresDatabase !== env.POSTGRES_DB) {
    throw new Error("Resolved Compose postgres is not bound to POSTGRES_DB.");
  }

  const databaseEnvironmentKeys = new Set(DATABASE_URL_KEYS);
  for (const [serviceName, service] of Object.entries(services)) {
    const environment = composeEnvironment(service);
    if (
      !reviewedServiceNames.has(serviceName) &&
      Object.keys(environment).some((key) => databaseEnvironmentKeys.has(key))
    ) {
      throw new Error(
        `Resolved Compose contains unreviewed database consumer ${serviceName}.`,
      );
    }
  }

  for (const [serviceName, serviceKey, envKey, allowHostGateway] of bindings) {
    const service = services[serviceName];
    const environment = composeEnvironment(service);
    const actual = environment[serviceKey];
    if (typeof actual !== "string" || actual !== env[envKey]) {
      throw new Error(
        `Resolved Compose service ${serviceName} is not bound to ${envKey}.`,
      );
    }
    for (const key of databaseEnvironmentKeys) {
      if (key !== serviceKey && Object.hasOwn(environment, key)) {
        throw new Error(
          `Resolved Compose service ${serviceName} contains unreviewed database binding ${key}.`,
        );
      }
    }
    assertConsumerRouting(serviceName, service, allowHostGateway);
  }
}

function envFromFile(envFile) {
  return parseEnvText(fs.readFileSync(path.resolve(envFile), "utf8"));
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main() {
  try {
    const envFile = argumentValue("--env");
    if (!envFile) throw new Error("--env is required.");
    const env = envFromFile(envFile);
    const result = validateProductionDatabaseTargetContract(env);
    if (result.errors.length > 0) throw new Error(result.errors.join(" "));

    if (process.argv.includes("--check")) {
      process.stdout.write("PRODUCTION DATABASE TARGET CONTRACT VERIFIED\n");
      return;
    }
    const printTarget = argumentValue("--print");
    if (printTarget) {
      const key = printTarget === "api" ? "DATABASE_URL" : null;
      if (!key) throw new Error("--print supports only api.");
      const target = result.targets[key];
      process.stdout.write(
        `${target.host}\n${target.port}\n${target.database}\n${target.schema}\n`,
      );
      return;
    }
    if (process.argv.includes("--assert-compose-json")) {
      let compose;
      try {
        compose = JSON.parse(fs.readFileSync(0, "utf8"));
      } catch {
        throw new Error("Resolved Compose JSON is invalid.");
      }
      assertResolvedComposeTargets(compose, env);
      return;
    }
    throw new Error("A check or assertion mode is required.");
  } catch (error) {
    process.stderr.write(
      `PRODUCTION DATABASE TARGET CONTRACT BLOCKED: ${error.message}\n`,
    );
    process.exitCode = 75;
  }
}

if (require.main === module) main();

module.exports = {
  assertResolvedComposeTargets,
  parseEnvText,
  parsePostgresTarget,
  validateProductionDatabaseTargetContract,
};
