"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const caddyfile = fs.readFileSync(
  path.resolve(__dirname, "..", "infra", "Caddyfile"),
  "utf8",
);

test("PCOB body allowance is route-scoped and standard API requests stay bounded", () => {
  assert.match(
    caddyfile,
    /@pcob_ingest path \/pcob\/telemetry\* \/api\/observer\/telemetry\*/,
  );
  assert.match(caddyfile, /request_body @pcob_ingest\s*{\s*max_size 17MB\s*}/);
  assert.match(
    caddyfile,
    /@standard_api_body not path \/pcob\/telemetry\* \/api\/observer\/telemetry\*/,
  );
  assert.match(caddyfile, /request_body @standard_api_body\s*{\s*max_size 10MB\s*}/);
});

test("access logging remains disabled until credential redaction is configured", () => {
  assert.doesNotMatch(
    caddyfile,
    /^\s*log\s*(?:\{|$)/m,
    "Enabling Caddy access logs requires redaction of authorization, cookies, and token/signature/key query parameters plus bounded retention.",
  );
});
