const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  buildValues,
  parseDotenv,
  renderTemplate,
} = require("./migrate-production-publish-env.cjs");

const recipient =
  "age1h365lf0fsm3ttatcr2sqw7cvrgvv3hgtgqq2qcr0a3cw52ue7cyq3d4p5v";

function template() {
  return parseDotenv(
    [
      "# reviewed",
      "POSTGRES_USER=",
      "POSTGRES_PASSWORD=",
      "POSTGRES_DB=",
      "DATABASE_URL=",
      "MIGRATION_DATABASE_URL=",
      "STUDIO_DATABASE_URL=",
      "STUDIO_MIGRATION_DATABASE_URL=",
      "MAINTENANCE_READ_DATABASE_URL=",
      "IDP_MAINTENANCE_DATABASE_URL=",
      "YOUTUBE_MAINTENANCE_DATABASE_URL=",
      "JWT_SECRET=",
      "IDP_CREDENTIAL_ENCRYPTION_KEY=",
      "SUPERADMIN_MFA_ENCRYPTION_KEY=",
      "SUPERADMIN_MFA_RECOVERY_PEPPER=",
      "HEALTHCHECK_TOKEN=",
      "STUDIO_MEDIA_SIGNING_SECRET=",
      "COLLECTOR_SECRET=",
      "PCOB_SECRET=",
      "DISCORD_INSTALL_STATE_SECRET=",
      "YOUTUBE_STATE_SECRET=",
      "YOUTUBE_TOKEN_ENCRYPTION_KEY=",
      "YOUTUBE_TOKEN_ENCRYPTION_KEY_ID=",
      "YOUTUBE_TOKEN_ENCRYPTION_PREVIOUS_KEYS=",
      "ARENZYRA_API_SERVICE_TOKEN=",
      "ARENZYRA_API_SERVICE_TOKEN_SHA256=",
      "PUBLIC_ORGANIZATION_APPLICATIONS_ENABLED=",
      "SUPERADMIN_MFA_REQUIRED=",
      "DISTRIBUTED_RATE_LIMIT_REQUIRED=",
      "REDIS_MAXMEMORY=",
      "REDIS_READY_MAX_MEMORY_RATIO=",
      "EVENT_BUS_MAX_PAYLOAD_BYTES=",
      "EVENT_BUS_STREAM_MAXLEN=",
      "ARENZYRA_DOCKER_SUBNET=",
      "ARENZYRA_PROXY_IP=",
      "TRUSTED_PROXY_IPS=",
      "ARENZYRA_DEPLOY_COMPOSE_PROJECT=",
      "ARENZYRA_BACKUP_HELPER_IMAGE=",
      "ARENZYRA_BACKUP_AGE_RECIPIENT=",
      "ARENZYRA_BACKUP_RCLONE_REMOTE=",
      "DISCORD_BOT_TOKEN=",
      "",
    ].join("\n"),
    "template",
  );
}

function source() {
  return parseDotenv(
    [
      "POSTGRES_USER=arenzyra",
      "POSTGRES_PASSWORD=existing-admin-secret",
      "POSTGRES_DB=pubg_prod",
      "JWT_SECRET=existing-jwt-secret-with-safe-length-0001",
      "COLLECTOR_SECRET=existing-collector-secret-safe-length-1",
      "PCOB_SECRET=existing-pcob-secret-with-safe-length-001",
      "DISCORD_BOT_TOKEN=existing-discord-token",
      "SUPERADMIN_EMAIL=must-not-survive",
      "SUPERADMIN_PASSWORD=must-not-survive",
      "",
    ].join("\n"),
    "source",
  );
}

test("migration preserves allowlisted integrations and creates closed production values", () => {
  const reviewedTemplate = template();
  const legacy = source();
  const values = buildValues({
    sourceValues: legacy.values,
    templateValues: reviewedTemplate.values,
    ageRecipient: recipient,
    rcloneRemote: "encrypted-offsite:arenzyra/production",
  });
  assert.equal(values.get("JWT_SECRET"), legacy.values.get("JWT_SECRET"));
  assert.equal(
    values.get("DISCORD_BOT_TOKEN"),
    legacy.values.get("DISCORD_BOT_TOKEN"),
  );
  assert.equal(values.has("SUPERADMIN_EMAIL"), false);
  assert.equal(values.get("PUBLIC_ORGANIZATION_APPLICATIONS_ENABLED"), "false");
  assert.equal(values.get("SUPERADMIN_MFA_REQUIRED"), "true");
  assert.equal(values.get("DISTRIBUTED_RATE_LIMIT_REQUIRED"), "true");
  assert.equal(values.get("ARENZYRA_BACKUP_AGE_RECIPIENT"), recipient);
  assert.equal(
    values.get("ARENZYRA_BACKUP_RCLONE_REMOTE"),
    "encrypted-offsite:arenzyra/production",
  );
  const urls = [
    "DATABASE_URL",
    "MIGRATION_DATABASE_URL",
    "STUDIO_DATABASE_URL",
    "STUDIO_MIGRATION_DATABASE_URL",
    "MAINTENANCE_READ_DATABASE_URL",
    "IDP_MAINTENANCE_DATABASE_URL",
    "YOUTUBE_MAINTENANCE_DATABASE_URL",
  ].map((key) => new URL(values.get(key)));
  assert.equal(new Set(urls.map((url) => url.username)).size, 7);
  assert.equal(new Set(urls.map((url) => url.password)).size, 7);
  assert.ok(urls.every((url) => url.hostname === "postgres"));
  assert.equal(
    values.get("ARENZYRA_API_SERVICE_TOKEN_SHA256"),
    require("node:crypto")
      .createHash("sha256")
      .update(values.get("ARENZYRA_API_SERVICE_TOKEN"))
      .digest("hex"),
  );
  const rendered = renderTemplate(reviewedTemplate.lines, values);
  assert.doesNotMatch(rendered, /must-not-survive|SUPERADMIN_EMAIL/);
});

test("migration leaves the off-host remote blocked when none is supplied", () => {
  const reviewedTemplate = template();
  const values = buildValues({
    sourceValues: source().values,
    templateValues: reviewedTemplate.values,
    ageRecipient: recipient,
    rcloneRemote: undefined,
  });
  assert.equal(values.get("ARENZYRA_BACKUP_RCLONE_REMOTE"), "");
});

test("dotenv parsing and explicit inputs fail closed", () => {
  assert.throws(
    () => parseDotenv("POSTGRES_DB=a\nPOSTGRES_DB=b\n", "fixture"),
    /duplicate key/,
  );
  assert.throws(
    () =>
      buildValues({
        sourceValues: source().values,
        templateValues: template().values,
        ageRecipient: "not-an-age-recipient",
        rcloneRemote: "encrypted-offsite:arenzyra/production",
      }),
    /age recipient is invalid/,
  );
  assert.throws(
    () =>
      buildValues({
        sourceValues: source().values,
        templateValues: template().values,
        ageRecipient: recipient,
        rcloneRemote: "../../escape",
      }),
    /rclone remote is invalid/,
  );
});

test("CLI atomically migrates only an untouched copy and refuses a rerun", (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "publish-env-migrate-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, "source.env");
  const outputPath = path.join(directory, "output.env");
  const templatePath = path.join(
    __dirname,
    "..",
    "infra",
    ".env.publish.example",
  );
  const sourceText = [
    "POSTGRES_USER=arenzyra",
    "POSTGRES_PASSWORD=existing-admin-secret",
    "POSTGRES_DB=pubg_prod",
    "JWT_SECRET=existing-jwt-secret-with-safe-length-0001",
    "COLLECTOR_SECRET=existing-collector-secret-safe-length-1",
    "PCOB_SECRET=existing-pcob-secret-with-safe-length-001",
    "DISCORD_BOT_TOKEN=existing-discord-token",
    "SUPERADMIN_EMAIL=must-not-survive",
    "",
  ].join("\n");
  fs.writeFileSync(sourcePath, sourceText, { mode: 0o600 });
  fs.writeFileSync(outputPath, sourceText, { mode: 0o600 });
  const args = [
    path.join(__dirname, "migrate-production-publish-env.cjs"),
    "--source",
    sourcePath,
    "--template",
    templatePath,
    "--out",
    outputPath,
    "--age-recipient",
    recipient,
    "--confirm",
    "MIGRATE_REVIEWED_PRODUCTION_ENV",
  ];
  const first = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(first.status, 0, first.stderr);
  const migrated = fs.readFileSync(outputPath, "utf8");
  assert.doesNotMatch(migrated, /must-not-survive|SUPERADMIN_EMAIL/);
  assert.match(migrated, /PUBLIC_ORGANIZATION_APPLICATIONS_ENABLED=false/);
  const second = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(second.status, 75);
  assert.match(second.stderr, /not the untouched bootstrap copy/);
});
