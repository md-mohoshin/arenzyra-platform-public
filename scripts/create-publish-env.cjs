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
  )}@postgres:5432/${encodeURIComponent(
    database,
  )}?schema=public&options=-c%20search_path%3Dpublic`;
}

function main() {
  if (hasFlag("--help")) {
    console.log(
      "Usage: node scripts/create-publish-env.cjs [--out infra/.env.publish] [--force] [--web-host arenzyra.com] [--api-host api.arenzyra.com] [--email ops@arenzyra.com]",
    );
    return;
  }

  const outPath = path.resolve(
    repoRoot,
    readFlag("--out", "infra/.env.publish"),
  );
  const force = hasFlag("--force");
  const webHost = readFlag("--web-host", "arenzyra.com");
  const apiHost = readFlag("--api-host", "api.arenzyra.com");
  const acmeEmail = readFlag("--email", "ops@arenzyra.com");
  const postgresUser = readFlag("--postgres-user", "arenzyra_admin");
  const postgresDb = readFlag("--postgres-db", "pubg_prod");
  const postgresPassword = secret(24);
  const apiRuntimePassword = secret(24);
  const apiMigrationPassword = secret(24);
  const studioRuntimePassword = secret(24);
  const studioMigrationPassword = secret(24);
  const maintenanceReadPassword = secret(24);
  const idpMaintenancePassword = secret(24);
  const youtubeMaintenancePassword = secret(24);
  const apiServiceToken = secret(32);
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
    line(
      "DATABASE_URL",
      databaseUrl("arenzyra_api_runtime", apiRuntimePassword, postgresDb),
    ),
    line(
      "MIGRATION_DATABASE_URL",
      databaseUrl("arenzyra_api_migrator", apiMigrationPassword, postgresDb),
    ),
    line(
      "STUDIO_DATABASE_URL",
      databaseUrl("arenzyra_studio_runtime", studioRuntimePassword, postgresDb),
    ),
    line(
      "STUDIO_MIGRATION_DATABASE_URL",
      databaseUrl(
        "arenzyra_studio_migrator",
        studioMigrationPassword,
        postgresDb,
      ),
    ),
    line(
      "MAINTENANCE_READ_DATABASE_URL",
      databaseUrl(
        "arenzyra_maintenance_read",
        maintenanceReadPassword,
        postgresDb,
      ),
    ),
    line(
      "IDP_MAINTENANCE_DATABASE_URL",
      databaseUrl(
        "arenzyra_idp_maintenance",
        idpMaintenancePassword,
        postgresDb,
      ),
    ),
    line(
      "YOUTUBE_MAINTENANCE_DATABASE_URL",
      databaseUrl(
        "arenzyra_youtube_maintenance",
        youtubeMaintenancePassword,
        postgresDb,
      ),
    ),
    line("STUDIO_DATABASE_SSL", ""),
    line("STUDIO_DATABASE_POOL_SIZE", ""),
    "",
    line("JWT_SECRET", secret(48)),
    line("IDP_CREDENTIAL_ENCRYPTION_KEY", secret(48)),
    line("PUBLIC_ORGANIZATION_APPLICATIONS_ENABLED", "false"),
    line("SUPERADMIN_MFA_REQUIRED", "true"),
    line("SUPERADMIN_MFA_ENCRYPTION_KEY", secret(48)),
    line("SUPERADMIN_MFA_RECOVERY_PEPPER", secret(48)),
    line("HEALTHCHECK_TOKEN", secret(32)),
    line("STUDIO_MEDIA_SIGNING_SECRET", secret(32)),
    line("COLLECTOR_SECRET", secret(48)),
    line("PCOB_SECRET", secret(48)),
    "",
    line("WEB_APP_ORIGIN", webOrigin),
    line("FRONTEND_ORIGIN", webOrigin),
    line("NEXT_PUBLIC_API_URL", apiOrigin),
    line("INTERNAL_API_URL", "http://api:3000"),
    "# Optional server-only signed launcher release metadata. Leave empty until reviewed.",
    line("ARENZYRA_LAUNCHER_RELEASE_JSON", ""),
    line("API_BASE_URL", apiOrigin),
    line("API_PUBLIC_URL", apiOrigin),
    line("ASSET_BASE_URL", apiOrigin),
    line("TRUST_PROXY", "true"),
    line("ARENZYRA_DOCKER_SUBNET", "172.30.50.0/24"),
    line("ARENZYRA_PROXY_IP", "172.30.50.2"),
    line("TRUSTED_PROXY_IPS", "172.30.50.2"),
    "",
    line(
      "ARENZYRA_API_SERVICE_TOKEN_SHA256",
      crypto.createHash("sha256").update(apiServiceToken).digest("hex"),
    ),
    line("ARENZYRA_API_SERVICE_TOKEN", apiServiceToken),
    line("STUDIO_QA_SERVICE_TOKEN_SHA256", ""),
    line("ARENZYRA_API_SERVICE_ORGANIZATION_ID", ""),
    line("ARENZYRA_API_SERVICE_USER_ID", ""),
    line("ARENZYRA_API_SERVICE_USER_EMAIL", "discord-bot@arenzyra.local"),
    "",
    line("DISCORD_CLIENT_ID", ""),
    line("DISCORD_GUILD_ID", ""),
    line("DISCORD_REDIRECT_URI", `${webOrigin}/organizer/discord/callback`),
    line("DISCORD_INSTALL_STATE_SECRET", ""),
    line("DISCORD_BOT_TOKEN", ""),
    line("ARENZYRA_DISCORD_BOT_INSTANCE", "production"),
    "",
    line("YOUTUBE_CLIENT_ID", ""),
    line("YOUTUBE_CLIENT_SECRET", ""),
    line("YOUTUBE_REDIRECT_URI", `${webOrigin}/organizer/youtube/callback`),
    line("YOUTUBE_STATE_SECRET", ""),
    line("YOUTUBE_TOKEN_ENCRYPTION_KEY_ID", `yt_${secret(9)}`),
    line("YOUTUBE_TOKEN_ENCRYPTION_KEY", secret(48)),
    line("YOUTUBE_TOKEN_ENCRYPTION_PREVIOUS_KEYS", "{}"),
    line("YOUTUBE_TOKEN_ENCRYPTION_LEGACY_V1_KEY", ""),
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
    line("ARENZYRA_MEDIA_ALLOWED_ORIGINS", ""),
    "",
    "# Required before deployment: public age recipient; private identity stays off-host.",
    line("ARENZYRA_BACKUP_AGE_RECIPIENT", ""),
    line("ARENZYRA_BACKUP_ROOT", "/opt/arenzyra-backups"),
    line("ARENZYRA_BACKUP_RCLONE_REMOTE", ""),
    line(
      "ARENZYRA_BACKUP_HELPER_IMAGE",
      "postgres:16.14-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777",
    ),
    line("ARENZYRA_DEPLOY_COMPOSE_PROJECT", "infra"),
    line("OPENAI_API_KEY", ""),
    line("OPENAI_VISION_MODEL", "gpt-4.1-mini"),
    line("OPENAI_VISION_MAX_IMAGE_EDGE", "2048"),
    "",
  ].join("\n");

  fs.writeFileSync(outPath, content, {
    encoding: "utf8",
    flag: "w",
    mode: 0o600,
  });
  fs.chmodSync(outPath, 0o600);

  console.log(`[publish-env] wrote ${path.relative(repoRoot, outPath)}`);
  console.log(
    "[publish-env] generated distinct database-role URLs and application secrets.",
  );
  console.log(
    "[publish-env] provision the generated database roles, add the age recipient, and review integration values before deploy.",
  );
}

main();
