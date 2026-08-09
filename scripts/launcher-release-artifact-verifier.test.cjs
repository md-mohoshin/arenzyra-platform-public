"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  AUTHENTICODE_INSPECTION_SCRIPT,
  AUTHENTICODE_TARGET_ENV,
  DEFAULT_TRUSTED_SIGNER_CONFIG_PATH,
  assertPackagedMapProvenance,
  defaultSourceEntries,
  extractArchiveEntries,
  launcherArtifactNames,
  recursiveSourceEntries,
  validatePackagedRuntimeIntegrity,
  validateTrustedSignerConfig,
  verifyInstallerAuthenticode,
  verifyLauncherReleaseArtifacts,
} = require("./launcher-release-artifact-verifier.cjs");

const FIXTURE_SIGNER_SUBJECT =
  "CN=Arenzyra Fixture Signing, O=Arenzyra Fixture";
const FIXTURE_SIGNER_THUMBPRINT = "0123456789ABCDEF0123456789ABCDEF01234567";
const FIXTURE_SIGNER_CERTIFICATE_SHA256 = "A".repeat(64);
const FIXTURE_TIMESTAMP_SUBJECT = "CN=Fixture Timestamp CA";
const FIXTURE_TIMESTAMP_THUMBPRINT = "89ABCDEF0123456789ABCDEF0123456789ABCDEF";
const FIXTURE_TIMESTAMP_CERTIFICATE_SHA256 = "C".repeat(64);

function approvedSignerConfig() {
  return {
    schemaVersion: 1,
    approval: {
      state: "approved",
      reviewedBy: "Fixture Security Reviewer",
      reviewedAt: "2026-08-09T10:00:00.000Z",
      reviewReference: "SECURITY-REVIEW-123",
    },
    trustedSigners: [
      {
        id: "arenzyra-fixture-signing",
        subject: FIXTURE_SIGNER_SUBJECT,
        thumbprint: FIXTURE_SIGNER_THUMBPRINT,
        certificateSha256: FIXTURE_SIGNER_CERTIFICATE_SHA256,
        approvalState: "approved",
      },
    ],
    trustedTimestampAuthorities: [
      {
        id: "fixture-rfc3161",
        subject: FIXTURE_TIMESTAMP_SUBJECT,
        thumbprint: FIXTURE_TIMESTAMP_THUMBPRINT,
        certificateSha256: FIXTURE_TIMESTAMP_CERTIFICATE_SHA256,
        approvalState: "approved",
      },
    ],
  };
}

function validAuthenticodeResult(patch = {}) {
  return {
    status: "Valid",
    statusMessage: "Signature verified.",
    subject: FIXTURE_SIGNER_SUBJECT,
    issuer: "CN=Fixture Issuing CA",
    thumbprint: FIXTURE_SIGNER_THUMBPRINT,
    certificateSha256: FIXTURE_SIGNER_CERTIFICATE_SHA256,
    serialNumber: "123456",
    certificateNotBefore: "2026-01-01T00:00:00.000Z",
    certificateNotAfter: "2027-01-01T00:00:00.000Z",
    timestampSubject: FIXTURE_TIMESTAMP_SUBJECT,
    timestampThumbprint: FIXTURE_TIMESTAMP_THUMBPRINT,
    timestampCertificateSha256: FIXTURE_TIMESTAMP_CERTIFICATE_SHA256,
    ...patch,
  };
}

function mockReleaseGates(calls = []) {
  return {
    authenticode: {
      platform: "win32",
      env: { SystemRoot: "C:\\Windows", WINDIR: "C:\\WINDOWS" },
      isFile: () => true,
      trustedSignerConfig: approvedSignerConfig(),
      now: () => new Date("2026-08-09T12:00:00.000Z"),
      spawnSyncImpl: (command, args, options) => {
        calls.push({ command, args, options });
        return {
          status: 0,
          stdout: JSON.stringify(validAuthenticodeResult()),
          stderr: "",
        };
      },
    },
    mapProvenanceVerifier: () => ({
      ok: true,
      provenanceSha256: "b".repeat(64),
      assetCount: 0,
      assets: {},
      approval: {
        state: "not-applicable-no-bundled-commercial-assets",
        reviewedAt: null,
        reviewedBy: null,
        reviewReference: null,
      },
    }),
    completeRuntimeVerifier: () => ({
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
    }),
  };
}

test("packaged map resources must match the reviewed provenance hashes", () => {
  const expectedHash = "a".repeat(64);
  const provenance = {
    assetCount: 1,
    assets: { "erangel.png": { sha256: expectedHash } },
    approval: { state: "approved" },
  };
  const entryPath = "resources/app/electron/assets/maps/erangel.png";

  assert.doesNotThrow(() =>
    assertPackagedMapProvenance(
      { [entryPath]: { sha256: expectedHash } },
      provenance,
      "fixture artifact",
    ),
  );
  assert.throws(
    () =>
      assertPackagedMapProvenance(
        { [entryPath]: { sha256: "b".repeat(64) } },
        provenance,
        "fixture artifact",
      ),
    /does not contain the reviewed map bytes/,
  );
});

test("packaged map resources bind the explicit exact zero-raster provenance state", () => {
  const provenance = {
    assetCount: 0,
    assets: {},
    approval: { state: "not-applicable-no-bundled-commercial-assets" },
  };
  const fallbackPath =
    "resources/app/electron/assets/maps/map-not-available.svg";
  assert.doesNotThrow(() =>
    assertPackagedMapProvenance(
      { [fallbackPath]: { sha256: "a".repeat(64) } },
      provenance,
      "fixture artifact",
    ),
  );
  assert.throws(
    () =>
      assertPackagedMapProvenance(
        {
          [fallbackPath]: { sha256: "a".repeat(64) },
          "resources/app/electron/assets/maps/erangel.png": {
            sha256: "b".repeat(64),
          },
        },
        provenance,
        "fixture artifact",
      ),
    /commercial map raster inventory does not exactly match/,
  );
  assert.throws(
    () =>
      assertPackagedMapProvenance(
        { [fallbackPath]: { sha256: "a".repeat(64) } },
        { ...provenance, approval: { state: "approved" } },
        "fixture artifact",
      ),
    /approval state is invalid/,
  );
});

test("packaged runtime evidence requires ASAR, inventory, dependency, executable, and signature proof", () => {
  const evidence = mockReleaseGates().completeRuntimeVerifier();
  assert.equal(validatePackagedRuntimeIntegrity(evidence), evidence);
  evidence.asarIntegrity.onlyLoadAppFromAsar = false;
  assert.throws(
    () => validatePackagedRuntimeIntegrity(evidence),
    /invalid or incomplete/,
  );
});

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function archiveListing(entries) {
  return [
    "Path = fixture.zip",
    "Type = zip",
    "Physical Size = 123",
    "",
    "----------",
    ...entries.flatMap((entry) => [
      `Path = ${entry.path}`,
      `Folder = ${entry.folder || "-"}`,
      `Size = ${entry.size ?? 0}`,
      `Attributes = ${entry.attributes || "A"}`,
      `Encrypted = ${entry.encrypted || "-"}`,
      ...(entry.extraFields || []),
      "",
    ]),
  ].join("\n");
}

function createMockArchive(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-archive-mock-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archivePath = path.join(root, "fixture.zip");
  writeFile(archivePath, "not read by the mocked 7-Zip process");
  return { root, archivePath };
}

function extractionDestination(args) {
  const outputArgument = args.find((argument) => argument.startsWith("-o"));
  assert.ok(outputArgument, "mock extraction must receive an output directory");
  return outputArgument.slice(2);
}

function createFixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "arenzyra-launcher-release-"),
  );
  const sourceRoot = path.join(root, "source");
  const archiveRoot = path.join(root, "archive");
  const distDir = path.join(root, "dist");
  const version = "9.8.7";
  const packageJsonPath = path.join(sourceRoot, "package.json");
  writeFile(
    packageJsonPath,
    JSON.stringify({ name: "arenzyra-observer-launcher", version }),
  );

  const sourceEntries = [
    ["resources/connectors/ob.js", "connector-v2"],
    [
      "resources/connectors/direct-observer-transport-payload.cjs",
      "transport-v2",
    ],
    ["resources/connectors/observer-telemetry-contract.cjs", "contract-v2"],
    ["resources/app/electron/main.cjs", "launcher-v2"],
  ].map(([entryPath, content], index) => {
    const sourcePath = path.join(sourceRoot, `source-${index}.txt`);
    writeFile(sourcePath, content);
    writeFile(path.join(archiveRoot, ...entryPath.split("/")), content);
    return { entryPath, sourcePath };
  });
  writeFile(
    path.join(archiveRoot, "resources", "app", "package.json"),
    JSON.stringify({ name: "arenzyra-observer-launcher", version }),
  );

  fs.mkdirSync(distDir, { recursive: true });
  const sevenZipPath = require("7zip-bin").path7za;
  const fixtureZip = path.join(root, "fixture.zip");
  const archived = spawnSync(sevenZipPath, ["a", "-tzip", fixtureZip, "."], {
    cwd: archiveRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(archived.status, 0, archived.stderr);
  const names = launcherArtifactNames(version);
  fs.copyFileSync(fixtureZip, path.join(distDir, names.installer));
  fs.copyFileSync(fixtureZip, path.join(distDir, names.portableZip));

  const authenticodeCalls = [];
  return {
    root,
    distDir,
    packageJsonPath,
    sourceEntries,
    version,
    authenticodeCalls,
    ...mockReleaseGates(authenticodeCalls),
  };
}

test("verifies exact-version installer and ZIP contents against source", (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const result = verifyLauncherReleaseArtifacts(fixture);
  assert.equal(result.version, fixture.version);
  assert.equal(
    result.installer.resources["resources/connectors/ob.js"].sha256,
    result.portableZip.resources["resources/connectors/ob.js"].sha256,
  );
  assert.equal(result.installer.signing.authenticodeStatus, "Valid");
  assert.equal(
    result.installer.signing.trustedSignerId,
    "arenzyra-fixture-signing",
  );
  assert.equal(
    result.installer.signing.certificateSha256,
    FIXTURE_SIGNER_CERTIFICATE_SHA256,
  );
  assert.equal(
    result.installer.signing.trustedTimestampAuthorityId,
    "fixture-rfc3161",
  );
  assert.equal(
    result.installer.path,
    path.join(
      fixture.distDir,
      fixture.names?.installer ||
        launcherArtifactNames(fixture.version).installer,
    ),
  );
  assert.equal(fixture.authenticodeCalls.length, 1);
  const inspectedSnapshot =
    fixture.authenticodeCalls[0].options.env[AUTHENTICODE_TARGET_ENV];
  assert.notEqual(
    inspectedSnapshot,
    path.join(
      fixture.distDir,
      launcherArtifactNames(fixture.version).installer,
    ),
  );
  assert.equal(fs.existsSync(inspectedSnapshot), false);
});

test("rejects a stale packaged resource", (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  fs.writeFileSync(fixture.sourceEntries[0].sourcePath, "newer-connector");
  assert.throws(
    () => verifyLauncherReleaseArtifacts(fixture),
    /Stale launcher resource/,
  );
});

test("default release verification blocks incomplete packaged runtime evidence", (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  delete fixture.completeRuntimeVerifier;
  assert.throws(
    () => verifyLauncherReleaseArtifacts(fixture),
    /complete NSIS\/portable runtime.*not implemented/i,
  );
});

test("archive verification inventories first and applies bounded subprocess limits", (t) => {
  const fixture = createMockArchive(t);
  const calls = [];
  const value = Buffer.from("reviewed launcher bytes");
  const result = extractArchiveEntries(
    fixture.archivePath,
    ["safe/reviewed.txt"],
    {
      sevenZipPath: "trusted-7za",
      spawnSyncImpl: (command, args, options) => {
        calls.push({ command, args, options });
        if (args[0] === "l") {
          return {
            status: 0,
            stdout: archiveListing([
              { path: "safe/reviewed.txt", size: value.length },
            ]),
            stderr: "",
          };
        }
        assert.equal(args[0], "x");
        writeFile(
          path.join(extractionDestination(args), "safe", "reviewed.txt"),
          value,
        );
        return { status: 0, stdout: "", stderr: "" };
      },
    },
  );

  assert.deepEqual(result.get("safe/reviewed.txt"), value);
  assert.deepEqual(
    calls.map((call) => call.args[0]),
    ["l", "x"],
  );
  for (const call of calls) {
    assert.ok(Number.isSafeInteger(call.options.timeout));
    assert.ok(call.options.timeout > 0 && call.options.timeout <= 60_000);
    assert.ok(Number.isSafeInteger(call.options.maxBuffer));
    assert.ok(call.options.maxBuffer > 0);
  }
});

test("archive verification refuses listing and extraction timeouts", (t) => {
  const fixture = createMockArchive(t);
  const timeout = () => ({
    status: null,
    signal: "SIGTERM",
    error: Object.assign(new Error("operation timed out"), {
      code: "ETIMEDOUT",
    }),
  });
  assert.throws(
    () =>
      extractArchiveEntries(fixture.archivePath, ["safe/file.txt"], {
        sevenZipPath: "trusted-7za",
        spawnSyncImpl: timeout,
      }),
    /metadata inspection timed out/,
  );

  let callCount = 0;
  assert.throws(
    () =>
      extractArchiveEntries(fixture.archivePath, ["safe/file.txt"], {
        sevenZipPath: "trusted-7za",
        spawnSyncImpl: () => {
          callCount += 1;
          return callCount === 1
            ? {
                status: 0,
                stdout: archiveListing([{ path: "safe/file.txt", size: 4 }]),
                stderr: "",
              }
            : timeout();
        },
      }),
    /archive extraction timed out/,
  );
});

test("archive verification refuses excessive counts and expanded sizes before extraction", (t) => {
  const fixture = createMockArchive(t);
  const listingFor = (entries) => () => ({
    status: 0,
    stdout: archiveListing(entries),
    stderr: "",
  });
  const files = [
    { path: "safe/one.txt", size: 10 },
    { path: "safe/two.txt", size: 10 },
  ];

  assert.throws(
    () =>
      extractArchiveEntries(fixture.archivePath, ["safe/one.txt"], {
        sevenZipPath: "trusted-7za",
        spawnSyncImpl: listingFor(files),
        archiveLimits: { maxEntryCount: 1 },
      }),
    /too many entries/,
  );
  assert.throws(
    () =>
      extractArchiveEntries(fixture.archivePath, ["safe/one.txt"], {
        sevenZipPath: "trusted-7za",
        spawnSyncImpl: listingFor(files),
        archiveLimits: { maxFileCount: 1 },
      }),
    /too many files/,
  );
  assert.throws(
    () =>
      extractArchiveEntries(fixture.archivePath, ["safe/huge.bin"], {
        sevenZipPath: "trusted-7za",
        spawnSyncImpl: listingFor([
          { path: "safe/huge.bin", size: 512 * 1024 * 1024 + 1 },
        ]),
      }),
    /entry exceeds the expanded-size limit/,
  );
  assert.throws(
    () =>
      extractArchiveEntries(fixture.archivePath, ["safe/large.bin"], {
        sevenZipPath: "trusted-7za",
        spawnSyncImpl: listingFor([
          { path: "safe/large.bin", size: 64 * 1024 * 1024 + 1 },
        ]),
      }),
    /entry exceeds the readable size limit/,
  );
  assert.throws(
    () =>
      extractArchiveEntries(fixture.archivePath, ["safe/one.txt"], {
        sevenZipPath: "trusted-7za",
        spawnSyncImpl: listingFor(files),
        archiveLimits: { maxTotalExpandedSizeBytes: 15 },
      }),
    /total expanded-size limit/,
  );
  assert.throws(
    () =>
      extractArchiveEntries(
        fixture.archivePath,
        ["safe/one.txt", "safe/two.txt"],
        {
          sevenZipPath: "trusted-7za",
          spawnSyncImpl: listingFor(files),
          archiveLimits: { maxSelectedExpandedSizeBytes: 15 },
        },
      ),
    /selected expanded-size limit/,
  );
});

test("archive verification refuses unsafe, colliding, linked, and encrypted metadata", (t) => {
  const fixture = createMockArchive(t);
  let listing = "";
  const inspectOnly = () => ({ status: 0, stdout: listing, stderr: "" });
  const verify = (entryPath = "safe/file.txt") =>
    extractArchiveEntries(fixture.archivePath, [entryPath], {
      sevenZipPath: "trusted-7za",
      spawnSyncImpl: inspectOnly,
    });

  listing = archiveListing([{ path: "../escape.txt", size: 1 }]);
  assert.throws(() => verify(), /metadata entry path is unsafe/);

  listing = archiveListing([{ path: "safe/CON.txt", size: 1 }]);
  assert.throws(() => verify(), /metadata entry path is unsafe/);

  listing = archiveListing([{ path: "-ooutside/file.txt", size: 1 }]);
  assert.throws(() => verify(), /metadata entry path is unsafe/);

  listing = archiveListing([
    { path: "safe/File.txt", size: 1 },
    { path: "safe/file.txt", size: 1 },
  ]);
  assert.throws(() => verify(), /duplicate or case-colliding entries/);

  listing = archiveListing([
    {
      path: "safe/file.txt",
      size: 1,
      extraFields: ["Symbolic Link = ../../outside.txt"],
    },
  ]);
  assert.throws(() => verify(), /must not be a link, junction, or reparse/);

  listing = archiveListing([
    { path: "safe/file.txt", size: 1, attributes: "AL" },
  ]);
  assert.throws(() => verify(), /must not be a link, junction, or reparse/);

  listing = archiveListing([
    { path: "safe/file.txt", size: 1, encrypted: "+" },
  ]);
  assert.throws(() => verify(), /must not be encrypted/);
});

test("archive verification refuses extracted junctions before following them", (t) => {
  const fixture = createMockArchive(t);
  const outside = path.join(fixture.root, "outside");
  const probe = path.join(fixture.root, "junction-probe");
  writeFile(path.join(outside, "file.txt"), "outside");
  try {
    fs.symlinkSync(outside, probe, "junction");
    fs.unlinkSync(probe);
  } catch (error) {
    t.skip(
      `Filesystem junctions are unavailable: ${error.code || error.message}`,
    );
    return;
  }

  assert.throws(
    () =>
      extractArchiveEntries(fixture.archivePath, ["safe/file.txt"], {
        sevenZipPath: "trusted-7za",
        spawnSyncImpl: (_command, args) => {
          if (args[0] === "l") {
            return {
              status: 0,
              stdout: archiveListing([{ path: "safe/file.txt", size: 7 }]),
              stderr: "",
            };
          }
          fs.symlinkSync(
            outside,
            path.join(extractionDestination(args), "safe"),
            "junction",
          );
          return { status: 0, stdout: "", stderr: "" };
        },
      }),
    /must not be a link, junction, or reparse point/,
  );
});

test("archive verification refuses multiply linked and unexpected extracted files", (t) => {
  const fixture = createMockArchive(t);
  const outsideFile = path.join(fixture.root, "outside.txt");
  writeFile(outsideFile, "outside");
  const listing = archiveListing([{ path: "safe/file.txt", size: 7 }]);
  try {
    const probe = path.join(fixture.root, "hardlink-probe.txt");
    fs.linkSync(outsideFile, probe);
    fs.unlinkSync(probe);
  } catch (error) {
    t.skip(
      `Filesystem hardlinks are unavailable: ${error.code || error.message}`,
    );
    return;
  }

  assert.throws(
    () =>
      extractArchiveEntries(fixture.archivePath, ["safe/file.txt"], {
        sevenZipPath: "trusted-7za",
        spawnSyncImpl: (_command, args) => {
          if (args[0] === "l") {
            return { status: 0, stdout: listing, stderr: "" };
          }
          const outputPath = path.join(
            extractionDestination(args),
            "safe",
            "file.txt",
          );
          fs.mkdirSync(path.dirname(outputPath), { recursive: true });
          fs.linkSync(outsideFile, outputPath);
          return { status: 0, stdout: "", stderr: "" };
        },
      }),
    /must not be a multiply linked file/,
  );

  assert.throws(
    () =>
      extractArchiveEntries(fixture.archivePath, ["safe/file.txt"], {
        sevenZipPath: "trusted-7za",
        spawnSyncImpl: (_command, args) => {
          if (args[0] === "l") {
            return { status: 0, stdout: listing, stderr: "" };
          }
          const destination = extractionDestination(args);
          writeFile(path.join(destination, "safe", "file.txt"), "outside");
          writeFile(path.join(destination, "safe", "surprise.txt"), "extra");
          return { status: 0, stdout: "", stderr: "" };
        },
      }),
    /created an unexpected file/,
  );
});

test("Authenticode inspection uses non-interactive PowerShell and a literal env path", (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "arenzyra-authenticode-literal-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installerPath = path.join(root, "launcher 'quoted'; name.exe");
  writeFile(installerPath, "signed-fixture");
  const calls = [];
  const gates = mockReleaseGates(calls);
  const result = verifyInstallerAuthenticode({
    installerPath,
    ...gates.authenticode,
  });
  assert.equal(result.authenticodeStatus, "Valid");
  assert.equal(result.status, "verified");
  assert.equal(result.subject, FIXTURE_SIGNER_SUBJECT);
  assert.equal(result.thumbprint, FIXTURE_SIGNER_THUMBPRINT);
  assert.equal(result.certificateSha256, FIXTURE_SIGNER_CERTIFICATE_SHA256);
  assert.equal(calls.length, 1);
  assert.match(calls[0].command, /powershell\.exe$/i);
  assert.ok(calls[0].args.includes("-NoProfile"));
  assert.ok(calls[0].args.includes("-NonInteractive"));
  assert.ok(calls[0].args.includes(AUTHENTICODE_INSPECTION_SCRIPT));
  assert.match(AUTHENTICODE_INSPECTION_SCRIPT, /-LiteralPath \$targetPath/);
  assert.doesNotMatch(AUTHENTICODE_INSPECTION_SCRIPT, /quoted/);
  assert.equal(
    calls[0].options.env[AUTHENTICODE_TARGET_ENV],
    path.resolve(installerPath),
  );
  assert.equal(
    calls[0].args.some((argument) =>
      argument.includes(path.resolve(installerPath)),
    ),
    false,
  );
});

test("Authenticode resolver refuses an ambient Windows root on another drive", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-auth-root-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installerPath = path.join(root, "launcher.exe");
  writeFile(installerPath, "fixture");
  assert.throws(
    () =>
      verifyInstallerAuthenticode({
        installerPath,
        platform: "win32",
        processExecPath: "C:\\Program Files\\nodejs\\node.exe",
        env: { SystemRoot: "D:\\Windows", WINDIR: "D:\\Windows" },
        isFile: () => true,
        trustedSignerConfig: approvedSignerConfig(),
      }),
    /Windows system root is unsafe or inconsistent/,
  );
});

test("Authenticode verification refuses unsupported platforms", (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "arenzyra-auth-platform-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installerPath = path.join(root, "launcher.exe");
  writeFile(installerPath, "fixture");
  let spawnCalls = 0;
  assert.throws(
    () =>
      verifyInstallerAuthenticode({
        installerPath,
        platform: "linux",
        spawnSyncImpl: () => {
          spawnCalls += 1;
        },
      }),
    /unsupported on linux.*publication is refused/i,
  );
  assert.equal(spawnCalls, 0);
});

test("Authenticode verification requires Valid status and the exact reviewed signer", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-auth-status-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installerPath = path.join(root, "launcher.exe");
  writeFile(installerPath, "fixture");
  const base = mockReleaseGates().authenticode;
  assert.throws(
    () =>
      verifyInstallerAuthenticode({
        installerPath,
        ...base,
        spawnSyncImpl: () => ({
          status: 0,
          stdout: JSON.stringify(
            validAuthenticodeResult({ status: "NotSigned" }),
          ),
        }),
      }),
    /status is not Valid: NotSigned/,
  );
  assert.throws(
    () =>
      verifyInstallerAuthenticode({
        installerPath,
        ...base,
        spawnSyncImpl: () => ({
          status: 0,
          stdout: JSON.stringify(
            validAuthenticodeResult({
              subject: "CN=Attacker",
              thumbprint: "F".repeat(40),
            }),
          ),
        }),
      }),
    /signer certificate is not in the reviewed allowlist/,
  );
  assert.throws(
    () =>
      verifyInstallerAuthenticode({
        installerPath,
        ...base,
        spawnSyncImpl: () => ({
          status: 0,
          stdout: JSON.stringify(
            validAuthenticodeResult({ certificateSha256: "B".repeat(64) }),
          ),
        }),
      }),
    /signer certificate is not in the reviewed allowlist/,
  );
});

test("Authenticode verification rejects a valid signer without a timestamp certificate", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-auth-time-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installerPath = path.join(root, "launcher.exe");
  writeFile(installerPath, "fixture");
  const base = mockReleaseGates().authenticode;
  assert.throws(
    () =>
      verifyInstallerAuthenticode({
        installerPath,
        ...base,
        spawnSyncImpl: () => ({
          status: 0,
          stdout: JSON.stringify(
            validAuthenticodeResult({
              timestampSubject: null,
              timestampThumbprint: null,
              timestampCertificateSha256: null,
            }),
          ),
        }),
      }),
    /trusted Authenticode timestamp certificate/,
  );
});

test("Authenticode verification rejects an unreviewed timestamp authority", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-auth-tsa-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installerPath = path.join(root, "launcher.exe");
  writeFile(installerPath, "fixture");
  const base = mockReleaseGates().authenticode;
  assert.throws(
    () =>
      verifyInstallerAuthenticode({
        installerPath,
        ...base,
        spawnSyncImpl: () => ({
          status: 0,
          stdout: JSON.stringify(
            validAuthenticodeResult({
              timestampCertificateSha256: "D".repeat(64),
            }),
          ),
        }),
      }),
    /timestamp certificate is not in the reviewed allowlist/,
  );
});

test("tracked production Authenticode policy remains empty and unapproved", () => {
  const config = JSON.parse(
    fs.readFileSync(DEFAULT_TRUSTED_SIGNER_CONFIG_PATH, "utf8"),
  );
  assert.equal(config.approval.state, "unapproved");
  assert.deepEqual(config.trustedSigners, []);
  assert.deepEqual(config.trustedTimestampAuthorities, []);
  assert.throws(
    () => validateTrustedSignerConfig(config),
    /allowlist is empty, unapproved/,
  );
});

test("Authenticode policy rejects future-dated approval metadata", () => {
  const config = approvedSignerConfig();
  config.approval.reviewedAt = "2026-08-10T12:00:00.000Z";
  assert.throws(
    () =>
      validateTrustedSignerConfig(
        config,
        "a".repeat(64),
        new Date("2026-08-09T12:00:00.000Z"),
      ),
    /allowlist is empty, unapproved/,
  );
});

test("launcher publication manifest includes verified signer and map provenance metadata", () => {
  const syncSource = fs.readFileSync(
    path.resolve(__dirname, "sync-launcher-downloads.cjs"),
    "utf8",
  );
  assert.match(syncSource, /signing:\s*installer\.signing/);
  assert.match(syncSource, /verifiedMapProvenance/);
  assert.match(syncSource, /verified\.mapProvenance\.provenanceSha256/);
});

test("launcher release source recursion refuses symlinks and junctions", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-release-link-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, "source");
  const outsidePath = path.join(root, "outside.js");
  writeFile(path.join(sourceRoot, "main.cjs"), "module.exports = 1;");
  writeFile(outsidePath, "module.exports = 'outside';");
  try {
    fs.symlinkSync(outsidePath, path.join(sourceRoot, "linked.cjs"), "file");
  } catch (error) {
    t.skip(`Filesystem links are unavailable: ${error.code || error.message}`);
    return;
  }
  assert.throws(
    () => recursiveSourceEntries(sourceRoot, "resources/app"),
    /must not be a symbolic link or junction/,
  );
});

test("launcher release source recursion refuses multiply linked files", (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "arenzyra-release-hardlink-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, "source");
  const sourcePath = path.join(sourceRoot, "main.cjs");
  const linkedPath = path.join(sourceRoot, "linked.cjs");
  writeFile(sourcePath, "module.exports = 1;");
  try {
    fs.linkSync(sourcePath, linkedPath);
  } catch (error) {
    t.skip(
      `Filesystem hardlinks are unavailable: ${error.code || error.message}`,
    );
    return;
  }
  assert.throws(
    () => recursiveSourceEntries(sourceRoot, "resources/app"),
    /must not be a multiply linked file/,
  );
});

test("default release verification covers runtime, map, widget, renderer, and static assets", () => {
  const entries = new Set(
    defaultSourceEntries().map((entry) => entry.entryPath),
  );
  for (const required of [
    "resources/connectors/ob.js",
    "resources/connectors/connector-http-access-policy.cjs",
    "resources/app/electron/main.cjs",
    "resources/app/electron/telemetryBridge.cjs",
    "resources/app/electron/observerFeedSupervisor.cjs",
    "resources/app/electron/map-engine/map-registry.cjs",
    "resources/app/electron/map-engine/telemetry-map-bridge.cjs",
    "resources/app/electron/widget-server/server.cjs",
    "resources/app/electron/widget-server/public/obs-map-widget.js",
    "resources/app/electron/assets/maps/map-not-available.svg",
    "resources/app/dist/index.html",
    "resources/default-team.png",
    "resources/default-player.svg",
  ]) {
    assert.ok(
      entries.has(required),
      `missing release verification for ${required}`,
    );
  }
  assert.ok(
    entries.size > 100,
    "release verification set is unexpectedly small",
  );
  assert.deepEqual(
    [...entries].filter((entryPath) =>
      /^resources\/app\/electron\/assets\/maps\/.+\.(?:jpe?g|png|webp)$/i.test(
        entryPath,
      ),
    ),
    [],
  );
});

test("bundled default player is a passive project vector", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../apps/desktop/build/default-player.svg"),
    "utf8",
  );

  assert.match(source, /<svg\b/);
  assert.doesNotMatch(source, /<script\b/i);
  assert.doesNotMatch(source, /<foreignObject\b/i);
  assert.doesNotMatch(source, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(source, /\b(?:xlink:)?href\s*=/i);
});
