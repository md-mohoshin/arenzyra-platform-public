"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  validateLauncherReleaseRuntimeConfig,
} = require("./validate-launcher-release-runtime-config.cjs");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

function validConfig() {
  const base =
    "https://github.com/md-mohoshin/arenzyra-platform-public/releases/download/launcher-0.1.30";
  return {
    schemaVersion: 2,
    version: "0.1.30",
    releaseId: "launcher-0.1.30",
    publishedAt: "2026-08-16T05:25:53Z",
    signing: {
      status: "unsigned",
      publisher: null,
      certificateSha256: null,
      checkedAt: "2026-08-16T05:26:36.6308042Z",
      warning:
        "This launcher is intentionally unsigned. Windows may display an Unknown publisher warning; verify the published SHA-256 checksum before running it.",
    },
    integrity: {
      status: "verified",
      algorithm: "SHA-256",
      manifestSha256:
        "3a8d1294fb83de7579c153b774ca3d8305e21bbea0b7d5def697e18554401394",
      verifiedAt: "2026-08-16T05:26:36.6308042Z",
    },
    manifestUrl: `${base}/manifest.json`,
    artifacts: {
      installer: {
        url: `${base}/Arenzyra-Observer-Launcher-0.1.30-Setup.exe`,
        sha256:
          "f2180af7893dbaed83fb8059959f8a78a8206e7f40a118b4bc96395b38d354d1",
        sizeBytes: 107605126,
      },
      portableZip: {
        url: `${base}/Arenzyra-Observer-Launcher-0.1.30-Portable.zip`,
        sha256:
          "6b74812cf5541c65c7523cee63a33cf7a9b201a4e1cf0298f25290fffe091223",
        sizeBytes: 150707425,
      },
    },
  };
}

test("reviewed launcher metadata validator accepts the exact immutable unsigned shape", () => {
  const raw = JSON.stringify(validConfig());
  const result = validateLauncherReleaseRuntimeConfig(raw);
  assert.equal(result?.version, "0.1.30");
  assert.equal(result?.releaseId, "launcher-0.1.30");
  assert.match(result?.configSha256 ?? "", /^[0-9a-f]{64}$/);
});

test("reviewed launcher metadata validator fails closed on mutable or unsafe input", () => {
  const cases = [];
  const mutable = validConfig();
  mutable.releaseId = "latest";
  cases.push(JSON.stringify(mutable));
  const signed = validConfig();
  signed.signing.status = "signed";
  cases.push(JSON.stringify(signed));
  const missingWarning = validConfig();
  missingWarning.signing.warning = "This unsigned launcher has a checksum warning.";
  cases.push(JSON.stringify(missingWarning));
  const query = validConfig();
  query.manifestUrl += "?moving=1";
  cases.push(JSON.stringify(query));
  const crossOrigin = validConfig();
  crossOrigin.artifacts.installer.url = crossOrigin.artifacts.installer.url.replace(
    "github.com",
    "example.com",
  );
  cases.push(JSON.stringify(crossOrigin));
  cases.push(`${JSON.stringify(validConfig())}\n`);
  cases.push(JSON.stringify(validConfig()).replace("Unknown publisher", "Unknown $publisher"));
  for (const raw of cases) {
    assert.equal(validateLauncherReleaseRuntimeConfig(raw), null);
  }
});

test("launcher configuration command is locked, transactional, and env-only", () => {
  const launcher = read("scripts/production-reviewed-entrypoint.sh");
  const script = read("scripts/configure-production-launcher-release.sh");
  assert.match(launcher, /launcher-release-configure\)/);
  assert.match(launcher, /configure-production-launcher-release\.sh/);
  assert.match(script, /read -r launcher_json <&3/);
  assert.match(script, /source scripts\/acquire-production-deploy-lock\.sh/);
  assert.match(script, /validate-launcher-release-runtime-config\.cjs/);
  assert.match(script, /preflight-publish\.cjs --env "\$temporary"/);
  assert.match(script, /candidate_non_launcher_sha256/);
  assert.match(script, /read-dotenv-value\.cjs/);
  assert.match(script, /launcher-release-original/);
  assert.match(script, /mv -T -- "\$temporary" "\$ENV_FILE"/);
  const first = script.indexOf("bash scripts/production-deploy-preflight.sh");
  const move = script.indexOf('mv -T -- "$temporary" "$ENV_FILE"');
  const second = script.indexOf("bash scripts/production-deploy-preflight.sh", first + 1);
  assert.ok(first >= 0 && first < move && move < second);
  assert.doesNotMatch(script, /docker compose|force-recreate|\bup -d\b|rm -rf/);
});
