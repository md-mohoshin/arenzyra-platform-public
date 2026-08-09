#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");

const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
const MODE_BINDINGS = Object.freeze({
  full: Object.freeze({
    api: "api",
    "api-migrate": "api",
    web: "web",
    "studio-migrate": "web",
    "media-ai": "media-ai",
  }),
  "discord-bot": Object.freeze({
    "discord-bot": "discord-bot",
  }),
});
const IMAGE_FLAGS = Object.freeze({
  api: "--api-image-id",
  web: "--web-image-id",
  "media-ai": "--media-ai-image-id",
  "discord-bot": "--discord-bot-image-id",
});

function assertPlainObject(value, description) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${description} must be one JSON object.`);
  }
}

function assertExactKeys(value, expectedKeys, description) {
  assertPlainObject(value, description);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${description} keys do not match the closed schema.`);
  }
}

function requiredImageNames(mode) {
  const bindings = MODE_BINDINGS[mode];
  if (!bindings) throw new Error("Pinned override mode is unsupported.");
  return [...new Set(Object.values(bindings))];
}

function validateImageIds(mode, imageIds) {
  const required = requiredImageNames(mode);
  assertExactKeys(imageIds, required, "Pinned override image IDs");
  for (const name of required) {
    if (!IMAGE_ID.test(imageIds[name] ?? "")) {
      throw new Error(`Pinned override ${name} image ID is invalid.`);
    }
  }
}

function createPinnedOverride(mode, imageIds) {
  validateImageIds(mode, imageIds);
  const services = {};
  for (const [service, imageName] of Object.entries(MODE_BINDINGS[mode])) {
    services[service] = { image: imageIds[imageName] };
  }
  return { services };
}

function canonicalPinnedOverride(mode, imageIds) {
  return `${JSON.stringify(createPinnedOverride(mode, imageIds), null, 2)}\n`;
}

function validatePinnedOverride(text, mode, imageIds) {
  validateImageIds(mode, imageIds);
  let override;
  try {
    override = JSON.parse(text);
  } catch {
    throw new Error("Pinned Compose override is not valid JSON.");
  }
  assertExactKeys(override, ["services"], "Pinned Compose override");
  const bindings = MODE_BINDINGS[mode];
  assertExactKeys(
    override.services,
    Object.keys(bindings),
    "Pinned Compose override services",
  );
  for (const [service, imageName] of Object.entries(bindings)) {
    assertExactKeys(
      override.services[service],
      ["image"],
      `Pinned Compose override service ${service}`,
    );
    if (override.services[service].image !== imageIds[imageName]) {
      throw new Error(`Pinned Compose override service ${service} image differs.`);
    }
  }
  const canonical = canonicalPinnedOverride(mode, imageIds);
  if (text !== canonical) {
    throw new Error("Pinned Compose override is not canonical.");
  }
  return override;
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function parseArguments(argv) {
  const values = Object.create(null);
  const booleanFlags = new Set(["--create", "--validate-stdin", "--print-sha256"]);
  const valueFlags = new Set(["--mode", ...Object.values(IMAGE_FLAGS)]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (booleanFlags.has(flag)) {
      if (Object.hasOwn(values, flag)) throw new Error(`Duplicate flag: ${flag}`);
      values[flag] = true;
      continue;
    }
    if (!valueFlags.has(flag)) throw new Error(`Unknown flag: ${flag}`);
    if (Object.hasOwn(values, flag)) throw new Error(`Duplicate flag: ${flag}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}.`);
    values[flag] = value;
    index += 1;
  }
  return values;
}

function main() {
  try {
    const args = parseArguments(process.argv.slice(2));
    const mode = args["--mode"];
    if (!mode) throw new Error("--mode is required.");
    const create = args["--create"] === true;
    const validateStdin = args["--validate-stdin"] === true;
    if (create === validateStdin) {
      throw new Error("Choose exactly one --create or --validate-stdin mode.");
    }
    const imageIds = {};
    for (const name of requiredImageNames(mode)) {
      const flag = IMAGE_FLAGS[name];
      if (!args[flag]) throw new Error(`${flag} is required for ${mode}.`);
      imageIds[name] = args[flag];
    }
    for (const [name, flag] of Object.entries(IMAGE_FLAGS)) {
      if (!requiredImageNames(mode).includes(name) && args[flag]) {
        throw new Error(`${flag} is not valid for ${mode}.`);
      }
    }
    const text = create
      ? canonicalPinnedOverride(mode, imageIds)
      : fs.readFileSync(0, "utf8");
    if (validateStdin) validatePinnedOverride(text, mode, imageIds);
    process.stdout.write(args["--print-sha256"] ? `${sha256(text)}\n` : text);
  } catch (error) {
    process.stderr.write(`PINNED COMPOSE OVERRIDE BLOCKED: ${error.message}\n`);
    process.exitCode = 75;
  }
}

if (require.main === module) main();

module.exports = {
  IMAGE_FLAGS,
  IMAGE_ID,
  MODE_BINDINGS,
  canonicalPinnedOverride,
  createPinnedOverride,
  sha256,
  validatePinnedOverride,
};
