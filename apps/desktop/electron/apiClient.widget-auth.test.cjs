"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { createLauncherApiClient } = require("./apiClient.cjs");

test("widget resolution uses the canonical authenticated request path", async () => {
  const observed = [];
  const server = http.createServer((req, res) => {
    observed.push({
      authorization: req.headers.authorization,
      url: req.url,
    });
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        id: "instance-1",
        widgetKey: "zone-timer",
        capabilityPrefix: "wgt_example1",
        capabilityGeneration: 2,
        capabilityStatus: "ACTIVE",
      }),
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    const apiBase = `http://127.0.0.1:${address.port}`;
    const client = createLauncherApiClient({
      resolveApiBase: (value) => value,
    });

    const resolved = await client.resolveWidgetContext({
      apiBase,
      token: "current-access-token",
      instanceKey: "secret-widget-key",
    });

    assert.equal(resolved.id, "instance-1");
    assert.equal("key" in resolved, false);
    assert.equal("credential" in resolved, false);
    assert.deepEqual(observed, [
      {
        authorization: "Bearer current-access-token",
        url: "/api/widgets/resolve?key=secret-widget-key",
      },
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("widget catalog access uses the canonical authenticated request path", async () => {
  const observed = [];
  const server = http.createServer((req, res) => {
    observed.push({
      authorization: req.headers.authorization,
      url: req.url,
    });
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        organizationId: "org-1",
        organizationSlug: "test-org",
        enforced: true,
        approvals: [],
      }),
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    const apiBase = `http://127.0.0.1:${address.port}`;
    const client = createLauncherApiClient({
      resolveApiBase: (value) => value,
    });

    const catalog = await client.getWidgetAccessList({
      apiBase,
      token: "current-access-token",
      organizationId: "org-1",
    });

    assert.equal(catalog.organizationId, "org-1");
    assert.deepEqual(observed, [
      {
        authorization: "Bearer current-access-token",
        url: "/api/widgets/access-list?organizationId=org-1",
      },
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("production widget server wiring supplies the authenticated resolver", () => {
  const source = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "main.cjs"),
    "utf8",
  );
  assert.match(
    source,
    /resolveWidgetContext:\s*\(\{ instanceKey \}\)\s*=>\s*\{[\s\S]*apiClient\.resolveWidgetContext\(/,
  );
  assert.doesNotMatch(
    source,
    /axios\.(?:get|post)\([\s\S]{0,180}\/api\/widgets\/(?:resolve|instances)/,
  );
  assert.doesNotMatch(source, /resolved\?\.key|ensured\?\.key/);
  assert.match(source, /widgetCapabilityStore\.put\(/);
  assert.match(source, /rotateWidgetCapability/);
  assert.match(
    source,
    /capabilityStatus === "ACTIVE"[\s\S]{0,220}widgetCapabilityStore\.get\(/,
  );
  assert.match(
    source,
    /accessList\s*=\s*await apiClient\.getWidgetAccessList\(\{[\s\S]{0,260}token:\s*session\.token\s*\|\|\s*session\.accessToken,[\s\S]{0,160}refreshToken:\s*session\.refreshToken,[\s\S]{0,160}organizationId,/,
  );
  assert.doesNotMatch(
    source,
    /axios\.get\([^)]*\/api\/widgets\/access-list/,
  );
});
