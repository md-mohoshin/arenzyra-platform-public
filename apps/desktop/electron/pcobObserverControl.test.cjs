"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  assertPcobMapSelectionMatchesActiveMap,
  buildPcobHotkeyCommand,
  buildPcobHotkeyHelperScript,
  createPcobHotkeyHelperLaunch,
  formatPcobTeamSlot,
  normalizePcobMapSelection,
  observerMatchesSelection,
} = require("./pcobObserverControl.cjs");

test("PCOB helper launch uses a verified absolute PowerShell and minimal env", () => {
  const calls = [];
  const launch = createPcobHotkeyHelperLaunch({
    platform: "win32",
    execPath: "C:\\Program Files\\Arenzyra\\Arenzyra.exe",
    env: { PATH: "C:\\attacker", NODE_OPTIONS: "--require attacker.js" },
    resolveCommand(name, options) {
      calls.push({ name, options });
      return {
        executablePath:
          "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        env: {
          SystemDrive: "C:",
          SystemRoot: "C:\\Windows",
          WINDIR: "C:\\Windows",
        },
      };
    },
  });
  assert.equal(calls[0].name, "powershell");
  assert.equal(
    launch.command,
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  );
  assert.equal(launch.args.includes("-NoProfile"), true);
  assert.equal(launch.args.includes("-NonInteractive"), true);
  assert.equal(launch.args.includes("Bypass"), false);
  assert.deepEqual(launch.options.env, {
    SystemDrive: "C:",
    SystemRoot: "C:\\Windows",
    WINDIR: "C:\\Windows",
  });
  assert.equal(launch.options.env.PATH, undefined);
  assert.equal(launch.options.env.NODE_OPTIONS, undefined);
});

test("PCOB map selections reject stale targets from a previous map", () => {
  assert.equal(
    assertPcobMapSelectionMatchesActiveMap({
      selectionMapKey: "RONDO",
      activeMapKey: "rondo",
    }),
    true,
  );
  assert.throws(
    () =>
      assertPcobMapSelectionMatchesActiveMap({
        selectionMapKey: "erangel",
        activeMapKey: "rondo",
      }),
    (error) => error?.code === "ARENZYRA_MAP_CONTROL_STALE_MAP",
  );
});

test("PCOB map selections require a team slot, player number, and identity", () => {
  assert.deepEqual(
    normalizePcobMapSelection({
      mapKey: "Erangel",
      playerId: "player-1",
      playerName: "Observer Target",
      teamId: "team-2",
      teamSlot: 2,
      playerNumber: 3,
    }),
    {
      mapKey: "Erangel",
      playerId: "player-1",
      playerName: "Observer Target",
      teamId: "team-2",
      teamSlot: 2,
      playerNumber: 3,
    },
  );

  assert.throws(
    () =>
      normalizePcobMapSelection({
        playerId: "player-1",
        playerNumber: 1,
      }),
    /team slot/i,
  );
  assert.throws(
    () =>
      normalizePcobMapSelection({
        playerId: "player-1",
        teamSlot: 2,
      }),
    /player number/i,
  );
  assert.throws(
    () =>
      normalizePcobMapSelection({
        playerId: "player-1",
        teamSlot: 2,
        playerNumber: 10,
      }),
    /player number/i,
  );
  assert.throws(
    () =>
      normalizePcobMapSelection({
        teamSlot: 2,
        playerNumber: 1,
      }),
    /no usable identity/i,
  );
});

test("PCOB team hotkeys always use two-digit slot numbers", () => {
  assert.equal(formatPcobTeamSlot(1), "01");
  assert.equal(formatPcobTeamSlot(2), "02");
  assert.equal(formatPcobTeamSlot(9), "09");
  assert.equal(formatPcobTeamSlot(10), "10");
  assert.equal(formatPcobTeamSlot(25), "25");
  assert.throws(() => formatPcobTeamSlot(0), /team slot/i);
  assert.throws(() => formatPcobTeamSlot(100), /team slot/i);
});

test("PCOB observer acknowledgement matches nested ids and player names", () => {
  const selection = {
    playerId: "UID-123",
    playerName: "CasterTarget",
    teamSlot: 2,
    playerNumber: 3,
  };

  assert.equal(
    observerMatchesSelection(
      {
        observingPlayer: {
          "0": "5370936203",
          GunADS: "false",
        },
      },
      {
        ...selection,
        playerId: "5370936203",
        playerName: "WW7xLUZY",
      },
    ),
    true,
  );
  assert.equal(
    observerMatchesSelection(
      {
        observingPlayer: {
          playerInfo: {
            uId: "uid-123",
            playerName: "OtherName",
          },
        },
      },
      selection,
    ),
    true,
  );
  assert.equal(
    observerMatchesSelection(
      {
        observingPlayer: {
          character: {
            name: "castertarget",
          },
        },
      },
      selection,
    ),
    true,
  );
  assert.equal(
    observerMatchesSelection(
      {
        observingPlayer: {
          uId: "different-player",
          playerName: "SomeoneElse",
        },
      },
      selection,
    ),
    false,
  );
});

test("PCOB input commands preserve padded teams and player numbers", () => {
  assert.deepEqual(
    buildPcobHotkeyCommand({
      id: "request-1",
      pid: 4321,
      teamSlot: 7,
      playerNumber: 3,
    }),
    {
      id: "request-1",
      pid: 4321,
      teamSlot: 7,
      teamCode: "07",
      playerNumber: 3,
    },
  );
});

test("PCOB helper prefers numpad, falls back to top-row, and preserves window state", () => {
  const script = buildPcobHotkeyHelperScript({
    pid: 4321,
    teamSlot: 7,
    playerNumber: 3,
  });

  assert.match(script, /GetKeyboardType\(0\)/);
  assert.match(script, /0x60 \+ \$digit/);
  assert.match(script, /0x30 \+ \$digit/);
  assert.match(script, /Send-PcobKey \$handle 0x54/);
  assert.match(script, /Send-PcobKey \$handle 0x59/);
  assert.match(script, /BringWindowToTop/);
  assert.match(script, /IsIconic/);
  assert.doesNotMatch(script, /ShowWindowAsync|ShowWindow\(/);
  assert.doesNotMatch(script, /mouse_event|SetCursorPos|GetCursorPos/);
  assert.match(script, /GetForegroundWindow\(\) -ne \$handle/);
});

test("PCOB switching cancels stale observer confirmation requests", () => {
  const mainSource = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const confirmationStart = mainSource.indexOf(
    "async function confirmPcobObserverSelection(",
  );
  const confirmationEnd = mainSource.indexOf(
    "\nasync function selectPcobObserverFromMap(",
    confirmationStart,
  );
  const confirmationSource = mainSource.slice(
    confirmationStart,
    confirmationEnd,
  );

  assert.ok(
    confirmationStart >= 0 && confirmationEnd > confirmationStart,
  );
  assert.match(confirmationSource, /cancelPcobObserverConfirmation\(\)/);
  assert.match(
    confirmationSource,
    /readPcobObservingPlayer\(\{\s*signal:\s*controller\.signal/,
  );
  assert.match(
    confirmationSource,
    /pcobMapControlLastSelection\?\.requestId\s*!==\s*requestId/,
  );
});
