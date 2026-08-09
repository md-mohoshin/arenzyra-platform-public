"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  DEFAULT_PROVENANCE_PATH,
  DesktopConnectorProvenanceError,
  MAX_EVIDENCE_DOCUMENT_BYTES,
  sha256Buffer,
  verifyDesktopConnectorCommercialProvenance,
} = require("./verify-desktop-connector-provenance.cjs");

const FIXED_NOW = "2026-08-09T12:00:00.000Z";

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function createFixture(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "arenzyra-connector-rights-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const connectorPath = path.join(root, "ob.js");
  const provenancePath = path.join(root, "provenance.json");
  const connectorBytes = Buffer.from("bounded connector fixture\n");
  writeFile(connectorPath, connectorBytes);
  const connectorSha256 = sha256Buffer(connectorBytes);
  const provenance = {
    schemaVersion: 1,
    scope: "fixture commercial connector redistribution",
    repositoryReview: {
      state: "reviewed-unapproved",
      historyScope: "fixture local history only",
      exactBytesFirstObservedAtLocalCommit: "a".repeat(40),
      currentHeaderLicenseNotice: "absent",
      commercialRightsEvidence: "not-provided",
      reviewMethod: "fixture technical review, not commercial approval",
    },
    connector: {
      path: "ob.js",
      sizeBytes: connectorBytes.length,
      sha256: connectorSha256,
      approvalState: "unapproved",
      evidenceIds: [],
    },
    commercialReleaseApproval: {
      state: "unapproved",
      reviewedBy: null,
      reviewedAt: null,
      reviewReference: null,
    },
    evidence: [],
  };
  const save = () =>
    fs.writeFileSync(
      provenancePath,
      `${JSON.stringify(provenance, null, 2)}\n`,
    );
  save();
  return {
    connectorBytes,
    connectorPath,
    connectorSha256,
    evidenceDocuments: new Map(),
    now: () => new Date(FIXED_NOW),
    provenance,
    provenancePath,
    root,
    save,
  };
}

function approveFixture(fixture) {
  const id = "fixture-commercial-permission";
  const documentBytes = Buffer.from(
    "fixture commercial redistribution permission bytes",
  );
  fixture.provenance.repositoryReview.state = "reviewed-approved";
  fixture.provenance.repositoryReview.commercialRightsEvidence =
    "provided-and-reviewed";
  fixture.provenance.connector.approvalState = "approved";
  fixture.provenance.connector.evidenceIds = [id];
  fixture.provenance.commercialReleaseApproval = {
    state: "approved",
    reviewedBy: "Fixture Rights Reviewer",
    reviewedAt: "2026-08-09T10:00:00.000Z",
    reviewReference: "FIXTURE-RIGHTS-123",
  };
  fixture.provenance.evidence = [
    {
      id,
      type: "written-commercial-redistribution-permission",
      issuer: "Fixture Rights Holder",
      grantedTo: "Arenzyra Fixture",
      reference: "fixture://permission/123",
      documentSha256: crypto
        .createHash("sha256")
        .update(documentBytes)
        .digest("hex"),
      authorizedConnectorSha256: fixture.connectorSha256,
      reviewState: "approved",
      reviewedBy: "Fixture Rights Reviewer",
      reviewedAt: "2026-08-09T10:00:00.000Z",
    },
  ];
  fixture.evidenceDocuments.set(id, documentBytes);
  fixture.save();
}

function expectCode(callback, code) {
  assert.throws(
    callback,
    (error) =>
      error instanceof DesktopConnectorProvenanceError && error.code === code,
  );
}

test("tracked policy binds the exact current ob.js bytes and remains explicitly unapproved", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const connectorBytes = fs.readFileSync(path.join(repoRoot, "ob.js"));
  const policy = JSON.parse(fs.readFileSync(DEFAULT_PROVENANCE_PATH, "utf8"));
  assert.equal(connectorBytes.length, 228486);
  assert.equal(
    sha256Buffer(connectorBytes),
    "8e7fce4590389834eaf048c67f530d2f241bca08dbdd5c7faccc539ad61761db",
  );
  assert.equal(policy.connector.sizeBytes, connectorBytes.length);
  assert.equal(policy.connector.sha256, sha256Buffer(connectorBytes));
  assert.equal(policy.connector.approvalState, "unapproved");
  assert.equal(policy.commercialReleaseApproval.state, "unapproved");
  assert.equal(policy.repositoryReview.state, "reviewed-unapproved");
  assert.equal(
    policy.repositoryReview.exactBytesFirstObservedAtLocalCommit,
    "929c34d3b102037dba7f606f882273008439a4be",
  );
  assert.equal(policy.repositoryReview.currentHeaderLicenseNotice, "absent");

  expectCode(
    () => verifyDesktopConnectorCommercialProvenance({ repoRoot }),
    "ARENZYRA_CONNECTOR_PROVENANCE_UNAPPROVED",
  );
});

test("command-line gate fails closed without executing the connector", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, "scripts", "verify-desktop-connector-provenance.cjs")],
    { cwd: repoRoot, encoding: "utf8", windowsHide: true },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(
    result.stderr,
    /desktop-connector-provenance.*explicitly unapproved/i,
  );
});

test("connector gate accepts only approved exact bytes plus out-of-band reviewed evidence bytes", (t) => {
  const fixture = createFixture(t);
  approveFixture(fixture);
  const result = verifyDesktopConnectorCommercialProvenance(fixture);
  assert.equal(result.ok, true);
  assert.equal(result.connectorSha256, fixture.connectorSha256);
  assert.equal(result.connectorSizeBytes, fixture.connectorBytes.length);
  assert.equal(result.approval.state, "approved");
  assert.deepEqual(result.approval.evidenceIds, [
    "fixture-commercial-permission",
  ]);
});

test("connector gate rejects a missing policy", (t) => {
  const fixture = createFixture(t);
  fs.rmSync(fixture.provenancePath);
  expectCode(
    () => verifyDesktopConnectorCommercialProvenance(fixture),
    "ARENZYRA_CONNECTOR_PROVENANCE_INPUT_MISSING",
  );
});

test("connector gate rejects invalid policy JSON", (t) => {
  const fixture = createFixture(t);
  fs.writeFileSync(fixture.provenancePath, "{not-json\n");
  expectCode(
    () => verifyDesktopConnectorCommercialProvenance(fixture),
    "ARENZYRA_CONNECTOR_PROVENANCE_INVALID",
  );
});

test("connector gate rejects a byte or size mismatch before approval metadata", (t) => {
  const fixture = createFixture(t);
  fs.writeFileSync(fixture.connectorPath, "changed connector bytes\n");
  expectCode(
    () => verifyDesktopConnectorCommercialProvenance(fixture),
    "ARENZYRA_CONNECTOR_PROVENANCE_HASH_MISMATCH",
  );
});

test("connector gate rejects forged approval metadata without a reviewed-approved repository disposition", (t) => {
  const fixture = createFixture(t);
  approveFixture(fixture);
  fixture.provenance.repositoryReview.state = "reviewed-unapproved";
  fixture.save();
  expectCode(
    () => verifyDesktopConnectorCommercialProvenance(fixture),
    "ARENZYRA_CONNECTOR_PROVENANCE_REVIEW_INVALID",
  );
});

test("connector gate rejects claimed evidence without out-of-band document bytes", (t) => {
  const fixture = createFixture(t);
  approveFixture(fixture);
  fixture.evidenceDocuments.clear();
  expectCode(
    () => verifyDesktopConnectorCommercialProvenance(fixture),
    "ARENZYRA_CONNECTOR_PROVENANCE_EVIDENCE_DOCUMENT_MISMATCH",
  );
});

test("connector gate rejects out-of-band evidence with the wrong exact bytes", (t) => {
  const fixture = createFixture(t);
  approveFixture(fixture);
  fixture.evidenceDocuments.set(
    "fixture-commercial-permission",
    Buffer.from("different evidence document"),
  );
  expectCode(
    () => verifyDesktopConnectorCommercialProvenance(fixture),
    "ARENZYRA_CONNECTOR_PROVENANCE_EVIDENCE_DOCUMENT_MISMATCH",
  );
});

test("connector gate bounds out-of-band evidence bytes", (t) => {
  const fixture = createFixture(t);
  approveFixture(fixture);
  fixture.evidenceDocuments.set(
    "fixture-commercial-permission",
    Buffer.alloc(MAX_EVIDENCE_DOCUMENT_BYTES + 1),
  );
  expectCode(
    () => verifyDesktopConnectorCommercialProvenance(fixture),
    "ARENZYRA_CONNECTOR_PROVENANCE_EVIDENCE_DOCUMENT_MISMATCH",
  );
});

test("connector gate binds legal evidence to the exact approved connector hash", (t) => {
  const fixture = createFixture(t);
  approveFixture(fixture);
  fixture.provenance.evidence[0].authorizedConnectorSha256 = "f".repeat(64);
  fixture.save();
  expectCode(
    () => verifyDesktopConnectorCommercialProvenance(fixture),
    "ARENZYRA_CONNECTOR_PROVENANCE_EVIDENCE_INVALID",
  );
});

test("connector gate rejects future-dated commercial approval", (t) => {
  const fixture = createFixture(t);
  approveFixture(fixture);
  fixture.provenance.commercialReleaseApproval.reviewedAt =
    "2026-08-10T12:00:00.000Z";
  fixture.save();
  expectCode(
    () => verifyDesktopConnectorCommercialProvenance(fixture),
    "ARENZYRA_CONNECTOR_PROVENANCE_UNAPPROVED",
  );
});

for (const target of ["connector", "policy"]) {
  test(`connector gate refuses a symbolic-link ${target} input`, (t) => {
    const fixture = createFixture(t);
    const targetPath =
      target === "connector" ? fixture.connectorPath : fixture.provenancePath;
    const outsidePath = path.join(fixture.root, `outside-${target}.txt`);
    fs.copyFileSync(targetPath, outsidePath);
    fs.rmSync(targetPath);
    try {
      fs.symlinkSync(outsidePath, targetPath, "file");
    } catch (error) {
      t.skip(
        `Filesystem links are unavailable: ${error.code || error.message}`,
      );
      return;
    }
    expectCode(
      () => verifyDesktopConnectorCommercialProvenance(fixture),
      "ARENZYRA_CONNECTOR_PROVENANCE_LINK_REFUSED",
    );
  });

  test(`connector gate refuses a multiply-linked ${target} input`, (t) => {
    const fixture = createFixture(t);
    const targetPath =
      target === "connector" ? fixture.connectorPath : fixture.provenancePath;
    try {
      fs.linkSync(targetPath, path.join(fixture.root, `${target}-hardlink`));
    } catch (error) {
      t.skip(
        `Filesystem hardlinks are unavailable: ${error.code || error.message}`,
      );
      return;
    }
    expectCode(
      () => verifyDesktopConnectorCommercialProvenance(fixture),
      "ARENZYRA_CONNECTOR_PROVENANCE_HARDLINK_REFUSED",
    );
  });
}
