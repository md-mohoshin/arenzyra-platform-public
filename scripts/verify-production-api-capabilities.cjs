#!/usr/bin/env node
"use strict";

const verifier = require("../apps/api/scripts/verify-runtime-capabilities.cjs");

if (require.main === module) {
  process.exitCode = verifier.runCli(process.argv.slice(2));
}

module.exports = verifier;
