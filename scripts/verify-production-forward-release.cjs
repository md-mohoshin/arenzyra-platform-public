#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  validateReleaseEnvironmentText,
} = require("./validate-publish-release-env.cjs");

const FULL_COMMIT = /^[a-f0-9]{40}$/;
const COMPONENTS = Object.freeze([
  Object.freeze({ name: "ROOT", repository: ".", argument: "--candidate-root" }),
  Object.freeze({ name: "API", repository: "apps/api", argument: "--candidate-api" }),
  Object.freeze({ name: "WEB", repository: "apps/arenzyra-web", argument: "--candidate-web" }),
]);

function argumentValue(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0 || index === argv.length - 1) return undefined;
  return argv[index + 1];
}

function readRegularNonSymlink(filePath) {
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  let descriptor;
  try {
    descriptor = fs.openSync(
      path.resolve(filePath),
      fs.constants.O_RDONLY | noFollow,
    );
    if (!fs.fstatSync(descriptor).isFile()) {
      throw new Error("Prior release metadata is not a regular file.");
    }
    return fs.readFileSync(descriptor, "utf8");
  } catch (error) {
    if (error?.message?.includes("not a regular file")) throw error;
    throw new Error("Prior release metadata is unavailable.");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function assertForwardRelease({ previous, candidates, isAncestor }) {
  for (const component of COMPONENTS) {
    const previousCommit = previous[`ARENZYRA_${component.name}_GIT_COMMIT`];
    const candidateCommit = candidates[component.name];
    if (!/^[a-f0-9]{12}$/.test(previousCommit ?? "")) {
      throw new Error(
        `Prior ${component.name} release revision is not canonical.`,
      );
    }
    if (!FULL_COMMIT.test(candidateCommit ?? "")) {
      throw new Error(
        `Candidate ${component.name} release revision is not canonical.`,
      );
    }
    if (!isAncestor(component, previousCommit, candidateCommit)) {
      throw new Error(
        `Candidate ${component.name} history does not contain the deployed release.`,
      );
    }
  }
}

function gitEnvironment() {
  return {
    PATH: process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    HOME: process.env.HOME ?? "/root",
    LC_ALL: "C",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
}

function isGitAncestor(repositoryRoot, component, previousCommit, candidateCommit) {
  const repository = path.join(repositoryRoot, component.repository);
  const options = {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: gitEnvironment(),
    stdio: ["ignore", "pipe", "ignore"],
  };
  let resolvedPrevious;
  try {
    resolvedPrevious = execFileSync(
      "/usr/bin/git",
      [
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.hooksPath=/dev/null",
        "-C",
        repository,
        "rev-parse",
        "--verify",
        `${previousCommit}^{commit}`,
      ],
      options,
    ).trim();
  } catch {
    return false;
  }
  if (!FULL_COMMIT.test(resolvedPrevious)) return false;
  try {
    execFileSync(
      "/usr/bin/git",
      [
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.hooksPath=/dev/null",
        "-C",
        repository,
        "merge-base",
        "--is-ancestor",
        resolvedPrevious,
        candidateCommit,
      ],
      options,
    );
    return true;
  } catch {
    return false;
  }
}

function main() {
  try {
    const argv = process.argv.slice(2);
    const priorReleaseFile = argumentValue(argv, "--previous-release-env");
    if (!priorReleaseFile) throw new Error("Prior release metadata is required.");
    const previous = validateReleaseEnvironmentText(
      readRegularNonSymlink(priorReleaseFile),
    );
    const candidates = Object.fromEntries(
      COMPONENTS.map((component) => [
        component.name,
        argumentValue(argv, component.argument),
      ]),
    );
    const repositoryRoot = path.resolve(__dirname, "..");
    assertForwardRelease({
      previous,
      candidates,
      isAncestor: (component, oldCommit, candidateCommit) =>
        isGitAncestor(repositoryRoot, component, oldCommit, candidateCommit),
    });
    process.stdout.write(
      "FORWARD RELEASE HISTORY VERIFIED root=1 api=1 web=1\n",
    );
  } catch (error) {
    process.stderr.write(
      `FORWARD RELEASE HISTORY BLOCKED: ${error instanceof Error ? error.message : "unexpected verification failure"}\n`,
    );
    process.exitCode = 75;
  }
}

if (require.main === module) main();

module.exports = {
  COMPONENTS,
  FULL_COMMIT,
  assertForwardRelease,
  isGitAncestor,
  readRegularNonSymlink,
};
