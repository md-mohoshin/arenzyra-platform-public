#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..");
const RELEASE_INPUT_PATHS = Object.freeze([
  "package.json",
  "package-lock.json",
  "apps/desktop",
  "ob.js",
  "scripts/blocked-launcher-release-entrypoint.cjs",
  "scripts/launcher-release-artifact-verifier.cjs",
  "scripts/sync-brand-icons.cjs",
  "scripts/sync-desktop-maps.cjs",
  "scripts/sync-launcher-downloads.cjs",
  "scripts/verify-desktop-connector-provenance.cjs",
  "scripts/verify-desktop-map-provenance.cjs",
  "scripts/verify-desktop-release-inputs.cjs",
]);
const ALLOWED_IGNORED_PREFIXES = Object.freeze([
  "apps/desktop/node_modules/",
  "apps/desktop/dist/",
  "apps/desktop/coverage/",
  "apps/desktop/test-results/",
  "apps/desktop/.vite/",
]);
const ALLOWED_IGNORED_PATHS = new Set([
  "apps/desktop/electron-debug.log",
  "apps/desktop/.eslintcache",
]);

class DesktopReleaseInputError extends Error {
  constructor(message, result) {
    super(message);
    this.name = "DesktopReleaseInputError";
    this.result = result;
  }
}

function toPosixPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function cleanGitEnvironment(source = process.env) {
  const clean = {};
  for (const [key, value] of Object.entries(source)) {
    if (!/^GIT_/i.test(key)) {
      clean[key] = value;
    }
  }
  return clean;
}

function runGit(repoRoot, args) {
  const result = spawnSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    env: cleanGitEnvironment(),
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`Could not execute Git: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(
      `Git release-input inspection failed (exit ${result.status})${
        detail ? `: ${detail}` : ""
      }`,
    );
  }
  return String(result.stdout || "");
}

function parseNullList(output) {
  return output.split("\0").filter(Boolean).map(toPosixPath);
}

function parseNameStatus(output) {
  const tokens = output.split("\0").filter(Boolean);
  if (tokens.length % 2 !== 0) {
    throw new Error("Git returned malformed release-input status data.");
  }
  const entries = [];
  for (let index = 0; index < tokens.length; index += 2) {
    entries.push({
      status: tokens[index],
      path: toPosixPath(tokens[index + 1]),
    });
  }
  return entries;
}

function parseIndexFlags(output) {
  return parseNullList(output).map((entry) => {
    const separator = entry.indexOf(" ");
    if (separator !== 1) {
      throw new Error("Git returned malformed release-input index data.");
    }
    return {
      flag: entry.slice(0, separator),
      path: entry.slice(separator + 1),
    };
  });
}

function samePath(left, right) {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return process.platform === "win32"
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
}

function isAllowedIgnoredPath(filePath) {
  const normalized = toPosixPath(filePath);
  return (
    ALLOWED_IGNORED_PATHS.has(normalized) ||
    ALLOWED_IGNORED_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
}

function comparableFilesystemPath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function sameFileIdentity(left, right) {
  return (
    left.dev !== 0n &&
    left.ino !== 0n &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode
  );
}

function inspectRegularFileLinkState(filePath, initialStat) {
  let descriptor;
  try {
    let flags = fs.constants.O_RDONLY;
    if (Number.isInteger(fs.constants.O_NOFOLLOW)) {
      flags |= fs.constants.O_NOFOLLOW;
    }
    if (Number.isInteger(fs.constants.O_NONBLOCK)) {
      flags |= fs.constants.O_NONBLOCK;
    }
    descriptor = fs.openSync(filePath, flags);
    const descriptorStat = fs.fstatSync(descriptor, { bigint: true });
    const finalPathStat = fs.lstatSync(filePath, { bigint: true });
    if (
      !descriptorStat.isFile() ||
      !finalPathStat.isFile() ||
      !sameFileIdentity(initialStat, descriptorStat) ||
      !sameFileIdentity(descriptorStat, finalPathStat)
    ) {
      return "changed-during-inspection";
    }
    if (
      initialStat.nlink !== 1n ||
      descriptorStat.nlink !== 1n ||
      finalPathStat.nlink !== 1n
    ) {
      return "multiply-linked-file";
    }
    return null;
  } catch (error) {
    if (["ELOOP", "ENOENT", "ENOTDIR"].includes(error?.code)) {
      return "changed-during-inspection";
    }
    throw error;
  } finally {
    if (descriptor !== undefined) {
      fs.closeSync(descriptor);
    }
  }
}

function inspectTrackedPathLinks(repoRoot, trackedPaths) {
  const findings = new Map();
  for (const trackedPath of trackedPaths) {
    const normalized = toPosixPath(trackedPath);
    if (
      !normalized ||
      normalized.startsWith("/") ||
      normalized === ".." ||
      normalized.startsWith("../")
    ) {
      throw new Error(
        `Git returned an unsafe release-input path: ${normalized}`,
      );
    }
    let current = repoRoot;
    const segments = normalized.split("/");
    for (const [index, segment] of segments.entries()) {
      current = path.join(current, segment);
      let stat;
      try {
        stat = fs.lstatSync(current, { bigint: true });
      } catch (error) {
        if (error?.code === "ENOENT") {
          findings.set(normalized, {
            path: normalized,
            linkedAt: toPosixPath(path.relative(repoRoot, current)),
            kind: "changed-during-inspection",
          });
          break;
        }
        throw error;
      }
      const linkedAt = toPosixPath(path.relative(repoRoot, current));
      if (stat.isSymbolicLink()) {
        findings.set(normalized, {
          path: normalized,
          linkedAt,
          kind: "symbolic-link-or-junction",
        });
        break;
      }
      const physicalPath = fs.realpathSync.native(current);
      if (
        comparableFilesystemPath(physicalPath) !==
        comparableFilesystemPath(current)
      ) {
        findings.set(normalized, {
          path: normalized,
          linkedAt,
          kind: "redirected-or-reparse-path",
        });
        break;
      }
      if (index === segments.length - 1 && stat.isFile()) {
        const kind = inspectRegularFileLinkState(current, stat);
        if (kind) {
          findings.set(normalized, {
            path: normalized,
            linkedAt,
            kind,
          });
          break;
        }
      }
    }
  }
  return Array.from(findings.values()).sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

function inspectDesktopReleaseInputs({ repoRoot = DEFAULT_REPO_ROOT } = {}) {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const discoveredRoot = runGit(resolvedRepoRoot, [
    "rev-parse",
    "--show-toplevel",
  ]).trim();
  if (!samePath(discoveredRoot, resolvedRepoRoot)) {
    throw new Error(
      `Desktop release guard expected repository root ${resolvedRepoRoot}, but Git resolved ${discoveredRoot}.`,
    );
  }

  // --no-renames keeps the NUL-delimited record shape deterministic: every
  // status token is followed by exactly one path token.
  const trackedChanges = parseNameStatus(
    runGit(resolvedRepoRoot, [
      "diff",
      "--name-status",
      "--no-renames",
      "-z",
      "HEAD",
      "--",
      ...RELEASE_INPUT_PATHS,
    ]),
  );
  // Git normally skips content checks for assume-unchanged and sparse
  // skip-worktree entries. Those index flags are unsafe for a release input
  // because a locally different file could otherwise evade `git diff`.
  const unsafeIndexFlags = parseIndexFlags(
    runGit(resolvedRepoRoot, [
      "ls-files",
      "-v",
      "-z",
      "--",
      ...RELEASE_INPUT_PATHS,
    ]),
  ).filter((entry) => entry.flag !== "H");
  const trackedPaths = parseNullList(
    runGit(resolvedRepoRoot, ["ls-files", "-z", "--", ...RELEASE_INPUT_PATHS]),
  );
  const linkedPaths = inspectTrackedPathLinks(resolvedRepoRoot, trackedPaths);
  const untrackedPaths = parseNullList(
    runGit(resolvedRepoRoot, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ...RELEASE_INPUT_PATHS,
    ]),
  );
  const ignoredPackagePaths = parseNullList(
    runGit(resolvedRepoRoot, [
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "-z",
      "--",
      "apps/desktop",
    ]),
  ).filter((filePath) => !isAllowedIgnoredPath(filePath));

  return {
    repoRoot: resolvedRepoRoot,
    trackedChanges,
    unsafeIndexFlags,
    linkedPaths,
    untrackedPaths,
    ignoredPackagePaths,
    clean:
      trackedChanges.length === 0 &&
      unsafeIndexFlags.length === 0 &&
      linkedPaths.length === 0 &&
      untrackedPaths.length === 0 &&
      ignoredPackagePaths.length === 0,
  };
}

function formatSection(label, entries, formatEntry) {
  if (entries.length === 0) {
    return [];
  }
  const visible = entries.slice(0, 50);
  const lines = [label, ...visible.map((entry) => `  ${formatEntry(entry)}`)];
  if (entries.length > visible.length) {
    lines.push(`  ... ${entries.length - visible.length} more`);
  }
  return lines;
}

function buildFailureMessage(result) {
  return [
    "Desktop release inputs do not match Git HEAD.",
    "Commit or intentionally remove every listed input before building, verifying, or publishing launcher artifacts.",
    ...formatSection(
      "Tracked changes:",
      result.trackedChanges,
      (entry) => `${entry.status} ${entry.path}`,
    ),
    ...formatSection(
      "Unsafe Git index flags:",
      result.unsafeIndexFlags,
      (entry) => `${entry.flag} ${entry.path}`,
    ),
    ...formatSection(
      "Linked, redirected, or unstable tracked inputs:",
      result.linkedPaths,
      (entry) => `${entry.kind} ${entry.path} (at ${entry.linkedAt})`,
    ),
    ...formatSection(
      "Untracked inputs:",
      result.untrackedPaths,
      (entry) => `? ${entry}`,
    ),
    ...formatSection(
      "Ignored files in package-relevant locations:",
      result.ignoredPackagePaths,
      (entry) => `! ${entry}`,
    ),
    "Changes outside the declared desktop release inputs are intentionally outside this guard.",
  ].join("\n");
}

function assertDesktopReleaseInputsClean(options = {}) {
  const result = inspectDesktopReleaseInputs(options);
  if (!result.clean) {
    throw new DesktopReleaseInputError(buildFailureMessage(result), result);
  }
  return result;
}

function main() {
  try {
    const result = assertDesktopReleaseInputsClean();
    process.stdout.write(
      `[desktop-release-inputs] clean at Git HEAD (${result.repoRoot})\n`,
    );
  } catch (error) {
    process.stderr.write(
      `[desktop-release-inputs] blocked: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  ALLOWED_IGNORED_PATHS,
  ALLOWED_IGNORED_PREFIXES,
  DesktopReleaseInputError,
  RELEASE_INPUT_PATHS,
  assertDesktopReleaseInputsClean,
  inspectDesktopReleaseInputs,
  inspectTrackedPathLinks,
  isAllowedIgnoredPath,
};
