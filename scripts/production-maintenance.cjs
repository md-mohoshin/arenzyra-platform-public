#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const args = new Set(process.argv.slice(2));
if (args.has('-h') || args.has('--help')) {
  console.log(`Usage: node scripts/production-maintenance.cjs [--check-only|--builder-cache|--unused-images] [--dry-run]

Environment:
  ARENZYRA_DISK_PATH=/                         Disk mount to monitor.
  ARENZYRA_DISK_WARN_PERCENT=85                Warning threshold.
  ARENZYRA_DISK_CRITICAL_PERCENT=90            Critical threshold.
  ARENZYRA_DOCKER_BUILDER_KEEP_STORAGE=15GB    Build cache target.
  ARENZYRA_BACKUP_DIR=/opt/arenzyra-backups    Backup root to prune.
  ARENZYRA_BACKUP_RETENTION_DAYS=30            Backup retention.
  ARENZYRA_DISK_ALERT_WEBHOOK_URL=...          Optional Discord/webhook URL.`);
  process.exit(0);
}

for (const arg of args) {
  if (
    arg !== '--check-only' &&
    arg !== '--builder-cache' &&
    arg !== '--unused-images' &&
    arg !== '--dry-run'
  ) {
    console.error(`Unknown option: ${arg}`);
    process.exit(2);
  }
}

const checkOnly = args.has('--check-only');
const builderCacheOnly = args.has('--builder-cache');
const unusedImagesOnly = args.has('--unused-images');
const dryRun = args.has('--dry-run');
if (
  (builderCacheOnly && (checkOnly || unusedImagesOnly || dryRun)) ||
  (unusedImagesOnly && (checkOnly || dryRun))
) {
  console.error('maintenance-only modes cannot be combined.');
  process.exit(2);
}
const logTag = process.env.ARENZYRA_MAINTENANCE_LOG_TAG || 'arenzyra-maintenance';
const diskPath = process.env.ARENZYRA_DISK_PATH || (process.platform === 'win32' ? process.cwd().slice(0, 3) : '/');
const warnPercent = Number(process.env.ARENZYRA_DISK_WARN_PERCENT || 85);
const criticalPercent = Number(process.env.ARENZYRA_DISK_CRITICAL_PERCENT || 90);
const backupDir = process.env.ARENZYRA_BACKUP_DIR || '/opt/arenzyra-backups';
const backupRetentionDays = Number(process.env.ARENZYRA_BACKUP_RETENTION_DAYS || 30);
const dockerBuilderKeepStorage = process.env.ARENZYRA_DOCKER_BUILDER_KEEP_STORAGE || '15GB';
const allowGlobalBuilderPrune = process.env.ARENZYRA_MAINTENANCE_ALLOW_GLOBAL_BUILDER_PRUNE === '1';
const alertWebhookUrl = process.env.ARENZYRA_DISK_ALERT_WEBHOOK_URL || process.env.DISK_ALERT_WEBHOOK_URL || '';

function log(message) {
  console.log(`${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')} [${logTag}] ${message}`);
}

function commandExists(command) {
  const probe = process.platform === 'win32' ? 'where.exe' : 'sh';
  const probeArgs = process.platform === 'win32'
    ? [command]
    : ['-lc', 'command -v -- "$1" >/dev/null 2>&1', 'sh', command];
  return spawnSync(probe, probeArgs, { stdio: 'ignore' }).status === 0;
}

function runCommand(command, commandArgs) {
  if (dryRun) {
    log(`dry-run: ${command} ${commandArgs.join(' ')}`);
    return true;
  }
  const result = spawnSync(command, commandArgs, { stdio: 'inherit' });
  return result.status === 0;
}

function diskPercentWindows() {
  const driveName = /^[a-z]:/i.test(diskPath) ? diskPath[0].toUpperCase() : process.cwd()[0].toUpperCase();
  const output = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `$d=Get-PSDrive -Name ${driveName}; if ($d.Used + $d.Free -eq 0) { 0 } else { [math]::Round(($d.Used / ($d.Used + $d.Free)) * 100) }`,
    ],
    { encoding: 'utf8' },
  );
  return Number(output.trim()) || 0;
}

function diskPercentPosix() {
  const output = execFileSync('df', ['-P', diskPath], { encoding: 'utf8' });
  const line = output.trim().split(/\r?\n/)[1] || '';
  const fields = line.trim().split(/\s+/);
  return Number((fields[4] || '0').replace('%', '')) || 0;
}

function diskPercent() {
  try {
    return process.platform === 'win32' ? diskPercentWindows() : diskPercentPosix();
  } catch (error) {
    log(`disk inspection failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function validateMaintenanceConfiguration() {
  const errors = [];
  if (!Number.isFinite(warnPercent) || warnPercent < 1 || warnPercent > 100) {
    errors.push("ARENZYRA_DISK_WARN_PERCENT must be between 1 and 100");
  }
  if (
    !Number.isFinite(criticalPercent) ||
    criticalPercent < 1 ||
    criticalPercent > 100
  ) {
    errors.push("ARENZYRA_DISK_CRITICAL_PERCENT must be between 1 and 100");
  }
  if (Number.isFinite(warnPercent) && Number.isFinite(criticalPercent) && warnPercent > criticalPercent) {
    errors.push("disk warning threshold cannot exceed the critical threshold");
  }
  if (!Number.isInteger(backupRetentionDays) || backupRetentionDays < 1) {
    errors.push("ARENZYRA_BACKUP_RETENTION_DAYS must be a positive whole number");
  }
  if (!diskPath.trim()) {
    errors.push("ARENZYRA_DISK_PATH cannot be empty");
  }

  const explicitBackupDir = Boolean(process.env.ARENZYRA_BACKUP_DIR);
  if (!(process.platform === "win32" && !explicitBackupDir) && fs.existsSync(backupDir)) {
    try {
      if (!fs.statSync(backupDir).isDirectory()) {
        errors.push(`backup retention path is not a directory: ${backupDir}`);
      } else {
        const resolved = fs.realpathSync(backupDir);
        const expected = process.platform === "win32"
          ? path.resolve(backupDir)
          : "/opt/arenzyra-backups";
        const relative = path.relative(expected, resolved);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
          errors.push(`backup retention path escapes the approved root: ${resolved}`);
        }
      }
    } catch (error) {
      errors.push(
        `unable to validate backup retention path: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return errors;
}

async function sendAlert(message) {
  if (!alertWebhookUrl || typeof fetch !== 'function') return;
  try {
    await fetch(alertWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
    });
  } catch {
    log('alert webhook post failed');
  }
}

function pruneDockerBuilder() {
  if (!allowGlobalBuilderPrune && !builderCacheOnly) {
    log('global Docker build-cache prune disabled; set ARENZYRA_MAINTENANCE_ALLOW_GLOBAL_BUILDER_PRUNE=1 only after operator review');
    return;
  }
  if (!commandExists('docker')) {
    log('docker unavailable; skipped build-cache prune');
    return;
  }
  log(`pruning Docker build cache, reserving ${dockerBuilderKeepStorage}`);
  let pruneFlag = '--keep-storage';
  try {
    const help = execFileSync('docker', ['builder', 'prune', '--help'], { encoding: 'utf8' });
    if (help.includes('--max-used-space')) {
      pruneFlag = '--max-used-space';
    } else if (help.includes('--reserved-space')) {
      pruneFlag = '--reserved-space';
    }
  } catch {
    // Keep Docker's older flag as the fallback.
  }
  if (runCommand('docker', ['builder', 'prune', '-af', pruneFlag, dockerBuilderKeepStorage])) {
    log('Docker build-cache prune completed');
  } else {
    log('Docker build-cache prune failed');
  }
}

function pruneUnusedDockerImages() {
  if (!commandExists('docker')) {
    log('docker unavailable; skipped unused-image prune');
    return;
  }
  log('pruning only Docker images unreferenced by every running or stopped container');
  if (runCommand('docker', ['image', 'prune', '-af'])) {
    log('unused Docker image prune completed');
  } else {
    log('unused Docker image prune failed');
  }
}

function pruneOldBackups() {
  const explicitBackupDir = Boolean(process.env.ARENZYRA_BACKUP_DIR);
  if (process.platform === 'win32' && !explicitBackupDir) {
    log(`backup retention skipped on Windows without ARENZYRA_BACKUP_DIR override: ${backupDir}`);
    return;
  }
  if (!fs.existsSync(backupDir) || !fs.statSync(backupDir).isDirectory()) {
    log(`backup directory not found; skipped backup retention: ${backupDir}`);
    return;
  }

  const resolved = fs.realpathSync(backupDir);
  const expected = process.platform === 'win32'
    ? path.resolve(backupDir)
    : '/opt/arenzyra-backups';
  const relative = path.relative(expected, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    log(`refusing to prune unexpected backup directory: ${resolved}`);
    return;
  }

  const cutoff = Date.now() - backupRetentionDays * 24 * 60 * 60 * 1000;
  log(`pruning backups older than ${backupRetentionDays} days from ${resolved}`);
  const backupEntries = fs.readdirSync(resolved)
    .filter((entry) => /^\d{8}T\d{6}Z-[0-9a-f]{8}$/.test(entry))
    .map((entry) => {
      const entryPath = path.join(resolved, entry);
      const stat = fs.lstatSync(entryPath);
      return {
        entryPath,
        isDirectory: stat.isDirectory() && !stat.isSymbolicLink(),
        mtimeMs: stat.mtimeMs,
        verified: hasVerifiedRecoveryMarkers(entryPath),
      };
    })
    .filter((entry) => entry.isDirectory && entry.verified);
  for (const entry of selectBackupEntriesToPrune(backupEntries, cutoff)) {
    if (dryRun) {
      log(`dry-run: remove old backup ${entry.entryPath}`);
      continue;
    }
    fs.rmSync(entry.entryPath, { recursive: true, force: true });
    log(`removed old backup ${entry.entryPath}`);
  }
}

function hasVerifiedRecoveryMarkers(entryPath) {
  return ["OFFSITE_VERIFIED", "RESTORE_DRILL_VERIFIED"].every((name) => {
    try {
      const marker = fs.lstatSync(path.join(entryPath, name));
      return marker.isFile() && !marker.isSymbolicLink() && marker.size > 0;
    } catch {
      return false;
    }
  });
}

function selectBackupEntriesToPrune(entries, cutoff) {
  const verified = entries.filter((entry) => entry.verified);
  if (verified.length === 0) return [];
  const preserve = verified
    .slice()
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0];
  return verified.filter(
    (entry) => entry.entryPath !== preserve.entryPath && entry.mtimeMs < cutoff,
  );
}

async function checkDisk(percent = diskPercent(), alert = sendAlert) {
  if (percent === null) {
    const message = `Arenzyra production disk check FAILED for ${diskPath}`;
    log(message);
    await alert(message);
    return 3;
  }
  log(`disk usage for ${diskPath} is ${percent}%`);
  if (percent >= criticalPercent) {
    const message = `Arenzyra production disk CRITICAL: ${percent}% used on ${diskPath}`;
    log(message);
    await alert(message);
    return 2;
  }
  if (percent >= warnPercent) {
    const message = `Arenzyra production disk warning: ${percent}% used on ${diskPath}`;
    log(message);
    await alert(message);
  }
  return 0;
}

async function runMaintenance({
  inspectDisk = diskPercent,
  pruneBuilder = pruneDockerBuilder,
  pruneImages = pruneUnusedDockerImages,
  pruneBackups = pruneOldBackups,
  alert = sendAlert,
  builderCacheOnlyMode = builderCacheOnly,
  unusedImagesOnlyMode = unusedImagesOnly,
} = {}) {
  const configurationErrors = validateMaintenanceConfiguration();
  if (configurationErrors.length > 0) {
    for (const error of configurationErrors) log(`configuration invalid: ${error}`);
    return 2;
  }

  const before = inspectDisk();
  log(`maintenance started; disk before=${before === null ? 'unknown' : `${before}%`}`);
  const beforeStatus = await checkDisk(before, alert);
  if (beforeStatus === 3) {
    log('maintenance stopped before cleanup because disk inspection failed');
    return beforeStatus;
  }
  if (!checkOnly) {
    if (unusedImagesOnlyMode) {
      pruneImages();
    } else {
      pruneBuilder();
      if (!builderCacheOnlyMode) pruneBackups();
    }
  }
  const after = checkOnly ? before : inspectDisk();
  const diskStatus = await checkDisk(after, alert);
  if (diskStatus === 0) {
    log('maintenance completed');
  } else {
    log(`maintenance completed with disk alert status=${diskStatus}`);
  }
  return diskStatus;
}

if (require.main === module) {
  runMaintenance()
    .then((status) => {
      process.exitCode = status;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  checkDisk,
  diskPercent,
  hasVerifiedRecoveryMarkers,
  runMaintenance,
  selectBackupEntriesToPrune,
  validateMaintenanceConfiguration,
};
