#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "..");
const canonicalVerifierRelativePath =
  "apps/api/scripts/verify-runtime-image-boundary.cjs";

function requireRegularFile(filePath, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    throw new Error(`${label} is missing.`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file.`);
  }
}

function verifyCanonicalApiImageContract(rootDir = repositoryRoot) {
  const resolvedRoot = path.resolve(rootDir);
  const apiRoot = path.join(resolvedRoot, "apps", "api");
  const verifierPath = path.join(
    resolvedRoot,
    ...canonicalVerifierRelativePath.split("/"),
  );
  requireRegularFile(
    verifierPath,
    "Canonical API runtime-image boundary verifier",
  );

  let verifier;
  try {
    verifier = require(verifierPath);
  } catch {
    throw new Error(
      "Canonical API runtime-image boundary verifier could not be loaded.",
    );
  }
  if (typeof verifier.verifySourceBoundary !== "function") {
    throw new Error(
      "Canonical API runtime-image boundary verifier has no source-mode contract.",
    );
  }

  const result = verifier.verifySourceBoundary(apiRoot);
  if (
    !result ||
    typeof result !== "object" ||
    result.mode !== "source" ||
    typeof result.ok !== "boolean" ||
    !Array.isArray(result.failures) ||
    result.failures.some((failure) => typeof failure !== "string")
  ) {
    throw new Error(
      "Canonical API runtime-image boundary verifier returned an invalid result.",
    );
  }
  return result;
}

function runCli(argv = process.argv.slice(2)) {
  if (argv.length !== 0) {
    process.stderr.write(
      "API IMAGE CONTRACT BLOCKED: this command accepts no arguments.\n",
    );
    return 75;
  }
  try {
    const result = verifyCanonicalApiImageContract();
    if (!result.ok) {
      for (const failure of result.failures) {
        process.stderr.write(`API IMAGE CONTRACT BLOCKED: ${failure}\n`);
      }
      return 75;
    }
    process.stdout.write("API IMAGE CONTRACT VERIFIED mode=source\n");
    return 0;
  } catch (error) {
    process.stderr.write(
      `API IMAGE CONTRACT BLOCKED: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 75;
  }
}

if (require.main === module) process.exitCode = runCli();

module.exports = {
  canonicalVerifierRelativePath,
  runCli,
  verifyCanonicalApiImageContract,
};
