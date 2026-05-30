#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

function readFlag(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) return fallback;
  return process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function secret(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function envValue(value) {
  if (/^[A-Za-z0-9_./:@?=&-]*$/.test(value)) return value;
  return JSON.stringify(value);
}

function line(key, value) {
  return `${key}=${envValue(value)}`;
}

function databaseUrl(user, password, database) {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(
    password,
  )}@postgres:5432/${encodeURIComponent(database)}?schema=public`;
}

function main() {
  if (hasFlag("--help")) {
    console.log(
      "Usage: node scripts/create-publish-env.cjs [--out infra/.env.publish] [--force] [--web-host arenzyra.com] [--api-host api.arenzyra.com] [--email ops@arenzyra.com]",
    );
    return;
  }

  const outPath = path.resolve(repoRoot, readFlag("--out", "infra/.env.publish"));
  const force = hasFlag("--force");
  const webHost = readFlag("--web-host", "arenzyra.com");
  const apiHost = readFlag("--api-host", "api.arenzyra.com");
  const acmeEmail = readFlag("--email", "ops@arenzyra.com");
  const postgresUser = readFlag("--postgres-user", "arenzyra");
  const postgresDb = readFlag("--postgres-db", "pubg_prod");
  const postgresPassword = secret(24);
  const superadminPassword = secret(32);
  const operatorPassword = secret(32);
  const platformAdminPassword = secret(32);
  const webOrigin = `https://${webHost}`;
  const apiOrigin = `https://${apiHost}`;

  if (fs.existsSync(outPath) && !force) {
    console.error(
      `${path.relative(repoRoot, outPath)} already exists. Use --force only if you intend to replace it.`,
    );
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const content = [
    "# Generated production publish env.",
    "# This file contains secrets and is ignored by Git.",
    "",
    line("ACME_EMAIL", acmeEmail),
    line("PUBLIC_WEB_HOST", webHost),
    line("PUBLIC_API_HOST", apiHost),
    "",
    line("POSTGRES_USER", postgresUser),
    line("POSTGRES_PASSWORD", postgresPassword),
    line("POSTGRES_DB", postgresDb),
    line("DATABASE_URL", databaseUrl(postgresUser, postgresPassword, postgresDb)),
    line("STUDIO_DATABASE_URL", ""),
    line("STUDIO_DATABASE_SSL", ""),
    line("STUDIO_DATABASE_POOL_SIZE", ""),
    "",
    line("JWT_SECRET", secret(48)),
    line("COLLECTOR_SECRET", secret(48)),
    line("PCOB_SECRET", secret(48)),
    "",
    line("SUPERADMIN_EMAIL", `superadmin@${webHost}`),
    line("SUPERADMIN_PASSWORD", superadminPassword),
    line("OP_EMAIL", `operator@${webHost}`),
    line("OP_PASSWORD", operatorPassword),
    "",
    line("PLATFORM_ADMIN_EMAIL", `platform-admin@${webHost}`),
    line("PLATFORM_ADMIN_PASSWORD", platformAdminPassword),
    "",
    line("WEB_APP_ORIGIN", webOrigin),
    line("FRONTEND_ORIGIN", webOrigin),
    line("NEXT_PUBLIC_API_URL", apiOrigin),
    line("INTERNAL_API_URL", "http://api:3000"),
    line("API_BASE_URL", apiOrigin),
    line("API_PUBLIC_URL", apiOrigin),
    line("ASSET_BASE_URL", apiOrigin),
    line("TRUST_PROXY", "true"),
    "",
    line("ARENZYRA_API_SERVICE_TOKEN_SHA256", ""),
    line("STUDIO_QA_SERVICE_TOKEN_SHA256", ""),
    line("ARENZYRA_API_SERVICE_ORGANIZATION_ID", ""),
    line("ARENZYRA_API_SERVICE_USER_ID", ""),
    line("ARENZYRA_API_SERVICE_USER_EMAIL", "discord-bot@arenzyra.local"),
    "",
    line("DISCORD_CLIENT_ID", ""),
    line("DISCORD_REDIRECT_URI", `${webOrigin}/organizer/discord/callback`),
    line("DISCORD_INSTALL_STATE_SECRET", ""),
    line("DISCORD_BOT_TOKEN", ""),
    "",
    line("YOUTUBE_CLIENT_ID", ""),
    line("YOUTUBE_CLIENT_SECRET", ""),
    line("YOUTUBE_REDIRECT_URI", `${webOrigin}/organizer/youtube/callback`),
    line("YOUTUBE_STATE_SECRET", ""),
    line("YOUTUBE_TOKEN_ENCRYPTION_KEY", ""),
    "",
    line("STUDIO_MEDIA_AI_URL", ""),
    line("STUDIO_MEDIA_AI_TIMEOUT_MS", "60000"),
    line("STUDIO_REMOVE_BG_API_KEY", ""),
    line("STUDIO_REMOVE_BG_API_URL", ""),
    line("STUDIO_REMOVE_BG_SIZE", "auto"),
    line("STUDIO_REMOVE_BG_TYPE", "auto"),
    line("STUDIO_REQUIRE_EXTERNAL_IMAGE_PROVIDER", "false"),
    line("STUDIO_ALLOW_LOCAL_DEV_WORKSPACE", "false"),
    "",
    "# Optional integrations. Set these only when those services are available.",
    line("OBSERVER_BASE_URL", "http://host.docker.internal:10086"),
    line("PCOB_BASE_URL", "http://host.docker.internal:10086"),
    line("SHADOW_API_BASE", "http://host.docker.internal:10086"),
    line("MATCH_STATE_BASE", "http://host.docker.internal:4000"),
    line("LIVE_SYNC_RESULTS_WRITE_ENABLED", ""),
    line("MEDIA_AI_URL", "http://media-ai:5055"),
    line("OPENAI_API_KEY", ""),
    line("OPENAI_VISION_MODEL", "gpt-4.1-mini"),
    line("OPENAI_VISION_MAX_IMAGE_EDGE", "2048"),
    "",
  ].join("\n");

  fs.writeFileSync(outPath, content, { encoding: "utf8", flag: "w" });

  console.log(`[publish-env] wrote ${path.relative(repoRoot, outPath)}`);
  console.log("[publish-env] generated database, API, operator, and admin secrets.");
  console.log("[publish-env] review optional Discord, YouTube, SMTP, OpenAI, and Studio remove.bg values before deploy.");
}

main();
