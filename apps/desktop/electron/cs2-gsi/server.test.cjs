"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildCs2GsiConfig,
  createCs2GsiToken,
  installCs2GsiConfig,
  readInstalledCs2GsiConfig,
} = require("./config.cjs");
const { normalizeCs2GsiPayload } = require("./normalizer.cjs");
const { startCs2GsiServer } = require("./server.cjs");

const fixturePath = path.join(
  __dirname,
  "fixtures",
  "synthetic-observer.json",
);

function loadFixture(token = createCs2GsiToken()) {
  const payload = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  payload.auth = { token };
  return payload;
}

function createFakeCs2Install(t) {
  const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-cs2-"));
  const gameRoot = path.join(installRoot, "game", "csgo");
  fs.mkdirSync(path.join(gameRoot, "cfg"), { recursive: true });
  fs.writeFileSync(path.join(gameRoot, "gameinfo.gi"), '"GameInfo" {}');
  t.after(() => {
    const resolvedTemp = path.resolve(os.tmpdir());
    const resolvedInstall = path.resolve(installRoot);
    const relative = path.relative(resolvedTemp, resolvedInstall);
    assert.ok(
      relative &&
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative),
    );
    fs.rmSync(resolvedInstall, { recursive: true, force: true });
  });
  return installRoot;
}

function requestJson(
  url,
  {
    method = "POST",
    payload,
    contentType,
    headers: extraHeaders,
    omitContentLength = false,
    omitContentType = false,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const body =
      payload === undefined
        ? null
        : Buffer.from(
            typeof payload === "string" ? payload : JSON.stringify(payload),
          );
    const headers = { ...(extraHeaders || {}) };
    if (body) {
      if (!omitContentType) {
        headers["Content-Type"] = contentType || "application/json";
      }
      if (!omitContentLength) {
        headers["Content-Length"] = body.length;
      }
    }
    const request = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method,
        headers,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.once("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            statusCode: response.statusCode,
            body: text ? JSON.parse(text) : null,
          });
        });
      },
    );
    request.once("error", reject);
    request.end(body);
  });
}

test("configuration is loopback-only and minimizes data by default", () => {
  const token = createCs2GsiToken();
  const config = buildCs2GsiConfig({
    uri: "http://127.0.0.1:31973/gsi",
    token,
  });

  assert.match(config, /"uri" "http:\/\/127\.0\.0\.1:31973\/gsi"/u);
  assert.match(config, new RegExp(`"token" "${token}"`, "u"));
  assert.doesNotMatch(config, /"allplayers_state" "1"/u);
  assert.doesNotMatch(config, /"bomb" "1"/u);

  const observerConfig = buildCs2GsiConfig({
    uri: "http://127.0.0.1:31973/gsi",
    token,
    includePlayerData: true,
  });
  assert.match(observerConfig, /"allplayers_state" "1"/u);
  assert.match(observerConfig, /"bomb" "1"/u);
  assert.throws(
    () =>
      buildCs2GsiConfig({
        uri: "http://0.0.0.0:31973/gsi",
        token,
      }),
    /127\.0\.0\.1/u,
  );
});

test("configuration installer reuses its config and refuses replacement", (t) => {
  const installRoot = createFakeCs2Install(t);
  const token = createCs2GsiToken();
  const first = installCs2GsiConfig({
    cs2InstallDir: installRoot,
    uri: "http://127.0.0.1:31973/gsi",
    token,
    includePlayerData: true,
  });
  assert.equal(first.changed, true);

  const second = installCs2GsiConfig({
    cs2InstallDir: installRoot,
    uri: "http://127.0.0.1:31973/gsi",
    token,
    includePlayerData: true,
  });
  assert.equal(second.changed, false);
  const loaded = readInstalledCs2GsiConfig({
    cs2InstallDir: installRoot,
  });
  assert.equal(loaded.configPath, first.configPath);
  assert.equal(loaded.uri, "http://127.0.0.1:31973/gsi");
  assert.equal(loaded.token, token);
  assert.equal(loaded.includePlayerData, true);

  assert.throws(
    () =>
      installCs2GsiConfig({
        cs2InstallDir: installRoot,
        uri: "http://127.0.0.1:31974/gsi",
        token,
        includePlayerData: true,
      }),
    (error) => error?.code === "CS2_GSI_CONFIG_EXISTS",
  );
});

test("configuration installer requires an absolute verified CS2 path", (t) => {
  const installRoot = createFakeCs2Install(t);
  const token = createCs2GsiToken();
  assert.throws(
    () =>
      installCs2GsiConfig({
        cs2InstallDir: path.relative(process.cwd(), installRoot),
        uri: "http://127.0.0.1:31973/gsi",
        token,
      }),
    /absolute path/u,
  );
  assert.throws(
    () =>
      installCs2GsiConfig({
        cs2InstallDir: "",
        uri: "http://127.0.0.1:31973/gsi",
        token,
      }),
    /absolute path/u,
  );
});

test("configuration reader refuses a non-Arenzyra file", (t) => {
  const installRoot = createFakeCs2Install(t);
  const configPath = path.join(
    installRoot,
    "game",
    "csgo",
    "cfg",
    "gamestate_integration_arenzyra.cfg",
  );
  fs.writeFileSync(
    configPath,
    '"Another integration" { "uri" "http://127.0.0.1:31973/gsi" }',
  );
  assert.throws(
    () => readInstalledCs2GsiConfig({ cs2InstallDir: installRoot }),
    (error) => error?.code === "CS2_GSI_CONFIG_UNMANAGED",
  );
});

test("normalizer emits bounded CS2 state without auth or delta data", () => {
  const normalized = normalizeCs2GsiPayload(loadFixture(), {
    receivedAt: "2026-07-30T12:00:00.000Z",
  });

  assert.equal(normalized.game, "CS2");
  assert.equal(normalized.match.mapName, "de_mirage");
  assert.equal(normalized.match.ct.score, 7);
  assert.equal(normalized.match.t.score, 5);
  assert.equal(normalized.players.length, 2);
  assert.equal(normalized.hasAllPlayersPayload, true);
  assert.equal(normalized.observerRosterCount, 2);
  assert.equal(normalized.players[0].observerSlot, 1);
  assert.equal(normalized.bomb.state, "carried");
  assert.deepEqual(normalized.match.roundWins[1], {
    roundNumber: "2",
    result: "t_win_bomb",
  });
  assert.equal(normalized.receivedAt, "2026-07-30T12:00:00.000Z");
  assert.equal("auth" in normalized, false);
  assert.equal("previously" in normalized, false);
});

test("normalizer distinguishes a watched player from an observer roster", () => {
  const payload = loadFixture();
  delete payload.allplayers;

  const normalized = normalizeCs2GsiPayload(payload);

  assert.equal(normalized.players.length, 1);
  assert.equal(normalized.hasAllPlayersPayload, false);
  assert.equal(normalized.observerRosterCount, 0);
});

test("normalizer treats each round and game-over payload as a fresh snapshot", () => {
  const firstPayload = loadFixture();
  const first = normalizeCs2GsiPayload(firstPayload);
  assert.equal(first.players[0].state.health, 84);

  const nextPayload = loadFixture();
  nextPayload.map.round = 13;
  nextPayload.map.phase = "gameover";
  nextPayload.map.team_ct.score = 8;
  nextPayload.round = { phase: "over", win_team: "CT" };
  nextPayload.allplayers["76561190000000001"].state.health = 100;
  nextPayload.allplayers["76561190000000003"] = {
    name: "Tenth Observer Slot",
    team: "T",
    observer_slot: 0,
  };
  const next = normalizeCs2GsiPayload(nextPayload);

  assert.equal(next.match.roundNumber, 13);
  assert.equal(next.match.phase, "gameover");
  assert.equal(next.match.ct.score, 8);
  assert.equal(next.round.winningTeam, "CT");
  assert.equal(next.players[0].state.health, 100);
  assert.equal(next.players.at(-1).observerSlot, 0);
  assert.equal("events" in next, false);
  assert.equal("finalized" in next, false);
});

test("loopback server accepts an authenticated CS2 snapshot", async () => {
  const token = createCs2GsiToken();
  const snapshots = [];
  const listener = await startCs2GsiServer({
    token,
    onSnapshot(snapshot) {
      snapshots.push(snapshot);
    },
  });

  try {
    assert.equal(listener.host, "127.0.0.1");
    const response = await requestJson(listener.url, {
      payload: loadFixture(token),
    });
    assert.equal(response.statusCode, 204);
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].match.mapName, "de_mirage");
    assert.equal(listener.getStatus().acceptedSnapshots, 1);

    const health = await requestJson(
      `http://${listener.host}:${listener.port}/health`,
      { method: "GET" },
    );
    assert.equal(health.statusCode, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.body.acceptedSnapshots, 1);
    assert.equal(JSON.stringify(health.body).includes(token), false);
  } finally {
    await listener.close();
  }
});

test("loopback server rejects wrong auth, wrong app, and malformed JSON", async () => {
  const token = createCs2GsiToken();
  const listener = await startCs2GsiServer({ token });

  try {
    const wrongToken = await requestJson(listener.url, {
      payload: loadFixture(createCs2GsiToken()),
    });
    assert.equal(wrongToken.statusCode, 401);

    const wrongAppPayload = loadFixture(token);
    wrongAppPayload.provider.appid = 999;
    const wrongApp = await requestJson(listener.url, {
      payload: wrongAppPayload,
    });
    assert.equal(wrongApp.statusCode, 400);

    const malformed = await requestJson(listener.url, {
      payload: "{",
    });
    assert.equal(malformed.statusCode, 400);

    const missingContentType = await requestJson(listener.url, {
      payload: loadFixture(token),
      omitContentType: true,
    });
    assert.equal(missingContentType.statusCode, 415);

    const missingPath = await requestJson(
      `http://${listener.host}:${listener.port}/missing`,
      { payload: loadFixture(token) },
    );
    assert.equal(missingPath.statusCode, 404);

    const wrongMethod = await requestJson(listener.url, {
      method: "PUT",
      payload: loadFixture(token),
    });
    assert.equal(wrongMethod.statusCode, 405);
    assert.equal(listener.getStatus().acceptedSnapshots, 0);
  } finally {
    await listener.close();
  }
});

test("loopback server rejects unsafe transport requests", async () => {
  const token = createCs2GsiToken();
  await assert.rejects(
    startCs2GsiServer({ host: "0.0.0.0", token }),
    /127\.0\.0\.1/u,
  );

  const listener = await startCs2GsiServer({
    token,
    maxBodyBytes: 128,
  });
  try {
    const wrongHost = await requestJson(listener.url, {
      payload: loadFixture(token),
      headers: { Host: "localhost:31973" },
    });
    assert.equal(wrongHost.statusCode, 400);

    const compressed = await requestJson(listener.url, {
      payload: loadFixture(token),
      headers: { "Content-Encoding": "gzip" },
    });
    assert.equal(compressed.statusCode, 415);

    const oversized = await requestJson(listener.url, {
      payload: { auth: { token }, padding: "x".repeat(512) },
    });
    assert.equal(oversized.statusCode, 413);

    const chunkedOversized = await requestJson(listener.url, {
      payload: { auth: { token }, padding: "x".repeat(512) },
      omitContentLength: true,
    });
    assert.equal(chunkedOversized.statusCode, 413);
  } finally {
    await listener.close();
  }
});

test("loopback server rate-limits excessive snapshots", async () => {
  const token = createCs2GsiToken();
  const listener = await startCs2GsiServer({
    token,
    maxRequestsPerSecond: 1,
  });
  try {
    const invalid = await requestJson(listener.url, {
      payload: loadFixture(createCs2GsiToken()),
    });
    assert.equal(invalid.statusCode, 401);

    const accepted = await requestJson(listener.url, {
      payload: loadFixture(token),
    });
    assert.equal(accepted.statusCode, 204);

    const limited = await requestJson(listener.url, {
      payload: loadFixture(token),
    });
    assert.equal(limited.statusCode, 429);
    assert.equal(listener.getStatus().acceptedSnapshots, 1);
  } finally {
    await listener.close();
  }
});

test("loopback server reports snapshot handler failures as internal errors", async () => {
  const token = createCs2GsiToken();
  const listener = await startCs2GsiServer({
    token,
    onSnapshot() {
      throw new Error("sensitive internal detail");
    },
  });
  try {
    const failed = await requestJson(listener.url, {
      payload: loadFixture(token),
    });
    assert.equal(failed.statusCode, 500);
    assert.deepEqual(failed.body, { error: "snapshot-handler-failed" });
    assert.equal(listener.getStatus().acceptedSnapshots, 0);
    assert.equal(
      listener.getStatus().lastError,
      "CS2 GSI snapshot handler failed.",
    );
  } finally {
    await listener.close();
  }
});
