#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function fail(message) {
  process.stderr.write(`PROXY ADDRESS CONFIGURATION BLOCKED: ${message}\n`);
  process.exit(75);
}

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--env") {
  fail("expected --env FILE");
}
const envFile = path.resolve(args[1]);
if (envFile !== "/opt/arenzyra/infra/.env.publish") {
  fail("environment path differs");
}
let stat;
try { stat = fs.lstatSync(envFile); } catch { fail("environment file is unavailable"); }
if (
  !stat.isFile() || stat.isSymbolicLink() || stat.uid !== 0 || stat.gid !== 0 ||
  (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1 || stat.size <= 0 ||
  stat.size > 1024 * 1024
) {
  fail("environment file identity or permissions differ");
}
const original = fs.readFileSync(envFile, "utf8");
if (original.includes("\0")) fail("environment file contains invalid bytes");
const oldProxy = original.match(/^ARENZYRA_PROXY_IP=172\.30\.50\.2$/gm) ?? [];
const oldTrust = original.match(/^TRUSTED_PROXY_IPS=172\.30\.50\.2$/gm) ?? [];
const newProxy = original.match(/^ARENZYRA_PROXY_IP=172\.30\.50\.7$/gm) ?? [];
const newTrust = original.match(/^TRUSTED_PROXY_IPS=172\.30\.50\.7$/gm) ?? [];
const alreadyUpdated =
  oldProxy.length === 0 && oldTrust.length === 0 &&
  newProxy.length === 1 && newTrust.length === 1;
if (alreadyUpdated) {
  process.stdout.write("PROXY ADDRESS CONFIGURATION ALREADY UPDATED address=172.30.50.7 secrets=preserved\n");
  process.exit(0);
}
if (
  oldProxy.length !== 1 || oldTrust.length !== 1 ||
  newProxy.length !== 0 || newTrust.length !== 0
) {
  fail("current proxy address settings differ from the reviewed collision profile");
}
const updated = original
  .replace(/^ARENZYRA_PROXY_IP=172\.30\.50\.2$/m, "ARENZYRA_PROXY_IP=172.30.50.7")
  .replace(/^TRUSTED_PROXY_IPS=172\.30\.50\.2$/m, "TRUSTED_PROXY_IPS=172.30.50.7");
const temporary = path.join(path.dirname(envFile), `.env.publish.proxy-address.${process.pid}`);
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
  const directoryFd = fs.openSync(path.dirname(envFile), "r");
  try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
} catch {
  if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch {} }
  try { fs.unlinkSync(temporary); } catch {}
  fail("atomic environment update failed");
}
const finalStat = fs.lstatSync(envFile);
if (
  !finalStat.isFile() || finalStat.isSymbolicLink() || finalStat.uid !== 0 ||
  finalStat.gid !== 0 || (finalStat.mode & 0o777) !== 0o600 ||
  finalStat.nlink !== 1 || fs.readFileSync(envFile, "utf8") !== updated
) {
  fail("post-update verification failed");
}
process.stdout.write("PROXY ADDRESS CONFIGURATION UPDATED old=172.30.50.2 new=172.30.50.7 secrets=preserved\n");
