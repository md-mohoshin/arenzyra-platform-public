#!/usr/bin/env node
"use strict";

const { readFileSync } = require("node:fs");
const path = require("node:path");
const { parseEnvText } = require("./production-database-target.cjs");

function parseEnvValue(text, key) {
  const env = parseEnvText(text);
  if (!env[key]) throw new Error(`Missing environment value: ${key}`);
  return env[key];
}

function main() {
  const [envFile, key, field] = process.argv.slice(2);
  const safeKey = /^[A-Z][A-Z0-9_]*$/.test(key ?? "") ? key : "requested key";
  try {
    if (!envFile || !key || !field) throw new Error("invalid invocation");
    const rawValue = parseEnvValue(
      readFileSync(path.resolve(envFile), "utf8"),
      key,
    );
    const url = new URL(rawValue);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) {
      throw new Error("unsupported protocol");
    }
    const values = {
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    };
    if (!Object.hasOwn(values, field)) throw new Error("unsupported field");
    const value = values[field];
    if (!value || /[\0\r\n]/.test(value)) throw new Error("unsafe value");
    process.stdout.write(value);
  } catch {
    process.stderr.write(
      `POSTGRES URL FIELD BLOCKED: ${safeKey} could not be read safely.\n`,
    );
    process.exitCode = 75;
  }
}

main();
