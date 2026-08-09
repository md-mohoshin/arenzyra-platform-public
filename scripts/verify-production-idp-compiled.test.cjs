"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const helper = fs.readFileSync(
  path.join(root, "scripts", "verify-production-idp-compiled.sh"),
  "utf8",
);

test("compiled IDP helper accepts only inherited immutable identities", () => {
  assert.match(helper, /\[ "\$#" -eq 0 \]/);
  assert.match(helper, /ARENZYRA_DEPLOY_LOCK_INHERITED/);
  assert.match(helper, /\/proc\/\$\$\/fd\/8/);
  assert.match(helper, /OVERRIDE_FD=10/);
  assert.match(helper, /\/proc\/\$\$\/fd\/\$OVERRIDE_FD/);
  assert.match(helper, /--mode idp-maintenance --api-image-id/);
  assert.match(helper, /validate-release-image-manifest\.cjs/);
  assert.match(helper, /verify-production-release-source\.cjs --release-env/);
  assert.match(helper, /verify-production-database-container\.sh/);
  assert.match(helper, /pg_catalog\.pg_control_system\(\)/);
  assert.match(helper, /actual_physical_identity.*expected_database_oid/s);
});

test("compiled IDP helper runs one exact read-only image command and parser", () => {
  assert.match(
    helper,
    /--profile maintenance run --rm --no-deps --pull never -T[\s\S]*api-maintenance-idp-dry-run/,
  );
  assert.match(
    helper,
    /verify-idp-maintenance-summary\.cjs[\s\\]*--require-clean/,
  );
  assert.match(helper, /--assert-compose-json/);
  assert.doesNotMatch(helper, /api-maintenance-(?:youtube|idp-apply|idp-validate)/i);
  assert.doesNotMatch(
    helper,
    /docker\s+(?:build|pull)|docker\s+compose[\s\S]{0,80}\b(?:up|restart|stop|rm)\b/,
  );
});
