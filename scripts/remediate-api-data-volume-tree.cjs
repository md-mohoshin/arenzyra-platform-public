#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MAX_ENTRIES = 1_000_000;
const TARGET_UID = 1000;
const TARGET_GID = 1000;

function hashFile(fullPath, expected) {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  const descriptor = fs.openSync(fullPath, flags);
  try {
    const actual = fs.fstatSync(descriptor);
    if (
      !actual.isFile() ||
      actual.dev !== expected.dev ||
      actual.ino !== expected.ino ||
      actual.nlink !== 1
    ) {
      throw new Error("volume entry identity changed");
    }
    const hash = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    while (true) {
      const length = fs.readSync(descriptor, buffer, 0, buffer.length, offset);
      if (length === 0) break;
      hash.update(buffer.subarray(0, length));
      offset += length;
    }
    return hash.digest("hex");
  } finally {
    fs.closeSync(descriptor);
  }
}

function inventoryLegacyTree(root) {
  const resolvedRoot = path.resolve(root);
  const rootStat = fs.lstatSync(resolvedRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("volume root is not a real directory");
  }
  const entries = [];
  const pending = [resolvedRoot];
  while (pending.length > 0) {
    const fullPath = pending.pop();
    const stat = fs.lstatSync(fullPath);
    if (entries.length >= MAX_ENTRIES)
      throw new Error("volume entry ceiling exceeded");
    if (stat.dev !== rootStat.dev || stat.uid !== 0 || stat.gid !== 0) {
      throw new Error("legacy volume ownership or device is unexpected");
    }
    if (stat.isSymbolicLink()) throw new Error("volume symlink is forbidden");
    const mode = stat.mode & 0o7777;
    if (stat.isDirectory()) {
      if (mode !== 0o755 && mode !== 0o777) {
        throw new Error("legacy directory mode is unexpected");
      }
      entries.push({ fullPath, stat, type: "directory" });
      const children = fs.readdirSync(fullPath, { withFileTypes: true });
      for (const child of children)
        pending.push(path.join(fullPath, child.name));
    } else if (stat.isFile() && stat.nlink === 1) {
      if (mode !== 0o644 && mode !== 0o666) {
        throw new Error("legacy file mode is unexpected");
      }
      entries.push({
        fullPath,
        stat,
        type: "file",
        hash: hashFile(fullPath, stat),
      });
    } else {
      throw new Error("legacy volume contains a special or linked entry");
    }
  }
  return { resolvedRoot, rootDevice: rootStat.dev, entries };
}

function mutateEntry(entry) {
  const directoryFlag =
    entry.type === "directory" ? (fs.constants.O_DIRECTORY ?? 0) : 0;
  const flags =
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | directoryFlag;
  const descriptor = fs.openSync(entry.fullPath, flags);
  try {
    const actual = fs.fstatSync(descriptor);
    if (
      actual.dev !== entry.stat.dev ||
      actual.ino !== entry.stat.ino ||
      (entry.type === "directory" ? !actual.isDirectory() : !actual.isFile())
    ) {
      throw new Error("volume entry changed before remediation");
    }
    fs.fchownSync(descriptor, TARGET_UID, TARGET_GID);
    fs.fchmodSync(descriptor, entry.type === "directory" ? 0o750 : 0o640);
  } finally {
    fs.closeSync(descriptor);
  }
}

function verifyRemediatedTree(inventory) {
  let fileCount = 0;
  let directoryCount = 0;
  const contentManifest = crypto.createHash("sha256");
  for (const entry of inventory.entries) {
    const stat = fs.lstatSync(entry.fullPath);
    if (
      stat.dev !== entry.stat.dev ||
      stat.ino !== entry.stat.ino ||
      stat.uid !== TARGET_UID ||
      stat.gid !== TARGET_GID ||
      stat.isSymbolicLink()
    ) {
      throw new Error("remediated volume identity is invalid");
    }
    if (entry.type === "directory") {
      if (!stat.isDirectory() || (stat.mode & 0o7777) !== 0o750) {
        throw new Error("remediated directory policy failed");
      }
      directoryCount += 1;
    } else {
      const hash = hashFile(entry.fullPath, stat);
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        (stat.mode & 0o7777) !== 0o640 ||
        stat.size !== entry.stat.size ||
        hash !== entry.hash
      ) {
        throw new Error("remediated file content or policy changed");
      }
      contentManifest.update(Buffer.from(entry.hash, "ascii"));
      fileCount += 1;
    }
  }
  return {
    entries: inventory.entries.length,
    files: fileCount,
    directories: directoryCount,
    contentDigest: contentManifest.digest("hex"),
  };
}

function remediateVolumeTree(root) {
  const inventory = inventoryLegacyTree(root);
  for (const entry of inventory.entries.filter(
    (value) => value.type === "file",
  )) {
    mutateEntry(entry);
  }
  for (const entry of inventory.entries
    .filter((value) => value.type === "directory")
    .sort((left, right) => right.fullPath.length - left.fullPath.length)) {
    mutateEntry(entry);
  }
  return verifyRemediatedTree(inventory);
}

function main(argv = process.argv.slice(2)) {
  try {
    if (
      argv.length !== 2 ||
      argv[0] !== "--root" ||
      !path.isAbsolute(argv[1])
    ) {
      throw new Error("exact absolute root is required");
    }
    const result = remediateVolumeTree(argv[1]);
    process.stdout.write(
      `API DATA VOLUME REMEDIATED entries=${result.entries} files=${result.files} directories=${result.directories} content_sha256=${result.contentDigest}\n`,
    );
  } catch {
    process.stderr.write(
      "API DATA VOLUME REMEDIATION BLOCKED: the exact legacy tree could not be transformed without content drift.\n",
    );
    process.exitCode = 75;
  }
}

if (require.main === module) main();

module.exports = {
  inventoryLegacyTree,
  remediateVolumeTree,
  verifyRemediatedTree,
};
