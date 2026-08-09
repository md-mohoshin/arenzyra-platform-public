"use strict";

const { spawn } = require("node:child_process");
const {
  resolveTrustedWindowsCommand,
} = require("./connector-runtime-security.cjs");

const DEFAULT_COMMAND_TIMEOUT_MS = 3_000;
const DEFAULT_DISCOVERY_BUDGET_MS = 4_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function runBoundedCommand(command, args = [], options = {}) {
  const spawnImpl =
    typeof options.spawnImpl === "function" ? options.spawnImpl : spawn;
  const timeoutMs = normalizePositiveInteger(
    options.timeoutMs,
    DEFAULT_COMMAND_TIMEOUT_MS,
  );
  const maxOutputBytes = normalizePositiveInteger(
    options.maxOutputBytes,
    DEFAULT_MAX_OUTPUT_BYTES,
  );

  return new Promise((resolve) => {
    let child = null;
    let timer = null;
    let settled = false;
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;

    const settle = (patch = {}) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      resolve({
        ok: false,
        status: null,
        signal: null,
        stdout,
        stderr,
        timedOut: false,
        outputLimitExceeded: false,
        killAttempted: false,
        error: null,
        ...patch,
      });
    };

    const stopChild = () => {
      let killAttempted = false;
      try {
        killAttempted = true;
        child?.kill?.();
      } catch {
        // The hard deadline still settles even if Windows refuses the kill.
      }
      try {
        child?.stdout?.destroy?.();
      } catch {
        // Best-effort pipe cleanup only.
      }
      try {
        child?.stderr?.destroy?.();
      } catch {
        // Best-effort pipe cleanup only.
      }
      return killAttempted;
    };

    const collect = (target, chunk) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      const bytes = Buffer.byteLength(text, "utf8");
      if (target === "stdout") {
        stdoutBytes += bytes;
        if (stdoutBytes > maxOutputBytes) {
          const killAttempted = stopChild();
          settle({
            outputLimitExceeded: true,
            killAttempted,
            error: "Command stdout exceeded the configured limit.",
          });
          return;
        }
        stdout += text;
        return;
      }

      stderrBytes += bytes;
      if (stderrBytes > maxOutputBytes) {
        const killAttempted = stopChild();
        settle({
          outputLimitExceeded: true,
          killAttempted,
          error: "Command stderr exceeded the configured limit.",
        });
        return;
      }
      stderr += text;
    };

    try {
      child = spawnImpl(command, Array.isArray(args) ? args : [], {
        windowsHide: true,
        ...options.spawnOptions,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      settle({
        error: error instanceof Error ? error.message : String(error || "Spawn failed."),
      });
      return;
    }

    child?.stdout?.on?.("data", (chunk) => collect("stdout", chunk));
    child?.stderr?.on?.("data", (chunk) => collect("stderr", chunk));
    child?.once?.("error", (error) => {
      settle({
        error: error instanceof Error ? error.message : String(error || "Command failed."),
      });
    });
    child?.once?.("close", (status, signal) => {
      settle({
        ok: status === 0,
        status: Number.isInteger(status) ? status : null,
        signal: signal || null,
      });
    });

    timer = setTimeout(() => {
      const killAttempted = stopChild();
      settle({
        timedOut: true,
        killAttempted,
        error: `Command exceeded ${timeoutMs}ms.`,
      });
    }, timeoutMs);
  });
}

function parseJsonValue(value) {
  try {
    return JSON.parse(String(value || "").trim());
  } catch {
    return null;
  }
}

function normalizeProcessEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const executablePath = String(
    value.executablePath ?? value.ExecutablePath ?? "",
  ).trim();
  if (!executablePath) {
    return null;
  }
  const rawPid = Number(value.pid ?? value.processId ?? value.ProcessId);
  return {
    pid: Number.isFinite(rawPid) && rawPid > 0 ? Math.trunc(rawPid) : null,
    executablePath,
  };
}

function dedupeProcessEntries(values, options = {}) {
  const isExecutableFile =
    typeof options.isExecutableFile === "function"
      ? options.isExecutableFile
      : () => true;
  const seen = new Set();
  const entries = [];
  for (const value of Array.isArray(values) ? values : []) {
    const entry = normalizeProcessEntry(value);
    if (!entry || !isExecutableFile(entry.executablePath)) {
      continue;
    }
    const key = entry.executablePath.replaceAll("/", "\\").toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    entries.push(entry);
  }
  return entries;
}

function parsePowerShellProcessOutput(value) {
  const parsed = parseJsonValue(value);
  if (!parsed) {
    return [];
  }
  return (Array.isArray(parsed) ? parsed : [parsed])
    .map(normalizeProcessEntry)
    .filter(Boolean);
}

function parseWmicProcessOutput(value) {
  const entries = [];
  for (const rawLine of String(value || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^node,/i.test(line)) {
      continue;
    }
    const parts = line.split(",");
    if (parts.length < 3) {
      continue;
    }
    const entry = normalizeProcessEntry({
      ExecutablePath: parts.slice(1, -1).join(",").trim(),
      ProcessId: parts[parts.length - 1],
    });
    if (entry) {
      entries.push(entry);
    }
  }
  return entries;
}

async function discoverRunningShadowTrackerProcesses(options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== "win32") {
    return [];
  }

  const runCommand =
    typeof options.runCommand === "function"
      ? options.runCommand
      : runBoundedCommand;
  const processName = String(
    options.processName || "ShadowTrackerExtra.exe",
  ).trim();
  const budgetMs = normalizePositiveInteger(
    options.budgetMs,
    DEFAULT_DISCOVERY_BUDGET_MS,
  );
  const commandTimeoutMs = normalizePositiveInteger(
    options.commandTimeoutMs,
    DEFAULT_COMMAND_TIMEOUT_MS,
  );
  const startedAt = Date.now();
  const remainingBudget = () => Math.max(0, budgetMs - (Date.now() - startedAt));
  const resolveCommand =
    typeof options.resolveCommand === "function"
      ? options.resolveCommand
      : resolveTrustedWindowsCommand;
  const resolveLaunch = (name) =>
    resolveCommand(name, {
      platform,
      execPath: options.execPath || process.execPath,
      env: options.env || process.env,
      inspectPath: options.inspectPath,
    });
  const runWithinBudget = async (launch, args) => {
    const remainingMs = remainingBudget();
    if (remainingMs <= 0) {
      return { ok: false, timedOut: true, stdout: "", stderr: "" };
    }
    try {
      return await runCommand(launch.executablePath, args, {
        timeoutMs: Math.max(1, Math.min(commandTimeoutMs, remainingMs)),
        maxOutputBytes: options.maxOutputBytes,
        spawnImpl: options.spawnImpl,
        spawnOptions: { env: launch.env },
      });
    } catch (error) {
      return {
        ok: false,
        timedOut: false,
        stdout: "",
        stderr: "",
        error: error instanceof Error ? error.message : String(error || "Command failed."),
      };
    }
  };

  const powerShellScript = [
    `$items = Get-CimInstance Win32_Process -Filter "Name='${processName.replaceAll("'", "''")}'" |`,
    "Select-Object ProcessId,ExecutablePath,CommandLine;",
    "if ($null -eq $items) { '[]' } else { $items | ConvertTo-Json -Compress }",
  ].join(" ");
  let powerShell;
  try {
    powerShell = resolveLaunch("powershell");
  } catch {
    return [];
  }
  const powerShellResult = await runWithinBudget(powerShell, [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    powerShellScript,
  ]);
  const powerShellEntries = powerShellResult?.ok
    ? parsePowerShellProcessOutput(powerShellResult.stdout)
    : [];
  if (powerShellEntries.length > 0) {
    return dedupeProcessEntries(powerShellEntries, options);
  }

  if (remainingBudget() <= 0) {
    return [];
  }
  let wmic;
  try {
    wmic = resolveLaunch("wmic");
  } catch {
    return [];
  }
  const wmicResult = await runWithinBudget(wmic, [
    "process",
    "where",
    `name='${processName}'`,
    "get",
    "ExecutablePath,ProcessId",
    "/format:csv",
  ]);
  const wmicEntries = wmicResult?.ok
    ? parseWmicProcessOutput(wmicResult.stdout)
    : [];
  return dedupeProcessEntries(wmicEntries, options);
}

async function discoverExecutablePaths(binaryName, options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== "win32") {
    return [];
  }
  const normalizedName = String(binaryName || "").trim();
  if (!normalizedName) {
    return [];
  }
  const runCommand =
    typeof options.runCommand === "function"
      ? options.runCommand
      : runBoundedCommand;
  let result;
  try {
    const resolveCommand =
      typeof options.resolveCommand === "function"
        ? options.resolveCommand
        : resolveTrustedWindowsCommand;
    const where = resolveCommand("where", {
      platform,
      execPath: options.execPath || process.execPath,
      env: options.env || process.env,
      inspectPath: options.inspectPath,
    });
    result = await runCommand(where.executablePath, [normalizedName], {
      timeoutMs: normalizePositiveInteger(
        options.timeoutMs,
        DEFAULT_COMMAND_TIMEOUT_MS,
      ),
      maxOutputBytes: options.maxOutputBytes,
      spawnImpl: options.spawnImpl,
      spawnOptions: { env: where.env },
    });
  } catch {
    return [];
  }
  if (!result?.ok) {
    return [];
  }
  return Array.from(
    new Set(
      String(result.stdout || "")
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

function findExistingExecutable(candidates, isExecutableFile) {
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const normalized = String(candidate || "").trim();
    if (normalized && isExecutableFile(normalized)) {
      return normalized;
    }
  }
  return "";
}

async function resolveProductionExecutableCandidates(options = {}) {
  const isExecutableFile =
    typeof options.isExecutableFile === "function"
      ? options.isExecutableFile
      : () => false;
  const runningCandidates = Array.isArray(options.runningCandidates)
    ? options.runningCandidates
    : [];
  const configuredCandidates = Array.isArray(options.configuredCandidates)
    ? options.configuredCandidates
    : [];
  const staticCandidates = Array.isArray(options.staticCandidates)
    ? options.staticCandidates
    : [];
  const primaryCandidates =
    options.preferRunning === false
      ? [...configuredCandidates, ...runningCandidates, ...staticCandidates]
      : [...runningCandidates, ...configuredCandidates, ...staticCandidates];
  const primaryMatch = findExistingExecutable(
    primaryCandidates,
    isExecutableFile,
  );
  if (primaryMatch) {
    return primaryMatch;
  }

  if (typeof options.discoverPathCandidates !== "function") {
    return "";
  }
  let discoveredCandidates = [];
  try {
    discoveredCandidates = await options.discoverPathCandidates();
  } catch {
    return "";
  }
  return findExistingExecutable(discoveredCandidates, isExecutableFile);
}

function createSingleFlight() {
  let inFlight = null;
  return {
    run(task) {
      if (inFlight) {
        return inFlight;
      }
      inFlight = Promise.resolve()
        .then(() => task())
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
    isRunning() {
      return inFlight !== null;
    },
  };
}

module.exports = {
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_DISCOVERY_BUDGET_MS,
  createSingleFlight,
  dedupeProcessEntries,
  discoverExecutablePaths,
  discoverRunningShadowTrackerProcesses,
  parsePowerShellProcessOutput,
  parseWmicProcessOutput,
  resolveProductionExecutableCandidates,
  runBoundedCommand,
};
