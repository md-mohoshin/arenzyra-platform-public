#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  authorizeReleaseProvenance,
  collectReleaseFiles,
  createReleaseMetadata,
  defaultGitComponents,
  defaultIncludedPaths,
} = require("./create-publish-release-metadata.cjs");
const {
  validateReleaseEnvironmentText,
} = require("./validate-publish-release-env.cjs");

const EXPECTED_PRODUCTION_ROOT = "/opt/arenzyra";

function readRegularNoFollow(file, description) {
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  let descriptor;
  try {
    descriptor = fs.openSync(path.resolve(file), fs.constants.O_RDONLY | noFollow);
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) throw new Error(`${description} must be a regular file.`);
    return fs.readFileSync(descriptor);
  } catch (error) {
    if (error?.message?.includes("must be a regular")) throw error;
    throw new Error(`${description} must be one readable regular non-symlink file.`);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function assertSecureStat(stat, description, { requireSingleLink = false } = {}) {
  if (stat.isSymbolicLink()) throw new Error(`${description} must not be a symlink.`);
  if (!stat.isFile() && !stat.isDirectory()) {
    throw new Error(`${description} must be a regular file or directory.`);
  }
  if (stat.uid !== 0 || stat.gid !== 0) {
    throw new Error(`${description} must be owned by root:root.`);
  }
  if ((stat.mode & 0o022) !== 0) {
    throw new Error(`${description} must not be group- or other-writable.`);
  }
  if (requireSingleLink && stat.nlink !== 1) {
    throw new Error(`${description} must have exactly one hard link.`);
  }
}

function assertSecurePath(targetPath, description, options) {
  const stat = fs.lstatSync(targetPath);
  assertSecureStat(stat, description, options);
  return stat;
}

function walkSecureTree(targetPath, description) {
  const stat = assertSecurePath(targetPath, description);
  if (!stat.isDirectory()) return;
  for (const entry of fs.readdirSync(targetPath)) {
    walkSecureTree(path.join(targetPath, entry), `${description}/${entry}`);
  }
}

function assertSecureProductionCheckout({
  rootDir = EXPECTED_PRODUCTION_ROOT,
  includedPaths = defaultIncludedPaths,
  gitComponents = defaultGitComponents,
} = {}) {
  if (process.platform !== "linux") {
    throw new Error("Production source safety verification requires Linux.");
  }
  const resolvedRoot = fs.realpathSync(rootDir);
  if (resolvedRoot !== EXPECTED_PRODUCTION_ROOT) {
    throw new Error("Production source root must resolve exactly to /opt/arenzyra.");
  }
  for (const ancestor of ["/", "/opt", resolvedRoot]) {
    assertSecurePath(ancestor, `Production source ancestor ${ancestor}`);
  }

  const checkedDirectories = new Set();
  const checkAncestors = (targetPath) => {
    let current = path.dirname(targetPath);
    while (current === resolvedRoot || current.startsWith(`${resolvedRoot}/`)) {
      if (!checkedDirectories.has(current)) {
        assertSecurePath(current, `Production source directory ${current}`);
        checkedDirectories.add(current);
      }
      if (current === resolvedRoot) break;
      current = path.dirname(current);
    }
  };

  for (const file of collectReleaseFiles({ rootDir: resolvedRoot, includedPaths })) {
    checkAncestors(file);
    assertSecurePath(file, `Production release input ${file}`, {
      requireSingleLink: true,
    });
  }

  const repositories = new Set(gitComponents.map(({ repoPath }) => repoPath));
  for (const relativeRepository of repositories) {
    const repository = path.resolve(resolvedRoot, relativeRepository);
    checkAncestors(repository);
    assertSecurePath(repository, `Production Git checkout ${repository}`);
    const gitDirectory = path.join(repository, ".git");
    const gitStat = assertSecurePath(
      gitDirectory,
      `Production Git metadata ${gitDirectory}`,
    );
    if (!gitStat.isDirectory()) {
      throw new Error(`Production Git metadata ${gitDirectory} must be a directory.`);
    }
    walkSecureTree(gitDirectory, `Production Git metadata ${gitDirectory}`);
  }
}

function serializeReleaseMetadata(metadata) {
  return Buffer.from(metadata.lines.join("\n"));
}

function assertExactReleaseBytes(expectedBytes, metadata) {
  const actualBytes = serializeReleaseMetadata(metadata);
  if (
    expectedBytes.length !== actualBytes.length ||
    !crypto.timingSafeEqual(expectedBytes, actualBytes)
  ) {
    throw new Error(
      "Recomputed clean source provenance differs from the archived release environment.",
    );
  }
}

function verifyProductionReleaseSource(releaseEnvironmentFile) {
  assertSecureProductionCheckout();
  const expectedBytes = readRegularNoFollow(
    releaseEnvironmentFile,
    "Archived release environment",
  );
  const release = validateReleaseEnvironmentText(expectedBytes.toString("utf8"));
  const recomputed = createReleaseMetadata({
    rootDir: EXPECTED_PRODUCTION_ROOT,
    builtAt: release.ARENZYRA_BUILD_AT,
  });
  authorizeReleaseProvenance(recomputed);
  assertExactReleaseBytes(expectedBytes, recomputed);
  return release.ARENZYRA_RELEASE_ID;
}

function parseArguments(argv) {
  if (argv.length === 1 && argv[0] === "--check-checkout-only") {
    return { checkoutOnly: true, releaseEnvironmentFile: null };
  }
  if (argv.length === 2 && argv[0] === "--release-env" && argv[1]) {
    return { checkoutOnly: false, releaseEnvironmentFile: argv[1] };
  }
  throw new Error(
    "Usage: verify-production-release-source.cjs --check-checkout-only | --release-env <file>",
  );
}

function main() {
  try {
    const parsedArguments = parseArguments(process.argv.slice(2));
    if (parsedArguments.checkoutOnly) {
      assertSecureProductionCheckout();
      process.stdout.write("PRODUCTION RELEASE CHECKOUT VERIFIED\n");
      return;
    }
    const releaseId = verifyProductionReleaseSource(
      parsedArguments.releaseEnvironmentFile,
    );
    process.stdout.write(`PRODUCTION RELEASE SOURCE VERIFIED release=${releaseId}\n`);
  } catch (error) {
    process.stderr.write(`PRODUCTION RELEASE SOURCE BLOCKED: ${error.message}\n`);
    process.exitCode = 75;
  }
}

if (require.main === module) main();

module.exports = {
  EXPECTED_PRODUCTION_ROOT,
  assertExactReleaseBytes,
  assertSecureProductionCheckout,
  assertSecureStat,
  parseArguments,
  serializeReleaseMetadata,
  verifyProductionReleaseSource,
};
