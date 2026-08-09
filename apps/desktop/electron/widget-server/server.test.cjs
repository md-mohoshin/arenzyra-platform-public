"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { WebSocket } = require("ws");

const { startWidgetsServer } = require("./server.cjs");

function createLoggerStub() {
  return {
    info() {},
    warn() {},
    error() {},
  };
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function startJsonServer(handler) {
  const port = await getFreePort();
  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: error?.message || String(error) }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function waitFor(predicate, timeoutMs = 2_000, intervalMs = 20) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = predicate();
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out waiting for condition.");
}

async function connectWidgetSocket(url) {
  const messages = [];
  const socket = new WebSocket(url);
  socket.on("message", (data) => {
    messages.push(JSON.parse(String(data)));
  });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return { messages, socket };
}

async function closeWidgetSocket(socket) {
  if (!socket || socket.readyState === WebSocket.CLOSED) {
    return;
  }
  await new Promise((resolve) => {
    socket.once("close", resolve);
    socket.close();
  });
}

test("map markers survive short pauses and fail closed after a whole-stream outage", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "public", "obs-map-widget.js"),
    "utf8",
  );
  const collectStart = source.indexOf("function collectVisiblePlayers(now)");
  const collectEnd = source.indexOf("\n  function ", collectStart + 1);
  const collectSource = source.slice(collectStart, collectEnd);
  const applyStart = source.indexOf("function applyPlayerPacket(");
  const applyEnd = source.indexOf("\n  function ", applyStart + 1);
  const applySource = source.slice(applyStart, applyEnd);
  const failsafeStart = source.indexOf("function expireStalePlayerStream(");
  const failsafeEnd = source.indexOf("\n  function ", failsafeStart + 1);
  const failsafeSource = source.slice(failsafeStart, failsafeEnd);

  assert.ok(collectStart >= 0 && collectEnd > collectStart);
  assert.ok(applyStart >= 0 && applyEnd > applyStart);
  assert.ok(failsafeStart >= 0 && failsafeEnd > failsafeStart);
  assert.doesNotMatch(
    collectSource,
    /now\s*-\s*motion\.lastSeenAt\s*>\s*PLAYER_TTL_MS/,
  );
  assert.match(
    applySource,
    /receivedAt\s*-\s*motion\.lastSeenAt\s*>\s*PLAYER_TTL_MS/,
  );
  assert.match(failsafeSource, /PLAYER_STREAM_FAILSAFE_MS/);
  assert.match(failsafeSource, /state\.mapControl\.hitTargets\.length\s*=\s*0/);
  assert.match(failsafeSource, /resetTransientState\(\)/);
});

test("browser runtime reset clears match-owned map and branding state", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "public", "obs-map-widget.js"),
    "utf8",
  );
  const resetStart = source.indexOf("function applyRuntimeReset()");
  const resetEnd = source.indexOf("\n  function ", resetStart + 1);
  const resetSource = source.slice(resetStart, resetEnd);

  assert.ok(resetStart >= 0 && resetEnd > resetStart);
  assert.match(resetSource, /state\.mapContext\s*=\s*null/);
  assert.match(resetSource, /applyTeamBrandingPacket\(null\)/);
  assert.match(resetSource, /resetMapTileLayer\(\)/);
  assert.match(resetSource, /state\.mapControl\.hitTargets\.length\s*=\s*0/);
});

test("map context changes synchronously clear PCOB control targets", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "public", "obs-map-widget.js"),
    "utf8",
  );
  const contextStart = source.indexOf("function applyMapContext(");
  const contextEnd = source.indexOf("\n  function ", contextStart + 1);
  const contextSource = source.slice(contextStart, contextEnd);

  assert.ok(contextStart >= 0 && contextEnd > contextStart);
  assert.match(contextSource, /state\.mapControl\.hitTargets\.length\s*=\s*0/);
  assert.match(contextSource, /state\.mapControl\.pointer\s*=\s*null/);
  assert.match(contextSource, /state\.mapControl\.selectedPlayerId\s*=\s*null/);
});

test("unexpected direct connector exit clears widget runtime state", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "main.cjs"),
    "utf8",
  );
  const handlerStart = source.indexOf("function beginObserverFeedRecovery(");
  const handlerEnd = source.indexOf("\nasync function ", handlerStart + 1);
  const handlerSource = source.slice(handlerStart, handlerEnd);

  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  assert.match(handlerSource, /setWidgetDirectObserverPollingAllowed\(false\)/);
  assert.match(handlerSource, /clearWidgetRuntimeState\(/);
  assert.match(handlerSource, /observer-feed-process-exited/);
});

test("unpinned live map reconnects and acts on the current map", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "public", "obs-map-widget.js"),
    "utf8",
  );
  const socketStart = source.indexOf("function buildSocketUrl()");
  const socketEnd = source.indexOf("\n  function ", socketStart + 1);
  const socketSource = source.slice(socketStart, socketEnd);
  const actionStart = source.indexOf("function buildOperatorActionPath(");
  const actionEnd = source.indexOf("\n  function ", actionStart + 1);
  const actionSource = source.slice(actionStart, actionEnd);

  assert.ok(socketStart >= 0 && socketEnd > socketStart);
  assert.ok(actionStart >= 0 && actionEnd > actionStart);
  assert.match(socketSource, /state\.mapLocked\s*&&\s*state\.requestedMapKey/);
  assert.match(
    actionSource,
    /state\.mapLocked\s*\?\s*state\.requestedMapKey\s*:\s*normalizeText\(state\.mapContext\?\.mapKey\)/,
  );
});

test("PCOB map control exposes only targets with trusted shortcut ordinals", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "public", "obs-map-widget.js"),
    "utf8",
  );
  const markerStart = source.indexOf("function drawPlayerMarker(");
  const markerEnd = source.indexOf("\n  function ", markerStart + 1);
  const markerSource = source.slice(markerStart, markerEnd);

  assert.ok(markerStart >= 0 && markerEnd > markerStart);
  assert.match(markerSource, /controlTeamSlot\s*!==\s*null/);
  assert.match(markerSource, /controlPlayerNumber\s*!==\s*null/);
  assert.match(markerSource, /playerNumber:\s*controlPlayerNumber/);
  assert.match(markerSource, /teamSlot:\s*controlTeamSlot/);
});

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

async function startServer(enableOperatorRoutes, options = {}) {
  const port = await getFreePort();
  const assetsRoot = path.resolve(__dirname, "../assets");
  const teamAssetsRoot = makeTempDir("arenzyra-widget-teams-");
  const playerAssetsRoot = makeTempDir("arenzyra-widget-players-");
  const resolveWidgetContext =
    options.resolveWidgetContext ||
    (typeof options.resolveApiBase === "function"
      ? async ({ instanceKey }) => {
          const url = new URL("/api/widgets/resolve", options.resolveApiBase());
          url.searchParams.set("key", instanceKey);
          const response = await fetch(url);
          const payload = await response.json();
          if (!response.ok) {
            const error = new Error(
              payload?.message || payload?.error || "widget resolve failed",
            );
            error.status = response.status;
            throw error;
          }
          return payload;
        }
      : null);
  const server = startWidgetsServer({
    port,
    host: "127.0.0.1",
    assetsRoot,
    teamAssetsRoot,
    playerAssetsRoot,
    enableDebugRoutes: false,
    enableOperatorRoutes,
    capabilityToken: options.capabilityToken,
    shouldPollDirectObserver: options.shouldPollDirectObserver || (() => false),
    shouldPollDirectObserverCircle:
      options.shouldPollDirectObserverCircle ||
      options.shouldPollDirectObserver ||
      (() => false),
    resolveApiBase: options.resolveApiBase,
    resolveWidgetContext,
    getObserverBaseUrl: options.getObserverBaseUrl,
    getCurrentMatchContext: options.getCurrentMatchContext,
    requestPlayerPhotoRefresh: options.requestPlayerPhotoRefresh,
    organizationBranding: options.organizationBranding,
    logger: options.logger || createLoggerStub(),
  });

  await server.whenReady();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    server,
    teamAssetsRoot,
    playerAssetsRoot,
  };
}

async function stopServer(instance) {
  if (!instance) {
    return;
  }

  await instance.server.stop();
  fs.rmSync(instance.teamAssetsRoot, { recursive: true, force: true });
  fs.rmSync(instance.playerAssetsRoot, { recursive: true, force: true });
}

test("widget routes require the per-launch capability when enabled", async () => {
  const capabilityToken = "0123456789abcdef0123456789abcdef";
  const instance = await startServer(false, { capabilityToken });
  try {
    const denied = await fetch(`${instance.baseUrl}/obs/map`);
    assert.equal(denied.status, 401);

    const allowed = await fetch(
      `${instance.baseUrl}/obs/map?access_token=${capabilityToken}`,
    );
    assert.equal(allowed.status, 200);
    assert.match(
      allowed.headers.get("set-cookie") || "",
      /ArenzyraWidgetAccess=/,
    );
    assert.equal(instance.server.getStatus().accessControlled, true);
    assert.match(
      instance.server.getStatus().authorizedLocalBaseUrl,
      /access_token=/,
    );
  } finally {
    await stopServer(instance);
  }
});

test("pinned websocket clients reject other maps while unpinned reconnects follow the active map", async () => {
  const instance = await startServer(false);
  const socketBaseUrl = instance.baseUrl.replace(/^http/, "ws");
  let pinnedSocket = null;
  let unpinnedSocket = null;
  let reconnectedSocket = null;
  let timestamp = Date.now();

  try {
    instance.server.engine.syncMapContext({
      mapKey: "rondo",
      sourceMapName: "NEON_MAIN",
      timestamp: timestamp++,
    });

    const pinned = await connectWidgetSocket(
      `${socketBaseUrl}/ws?map=NEON_MAIN`,
    );
    pinnedSocket = pinned.socket;
    await waitFor(() =>
      pinned.messages.find(
        (message) =>
          message.type === "map_context" && message.payload?.mapKey === "rondo",
      ),
    );
    const pinnedBaseline = pinned.messages.length;

    instance.server.engine.syncMapContext({
      mapKey: "erangel",
      sourceMapName: "BALTIC_MAIN",
      timestamp: timestamp++,
    });
    instance.server.engine.syncMapContext({
      mapKey: "rondo",
      sourceMapName: "NEON_MAIN",
      timestamp: timestamp++,
    });
    await waitFor(() =>
      pinned.messages
        .slice(pinnedBaseline)
        .find(
          (message) =>
            message.type === "map_context" &&
            message.payload?.mapKey === "rondo",
        ),
    );
    assert.equal(
      pinned.messages
        .slice(pinnedBaseline)
        .some(
          (message) =>
            message.type === "map_context" &&
            message.payload?.mapKey === "erangel",
        ),
      false,
    );

    const unpinned = await connectWidgetSocket(`${socketBaseUrl}/ws`);
    unpinnedSocket = unpinned.socket;
    await waitFor(() =>
      unpinned.messages.find(
        (message) =>
          message.type === "map_context" && message.payload?.mapKey === "rondo",
      ),
    );
    instance.server.engine.syncMapContext({
      mapKey: "erangel",
      sourceMapName: "BALTIC_MAIN",
      timestamp: timestamp++,
    });
    await waitFor(() =>
      unpinned.messages.find(
        (message) =>
          message.type === "map_context" &&
          message.payload?.mapKey === "erangel",
      ),
    );
    await closeWidgetSocket(unpinnedSocket);
    unpinnedSocket = null;

    instance.server.engine.syncMapContext({
      mapKey: "rondo",
      sourceMapName: "NEON_MAIN",
      timestamp: timestamp++,
    });
    const reconnected = await connectWidgetSocket(`${socketBaseUrl}/ws`);
    reconnectedSocket = reconnected.socket;
    await waitFor(() =>
      reconnected.messages.find(
        (message) =>
          message.type === "map_context" && message.payload?.mapKey === "rondo",
      ),
    );
  } finally {
    await closeWidgetSocket(pinnedSocket);
    await closeWidgetSocket(unpinnedSocket);
    await closeWidgetSocket(reconnectedSocket);
    await stopServer(instance);
  }
});

test("timer-only fast circle data defers geometry to the normalized full snapshot", async () => {
  const requests = [];
  const sourceUpdatedAt = Date.now();
  const observer = await startJsonServer((req, res) => {
    requests.push(req.url);
    if (req.url === "/getcircleinfo") {
      sendJson(res, 200, {
        mapName: "ERANGEL",
        phase: 4,
        CircleStatus: "2",
        Counter: 40,
        MaxTime: 60,
        updatedAt: new Date(sourceUpdatedAt).toISOString(),
      });
      return;
    }
    sendJson(res, 404, { error: "not-found" });
  });
  const instance = await startServer(false, {
    getObserverBaseUrl: () => observer.baseUrl,
    shouldPollDirectObserver: () => false,
    shouldPollDirectObserverCircle: () => true,
  });

  try {
    await waitFor(() => requests.includes("/getcircleinfo"));
    assert.equal(instance.server.engine.getSnapshot("erangel")?.zone, null);

    instance.server.ingestTelemetrySnapshot({
      source: "direct-observer",
      phase: "combat",
      circlePayload: {
        mapName: "ERANGEL",
        phase: 4,
        CircleStatus: "2",
        Counter: 40,
        MaxTime: 60,
        updatedAt: new Date(sourceUpdatedAt).toISOString(),
      },
      observerSnapshot: {
        mapName: "erangel",
        normalized: {
          circle: {
            phase: 4,
            status: "2",
            counterSeconds: 40,
            maxTimeSeconds: 60,
            safeZone: { x: 400000, y: 400000, r: 100000 },
            nextZone: { x: 420000, y: 410000, r: 50000 },
          },
        },
      },
      players: [],
      teams: [],
      kills: [],
    });

    const zone = await waitFor(
      () => instance.server.engine.getSnapshot("erangel")?.zone,
    );
    assert.equal(zone.mode, "closing");
    assert.equal(zone.phase, 4);
    assert.ok(Date.now() - sourceUpdatedAt < 500);
    assert.equal(requests.includes("/getallinfo"), false);
  } finally {
    await stopServer(instance);
    await observer.close();
  }
});

test("widget mutation routes are disabled at the HTTP boundary when operator routes are off", async () => {
  const instance = await startServer(false);

  try {
    const response = await fetch(
      `${instance.baseUrl}/debug/operator/watch-now?id=player-1`,
    );
    assert.equal(response.status, 404);
  } finally {
    await stopServer(instance);
  }
});

test("widget mutation routes remain available when operator routes are explicitly enabled", async () => {
  const instance = await startServer(true);

  try {
    const response = await fetch(
      `${instance.baseUrl}/debug/operator/watch-now?id=player-1`,
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.action, "watch-now");
    assert.equal(payload.id, "player-1");
  } finally {
    await stopServer(instance);
  }
});

test("pinned commentator desk uses compact layout without changing the full desk", async () => {
  const instance = await startServer(false);

  try {
    const fullResponse = await fetch(
      `${instance.baseUrl}/obs/commentator-desk`,
    );
    assert.equal(fullResponse.status, 200);
    const fullHtml = await fullResponse.text();
    assert.match(fullHtml, /id="map-frame"/);
    assert.match(fullHtml, /"layout":"full"/);
    assert.doesNotMatch(fullHtml, /commentator-desk--pinned/);

    const pinnedResponse = await fetch(
      `${instance.baseUrl}/obs/commentator-desk?pinned=1`,
    );
    assert.equal(pinnedResponse.status, 200);
    const pinnedHtml = await pinnedResponse.text();
    assert.match(pinnedHtml, /commentator-desk--pinned/);
    assert.match(pinnedHtml, /"layout":"pinned"/);
    assert.match(pinnedHtml, /Close Teams/);
    assert.match(pinnedHtml, /Fight Cues/);
    assert.doesNotMatch(pinnedHtml, /id="map-frame"/);
  } finally {
    await stopServer(instance);
  }
});

test("PCOB control map has no manual switching panel or OBS visibility coupling", async () => {
  const instance = await startServer(false);

  try {
    const obsResponse = await fetch(`${instance.baseUrl}/obs/map`);
    assert.equal(obsResponse.status, 200);
    const obsHtml = await obsResponse.text();
    assert.match(obsHtml, /id="status-pill" hidden aria-hidden="true"/);
    assert.match(obsHtml, /id="timer-panel" hidden aria-hidden="true"/);
    assert.doesNotMatch(obsHtml, /id="map-control-panel"/);
    assert.doesNotMatch(obsHtml, /"controlMode":true/);
    assert.match(obsHtml, /"mapLocked":false/);
    assert.match(obsHtml, /widget-visibility-client\.js\?v=widget-hotkey-v1/);

    const controlResponse = await fetch(
      `${instance.baseUrl}/obs/map?control=1&pinned=1`,
    );
    assert.equal(controlResponse.status, 200);
    const controlHtml = await controlResponse.text();
    assert.match(controlHtml, /id="status-pill" hidden aria-hidden="true"/);
    assert.match(controlHtml, /id="timer-panel" hidden aria-hidden="true"/);
    assert.doesNotMatch(controlHtml, /id="map-control-panel"/);
    assert.doesNotMatch(controlHtml, /id="map-control-arm"/);
    assert.match(controlHtml, /"controlMode":true/);
    assert.doesNotMatch(
      controlHtml,
      /widget-visibility-client\.js\?v=widget-hotkey-v1/,
    );

    const lockedResponse = await fetch(
      `${instance.baseUrl}/obs/map?control=1&map=NEON_MAIN`,
    );
    assert.equal(lockedResponse.status, 200);
    const lockedHtml = await lockedResponse.text();
    assert.match(lockedHtml, /"requestedMapKey":"rondo"/);
    assert.match(lockedHtml, /"mapLocked":true/);

    const invalidResponse = await fetch(
      `${instance.baseUrl}/obs/map?control=1&map=UNKNOWN_FUTURE_MAP`,
    );
    assert.equal(invalidResponse.status, 400);
    assert.match(await invalidResponse.text(), /Unsupported map key/);
  } finally {
    await stopServer(instance);
  }
});

test("raw local OBS routes share and refresh the organization branding context", async () => {
  const instance = await startServer(false, {
    organizationBranding: {
      organizationId: "org-1",
      organizationSlug: "test-org",
      brandingApiUrl: "https://api.test/branding/org-1",
      organization: {
        id: "org-1",
        slug: "test-org",
        name: "Test Org",
      },
      branding: {
        primaryColor: "#ff4f70",
        secondaryColor: "#71f0d4",
        accent: "#8b5cf6",
        panel: "#081521",
      },
    },
  });

  try {
    const contextResponse = await fetch(
      `${instance.baseUrl}/obs/widget-branding`,
    );
    assert.equal(contextResponse.status, 200);
    assert.match(
      contextResponse.headers.get("cache-control") ?? "",
      /no-store/,
    );
    const context = await contextResponse.json();
    assert.equal(context.organizationId, "org-1");
    assert.equal(context.branding.primaryColor, "#ff4f70");
    assert.equal(context.brandingApiUrl, "https://api.test/branding/org-1");

    for (const route of [
      "/obs/map",
      "/obs/ai-caster",
      "/obs/commentator-desk",
      "/obs/player-photo",
    ]) {
      const response = await fetch(`${instance.baseUrl}${route}`);
      assert.equal(response.status, 200, route);
      const html = await response.text();
      assert.match(html, /widget-branding-bridge\.css\?v=widget-branding-v2/);
      assert.match(html, /widget-branding-client\.js\?v=widget-branding-v2/);
      assert.match(html, /"brandingRefreshPath":"\/obs\/widget-branding"/);
      assert.match(
        html,
        /"brandingApiUrl":"https:\/\/api\.test\/branding\/org-1"/,
      );
      assert.match(html, /"primaryColor":"#ff4f70"/);
    }

    instance.server.setOrganizationBranding({
      organizationId: "org-1",
      branding: { primaryColor: "#22c55e" },
    });
    const updated = await fetch(`${instance.baseUrl}/obs/widget-branding`);
    assert.equal((await updated.json()).branding.primaryColor, "#22c55e");
  } finally {
    await stopServer(instance);
  }
});

test("new next zone style widgets render through the local permanent widget route", async () => {
  const widgetKeysByInstanceKey = new Map([
    ["kinetic-key", "next-zone-update-kinetic-hud"],
    ["blade-key", "next-zone-update-blade"],
    ["radar-key", "next-zone-update-radar-sweep"],
    ["fold-key", "next-zone-update-fold-down"],
  ]);
  const api = await startJsonServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/api/widgets/resolve") {
      const instanceKey = url.searchParams.get("key");
      const widgetKey = widgetKeysByInstanceKey.get(instanceKey);
      if (!widgetKey) {
        sendJson(res, 404, { message: "not-found" });
        return;
      }
      sendJson(res, 200, {
        id: `instance-${instanceKey}`,
        key: instanceKey,
        widgetKey,
        organization: {
          id: "org-1",
          slug: "test-org",
          name: "Test Org",
          branding: {
            primaryColor: "#ff4f70",
            accent: "#71f0d4",
            panel: "#081521",
          },
        },
      });
      return;
    }
    sendJson(res, 404, { message: "not-found" });
  });
  const instance = await startServer(false, {
    resolveApiBase: () => api.baseUrl,
  });

  try {
    const expectedStyles = [
      ["kinetic-key", "kinetic-hud", "obs-next-zone-update-root--kinetic-hud"],
      ["blade-key", "blade", "obs-next-zone-update-root--blade"],
      ["radar-key", "radar-sweep", "obs-next-zone-update-root--radar-sweep"],
      ["fold-key", "fold-down", "obs-next-zone-update-root--fold-down"],
    ];

    for (const [instanceKey, style, className] of expectedStyles) {
      const response = await fetch(`${instance.baseUrl}/w/${instanceKey}`);
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.match(html, new RegExp(`data-style="${style}"`));
      assert.match(html, new RegExp(className));
      assert.match(html, /next-zone-launcher-v14/);
      assert.match(html, /widget-branding-bridge\.css\?v=widget-branding-v1/);
      assert.match(html, /widget-branding-client\.js\?v=widget-branding-v1/);
      assert.match(html, new RegExp(`/obs/widget-context/${instanceKey}`));
      assert.doesNotMatch(html, /widget-host-frame/);
    }
  } finally {
    await stopServer(instance);
    await api.close();
  }
});

test("permanent widget resolve failures return a no-cache auto-retry page", async () => {
  const api = await startJsonServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/api/widgets/resolve") {
      sendJson(res, 503, { message: "resolver warming up" });
      return;
    }
    sendJson(res, 404, { message: "not-found" });
  });
  const instance = await startServer(false, {
    resolveApiBase: () => api.baseUrl,
  });

  try {
    const response = await fetch(`${instance.baseUrl}/w/warming-up-key`);
    assert.equal(response.status, 502);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    const html = await response.text();
    assert.match(html, /Widget resolve failed/);
    assert.match(html, /http-equiv="refresh"/);
    assert.match(html, /window\.location\.reload/);
  } finally {
    await stopServer(instance);
    await api.close();
  }
});

test("permanent widget logs use a one-way correlation reference", async () => {
  const secretInstanceKey = "widget-capability-do-not-log-123456";
  const emitted = [];
  const logger = {
    info(message, meta) {
      emitted.push(`${message} ${meta ? JSON.stringify(meta) : ""}`);
    },
    warn(message, meta) {
      emitted.push(`${message} ${meta ? JSON.stringify(meta) : ""}`);
    },
    error(message, meta) {
      emitted.push(`${message} ${meta ? JSON.stringify(meta) : ""}`);
    },
  };
  const instance = await startServer(false, {
    logger,
    resolveApiBase: () => "https://api.example.test",
    resolveWidgetContext: async ({ instanceKey }) => ({
      id: "instance-1",
      key: instanceKey,
      widgetKey: "zone-timer",
      organization: { id: "org-1", slug: "test-org" },
    }),
  });

  try {
    const response = await fetch(`${instance.baseUrl}/w/${secretInstanceKey}`);
    assert.equal(response.status, 200);
    const logs = emitted.join("\n");
    assert.doesNotMatch(logs, new RegExp(secretInstanceKey));
    assert.match(logs, /keyRef=sha256:[a-f0-9]{12}/);
  } finally {
    await stopServer(instance);
  }
});

test("widget runtime reset clears server-owned map runtime state", async () => {
  const instance = await startServer(false);

  try {
    instance.server.engine.applyZoneUpdate({
      mapKey: "erangel",
      phase: 3,
      centerX: 200000,
      centerY: 300000,
      radius: 50000,
      timestamp: Date.now(),
      source: "telemetry-bridge",
    });
    instance.server.engine.applyPlayerPositionUpdate({
      mapKey: "erangel",
      players: [
        {
          playerId: "player-1",
          teamId: "team-1",
          x: 200000,
          y: 300000,
        },
      ],
      timestamp: Date.now(),
      source: "telemetry-bridge",
    });

    assert.ok(instance.server.engine.getStatus().latestZoneUpdate);
    assert.ok(instance.server.engine.getStatus().latestPlayerUpdate);

    instance.server.clearRuntimeState({ reason: "finished" });

    const status = instance.server.engine.getStatus();
    const snapshot = instance.server.engine.getSnapshot("erangel");
    assert.equal(status.latestZoneUpdate, null);
    assert.equal(status.latestPlayerUpdate, null);
    assert.equal(snapshot.zone, null);
    assert.equal(snapshot.players, null);
  } finally {
    await stopServer(instance);
  }
});

test("widget runtime reset prevents flight path and branding from leaking across matches", async () => {
  const instance = await startServer(false);

  try {
    instance.server.setTeamBranding({
      matchId: "match-a",
      teams: [
        {
          teamId: "team-1",
          slot: 1,
          teamName: "Match A Team",
          teamTag: "MAT",
        },
      ],
      timestamp: Date.now(),
    });
    instance.server.ingestTelemetrySnapshot({
      source: "direct-observer",
      phase: "plane",
      circlePayload: {
        mapName: "erangel",
        GameTime: 12,
      },
      routePayloads: {
        planeRoute: {
          start: { x: 120000, y: 780000 },
          end: { x: 710000, y: 36000 },
        },
      },
      players: [],
      teams: [],
      kills: [],
    });

    const matchA = instance.server.engine.getSnapshot("erangel");
    assert.ok(matchA.zone?.flightPath);
    assert.equal(matchA.teamBranding?.matchId, "match-a");

    instance.server.clearRuntimeState({ reason: "finished" });

    const cleared = instance.server.engine.getSnapshot("erangel");
    assert.equal(cleared.zone, null);
    assert.equal(cleared.teamBranding, null);

    instance.server.ingestTelemetrySnapshot({
      source: "direct-observer",
      phase: "combat",
      circlePayload: {
        mapName: "erangel",
        safeZone: {
          x: 408000,
          y: 408000,
          r: 182610,
        },
        GameTime: 120,
      },
      players: [],
      teams: [],
      kills: [],
    });

    const matchB = instance.server.engine.getSnapshot("erangel");
    assert.ok(matchB.zone);
    assert.equal(matchB.zone.flightPath, null);
    assert.equal(matchB.teamBranding, null);
  } finally {
    await stopServer(instance);
  }
});

test("player photo assets and state are served without browser caching", async () => {
  const instance = await startServer(false);

  try {
    fs.writeFileSync(
      path.join(instance.playerAssetsRoot, "player-1.png"),
      "png",
    );
    fs.writeFileSync(
      path.join(instance.playerAssetsRoot, "player-2.webp"),
      "webp",
    );
    fs.writeFileSync(
      path.join(instance.playerAssetsRoot, "default-player.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg"><script>runtime-override-marker</script></svg>',
    );

    const staticResponse = await fetch(
      `${instance.baseUrl}/assets/players/player-1.png`,
    );
    assert.equal(staticResponse.status, 200);
    assert.match(staticResponse.headers.get("cache-control") ?? "", /no-store/);

    const fallbackResponse = await fetch(
      `${instance.baseUrl}/assets/players/player-2.png`,
    );
    assert.equal(fallbackResponse.status, 200);
    assert.match(
      fallbackResponse.headers.get("cache-control") ?? "",
      /no-store/,
    );

    const defaultPlayerResponse = await fetch(
      `${instance.baseUrl}/assets/default-player.svg`,
    );
    assert.equal(defaultPlayerResponse.status, 200);
    assert.match(
      defaultPlayerResponse.headers.get("content-type") ?? "",
      /^image\/svg\+xml\b/,
    );
    const defaultPlayerBody = await defaultPlayerResponse.text();
    assert.match(defaultPlayerBody, /<svg\b/);
    assert.doesNotMatch(defaultPlayerBody, /runtime-override-marker/);

    const legacyDefaultPlayerResponse = await fetch(
      `${instance.baseUrl}/assets/default-player.png`,
    );
    assert.equal(legacyDefaultPlayerResponse.status, 200);
    assert.match(
      legacyDefaultPlayerResponse.headers.get("content-type") ?? "",
      /^image\/svg\+xml\b/,
    );

    const stateResponse = await fetch(
      `${instance.baseUrl}/obs/player-photo/state`,
    );
    assert.equal(stateResponse.status, 200);
    assert.match(stateResponse.headers.get("cache-control") ?? "", /no-store/);
    const statePayload = await stateResponse.json();
    assert.equal(typeof statePayload.playerAssetsVersion, "string");
  } finally {
    await stopServer(instance);
  }
});

test("player photo state polling does not refresh the photo cache", async () => {
  const api = await startJsonServer((req, res) => {
    if (req.url === "/api/observer/match/match-1/widget-state") {
      sendJson(res, 200, {
        matchId: "match-1",
        leaderboard: [],
        playerCard: null,
        circle: null,
      });
      return;
    }
    sendJson(res, 404, { error: "not-found" });
  });
  const refreshCalls = [];
  const instance = await startServer(false, {
    resolveApiBase: () => api.baseUrl,
    getCurrentMatchContext: () => ({
      matchId: "match-1",
      workflowState: "MATCH_LIVE",
    }),
    requestPlayerPhotoRefresh: (matchId) => refreshCalls.push(matchId),
  });

  try {
    const stateResponse = await fetch(
      `${instance.baseUrl}/obs/player-photo/state`,
    );
    assert.equal(stateResponse.status, 200);
    assert.deepEqual(refreshCalls, []);

    const pageResponse = await fetch(`${instance.baseUrl}/obs/player-photo`);
    assert.equal(pageResponse.status, 200);
    assert.deepEqual(refreshCalls, ["match-1"]);
  } finally {
    await stopServer(instance);
    await api.close();
  }
});

test("player photo focus route returns local observer focus without backend state", async () => {
  const observer = await startJsonServer((req, res) => {
    if (req.url === "/getobservingplayer") {
      sendJson(res, 200, {
        observingPlayer: {
          playerName: "Alpha",
          uId: "pubg-alpha",
          teamNo: 7,
        },
      });
      return;
    }
    sendJson(res, 404, { error: "not-found" });
  });
  const instance = await startServer(false, {
    getObserverBaseUrl: () => observer.baseUrl,
    getCurrentMatchContext: () => ({
      matchId: "match-1",
      workflowState: "MATCH_LIVE",
    }),
  });

  try {
    const response = await fetch(`${instance.baseUrl}/obs/player-photo/focus`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    const payload = await response.json();
    assert.equal(payload.matchId, "match-1");
    assert.equal(payload.focus.pubgPlayerId, "pubg-alpha");
    assert.equal(payload.focus.playerName, "Alpha");
    assert.equal(payload.focus.slot, "7");
  } finally {
    await stopServer(instance);
    await observer.close();
  }
});

test("player photo state prefers local observer focus and keeps uploaded roster photo", async () => {
  const api = await startJsonServer((req, res) => {
    if (req.url === "/api/observer/match/match-1/widget-state") {
      sendJson(res, 200, {
        matchId: "match-1",
        updatedAt: "2026-04-29T20:00:00.000Z",
        teamsAlive: 1,
        leaderboard: [
          {
            rank: 1,
            teamId: "team-duplicate",
            teamName: "Duplicate Team",
            teamTag: "DT",
            logoUrl: null,
            color: null,
            kills: 0,
            alivePlayers: 1,
            totalPlayers: 1,
            placement: null,
            isEliminated: false,
            players: [
              {
                playerId: "player-duplicate",
                playerName: "Alpha",
                avatarUrl: "/assets/defaults/default-player.png",
                kills: 0,
                alive: true,
                knocked: false,
                health: null,
                hasDied: false,
                lifeTelemetryFresh: true,
              },
            ],
          },
          {
            rank: 2,
            teamId: "team-1",
            teamName: "Alpha Team",
            teamTag: "AT",
            logoUrl: null,
            color: null,
            kills: 0,
            alivePlayers: 1,
            totalPlayers: 1,
            placement: null,
            isEliminated: false,
            players: [
              {
                playerId: "player-alpha",
                pubgPlayerId: "pubg-alpha",
                playerName: "Alpha",
                avatarUrl:
                  "https://api.example.test/media/players/player-alpha/photo?v=2",
                kills: 3,
                alive: true,
                knocked: false,
                health: null,
                hasDied: false,
                lifeTelemetryFresh: true,
              },
            ],
          },
        ],
        playerCard: {
          playerId: "player-default",
          name: "Default Player",
          avatarUrl: "/assets/defaults/default-player.png",
          teamId: "team-2",
          teamName: "Default Team",
          teamTag: "DT",
          logoUrl: null,
          color: null,
          kills: 0,
          alive: true,
          damage: null,
        },
        killFeed: [],
        circle: null,
        winner: null,
      });
      return;
    }
    sendJson(res, 404, { error: "not-found" });
  });
  const observer = await startJsonServer((req, res) => {
    if (req.url === "/getobservingplayer") {
      sendJson(res, 200, {
        observingPlayer: {
          playerOpenId: "open-alpha",
          0: "pubg-alpha",
          playerName: "Alpha",
        },
      });
      return;
    }
    sendJson(res, 404, { error: "not-found" });
  });
  const instance = await startServer(false, {
    resolveApiBase: () => api.baseUrl,
    getObserverBaseUrl: () => observer.baseUrl,
    getCurrentMatchContext: () => ({
      matchId: "match-1",
      workflowState: "MATCH_LIVE",
    }),
  });

  try {
    const response = await fetch(`${instance.baseUrl}/obs/player-photo/state`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.observerState.playerCard.playerId, "player-alpha");
    assert.equal(payload.observerState.playerCard.name, "Alpha");
    assert.equal(
      payload.observerState.playerCard.avatarUrl,
      "https://api.example.test/media/players/player-alpha/photo?v=2",
    );
  } finally {
    await stopServer(instance);
    await observer.close();
    await api.close();
  }
});
