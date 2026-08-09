"use strict";

const { spawn } = require("node:child_process");
const {
  resolveTrustedWindowsCommand,
} = require("./connector-runtime-security.cjs");

const PCOB_HELPER_READY_TIMEOUT_MS = 3_000;
const PCOB_INPUT_TIMEOUT_MS = 1_500;

let helperProcess = null;
let helperReadyPromise = null;
let helperReadyResolve = null;
let helperReadyReject = null;
let helperStdoutBuffer = "";
let helperStderr = "";
let helperRequestSequence = 0;
const helperPendingRequests = new Map();

function normalizeOptionalText(value, maxLength = 256) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeShortcutNumber(value, { label, min, max }) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < min || numeric > max) {
    throw new Error(
      `The selected player has no valid ${label} (${min}-${max}).`,
    );
  }
  return numeric;
}

function formatPcobTeamSlot(value) {
  const teamSlot = normalizeShortcutNumber(value, {
    label: "team slot",
    min: 1,
    max: 99,
  });
  return String(teamSlot).padStart(2, "0");
}

function normalizePcobMapSelection(payload) {
  const playerId = normalizeOptionalText(payload?.playerId);
  const playerName = normalizeOptionalText(payload?.playerName);
  if (!playerId && !playerName) {
    throw new Error("The selected player has no usable identity.");
  }

  const teamSlot = normalizeShortcutNumber(payload?.teamSlot, {
    label: "team slot",
    min: 1,
    max: 99,
  });
  const playerNumber = normalizeShortcutNumber(payload?.playerNumber, {
    label: "player number",
    min: 1,
    max: 9,
  });

  return {
    mapKey: normalizeOptionalText(payload?.mapKey, 80),
    playerId,
    playerName,
    teamId: normalizeOptionalText(payload?.teamId, 128),
    teamSlot,
    playerNumber,
  };
}

function assertPcobMapSelectionMatchesActiveMap({
  selectionMapKey,
  activeMapKey,
} = {}) {
  const normalizedSelectionMapKey = normalizeOptionalText(
    selectionMapKey,
    80,
  )?.toLowerCase();
  const normalizedActiveMapKey = normalizeOptionalText(
    activeMapKey,
    80,
  )?.toLowerCase();

  if (
    normalizedSelectionMapKey &&
    normalizedActiveMapKey &&
    normalizedSelectionMapKey !== normalizedActiveMapKey
  ) {
    const error = new Error(
      `The selected player belongs to ${normalizedSelectionMapKey}, but the live map is ${normalizedActiveMapKey}. No input was sent.`,
    );
    error.code = "ARENZYRA_MAP_CONTROL_STALE_MAP";
    throw error;
  }

  return true;
}

function normalizeIdentity(value) {
  return String(value ?? "").trim().toLowerCase();
}

function collectObserverIdentities(
  value,
  result = { ids: new Set(), names: new Set() },
) {
  if (!value || typeof value !== "object") {
    return result;
  }

  const idKeys = new Set([
    "0",
    "playerid",
    "playerkey",
    "playeropenid",
    "openid",
    "uid",
    "userid",
    "roleid",
    "characterid",
  ]);
  const nameKeys = new Set([
    "playername",
    "charactername",
    "rolename",
    "nickname",
    "name",
  ]);

  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = normalizeIdentity(key).replace(/[^a-z0-9]/g, "");
    if (
      (typeof nestedValue === "string" || typeof nestedValue === "number") &&
      idKeys.has(normalizedKey)
    ) {
      const identity = normalizeIdentity(nestedValue);
      if (identity) {
        result.ids.add(identity);
      }
    } else if (
      (typeof nestedValue === "string" || typeof nestedValue === "number") &&
      nameKeys.has(normalizedKey)
    ) {
      const identity = normalizeIdentity(nestedValue);
      if (identity) {
        result.names.add(identity);
      }
    }

    if (nestedValue && typeof nestedValue === "object") {
      collectObserverIdentities(nestedValue, result);
    }
  }

  return result;
}

function observerMatchesSelection(observerPayload, selectionPayload) {
  const selection = normalizePcobMapSelection(selectionPayload);
  const observer =
    observerPayload &&
    typeof observerPayload === "object" &&
    observerPayload.observingPlayer &&
    typeof observerPayload.observingPlayer === "object"
      ? observerPayload.observingPlayer
      : observerPayload;
  const identities = collectObserverIdentities(observer);
  const playerId = normalizeIdentity(selection.playerId);
  const playerName = normalizeIdentity(selection.playerName);

  return Boolean(
    (playerId &&
      (identities.ids.has(playerId) || identities.names.has(playerId))) ||
      (playerName &&
        (identities.names.has(playerName) || identities.ids.has(playerName))),
  );
}

function buildPcobHotkeyCommand({ id, pid, teamSlot, playerNumber }) {
  const safePid = Math.trunc(Number(pid));
  if (!Number.isFinite(safePid) || safePid <= 0) {
    throw new Error("A valid PCOB process id is required.");
  }

  const teamCode = formatPcobTeamSlot(teamSlot);
  const safePlayerNumber = normalizeShortcutNumber(playerNumber, {
    label: "player number",
    min: 1,
    max: 9,
  });

  return {
    id: normalizeOptionalText(id, 80) || `pcob-${Date.now()}`,
    pid: safePid,
    teamSlot: Number(teamSlot),
    teamCode,
    playerNumber: safePlayerNumber,
  };
}

function buildPcobHotkeyHelperScript() {
  return `
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$InformationPreference = "SilentlyContinue"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ArenzyraPcobNative {
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint sourceThreadId, uint targetThreadId, bool attach);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetKeyboardType(int typeFlag);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@

function Write-HelperResponse($value) {
  [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress -Depth 5))
  [Console]::Out.Flush()
}

function Focus-PcobWindow([IntPtr]$handle) {
  if ($handle -eq [IntPtr]::Zero) {
    throw "PCOB has no controllable main window."
  }
  if ([ArenzyraPcobNative]::IsIconic($handle)) {
    throw "PCOB is minimized. Restore it once before using map switching."
  }

  $foreground = [ArenzyraPcobNative]::GetForegroundWindow()
  $foregroundProcessId = [uint32]0
  $targetProcessId = [uint32]0
  $foregroundThread = [ArenzyraPcobNative]::GetWindowThreadProcessId(
    $foreground,
    [ref]$foregroundProcessId
  )
  $targetThread = [ArenzyraPcobNative]::GetWindowThreadProcessId(
    $handle,
    [ref]$targetProcessId
  )
  $currentThread = [ArenzyraPcobNative]::GetCurrentThreadId()
  $attachedForeground = $false
  $attachedTarget = $false

  try {
    if ($foregroundThread -ne 0 -and $foregroundThread -ne $currentThread) {
      $attachedForeground = [ArenzyraPcobNative]::AttachThreadInput(
        $currentThread,
        $foregroundThread,
        $true
      )
    }
    if ($targetThread -ne 0 -and $targetThread -ne $currentThread) {
      $attachedTarget = [ArenzyraPcobNative]::AttachThreadInput(
        $currentThread,
        $targetThread,
        $true
      )
    }
    [ArenzyraPcobNative]::BringWindowToTop($handle) | Out-Null
    [ArenzyraPcobNative]::SetForegroundWindow($handle) | Out-Null
  } finally {
    if ($attachedTarget) {
      [ArenzyraPcobNative]::AttachThreadInput(
        $currentThread,
        $targetThread,
        $false
      ) | Out-Null
    }
    if ($attachedForeground) {
      [ArenzyraPcobNative]::AttachThreadInput(
        $currentThread,
        $foregroundThread,
        $false
      ) | Out-Null
    }
  }

  for ($attempt = 0; $attempt -lt 5; $attempt += 1) {
    if ([ArenzyraPcobNative]::GetForegroundWindow() -eq $handle) {
      return
    }
    [ArenzyraPcobNative]::SetForegroundWindow($handle) | Out-Null
    Start-Sleep -Milliseconds 8
  }
  throw "Windows did not allow PCOB to become the foreground window."
}

function Send-PcobKey([IntPtr]$handle, [byte]$key) {
  if ([ArenzyraPcobNative]::GetForegroundWindow() -ne $handle) {
    throw "PCOB lost foreground focus before input could be completed."
  }
  [ArenzyraPcobNative]::keybd_event($key, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 10
  [ArenzyraPcobNative]::keybd_event($key, 0, 2, [UIntPtr]::Zero)
}

function Resolve-PcobDigitKey([int]$digit, [bool]$useNumpad) {
  if ($digit -lt 0 -or $digit -gt 9) {
    throw "PCOB shortcut digits must be between 0 and 9."
  }
  if ($useNumpad) {
    return [byte](0x60 + $digit)
  }
  return [byte](0x30 + $digit)
}

$keyboardType = [ArenzyraPcobNative]::GetKeyboardType(0)
$hasNumpad = $keyboardType -in @([uint32]2, [uint32]3, [uint32]4)
Write-HelperResponse @{
  type = "ready"
  hasNumpad = $hasNumpad
  keyboardType = $keyboardType
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  if ([string]::IsNullOrWhiteSpace($line)) {
    continue
  }

  $command = $null
  try {
    $command = $line | ConvertFrom-Json -ErrorAction Stop
    $requestId = [string]$command.id
    $processId = [int]$command.pid
    $teamCode = [string]$command.teamCode
    $playerNumber = [int]$command.playerNumber
    if ($teamCode -notmatch '^[0-9]{2}$') {
      throw "PCOB team code must contain exactly two digits."
    }
    if ($playerNumber -lt 1 -or $playerNumber -gt 9) {
      throw "PCOB player number must be between 1 and 9."
    }

    $process = Get-Process -Id $processId -ErrorAction Stop
    $process.Refresh()
    $handle = $process.MainWindowHandle
    Focus-PcobWindow $handle

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $firstTeamDigit = [int]$teamCode.Substring(0, 1)
    $secondTeamDigit = [int]$teamCode.Substring(1, 1)

    # Team switching: T plus an always-two-digit slot (01-99).
    Send-PcobKey $handle 0x54
    Start-Sleep -Milliseconds 12
    Send-PcobKey $handle (Resolve-PcobDigitKey $firstTeamDigit $hasNumpad)
    Start-Sleep -Milliseconds 12
    Send-PcobKey $handle (Resolve-PcobDigitKey $secondTeamDigit $hasNumpad)
    Start-Sleep -Milliseconds 28

    # Player switching: Y plus the one-digit player number.
    Send-PcobKey $handle 0x59
    Start-Sleep -Milliseconds 12
    Send-PcobKey $handle (Resolve-PcobDigitKey $playerNumber $hasNumpad)
    $stopwatch.Stop()

    Write-HelperResponse @{
      type = "result"
      id = $requestId
      ok = $true
      teamSlot = [int]$command.teamSlot
      teamCode = $teamCode
      playerNumber = $playerNumber
      digitMode = $(if ($hasNumpad) { "numpad" } else { "top-row" })
      inputElapsedMs = [math]::Round($stopwatch.Elapsed.TotalMilliseconds, 1)
    }
  } catch {
    Write-HelperResponse @{
      type = "result"
      id = $(if ($null -ne $command) { [string]$command.id } else { "" })
      ok = $false
      error = $_.Exception.Message
    }
  }
}
`.trim();
}

function normalizePowerShellDiagnostic(value) {
  const text = String(value || "").trim();
  if (!text || /^#<\s*CLIXML/i.test(text)) {
    return "";
  }
  return text.replace(/\s+/g, " ").trim().slice(-1_000);
}

function rejectPendingHelperRequests(error) {
  for (const pending of helperPendingRequests.values()) {
    clearTimeout(pending.timeout);
    pending.reject(error);
  }
  helperPendingRequests.clear();
}

function resetHelperProcess(child) {
  if (helperProcess !== child) {
    return;
  }
  helperProcess = null;
  helperReadyPromise = null;
  helperReadyResolve = null;
  helperReadyReject = null;
  helperStdoutBuffer = "";
  helperStderr = "";
}

function handleHelperMessage(message) {
  if (!message || typeof message !== "object") {
    return;
  }
  if (message.type === "ready") {
    helperReadyResolve?.({
      hasNumpad: message.hasNumpad === true,
      keyboardType: Number(message.keyboardType) || 0,
    });
    helperReadyResolve = null;
    helperReadyReject = null;
    return;
  }
  if (message.type !== "result") {
    return;
  }

  const id = String(message.id || "");
  const pending = helperPendingRequests.get(id);
  if (!pending) {
    return;
  }
  helperPendingRequests.delete(id);
  clearTimeout(pending.timeout);
  if (message.ok === true) {
    pending.resolve(message);
  } else {
    pending.reject(
      new Error(
        normalizeOptionalText(message.error, 500) ||
          "PCOB keyboard input failed.",
      ),
    );
  }
}

function createPcobHotkeyHelperLaunch(options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== "win32") {
    throw new Error("PCOB keyboard control is only available on Windows.");
  }
  const resolveCommand =
    typeof options.resolveCommand === "function"
      ? options.resolveCommand
      : resolveTrustedWindowsCommand;
  const powerShell = resolveCommand("powershell", {
    platform,
    execPath: options.execPath || process.execPath,
    env: options.env || process.env,
    inspectPath: options.inspectPath,
  });
  const encodedCommand = Buffer.from(
    buildPcobHotkeyHelperScript(),
    "utf16le",
  ).toString("base64");
  return {
    command: powerShell.executablePath,
    args: [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-InputFormat",
      "Text",
      "-OutputFormat",
      "Text",
      "-EncodedCommand",
      encodedCommand,
    ],
    options: {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: powerShell.env,
    },
  };
}

function startPcobHotkeyHelper() {
  if (process.platform !== "win32") {
    return Promise.reject(
      new Error("PCOB keyboard control is only available on Windows."),
    );
  }
  if (
    helperProcess &&
    helperProcess.exitCode === null &&
    helperProcess.killed !== true &&
    helperReadyPromise
  ) {
    return helperReadyPromise;
  }

  let launch;
  try {
    launch = createPcobHotkeyHelperLaunch();
  } catch (error) {
    return Promise.reject(error);
  }
  const child = spawn(launch.command, launch.args, launch.options);

  helperProcess = child;
  helperStdoutBuffer = "";
  helperStderr = "";
  helperReadyPromise = new Promise((resolve, reject) => {
    helperReadyResolve = resolve;
    helperReadyReject = reject;
  });

  const readyTimeout = setTimeout(() => {
    const error = new Error("PCOB input helper did not become ready in time.");
    helperReadyReject?.(error);
    helperReadyResolve = null;
    helperReadyReject = null;
    child.kill();
  }, PCOB_HELPER_READY_TIMEOUT_MS);
  helperReadyPromise = helperReadyPromise.finally(() => {
    clearTimeout(readyTimeout);
  });

  child.stdout.on("data", (chunk) => {
    helperStdoutBuffer += String(chunk || "");
    const lines = helperStdoutBuffer.split(/\r?\n/);
    helperStdoutBuffer = lines.pop() || "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      try {
        handleHelperMessage(JSON.parse(line));
      } catch {
        // Ignore non-JSON PowerShell host diagnostics.
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    helperStderr = `${helperStderr}${chunk}`.slice(-16_384);
  });
  child.on("error", (error) => {
    helperReadyReject?.(error);
    helperReadyResolve = null;
    helperReadyReject = null;
    rejectPendingHelperRequests(error);
    resetHelperProcess(child);
  });
  child.on("close", (code) => {
    const detail = normalizePowerShellDiagnostic(helperStderr);
    const error = new Error(
      detail || `PCOB input helper exited with code ${code}.`,
    );
    helperReadyReject?.(error);
    helperReadyResolve = null;
    helperReadyReject = null;
    rejectPendingHelperRequests(error);
    resetHelperProcess(child);
  });

  return helperReadyPromise;
}

function preparePcobHotkeyInput() {
  return startPcobHotkeyHelper();
}

async function runPcobHotkeyInput(options) {
  await preparePcobHotkeyInput();
  const child = helperProcess;
  if (
    !child ||
    child.exitCode !== null ||
    child.killed === true ||
    !child.stdin.writable
  ) {
    throw new Error("PCOB input helper is unavailable.");
  }

  helperRequestSequence += 1;
  const id = `pcob-${process.pid}-${Date.now()}-${helperRequestSequence}`;
  const command = buildPcobHotkeyCommand({ ...options, id });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      helperPendingRequests.delete(id);
      reject(new Error("PCOB map control timed out before completing input."));
    }, PCOB_INPUT_TIMEOUT_MS);
    helperPendingRequests.set(id, { resolve, reject, timeout });

    child.stdin.write(`${JSON.stringify(command)}\n`, (error) => {
      if (!error) {
        return;
      }
      const pending = helperPendingRequests.get(id);
      if (!pending) {
        return;
      }
      helperPendingRequests.delete(id);
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function stopPcobHotkeyInput() {
  const child = helperProcess;
  if (!child) {
    return;
  }
  rejectPendingHelperRequests(new Error("PCOB input helper stopped."));
  resetHelperProcess(child);
  try {
    child.stdin.end();
  } catch {
    // Ignore an already-closed helper stdin.
  }
  if (child.exitCode === null && child.killed !== true) {
    child.kill();
  }
}

module.exports = {
  assertPcobMapSelectionMatchesActiveMap,
  buildPcobHotkeyCommand,
  buildPcobHotkeyHelperScript,
  createPcobHotkeyHelperLaunch,
  collectObserverIdentities,
  formatPcobTeamSlot,
  normalizePcobMapSelection,
  observerMatchesSelection,
  preparePcobHotkeyInput,
  runPcobHotkeyInput,
  stopPcobHotkeyInput,
};
