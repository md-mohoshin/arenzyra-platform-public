const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const source = fs.readFileSync(
  path.join(__dirname, "bootstrap-production-reviewed-checkout.sh"),
  "utf8",
);

test("bootstrap uses fixed production roots and two explicit phases", () => {
  assert.match(source, /ROOT_PATH="\/opt\/arenzyra"/);
  assert.match(source, /prepare\).*prepare/);
  assert.match(source, /activate\).*activate/);
  assert.doesNotMatch(source, /rm\s+-rf|docker|compose|systemctl/);
});

test("bootstrap requires the inherited shared deployment lock", () => {
  assert.match(source, /ARENZYRA_DEPLOY_LOCK_INHERITED/);
  assert.match(source, /\/run\/arenzyra-production-deploy\.lock/);
  assert.match(source, /\/proc\/\$\$\/fd\/8/);
  assert.match(source, /file_identity.*descriptor_identity/s);
  assert.match(source, /flock -n 8/);
});

test("bootstrap authenticates bounded archives before extraction", () => {
  assert.match(source, /require_regular_single_link_root_file/);
  assert.match(source, /1073741824/);
  assert.equal((source.match(/sha256sum -c/gu) ?? []).length, 3);
  assert.match(source, /--no-same-owner --no-same-permissions/);
});

test("bootstrap requires exact clean standalone Root API and Web commits", () => {
  assert.match(source, /verify_checkout "\$checkout"/);
  assert.match(source, /verify_checkout "\$checkout\/apps\/api"/);
  assert.match(source, /verify_checkout "\$checkout\/apps\/arenzyra-web"/);
  assert.match(source, /GIT_NO_REPLACE_OBJECTS=1/);
  assert.match(source, /refs\/replace/);
});

test("activation is same-filesystem, preserves old source, and restores on failure", () => {
  assert.match(source, /root_device=.*stat_value '%d'/s);
  assert.match(source, /activation is not an atomic same-filesystem move/);
  assert.match(source, /mv -- "\$ROOT_PATH" "\$archive"/);
  assert.match(source, /mv -- "\$archive" "\$ROOT_PATH" \|\| true/);
  assert.doesNotMatch(source, /Remove-Item|unlink|rmdir/);
});
