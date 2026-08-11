const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("source retention is allowlisted, exact, recoverable, and data-volume isolated", () => {
  const entrypoint = read("scripts/production-reviewed-entrypoint.sh");
  const retention = read("scripts/release-production-source-archives.sh");
  const preflight = read("scripts/production-deploy-preflight.sh");

  assert.match(
    entrypoint,
    /source-retention\)[\s\S]*require_nested_assembly[\s\S]*release-production-source-archives\.sh/,
  );
  assert.match(
    entrypoint,
    /source-retention --nested requires retained and superseded release\/Root\/API\/Web groups/,
  );
  assert.match(
    retention,
    /NESTED_IDENTITIES=1[\s\S]*retained_api_commit[\s\S]*verify_archive "\$release" "\$commit" "\$api_commit" "\$web_commit"/,
  );
  assert.match(retention, /verify_archive "\$retained_release" "\$retained_commit"/);
  assert.match(retention, /verify_checkout[\s\S]*HEAD\^\{commit\}/);
  assert.match(retention, /verify_no_mounts/);
  assert.match(
    retention,
    /production-deploy-preflight\.sh --allow-low-disk-source-release[\s\S]*rm -rf -- "\$archive" "\$staging" "\$incoming"/,
  );
  assert.match(preflight, /low_disk_source_release=pass deployment_remains_blocked=true/);
  assert.doesNotMatch(
    retention,
    /arenzyra-backups|docker\s+(?:image|volume|system)|\/var\/lib\/docker|uploads/,
  );
});
