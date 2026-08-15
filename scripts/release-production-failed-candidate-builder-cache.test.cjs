"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");
const read = (relative) =>
  fs.readFileSync(path.join(repositoryRoot, relative), "utf8");
const release = read(
  "scripts/release-production-failed-candidate-builder-cache.sh",
);
const dispatcher = read("scripts/production-reviewed-entrypoint.sh");
const preflight = read("scripts/production-deploy-preflight.sh");
const metadata = read("scripts/create-publish-release-metadata.cjs");
const runtimeVerifierSource = read(
  "scripts/verify-production-builder-cache-runtime.cjs",
);
const {
  selectReserveFlag,
} = require("./select-production-builder-prune-reserve-flag.cjs");
const {
  IMAGE_OPTIONS,
  SERVICES,
  parseArguments,
  verifyRuntimeInventory,
} = require("./verify-production-builder-cache-runtime.cjs");

const releaseId = "git-20260814-010203004-aaaaaaaaaaaa";
const project = "infra";
const imageIds = Object.fromEntries(
  Object.keys(IMAGE_OPTIONS).map((service, index) => [
    service,
    `sha256:${(index + 8).toString(16).repeat(64)}`,
  ]),
);
const runtimeArguments = [
  "--compose-project",
  project,
  "--current-release",
  releaseId,
  "--api-image-id",
  imageIds.api,
  "--web-image-id",
  imageIds.web,
  "--media-ai-image-id",
  imageIds["media-ai"],
  "--discord-bot-image-id",
  imageIds["discord-bot"],
];
const runtimeOptions = parseArguments(runtimeArguments);

function runtimeRows(overrides = {}) {
  return `${SERVICES.map((service, index) => {
    const application = Object.hasOwn(IMAGE_OPTIONS, service);
    const values = {
      containerId: (index + 1).toString(16).repeat(64),
      imageId: application
        ? imageIds[service]
        : `sha256:${(index + 1).toString(16).repeat(64)}`,
      project,
      service,
      oneoff: "False",
      status: "running",
      health: "healthy",
      restarting: "false",
      restartCount: String(index),
      restartPolicy: "unless-stopped",
      releaseId: application ? releaseId : "",
      ...(overrides[service] ?? {}),
    };
    return [
      values.containerId,
      values.imageId,
      values.project,
      values.service,
      values.oneoff,
      values.status,
      values.health,
      values.restarting,
      values.restartCount,
      values.restartPolicy,
      values.releaseId,
    ].join("|");
  }).join("\n")}\n`;
}

test("reserve flag selection accepts only reserve-floor spellings", () => {
  assert.equal(
    selectReserveFlag("Options:\n      --reserved-space bytes   Minimum cache retained\n"),
    "--reserved-space",
  );
  assert.equal(
    selectReserveFlag("Options:\n      --keep-storage bytes   Amount retained\n"),
    "--keep-storage",
  );
  assert.equal(
    selectReserveFlag(
      "  --keep-storage bytes\n  --reserved-space bytes\n  --max-used-space bytes\n",
    ),
    "--reserved-space",
  );
  assert.throws(
    () => selectReserveFlag("  --max-used-space bytes\n"),
    /no reviewed builder-cache reserve flag/,
  );
  assert.throws(
    () => selectReserveFlag("text mentions --reserved-space but is not an option\n"),
    /no reviewed builder-cache reserve flag/,
  );
});

test("reserve flag CLI rejects arguments, invalid UTF-8, and unbounded help", () => {
  const executable = path.join(
    __dirname,
    "select-production-builder-prune-reserve-flag.cjs",
  );
  for (const invocation of [
    { args: ["unexpected"], input: "  --reserved-space bytes\n" },
    { args: [], input: Buffer.from([0xff]) },
    { args: [], input: Buffer.alloc(256 * 1024 + 1, 0x61) },
  ]) {
    const result = spawnSync(process.execPath, [executable, ...invocation.args], {
      input: invocation.input,
      encoding: "utf8",
    });
    assert.equal(result.status, 75);
    assert.match(result.stderr, /BUILDER PRUNE FLAG BLOCKED/);
  }
});

test("runtime verifier canonicalizes exactly seven healthy current-release services", () => {
  const fingerprint = verifyRuntimeInventory(runtimeRows(), runtimeOptions);
  assert.equal(fingerprint.split("\n").length, 7);
  assert.match(fingerprint, /^proxy\|[0-9a-f]{64}\|sha256:/);
  assert.match(fingerprint, /discord-bot\|[0-9a-f]{64}\|sha256:[0-9a-f]{64}\|restart-count=6$/);
});

test("runtime verifier fails closed on every topology and drift boundary", () => {
  const invalidInventories = [
    runtimeRows().split("\n").slice(0, -2).join("\n") + "\n",
    runtimeRows({ proxy: { service: "api" } }),
    runtimeRows({ proxy: { oneoff: "True" } }),
    runtimeRows({ postgres: { health: "unhealthy" } }),
    runtimeRows({ redis: { status: "restarting" } }),
    runtimeRows({ api: { imageId: `sha256:${"f".repeat(64)}` } }),
    runtimeRows({ web: { releaseId: "" } }),
    runtimeRows({ "media-ai": { project: "other" } }),
    runtimeRows({ "discord-bot": { restarting: "true" } }),
    runtimeRows({ api: { restartPolicy: "always" } }),
    runtimeRows({ proxy: { releaseId } }),
  ];
  for (const inventory of invalidInventories) {
    assert.throws(() => verifyRuntimeInventory(inventory, runtimeOptions));
  }
  assert.throws(
    () => parseArguments([...runtimeArguments, "--unknown", "value"]),
    /Unknown option/,
  );
  assert.throws(
    () => parseArguments(runtimeArguments.slice(0, -2)),
    /closed runtime-verifier option set/,
  );
});

test("one-time release is exactly candidate-bound and continuously attested", () => {
  assert.match(
    release,
    /FAILED_CANDIDATE_RELEASE="git-20260815-113203955-8da6acb623a6"/,
  );
  assert.match(
    release,
    /FAILED_CANDIDATE_ROOT="38ef097f5a542fa9685cd867001e337a884c3d0f"/,
  );
  assert.match(
    release,
    /EXPECTED_CURRENT_RELEASE="git-20260814-192205642-e04672c95be2"/,
  );
  assert.match(
    release,
    /EXPECTED_CURRENT_API="88efdad94d65c09c6d3bd73e4b874db915629859"/,
  );
  assert.match(
    release,
    /EXPECTED_CURRENT_WEB="3d2cca1dd4267a7cb0e8b54a98ae4fbbee1289d4"/,
  );
  assert.match(release, /\[ "\$#" -eq 0 \]/);
  const lock = release.indexOf("source scripts/acquire-production-deploy-lock.sh");
  const firstPreflight = release.indexOf("--allow-low-disk-builder-cache-release");
  const baseline = release.indexOf('baseline_current="$(current_snapshot)"');
  const prune = release.indexOf('docker builder prune -af "$reserve_flag" "0B"');
  const ordinaryPreflight = release.lastIndexOf(
    "/bin/bash scripts/production-deploy-preflight.sh",
  );
  const finalSnapshot = release.lastIndexOf(
    'if ! final_current="$(current_snapshot)"',
  );
  assert.ok(
    lock >= 0 &&
      lock < firstPreflight &&
      firstPreflight < baseline &&
      baseline < prune &&
      prune < ordinaryPreflight &&
      ordinaryPreflight < finalSnapshot,
  );
  assert.match(release, /root_parent" = "\$FAILED_CANDIDATE_ROOT/);
  assert.match(
    release,
    /current_release" = "\$EXPECTED_CURRENT_RELEASE"[\s\S]*CURRENT is not the exact pre-candidate production release/,
  );
  assert.match(release, /verify_repository ROOT[\s\S]*verify_repository API[\s\S]*verify_repository WEB/);
  assert.match(release, /--porcelain=v1 --untracked-files=all --ignore-submodules=none/);
  assert.match(release, /exactly seven containers[\s\S]*current_snapshot/);
  assert.match(release, /candidate_snapshot[\s\S]*FAILED_CANDIDATE_ROOT/);
  assert.match(release, /\[ "\$before_free_kib" -lt "\$MIN_FREE_KIB" \]/);
  assert.match(release, /\[ "\$after_free_kib" -ge "\$MIN_FREE_KIB" \]/);
  assert.match(release, /\[ "\$final_free_kib" -ge "\$MIN_FREE_KIB" \]/);
});

test("candidate image evidence is regenerated before and after the sole mutation", () => {
  assert.match(release, /0:0:600:1/);
  assert.match(release, /validate-publish-release-env\.cjs/);
  assert.match(
    release,
    /ARENZYRA_ROOT_GIT_COMMIT[\s\S]*ARENZYRA_API_GIT_COMMIT[\s\S]*ARENZYRA_WEB_GIT_COMMIT/,
  );
  for (const service of ["api", "web", "media-ai"]) {
    assert.match(
      release,
      new RegExp(`verify_image_manifest \"\\$FAILED_CANDIDATE_RELEASE\" \"\\$candidate_env\" ${service}`),
    );
  }
  assert.match(
    release,
    /docker image inspect "\$image_id"[\s\S]*--from-docker-inspect[\s\S]*cmp -s - "\$manifest"/,
  );
  assert.equal(
    (release.match(/docker builder prune -af "\$reserve_flag" "0B"/g) ?? []).length,
    1,
  );
  assert.match(release, /--reserved-space\|--keep-storage/);
  assert.doesNotMatch(release, /--max-used-space/);
});

test("every nested immutable capture propagates failure before printing a snapshot", () => {
  for (const capture of [
    "assembly",
    "current_env",
    "runtime",
    "candidate_env",
    "baseline_current",
    "baseline_candidate",
    "pre_prune_current",
    "pre_prune_candidate",
    "post_prune_current",
    "post_prune_candidate",
    "final_current",
    "final_candidate",
  ]) {
    assert.match(
      release,
      new RegExp(`if ! ${capture}=\"\\$\\(`),
      `${capture} must be captured in an explicit failure condition`,
    );
  }
  assert.match(
    release,
    /env_hash[\s\S]*\^\[0-9a-f\]\{64\}\$[\s\S]*env_identity[\s\S]*0:0:600:1/,
  );
  assert.match(
    release,
    /current_env_hash[\s\S]*pointer_hash[\s\S]*current release metadata fingerprint is invalid/,
  );
  assert.match(
    release,
    /candidate_env_identity[\s\S]*failed-candidate environment fingerprint is invalid/,
  );
  assert.doesNotMatch(
    release,
    /^(?!\s*if ! )(?:baseline_current|baseline_candidate|assembly|current_env|runtime|candidate_env)=\"\$\(/m,
  );
});

test("one-time script contains no broader production mutator", () => {
  assert.doesNotMatch(
    release,
    /docker\s+(?:system|image|container|volume|network)\s+prune|docker\s+(?:rm|rmi|stop|start|restart|kill|pull|build)(?:\s|$)|docker\s+compose|\b(?:rm|mv|cp|install|chmod|chown|truncate|tee)\s/,
  );
  assert.doesNotMatch(
    release,
    /psql|prisma|pg_dump|redis-cli|arenzyra-backups|journalctl|\/var\/log/,
  );
  assert.doesNotMatch(release, /docker[^\n]*(?:\|\| true)/);
  assert.match(release, /production Compose container enumeration failed/);
  assert.match(release, /runtime container inspection failed/);
  assert.match(release, /Docker builder-prune help inspection failed/);
  assert.match(release, /production_verify_lock_descriptor/g);
  assert.match(release, /publish-env\|identity=/);
  assert.match(release, /current-pointer\|identity=/);
  assert.match(release, /\.RestartCount/);
  assert.match(runtimeVerifierSource, /restart-count=/);
});

test("dispatcher closes arguments, locks, repeats nested trust, and execs only the one-time wrapper", () => {
  const start = dispatcher.indexOf("  failed-candidate-builder-cache-release)");
  const end = dispatcher.indexOf("  failed-candidate-remove)", start);
  const branch = dispatcher.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(branch, /\[ "\$#" -eq 0 \]/);
  const lock = branch.indexOf("source scripts/acquire-production-deploy-lock.sh");
  const descriptor = branch.indexOf("production_verify_lock_descriptor", lock);
  const root = branch.indexOf("verify_repository ROOT", descriptor);
  const nested = branch.indexOf("require_nested_assembly", root);
  const execute = branch.indexOf(
    "exec /bin/bash scripts/release-production-failed-candidate-builder-cache.sh",
    nested,
  );
  assert.ok(lock >= 0 && lock < descriptor && descriptor < root && root < nested && nested < execute);
  assert.doesNotMatch(branch, /"\$@"|"\$1"/);
});

test("preflight exception requires low disk while preserving ordinary health and volume gates", () => {
  assert.match(preflight, /--allow-low-disk-builder-cache-release/);
  assert.match(
    preflight,
    /ALLOW_LOW_DISK_BUILDER_CACHE_RELEASE[\s\S]*available_kib" -ge "\$required_kib"[\s\S]*BUILDER CACHE RELEASE IS NOT REQUIRED/,
  );
  assert.match(preflight, /verify-production-api-data-volumes\.sh/);
  assert.doesNotMatch(
    preflight,
    /--allow-low-disk-builder-cache-release[\s\S]{0,500}SKIP_HEALTH=1/,
  );
});

test("source release metadata packages the entire committed scripts tree", () => {
  assert.match(metadata, /defaultIncludedPaths[\s\S]*"scripts"/);
  for (const file of [
    "scripts/release-production-failed-candidate-builder-cache.sh",
    "scripts/select-production-builder-prune-reserve-flag.cjs",
    "scripts/verify-production-builder-cache-runtime.cjs",
  ]) {
    assert.equal(fs.existsSync(path.join(repositoryRoot, file)), true);
  }
});
