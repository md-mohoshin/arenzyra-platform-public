"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const {
  selectFresherObserverSnapshot,
  startWidgetsServer,
} = require("./server.cjs");
const {
  normalizeObserverFocus,
} = require("./routes/obs-player-photo-route.cjs");
const {
  buildGoldFocusedWidgetState,
} = require("./routes/gold-focused-widget-state.cjs");
const {
  registerGoldFocusedWidgetRoute,
} = require("./routes/gold-focused-widget-route.cjs");
const {
  registerPermanentWidgetRoute,
} = require("./routes/permanent-widget-route.cjs");

const CSS_PATH = path.join(__dirname, "public", "gold-focused-widget.css");
const SCRIPT_PATH = path.join(__dirname, "public", "gold-focused-widget.js");

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function buildRecordingShape(focusedId = "player-two", receivedAt = Date.now()) {
  return {
    source: "direct-observer",
    receivedAt,
    observer: { "0": focusedId, TeamNo: 7, GunADS: false },
    teams: [
      {
        TeamNo: 7,
        TeamName: "Northern Lights",
        TeamTag: "NL",
        KillNum: 11,
      },
    ],
    players: [
      {
        uId: "player-one",
        PlayerName: "ONE",
        TeamNo: 7,
        PlayerNumber: 2,
        Health: 0,
        LiveState: 4,
        IsKnocked: false,
        KillNum: 2,
      },
      {
        uId: "player-two",
        PlayerName: "TWO",
        TeamNo: 7,
        PlayerNumber: 1,
        Health: 73,
        IsAlive: true,
        KillNum: 5,
        DamageDealt: 987.4,
        MaxKillDistance: 214.6,
        GotAirDropNum: 3,
      },
      {
        uId: "player-three",
        PlayerName: "THREE",
        TeamNo: 7,
        PlayerNumber: 3,
        Health: 0,
        LiveState: 5,
        KillNum: 4,
      },
      {
        uId: "player-four",
        PlayerName: "FOUR",
        TeamNo: 7,
        PlayerNumber: 4,
        Health: 100,
        IsAlive: true,
        KillNum: 0,
      },
    ],
  };
}

test("record-shaped PCOB focus key 0 resolves the complete no-position roster and focused stats", () => {
  const now = Date.now();
  const raw = buildRecordingShape("player-two", Math.floor(now / 1000));
  const focus = normalizeObserverFocus(raw.observer);
  assert.equal(focus.playerId, "player-two");
  assert.equal(focus.slot, "7");

  const state = buildGoldFocusedWidgetState({
    matchId: "match-live",
    focus,
    localObserverSnapshot: raw,
    now,
  });

  assert.equal(state.matchId, "match-live");
  assert.equal(state.stale, false, "epoch seconds must normalize to milliseconds");
  assert.equal(state.roster.teamName, "Northern Lights");
  assert.equal(state.roster.kills, 11);
  assert.deepEqual(
    state.roster.players.map((player) => player.name),
    ["TWO", "ONE", "THREE", "FOUR"],
  );
  assert.equal(state.roster.players[1].status, "knocked");
  assert.equal(state.roster.players[2].status, "eliminated");
  assert.deepEqual(state.roster.players[0].utilities, {
    hasData: false,
    total: null,
  });
  assert.deepEqual(state.playerStats, {
    damage: 987.4,
    longestEliminationDistanceMeters: 214.6,
    airdropsLooted: 3,
  });
  assert.equal(JSON.stringify(state).includes('"raw"'), false);

  const isoState = buildGoldFocusedWidgetState({
    focus,
    localObserverSnapshot: buildRecordingShape(
      "player-two",
      new Date(now).toISOString(),
    ),
    now,
  });
  assert.equal(isoState.stale, false, "ISO telemetry timestamps stay fresh");
});

test("authoritative PCOB liveState revives a recalled player despite lingering death flags", () => {
  const dead = buildRecordingShape("player-two");
  dead.players[1] = {
    ...dead.players[1],
    IsAlive: undefined,
    bHasDied: true,
    IsKnocked: true,
    LiveState: 5,
    Health: 0,
  };
  const recalled = {
    ...dead,
    receivedAt: Date.now() + 1,
    players: dead.players.map((player, index) =>
      index === 1
        ? { ...player, bHasDied: true, LiveState: 1, Health: 100 }
        : player,
    ),
  };

  const deadState = buildGoldFocusedWidgetState({
    focus: normalizeObserverFocus(dead.observer),
    localObserverSnapshot: dead,
  });
  const recalledState = buildGoldFocusedWidgetState({
    focus: normalizeObserverFocus(recalled.observer),
    localObserverSnapshot: recalled,
  });

  assert.equal(deadState.focus.status, "eliminated");
  assert.equal(recalledState.focus.status, "alive");
  assert.equal(recalledState.focus.health, 100);
  assert.equal(recalledState.focus.knocked, false);
});

test("focused roster emits only real members and marks unavailable utility honestly", () => {
  const raw = buildRecordingShape("player-two");
  raw.players = raw.players.slice(0, 3);
  const state = buildGoldFocusedWidgetState({
    focus: normalizeObserverFocus(raw.observer),
    localObserverSnapshot: raw,
  });

  assert.equal(state.roster.players.length, 3);
  assert.equal(
    state.roster.players.every(
      (player) => player.utilities.hasData === false && player.utilities.total === null,
    ),
    true,
  );
  assert.equal(JSON.stringify(state).includes('"assists"'), false);
});

test("focus switches inside one team without changing configured roster order", () => {
  const raw = buildRecordingShape("player-two");
  const first = buildGoldFocusedWidgetState({
    focus: normalizeObserverFocus(raw.observer),
    localObserverSnapshot: raw,
  });
  const second = buildGoldFocusedWidgetState({
    focus: normalizeObserverFocus({ "0": "player-one", TeamNo: 7 }),
    localObserverSnapshot: raw,
  });

  assert.deepEqual(
    first.roster.players.map((player) => player.id),
    second.roster.players.map((player) => player.id),
  );
  assert.equal(second.roster.players[0].id, "player-two");
  assert.equal(second.playerStats.damage, null);
});

test("Gold focus state route fails closed across match sessions and reset snapshots", () => {
  let handler = null;
  const app = {
    get(route, callback) {
      if (route === "/obs/gold-focused/state") handler = callback;
    },
  };
  registerGoldFocusedWidgetRoute(app, {
    getCurrentMatchContext: () => ({
      matchId: "match-new",
      workflowState: "MATCH_LIVE",
    }),
    getLocalObserverSnapshot: () => buildRecordingShape(),
  });
  assert.equal(typeof handler, "function");

  let payload = null;
  handler(
    { query: { matchId: "match-old" } },
    {
      set() {},
      json(value) {
        payload = value;
      },
    },
  );
  assert.equal(payload.matchId, "match-new");
  assert.equal(payload.goldFocused, null);
  assert.equal(payload.reason, "match changed");

  registerGoldFocusedWidgetRoute(
    {
      get(_route, callback) {
        handler = callback;
      },
    },
    {
      getCurrentMatchContext: () => ({ matchId: "match-new" }),
      getLocalObserverSnapshot: () => null,
      getLocalWidgetSnapshot: () => null,
    },
  );
  handler(
    { query: { matchId: "match-new" } },
    {
      set() {},
      json(value) {
        payload = value;
      },
    },
  );
  assert.equal(payload.goldFocused.focus, null);
  assert.equal(payload.goldFocused.roster, null);
  assert.equal(payload.goldFocused.playerStats, null);
});

test("launcher-pushed telemetry feeds Gold focus state when duplicate direct polling is disabled", async () => {
  const port = await getFreePort();
  const teamAssetsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-gold-teams-"));
  const playerAssetsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-gold-players-"));
  const server = startWidgetsServer({
    port,
    host: "127.0.0.1",
    assetsRoot: path.resolve(__dirname, "../assets"),
    teamAssetsRoot,
    playerAssetsRoot,
    shouldPollDirectObserver: () => false,
    shouldPollDirectObserverCircle: () => false,
    getCurrentMatchContext: () => ({
      matchId: "match-push",
      workflowState: "MATCH_LIVE",
    }),
    logger: { info() {}, warn() {}, error() {} },
  });

  try {
    await server.whenReady();
    server.ingestTelemetrySnapshot({
      source: "telemetry-bridge",
      observer: { "0": "push-player", TeamNo: 9 },
      teams: [{ teamNo: 9, teamName: "Push Nine", teamKills: 4 }],
      players: [
        {
          playerId: "push-player",
          playerName: "PUSH",
          teamSlot: 9,
          playerNumber: 1,
          isAlive: true,
          isKnocked: false,
          health: 91,
          kills: 4,
          damageDealt: 640,
          longestEliminationDistanceM: 180,
          airdropLootCount: 2,
          position: null,
        },
      ],
    });

    const response = await fetch(
      `http://127.0.0.1:${port}/obs/gold-focused/state?matchId=match-push`,
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.goldFocused.roster.players[0].name, "PUSH");
    assert.equal(payload.goldFocused.roster.players[0].health, 91);
    assert.equal(payload.goldFocused.playerStats.damage, 640);

    server.clearRuntimeState({ reason: "test-reset" });
    const resetPayload = await (
      await fetch(
        `http://127.0.0.1:${port}/obs/gold-focused/state?matchId=match-push`,
      )
    ).json();
    assert.equal(resetPayload.goldFocused.focus, null);
    assert.equal(resetPayload.goldFocused.roster, null);
  } finally {
    await server.stop();
    fs.rmSync(teamAssetsRoot, { recursive: true, force: true });
    fs.rmSync(playerAssetsRoot, { recursive: true, force: true });
  }
});

test("a fresh direct snapshot wins after a pushed telemetry source becomes stale", () => {
  const pushed = {
    source: "telemetry-bridge",
    receivedAt: "2026-08-14T10:00:00.000Z",
  };
  const direct = {
    source: "direct-observer",
    receivedAt: Date.parse("2026-08-14T10:00:02.000Z"),
  };
  assert.equal(selectFresherObserverSnapshot(pushed, direct), direct);
  assert.equal(
    selectFresherObserverSnapshot(
      { ...pushed, receivedAt: Math.floor(Date.parse("2026-08-14T10:00:03.000Z") / 1000) },
      direct,
    ).source,
    "telemetry-bridge",
  );
});

async function renderPermanentWidget(widgetKey) {
  const routes = new Map();
  registerPermanentWidgetRoute(
    {
      get(route, callback) {
        routes.set(route, callback);
      },
    },
    {
      resolveApiBase: () => "http://127.0.0.1:3000",
      resolveWidgetContext: async () => ({
        id: `instance-${widgetKey}`,
        widgetKey,
        matchId: "match-live",
        match: { id: "match-live", status: "LIVE" },
        organization: { id: "org-1", slug: "arena", name: "Arena" },
      }),
    },
  );
  let html = "";
  await routes.get("/w/:widgetInstanceKey")(
    { params: { widgetInstanceKey: "safe-instance-key" }, query: {} },
    {
      type() {
        return this;
      },
      send(value) {
        html = value;
      },
    },
  );
  return html;
}

test("both Gold focus keys render as separate permanent local widgets", async () => {
  const roster = await renderPermanentWidget("gold-broadcast-focused-roster");
  const stats = await renderPermanentWidget("gold-broadcast-player-stats");

  for (const html of [roster, stats]) {
    assert.doesNotMatch(html, /<iframe/i);
    assert.match(html, /\/obs\/static\/gold-focused-widget\.css/);
    assert.match(html, /\/obs\/static\/gold-focused-widget\.js/);
    assert.match(html, /gold-focused-local-v4/);
    assert.match(html, /widget-branding-client\.js\?v=widget-branding-v2/);
    assert.match(html, /\/obs\/gold-focused\/state\?matchId=match-live/);
    assert.match(
      html,
      /"goldBroadcastAssetBase":"http:\/\/127\.0\.0\.1:3001"/,
    );
  }
  assert.match(roster, /data-gold-panel="roster"/);
  assert.doesNotMatch(roster, /data-gold-panel="player-stats"/);
  assert.match(roster, /data-utility-available="false"/);
  assert.match(roster, /id="gold-player-0-utility">--/);
  assert.doesNotMatch(roster, /assists/i);
  assert.equal(
    (roster.match(/class="gold-roster-player"[^>]*hidden/g) || []).length,
    4,
  );
  assert.match(stats, /data-gold-panel="player-stats"/);
  assert.doesNotMatch(stats, /data-gold-panel="roster"/);
  assert.match(stats, /data-gold-static-asset="\/assets\/pubg\/asset-hud\/flaregun\.png"/);
  assert.match(stats, /data-gold-static-asset="\/assets\/pubg\/asset-hud\/parachute\.png"/);
  assert.doesNotMatch(stats, /src="\/assets\/pubg\//);
});

test("local Gold CSS preserves approved 1920 canvas, roster, and player-stat geometry", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  assert.match(
    css,
    /html,\s*body\s*\{[\s\S]*?background:\s*transparent\s*!important;/,
  );
  assert.match(css, /\.gold-focused-root\s*\{[\s\S]*?width:\s*1920px;[\s\S]*?height:\s*1080px;/);
  assert.match(
    css,
    /\.gold-focused-root\s*\{[\s\S]*?background:\s*transparent;/,
  );
  assert.match(css, /\.gold-roster\s*\{[\s\S]*?top:\s*10px;[\s\S]*?left:\s*18px;[\s\S]*?width:\s*320px;/);
  assert.match(css, /\.gold-roster-header\s*\{[\s\S]*?height:\s*42px;/);
  assert.match(css, /\.gold-roster-player\s*\{[\s\S]*?height:\s*52px;/);
  assert.match(css, /\.gold-player-stats\s*\{[\s\S]*?right:\s*443px;[\s\S]*?bottom:\s*39px;[\s\S]*?width:\s*272px;/);
  assert.match(css, /\.gold-player-stat-row\s*\{[\s\S]*?height:\s*66px;[\s\S]*?grid-template-columns:\s*184px 88px;/);
  assert.doesNotMatch(css, /--gold:\s*#eedd77;/);
  assert.equal(
    (css.match(/var\(--gold-solid,\s*#eedd77\)/g) || []).length,
    3,
  );
  assert.match(css, /--ink:\s*#050505;/);
  assert.match(css, /"Bahnschrift Condensed"/);
  assert.match(
    css,
    /\.gold-roster-player\[data-status="eliminated"\]\s*\{\s*opacity:\s*0;/,
  );
  assert.match(css, /\.gold-roster-player\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(css, /\.gold-player-stat-row > i img,[\s\S]*?width:\s*52px;/);
  assert.match(
    css,
    /\.gold-roster-portrait img\s*\{[\s\S]*?filter:\s*grayscale\(1\) brightness\(0\);/,
  );
});

function createBrowserElement(id) {
  return {
    id,
    dataset: {},
    hidden: false,
    textContent: "",
    complete: false,
    naturalWidth: 1,
    style: {
      setProperty() {},
    },
    addEventListener() {},
  };
}

async function flushBrowserPromises() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

async function runGoldBrowserRuntime({
  bootstrap,
  fetchResponse,
  reducedMotion = false,
} = {}) {
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");
  const root = createBrowserElement("gold-focused-root");
  root.hidden = true;
  const roster = createBrowserElement("gold-roster");
  const rows = Array.from({ length: 4 }, (_, index) =>
    createBrowserElement(`gold-player-row-${index}`),
  );
  root.querySelector = (selector) => {
    if (selector === ".gold-roster") return roster;
    const rowMatch = /^\[data-player-index="([0-3])"\]$/.exec(selector);
    return rowMatch ? rows[Number(rowMatch[1])] : null;
  };
  const elements = new Map([[root.id, root]]);
  for (const id of [
    "gold-team-logo",
    "gold-team-name",
    "gold-team-kills",
    "gold-stat-damage",
    "gold-stat-distance",
    "gold-stat-airdrops",
  ]) {
    elements.set(id, createBrowserElement(id));
  }
  for (let index = 0; index < 4; index += 1) {
    for (const suffix of ["name", "kills", "knockouts", "utility", "health", "photo"]) {
      const id = `gold-player-${index}-${suffix}`;
      elements.set(id, createBrowserElement(id));
    }
  }
  const intervals = new Map();
  const windowListeners = new Map();
  const animationFrames = new Map();
  let reloadCount = 0;
  let timerId = 0;
  const windowObject = {
    __ARENZYRA_LOCAL_WIDGET_BOOTSTRAP__: bootstrap,
    innerWidth: 1920,
    innerHeight: 1080,
    location: {
      href: "http://127.0.0.1:48123/w/capability",
      protocol: "http:",
      host: "127.0.0.1:48123",
      reload() {
        reloadCount += 1;
      },
    },
    fetch: fetchResponse,
    addEventListener(type, listener) {
      const next = windowListeners.get(type) || [];
      next.push(listener);
      windowListeners.set(type, next);
    },
    dispatchEvent(event) {
      for (const listener of windowListeners.get(event.type) || []) {
        listener(event);
      }
      return true;
    },
    matchMedia() {
      return { matches: reducedMotion };
    },
    requestAnimationFrame(callback) {
      timerId += 1;
      animationFrames.set(timerId, callback);
      return timerId;
    },
    cancelAnimationFrame(id) {
      animationFrames.delete(id);
    },
    setInterval(callback, delay) {
      intervals.set(delay, callback);
      timerId += 1;
      return timerId;
    },
    setTimeout() {
      timerId += 1;
      return timerId;
    },
    clearInterval() {},
    clearTimeout() {},
  };
  class FakeWebSocket {
    constructor() {
      this.readyState = FakeWebSocket.CONNECTING;
    }

    addEventListener() {}

    close() {}
  }
  FakeWebSocket.CONNECTING = 0;
  FakeWebSocket.OPEN = 1;
  windowObject.WebSocket = FakeWebSocket;

  vm.runInNewContext(script, {
    console,
    document: {
      getElementById(id) {
        return elements.get(id) || null;
      },
      querySelectorAll() {
        return [];
      },
    },
    URL,
    WebSocket: FakeWebSocket,
    window: windowObject,
  });
  await flushBrowserPromises();
  return {
    elements,
    intervals,
    roster,
    rows,
    root,
    window: windowObject,
    flushFrame() {
      const entry = animationFrames.entries().next().value;
      if (!entry) return false;
      animationFrames.delete(entry[0]);
      entry[1](Date.now());
      return true;
    },
    get pendingFrames() {
      return animationFrames.size;
    },
    get reloadCount() {
      return reloadCount;
    },
  };
}

function buildGoldBrowserPayload(displayMode, overrides = {}) {
  const focusedPlayer = {
    id: "player-one",
    lookupIds: ["player-one"],
    name: "ONE",
    status: "alive",
    health: 91,
    kills: 4,
    knockouts: 1,
    utilities: { hasData: false, total: null },
  };
  return {
    ok: true,
    matchId: "match-live",
    workflowState: "MATCH_LIVE",
    goldFocused: {
      focus: focusedPlayer,
      roster: {
        teamId: "team-one",
        teamName: "TEAM ONE",
        teamTag: "ONE",
        kills: 4,
        players: [focusedPlayer],
      },
      playerStats: {
        damage: 450,
        longestEliminationDistanceMeters: 125,
        airdropsLooted: 2,
      },
      playerAssetsVersion: "1:1",
      updatedAt: Date.now(),
      stale: false,
      ...overrides,
    },
    displayMode,
  };
}

test("Gold roster and player stats restart their internal entrance on a replay event", async () => {
  for (const displayMode of ["roster", "player-stats"]) {
    const payload = buildGoldBrowserPayload(displayMode);
    const browser = await runGoldBrowserRuntime({
      bootstrap: {
        displayMode,
        matchId: "match-live",
        localStateUrl: "/obs/gold-focused/state?matchId=match-live",
        widgetKey:
          displayMode === "roster"
            ? "gold-broadcast-focused-roster"
            : "gold-broadcast-player-stats",
      },
      fetchResponse: async () => ({
        ok: true,
        json: async () => payload,
      }),
    });

    assert.equal(browser.root.hidden, false, `${displayMode} has fresh data`);
    assert.equal(browser.root.dataset.goldObsMotion, "preparing");
    assert.equal(browser.pendingFrames, 1);
    browser.flushFrame();
    assert.equal(browser.root.dataset.goldObsMotion, "preparing");
    assert.equal(browser.pendingFrames, 1);
    browser.flushFrame();
    assert.equal(browser.root.dataset.goldObsMotion, "playing");
    assert.equal(browser.pendingFrames, 0);

    browser.window.dispatchEvent({
      type: "arenzyra:gold-obs-replay",
      detail: { reason: "launcher-hotkey-show", reducedMotion: false },
    });
    assert.equal(browser.root.dataset.goldObsMotion, "preparing");
    assert.equal(browser.pendingFrames, 1);
    browser.flushFrame();
    browser.flushFrame();
    assert.equal(browser.root.dataset.goldObsMotion, "playing");

    if (displayMode === "roster") {
      assert.equal(browser.rows[0].hidden, false);
      assert.equal(browser.rows[1].hidden, true);
    }
  }
});

test("Gold focused replay stays pending while data is hidden and starts after recovery", async () => {
  let payload = {
    ok: true,
    matchId: "match-live",
    workflowState: "MATCH_LIVE",
    goldFocused: null,
  };
  const browser = await runGoldBrowserRuntime({
    bootstrap: {
      displayMode: "player-stats",
      matchId: "match-live",
      localStateUrl: "/obs/gold-focused/state?matchId=match-live",
      widgetKey: "gold-broadcast-player-stats",
    },
    fetchResponse: async () => ({
      ok: true,
      json: async () => payload,
    }),
  });

  assert.equal(browser.root.hidden, true);
  assert.equal(browser.pendingFrames, 0);
  browser.window.dispatchEvent({
    type: "arenzyra:gold-obs-replay",
    detail: { reason: "obs-source-visible", reducedMotion: false },
  });
  assert.equal(browser.root.hidden, true);
  assert.equal(browser.pendingFrames, 0, "hidden data cannot animate or flash");

  payload = buildGoldBrowserPayload("player-stats");
  await browser.intervals.get(350)();
  await flushBrowserPromises();

  assert.equal(browser.root.hidden, false);
  assert.equal(browser.root.dataset.goldObsMotion, "preparing");
  assert.equal(browser.pendingFrames, 1);
  browser.flushFrame();
  browser.flushFrame();
  assert.equal(browser.root.dataset.goldObsMotion, "playing");
});

test("Gold focused widgets expose the final frame immediately under reduced motion", async () => {
  const browser = await runGoldBrowserRuntime({
    bootstrap: {
      displayMode: "player-stats",
      matchId: "match-live",
      localStateUrl: "/obs/gold-focused/state?matchId=match-live",
      widgetKey: "gold-broadcast-player-stats",
    },
    reducedMotion: true,
    fetchResponse: async () => ({
      ok: true,
      json: async () => buildGoldBrowserPayload("player-stats"),
    }),
  });

  assert.equal(browser.root.hidden, false);
  assert.equal(browser.root.dataset.goldObsMotion, "reduced");
  assert.equal(browser.pendingFrames, 0);
  browser.window.dispatchEvent({
    type: "arenzyra:gold-obs-replay",
    detail: { reason: "obs-source-visible", reducedMotion: false },
  });
  assert.equal(browser.root.dataset.goldObsMotion, "reduced");
  assert.equal(browser.pendingFrames, 0);
});

test("stale Gold stats fail closed and recover after a fresh same-match snapshot", async () => {
  let payload = {
    ok: true,
    matchId: "match-live",
    workflowState: "MATCH_LIVE",
    goldFocused: {
      focus: { id: "player-one", name: "ONE" },
      updatedAt: Date.now() - 10_000,
      stale: true,
      playerStats: {
        damage: 100,
        longestEliminationDistanceMeters: 50,
        airdropsLooted: 1,
      },
    },
  };
  const browser = await runGoldBrowserRuntime({
    bootstrap: {
      displayMode: "player-stats",
      matchId: "match-live",
      localStateUrl: "/obs/gold-focused/state?matchId=match-live",
      widgetKey: "gold-broadcast-player-stats",
    },
    fetchResponse: async () => ({
      ok: true,
      json: async () => payload,
    }),
  });

  assert.equal(browser.root.dataset.stale, "true");
  assert.equal(browser.root.hidden, true);

  payload = {
    ...payload,
    goldFocused: {
      ...payload.goldFocused,
      updatedAt: Date.now(),
      stale: false,
      playerStats: {
        damage: 450,
        longestEliminationDistanceMeters: 125,
        airdropsLooted: 2,
      },
    },
  };
  await browser.intervals.get(350)();
  await flushBrowserPromises();

  assert.equal(browser.root.dataset.stale, "false");
  assert.equal(browser.root.hidden, false);
  assert.equal(browser.elements.get("gold-stat-damage").textContent, "450");
});

test("match handoff reloads only after the permanent capability context reaches the new match", async () => {
  async function runHandoff(contextMatchId) {
    const calls = [];
    const browser = await runGoldBrowserRuntime({
      bootstrap: {
        brandingRefreshPath: "/obs/widget-context/capability",
        displayMode: "player-stats",
        matchId: "match-old",
        localStateUrl: "/obs/gold-focused/state?matchId=match-old",
        widgetKey: "gold-broadcast-player-stats",
      },
      fetchResponse: async (url) => {
        calls.push(String(url));
        if (String(url).includes("/obs/widget-context/")) {
          return {
            ok: true,
            json: async () => ({
              widgetKey: "gold-broadcast-player-stats",
              matchId: contextMatchId,
              match: { id: contextMatchId },
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            ok: true,
            matchId: "match-new",
            reason: "match changed",
            goldFocused: null,
          }),
        };
      },
    });
    await flushBrowserPromises();
    return { browser, calls };
  }

  const pending = await runHandoff("match-old");
  assert.equal(pending.browser.reloadCount, 0);
  assert.equal(pending.browser.root.hidden, true);
  assert.equal(
    pending.calls.some((url) => url.includes("/obs/widget-context/capability")),
    true,
  );

  const ready = await runHandoff("match-new");
  assert.equal(ready.browser.reloadCount, 1);
  assert.equal(ready.browser.root.hidden, true);
});

test("browser runtime keeps cumulative metrics and clears them only through runtime reset", () => {
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");
  assert.match(script, /metricMaxByPlayer:\s*new Map\(\)/);
  assert.match(script, /Math\.max\(existing, incoming\)/);
  assert.match(script, /message\.type === "runtime_reset"/);
  assert.match(script, /state\.metricMaxByPlayer\.clear\(\)/);
  assert.match(script, /numeric > 0 && numeric < 1e12 \? numeric \* 1000/);
});
