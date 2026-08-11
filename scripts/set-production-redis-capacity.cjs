#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function fail(message) {
  process.stderr.write(`REDIS CAPACITY CONFIGURATION BLOCKED: ${message}\n`);
  process.exit(75);
}

const args = process.argv.slice(2);
if (
  args.length !== 6 ||
  args[0] !== "--env" ||
  args[2] !== "--from" ||
  args[4] !== "--to"
) {
  fail("expected --env FILE --from VALUE --to VALUE");
}

const envFile = path.resolve(args[1]);
const expectedEnv = "/opt/arenzyra/infra/.env.publish";
if (envFile !== expectedEnv) fail("environment path differs");
if (args[3] !== "768mb" || args[5] !== "3gb") {
  fail("only the reviewed 768mb to 3gb transition is permitted");
}

let stat;
try {
  stat = fs.lstatSync(envFile);
} catch {
  fail("environment file is unavailable");
}
if (
  !stat.isFile() ||
  stat.isSymbolicLink() ||
  stat.uid !== 0 ||
  stat.gid !== 0 ||
  (stat.mode & 0o777) !== 0o600 ||
  stat.nlink !== 1 ||
  stat.size <= 0 ||
  stat.size > 1024 * 1024
) {
  fail("environment file identity or permissions differ");
}

const original = fs.readFileSync(envFile, "utf8");
if (original.includes("\0")) fail("environment file contains invalid bytes");
const capacityMatches = original.match(/^REDIS_MAXMEMORY=768mb$/gm) ?? [];
const ratioMatches = original.match(/^REDIS_READY_MAX_MEMORY_RATIO=0\.85$/gm) ?? [];
if (capacityMatches.length !== 1 || ratioMatches.length !== 1) {
  fail("current Redis capacity settings differ from the reviewed saturated profile");
}
const updated = original.replace(/^REDIS_MAXMEMORY=768mb$/m, "REDIS_MAXMEMORY=3gb");
if (updated === original || (updated.match(/^REDIS_MAXMEMORY=3gb$/gm) ?? []).length !== 1) {
  fail("capacity update was not exact");
}

const directory = path.dirname(envFile);
const temporary = path.join(directory, `.env.publish.redis-capacity.${process.pid}`);
let descriptor;
try {
  descriptor = fs.openSync(temporary, "wx", 0o600);
  fs.writeFileSync(descriptor, updated, { encoding: "utf8" });
  fs.fsyncSync(descriptor);
  fs.closeSync(descriptor);
  descriptor = undefined;
  fs.chownSync(temporary, 0, 0);
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, envFile);
  const directoryFd = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(directoryFd);
  } finally {
    fs.closeSync(directoryFd);
  }
} catch {
  if (descriptor !== undefined) {
    try { fs.closeSync(descriptor); } catch {}
  }
  try { fs.unlinkSync(temporary); } catch {}
  fail("atomic environment update failed");
}

const finalStat = fs.lstatSync(envFile);
const finalText = fs.readFileSync(envFile, "utf8");
if (
  !finalStat.isFile() ||
  finalStat.isSymbolicLink() ||
  finalStat.uid !== 0 ||
  finalStat.gid !== 0 ||
  (finalStat.mode & 0o777) !== 0o600 ||
  finalStat.nlink !== 1 ||
  finalText !== updated
) {
  fail("post-update verification failed");
}
process.stdout.write("REDIS CAPACITY CONFIGURATION UPDATED old=768mb new=3gb secrets=preserved\n");
