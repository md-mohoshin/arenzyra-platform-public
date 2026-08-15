"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");
const read = (relative) =>
  fs.readFileSync(path.join(repositoryRoot, relative), "utf8");
const inventory = read("scripts/production-interrupted-deploy-inventory.sh");
const dispatcher = read("scripts/production-reviewed-entrypoint.sh");
const metadata = read("scripts/create-publish-release-metadata.cjs");
const publishGuide = read("infra/PUBLISH.md");

test("interrupted deploy inventory is one-time, source-bound, and window-bound", () => {
  for (const expected of [
    'EXPECTED_PREVIOUS_ROOT="d6390f2abb37f87e99988c49db31216c6187ffe1"',
    'EXPECTED_API="88efdad94d65c09c6d3bd73e4b874db915629859"',
    'EXPECTED_WEB="3d2cca1dd4267a7cb0e8b54a98ae4fbbee1289d4"',
    'EXPECTED_CURRENT_RELEASE="git-20260814-192205642-e04672c95be2"',
    'EXPECTED_CANDIDATE_ROOT="d6390f2abb37"',
    'EXPECTED_CANDIDATE_API="88efdad94d65"',
    'EXPECTED_CANDIDATE_WEB="3d2cca1dd426"',
    'CANDIDATE_WINDOW_START="2026-08-15T13:00:00.000Z"',
    'CANDIDATE_WINDOW_END="2026-08-15T14:00:00.000Z"',
  ]) {
    assert.ok(inventory.includes(expected), expected);
  }
  assert.match(
    inventory,
    /git-20260815-13\[0-5\]\[0-9\]\[0-5\]\[0-9\]\[0-9\]\{3\}/,
  );
  assert.match(inventory, /MAX_ARCHIVED_RELEASE_ENVS=4096/);
  assert.match(inventory, /MAX_WINDOW_RELEASES=32/);
  assert.match(inventory, /MAX_EXACT_CANDIDATES=8/);
  assert.match(
    inventory,
    /root_parent" = "\$EXPECTED_PREVIOUS_ROOT"[\s\S]*api_head" = "\$EXPECTED_API"[\s\S]*web_head" = "\$EXPECTED_WEB"/,
  );
});

test("dispatcher acquires the shared lock before the nested read-only inventory", () => {
  const branch = dispatcher.slice(
    dispatcher.indexOf("  interrupted-deploy-inventory)"),
    dispatcher.indexOf("  source-activate)"),
  );
  assert.match(branch, /"\$#" -eq 0/);
  const acquire = branch.indexOf("source scripts/acquire-production-deploy-lock.sh");
  const verifyLock = branch.indexOf("production_verify_lock_descriptor");
  const root = branch.indexOf('verify_repository ROOT "$EXPECTED_ROOT"');
  const nested = branch.indexOf("require_nested_assembly");
  const exec = branch.indexOf("production-interrupted-deploy-inventory.sh");
  assert.ok(
    acquire >= 0 &&
      acquire < verifyLock &&
      verifyLock < root &&
      root < nested &&
      nested < exec,
  );
});

test("candidate evidence is bounded, metadata-only, and image-regenerated", () => {
  assert.match(inventory, /all_envs=\("\$RELEASE_ROOT"\/git-\*\.env\)/);
  assert.match(
    inventory,
    /validate-publish-release-env\.cjs[\s\S]*--expected-release "\$release_id"/,
  );
  assert.match(
    inventory,
    /ARENZYRA_ROOT_GIT_COMMIT[\s\S]*ARENZYRA_API_GIT_COMMIT[\s\S]*ARENZYRA_WEB_GIT_COMMIT/,
  );
  assert.match(inventory, /for service in api web media-ai/);
  assert.match(
    inventory,
    /validate-release-image-manifest\.cjs[\s\S]*--print-image-id/,
  );
  assert.match(
    inventory,
    /docker image inspect "\$image_id"[\s\S]*--from-docker-inspect[\s\S]*cmp -s - "\$manifest"/,
  );
  assert.match(
    inventory,
    /state=metadata-only|readiness=metadata-only/,
  );
  assert.match(inventory, /readiness=immutable-build-complete/);
  assert.match(inventory, /readiness=incomplete/);
});

test("pointer, free-space, and candidate outputs expose identities but no contents", () => {
  assert.match(inventory, /df -Pk -- \/[\s\S]*root-free-kib-before=/);
  assert.match(
    inventory,
    /pointer_snapshot CURRENT "\$EXPECTED_CURRENT_RELEASE"[\s\S]*pointer_snapshot PREVIOUS/,
  );
  assert.match(
    inventory,
    /POINTER name=%s state=present release=%s identity=%s sha256=%s env-identity=%s env-sha256=%s/,
  );
  assert.match(inventory, /PUBLISH_ENV identity=%s sha256=%s/);
  assert.match(
    inventory,
    /CANDIDATE release=%s env-identity=%s env-sha256=%s/,
  );
  assert.doesNotMatch(
    inventory,
    /printf[^\n]*(?:ARENZYRA_|PUBLISH_ENV).*%s[^\n]*(?:value|contents?)/i,
  );
});

test("runtime inventory is fixed to the observed seven healthy images", () => {
  for (const [name, image] of [
    ["API", "sha256:518ce5d035c9f6ebbd100ff570981cffa822484fa1971ec8649f808134095d9c"],
    ["MEDIA", "sha256:9863f4cfa9defef7cfe7caf018c83bc277712df3c41fcc8baead1af2cbc0ec5f"],
    ["WEB", "sha256:23cfef8c359a60379d18d6736d2067c7c2a9a2bc82e08e1c37a6e53ac4745923"],
    ["DISCORD", "sha256:e2db68104d3cf5a4f3ce543853b81725135b14a0f40f0246179b8e59bc88b0df"],
  ]) {
    assert.match(
      inventory,
      new RegExp(`EXPECTED_RUNTIME_${name}_IMAGE="${image}"`),
    );
  }
  assert.match(inventory, /\$\{#container_ids\[@\]\}" -eq 7/);
  assert.match(
    inventory,
    /verify-production-builder-cache-runtime\.cjs[\s\S]*--api-image-id[\s\S]*--media-ai-image-id[\s\S]*--web-image-id[\s\S]*--discord-bot-image-id/,
  );
  assert.match(
    inventory,
    /RUNTIME %s health=healthy restarting=false restart-policy=unless-stopped/,
  );
});

test("evidence and runtime are re-read and must remain identical", () => {
  for (const capture of [
    "free_before",
    "evidence_before",
    "runtime_before",
    "evidence_after",
    "runtime_after",
    "free_after",
  ]) {
    assert.match(inventory, new RegExp(`! ${capture}="\\$\\(`));
  }
  assert.match(
    inventory,
    /evidence_before" = "\$evidence_after"[\s\S]*runtime_before" = "\$runtime_after"/,
  );
  assert.match(
    inventory,
    /production_verify_lock_descriptor[\s\S]*evidence_before[\s\S]*production_verify_lock_descriptor/,
  );
});

test("diagnostic contains no production mutation interface", () => {
  assert.doesNotMatch(
    inventory,
    /docker\s+(?:build|pull|push|start|stop|restart|kill|rm|rmi|compose|system|builder|volume|network)\b/,
  );
  assert.doesNotMatch(
    inventory,
    /\b(?:rm|mv|cp|chmod|chown|install|mkdir|rmdir|touch|truncate|tee|dd)\s/,
  );
  assert.doesNotMatch(
    inventory,
    /psql|prisma|pg_dump|redis-cli|journalctl|\/var\/log|arenzyra-backups/,
  );
  assert.doesNotMatch(inventory, /\|\| true/);
  assert.match(inventory, /INTERRUPTED_DEPLOY_INVENTORY_COMPLETE mutation=none/);
});

test("runbook blocks blind rerun and documents the closed diagnostic", () => {
  assert.match(publishGuide, /Interrupted full-deploy inventory/);
  assert.match(
    publishGuide,
    /Do not\s+blindly rerun `production_entry deploy`/,
  );
  assert.match(
    publishGuide,
    /production_entry interrupted-deploy-inventory/,
  );
  assert.match(
    publishGuide,
    /2026-08-15T13:00:00Z[\s\S]*2026-08-15T14:00:00Z/,
  );
  assert.match(
    publishGuide,
    /reads no logs,[\s\S]*performs no filesystem, Docker, service, database, pointer, or metadata write/,
  );
  assert.match(metadata, /"scripts"/);
});
