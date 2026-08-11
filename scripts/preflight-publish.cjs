#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const net = require("node:net");
const { spawnSync } = require("node:child_process");
const {
  parseEnvText,
  validateProductionDatabaseTargetContract,
} = require("./production-database-target.cjs");

const repoRoot = path.resolve(__dirname, "..");
const MAX_LAUNCHER_RELEASE_CONFIG_BYTES = 16 * 1024;
const VERIFIED_STUDIO_DATABASE_SSL_MODES = new Set([
  "1",
  "true",
  "require",
  "verify-ca",
  "verify-full",
]);
const DISABLED_STUDIO_DATABASE_SSL_MODES = new Set([
  "0",
  "false",
  "disable",
  "disabled",
]);

function readFlag(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) return fallback;
  return process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function relative(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/");
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function parseEnvFile(filePath) {
  try {
    return parseEnvText(readText(filePath));
  } catch (error) {
    throw new Error(`${relative(filePath)}: ${error.message}`);
  }
}

function commandExists(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
  });
  return !result.error && result.status === 0;
}

function runCommand(command, args, env) {
  const inheritedProcessKeys = [
    "PATH",
    "Path",
    "HOME",
    "USERPROFILE",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
  ];
  const sanitizedProcessEnv = Object.fromEntries(
    inheritedProcessKeys
      .filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]]),
  );
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...sanitizedProcessEnv,
      ...env,
      ...(process.platform === "win32"
        ? {}
        : { DOCKER_HOST: "unix:///var/run/docker.sock" }),
    },
    shell: false,
  });
}

function isPlaceholder(value) {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "" ||
    normalized.includes("replace_with") ||
    normalized.includes("change_me") ||
    normalized.includes("your_") ||
    normalized === "password" ||
    normalized === "secret"
  );
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function hostFromUrl(value) {
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

function originFromUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.origin;
  } catch {
    return "";
  }
}

function validateHostOnly(name, value, errors) {
  if (!value) return;
  if (value.includes("://") || value.includes("/") || value.includes(":")) {
    errors.push(`${name} must be a host name only, for example arenzyra.com.`);
  }
  if (value === "localhost" || value === "127.0.0.1") {
    errors.push(`${name} cannot be localhost for the publish stack.`);
  }
}

function validatePostgresUrl(name, value, errors) {
  if (!value) return;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
      errors.push(`${name} must use a postgres:// or postgresql:// URL.`);
    }
    if (!parsed.hostname) errors.push(`${name} is missing a database host.`);
    if (!parsed.username) errors.push(`${name} is missing a database user.`);
    if (!parsed.pathname || parsed.pathname === "/") {
      errors.push(`${name} is missing a database name.`);
    }
  } catch {
    errors.push(`${name} is not a valid database URL.`);
  }
}

function validateHttpsOrigin(name, value, expectedHost, errors) {
  if (!value) return;
  if (!isHttpUrl(value)) {
    errors.push(`${name} must be a full http(s) URL.`);
    return;
  }

  const parsed = new URL(value);
  if (parsed.protocol !== "https:") {
    errors.push(`${name} should use https:// in the publish stack.`);
  }
  if (expectedHost && parsed.host !== expectedHost) {
    errors.push(`${name} should point at https://${expectedHost}.`);
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    errors.push(`${name} should be an origin only, without a path or query.`);
  }
}

function validateRedirect(name, value, expected, errors) {
  if (!value) return;
  if (value !== expected) {
    errors.push(`${name} should be ${expected}.`);
  }
}

function findSensitiveBuildArguments(compose, sensitiveBuildArgs) {
  const sensitiveBuildArgSet = new Set(sensitiveBuildArgs);
  const found = new Set();
  let argsIndent = null;
  for (const line of compose.split(/\r?\n/)) {
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;
    if (argsIndent !== null && trimmed && indent <= argsIndent) {
      argsIndent = null;
    }
    if (/^args:\s*$/.test(trimmed)) {
      argsIndent = indent;
      continue;
    }
    if (argsIndent !== null && indent > argsIndent) {
      const variable = trimmed.match(/^([A-Z0-9_]+):/)?.[1];
      if (variable && sensitiveBuildArgSet.has(variable)) found.add(variable);
    }
  }
  return [...found];
}

function hasSensitiveComposeLabel(compose, sensitiveVariables) {
  return compose
    .split(/\r?\n/)
    .filter((line) => /com\./i.test(line))
    .some(
      (line) =>
        /token|password|secret/i.test(line) ||
        sensitiveVariables.some((variable) =>
          line.toUpperCase().includes(variable),
        ),
    );
}

function validateStaticFiles(errors) {
  const requiredFiles = [
    "infra/docker-compose.publish.yml",
    "infra/Caddyfile",
    "infra/.env.publish.example",
    "apps/arenzyra-web/Dockerfile",
    "apps/api/Dockerfile",
  ];

  for (const file of requiredFiles) {
    if (!fs.existsSync(path.join(repoRoot, file))) {
      errors.push(`Missing required deploy file: ${file}.`);
    }
  }
}

function composeServiceBlock(compose, service) {
  return (
    compose.match(
      new RegExp(
        `\\n  ${service}:\\r?\\n([\\s\\S]*?)(?=\\n  [a-zA-Z0-9_-]+:\\r?\\n|\\nvolumes:\\r?\\n)`,
      ),
    )?.[1] ?? ""
  );
}

function validateIdpMaintenanceServices(compose, errors) {
  const specifications = Object.freeze({
    "api-maintenance-idp-dry-run": Object.freeze({
      database: "MAINTENANCE_READ_DATABASE_URL",
      entrypoint: "dist-maintenance/scripts/backfill-idp-credentials.js",
      arguments: [],
    }),
    "api-maintenance-idp-apply": Object.freeze({
      database: "IDP_MAINTENANCE_DATABASE_URL",
      entrypoint: "dist-maintenance/scripts/backfill-idp-credentials.js",
      arguments: [
        "--apply",
        "--writers-stopped",
        "--confirm=BACKFILL_IDP_CREDENTIALS",
      ],
    }),
    "api-maintenance-idp-validate": Object.freeze({
      database: "MIGRATION_DATABASE_URL",
      entrypoint:
        "dist-maintenance/scripts/validate-idp-envelope-constraint.js",
      arguments: [
        "validate",
        "--writers-stopped",
        "--confirm=VALIDATE_IDP_ENVELOPE_CONSTRAINT",
      ],
    }),
  });
  const discovered = [
    ...compose.matchAll(/^  (api-maintenance-[a-zA-Z0-9_-]+):\s*$/gm),
  ].map((match) => match[1]);
  const expected = Object.keys(specifications);
  if (
    discovered.length !== expected.length ||
    expected.some((service) => !discovered.includes(service))
  ) {
    errors.push(
      "Publish Compose maintenance services must match the exact IDP-only cutover allowlist.",
    );
  }
  if (/youtube|token-rotation|rotate-youtube/i.test(compose)) {
    const maintenanceText = discovered
      .map((service) => composeServiceBlock(compose, service))
      .join("\n");
    if (/youtube|token-rotation|rotate-youtube/i.test(maintenanceText)) {
      errors.push("Publish API maintenance must remain IDP-only.");
    }
  }

  for (const [service, specification] of Object.entries(specifications)) {
    const block = composeServiceBlock(compose, service);
    const normalized = block.replace(/\s+/g, " ");
    for (const fragment of [
      'profiles: ["maintenance"]',
      'image: "arenzyra-api:${ARENZYRA_RELEASE_ID:-unversioned}"',
      'user: "1000:1000"',
      `DATABASE_URL: "\${${specification.database}:?`,
      'IDP_CREDENTIAL_ENCRYPTION_KEY: "${IDP_CREDENTIAL_ENCRYPTION_KEY:?',
      'ARENZYRA_EXPECTED_DATABASE_NAME: "${ARENZYRA_EXPECTED_DATABASE_NAME:-UNSEALED}"',
      'ARENZYRA_EXPECTED_DATABASE_OID: "${ARENZYRA_EXPECTED_DATABASE_OID:-0}"',
      'ARENZYRA_EXPECTED_DATABASE_SYSTEM_IDENTIFIER: "${ARENZYRA_EXPECTED_DATABASE_SYSTEM_IDENTIFIER:-0}"',
      "read_only: true",
      "nodev",
      "cap_drop: - ALL",
      "security_opt: - no-new-privileges:true",
      'restart: "no"',
      "pids_limit: 64",
      "mem_limit: 512m",
      "cpus: 1.0",
    ]) {
      if (!normalized.includes(fragment.replace(/\s+/g, " "))) {
        errors.push(
          `Publish ${service} is missing its exact ${fragment} boundary.`,
        );
      }
    }
    if (
      !normalized.includes(`"node", "${specification.entrypoint}"`) ||
      specification.arguments.some(
        (argument) => !normalized.includes(`"${argument}"`),
      )
    ) {
      errors.push(
        `Publish ${service} command differs from the IDP image allowlist.`,
      );
    }
    if (
      /^    (?:build|volumes|ports|entrypoint):/m.test(block) ||
      /\b(?:npx|ts-node|\.ts\b|dist\/main|\/bin\/(?:ba)?sh)\b/.test(block) ||
      /JWT_SECRET|SUPERADMIN|COLLECTOR_SECRET|PCOB_SECRET|YOUTUBE_TOKEN/.test(
        block,
      )
    ) {
      errors.push(
        `Publish ${service} exposes an unsupported maintenance surface.`,
      );
    }
  }
}

function validateComposeWiring(errors) {
  const composePath = path.join(repoRoot, "infra/docker-compose.publish.yml");
  const caddyPath = path.join(repoRoot, "infra/Caddyfile");
  if (!fs.existsSync(composePath) || !fs.existsSync(caddyPath)) return;

  const compose = readText(composePath);
  const caddy = readText(caddyPath);
  const deployText = `${compose}\n${caddy}`;
  const databaseBindings = [
    ["api", "DATABASE_URL", "DATABASE_URL"],
    ["api-migrate", "DATABASE_URL", "MIGRATION_DATABASE_URL"],
    ["web", "STUDIO_DATABASE_URL", "STUDIO_DATABASE_URL"],
    [
      "studio-migrate",
      "STUDIO_MIGRATION_DATABASE_URL",
      "STUDIO_MIGRATION_DATABASE_URL",
    ],
    [
      "api-maintenance-idp-dry-run",
      "DATABASE_URL",
      "MAINTENANCE_READ_DATABASE_URL",
    ],
    [
      "api-maintenance-idp-apply",
      "DATABASE_URL",
      "IDP_MAINTENANCE_DATABASE_URL",
    ],
    ["api-maintenance-idp-validate", "DATABASE_URL", "MIGRATION_DATABASE_URL"],
  ];
  for (const [service, serviceKey, envKey] of databaseBindings) {
    const block =
      compose.match(
        new RegExp(
          `\\n  ${service}:\\r?\\n([\\s\\S]*?)(?=\\n  [a-zA-Z0-9_-]+:\\r?\\n|\\nvolumes:\\r?\\n)`,
        ),
      )?.[1] ?? "";
    if (!block.includes(`${serviceKey}: "\${${envKey}:?`)) {
      errors.push(`Publish ${service} service must receive exactly ${envKey}.`);
    }
  }
  validateIdpMaintenanceServices(compose, errors);
  const apiService = composeServiceBlock(compose, "api");
  if (
    apiService.split('PUBLIC_ORGANIZATION_APPLICATIONS_ENABLED: "false"')
      .length -
      1 !==
    1
  ) {
    errors.push(
      "Publish API must hard-disable public organization applications exactly once.",
    );
  }
  const webEnvVars = [
    "NEXT_PUBLIC_API_URL",
    "INTERNAL_API_URL",
    "ARENZYRA_LAUNCHER_RELEASE_JSON",
    "STUDIO_DATABASE_URL",
    "STUDIO_DATABASE_SSL",
    "STUDIO_DATABASE_POOL_SIZE",
    "STUDIO_MEDIA_SIGNING_SECRET",
    "MEDIA_AI_URL",
    "STUDIO_MEDIA_AI_URL",
    "STUDIO_MEDIA_AI_TIMEOUT_MS",
    "STUDIO_REMOVE_BG_API_KEY",
    "STUDIO_REMOVE_BG_API_URL",
    "STUDIO_REMOVE_BG_SIZE",
    "STUDIO_REMOVE_BG_TYPE",
    "STUDIO_ALLOW_LOCAL_DEV_WORKSPACE",
  ];

  for (const variable of webEnvVars) {
    if (!compose.includes(`${variable}:`)) {
      errors.push(`Publish web service does not pass ${variable}.`);
    }
  }

  for (const variable of [
    "DISTRIBUTED_RATE_LIMIT_REQUIRED",
    "REDIS_READY_MAX_MEMORY_RATIO",
    "EVENT_BUS_MAX_PAYLOAD_BYTES",
    "EVENT_BUS_STREAM_MAXLEN",
    "ARENZYRA_BILLING_REVIEW_EMAIL",
    "PAYMENT_PROOF_RETENTION_DAYS",
    "BILLING_RESERVATION_LOCK_SECONDS",
    "BILLING_RESERVATION_RETENTION_HOURS",
    "BILLING_RESERVATION_CLEANUP_BATCH",
    "BILLING_REVIEW_CLAIM_LEASE_MINUTES",
    "BILLING_OUTBOX_CLAIM_SECONDS",
    "BILLING_OUTBOX_WORKER_ENABLED",
    "BILLING_OUTBOX_WORKER_INTERVAL_SECONDS",
    "BILLING_OUTBOX_WORKER_BATCH",
    "BILLING_OUTBOX_SHUTDOWN_MS",
    "BILLING_SMTP_CONNECTION_TIMEOUT_MS",
    "BILLING_SMTP_GREETING_TIMEOUT_MS",
    "BILLING_SMTP_SOCKET_TIMEOUT_MS",
  ]) {
    if (!compose.includes(`${variable}:`)) {
      errors.push(`Publish API service does not pass ${variable}.`);
    }
  }

  for (const fragment of [
    "--maxmemory",
    "REDIS_MAXMEMORY",
    "--maxmemory-policy",
    "noeviction",
  ]) {
    if (!compose.includes(fragment)) {
      errors.push(`Publish Redis service is missing ${fragment}.`);
    }
  }

  const webService =
    compose.match(
      /\n  web:\r?\n([\s\S]*?)(?=\n  [a-zA-Z0-9_-]+:\r?\n|\nvolumes:\r?\n)/,
    )?.[1] || "";
  if (/^\s{6}DATABASE_URL:/m.test(webService)) {
    errors.push(
      "Publish web service must not receive the primary DATABASE_URL; use the least-privilege STUDIO_DATABASE_URL only.",
    );
  }
  const launcherReleaseBinding =
    'ARENZYRA_LAUNCHER_RELEASE_JSON: "${ARENZYRA_LAUNCHER_RELEASE_JSON:-}"';
  if (
    webService.split(launcherReleaseBinding).length - 1 !== 1 ||
    /NEXT_PUBLIC_ARENZYRA_LAUNCHER_RELEASE/i.test(compose)
  ) {
    errors.push(
      "Publish web launcher release metadata must be one optional server-only runtime binding.",
    );
  }
  if (
    /^\s{4}env_file:/m.test(
      compose.match(
        /\n  discord-bot:\r?\n([\s\S]*?)(?=\n  [a-zA-Z0-9_-]+:\r?\n|\nvolumes:\r?\n)/,
      )?.[1] || "",
    )
  ) {
    errors.push(
      "Publish Discord bot must enumerate its environment; broad env_file injection is forbidden.",
    );
  }

  const sensitiveBuildArgs = [
    "DATABASE_URL",
    "MIGRATION_DATABASE_URL",
    "STUDIO_DATABASE_URL",
    "STUDIO_MIGRATION_DATABASE_URL",
    "MAINTENANCE_READ_DATABASE_URL",
    "IDP_MAINTENANCE_DATABASE_URL",
    "YOUTUBE_MAINTENANCE_DATABASE_URL",
    "JWT_SECRET",
    "IDP_CREDENTIAL_ENCRYPTION_KEY",
    "PUBLIC_ORGANIZATION_APPLICATIONS_ENABLED",
    "YOUTUBE_TOKEN_ENCRYPTION_KEY",
    "YOUTUBE_TOKEN_ENCRYPTION_PREVIOUS_KEYS",
    "YOUTUBE_TOKEN_ENCRYPTION_LEGACY_V1_KEY",
    "SUPERADMIN_MFA_ENCRYPTION_KEY",
    "SUPERADMIN_MFA_RECOVERY_PEPPER",
    "ARENZYRA_BILLING_REVIEW_EMAIL",
    "HEALTHCHECK_TOKEN",
    "DISCORD_BOT_TOKEN",
    "ARENZYRA_API_SERVICE_TOKEN",
    "STUDIO_MEDIA_SIGNING_SECRET",
  ];
  for (const variable of findSensitiveBuildArguments(
    compose,
    sensitiveBuildArgs,
  )) {
    errors.push(`${variable} must never be passed as a Docker build argument.`);
  }
  if (hasSensitiveComposeLabel(compose, sensitiveBuildArgs)) {
    errors.push(
      "Sensitive values must never be stored in image/container labels.",
    );
  }

  if (!compose.includes("condition: service_healthy")) {
    errors.push("Publish compose should wait for healthy dependencies.");
  }
  if (!deployText.includes("web:3005")) {
    errors.push("Publish compose/Caddy wiring should target web:3005.");
  }
  if (!deployText.includes("api:3000")) {
    errors.push("Publish compose/Caddy wiring should target api:3000.");
  }
  if (!caddy.includes("reverse_proxy web:3005")) {
    errors.push("Caddyfile is not proxying the web host to web:3005.");
  }
  if (!caddy.includes("reverse_proxy api:3000")) {
    errors.push("Caddyfile is not proxying the API host to api:3000.");
  }
  if (!caddy.includes("www.{$PUBLIC_WEB_HOST}")) {
    errors.push("Caddyfile is missing the www redirect for the web host.");
  }
}

function checkRequiredEnv(env, allowPlaceholders, errors, warnings) {
  const required = [
    "ACME_EMAIL",
    "PUBLIC_WEB_HOST",
    "PUBLIC_API_HOST",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "POSTGRES_DB",
    "DATABASE_URL",
    "MIGRATION_DATABASE_URL",
    "STUDIO_DATABASE_URL",
    "STUDIO_MIGRATION_DATABASE_URL",
    "MAINTENANCE_READ_DATABASE_URL",
    "IDP_MAINTENANCE_DATABASE_URL",
    "YOUTUBE_MAINTENANCE_DATABASE_URL",
    "JWT_SECRET",
    "IDP_CREDENTIAL_ENCRYPTION_KEY",
    "YOUTUBE_TOKEN_ENCRYPTION_KEY_ID",
    "YOUTUBE_TOKEN_ENCRYPTION_KEY",
    "YOUTUBE_TOKEN_ENCRYPTION_PREVIOUS_KEYS",
    "SUPERADMIN_MFA_REQUIRED",
    "SUPERADMIN_MFA_ENCRYPTION_KEY",
    "SUPERADMIN_MFA_RECOVERY_PEPPER",
    "ARENZYRA_BILLING_REVIEW_EMAIL",
    "HEALTHCHECK_TOKEN",
    "STUDIO_MEDIA_SIGNING_SECRET",
    "ARENZYRA_API_SERVICE_TOKEN",
    "ARENZYRA_API_SERVICE_TOKEN_SHA256",
    "ARENZYRA_API_SERVICE_ORGANIZATION_ID",
    "DISCORD_BOT_TOKEN",
    "DISCORD_CLIENT_ID",
    "ARENZYRA_DISCORD_BOT_INSTANCE",
    "COLLECTOR_SECRET",
    "PCOB_SECRET",
    "ARENZYRA_BACKUP_AGE_RECIPIENT",
    "ARENZYRA_BACKUP_RCLONE_REMOTE",
    "WEB_APP_ORIGIN",
    "FRONTEND_ORIGIN",
    "NEXT_PUBLIC_API_URL",
    "INTERNAL_API_URL",
    "API_BASE_URL",
    "API_PUBLIC_URL",
    "ARENZYRA_DOCKER_SUBNET",
    "ARENZYRA_PROXY_IP",
    "TRUSTED_PROXY_IPS",
    "REDIS_MAXMEMORY",
    "REDIS_READY_MAX_MEMORY_RATIO",
    "DISTRIBUTED_RATE_LIMIT_REQUIRED",
    "EVENT_BUS_MAX_PAYLOAD_BYTES",
    "EVENT_BUS_STREAM_MAXLEN",
  ];

  for (const key of required) {
    const value = env[key] ?? "";
    if (isPlaceholder(value)) {
      const message = `${key} is empty or still looks like a placeholder.`;
      if (allowPlaceholders) warnings.push(message);
      else errors.push(message);
    }
  }

  const secretKeys = [
    "JWT_SECRET",
    "HEALTHCHECK_TOKEN",
    "STUDIO_MEDIA_SIGNING_SECRET",
    "ARENZYRA_API_SERVICE_TOKEN",
    "DISCORD_BOT_TOKEN",
    "COLLECTOR_SECRET",
    "PCOB_SECRET",
  ];
  for (const key of secretKeys) {
    const value = env[key] ?? "";
    if (value && !isPlaceholder(value) && value.length < 24) {
      warnings.push(`${key} is set but short; use a strong production value.`);
    }
  }

  for (const key of [
    "HEALTHCHECK_TOKEN",
    "STUDIO_MEDIA_SIGNING_SECRET",
    "IDP_CREDENTIAL_ENCRYPTION_KEY",
    "YOUTUBE_TOKEN_ENCRYPTION_KEY",
    "YOUTUBE_TOKEN_ENCRYPTION_LEGACY_V1_KEY",
    "SUPERADMIN_MFA_ENCRYPTION_KEY",
    "SUPERADMIN_MFA_RECOVERY_PEPPER",
  ]) {
    const value = env[key] ?? "";
    if (
      value &&
      !isPlaceholder(value) &&
      Buffer.byteLength(value, "utf8") < 32
    ) {
      errors.push(`${key} must be at least 32 bytes in production.`);
    }
  }
}

function studioDatabaseSslQueryParameterNames(value) {
  const connectionString = String(value ?? "").trim();
  if (!connectionString) return [];
  try {
    const parsed = new URL(connectionString);
    return Array.from(
      new Set(
        Array.from(parsed.searchParams.keys())
          .map((key) => key.trim().toLowerCase())
          .filter((key) => key.startsWith("ssl") || key === "uselibpqcompat"),
      ),
    ).sort((left, right) => left.localeCompare(right));
  } catch {
    // validatePostgresUrl reports malformed URLs without disclosing credentials.
    return [];
  }
}

function validateStudioDatabaseTls(env, errors) {
  const sslMode = String(env.STUDIO_DATABASE_SSL ?? "")
    .trim()
    .toLowerCase();
  if (["insecure", "no-verify"].includes(sslMode)) {
    errors.push(
      "STUDIO_DATABASE_SSL must not disable certificate verification. Use false or disable only for a trusted local/private no-TLS connection.",
    );
  } else if (
    sslMode &&
    !VERIFIED_STUDIO_DATABASE_SSL_MODES.has(sslMode) &&
    !DISABLED_STUDIO_DATABASE_SSL_MODES.has(sslMode)
  ) {
    errors.push(
      "STUDIO_DATABASE_SSL must be true, false, 1, 0, require, verify-ca, verify-full, disable, or disabled.",
    );
  }

  for (const envKey of [
    "STUDIO_DATABASE_URL",
    "STUDIO_MIGRATION_DATABASE_URL",
  ]) {
    const forbiddenParameters = studioDatabaseSslQueryParameterNames(
      env[envKey],
    );
    if (forbiddenParameters.length > 0) {
      errors.push(
        `${envKey} must not contain SSL query parameters (${forbiddenParameters.join(
          ", ",
        )}). Configure Studio TLS only with STUDIO_DATABASE_SSL and STUDIO_DATABASE_CA.`,
      );
    }
  }
}

function validateEnvRelationships(
  env,
  errors,
  warnings,
  allowPlaceholders = false,
) {
  for (const reservedKey of [
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_CERT_PATH",
    "DOCKER_TLS",
    "DOCKER_TLS_VERIFY",
    "COMPOSE_PROJECT_NAME",
    "COMPOSE_FILE",
    "COMPOSE_ENV_FILES",
  ]) {
    if ((env[reservedKey] ?? "").trim()) {
      errors.push(
        `${reservedKey} is process control and must not be stored in the production publish environment.`,
      );
    }
  }
  const webHost = env.PUBLIC_WEB_HOST ?? "";
  const apiHost = env.PUBLIC_API_HOST ?? "";
  const idpCredentialKey = env.IDP_CREDENTIAL_ENCRYPTION_KEY ?? "";
  const youtubeTokenKey = env.YOUTUBE_TOKEN_ENCRYPTION_KEY ?? "";
  const youtubeTokenKeyId = env.YOUTUBE_TOKEN_ENCRYPTION_KEY_ID ?? "";
  const mfaRequired = (env.SUPERADMIN_MFA_REQUIRED ?? "").trim();

  validateLauncherReleaseConfig(
    env.ARENZYRA_LAUNCHER_RELEASE_JSON ?? "",
    errors,
  );
  validateStudioDatabaseTls(env, errors);

  if (mfaRequired !== "true") {
    errors.push("SUPERADMIN_MFA_REQUIRED must be exactly true in production.");
  }

  if ((env.PUBLIC_ORGANIZATION_APPLICATIONS_ENABLED ?? "").trim() !== "false") {
    errors.push(
      "PUBLIC_ORGANIZATION_APPLICATIONS_ENABLED must be exactly false in production.",
    );
  }

  if ((env.DISTRIBUTED_RATE_LIMIT_REQUIRED ?? "").trim() !== "true") {
    errors.push(
      "DISTRIBUTED_RATE_LIMIT_REQUIRED must be exactly true in production.",
    );
  }

  const redisMaxMemory = (env.REDIS_MAXMEMORY ?? "").trim().toLowerCase();
  const redisMemoryMatch = redisMaxMemory.match(/^(\d+)(kb|mb|gb)$/);
  const redisMemoryMultipliers = {
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024,
  };
  const redisMaxMemoryBytes = redisMemoryMatch
    ? Number(redisMemoryMatch[1]) * redisMemoryMultipliers[redisMemoryMatch[2]]
    : Number.NaN;
  if (
    !Number.isSafeInteger(redisMaxMemoryBytes) ||
    redisMaxMemoryBytes < 256 * 1024 * 1024
  ) {
    errors.push(
      "REDIS_MAXMEMORY must be a Redis size of at least 256mb (for example 768mb).",
    );
  }

  const redisReadyRatio = Number(env.REDIS_READY_MAX_MEMORY_RATIO);
  if (
    !Number.isFinite(redisReadyRatio) ||
    redisReadyRatio < 0.5 ||
    redisReadyRatio > 0.9
  ) {
    errors.push("REDIS_READY_MAX_MEMORY_RATIO must be between 0.5 and 0.9.");
  }

  const eventPayloadBytes = Number(env.EVENT_BUS_MAX_PAYLOAD_BYTES);
  if (
    !Number.isSafeInteger(eventPayloadBytes) ||
    eventPayloadBytes < 1024 ||
    eventPayloadBytes > 1024 * 1024
  ) {
    errors.push(
      "EVENT_BUS_MAX_PAYLOAD_BYTES must be between 1024 and 1048576.",
    );
  }

  const eventStreamMaxLength = Number(env.EVENT_BUS_STREAM_MAXLEN);
  if (
    !Number.isSafeInteger(eventStreamMaxLength) ||
    eventStreamMaxLength < 100 ||
    eventStreamMaxLength > 50_000
  ) {
    errors.push("EVENT_BUS_STREAM_MAXLEN must be between 100 and 50000.");
  }

  if (idpCredentialKey && !isPlaceholder(idpCredentialKey)) {
    for (const key of ["JWT_SECRET", "COLLECTOR_SECRET", "PCOB_SECRET"]) {
      if (idpCredentialKey === (env[key] ?? "")) {
        errors.push(`IDP_CREDENTIAL_ENCRYPTION_KEY must not reuse ${key}.`);
      }
    }
  }

  if (
    youtubeTokenKeyId &&
    !isPlaceholder(youtubeTokenKeyId) &&
    !/^[A-Za-z0-9_-]{1,48}$/.test(youtubeTokenKeyId)
  ) {
    errors.push(
      "YOUTUBE_TOKEN_ENCRYPTION_KEY_ID must contain 1-48 letters, numbers, underscores, or hyphens.",
    );
  }

  const youtubeForbiddenSecrets = {
    JWT_SECRET: env.JWT_SECRET ?? "",
    TOKEN_ENCRYPTION_KEY: env.TOKEN_ENCRYPTION_KEY ?? "",
    IDP_CREDENTIAL_ENCRYPTION_KEY: idpCredentialKey,
    COLLECTOR_SECRET: env.COLLECTOR_SECRET ?? "",
    PCOB_SECRET: env.PCOB_SECRET ?? "",
    SUPERADMIN_MFA_ENCRYPTION_KEY: env.SUPERADMIN_MFA_ENCRYPTION_KEY ?? "",
    SUPERADMIN_MFA_RECOVERY_PEPPER: env.SUPERADMIN_MFA_RECOVERY_PEPPER ?? "",
  };
  if (youtubeTokenKey && !isPlaceholder(youtubeTokenKey)) {
    for (const [key, secret] of Object.entries(youtubeForbiddenSecrets)) {
      if (secret && !isPlaceholder(secret) && secret === youtubeTokenKey) {
        errors.push(`YOUTUBE_TOKEN_ENCRYPTION_KEY must not reuse ${key}.`);
        break;
      }
    }
  }

  const previousKeysRaw = env.YOUTUBE_TOKEN_ENCRYPTION_PREVIOUS_KEYS ?? "";
  if (previousKeysRaw && !isPlaceholder(previousKeysRaw)) {
    try {
      const previousKeys = JSON.parse(previousKeysRaw);
      if (
        !previousKeys ||
        typeof previousKeys !== "object" ||
        Array.isArray(previousKeys) ||
        Object.getPrototypeOf(previousKeys) !== Object.prototype
      ) {
        throw new Error("not an object");
      }
      const entries = Object.entries(previousKeys);
      if (entries.length > 8) {
        errors.push(
          "YOUTUBE_TOKEN_ENCRYPTION_PREVIOUS_KEYS supports at most 8 keys.",
        );
      }
      const keyMaterials = new Set([youtubeTokenKey]);
      for (const [keyId, secret] of entries) {
        if (!/^[A-Za-z0-9_-]{1,48}$/.test(keyId)) {
          errors.push(
            "YOUTUBE_TOKEN_ENCRYPTION_PREVIOUS_KEYS contains an invalid key id.",
          );
        }
        if (keyId === youtubeTokenKeyId) {
          errors.push(
            "YOUTUBE_TOKEN_ENCRYPTION_PREVIOUS_KEYS must not contain the current key id.",
          );
        }
        if (
          typeof secret !== "string" ||
          Buffer.byteLength(secret.trim(), "utf8") < 32
        ) {
          errors.push(
            `YOUTUBE_TOKEN_ENCRYPTION_PREVIOUS_KEYS.${keyId} must be at least 32 bytes.`,
          );
          continue;
        }
        if (keyMaterials.has(secret)) {
          errors.push(
            "YOUTUBE_TOKEN_ENCRYPTION_PREVIOUS_KEYS must not reuse key material.",
          );
        }
        keyMaterials.add(secret);
        for (const [otherKey, otherSecret] of Object.entries(
          youtubeForbiddenSecrets,
        )) {
          if (
            otherSecret &&
            !isPlaceholder(otherSecret) &&
            secret === otherSecret
          ) {
            errors.push(
              `YOUTUBE_TOKEN_ENCRYPTION_PREVIOUS_KEYS.${keyId} must not reuse ${otherKey}.`,
            );
            break;
          }
        }
      }
    } catch {
      errors.push(
        "YOUTUBE_TOKEN_ENCRYPTION_PREVIOUS_KEYS must be a JSON object.",
      );
    }
  }

  const applicationSecrets = {
    JWT_SECRET: env.JWT_SECRET ?? "",
    IDP_CREDENTIAL_ENCRYPTION_KEY: idpCredentialKey,
    YOUTUBE_TOKEN_ENCRYPTION_KEY: youtubeTokenKey,
    COLLECTOR_SECRET: env.COLLECTOR_SECRET ?? "",
    PCOB_SECRET: env.PCOB_SECRET ?? "",
    SUPERADMIN_MFA_ENCRYPTION_KEY: env.SUPERADMIN_MFA_ENCRYPTION_KEY ?? "",
    SUPERADMIN_MFA_RECOVERY_PEPPER: env.SUPERADMIN_MFA_RECOVERY_PEPPER ?? "",
  };
  for (const mfaKey of [
    "SUPERADMIN_MFA_ENCRYPTION_KEY",
    "SUPERADMIN_MFA_RECOVERY_PEPPER",
  ]) {
    const value = applicationSecrets[mfaKey];
    if (!value || isPlaceholder(value)) continue;
    for (const [otherKey, otherValue] of Object.entries(applicationSecrets)) {
      if (
        otherKey !== mfaKey &&
        otherValue &&
        !isPlaceholder(otherValue) &&
        value === otherValue
      ) {
        errors.push(`${mfaKey} must not reuse ${otherKey}.`);
        break;
      }
    }
  }

  if (
    /^(?:1|true|yes|on)$/i.test((env.AUTH_DEV_BOOTSTRAP_ENABLED ?? "").trim())
  ) {
    errors.push(
      "AUTH_DEV_BOOTSTRAP_ENABLED is development-only and forbidden in production.",
    );
  }
  for (const key of [
    "SUPERADMIN_EMAIL",
    "SUPERADMIN_PASSWORD",
    "OP_EMAIL",
    "OP_PASSWORD",
  ]) {
    if ((env[key] ?? "").trim()) {
      errors.push(
        `${key} is a development bootstrap credential and must not be stored in the production environment.`,
      );
    }
  }
  for (const key of ["PLATFORM_ADMIN_EMAIL", "PLATFORM_ADMIN_PASSWORD"]) {
    if ((env[key] ?? "").trim()) {
      errors.push(
        `${key} is seed-only and must not be stored in the production runtime environment.`,
      );
    }
  }
  for (const key of [
    "ARENZYRA_WEB_ALLOW_OBSERVER_DIRECT",
    "ARENZYRA_WEB_OBSERVER_LOCAL_PROBE",
  ]) {
    const value = (env[key] ?? "0").trim().toLowerCase();
    if (!["", "0", "false", "off", "no"].includes(value)) {
      errors.push(
        `${key} cannot be enabled by the supported production deployment.`,
      );
    }
  }

  if (net.isIP(env.ARENZYRA_PROXY_IP ?? "") === 0) {
    errors.push("ARENZYRA_PROXY_IP must be one explicit IPv4/IPv6 address.");
  }
  if (
    (env.TRUSTED_PROXY_IPS ?? "").trim() !==
    (env.ARENZYRA_PROXY_IP ?? "").trim()
  ) {
    errors.push(
      "TRUSTED_PROXY_IPS must equal the single static ARENZYRA_PROXY_IP; broad proxy trust is forbidden.",
    );
  }
  if (
    ["0.0.0.0", "::", "0.0.0.0/0", "::/0"].includes(
      (env.TRUSTED_PROXY_IPS ?? "").trim(),
    )
  ) {
    errors.push("TRUSTED_PROXY_IPS cannot trust every network peer.");
  }
  if (
    !/^\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}$/.test(env.ARENZYRA_DOCKER_SUBNET ?? "")
  ) {
    errors.push("ARENZYRA_DOCKER_SUBNET must be an explicit IPv4 CIDR.");
  }

  validateHostOnly("PUBLIC_WEB_HOST", webHost, errors);
  validateHostOnly("PUBLIC_API_HOST", apiHost, errors);

  if (webHost && apiHost && webHost === apiHost) {
    errors.push(
      "PUBLIC_WEB_HOST and PUBLIC_API_HOST should be separate hosts.",
    );
  }

  if (env.ACME_EMAIL && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.ACME_EMAIL)) {
    errors.push("ACME_EMAIL is not a valid email address.");
  }

  validatePostgresUrl("DATABASE_URL", env.DATABASE_URL ?? "", errors);
  validatePostgresUrl(
    "MIGRATION_DATABASE_URL",
    env.MIGRATION_DATABASE_URL ?? "",
    errors,
  );
  for (const databaseTargetError of validateProductionDatabaseTargetContract(
    env,
  ).errors) {
    if (
      allowPlaceholders &&
      [
        "POSTGRES_PASSWORD",
        "DATABASE_URL",
        "MIGRATION_DATABASE_URL",
        "STUDIO_DATABASE_URL",
        "STUDIO_MIGRATION_DATABASE_URL",
        "MAINTENANCE_READ_DATABASE_URL",
        "IDP_MAINTENANCE_DATABASE_URL",
        "YOUTUBE_MAINTENANCE_DATABASE_URL",
      ].some(
        (key) =>
          databaseTargetError.startsWith(`${key} `) &&
          isPlaceholder(env[key] ?? ""),
      )
    ) {
      continue;
    }
    errors.push(databaseTargetError);
  }
  validatePostgresUrl(
    "STUDIO_DATABASE_URL",
    env.STUDIO_DATABASE_URL ?? "",
    errors,
  );
  validatePostgresUrl(
    "STUDIO_MIGRATION_DATABASE_URL",
    env.STUDIO_MIGRATION_DATABASE_URL ?? "",
    errors,
  );
  validatePostgresUrl(
    "MAINTENANCE_READ_DATABASE_URL",
    env.MAINTENANCE_READ_DATABASE_URL ?? "",
    errors,
  );
  validatePostgresUrl(
    "IDP_MAINTENANCE_DATABASE_URL",
    env.IDP_MAINTENANCE_DATABASE_URL ?? "",
    errors,
  );
  validatePostgresUrl(
    "YOUTUBE_MAINTENANCE_DATABASE_URL",
    env.YOUTUBE_MAINTENANCE_DATABASE_URL ?? "",
    errors,
  );
  if (env.STUDIO_DATABASE_URL && env.POSTGRES_USER) {
    try {
      const studioUser = decodeURIComponent(
        new URL(env.STUDIO_DATABASE_URL).username,
      );
      if (studioUser && studioUser === env.POSTGRES_USER) {
        errors.push(
          "STUDIO_DATABASE_URL must use a dedicated least-privilege role, not POSTGRES_USER.",
        );
      }
    } catch {
      // validatePostgresUrl reports the malformed URL.
    }
  }
  if (env.DATABASE_URL) {
    try {
      const appUser = decodeURIComponent(new URL(env.DATABASE_URL).username);
      if (
        appUser &&
        (appUser === env.POSTGRES_USER ||
          ["postgres", "root"].includes(appUser.toLowerCase()))
      ) {
        errors.push(
          "DATABASE_URL must use a non-superuser runtime role, not POSTGRES_USER/postgres/root.",
        );
      }
      if (env.STUDIO_DATABASE_URL) {
        const studioUser = decodeURIComponent(
          new URL(env.STUDIO_DATABASE_URL).username,
        );
        if (studioUser && studioUser === appUser) {
          errors.push(
            "DATABASE_URL and STUDIO_DATABASE_URL must use separate database roles.",
          );
        }
      }
    } catch {
      // validatePostgresUrl reports malformed URLs.
    }
  }
  try {
    const appUser = decodeURIComponent(new URL(env.DATABASE_URL).username);
    const apiMigrationUser = decodeURIComponent(
      new URL(env.MIGRATION_DATABASE_URL).username,
    );
    const studioUser = decodeURIComponent(
      new URL(env.STUDIO_DATABASE_URL).username,
    );
    const studioMigrationUser = decodeURIComponent(
      new URL(env.STUDIO_MIGRATION_DATABASE_URL).username,
    );
    const maintenanceReadUser = decodeURIComponent(
      new URL(env.MAINTENANCE_READ_DATABASE_URL).username,
    );
    const idpMaintenanceUser = decodeURIComponent(
      new URL(env.IDP_MAINTENANCE_DATABASE_URL).username,
    );
    const youtubeMaintenanceUser = decodeURIComponent(
      new URL(env.YOUTUBE_MAINTENANCE_DATABASE_URL).username,
    );
    if (
      new Set([
        appUser,
        apiMigrationUser,
        studioUser,
        studioMigrationUser,
        maintenanceReadUser,
        idpMaintenanceUser,
        youtubeMaintenanceUser,
      ]).size !== 7
    ) {
      errors.push(
        "All seven application database URLs must use distinct roles.",
      );
    }
    if (apiMigrationUser === appUser || studioMigrationUser === studioUser) {
      errors.push(
        "Runtime and migration database URLs must use different roles.",
      );
    }
    if (
      [apiMigrationUser, studioMigrationUser].some(
        (user) =>
          user === env.POSTGRES_USER ||
          ["postgres", "root"].includes(user.toLowerCase()),
      )
    ) {
      errors.push(
        "Migration URLs must use a dedicated non-superuser DDL owner, not POSTGRES_USER/postgres/root.",
      );
    }
  } catch {
    // URL validators report malformed or absent values.
  }

  if (env.ARENZYRA_DISCORD_BOT_INSTANCE !== "production") {
    errors.push("ARENZYRA_DISCORD_BOT_INSTANCE must be exactly production.");
  }
  if (env.ARENZYRA_API_SERVICE_TOKEN && env.ARENZYRA_API_SERVICE_TOKEN_SHA256) {
    const calculated = crypto
      .createHash("sha256")
      .update(env.ARENZYRA_API_SERVICE_TOKEN)
      .digest("hex");
    if (calculated !== env.ARENZYRA_API_SERVICE_TOKEN_SHA256.toLowerCase()) {
      errors.push(
        "ARENZYRA_API_SERVICE_TOKEN_SHA256 does not match ARENZYRA_API_SERVICE_TOKEN.",
      );
    }
  }

  validateHttpsOrigin(
    "WEB_APP_ORIGIN",
    env.WEB_APP_ORIGIN ?? "",
    webHost,
    errors,
  );
  validateHttpsOrigin(
    "FRONTEND_ORIGIN",
    env.FRONTEND_ORIGIN ?? "",
    webHost,
    errors,
  );
  validateHttpsOrigin(
    "NEXT_PUBLIC_API_URL",
    env.NEXT_PUBLIC_API_URL ?? "",
    apiHost,
    errors,
  );
  validateHttpsOrigin("API_BASE_URL", env.API_BASE_URL ?? "", apiHost, errors);
  validateHttpsOrigin(
    "API_PUBLIC_URL",
    env.API_PUBLIC_URL ?? "",
    apiHost,
    errors,
  );

  if ((env.INTERNAL_API_URL ?? "") !== "http://api:3000") {
    warnings.push(
      "INTERNAL_API_URL should normally be http://api:3000 in publish.",
    );
  }

  validateRedirect(
    "DISCORD_REDIRECT_URI",
    env.DISCORD_REDIRECT_URI ?? "",
    `https://${webHost}/organizer/discord/callback`,
    errors,
  );
  validateRedirect(
    "YOUTUBE_REDIRECT_URI",
    env.YOUTUBE_REDIRECT_URI ?? "",
    `https://${webHost}/organizer/youtube/callback`,
    errors,
  );

  const assetBaseUrl = env.ASSET_BASE_URL ?? "";
  if (assetBaseUrl && !isHttpUrl(assetBaseUrl)) {
    errors.push("ASSET_BASE_URL must be a full http(s) URL when set.");
  }

  const studioPoolSize = env.STUDIO_DATABASE_POOL_SIZE ?? "";
  if (studioPoolSize && !/^\d+$/.test(studioPoolSize)) {
    errors.push(
      "STUDIO_DATABASE_POOL_SIZE must be a positive integer when set.",
    );
  }

  const removeBgSize = env.STUDIO_REMOVE_BG_SIZE ?? "";
  if (
    removeBgSize &&
    !["auto", "preview", "full", "50mp"].includes(removeBgSize.toLowerCase())
  ) {
    warnings.push(
      "STUDIO_REMOVE_BG_SIZE should normally be auto, preview, full, or 50mp.",
    );
  }

  const removeBgType = env.STUDIO_REMOVE_BG_TYPE ?? "";
  if (
    removeBgType &&
    !["auto", "person", "product", "car"].includes(removeBgType.toLowerCase())
  ) {
    warnings.push(
      "STUDIO_REMOVE_BG_TYPE should normally be auto, person, product, or car.",
    );
  }

  if (
    env.STUDIO_REMOVE_BG_API_URL &&
    !isHttpUrl(env.STUDIO_REMOVE_BG_API_URL)
  ) {
    errors.push(
      "STUDIO_REMOVE_BG_API_URL must be a full http(s) URL when set.",
    );
  }

  const mediaAiUrl =
    env.STUDIO_MEDIA_AI_URL || env.MEDIA_AI_URL || "http://media-ai:5055";
  if (env.MEDIA_AI_URL && !isHttpUrl(env.MEDIA_AI_URL)) {
    errors.push("MEDIA_AI_URL must be a full http(s) URL when set.");
  }
  if (env.STUDIO_MEDIA_AI_URL && !isHttpUrl(env.STUDIO_MEDIA_AI_URL)) {
    errors.push("STUDIO_MEDIA_AI_URL must be a full http(s) URL when set.");
  }
  const mediaAiTimeoutMs = env.STUDIO_MEDIA_AI_TIMEOUT_MS ?? "";
  if (mediaAiTimeoutMs && !/^\d+$/.test(mediaAiTimeoutMs)) {
    errors.push(
      "STUDIO_MEDIA_AI_TIMEOUT_MS must be a positive integer when set.",
    );
  }

  const requireExternalStudioImageProvider = (
    env.STUDIO_REQUIRE_EXTERNAL_IMAGE_PROVIDER ?? ""
  ).toLowerCase();
  if (
    (requireExternalStudioImageProvider === "1" ||
      requireExternalStudioImageProvider === "true") &&
    !env.STUDIO_REMOVE_BG_API_KEY
  ) {
    errors.push(
      "STUDIO_REQUIRE_EXTERNAL_IMAGE_PROVIDER is enabled but STUDIO_REMOVE_BG_API_KEY is empty.",
    );
  }
  if (!env.STUDIO_REMOVE_BG_API_KEY) {
    if (mediaAiUrl) {
      warnings.push(
        "STUDIO_REMOVE_BG_API_KEY is empty; Studio will use no-key Media AI background removal when available.",
      );
    } else {
      warnings.push(
        "STUDIO_REMOVE_BG_API_KEY and MEDIA_AI_URL are empty; Studio will use the local fallback background remover.",
      );
    }
  }

  const localDevStudio = (
    env.STUDIO_ALLOW_LOCAL_DEV_WORKSPACE ?? ""
  ).toLowerCase();
  if (localDevStudio === "1" || localDevStudio === "true") {
    errors.push("STUDIO_ALLOW_LOCAL_DEV_WORKSPACE must stay false in publish.");
  }

  const observerDirect = (
    env.ARENZYRA_WEB_ALLOW_OBSERVER_DIRECT ?? ""
  ).toLowerCase();
  if (observerDirect === "1" || observerDirect === "true") {
    if (
      env.ARENZYRA_ACK_PUBLIC_WEB_OBSERVER_DIRECT !==
      "I_ACCEPT_HOST_OBSERVER_EXPOSURE"
    ) {
      errors.push(
        "Public web observer-direct access requires ARENZYRA_ACK_PUBLIC_WEB_OBSERVER_DIRECT=I_ACCEPT_HOST_OBSERVER_EXPOSURE.",
      );
    } else {
      warnings.push(
        "Public web observer-direct access is explicitly enabled; review host routing and authorization isolation.",
      );
    }
  }

  if (env.NEXT_PUBLIC_API_URL && env.API_PUBLIC_URL) {
    const browserApi = originFromUrl(env.NEXT_PUBLIC_API_URL);
    const publicApi = originFromUrl(env.API_PUBLIC_URL);
    if (browserApi && publicApi && browserApi !== publicApi) {
      warnings.push(
        "NEXT_PUBLIC_API_URL and API_PUBLIC_URL point to different origins.",
      );
    }
  }

  if (env.WEB_APP_ORIGIN && env.FRONTEND_ORIGIN) {
    const webOrigin = originFromUrl(env.WEB_APP_ORIGIN);
    const frontOrigin = originFromUrl(env.FRONTEND_ORIGIN);
    if (webOrigin && frontOrigin && webOrigin !== frontOrigin) {
      warnings.push(
        "WEB_APP_ORIGIN and FRONTEND_ORIGIN point to different origins.",
      );
    }
  }

  if (env.API_PUBLIC_URL && env.ASSET_BASE_URL) {
    const apiAssetHost = hostFromUrl(env.API_PUBLIC_URL);
    const assetHost = hostFromUrl(env.ASSET_BASE_URL);
    if (apiAssetHost && assetHost && apiAssetHost !== assetHost) {
      warnings.push(
        "ASSET_BASE_URL uses a different host than API_PUBLIC_URL.",
      );
    }
  }
}

function validateLauncherReleaseConfig(value, errors) {
  const input = String(value ?? "");
  const raw = input.trim();
  if (!raw) return;

  if (Buffer.byteLength(input, "utf8") > MAX_LAUNCHER_RELEASE_CONFIG_BYTES) {
    errors.push(
      `ARENZYRA_LAUNCHER_RELEASE_JSON must not exceed ${MAX_LAUNCHER_RELEASE_CONFIG_BYTES} bytes.`,
    );
    return;
  }
  if (/[\r\n]/.test(input)) {
    errors.push(
      "ARENZYRA_LAUNCHER_RELEASE_JSON must be compact one-line JSON.",
    );
    return;
  }
  if (raw.includes("$") || raw.includes("'")) {
    errors.push(
      "ARENZYRA_LAUNCHER_RELEASE_JSON must not contain literal apostrophes or $ interpolation markers.",
    );
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Object.getPrototypeOf(parsed) !== Object.prototype
    ) {
      throw new Error("not an object");
    }
  } catch {
    errors.push(
      "ARENZYRA_LAUNCHER_RELEASE_JSON must be one valid JSON object when set.",
    );
  }
}

function runComposeConfig(envPath, env, warnings, errors) {
  if (!commandExists("docker", ["compose", "version"])) {
    warnings.push(
      "Docker Compose was not found; skipped compose config validation.",
    );
    return;
  }

  const result = runCommand(
    "docker",
    [
      "compose",
      "--env-file",
      envPath,
      "-f",
      "infra/docker-compose.publish.yml",
      "config",
      "--quiet",
    ],
    env,
  );

  if (result.status !== 0) {
    errors.push(
      `docker compose config failed:\n${(result.stderr || result.stdout || "").trim()}`,
    );
  }
}

function printIssues(label, items) {
  if (items.length === 0) return;
  console.log(`\n${label}:`);
  for (const item of items) console.log(`- ${item}`);
}

function main() {
  if (hasFlag("--help")) {
    console.log(
      "Usage: node scripts/preflight-publish.cjs --env infra/.env.publish [--allow-placeholders] [--skip-compose]",
    );
    return;
  }

  const envPath = path.resolve(
    repoRoot,
    readFlag("--env", "infra/.env.publish"),
  );
  const allowPlaceholders = hasFlag("--allow-placeholders");
  const skipCompose = hasFlag("--skip-compose");
  const errors = [];
  const warnings = [];

  validateStaticFiles(errors);
  validateComposeWiring(errors);

  if (!fs.existsSync(envPath)) {
    errors.push(
      `${relative(envPath)} does not exist. Copy infra/.env.publish.example to infra/.env.publish and fill it before deploy.`,
    );
  }

  let env = {};
  if (fs.existsSync(envPath)) {
    env = parseEnvFile(envPath);
    checkRequiredEnv(env, allowPlaceholders, errors, warnings);
    validateEnvRelationships(env, errors, warnings, allowPlaceholders);
  }

  if (!skipCompose && fs.existsSync(envPath) && !allowPlaceholders) {
    runComposeConfig(envPath, env, warnings, errors);
  }

  console.log(`[publish-preflight] env: ${relative(envPath)}`);
  console.log(`[publish-preflight] compose: infra/docker-compose.publish.yml`);
  console.log(`[publish-preflight] caddy: infra/Caddyfile`);
  if (allowPlaceholders) {
    console.log(
      "[publish-preflight] template mode: placeholders are warnings.",
    );
  }
  if (skipCompose) {
    console.log("[publish-preflight] compose config validation skipped.");
  }

  printIssues("Warnings", warnings);
  printIssues("Errors", errors);

  if (errors.length > 0) {
    process.exitCode = 1;
    return;
  }

  console.log("\n[publish-preflight] OK");
}

if (require.main === module) main();

module.exports = {
  findSensitiveBuildArguments,
  hasSensitiveComposeLabel,
  validateLauncherReleaseConfig,
  validateStudioDatabaseTls,
  validateEnvRelationships,
  validateIdpMaintenanceServices,
};
