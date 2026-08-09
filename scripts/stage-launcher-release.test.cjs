"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  sha256File,
  stageVerifiedLauncherRelease,
} = require("./sync-launcher-downloads.cjs");

const repositoryRoot = path.resolve(__dirname, "..");
const FIXED_TIME = "2026-08-09T12:00:00.000Z";

function writeFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

function createVerifiedFixture(root, version = "1.2.3") {
  const installerPath = path.join(root, "source", "installer.exe");
  const portableZipPath = path.join(root, "source", "portable.zip");
  writeFile(installerPath, "signed-installer-fixture");
  writeFile(portableZipPath, "portable-zip-fixture");
  return {
    version,
    installer: {
      path: installerPath,
      size: fs.statSync(installerPath).size,
      sha256: sha256File(installerPath),
      signing: {
        status: "verified",
        authenticodeStatus: "Valid",
        trustedSignerId: "arenzyra-release-fixture",
        subject: "CN=Arenzyra Release Fixture",
        certificateSha256: "a".repeat(64),
        timestampCertificateSha256: "b".repeat(64),
        trustPolicy: {
          schemaVersion: 1,
          sha256: "c".repeat(64),
          reviewedAt: FIXED_TIME,
          reviewedBy: "release-reviewer",
          reviewReference: "RELEASE-REVIEW-1",
        },
      },
      resources: {
        "resources/app/electron/main.cjs": {
          sha256: "d".repeat(64),
          size: 123,
        },
      },
    },
    portableZip: {
      path: portableZipPath,
      size: fs.statSync(portableZipPath).size,
      sha256: sha256File(portableZipPath),
    },
    mapProvenance: {
      provenanceSha256: "e".repeat(64),
      assetCount: 15,
      approval: {
        state: "approved",
        reviewedAt: FIXED_TIME,
        reviewedBy: "legal-reviewer",
        reviewReference: "LEGAL-REVIEW-1",
        evidenceIds: ["license-1"],
      },
    },
    packagedRuntimeIntegrity: {
      schemaVersion: 1,
      status: "verified-complete",
      policySha256: "e".repeat(64),
      inventorySha256: "f".repeat(64),
      inventories: {
        status: "verified",
        installerSha256: "1".repeat(64),
        portableZipSha256: "2".repeat(64),
      },
      asarIntegrity: {
        status: "verified",
        embeddedValidation: true,
        onlyLoadAppFromAsar: true,
        appAsarSha256: "3".repeat(64),
      },
      dependencies: {
        status: "verified",
        inventorySha256: "4".repeat(64),
      },
      innerExecutables: {
        installer: {
          status: "verified",
          sha256: "5".repeat(64),
          certificateSha256: "a".repeat(64),
        },
        portableZip: {
          status: "verified",
          sha256: "6".repeat(64),
          certificateSha256: "a".repeat(64),
        },
      },
      manifestSignature: {
        status: "verified",
        algorithm: "sha256WithRSAEncryption",
        signatureSha256: "7".repeat(64),
        signerCertificateSha256: "a".repeat(64),
      },
    },
  };
}

function fixtureTest(name, callback) {
  test(name, (t) => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "arenzyra-stage-release-"),
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    callback({
      root,
      stagingRoot: path.join(root, "deploy-artifacts", "launcher"),
      verified: createVerifiedFixture(root),
    });
  });
}

fixtureTest(
  "stages only versioned immutable release files outside the web tree",
  ({ root, stagingRoot, verified }) => {
    const staged = stageVerifiedLauncherRelease({
      verified,
      stagingRoot,
      now: () => new Date(FIXED_TIME),
      randomId: () => "fixture-stage",
    });

    assert.equal(staged.releaseId, "launcher-1.2.3");
    assert.equal(
      staged.releaseDirectory,
      path.join(stagingRoot, "launcher-1.2.3"),
    );
    assert.equal(
      path.basename(staged.files.installer),
      "Arenzyra-Observer-Launcher-1.2.3-Setup.exe",
    );
    assert.equal(
      path.basename(staged.files.portableZip),
      "Arenzyra-Observer-Launcher-1.2.3-Portable.zip",
    );
    assert.equal(
      fs.readFileSync(staged.files.installer, "utf8"),
      "signed-installer-fixture",
    );
    assert.equal(
      fs.readFileSync(staged.files.portableZip, "utf8"),
      "portable-zip-fixture",
    );
    assert.equal(fs.existsSync(path.join(root, "apps", "arenzyra-web")), false);
    assert.deepEqual(fs.readdirSync(stagingRoot), ["launcher-1.2.3"]);

    const manifest = JSON.parse(fs.readFileSync(staged.files.manifest, "utf8"));
    assert.equal(
      manifest.publicationState,
      "pending-independent-upload-verification",
    );
    assert.equal(manifest.deployable, false);
    assert.equal(manifest.releaseId, "launcher-1.2.3");
    assert.equal(
      manifest.artifacts.installer.sha256,
      verified.installer.sha256,
    );
    assert.equal(
      manifest.artifacts.portableZip.sha256,
      verified.portableZip.sha256,
    );
    assert.equal(
      manifest.artifacts.installer.signing.certificateSha256,
      verified.installer.signing.certificateSha256,
    );
    assert.match(
      manifest.artifacts.installer.signingMetadataSha256,
      /^[a-f0-9]{64}$/,
    );
    assert.equal(
      manifest.verifiedMapProvenance.provenanceSha256,
      verified.mapProvenance.provenanceSha256,
    );
    assert.deepEqual(
      manifest.packagedRuntimeIntegrity,
      verified.packagedRuntimeIntegrity,
    );
    assert.match(manifest.verifiedResourcesSha256, /^[a-f0-9]{64}$/);

    const manifestBytes = fs.readFileSync(staged.files.manifest);
    const expectedManifestHash = crypto
      .createHash("sha256")
      .update(manifestBytes)
      .digest("hex");
    assert.equal(
      fs.readFileSync(
        path.join(staged.releaseDirectory, "manifest.json.sha256"),
        "utf8",
      ),
      `${expectedManifestHash}  manifest.json\n`,
    );
  },
);

fixtureTest(
  "accepts the verified exact zero commercial-map inventory state",
  ({ stagingRoot, verified }) => {
    verified.mapProvenance.assetCount = 0;
    verified.mapProvenance.approval = {
      state: "not-applicable-no-bundled-commercial-assets",
      reviewedAt: null,
      reviewedBy: null,
      reviewReference: null,
      evidenceIds: [],
    };

    const staged = stageVerifiedLauncherRelease({
      verified,
      stagingRoot,
      now: () => new Date(FIXED_TIME),
      randomId: () => "zero-map-stage",
    });
    const manifest = JSON.parse(fs.readFileSync(staged.files.manifest, "utf8"));
    assert.equal(manifest.verifiedMapProvenance.assetCount, 0);
    assert.equal(
      manifest.verifiedMapProvenance.approval.state,
      "not-applicable-no-bundled-commercial-assets",
    );
  },
);

fixtureTest(
  "refuses staging without complete packaged-runtime evidence",
  ({ stagingRoot, verified }) => {
    delete verified.packagedRuntimeIntegrity;

    assert.throws(
      () =>
        stageVerifiedLauncherRelease({
          verified,
          stagingRoot,
          now: () => new Date(FIXED_TIME),
          randomId: () => "missing-runtime-evidence",
        }),
      /complete packaged-runtime integrity metadata is incomplete/i,
    );
    assert.equal(fs.existsSync(stagingRoot), false);
  },
);

fixtureTest(
  "refuses to overwrite or restage an existing release ID",
  ({ stagingRoot, verified }) => {
    const options = {
      verified,
      stagingRoot,
      now: () => new Date(FIXED_TIME),
      randomId: () => "first-stage",
    };
    const first = stageVerifiedLauncherRelease(options);
    const originalInstaller = fs.readFileSync(first.files.installer);
    fs.writeFileSync(verified.installer.path, "changed-after-first-stage");

    assert.throws(
      () =>
        stageVerifiedLauncherRelease({
          ...options,
          randomId: () => "second-stage",
        }),
      /already exists and will not be overwritten/,
    );
    assert.deepEqual(fs.readFileSync(first.files.installer), originalInstaller);
    assert.deepEqual(fs.readdirSync(stagingRoot), ["launcher-1.2.3"]);
  },
);

fixtureTest(
  "removes an incomplete temporary stage when copied bytes fail verification",
  ({ stagingRoot, verified }) => {
    verified.installer.sha256 = "f".repeat(64);
    assert.throws(
      () =>
        stageVerifiedLauncherRelease({
          verified,
          stagingRoot,
          now: () => new Date(FIXED_TIME),
          randomId: () => "failed-stage",
        }),
      /changed while staging/,
    );
    assert.equal(
      fs.existsSync(path.join(stagingRoot, "launcher-1.2.3")),
      false,
    );
    assert.deepEqual(fs.readdirSync(stagingRoot), []);
  },
);

fixtureTest(
  "emits an intentionally unusable pending runtime template",
  ({ stagingRoot, verified }) => {
    const staged = stageVerifiedLauncherRelease({
      verified,
      stagingRoot,
      now: () => new Date(FIXED_TIME),
      randomId: () => "pending-stage",
    });
    const pending = JSON.parse(
      fs.readFileSync(staged.files.pendingTemplate, "utf8"),
    );
    assert.equal(pending.schemaVersion, 0);
    assert.equal(pending.deployable, false);
    assert.equal(pending.runtimeValue, null);
    assert.match(pending.status, /^pending-/);
    assert.match(pending.warning, /intentionally not valid/i);
    assert.equal(Object.hasOwn(pending, "manifestUrl"), false);
    assert.equal(Object.hasOwn(pending, "artifacts"), false);
    assert.doesNotMatch(JSON.stringify(pending), /https?:\/\//i);
  },
);

test("same-checkout npm release entrypoints are blocked and the adapter has no web-public writer", () => {
  const rootPackage = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
  );
  const source = fs.readFileSync(
    path.join(repositoryRoot, "scripts", "sync-launcher-downloads.cjs"),
    "utf8",
  );
  const gitIgnore = fs.readFileSync(
    path.join(repositoryRoot, ".gitignore"),
    "utf8",
  );
  const dockerIgnore = fs.readFileSync(
    path.join(repositoryRoot, ".dockerignore"),
    "utf8",
  );

  assert.equal(
    Object.hasOwn(rootPackage.scripts, "sync:launcher-downloads"),
    false,
  );
  assert.equal(
    rootPackage.scripts["stage:launcher-release"],
    "node scripts/blocked-launcher-release-entrypoint.cjs stage",
  );
  assert.equal(
    rootPackage.scripts["verify:launcher-release"],
    "node scripts/blocked-launcher-release-entrypoint.cjs verify",
  );
  const blockedEntrypoint = path.join(
    repositoryRoot,
    "scripts",
    "blocked-launcher-release-entrypoint.cjs",
  );
  for (const action of ["stage", "verify"]) {
    const result = spawnSync(process.execPath, [blockedEntrypoint, action], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /launcher-release-blocked/);
    assert.match(result.stderr, /reviewed outer Windows launcher/i);
    assert.match(result.stderr, /connector commercial provenance.*unapproved/i);
  }
  for (const directModule of [
    "sync-launcher-downloads.cjs",
    "launcher-release-artifact-verifier.cjs",
  ]) {
    const result = spawnSync(
      process.execPath,
      [path.join(repositoryRoot, "scripts", directModule)],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /launcher-release-blocked/);
    assert.match(result.stderr, /reviewed outer Windows launcher/i);
    assert.match(result.stderr, /connector commercial provenance.*unapproved/i);
  }
  assert.doesNotMatch(source, /public[\\/]downloads/i);
  assert.doesNotMatch(source, /["'`]\/downloads\/launcher\//i);
  assert.doesNotMatch(source, /webDownloadsDir/);
  assert.match(source, /deploy-artifacts["'],\s*["']launcher/);
  assert.match(gitIgnore, /^deploy-artifacts\/$/m);
  assert.match(dockerIgnore, /^deploy-artifacts\/?$/m);
});
