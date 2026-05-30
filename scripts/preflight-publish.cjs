#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");

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
  const env = {};
  const lines = readText(filePath).split(/\r?\n/);

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const normalized = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trim()
      : trimmed;
    const equalsAt = normalized.indexOf("=");
    if (equalsAt === -1) {
      throw new Error(
        `${relative(filePath)}:${index + 1} is not a valid KEY=value line.`,
      );
    }

    const key = normalized.slice(0, equalsAt).trim();
    let value = normalized.slice(equalsAt + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  });

  return env;
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
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
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

function validateComposeWiring(errors) {
  const composePath = path.join(repoRoot, "infra/docker-compose.publish.yml");
  const caddyPath = path.join(repoRoot, "infra/Caddyfile");
  if (!fs.existsSync(composePath) || !fs.existsSync(caddyPath)) return;

  const compose = readText(composePath);
  const caddy = readText(caddyPath);
  const deployText = `${compose}\n${caddy}`;
  const webEnvVars = [
    "NEXT_PUBLIC_API_URL",
    "INTERNAL_API_URL",
    "DATABASE_URL",
    "STUDIO_DATABASE_URL",
    "STUDIO_DATABASE_SSL",
    "STUDIO_DATABASE_POOL_SIZE",
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
    "JWT_SECRET",
    "COLLECTOR_SECRET",
    "PCOB_SECRET",
    "SUPERADMIN_EMAIL",
    "SUPERADMIN_PASSWORD",
    "OP_EMAIL",
    "OP_PASSWORD",
    "WEB_APP_ORIGIN",
    "FRONTEND_ORIGIN",
    "NEXT_PUBLIC_API_URL",
    "INTERNAL_API_URL",
    "API_BASE_URL",
    "API_PUBLIC_URL",
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
    "COLLECTOR_SECRET",
    "PCOB_SECRET",
    "SUPERADMIN_PASSWORD",
    "OP_PASSWORD",
  ];
  for (const key of secretKeys) {
    const value = env[key] ?? "";
    if (value && !isPlaceholder(value) && value.length < 24) {
      warnings.push(`${key} is set but short; use a strong production value.`);
    }
  }
}

function validateEnvRelationships(env, errors, warnings) {
  const webHost = env.PUBLIC_WEB_HOST ?? "";
  const apiHost = env.PUBLIC_API_HOST ?? "";

  validateHostOnly("PUBLIC_WEB_HOST", webHost, errors);
  validateHostOnly("PUBLIC_API_HOST", apiHost, errors);

  if (webHost && apiHost && webHost === apiHost) {
    errors.push("PUBLIC_WEB_HOST and PUBLIC_API_HOST should be separate hosts.");
  }

  if (env.ACME_EMAIL && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.ACME_EMAIL)) {
    errors.push("ACME_EMAIL is not a valid email address.");
  }

  validatePostgresUrl("DATABASE_URL", env.DATABASE_URL ?? "", errors);
  validatePostgresUrl("STUDIO_DATABASE_URL", env.STUDIO_DATABASE_URL ?? "", errors);

  validateHttpsOrigin("WEB_APP_ORIGIN", env.WEB_APP_ORIGIN ?? "", webHost, errors);
  validateHttpsOrigin("FRONTEND_ORIGIN", env.FRONTEND_ORIGIN ?? "", webHost, errors);
  validateHttpsOrigin(
    "NEXT_PUBLIC_API_URL",
    env.NEXT_PUBLIC_API_URL ?? "",
    apiHost,
    errors,
  );
  validateHttpsOrigin("API_BASE_URL", env.API_BASE_URL ?? "", apiHost, errors);
  validateHttpsOrigin("API_PUBLIC_URL", env.API_PUBLIC_URL ?? "", apiHost, errors);

  if ((env.INTERNAL_API_URL ?? "") !== "http://api:3000") {
    warnings.push("INTERNAL_API_URL should normally be http://api:3000 in publish.");
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

  const studioDatabaseSsl = env.STUDIO_DATABASE_SSL ?? "";
  if (
    studioDatabaseSsl &&
    !["true", "false", "1", "0", "require", "disable"].includes(
      studioDatabaseSsl.toLowerCase(),
    )
  ) {
    warnings.push(
      "STUDIO_DATABASE_SSL should be true, false, 1, 0, require, or disable.",
    );
  }

  const studioPoolSize = env.STUDIO_DATABASE_POOL_SIZE ?? "";
  if (studioPoolSize && !/^\d+$/.test(studioPoolSize)) {
    errors.push("STUDIO_DATABASE_POOL_SIZE must be a positive integer when set.");
  }

  const removeBgSize = env.STUDIO_REMOVE_BG_SIZE ?? "";
  if (
    removeBgSize &&
    !["auto", "preview", "full", "50mp"].includes(removeBgSize.toLowerCase())
  ) {
    warnings.push("STUDIO_REMOVE_BG_SIZE should normally be auto, preview, full, or 50mp.");
  }

  const removeBgType = env.STUDIO_REMOVE_BG_TYPE ?? "";
  if (
    removeBgType &&
    !["auto", "person", "product", "car"].includes(removeBgType.toLowerCase())
  ) {
    warnings.push("STUDIO_REMOVE_BG_TYPE should normally be auto, person, product, or car.");
  }

  if (env.STUDIO_REMOVE_BG_API_URL && !isHttpUrl(env.STUDIO_REMOVE_BG_API_URL)) {
    errors.push("STUDIO_REMOVE_BG_API_URL must be a full http(s) URL when set.");
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
    errors.push("STUDIO_MEDIA_AI_TIMEOUT_MS must be a positive integer when set.");
  }

  const requireExternalStudioImageProvider =
    (env.STUDIO_REQUIRE_EXTERNAL_IMAGE_PROVIDER ?? "").toLowerCase();
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

  const localDevStudio =
    (env.STUDIO_ALLOW_LOCAL_DEV_WORKSPACE ?? "").toLowerCase();
  if (localDevStudio === "1" || localDevStudio === "true") {
    errors.push("STUDIO_ALLOW_LOCAL_DEV_WORKSPACE must stay false in publish.");
  }

  if (env.NEXT_PUBLIC_API_URL && env.API_PUBLIC_URL) {
    const browserApi = originFromUrl(env.NEXT_PUBLIC_API_URL);
    const publicApi = originFromUrl(env.API_PUBLIC_URL);
    if (browserApi && publicApi && browserApi !== publicApi) {
      warnings.push("NEXT_PUBLIC_API_URL and API_PUBLIC_URL point to different origins.");
    }
  }

  if (env.WEB_APP_ORIGIN && env.FRONTEND_ORIGIN) {
    const webOrigin = originFromUrl(env.WEB_APP_ORIGIN);
    const frontOrigin = originFromUrl(env.FRONTEND_ORIGIN);
    if (webOrigin && frontOrigin && webOrigin !== frontOrigin) {
      warnings.push("WEB_APP_ORIGIN and FRONTEND_ORIGIN point to different origins.");
    }
  }

  if (env.API_PUBLIC_URL && env.ASSET_BASE_URL) {
    const apiAssetHost = hostFromUrl(env.API_PUBLIC_URL);
    const assetHost = hostFromUrl(env.ASSET_BASE_URL);
    if (apiAssetHost && assetHost && apiAssetHost !== assetHost) {
      warnings.push("ASSET_BASE_URL uses a different host than API_PUBLIC_URL.");
    }
  }
}

function runComposeConfig(envPath, env, warnings, errors) {
  if (!commandExists("docker", ["compose", "version"])) {
    warnings.push("Docker Compose was not found; skipped compose config validation.");
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

  const envPath = path.resolve(repoRoot, readFlag("--env", "infra/.env.publish"));
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
    validateEnvRelationships(env, errors, warnings);
  }

  if (!skipCompose && fs.existsSync(envPath) && !allowPlaceholders) {
    runComposeConfig(envPath, env, warnings, errors);
  }

  console.log(`[publish-preflight] env: ${relative(envPath)}`);
  console.log(`[publish-preflight] compose: infra/docker-compose.publish.yml`);
  console.log(`[publish-preflight] caddy: infra/Caddyfile`);
  if (allowPlaceholders) {
    console.log("[publish-preflight] template mode: placeholders are warnings.");
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

main();
