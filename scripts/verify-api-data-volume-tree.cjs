#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MAX_ENTRIES = 1_000_000;

function inspectVolumeTree(
  root,
  {
    uid,
    gid,
    maxEntries = MAX_ENTRIES,
    enforceMode = true,
    legacyRootProfile = false,
  },
) {
  const resolvedRoot = path.resolve(root);
  const rootStat = fs.lstatSync(resolvedRoot, { bigint: false });
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("volume root is not a real directory");
  }

  const stack = [resolvedRoot];
  let entries = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    const stat = fs.lstatSync(current, { bigint: false });
    entries += 1;
    if (entries > maxEntries) throw new Error("volume entry ceiling exceeded");
    if (stat.dev !== rootStat.dev) throw new Error("nested filesystem is not allowed");
    if (stat.uid !== uid || stat.gid !== gid) {
      throw new Error("volume entry ownership is unexpected");
    }
    if (stat.isSymbolicLink()) throw new Error("symbolic links are not allowed");
    if (stat.isDirectory()) {
      const mode = stat.mode & 0o7777;
      if (legacyRootProfile && mode !== 0o755 && mode !== 0o777) {
        throw new Error("legacy directory mode is unexpected");
      }
      if (!legacyRootProfile && enforceMode && (mode & 0o002) !== 0) {
        throw new Error("volume entry is world-writable");
      }
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        stack.push(path.join(current, entry.name));
      }
      continue;
    }
    if (!stat.isFile()) throw new Error("special filesystem nodes are not allowed");
    if (stat.nlink !== 1) throw new Error("hard-linked regular files are not allowed");
    const mode = stat.mode & 0o7777;
    if (legacyRootProfile && mode !== 0o644 && mode !== 0o666) {
      throw new Error("legacy regular-file mode is unexpected");
    }
    if (!legacyRootProfile && enforceMode && (mode & 0o002) !== 0) {
      throw new Error("volume entry is world-writable");
    }
  }
  return { entries };
}

function parseArguments(argv) {
  const legacyRootProfile = argv[6] === "--legacy-root-profile";
  if (
    (argv.length !== 6 && !(argv.length === 7 && legacyRootProfile)) ||
    argv[0] !== "--root" ||
    argv[2] !== "--uid" ||
    argv[4] !== "--gid"
  ) {
    throw new Error("exact root/uid/gid arguments are required");
  }
  const uid = Number(argv[3]);
  const gid = Number(argv[5]);
  if (!Number.isSafeInteger(uid) || uid < 0 || !Number.isSafeInteger(gid) || gid < 0) {
    throw new Error("uid/gid are invalid");
  }
  if (legacyRootProfile && (uid !== 0 || gid !== 0)) {
    throw new Error("legacy root profile requires root ownership");
  }
  return { root: argv[1], uid, gid, legacyRootProfile };
}

function main() {
  try {
    const { root, uid, gid, legacyRootProfile } = parseArguments(
      process.argv.slice(2),
    );
    const result = inspectVolumeTree(root, { uid, gid, legacyRootProfile });
    process.stdout.write(`API DATA VOLUME TREE VERIFIED entries=${result.entries}\n`);
  } catch {
    process.stderr.write(
      "API DATA VOLUME TREE BLOCKED: contents violate the reviewed regular-file/directory boundary.\n",
    );
    process.exitCode = 75;
  }
}

if (require.main === module) main();

module.exports = { inspectVolumeTree, parseArguments };
