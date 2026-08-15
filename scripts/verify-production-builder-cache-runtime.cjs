#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { TextDecoder } = require("node:util");

const MAX_INPUT_BYTES = 64 * 1024;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
const CONTAINER_ID = /^[a-f0-9]{64}$/;
const PROJECT = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const RELEASE_ID = /^git-[0-9]{8}-[0-9]{9}-[a-f0-9]{12}$/;
const SERVICES = Object.freeze([
  "proxy",
  "postgres",
  "redis",
  "api",
  "media-ai",
  "web",
  "discord-bot",
]);
const IMAGE_OPTIONS = Object.freeze({
  api: "--api-image-id",
  "media-ai": "--media-ai-image-id",
  web: "--web-image-id",
  "discord-bot": "--discord-bot-image-id",
});

function parseArguments(argv) {
  const allowed = new Set([
    "--compose-project",
    "--current-release",
    ...Object.values(IMAGE_OPTIONS),
  ]);
  const values = Object.create(null);
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(option)) throw new Error(`Unknown option: ${option ?? ""}`);
    if (Object.hasOwn(values, option)) throw new Error(`Duplicate option: ${option}`);
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${option}.`);
    }
    values[option] = value;
  }
  if (argv.length % 2 !== 0 || Object.keys(values).length !== allowed.size) {
    throw new Error("The closed runtime-verifier option set is required.");
  }
  if (!PROJECT.test(values["--compose-project"] ?? "")) {
    throw new Error("Compose project is invalid.");
  }
  if (!RELEASE_ID.test(values["--current-release"] ?? "")) {
    throw new Error("Current release ID is invalid.");
  }
  for (const option of Object.values(IMAGE_OPTIONS)) {
    if (!IMAGE_ID.test(values[option] ?? "")) {
      throw new Error(`Immutable image ID is invalid for ${option}.`);
    }
  }
  return values;
}

function verifyRuntimeInventory(text, options) {
  if (typeof text !== "string" || text.includes("\0") || text.includes("\r")) {
    throw new Error("Runtime inventory is not canonical LF text.");
  }
  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
  if (lines.length !== SERVICES.length || lines.some((line) => line.length === 0)) {
    throw new Error("Runtime inventory must contain exactly seven containers.");
  }

  const expectedProject = options["--compose-project"];
  const expectedRelease = options["--current-release"];
  const byService = new Map();
  const containerIds = new Set();
  for (const line of lines) {
    const fields = line.split("|");
    if (fields.length !== 11) {
      throw new Error("Runtime inventory row does not match the closed schema.");
    }
    const [
      containerId,
      imageId,
      project,
      service,
      oneoff,
      status,
      health,
      restarting,
      restartCount,
      restartPolicy,
      releaseId,
    ] = fields;
    if (!CONTAINER_ID.test(containerId) || !IMAGE_ID.test(imageId)) {
      throw new Error("Runtime container or image identity is invalid.");
    }
    if (containerIds.has(containerId)) {
      throw new Error("Runtime container identity is duplicated.");
    }
    containerIds.add(containerId);
    if (!SERVICES.includes(service) || byService.has(service)) {
      throw new Error("Runtime service is unexpected or duplicated.");
    }
    if (project !== expectedProject || oneoff !== "False") {
      throw new Error("Runtime Compose identity is not exact.");
    }
    if (
      status !== "running" ||
      health !== "healthy" ||
      restarting !== "false" ||
      restartPolicy !== "unless-stopped" ||
      !/^(0|[1-9][0-9]*)$/.test(restartCount)
    ) {
      throw new Error("Runtime health or restart state is not reviewed.");
    }
    if (Object.hasOwn(IMAGE_OPTIONS, service)) {
      if (
        releaseId !== expectedRelease ||
        imageId !== options[IMAGE_OPTIONS[service]]
      ) {
        throw new Error("Application runtime differs from the current release.");
      }
    } else if (releaseId !== "") {
      throw new Error("Dependency runtime unexpectedly carries a release label.");
    }
    byService.set(service, { containerId, imageId, restartCount });
  }

  for (const service of SERVICES) {
    if (!byService.has(service)) {
      throw new Error(`Required runtime service is absent: ${service}.`);
    }
  }
  return SERVICES.map((service) => {
    const row = byService.get(service);
    return `${service}|${row.containerId}|${row.imageId}|restart-count=${row.restartCount}`;
  }).join("\n");
}

function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const bytes = fs.readFileSync(0);
    if (bytes.length === 0 || bytes.length > MAX_INPUT_BYTES) {
      throw new Error("Runtime inventory size is outside policy.");
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    process.stdout.write(`${verifyRuntimeInventory(text, options)}\n`);
  } catch (error) {
    process.stderr.write(`BUILDER CACHE RUNTIME BLOCKED: ${error.message}\n`);
    process.exitCode = 75;
  }
}

if (require.main === module) main();

module.exports = {
  IMAGE_ID,
  IMAGE_OPTIONS,
  MAX_INPUT_BYTES,
  SERVICES,
  parseArguments,
  verifyRuntimeInventory,
};
