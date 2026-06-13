const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const electronModule = require("electron");

if (process.env.ELECTRON_RUN_AS_NODE === "1" && typeof electronModule === "string") {
  const child = spawn(electronModule, process.argv.slice(1), {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    stdio: "inherit",
    windowsHide: false,
  });
  child.on("exit", (code) => process.exit(code ?? 0));
  return;
}

const { app, BrowserWindow, ipcMain } = electronModule;

const isWindows = process.platform === "win32";
const defaultRepoRoot = "C:\\arenzyra";
const npmCmd = isWindows ? "npm.cmd" : "npm";
const shellCommand = process.env.ComSpec || "cmd.exe";
const allowLegacyShadowApi = process.env.ALLOW_LEGACY_SHADOW_API === "1";

const projectRoot =
  process.env.ARENZYRA_ROOT && fs.existsSync(process.env.ARENZYRA_ROOT)
    ? process.env.ARENZYRA_ROOT
    : fs.existsSync(defaultRepoRoot)
      ? defaultRepoRoot
      : path.resolve(__dirname, "..", "..");

const logLines = [];
const maxLogLines = 400;
const verboseServiceLogs = process.env.ARENZYRA_VERBOSE_SERVICE_LOGS === "1";
const shadowApiNoisePaths = new Set([
  "/getallinfo",
  "/getteaminfo",
  "/gettotalplayerlist",
  "/getteaminfolist",
  "/getkillinfo",
  "/getcircleinfo",
  "/getteambackpackinfo",
  "/getobservingplayer",
]);
const serviceStates = new Map();
const childProcesses = new Map();
const stoppingServices = new Set();
const APP_USER_MODEL_ID = "com.arenzyra.launcher";

let healthRunning = false;
let systemBusy = false;
let lastHealth = {
  ok: null,
  finishedAt: null,
  summary: "Health check has not run yet.",
};

function joinAppPath(...segments) {
  return path.join(projectRoot, "apps", ...segments);
}

function resolveExistingPath(baseDir, candidates) {
  for (const candidate of candidates) {
    const fullPath = path.join(baseDir, candidate);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }
  return null;
}

function resolvePythonCommand(baseDir, candidates) {
  const localPath = resolveExistingPath(baseDir, candidates);
  if (localPath) {
    return localPath;
  }
  return isWindows ? "py" : "python3";
}

function resolveWindowIconPath() {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, "icon.ico")]
    : [path.join(__dirname, "build", "icon.ico")];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function serviceMonitor(service) {
  return service.monitor || "port";
}

function isPortService(service) {
  return serviceMonitor(service) === "port";
}

function isProcessService(service) {
  return serviceMonitor(service) === "process";
}

function serviceTargetLabel(service) {
  if (isProcessService(service)) {
    return "Worker";
  }

  return `Port ${service.port}`;
}

function runningDetail(service, pid) {
  if (isProcessService(service)) {
    return pid ? `Process is running (PID ${pid}).` : "Process is running.";
  }

  return `Listening on port ${service.port}.`;
}

function stoppedDetail(service) {
  if (isProcessService(service)) {
    return "Process is not running.";
  }

  return `Port ${service.port} is not in use.`;
}

function processStartDetail(service, pid) {
  if (isProcessService(service)) {
    return pid ? `Process started (PID ${pid}). Waiting for startup...` : "Process started. Waiting for startup...";
  }

  return `Process started. Waiting for port ${service.port}...`;
}

function processTimeoutDetail(service) {
  if (isProcessService(service)) {
    return `${service.name} did not stay running long enough to confirm startup.`;
  }

  return `Process did not open port ${service.port} in time.`;
}

function createServiceDefinitions() {
  const shadowDir = joinAppPath("shadow_api");
  const matchStateDir = joinAppPath("match-state-service");
  const mediaAiDir = joinAppPath("media-ai-service");
  const services = [
    {
      id: "api",
      name: "API",
      kind: "required",
      cwd: joinAppPath("api"),
      port: 3000,
      startTimeoutMs: 30000,
      command: () => ({
        command: npmCmd,
        args: ["run", "start:prod"],
        preview: "npm run start:prod",
      }),
    },
    {
      id: "overlay-server",
      name: "Overlay Server",
      kind: "optional",
      cwd: joinAppPath("overlay-server"),
      port: 3100,
      startTimeoutMs: 10000,
      command: () => ({
        command: npmCmd,
        args: ["run", "start"],
        preview: "npm run start",
      }),
    },
    {
      id: "media-ai-service",
      name: "Media AI Service",
      kind: "optional",
      cwd: mediaAiDir,
      port: 5055,
      startTimeoutMs: 20000,
      command: () => ({
        command: resolvePythonCommand(mediaAiDir, [
          ".venv\\Scripts\\python.exe",
          ".venv/bin/python",
        ]),
        args: ["-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5055"],
        preview: "python -m uvicorn main:app --host 0.0.0.0 --port 5055",
      }),
    },
    {
      id: "arenzyra-web",
      name: "Arenzyra Web",
      kind: "required",
      cwd: joinAppPath("arenzyra-web"),
      port: 3001,
      startTimeoutMs: 25000,
      command: () => ({
        command: npmCmd,
        args: ["run", "start", "--", "--port", "3001"],
        preview: "npm run start -- --port 3001",
      }),
    },
    {
      id: "discord-bot",
      name: "Discord Bot",
      kind: "optional",
      monitor: "process",
      cwd: joinAppPath("discord-bot"),
      startTimeoutMs: 5000,
      command: () => ({
        command: npmCmd,
        args: ["run", "start"],
        preview: "npm run start",
      }),
    },
  ];

  if (allowLegacyShadowApi && fs.existsSync(shadowDir)) {
    services.splice(1, 0, {
      id: "shadow-api",
      name: "Legacy Shadow API",
      kind: "optional",
      cwd: shadowDir,
      port: 5000,
      startTimeoutMs: 15000,
      command: () => ({
        command: resolvePythonCommand(shadowDir, [
          "venv\\Scripts\\python.exe",
          "Scripts\\python.exe",
          "venv/bin/python",
        ]),
        args: ["shadow_receiver.py"],
        preview: "python shadow_receiver.py",
      }),
    });

    if (fs.existsSync(matchStateDir)) {
      services.splice(2, 0, {
        id: "match-state-service",
        name: "Legacy Match State Service",
        kind: "optional",
        cwd: matchStateDir,
        port: 4000,
        startTimeoutMs: 20000,
        command: () => ({
          command: npmCmd,
          args: ["run", "start"],
          preview: "npm run start",
        }),
      });
    }
  }

  return services;
}

const serviceDefinitions = createServiceDefinitions();

for (const service of serviceDefinitions) {
  serviceStates.set(service.id, {
    status: "unknown",
    detail: "Waiting for initial scan.",
    pid: null,
  });
}

function getServiceById(serviceId) {
  return serviceDefinitions.find((service) => service.id === serviceId) ?? null;
}

function extractHttpLogPath(message) {
  const match = String(message || "").match(/"(?:GET|HEAD|OPTIONS)\s+(\S+)\s+HTTP\/\d(?:\.\d)?"/i);
  return match ? match[1].split("?", 1)[0] : "";
}

function shouldSuppressLog(scope, message) {
  if (verboseServiceLogs) {
    return false;
  }

  if (scope !== "Legacy Shadow API") {
    return false;
  }

  const normalized = String(message || "").trim();
  if (!normalized) {
    return true;
  }

  if (!/"(?:GET|HEAD|OPTIONS)\s+\S+\s+HTTP\/\d(?:\.\d)?\"\s+20\d\b/i.test(normalized)) {
    return false;
  }

  return shadowApiNoisePaths.has(extractHttpLogPath(normalized));
}

function pushLog(scope, message) {
  if (shouldSuppressLog(scope, message)) {
    return;
  }

  const timestamp = new Date().toLocaleTimeString();
  const line = `[${timestamp}] [${scope}] ${message}`;
  logLines.push(line);
  if (logLines.length > maxLogLines) {
    logLines.splice(0, logLines.length - maxLogLines);
  }
  broadcastState();
}

function splitLines(chunk) {
  return chunk
    .toString()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function bindChildLogs(child, label) {
  if (child.stdout) {
    child.stdout.on("data", (chunk) => {
      for (const line of splitLines(chunk)) {
        pushLog(label, line);
      }
    });
  }

  if (child.stderr) {
    child.stderr.on("data", (chunk) => {
      for (const line of splitLines(chunk)) {
        pushLog(label, line);
      }
    });
  }
}

function setServiceState(serviceId, patch) {
  const current = serviceStates.get(serviceId) ?? {};
  serviceStates.set(serviceId, { ...current, ...patch });
  broadcastState();
}

function snapshotState() {
  return {
    projectRoot,
    healthRunning,
    systemBusy,
    lastHealth,
    services: serviceDefinitions.map((service) => {
      const current = serviceStates.get(service.id) ?? {};
      const commandInfo = service.command();
      return {
        id: service.id,
        name: service.name,
        kind: service.kind,
        cwd: service.cwd,
        port: service.port ?? null,
        monitor: serviceMonitor(service),
        targetLabel: serviceTargetLabel(service),
        commandPreview: commandInfo.preview,
        ...current,
      };
    }),
    logs: [...logLines],
  };
}

function broadcastState() {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("launcher:state", snapshotState());
    }
  }
}

function shouldUseShell(command) {
  if (!isWindows) {
    return false;
  }
  return /\.cmd$/i.test(command) || /\.bat$/i.test(command);
}

function spawnCommand(command, args, cwd, label) {
  const useShell = shouldUseShell(command);
  const child = spawn(useShell ? shellCommand : command, useShell ? ["/c", command, ...args] : args, {
    cwd,
    env: process.env,
    stdio: "pipe",
    windowsHide: true,
  });

  bindChildLogs(child, label);
  return child;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isManagedProcessRunning(serviceId) {
  const child = childProcesses.get(serviceId);
  if (!child) {
    return false;
  }

  return Boolean(child.pid) && child.exitCode === null && !child.killed;
}

function isPortBusy(port, host = "127.0.0.1", timeoutMs = 500) {
  return new Promise((resolve) => {
    const net = require("net");
    const socket = new net.Socket();

    const finish = (busy) => {
      socket.destroy();
      resolve(busy);
    };

    socket.setTimeout(timeoutMs);
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
    socket.connect(port, host, () => finish(true));
  });
}

async function waitForPort(port, shouldBeBusy, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const busy = await isPortBusy(port);
    if (busy === shouldBeBusy) {
      return true;
    }
    await delay(500);
  }

  return false;
}

async function waitForManagedProcess(serviceId, shouldBeRunning, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const running = isManagedProcessRunning(serviceId);
    if (running === shouldBeRunning) {
      return true;
    }
    await delay(250);
  }

  return false;
}

function killPid(pid) {
  return new Promise((resolve) => {
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.on("close", () => resolve());
    killer.on("error", () => resolve());
  });
}

function killPort(port) {
  return new Promise((resolve) => {
    const cmd = `for /f "tokens=5" %P in ('netstat -ano ^| findstr :${port}') do taskkill /PID %P /T /F`;
    const killer = spawn(shellCommand, ["/c", cmd], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.on("close", () => resolve());
    killer.on("error", () => resolve());
  });
}

async function refreshServiceStates() {
  for (const service of serviceDefinitions) {
    const current = serviceStates.get(service.id) ?? {};
    if (current.status === "starting" || current.status === "stopping") {
      continue;
    }

    if (isProcessService(service)) {
      if (isManagedProcessRunning(service.id)) {
        setServiceState(service.id, {
          status: "running",
          detail: runningDetail(service, childProcesses.get(service.id)?.pid ?? current.pid ?? null),
          pid: childProcesses.get(service.id)?.pid ?? current.pid ?? null,
        });
      } else {
        setServiceState(service.id, {
          status: "stopped",
          detail: stoppedDetail(service),
          pid: null,
        });
      }
      continue;
    }

    const busy = await isPortBusy(service.port);
    if (busy) {
      setServiceState(service.id, {
        status: "running",
        detail: runningDetail(service, childProcesses.get(service.id)?.pid ?? current.pid ?? null),
        pid: childProcesses.get(service.id)?.pid ?? current.pid ?? null,
      });
    } else if (!childProcesses.has(service.id)) {
      setServiceState(service.id, {
        status: "stopped",
        detail: stoppedDetail(service),
        pid: null,
      });
    }
  }
}

function getPackagedHealthScript() {
  if (!app.isPackaged) {
    return null;
  }
  const resourcePath = path.join(process.resourcesPath, "health.ps1");
  return fs.existsSync(resourcePath) ? resourcePath : null;
}

function getHealthScriptPath() {
  const repoScript = path.join(projectRoot, "infra", "health.ps1");
  if (fs.existsSync(repoScript)) {
    return repoScript;
  }
  return getPackagedHealthScript();
}

function prepareHealthScript() {
  const healthScriptPath = getHealthScriptPath();
  if (!healthScriptPath) {
    pushLog("HEALTH", "Health script was not found.");
    return null;
  }

  const tempScriptPath = path.join(app.getPath("userData"), "arenzyra-health-run.ps1");

  try {
    const rawScript = fs.readFileSync(healthScriptPath, "utf8");
    const cleanedScript = rawScript.replace(/(^|\r?\n)Set-Location[^\r\n]*(\r?\n)?/, "$1");
    const rewritten = [
      `Set-Location -Path "${projectRoot.replace(/\\/g, "\\\\")}"`,
      cleanedScript.trimStart(),
    ].join("\n");
    fs.writeFileSync(tempScriptPath, `\uFEFF${rewritten}`, "utf16le");
    return tempScriptPath;
  } catch (error) {
    pushLog("HEALTH", `Failed to prepare health script: ${error.message}`);
    return null;
  }
}

async function runHealthCheck() {
  if (healthRunning) {
    return lastHealth.ok === true;
  }

  const tempScriptPath = prepareHealthScript();
  if (!tempScriptPath) {
    lastHealth = {
      ok: false,
      finishedAt: new Date().toISOString(),
      summary: "Health script is missing.",
    };
    broadcastState();
    return false;
  }

  healthRunning = true;
  lastHealth = {
    ok: null,
    finishedAt: null,
    summary: "Running full health check...",
  };
  pushLog("HEALTH", "Running full health check.");
  broadcastState();

  const ok = await new Promise((resolve) => {
    const child = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tempScriptPath], {
      cwd: projectRoot,
      windowsHide: true,
      stdio: "pipe",
    });

    bindChildLogs(child, "HEALTH");

    child.on("error", (error) => {
      pushLog("HEALTH", `Health process failed to start: ${error.message}`);
      resolve(false);
    });

    child.on("close", (code) => {
      resolve(code === 0);
    });
  });

  fs.rm(tempScriptPath, { force: true }, () => {});

  lastHealth = {
    ok,
    finishedAt: new Date().toISOString(),
    summary: ok ? "Health check passed." : "Health check failed.",
  };
  healthRunning = false;
  pushLog("HEALTH", lastHealth.summary);
  broadcastState();
  return ok;
}

async function startService(service) {
  if (isProcessService(service)) {
    if (isManagedProcessRunning(service.id)) {
      setServiceState(service.id, {
        status: "running",
        detail: runningDetail(service, childProcesses.get(service.id)?.pid ?? null),
        pid: childProcesses.get(service.id)?.pid ?? null,
      });
      return true;
    }
  } else {
    const running = await isPortBusy(service.port);
    if (running) {
      setServiceState(service.id, {
        status: "running",
        detail: `Already listening on port ${service.port}.`,
        pid: childProcesses.get(service.id)?.pid ?? null,
      });
      return true;
    }
  }

  const commandInfo = service.command();
  pushLog(service.name, `Starting with "${commandInfo.preview}".`);
  setServiceState(service.id, {
    status: "starting",
    detail: `Starting ${service.name}...`,
    pid: null,
  });

  try {
    const child = spawnCommand(commandInfo.command, commandInfo.args, service.cwd, service.name);
    childProcesses.set(service.id, child);

    child.on("spawn", () => {
      setServiceState(service.id, {
        status: "starting",
        detail: processStartDetail(service, child.pid ?? null),
        pid: child.pid ?? null,
      });
    });

    child.on("exit", async (code, signal) => {
      childProcesses.delete(service.id);
      const expectedStop = stoppingServices.has(service.id);
      if (expectedStop) {
        return;
      }

      if (isPortService(service)) {
        const stillBusy = await isPortBusy(service.port);
        if (stillBusy) {
          setServiceState(service.id, {
            status: "running",
            detail: runningDetail(service, null),
            pid: null,
          });
          return;
        }
      }

      setServiceState(service.id, {
        status: code === 0 ? "stopped" : "error",
        detail:
          code === 0
            ? `${service.name} exited normally.`
            : `${service.name} exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.`,
        pid: null,
      });
      pushLog(service.name, `Process exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.`);
    });

    child.on("error", (error) => {
      childProcesses.delete(service.id);
      setServiceState(service.id, {
        status: "error",
        detail: `Failed to start: ${error.message}`,
        pid: null,
      });
      pushLog(service.name, `Failed to start: ${error.message}`);
    });

    const ready = isProcessService(service)
      ? await waitForManagedProcess(service.id, true, service.startTimeoutMs)
      : await waitForPort(service.port, true, service.startTimeoutMs);
    if (!ready) {
      setServiceState(service.id, {
        status: "error",
        detail: processTimeoutDetail(service),
        pid: child.pid ?? null,
      });
      pushLog(
        service.name,
        isProcessService(service)
          ? "Timed out waiting for the worker process to remain running."
          : `Timed out waiting for port ${service.port}.`,
      );
      return false;
    }

    setServiceState(service.id, {
      status: "running",
      detail: runningDetail(service, child.pid ?? null),
      pid: child.pid ?? null,
    });
    return true;
  } catch (error) {
    setServiceState(service.id, {
      status: "error",
      detail: `Failed to spawn process: ${error.message}`,
      pid: null,
    });
    pushLog(service.name, `Failed to spawn process: ${error.message}`);
    return false;
  }
}

async function stopService(service) {
  stoppingServices.add(service.id);
  setServiceState(service.id, {
    status: "stopping",
    detail: `Stopping ${service.name}...`,
  });

  const child = childProcesses.get(service.id);
  if (child?.pid) {
    await killPid(child.pid);
  }

  if (isPortService(service)) {
    await killPort(service.port);
    childProcesses.delete(service.id);
  }

  const stopped = isProcessService(service)
    ? await waitForManagedProcess(service.id, false, 10000)
    : await waitForPort(service.port, false, 10000);
  stoppingServices.delete(service.id);

  if (isProcessService(service)) {
    childProcesses.delete(service.id);
  }

  setServiceState(service.id, {
    status: stopped ? "stopped" : "error",
    detail: stopped
      ? `${service.name} stopped.`
      : isProcessService(service)
        ? `${service.name} is still running after stop.`
        : `Port ${service.port} is still busy after stop.`,
    pid: null,
  });

  return stopped;
}

async function startAllServices() {
  if (systemBusy) {
    return;
  }

  systemBusy = true;
  broadcastState();

  try {
    const healthOk = await runHealthCheck();
    if (!healthOk) {
      pushLog("SYSTEM", "Start aborted because the health check failed.");
      return;
    }

    for (const service of serviceDefinitions) {
      const started = await startService(service);
      if (!started && service.kind === "required") {
        pushLog("SYSTEM", `Start aborted because required service "${service.name}" failed.`);
        break;
      }
      await delay(500);
    }
  } finally {
    systemBusy = false;
    await refreshServiceStates();
    broadcastState();
  }
}

async function stopAllServices() {
  if (systemBusy) {
    return;
  }

  systemBusy = true;
  broadcastState();

  try {
    for (const service of [...serviceDefinitions].reverse()) {
      await stopService(service);
    }
    pushLog("SYSTEM", "All managed services were stopped.");
  } finally {
    systemBusy = false;
    await refreshServiceStates();
    broadcastState();
  }
}

async function restartAllServices() {
  if (systemBusy) {
    return;
  }

  systemBusy = true;
  broadcastState();

  try {
    for (const service of [...serviceDefinitions].reverse()) {
      await stopService(service);
    }
    const healthOk = await runHealthCheck();
    if (!healthOk) {
      pushLog("SYSTEM", "Restart aborted because the health check failed.");
      return;
    }
    for (const service of serviceDefinitions) {
      const started = await startService(service);
      if (!started && service.kind === "required") {
        pushLog("SYSTEM", `Restart aborted because required service "${service.name}" failed.`);
        break;
      }
      await delay(500);
    }
  } finally {
    systemBusy = false;
    await refreshServiceStates();
    broadcastState();
  }
}

function createWindow() {
  const iconPath = resolveWindowIconPath();
  const window = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 1024,
    minHeight: 760,
    backgroundColor: "#101314",
    title: "Arenzyra System Launcher",
    icon: iconPath || undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.removeMenu();
  window.loadFile("index.html");
}

if (isWindows) {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

ipcMain.handle("launcher:get-state", async () => {
  await refreshServiceStates();
  return snapshotState();
});

ipcMain.handle("launcher:run-health-check", async () => {
  const ok = await runHealthCheck();
  return { ok };
});

ipcMain.handle("launcher:start-all", async () => {
  await startAllServices();
  return snapshotState();
});

ipcMain.handle("launcher:stop-all", async () => {
  await stopAllServices();
  return snapshotState();
});

ipcMain.handle("launcher:restart-all", async () => {
  await restartAllServices();
  return snapshotState();
});

ipcMain.handle("launcher:service-action", async (_event, payload) => {
  const service = getServiceById(payload?.id);
  if (!service) {
    throw new Error(`Unknown service "${payload?.id ?? "unknown"}".`);
  }

  if (systemBusy) {
    return snapshotState();
  }

  switch (payload?.action) {
    case "start":
      await startService(service);
      break;
    case "stop":
      await stopService(service);
      break;
    case "restart":
      await stopService(service);
      await startService(service);
      break;
    default:
      throw new Error(`Unsupported action "${payload?.action ?? "unknown"}".`);
  }

  await refreshServiceStates();
  return snapshotState();
});

app.whenReady().then(async () => {
  createWindow();
  await refreshServiceStates();
  if (!allowLegacyShadowApi) {
    pushLog(
      "SYSTEM",
      "Legacy Shadow API is disabled. Canonical live automatic ingest is launcher ob.js -> API.",
    );
  } else if (!fs.existsSync(joinAppPath("shadow_api"))) {
    pushLog(
      "SYSTEM",
      "ALLOW_LEGACY_SHADOW_API=1 is set, but apps/shadow_api was not found.",
    );
  }
  if (allowLegacyShadowApi && !fs.existsSync(joinAppPath("match-state-service"))) {
    pushLog(
      "SYSTEM",
      "ALLOW_LEGACY_SHADOW_API=1 is set, but apps/match-state-service was not found.",
    );
  }
  broadcastState();

  if (isWindows) {
    app.setLoginItemSettings({ openAtLogin: true });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  void stopAllServices().finally(() => app.quit());
});

app.on("before-quit", () => {
  void stopAllServices();
});

process.on("SIGINT", () => {
  void stopAllServices().finally(() => process.exit(0));
});
