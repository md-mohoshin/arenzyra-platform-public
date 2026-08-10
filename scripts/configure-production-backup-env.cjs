#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PRODUCTION_ENV = "/opt/arenzyra/infra/.env.publish";
const CONFIRMATION = "CONFIGURE_REVIEWED_PRODUCTION_BACKUP";
const REMOTE =
  "arenzyrab2:arenzyra-prod-backup-84f2c9/arenzyra/production";
const BACKUP_ROOT = "/opt/arenzyra-backups/encrypted-v1";
const HELPER_IMAGE =
  "postgres:16.14-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777";

function fail(message) {
  throw new Error(`PRODUCTION BACKUP ENV BLOCKED: ${message}`);
}

function updateEnvText(text, ageRecipient, options = {}) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 1024 * 1024) {
    fail("environment input is invalid or oversized.");
  }
  if (!/^age1[0-9a-z]{58}$/.test(String(ageRecipient || ""))) {
    fail("age recipient is invalid.");
  }

  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const hadFinalNewline = /\r?\n$/.test(text);
  const body = hadFinalNewline ? text.replace(/\r?\n$/, "") : text;
  const lines = body === "" ? [] : body.split(/\r?\n/);
  const existingValues = new Map();
  for (const key of [
    "ARENZYRA_BACKUP_AGE_RECIPIENT",
    "ARENZYRA_BACKUP_RCLONE_REMOTE",
    "ARENZYRA_BACKUP_ROOT",
    "ARENZYRA_BACKUP_HELPER_IMAGE",
  ]) {
    const matching = lines.filter((line) => new RegExp(`^${key}=`).test(line));
    if (matching.length > 1) fail(`${key} is duplicated.`);
    existingValues.set(
      key,
      matching.length === 0 ? "" : matching[0].slice(key.length + 1),
    );
  }
  const existingRecipient = existingValues.get("ARENZYRA_BACKUP_AGE_RECIPIENT");
  const existingRemote = existingValues.get("ARENZYRA_BACKUP_RCLONE_REMOTE");
  const existingRoot = existingValues.get("ARENZYRA_BACKUP_ROOT");
  const mayReplaceUnverifiedRecipient =
    options.allowReplaceUnverifiedRecipient === true &&
    existingRecipient !== "" &&
    existingRecipient !== ageRecipient &&
    /^age1[0-9a-z]{58}$/.test(existingRecipient) &&
    existingRemote === "";
  const mayIsolateLegacyBackupRoot =
    options.allowReplaceUnverifiedRecipient === true &&
    existingRoot === "/opt/arenzyra-backups" &&
    existingRemote === "" &&
    (existingRecipient === ageRecipient || mayReplaceUnverifiedRecipient);
  const values = new Map([
    ["ARENZYRA_BACKUP_AGE_RECIPIENT", ageRecipient],
    ["ARENZYRA_BACKUP_RCLONE_REMOTE", REMOTE],
    ["ARENZYRA_BACKUP_ROOT", BACKUP_ROOT],
    ["ARENZYRA_BACKUP_HELPER_IMAGE", HELPER_IMAGE],
  ]);

  for (const [key, value] of values) {
    const indexes = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (new RegExp(`^${key}=`).test(lines[index])) indexes.push(index);
    }
    if (indexes.length === 1) {
      const index = indexes[0];
      const current = lines[index].slice(key.length + 1);
      if (
        current !== "" &&
        current !== value &&
        !(key === "ARENZYRA_BACKUP_AGE_RECIPIENT" && mayReplaceUnverifiedRecipient) &&
        !(key === "ARENZYRA_BACKUP_ROOT" && mayIsolateLegacyBackupRoot)
      ) {
        fail(`${key} already has a different non-empty value.`);
      }
      lines[index] = `${key}=${value}`;
    } else {
      lines.push(`${key}=${value}`);
    }
  }
  return `${lines.join(newline)}${newline}`;
}

function configureProductionEnv(ageRecipient, options) {
  if (process.platform !== "linux" || process.getuid?.() !== 0) {
    fail("Linux UID 0 is required.");
  }
  const parent = path.dirname(PRODUCTION_ENV);
  if (fs.realpathSync(parent) !== "/opt/arenzyra/infra") {
    fail("environment parent is not exact.");
  }
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  const input = fs.openSync(PRODUCTION_ENV, flags);
  let identity;
  let text;
  try {
    identity = fs.fstatSync(input);
    if (
      !identity.isFile() ||
      identity.nlink !== 1 ||
      identity.uid !== 0 ||
      identity.gid !== 0 ||
      (identity.mode & 0o777) !== 0o600 ||
      identity.size < 1 ||
      identity.size > 1024 * 1024
    ) {
      fail("environment identity, permissions, link count, or size is unsafe.");
    }
    text = fs.readFileSync(input, "utf8");
  } finally {
    fs.closeSync(input);
  }

  const output = updateEnvText(text, ageRecipient, options);
  const temporary = `${PRODUCTION_ENV}.backup-config.${process.pid}.tmp`;
  let outputFd;
  try {
    outputFd = fs.openSync(
      temporary,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        (fs.constants.O_NOFOLLOW || 0),
      0o600,
    );
    fs.writeFileSync(outputFd, output, "utf8");
    fs.fsyncSync(outputFd);
    fs.closeSync(outputFd);
    outputFd = undefined;

    const current = fs.lstatSync(PRODUCTION_ENV);
    if (
      current.isSymbolicLink() ||
      current.dev !== identity.dev ||
      current.ino !== identity.ino ||
      current.nlink !== 1
    ) {
      fail("environment identity changed during configuration.");
    }
    fs.renameSync(temporary, PRODUCTION_ENV);
    const directory = fs.openSync(parent, fs.constants.O_RDONLY);
    try {
      fs.fsyncSync(directory);
    } finally {
      fs.closeSync(directory);
    }
  } catch (error) {
    if (outputFd !== undefined) fs.closeSync(outputFd);
    try {
      fs.unlinkSync(temporary);
    } catch (unlinkError) {
      if (unlinkError.code !== "ENOENT") throw unlinkError;
    }
    throw error;
  }
}

function main(argv) {
  if (
    argv.length !== 5 ||
    argv[0] !== "--age-recipient" ||
    argv[2] !== "--confirm" ||
    argv[3] !== CONFIRMATION ||
    argv[4] !== "--replace-unverified-age-recipient"
  ) {
    fail("exact age-recipient and confirmation arguments are required.");
  }
  configureProductionEnv(argv[1], { allowReplaceUnverifiedRecipient: true });
  process.stdout.write("PRODUCTION BACKUP ENV CONFIGURED\n");
}

module.exports = { BACKUP_ROOT, HELPER_IMAGE, REMOTE, updateEnvText };

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 75;
  }
}
