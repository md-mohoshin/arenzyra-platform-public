"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(repositoryRoot, relative), "utf8");
const wrapper = read("scripts/resume-production-interrupted-full-deploy.sh");
const deploy = read("scripts/deploy-production.sh");
const dispatcher = read("scripts/production-reviewed-entrypoint.sh");
const metadata = read("scripts/create-publish-release-metadata.cjs");
const parserPath = path.join(repositoryRoot, "scripts/verify-interrupted-full-resume-inventory.cjs");
const parser = require(parserPath);

const candidateImages = {
  api: "sha256:a895c29c1398c0398b6a9fccf54a50aad8c62a6804fc154b12eb3f5a2ec55cde",
  web: "sha256:1513170fcd1fdf73481474833737ff61884dc64b0e683720f670a3994299dba1",
  "media-ai": "sha256:c918e11e7b0b400dbf4e75092e64408c3c444768c5b7d141bcefa72f5a959b33",
};
const candidateRelease = "git-20260815-131200234-84099e4622e9";

function exactInventoryFixture() {
  const lines = [
    "INTERRUPTED_DEPLOY_INVENTORY root-free-kib-before=25041116 root-free-kib-after=25041116",
    `SOURCE root=${"b".repeat(40)} api=${parser.API_COMMIT} web=${parser.WEB_COMMIT}`,
    "POINTER name=CURRENT state=present release=git-20260814-192205642-e04672c95be2 identity=2049:9839382:0:0:600:1:36:1786735360 sha256=7d0e4bf965799e9a5b223e17671e7808cc322a0d7809b9a4356b093cbb8ae8db env-identity=2049:9839398:0:0:600:1:3624:1786735326 env-sha256=2032cbe2ce82366b2ea52fc56857ac056183ab321c9c0f1b4eac639251dfbd7d",
    "POINTER name=PREVIOUS state=present release=git-20260814-144159610-0487ee73b42b identity=2049:9839400:0:0:600:1:36:1786735360 sha256=7677a7e1ae454478eac14cceb152c44d6124707d8f5b7f46bbadf3ddb1160451 env-identity=2049:9839380:0:0:600:1:3624:1786718520 env-sha256=7204f01f0f5d5617806d9fb4e6d0c85b9e1e9b128f3e453adb7096d2868dadc3",
    "PUBLISH_ENV identity=2049:11408004:0:0:600:1:10330:1786803978 sha256=b67321587a29effe5be41acf8900c37026f961a4b99e7e4755978360d5c2e688",
    "CANDIDATE_WINDOW start=2026-08-15T13:00:00.000Z end=2026-08-15T14:00:00.000Z matching=1 other=0",
    "CANDIDATE release=git-20260815-131200234-84099e4622e9 env-identity=2049:9839406:0:0:600:1:3624:1786799521 env-sha256=3746d6736a025b9138aab01c0838a6225ded0205175bb2ea979d9e436aa8b47b",
    "CANDIDATE_MANIFEST release=git-20260815-131200234-84099e4622e9 service=api state=present identity=2049:9839407:0:0:600:1:737:1786799712 sha256=a33ff91db207401f33a4c0339d632129a03452b90d7bd171c5913f9855d6288c image=sha256:a895c29c1398c0398b6a9fccf54a50aad8c62a6804fc154b12eb3f5a2ec55cde available=1 regenerated=1",
    "CANDIDATE_MANIFEST release=git-20260815-131200234-84099e4622e9 service=web state=present identity=2049:9839408:0:0:600:1:737:1786799712 sha256=a14eb7cd7cd651e9798c9c21308530b7c8cab6e65546bd2ded038f6a2a6bfadd image=sha256:1513170fcd1fdf73481474833737ff61884dc64b0e683720f670a3994299dba1 available=1 regenerated=1",
    "CANDIDATE_MANIFEST release=git-20260815-131200234-84099e4622e9 service=media-ai state=present identity=2049:9839409:0:0:600:1:747:1786799713 sha256=af744723b8bbc92b89444b1e5b6eaeca2a81652989d23f8c64a720575dd481bb image=sha256:c918e11e7b0b400dbf4e75092e64408c3c444768c5b7d141bcefa72f5a959b33 available=1 regenerated=1",
    `CANDIDATE_READINESS release=${candidateRelease} manifests=3 ready-images=3 state=immutable-build-complete`,
    "RUNTIME proxy|e2d04448b54299284a343904fbb58d232377138d024a77b179ac1f7724f5a506|sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648|release=none|restart-count=0 health=healthy restarting=false restart-policy=unless-stopped",
    "RUNTIME postgres|01f50c1dc126f73291e5fd535615065bf6fe95a3d899b8413264030307683f6d|sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777|release=none|restart-count=4 health=healthy restarting=false restart-policy=unless-stopped",
    "RUNTIME redis|e633814a7df0ca6ce048f83db6a47294046e42466627e9e1c0f9c1b0cee70ff1|sha256:e7723ff73d963f5cc6d9c4643ea3d989527a402a319239054e9472a7fb9219a2|release=none|restart-count=0 health=healthy restarting=false restart-policy=unless-stopped",
    "RUNTIME api|99302402f940589012fe2aea5dce626772ae7e438783c2ecafbb6ebbe3321671|sha256:518ce5d035c9f6ebbd100ff570981cffa822484fa1971ec8649f808134095d9c|release=git-20260813-183543163-6cac8fc79a7f|restart-count=0 health=healthy restarting=false restart-policy=unless-stopped",
    "RUNTIME media-ai|d858f9edfff2cc684bf982ca8cf48c7abf8881f616e25d6c96e901a611f0d6e5|sha256:9863f4cfa9defef7cfe7caf018c83bc277712df3c41fcc8baead1af2cbc0ec5f|release=git-20260813-025640764-d84603426146|restart-count=0 health=healthy restarting=false restart-policy=unless-stopped",
    "RUNTIME web|74e77c3f82b85065e175cd9d0dade381d75eedde298983463d36d6762932a486|sha256:23cfef8c359a60379d18d6736d2067c7c2a9a2bc82e08e1c37a6e53ac4745923|release=git-20260814-150749468-50e3ee9bc6e2|restart-count=0 health=healthy restarting=false restart-policy=unless-stopped",
    "RUNTIME discord-bot|07c255f2f4f08ca70c51c3b10bd82b41ba9148d1f95dfe136f5f90dc4cbe8745|sha256:e2db68104d3cf5a4f3ce543853b81725135b14a0f40f0246179b8e59bc88b0df|release=git-20260814-192205642-e04672c95be2|restart-count=0 health=healthy restarting=false restart-policy=unless-stopped",
    "INTERRUPTED_DEPLOY_INVENTORY_COMPLETE mutation=none",
  ];
  assert.equal(lines.length, 19);
  return `${lines.join("\n")}\n`;
}

test("exact 19-line diagnosed inventory is accepted and malformed shapes fail closed", () => {
  const fixture = exactInventoryFixture();
  assert.deepEqual(parser.verifyInventory(fixture), { candidateRelease });
  assert.deepEqual(
    parser.verifyInventory(
      fixture
        .replace("root-free-kib-before=25041116", "root-free-kib-before=24999999")
        .replace(
          "PUBLISH_ENV identity=2049:11408004:0:0:600:1:10330:1786803978",
          "PUBLISH_ENV identity=2049:22334455:0:0:600:1:10330:1786809999",
        ),
    ),
    { candidateRelease },
  );
  const lines = fixture.trimEnd().split("\n");
  for (const invalid of [
    `${lines.slice(0, -1).join("\n")}\n`,
    `${lines.concat("EXTRA").join("\n")}\n`,
    `${lines.concat(lines[7]).join("\n")}\n`,
    `${lines.filter((line) => !line.includes(" service=web ")).join("\n")}\n`,
    fixture.replace("SOURCE root=" + "b".repeat(40), "SOURCE root=" + "5e04ae1791ebb31261feaf460a484f182b4db6d4"),
    fixture.replace("7d0e4bf965799e9a", "fd0e4bf965799e9a"),
    fixture.replace("7677a7e1ae454478", "f677a7e1ae454478"),
    fixture.replace("b67321587a29effe", "f67321587a29effe"),
    fixture.replace("3746d6736a025b91", "f746d6736a025b91"),
    fixture.replace("2049:9839406", "2049:9839999"),
    fixture.replace("a33ff91db207401f", "f33ff91db207401f"),
    fixture.replace("2049:9839408", "2049:9839998"),
    fixture.replace(candidateImages.api, `sha256:${"f".repeat(64)}`),
    fixture.replace("sha256:57c72fd2a128e416", "sha256:f7c72fd2a128e416"),
    fixture.replace("99302402f9405890", "f9302402f9405890"),
    fixture.replace("git-20260813-183543163-6cac8fc79a7f", "git-20260813-183543163-6cac8fc79a7e"),
    fixture.replace("postgres|01f50c1dc126f73291e5fd535615065bf6fe95a3d899b8413264030307683f6d|sha256:57c72", "postgres|01f50c1dc126f73291e5fd535615065bf6fe95a3d899b8413264030307683f6d|sha256:57c72").replace("restart-count=4 health", "restart-count=5 health"),
    fixture.replace("matching=1 other=0", "matching=1 other=1"),
    fixture.replace("ready-images=3", "ready-images=2"),
  ]) {
    assert.throws(() => parser.verifyInventory(invalid));
  }
  const cli = spawnSync(process.execPath, [parserPath], {
    encoding: "utf8",
    input: fixture,
    timeout: 10_000,
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(
    cli.stdout,
    `INTERRUPTED FULL RESUME INVENTORY VERIFIED release=${candidateRelease}\n`,
  );
  const argument = spawnSync(process.execPath, [parserPath, "unexpected"], {
    encoding: "utf8",
    input: fixture,
    timeout: 10_000,
  });
  assert.equal(argument.status, 75);
});

test("closed wrapper holds one lock across exact inventory, sole prune, and in-place deploy", () => {
  assert.match(wrapper, /\[ "\$#" -eq 0 \]/);
  assert.match(wrapper, /ARENZYRA_DEPLOY_LOCK_INHERITED:-0.*= "1"/);
  assert.match(wrapper, /production_verify_lock_descriptor/);
  assert.match(wrapper, /EXPECTED_CANDIDATE_RELEASE="git-20260815-131200234-84099e4622e9"/);
  assert.match(wrapper, /verify-interrupted-full-resume-inventory\.cjs/);
  assert.equal((wrapper.match(/docker builder prune -af/g) ?? []).length, 1);
  assert.match(wrapper, /docker builder prune -af "\$reserve_flag" "0B"/);
  assert.doesNotMatch(wrapper, /docker (?:system|image|container|volume|network)\s/);
  assert.doesNotMatch(wrapper, /\b(?:rm|mv|cp|truncate|tee|dd)\s/);
  for (const snapshot of [
    "baseline_inventory",
    "pre_prune_inventory",
    "post_prune_inventory",
    "final_inventory",
  ]) {
    assert.match(wrapper, new RegExp(`! ${snapshot}="\\$\\(exact_inventory_snapshot\\)"`));
  }
  const baseline = wrapper.indexOf('baseline_inventory="$(exact_inventory_snapshot)"');
  const prune = wrapper.indexOf('docker builder prune -af "$reserve_flag" "0B"');
  const ordinaryPreflight = wrapper.lastIndexOf("scripts/production-deploy-preflight.sh");
  const final = wrapper.indexOf('final_inventory="$(exact_inventory_snapshot)"');
  const exec = wrapper.indexOf("exec /bin/bash scripts/deploy-production.sh --interrupted-full-deploy-resume");
  assert.ok(baseline >= 0 && baseline < prune && prune < ordinaryPreflight && ordinaryPreflight < final && final < exec);
});

test("dispatcher exposes only the no-argument locked nested resume", () => {
  const branch = dispatcher.slice(
    dispatcher.indexOf("  interrupted-full-deploy-resume)"),
    dispatcher.indexOf("  source-activate)"),
  );
  assert.match(branch, /"\$#" -eq 0/);
  const acquire = branch.indexOf("source scripts/acquire-production-deploy-lock.sh");
  const descriptor = branch.indexOf("production_verify_lock_descriptor");
  const root = branch.indexOf('verify_repository ROOT "$EXPECTED_ROOT"');
  const nested = branch.indexOf("require_nested_assembly");
  const exec = branch.indexOf("resume-production-interrupted-full-deploy.sh");
  assert.ok(acquire >= 0 && acquire < descriptor && descriptor < root && root < nested && nested < exec);
  assert.match(metadata, /"scripts"/);
});

test("resume flag stays MODE full, reuses only exact images, and retains full safety tail", () => {
  for (const [name, value] of [
    ["INTERRUPTED_FULL_CANDIDATE_RELEASE", candidateRelease],
    ["INTERRUPTED_FULL_CANDIDATE_ROOT", "d6390f2abb37"],
    ["INTERRUPTED_FULL_CANDIDATE_API", "88efdad94d65"],
    ["INTERRUPTED_FULL_CANDIDATE_WEB", "3d2cca1dd426"],
    ["INTERRUPTED_FULL_API_IMAGE", candidateImages.api],
    ["INTERRUPTED_FULL_WEB_IMAGE", candidateImages.web],
    ["INTERRUPTED_FULL_MEDIA_IMAGE", candidateImages["media-ai"]],
    ["INTERRUPTED_FULL_ENV_IDENTITY", "2049:9839406:0:0:600:1:3624:1786799521"],
    ["INTERRUPTED_FULL_ENV_SHA256", "3746d6736a025b9138aab01c0838a6225ded0205175bb2ea979d9e436aa8b47b"],
    ["INTERRUPTED_FULL_API_MANIFEST_SHA256", "a33ff91db207401f33a4c0339d632129a03452b90d7bd171c5913f9855d6288c"],
    ["INTERRUPTED_FULL_WEB_MANIFEST_SHA256", "a14eb7cd7cd651e9798c9c21308530b7c8cab6e65546bd2ded038f6a2a6bfadd"],
    ["INTERRUPTED_FULL_MEDIA_MANIFEST_SHA256", "af744723b8bbc92b89444b1e5b6eaeca2a81652989d23f8c64a720575dd481bb"],
  ]) {
    assert.match(deploy, new RegExp(`${name}="${value}"`));
  }
  assert.match(deploy, /--interrupted-full-deploy-resume\)[\s\S]*MODE="full"[\s\S]*INTERRUPTED_FULL_RESUME=1/);
  assert.match(deploy, /ORIGINAL_ARGUMENT_COUNT" -eq 1/);
  assert.match(
    deploy,
    /INTERRUPTED_FULL_RESUME" -eq 1[\s\S]*ARENZYRA_DEPLOY_LOCK_INHERITED:-0.*= "1"/,
  );
  assert.match(
    deploy,
    /elif \[ "\$\{ARENZYRA_DEPLOY_LOCK_INHERITED:-0\}" != "0" \][\s\S]*accepted only by the one-time interrupted full resume/,
  );
  const full = deploy.slice(
    deploy.indexOf('elif [ "$MODE" = "full" ]; then'),
    deploy.indexOf('elif [ "$MODE" = "web-candidate" ]; then'),
  );
  assert.match(full, /INTERRUPTED_FULL_RESUME" -eq 1[\s\S]*verify_interrupted_full_candidate_images[\s\S]*else[\s\S]*build api media-ai web/);
  assert.match(full, /else[\s\S]*archive_built_image_manifest api[\s\S]*archive_built_image_manifest web[\s\S]*archive_built_image_manifest media-ai/);
  assert.equal((full.match(/verify_interrupted_full_candidate_images/g) ?? []).length, 2);
  assert.match(
    deploy,
    /verify_interrupted_full_evidence_fingerprint[\s\S]*INTERRUPTED_FULL_ENV_IDENTITY[\s\S]*INTERRUPTED_FULL_ENV_SHA256/,
  );
  assert.match(
    deploy,
    /for service in api web media-ai[\s\S]*verify_interrupted_full_evidence_fingerprint[\s\S]*--from-docker-inspect[\s\S]*cmp -s - "\$manifest"[\s\S]*verify_interrupted_full_evidence_fingerprint/,
  );
  const compiledIdp = full.indexOf("verify_compiled_idp_storage");
  const backup = full.indexOf("create_pre_migration_backup");
  const schema = full.indexOf("schema_change_possible=1");
  const apiMigration = full.indexOf("api-migrate");
  const studioMigration = full.indexOf("studio-migrate");
  const roles = full.indexOf("provision-production-database-roles.sh");
  const up = full.indexOf("up --no-build -d --pull never --no-deps");
  assert.ok(
    compiledIdp >= 0 &&
      compiledIdp < backup &&
      backup < schema &&
      schema < apiMigration &&
      apiMigration < studioMigration &&
      studioMigration < roles &&
      roles < up,
  );
  const post = deploy.slice(deploy.indexOf("\nfi\n\nverify_running_release_images", deploy.indexOf("else\n  # One-time forward-only conversion")));
  const health = post.indexOf('wait_for_health "${services[@]}"');
  const postRoles = post.indexOf("verify-production-database-roles.sh");
  const entitlement = post.indexOf("verify-production-entitlement-invariants.sh");
  const idp = post.indexOf("verify-production-idp-encryption.sh");
  const publicVerify = post.indexOf("node scripts/verify-publish.cjs");
  const previousPointer = post.lastIndexOf("write_release_pointer PREVIOUS");
  const currentPointer = post.lastIndexOf("write_release_pointer CURRENT");
  const success = post.indexOf("DEPLOYMENT VERIFIED");
  assert.ok(
    health >= 0 &&
      health < postRoles &&
      postRoles < entitlement &&
      entitlement < idp &&
      idp < publicVerify &&
      publicVerify < previousPointer &&
      previousPointer < currentPointer &&
      currentPointer < success,
  );
});

test("direct special invocation and inherited ordinary invocation block before production setup", () => {
  const bash = process.platform === "win32"
    ? path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe")
    : "/bin/bash";
  const deployPath = path.join(repositoryRoot, "scripts/deploy-production.sh");
  for (const [args, marker, message] of [
    [[deployPath, "--interrupted-full-deploy-resume"], "0", "requires the continuously inherited reviewed deployment lock"],
    [[deployPath], "1", "accepted only by the one-time interrupted full resume"],
  ]) {
    const result = spawnSync(bash, ["--noprofile", "--norc", ...args], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...process.env, ARENZYRA_DEPLOY_LOCK_INHERITED: marker, BASH_ENV: "", ENV: "" },
      timeout: 10_000,
      windowsHide: true,
    });
    assert.equal(result.status, 75, result.stderr);
    assert.match(result.stderr, new RegExp(message));
    assert.doesNotMatch(result.stdout + result.stderr, /Docker|database|backup|migration|release metadata/i);
  }
  const lockCheck = deploy.indexOf('if [ "$INTERRUPTED_FULL_RESUME" -eq 1 ]; then');
  const productionRoot = deploy.indexOf('resolved_root="$(realpath -e -- "$PRODUCTION_ROOT"');
  assert.ok(lockCheck >= 0 && lockCheck < productionRoot);
});

test("real inherited descriptor excludes a competing flock", (t) => {
  const harness = [
    "set -eu",
    'lock_path="$(mktemp)"',
    "trap 'rm -f -- \"$lock_path\"' EXIT",
    'exec 8>"$lock_path"',
    'if ! ( exec 7<>"$lock_path"; flock -n -E 42 7 ); then exit 90; fi',
    "flock -n 8",
    "ARENZYRA_DEPLOY_LOCK_INHERITED=1 sh -c 'flock -n 8'",
    "probe_status=0",
    '( exec 7<>"$lock_path"; flock -n -E 42 7 ) || probe_status=$?',
    '[ "$probe_status" -eq 42 ] || exit 91',
    "if ( exec 9>\"$lock_path\"; flock -n 9 ); then exit 92; fi",
    "printf 'LOCK_CONTINUOUS_OK\\n'",
    "",
  ].join("\n");
  let command;
  let args;
  if (process.platform === "win32") {
    const probe = spawnSync("wsl.exe", ["-e", "sh", "-c", "command -v flock"], { encoding: "utf8" });
    if (probe.status !== 0) return t.skip("WSL flock is unavailable");
    command = "wsl.exe";
    args = ["-e", "sh", "-s"];
  } else {
    command = "/bin/bash";
    args = ["--noprofile", "--norc", "-s"];
  }
  const result = spawnSync(command, args, { encoding: "utf8", input: harness, timeout: 10_000 });
  assert.equal(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
  assert.equal(result.stdout, "LOCK_CONTINUOUS_OK\n");
});
