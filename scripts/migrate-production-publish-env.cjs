#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MAX_ENV_BYTES = 1024 * 1024;
const CONFIRMATION = "MIGRATE_REVIEWED_PRODUCTION_ENV";
const GENERATED_SECRET_BYTES = 48;

function fail(message) {
  throw new Error(`Production publish env migration blocked: ${message}`);
}

function flagValue(argv, name) {
  const positions = argv
    .map((value, index) => (value === name ? index : -1))
    .filter((index) => index >= 0);
  if (positions.length !== 1 || positions[0] === argv.length - 1) {
    fail(`${name} must be supplied exactly once`);
  }
  return argv[positions[0] + 1];
}

function assertClosedArguments(argv) {
  const allowed = new Set([
    "--source",
    "--template",
    "--out",
    "--age-recipient",
    "--rclone-remote",
    "--confirm",
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    if (!allowed.has(argv[index]) || index + 1 >= argv.length) {
      fail("command-line schema is invalid");
    }
  }
}

function readRegularFile(filePath, label) {
  let descriptor;
  try {
    const before = fs.lstatSync(filePath, { bigint: true });
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    );
    const opened = fs.fstatSync(descriptor, { bigint: true });
    const sameIdentity =
      before.dev === opened.dev &&
      before.ino === opened.ino &&
      before.mode === opened.mode &&
      before.nlink === opened.nlink;
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      !opened.isFile() ||
      !sameIdentity ||
      opened.nlink !== 1n ||
      opened.size <= 0n ||
      opened.size > BigInt(MAX_ENV_BYTES)
    ) {
      fail(`${label} is not a bounded stable single-link regular file`);
    }
    const source = fs.readFileSync(descriptor, "utf8");
    const after = fs.fstatSync(descriptor, { bigint: true });
    const finalPath = fs.lstatSync(filePath, { bigint: true });
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      finalPath.dev !== opened.dev ||
      finalPath.ino !== opened.ino ||
      finalPath.nlink !== 1n
    ) {
      fail(`${label} changed during inspection`);
    }
    if (source.includes("\0")) fail(`${label} contains a NUL byte`);
    return source.replace(/\r\n?/g, "\n");
  } catch {
    fail(`${label} is unavailable or unsafe`);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function decodeValue(raw, label) {
  const value = raw.trim();
  if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed !== "string") throw new Error("not a string");
      return parsed;
    } catch {
      fail(`${label} contains invalid double-quoted dotenv syntax`);
    }
  }
  if (value.startsWith("'") || value.endsWith("'")) {
    if (!(value.startsWith("'") && value.endsWith("'") && value.length >= 2)) {
      fail(`${label} contains invalid single-quoted dotenv syntax`);
    }
    return value.slice(1, -1);
  }
  return value;
}

function parseDotenv(source, label) {
  const values = new Map();
  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) fail(`${label} has invalid syntax at line ${index + 1}`);
    if (values.has(match[1])) fail(`${label} contains a duplicate key`);
    values.set(match[1], decodeValue(match[2], label));
  }
  return { lines, values };
}

function randomSecret(bytes = GENERATED_SECRET_BYTES) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function envValue(value) {
  if (/^[A-Za-z0-9_./:@?=&,+-]*$/.test(value)) return value;
  return JSON.stringify(value);
}

function databaseUrl(user, password, database) {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(
    password,
  )}@postgres:5432/${encodeURIComponent(
    database,
  )}?schema=public&options=-c%20search_path%3Dpublic`;
}

function isMissing(value) {
  return !value || /replace_with|placeholder|changeme/i.test(value);
}

function buildValues({
  sourceValues,
  templateValues,
  ageRecipient,
  rcloneRemote,
}) {
  const output = new Map(templateValues);
  for (const key of templateValues.keys()) {
    const existing = sourceValues.get(key);
    if (existing !== undefined && existing !== "") output.set(key, existing);
  }

  for (const key of ["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"]) {
    if (isMissing(sourceValues.get(key)))
      fail(`${key} is missing from the source`);
    output.set(key, sourceValues.get(key));
  }

  const database = output.get("POSTGRES_DB");
  const roleSpecs = [
    ["DATABASE_URL", "arenzyra_api_runtime"],
    ["MIGRATION_DATABASE_URL", "arenzyra_api_migrator"],
    ["STUDIO_DATABASE_URL", "arenzyra_studio_runtime"],
    ["STUDIO_MIGRATION_DATABASE_URL", "arenzyra_studio_migrator"],
    ["MAINTENANCE_READ_DATABASE_URL", "arenzyra_maintenance_read"],
    ["IDP_MAINTENANCE_DATABASE_URL", "arenzyra_idp_maintenance"],
    ["YOUTUBE_MAINTENANCE_DATABASE_URL", "arenzyra_youtube_maintenance"],
  ];
  for (const [key, role] of roleSpecs) {
    output.set(key, databaseUrl(role, randomSecret(32), database));
  }

  const generatedIfMissing = [
    "JWT_SECRET",
    "IDP_CREDENTIAL_ENCRYPTION_KEY",
    "SUPERADMIN_MFA_ENCRYPTION_KEY",
    "SUPERADMIN_MFA_RECOVERY_PEPPER",
    "HEALTHCHECK_TOKEN",
    "STUDIO_MEDIA_SIGNING_SECRET",
    "COLLECTOR_SECRET",
    "PCOB_SECRET",
    "DISCORD_INSTALL_STATE_SECRET",
    "YOUTUBE_STATE_SECRET",
    "YOUTUBE_TOKEN_ENCRYPTION_KEY",
  ];
  for (const key of generatedIfMissing) {
    if (isMissing(output.get(key))) output.set(key, randomSecret());
  }
  if (isMissing(output.get("YOUTUBE_TOKEN_ENCRYPTION_KEY_ID"))) {
    output.set("YOUTUBE_TOKEN_ENCRYPTION_KEY_ID", `yt_${randomSecret(12)}`);
  }
  if (isMissing(output.get("YOUTUBE_TOKEN_ENCRYPTION_PREVIOUS_KEYS"))) {
    output.set("YOUTUBE_TOKEN_ENCRYPTION_PREVIOUS_KEYS", "{}");
  }

  let serviceToken = output.get("ARENZYRA_API_SERVICE_TOKEN");
  if (isMissing(serviceToken)) serviceToken = randomSecret(32);
  output.set("ARENZYRA_API_SERVICE_TOKEN", serviceToken);
  output.set(
    "ARENZYRA_API_SERVICE_TOKEN_SHA256",
    crypto.createHash("sha256").update(serviceToken).digest("hex"),
  );

  const fixed = {
    PUBLIC_ORGANIZATION_APPLICATIONS_ENABLED: "false",
    SUPERADMIN_MFA_REQUIRED: "true",
    DISTRIBUTED_RATE_LIMIT_REQUIRED: "true",
    REDIS_MAXMEMORY: "768mb",
    REDIS_READY_MAX_MEMORY_RATIO: "0.85",
    EVENT_BUS_MAX_PAYLOAD_BYTES: "524288",
    EVENT_BUS_STREAM_MAXLEN: "10000",
    ARENZYRA_DOCKER_SUBNET: "172.30.50.0/24",
    ARENZYRA_PROXY_IP: "172.30.50.2",
    TRUSTED_PROXY_IPS: "172.30.50.2",
    ARENZYRA_DEPLOY_COMPOSE_PROJECT: "infra",
    ARENZYRA_BACKUP_HELPER_IMAGE:
      "postgres:16.14-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777",
  };
  for (const [key, value] of Object.entries(fixed)) output.set(key, value);

  if (!/^age1[023456789acdefghjklmnpqrstuvwxyz]{20,100}$/.test(ageRecipient)) {
    fail("the age recipient is invalid");
  }
  output.set("ARENZYRA_BACKUP_AGE_RECIPIENT", ageRecipient);
  if (rcloneRemote !== undefined) {
    if (
      rcloneRemote !== "" &&
      !/^[A-Za-z0-9_-]+:[A-Za-z0-9_./-]{1,240}$/.test(rcloneRemote)
    ) {
      fail("the rclone remote is invalid");
    }
    output.set("ARENZYRA_BACKUP_RCLONE_REMOTE", rcloneRemote);
  }

  const dedicated = [
    "JWT_SECRET",
    "IDP_CREDENTIAL_ENCRYPTION_KEY",
    "SUPERADMIN_MFA_ENCRYPTION_KEY",
    "SUPERADMIN_MFA_RECOVERY_PEPPER",
    "HEALTHCHECK_TOKEN",
    "STUDIO_MEDIA_SIGNING_SECRET",
    "COLLECTOR_SECRET",
    "PCOB_SECRET",
    "YOUTUBE_TOKEN_ENCRYPTION_KEY",
    "ARENZYRA_API_SERVICE_TOKEN",
  ].map((key) => output.get(key));
  if (
    dedicated.some(isMissing) ||
    new Set(dedicated).size !== dedicated.length
  ) {
    fail("dedicated production secrets are missing or reused");
  }
  return output;
}

function renderTemplate(templateLines, values) {
  const seen = new Set();
  const rendered = templateLines.map((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (!match) return line;
    if (seen.has(match[1])) fail("template contains a duplicate key");
    seen.add(match[1]);
    return `${match[1]}=${envValue(values.get(match[1]) ?? "")}`;
  });
  if (seen.size !== values.size)
    fail("template/output key boundary is inconsistent");
  return `${rendered.join("\n").replace(/\n+$/u, "")}\n`;
}

function atomicReplace(outputPath, content) {
  const existing = fs.lstatSync(outputPath, { bigint: true });
  if (
    !existing.isFile() ||
    existing.isSymbolicLink() ||
    existing.nlink !== 1n
  ) {
    fail("output is not the reviewed single-link env copy");
  }
  const directory = path.dirname(outputPath);
  const temporary = path.join(
    directory,
    `.env.publish.migrate-${process.pid}-${crypto.randomBytes(12).toString("hex")}`,
  );
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, content, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    const current = fs.lstatSync(outputPath, { bigint: true });
    if (
      current.dev !== existing.dev ||
      current.ino !== existing.ino ||
      current.nlink !== 1n ||
      !current.isFile() ||
      current.isSymbolicLink()
    ) {
      fail("output changed during migration");
    }
    fs.renameSync(temporary, outputPath);
    fs.chmodSync(outputPath, 0o600);
    const directoryDescriptor = fs.openSync(directory, "r");
    try {
      try {
        fs.fsyncSync(directoryDescriptor);
      } catch (error) {
        if (
          process.platform !== "win32" ||
          !["EINVAL", "EPERM"].includes(error?.code)
        ) {
          throw error;
        }
      }
    } finally {
      fs.closeSync(directoryDescriptor);
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

function main(argv = process.argv.slice(2)) {
  assertClosedArguments(argv);
  const sourcePath = path.resolve(flagValue(argv, "--source"));
  const templatePath = path.resolve(flagValue(argv, "--template"));
  const outputPath = path.resolve(flagValue(argv, "--out"));
  const ageRecipient = flagValue(argv, "--age-recipient");
  const confirmation = flagValue(argv, "--confirm");
  const rcloneIndex = argv.indexOf("--rclone-remote");
  const rcloneRemote =
    rcloneIndex === -1 ? undefined : flagValue(argv, "--rclone-remote");
  if (confirmation !== CONFIRMATION) fail("confirmation is invalid");
  if (sourcePath === outputPath) fail("source and output must be distinct");

  const sourceText = readRegularFile(sourcePath, "source env");
  const outputText = readRegularFile(outputPath, "reviewed output env copy");
  if (sourceText !== outputText) {
    fail("reviewed output is not the untouched bootstrap copy of the source");
  }
  const source = parseDotenv(sourceText, "source env");
  const template = parseDotenv(
    readRegularFile(templatePath, "template env"),
    "template env",
  );
  const values = buildValues({
    sourceValues: source.values,
    templateValues: template.values,
    ageRecipient,
    rcloneRemote,
  });
  atomicReplace(outputPath, renderTemplate(template.lines, values));
  process.stdout.write(
    `PRODUCTION_PUBLISH_ENV_MIGRATED keys=${values.size} preserved_allowlisted_only=true public_applications=false\n`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 75;
  }
}

module.exports = {
  buildValues,
  parseDotenv,
  renderTemplate,
};
