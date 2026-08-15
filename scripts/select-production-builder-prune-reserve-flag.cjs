#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { TextDecoder } = require("node:util");

const MAX_HELP_BYTES = 256 * 1024;

function selectReserveFlag(helpText) {
  if (typeof helpText !== "string" || helpText.includes("\0")) {
    throw new Error("Docker builder-prune help is not valid text.");
  }
  const optionLines = helpText.split(/\n/).map((line) => line.replace(/\r$/, ""));
  const hasOption = (name) =>
    optionLines.some((line) =>
      new RegExp(`^\\s*${name}(?:[ =<\\[]|$)`).test(line),
    );

  // --reserved-space is the current BuildKit spelling. --keep-storage is the
  // older spelling with the same reserve-floor meaning. --max-used-space is a
  // different ceiling and is deliberately not accepted for this operation.
  if (hasOption("--reserved-space")) return "--reserved-space";
  if (hasOption("--keep-storage")) return "--keep-storage";
  throw new Error("Docker exposes no reviewed builder-cache reserve flag.");
}

function main() {
  try {
    if (process.argv.length !== 2) {
      throw new Error("No command-line arguments are accepted.");
    }
    const bytes = fs.readFileSync(0);
    if (bytes.length === 0 || bytes.length > MAX_HELP_BYTES) {
      throw new Error("Docker builder-prune help size is outside policy.");
    }
    const helpText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    process.stdout.write(`${selectReserveFlag(helpText)}\n`);
  } catch (error) {
    process.stderr.write(`BUILDER PRUNE FLAG BLOCKED: ${error.message}\n`);
    process.exitCode = 75;
  }
}

if (require.main === module) main();

module.exports = { MAX_HELP_BYTES, selectReserveFlag };
