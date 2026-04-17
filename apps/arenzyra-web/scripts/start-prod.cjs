async function main() {
  const [{ spawn }, fs, path, { createRequire }] = await Promise.all([
    import("node:child_process"),
    import("node:fs"),
    import("node:path"),
    import("node:module"),
  ]);

  const require = createRequire(__filename);
  const appDir = path.resolve(__dirname, "..");
  const nextBin = require.resolve("next/dist/bin/next", { paths: [appDir] });
  const buildIdPath = path.join(appDir, ".next-build", "BUILD_ID");
  const restartPollMs = 4000;
  const requiredStablePolls = 2;
  const forceKillDelayMs = 5000;

  let currentBuildId = readBuildId();
  let child = null;
  let shuttingDown = false;
  let restartRequested = false;
  let pendingBuildId = null;
  let pendingBuildCount = 0;
  let forceKillTimer = null;

  if (!currentBuildId) {
    console.error("[arenzyra-web] Missing .next-build/BUILD_ID. Run `npm run build` before `npm run start`.");
    process.exit(1);
  }

  function readBuildId() {
    try {
      const value = fs.readFileSync(buildIdPath, "utf8").trim();
      return value || null;
    } catch {
      return null;
    }
  }

  function log(message) {
    console.log(`[arenzyra-web] ${message}`);
  }

  function clearForceKillTimer() {
    if (!forceKillTimer) {
      return;
    }
    clearTimeout(forceKillTimer);
    forceKillTimer = null;
  }

  function forceStopChild(pid) {
    if (!pid) {
      return;
    }

    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.on("error", () => {});
      return;
    }

    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }

  function stopChild() {
    if (!child) {
      return;
    }

    clearForceKillTimer();
    child.kill("SIGTERM");
    forceKillTimer = setTimeout(() => {
      if (child) {
        forceStopChild(child.pid);
      }
    }, forceKillDelayMs);
  }

  function spawnServer() {
    child = spawn(process.execPath, [nextBin, "start", ...process.argv.slice(2)], {
      cwd: appDir,
      env: process.env,
      stdio: "inherit",
      windowsHide: false,
    });

    child.on("exit", (code, signal) => {
      clearForceKillTimer();
      child = null;

      if (restartRequested && !shuttingDown) {
        restartRequested = false;
        log(`Restarting Next server on build ${currentBuildId}.`);
        spawnServer();
        return;
      }

      if (shuttingDown) {
        process.exit(code ?? 0);
        return;
      }

      process.exit(code ?? (signal ? 1 : 0));
    });

    child.on("error", (error) => {
      clearForceKillTimer();
      console.error(`[arenzyra-web] Failed to start Next server: ${error.message}`);
      process.exit(1);
    });
  }

  function scheduleRestart(nextBuildId) {
    if (restartRequested || shuttingDown) {
      return;
    }

    restartRequested = true;
    currentBuildId = nextBuildId;
    pendingBuildId = null;
    pendingBuildCount = 0;
    log(`Detected updated build ${nextBuildId}. Restarting Next server to keep assets in sync.`);
    stopChild();
  }

  function pollBuildId() {
    if (shuttingDown || restartRequested) {
      return;
    }

    const nextBuildId = readBuildId();
    if (!nextBuildId || nextBuildId === currentBuildId) {
      pendingBuildId = null;
      pendingBuildCount = 0;
      return;
    }

    if (pendingBuildId !== nextBuildId) {
      pendingBuildId = nextBuildId;
      pendingBuildCount = 1;
      return;
    }

    pendingBuildCount += 1;
    if (pendingBuildCount < requiredStablePolls) {
      return;
    }

    scheduleRestart(nextBuildId);
  }

  function shutdown() {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    restartRequested = false;
    clearForceKillTimer();

    if (!child) {
      process.exit(0);
      return;
    }

    stopChild();
  }

  spawnServer();

  const pollTimer = setInterval(pollBuildId, restartPollMs);
  if (typeof pollTimer.unref === "function") {
    pollTimer.unref();
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
