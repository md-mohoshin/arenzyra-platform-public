"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const {
  DEFAULT_GSI_PORT,
  createCs2GsiToken,
  installCs2GsiConfig,
  readInstalledCs2GsiConfig,
} = require("./config.cjs");
const { startCs2GsiServer } = require("./server.cjs");

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || null : null;
}

function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const body = Buffer.from(JSON.stringify(payload));
    const request = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": body.length,
        },
      },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode));
      },
    );
    request.once("error", reject);
    request.end(body);
  });
}

function printSnapshotSummary(snapshot) {
  const ct = snapshot.match.ct.score ?? "-";
  const t = snapshot.match.t.score ?? "-";
  process.stdout.write(
    [
      "[cs2-gsi] snapshot accepted",
      `map=${snapshot.match.mapName || "unknown"}`,
      `score=${ct}:${t}`,
      `round=${snapshot.match.roundNumber ?? "unknown"}`,
      `players=${snapshot.players.length}`,
      `bomb=${snapshot.bomb.state || "unknown"}`,
    ].join(" ") + "\n",
  );
}

async function runMockProof() {
  const token = createCs2GsiToken();
  let snapshot = null;
  const listener = await startCs2GsiServer({
    token,
    onSnapshot(value) {
      snapshot = value;
    },
  });

  try {
    const fixturePath = path.join(
      __dirname,
      "fixtures",
      "synthetic-observer.json",
    );
    const payload = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    payload.auth = { token };
    const status = await postJson(listener.url, payload);
    if (status !== 204 || !snapshot) {
      throw new Error(`Mock proof failed with HTTP ${status}.`);
    }
    printSnapshotSummary(snapshot);
    process.stdout.write("[cs2-gsi] mock proof passed\n");
  } finally {
    await listener.close();
  }
}

async function runLiveProof() {
  const cs2InstallDir = readArgument("--cs2-install");
  if (!cs2InstallDir) {
    throw new Error(
      "Live proof requires --cs2-install with the absolute CS2 installation directory.",
    );
  }

  const requestedPortValue = readArgument("--port");
  const requestedPlayerData = process.argv.includes("--observer-roster");
  const existingConfig = readInstalledCs2GsiConfig({ cs2InstallDir });
  const existingPort = existingConfig
    ? Number(new URL(existingConfig.uri).port)
    : null;
  const requestedPort = Number(
    requestedPortValue || existingPort || DEFAULT_GSI_PORT,
  );
  if (
    existingConfig &&
    requestedPortValue &&
    requestedPort !== existingPort
  ) {
    throw new Error(
      `Existing Arenzyra GSI configuration uses port ${existingPort}; refusing to silently replace it with ${requestedPort}.`,
    );
  }
  if (
    existingConfig &&
    requestedPlayerData &&
    !existingConfig.includePlayerData
  ) {
    throw new Error(
      "Existing Arenzyra GSI configuration has observer roster data disabled; refusing to silently expand its privacy scope.",
    );
  }

  const token = existingConfig?.token || createCs2GsiToken();
  const includePlayerData =
    existingConfig?.includePlayerData ?? requestedPlayerData;
  let connectivitySnapshotSeen = false;
  let rosterSnapshotSeen = false;
  const listener = await startCs2GsiServer({
    port: requestedPort,
    token,
    onSnapshot(snapshot) {
      connectivitySnapshotSeen = true;
      if (
        snapshot.hasAllPlayersPayload &&
        snapshot.observerRosterCount > 0
      ) {
        rosterSnapshotSeen = true;
      }
      printSnapshotSummary(snapshot);
    },
  });

  try {
    const installed = installCs2GsiConfig({
      cs2InstallDir,
      uri: listener.url,
      token,
      includePlayerData,
    });
    process.stdout.write(
      `[cs2-gsi] loopback listener ready at ${listener.url}\n`,
    );
    process.stdout.write(
      `[cs2-gsi] configuration ${installed.changed ? "created" : "verified"} at ${installed.configPath}\n`,
    );
    process.stdout.write(
      `[cs2-gsi] observer roster data ${includePlayerData ? "enabled" : "disabled"}\n`,
    );
    process.stdout.write(
      includePlayerData
        ? "[cs2-gsi] restart CS2, enter a spectator/CSTV match, and press Ctrl+C here when finished\n"
        : "[cs2-gsi] restart CS2, enter a practice match for the connectivity proof, and press Ctrl+C here when finished\n",
    );
  } catch (error) {
    await listener.close();
    throw error;
  }

  let stopping = false;
  const stop = async () => {
    if (stopping) {
      return;
    }
    stopping = true;
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await listener.close();
    const passed =
      connectivitySnapshotSeen &&
      (!includePlayerData || rosterSnapshotSeen);
    process.stdout.write(
      passed
        ? "[cs2-gsi] live proof passed\n"
        : includePlayerData
          ? "[cs2-gsi] live proof incomplete: no observer roster snapshot was received\n"
          : "[cs2-gsi] live proof incomplete: no authenticated CS2 snapshot was received\n",
    );
    process.exitCode = passed ? 0 : 1;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

async function main() {
  if (process.argv.includes("--live")) {
    await runLiveProof();
    return;
  }
  await runMockProof();
}

main().catch((error) => {
  process.stderr.write(`[cs2-gsi] ${error?.message || String(error)}\n`);
  process.exitCode = 1;
});
