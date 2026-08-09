#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { parseEnvText } = require("./production-database-target.cjs");

const [filePath, key] = process.argv.slice(2);
if (!filePath || !/^[A-Z][A-Z0-9_]*$/.test(String(key || ""))) {
  process.stderr.write("Usage: read-dotenv-value.cjs <env-file> <KEY>\n");
  process.exit(2);
}
const env = parseEnvText(fs.readFileSync(filePath, "utf8"));
process.stdout.write(env[key] ?? "");
