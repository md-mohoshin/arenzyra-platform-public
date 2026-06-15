#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const args = new Set(process.argv.slice(2));
if (args.has('-h') || args.has('--help')) {
  console.log(`Usage: node scripts/production-maintenance.cjs [--check-only] [--dry-run]

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
  if (arg !== '--check-only' && arg !== '--dry-run') {
    console.error(`Unknown option: ${arg}`);
    process.exit(2);
  }
}

const checkOnly = args.has('--check-only');
const dryRun = args.has('--dry-run');
const logTag = process.env.ARENZYRA_MAINTENANCE_LOG_TAG || 'arenzyra-maintenance';
const diskPath = process.env.ARENZYRA_DISK_PATH || (process.platform === 'win32' ? process.cwd().slice(0, 3) : '/');
const warnPercent = Number(process.env.ARENZYRA_DISK_WARN_PERCENT || 85);
const criticalPercent = Number(process.env.ARENZYRA_DISK_CRITICAL_PERCENT || 90);
const backupDir = process.env.ARENZYRA_BACKUP_DIR || '/opt/arenzyra-backups';
const backupRetentionDays = Number(process.env.ARENZYRA_BACKUP_RETENTION_DAYS || 30);
const dockerBuilderKeepStorage = process.env.ARENZYRA_DOCKER_BUILDER_KEEP_STORAGE || '15GB';
const alertWebhookUrl = process.env.ARENZYRA_DISK_ALERT_WEBHOOK_URL || process.env.DISK_ALERT_WEBHOOK_URL || '';

function log(message) {
  console.log(`${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')} [${logTag}] ${message}`);
}

function commandExists(command) {
  const probe = process.platform === 'win32' ? 'where.exe' : 'command';
  const probeArgs = process.platform === 'win32' ? [command] : ['-v', command];
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
  } catch {
    return 0;
  }
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
  if (!resolved.startsWith(expected)) {
    log(`refusing to prune unexpected backup directory: ${resolved}`);
    return;
  }

  const cutoff = Date.now() - backupRetentionDays * 24 * 60 * 60 * 1000;
  log(`pruning backups older than ${backupRetentionDays} days from ${resolved}`);
  for (const entry of fs.readdirSync(resolved)) {
    const entryPath = path.join(resolved, entry);
    const stat = fs.statSync(entryPath);
    if (stat.mtimeMs >= cutoff) continue;
    if (dryRun) {
      log(`dry-run: remove old backup ${entryPath}`);
      continue;
    }
    fs.rmSync(entryPath, { recursive: true, force: true });
    log(`removed old backup ${entryPath}`);
  }
}

async function checkDisk() {
  const percent = diskPercent();
  log(`disk usage for ${diskPath} is ${percent}%`);
  if (percent >= criticalPercent) {
    const message = `Arenzyra production disk CRITICAL: ${percent}% used on ${diskPath}`;
    log(message);
    await sendAlert(message);
    return 2;
  }
  if (percent >= warnPercent) {
    const message = `Arenzyra production disk warning: ${percent}% used on ${diskPath}`;
    log(message);
    await sendAlert(message);
  }
  return 0;
}

(async () => {
  log(`maintenance started; disk before=${diskPercent()}%`);
  if (!checkOnly) {
    pruneDockerBuilder();
    pruneOldBackups();
  }
  const diskStatus = await checkDisk();
  if (diskStatus === 0) {
    log('maintenance completed');
  } else {
    log(`maintenance completed with disk alert status=${diskStatus}`);
    process.exit(diskStatus);
  }
})();
