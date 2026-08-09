"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const {
  createSingleFlight,
  dedupeProcessEntries,
  discoverExecutablePaths,
  discoverRunningShadowTrackerProcesses,
  resolveProductionExecutableCandidates,
  runBoundedCommand,
} = require("./shadowTrackerProcessDiscovery.cjs");

const trustedCommandPaths = Object.freeze({
  powershell:
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  wmic: "C:\\Windows\\System32\\wbem\\WMIC.exe",
  where: "C:\\Windows\\System32\\where.exe",
});

function resolveTestCommand(name) {
  return {
    executablePath: trustedCommandPaths[name],
    env: {
      SystemDrive: "C:",
      SystemRoot: "C:\\Windows",
      WINDIR: "C:\\Windows",
    },
  };
}

function createNeverClosingChild(onKill) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.destroy = () => {};
  child.stderr.destroy = () => {};
  child.kill = () => {
    onKill();
    return true;
  };
  return child;
}

test("bounded command deadline keeps the event loop responsive and attempts child cleanup", async () => {
  let heartbeatRan = false;
  let killCount = 0;
  setImmediate(() => {
    heartbeatRan = true;
  });
  const startedAt = Date.now();

  const result = await runBoundedCommand("never-finishes", [], {
    timeoutMs: 20,
    spawnImpl: () => createNeverClosingChild(() => killCount += 1),
  });

  assert.equal(heartbeatRan, true);
  assert.equal(result.timedOut, true);
  assert.equal(result.killAttempted, true);
  assert.equal(killCount, 1);
  assert.ok(Date.now() - startedAt < 250);
});

test("PowerShell discovery succeeds without invoking WMIC", async () => {
  const commands = [];
  const entries = await discoverRunningShadowTrackerProcesses({
    platform: "win32",
    resolveCommand: resolveTestCommand,
    isExecutableFile: (value) => value.startsWith("C:\\PCOB"),
    runCommand: async (command) => {
      commands.push(command);
      return {
        ok: true,
        stdout: JSON.stringify({
          ProcessId: 42,
          ExecutablePath: "C:\\PCOB\\ShadowTrackerExtra.exe",
        }),
      };
    },
  });

  assert.deepEqual(commands, [trustedCommandPaths.powershell]);
  assert.deepEqual(entries, [
    {
      pid: 42,
      executablePath: "C:\\PCOB\\ShadowTrackerExtra.exe",
    },
  ]);
});

test("empty PowerShell discovery falls back to bounded WMIC parsing", async () => {
  const commands = [];
  const entries = await discoverRunningShadowTrackerProcesses({
    platform: "win32",
    resolveCommand: resolveTestCommand,
    isExecutableFile: () => true,
    runCommand: async (command) => {
      commands.push(command);
      if (command === trustedCommandPaths.powershell) {
        return { ok: true, stdout: "[]" };
      }
      return {
        ok: true,
        stdout: [
          "Node,ExecutablePath,ProcessId",
          "DESKTOP,C:\\PCOB\\ShadowTrackerExtra.exe,91",
        ].join("\r\n"),
      };
    },
  });

  assert.deepEqual(commands, [
    trustedCommandPaths.powershell,
    trustedCommandPaths.wmic,
  ]);
  assert.deepEqual(entries, [
    {
      pid: 91,
      executablePath: "C:\\PCOB\\ShadowTrackerExtra.exe",
    },
  ]);
});

test("failed or timed-out process discovery returns an empty result", async () => {
  const entries = await discoverRunningShadowTrackerProcesses({
    platform: "win32",
    resolveCommand: resolveTestCommand,
    runCommand: async () => ({ ok: false, timedOut: true, stdout: "" }),
  });
  assert.deepEqual(entries, []);
});

test("process discovery rejects malformed paths and deduplicates Windows paths", () => {
  const entries = dedupeProcessEntries(
    [
      { ProcessId: 1, ExecutablePath: "C:\\PCOB\\ShadowTrackerExtra.exe" },
      { ProcessId: 2, ExecutablePath: "c:/pcob/shadowtrackerextra.exe" },
      { ProcessId: 3, ExecutablePath: "C:\\Missing\\ShadowTrackerExtra.exe" },
      { ProcessId: 4, ExecutablePath: "" },
    ],
    {
      isExecutableFile: (value) => !value.includes("Missing"),
    },
  );

  assert.deepEqual(entries, [
    {
      pid: 1,
      executablePath: "C:\\PCOB\\ShadowTrackerExtra.exe",
    },
  ]);
});

test("PATH discovery is bounded and returns only successful where.exe output", async () => {
  const successful = await discoverExecutablePaths("ShadowTrackerExtra.exe", {
    platform: "win32",
    resolveCommand: resolveTestCommand,
    runCommand: async () => ({
      ok: true,
      stdout: "C:\\One\\ShadowTrackerExtra.exe\r\nC:\\Two\\ShadowTrackerExtra.exe\r\n",
    }),
  });
  const timedOut = await discoverExecutablePaths("ShadowTrackerExtra.exe", {
    platform: "win32",
    resolveCommand: resolveTestCommand,
    runCommand: async () => ({ ok: false, timedOut: true, stdout: "" }),
  });

  assert.deepEqual(successful, [
    "C:\\One\\ShadowTrackerExtra.exe",
    "C:\\Two\\ShadowTrackerExtra.exe",
  ]);
  assert.deepEqual(timedOut, []);
});

test("Windows discovery passes only the resolver's minimal env to absolute commands", async () => {
  const launches = [];
  await discoverRunningShadowTrackerProcesses({
    platform: "win32",
    env: { PATH: "C:\\attacker", NODE_OPTIONS: "--require attacker.js" },
    resolveCommand: resolveTestCommand,
    runCommand: async (command, args, options) => {
      launches.push({ command, args, options });
      return { ok: true, stdout: "[]" };
    },
  });
  assert.equal(launches.length, 2);
  for (const launch of launches) {
    assert.match(launch.command, /^C:\\Windows\\System32\\/i);
    assert.deepEqual(launch.options.spawnOptions.env, resolveTestCommand("where").env);
    assert.equal(launch.options.spawnOptions.env.PATH, undefined);
    assert.equal(launch.options.spawnOptions.env.NODE_OPTIONS, undefined);
  }
});

test("Windows discovery fails closed when a trusted command cannot be resolved", async () => {
  let commandCalls = 0;
  const entries = await discoverRunningShadowTrackerProcesses({
    platform: "win32",
    resolveCommand() {
      throw new Error("untrusted command path");
    },
    runCommand: async () => {
      commandCalls += 1;
      return { ok: true, stdout: "[]" };
    },
  });
  assert.deepEqual(entries, []);
  assert.equal(commandCalls, 0);
});

test("production candidate resolution preserves preference and keeps PATH fallback lazy", async () => {
  const existing = new Set(["running", "configured", "static", "path"]);
  let pathCalls = 0;
  const common = {
    runningCandidates: ["running"],
    configuredCandidates: ["configured"],
    staticCandidates: ["static"],
    isExecutableFile: (value) => existing.has(value),
    discoverPathCandidates: async () => {
      pathCalls += 1;
      return ["path"];
    },
  };

  assert.equal(
    await resolveProductionExecutableCandidates(common),
    "running",
  );
  assert.equal(
    await resolveProductionExecutableCandidates({
      ...common,
      preferRunning: false,
    }),
    "configured",
  );
  assert.equal(pathCalls, 0);

  existing.clear();
  existing.add("path");
  assert.equal(
    await resolveProductionExecutableCandidates(common),
    "path",
  );
  assert.equal(pathCalls, 1);
});

test("single-flight coordinator shares one in-progress discovery", async () => {
  const singleFlight = createSingleFlight();
  let release;
  let calls = 0;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const task = async () => {
    calls += 1;
    await held;
    return ["ready"];
  };

  const first = singleFlight.run(task);
  const second = singleFlight.run(task);
  assert.equal(first, second);
  assert.equal(singleFlight.isRunning(), true);
  release();
  assert.deepEqual(await first, ["ready"]);
  assert.deepEqual(await second, ["ready"]);
  assert.equal(calls, 1);
  assert.equal(singleFlight.isRunning(), false);
});
