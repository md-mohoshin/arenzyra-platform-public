"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  CONNECTOR_TOKEN_HEADER,
  createConnectorHttpAccessPolicy,
  hasAllowedHost,
  isTrustedPcobIngress,
} = require("./connector-http-access-policy.cjs");
const {
  fetchLocalObserverPlayers,
} = require("./widget-server/routes/obs-map-route.cjs");

const token = "0123456789abcdef0123456789abcdef";

function request({
  method = "GET",
  url = "/getallinfo",
  host = "127.0.0.1:10086",
  origin,
  remoteAddress = "127.0.0.1",
  headers = {},
} = {}) {
  return {
    method,
    url,
    originalUrl: url,
    path: new URL(url, "http://pcob.local").pathname,
    headers: {
      host,
      ...(origin === undefined ? {} : { origin }),
      ...headers,
    },
    socket: { remoteAddress },
  };
}

function invoke(policy, req) {
  const result = { headers: {}, next: false, status: null, body: null };
  const response = {
    setHeader(name, value) {
      result.headers[name] = value;
    },
    status(value) {
      result.status = value;
      return this;
    },
    json(value) {
      result.body = value;
      return this;
    },
    end() {
      return this;
    },
  };
  policy.middleware(req, response, () => {
    result.next = true;
  });
  return result;
}

test("connector access rejects remote clients, DNS rebinding hosts, and foreign origins", () => {
  const policy = createConnectorHttpAccessPolicy({ token, port: 10086 });
  assert.equal(
    invoke(policy, request({ remoteAddress: "192.0.2.4" })).status,
    403,
  );
  assert.equal(
    invoke(policy, request({ host: "attacker.example:10086" })).status,
    421,
  );
  assert.equal(
    invoke(policy, request({ origin: "https://attacker.example" })).status,
    403,
  );
  assert.equal(
    invoke(
      policy,
      request({
        origin: "http://127.0.0.1:5510",
        headers: { [CONNECTOR_TOKEN_HEADER]: token },
      }),
    ).status,
    403,
  );
  assert.equal(hasAllowedHost(request(), 10086), true);
  assert.equal(hasAllowedHost(request({ host: "localhost:9999" }), 10086), false);
  assert.equal(invoke(policy, request({ origin: "null" })).status, 403);
});

test("telemetry reads accept only the dedicated connector header capability", () => {
  const policy = createConnectorHttpAccessPolicy({ token, port: 10086 });
  assert.equal(invoke(policy, request()).status, 401);
  assert.equal(
    invoke(policy, request({ url: "/health" })).status,
    401,
  );
  assert.equal(
    invoke(
      policy,
      request({ headers: { [CONNECTOR_TOKEN_HEADER]: token } }),
    ).next,
    true,
  );
  for (const candidate of [
    request({ headers: { "x-arenzyra-local-token": token } }),
    request({ headers: { "x-arenzyra-widget-token": token } }),
    request({ headers: { cookie: `ArenzyraWidgetAccess=${token}` } }),
    request({ headers: { cookie: `ArenzyraPcobAccess=${token}` } }),
    request({ url: `/getallinfo?access_token=${token}` }),
  ]) {
    assert.equal(invoke(policy, candidate).status, 401);
  }
});

test("only loopback no-origin native PCOB telemetry shapes bypass the capability", () => {
  const policy = createConnectorHttpAccessPolicy({ token, port: 10086 });
  const nativeRequest = request({ method: "POST", url: "/setkillinfo" });
  assert.equal(isTrustedPcobIngress(nativeRequest), true);
  assert.equal(invoke(policy, nativeRequest).next, true);

  const browserRequest = request({
    method: "POST",
    url: "/setkillinfo",
    origin: "http://127.0.0.1:5510",
  });
  assert.equal(isTrustedPcobIngress(browserRequest), false);
  assert.equal(invoke(policy, browserRequest).status, 403);

  const arbitraryInjection = request({ method: "POST", url: "/inject-anything" });
  assert.equal(isTrustedPcobIngress(arbitraryInjection), false);
  assert.equal(invoke(policy, arbitraryInjection).status, 401);
});

test("browser CORS is fail closed and never emits credentialed CORS headers", () => {
  const policy = createConnectorHttpAccessPolicy({ token, port: 10086 });
  const result = invoke(
    policy,
    request({
      method: "OPTIONS",
      origin: "http://localhost:5510",
    }),
  );
  assert.equal(result.status, 403);
  assert.equal(result.headers["Access-Control-Allow-Origin"], undefined);
  assert.equal(result.headers["Access-Control-Allow-Credentials"], undefined);
  const noOriginPreflight = invoke(policy, request({ method: "OPTIONS" }));
  assert.equal(noOriginPreflight.status, 403);
  assert.equal(noOriginPreflight.headers["Access-Control-Allow-Origin"], undefined);
});

test("widget vehicle fallback is a server-side connector-token proxy", async () => {
  const calls = [];
  const payload = await fetchLocalObserverPlayers(
    "http://127.0.0.1:10086",
    token,
    {
      async get(url, options) {
        calls.push({ url, options });
        return { status: 200, data: { playerInfoList: [{ id: "p1" }] } };
      },
    },
  );
  assert.deepEqual(payload, { playerInfoList: [{ id: "p1" }] });
  assert.equal(calls[0].url, "http://127.0.0.1:10086/gettotalplayerlist");
  assert.deepEqual(calls[0].options.headers, {
    "X-Arenzyra-Connector-Token": token,
  });
  await assert.rejects(
    () =>
      fetchLocalObserverPlayers("http://127.0.0.1:10086", "", {
        get() {
          throw new Error("must not run");
        },
      }),
    /capability is unavailable/,
  );
  await assert.rejects(
    () =>
      fetchLocalObserverPlayers("https://attacker.example", token, {
        get() {
          throw new Error("must not run");
        },
      }),
    /must be loopback HTTP/,
  );
});

test("packaged and installed connectors carry the access policy and no wildcard catch-all", () => {
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  const connectorSource = fs.readFileSync(path.join(repoRoot, "ob.js"), "utf8");
  const launcherSource = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const telemetrySource = fs.readFileSync(
    path.join(__dirname, "telemetryBridge.cjs"),
    "utf8",
  );
  const pollerSource = fs.readFileSync(
    path.join(__dirname, "widget-server", "direct-observer-snapshot-poller.cjs"),
    "utf8",
  );
  const playerPhotoSource = fs.readFileSync(
    path.join(__dirname, "widget-server", "routes", "obs-player-photo-route.cjs"),
    "utf8",
  );
  const mapWidgetSource = fs.readFileSync(
    path.join(__dirname, "widget-server", "public", "obs-map-widget.js"),
    "utf8",
  );
  const builderConfig = require(
    path.join(__dirname, "..", "electron-builder.config.cjs"),
  );
  assert.match(connectorSource, /app\.use\(connectorAccessPolicy\.middleware\)/);
  assert.doesNotMatch(
    connectorSource,
    /Access-Control-Allow-Origin["'],\s*["']\*["']/,
  );
  assert.doesNotMatch(connectorSource, /app\.post\(\/\^\\\/\.\*\//);
  assert.match(launcherSource, /"connector-http-access-policy\.cjs"/);
  assert.match(launcherSource, /getShadowAccessToken/);
  assert.match(telemetrySource, /X-Arenzyra-Connector-Token/);
  assert.match(pollerSource, /X-Arenzyra-Connector-Token/);
  assert.match(playerPhotoSource, /X-Arenzyra-Connector-Token/);
  assert.doesNotMatch(connectorSource, /x-arenzyra-widget-token/i);
  assert.doesNotMatch(connectorSource, /ArenzyraWidgetAccess/);
  assert.doesNotMatch(connectorSource, /Access-Control-Allow-Credentials/);
  assert.doesNotMatch(mapWidgetSource, /127\.0\.0\.1:10086|gettotalplayerlist/);
  assert.doesNotMatch(mapWidgetSource, /X-Arenzyra-(?:Connector|Widget)-Token/);
  assert.match(mapWidgetSource, /\/obs\/map\/vehicle-players/);
  assert.match(launcherSource, /const widgetAccessToken =/);
  assert.match(launcherSource, /const connectorAccessToken =/);
  assert.match(launcherSource, /connectorAccessToken === widgetAccessToken/);
  assert.doesNotMatch(
    launcherSource,
    /localControlToken[\s\S]{0,120}widgetAccessToken/,
  );
  assert.equal(
    builderConfig.extraResources.some(
      (entry) => entry.to === "connectors/connector-http-access-policy.cjs",
    ),
    true,
  );
});
