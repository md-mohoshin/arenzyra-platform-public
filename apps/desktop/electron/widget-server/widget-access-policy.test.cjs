"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ACCESS_COOKIE,
  createWidgetAccessPolicy,
} = require("./widget-access-policy.cjs");

const token = "0123456789abcdef0123456789abcdef";

function request(url, headers = {}) {
  return { url, headers: { host: "localhost:5510", ...headers } };
}

test("widget access requires a capability and rejects cross-origin browser requests", () => {
  const policy = createWidgetAccessPolicy({ token });
  assert.equal(policy.authorizeRequest(request("/ws")), false);
  assert.equal(policy.authorizeRequest(request(`/ws?access_token=${token}`)), true);
  assert.equal(
    policy.authorizeRequest(
      request(`/ws?access_token=${token}`, { origin: "https://example.test" }),
    ),
    false,
  );
});

test("same-origin websocket cookie is accepted", () => {
  const policy = createWidgetAccessPolicy({ token });
  assert.equal(
    policy.authorizeRequest(
      request("/ws", {
        origin: "http://localhost:5510",
        cookie: `${ACCESS_COOKIE}=${token}`,
      }),
    ),
    true,
  );
});

test("authorized URL does not expose a token when policy is disabled", () => {
  assert.equal(
    createWidgetAccessPolicy().authorizeUrl("http://localhost:5510"),
    "http://localhost:5510",
  );
  assert.match(
    createWidgetAccessPolicy({ token }).authorizeUrl("http://localhost:5510"),
    /access_token=/,
  );
});
