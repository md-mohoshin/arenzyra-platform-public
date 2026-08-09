"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  DesktopMapProvenanceError,
  NO_BUNDLED_COMMERCIAL_ASSETS_STATE,
  sha256File,
  verifyDesktopMapCommercialProvenance,
} = require("./verify-desktop-map-provenance.cjs");

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-map-rights-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const mapsDir = path.join(root, "maps");
  const provenancePath = path.join(root, "provenance.json");
  writeFile(path.join(mapsDir, "erangel.png"), "erangel-image");
  writeFile(path.join(mapsDir, "rondo.webp"), "rondo-image");
  writeFile(path.join(mapsDir, "map-not-available.svg"), "fallback-vector");

  const assets = ["erangel.png", "rondo.webp"].map((assetPath) => ({
    path: assetPath,
    sha256: sha256File(path.join(mapsDir, assetPath)),
    approvalState: "unverified",
    evidenceIds: [],
  }));
  const provenance = {
    schemaVersion: 1,
    commercialReleaseApproval: {
      state: "unverified",
      reviewedBy: null,
      reviewedAt: null,
      reviewReference: null,
    },
    evidence: [],
    assets,
  };
  const save = () =>
    fs.writeFileSync(
      provenancePath,
      `${JSON.stringify(provenance, null, 2)}\n`,
    );
  save();
  return {
    assets,
    evidenceDocuments: new Map(),
    mapsDir,
    now: () => new Date("2026-08-09T12:00:00.000Z"),
    provenance,
    provenancePath,
    root,
    save,
  };
}

function approveFixture(fixture) {
  const evidenceId = "fixture-written-permission";
  const evidenceDocument = Buffer.from("fixture written permission bytes");
  fixture.provenance.commercialReleaseApproval = {
    state: "approved",
    reviewedBy: "Fixture Legal Reviewer",
    reviewedAt: "2026-08-09T10:00:00.000Z",
    reviewReference: "LEGAL-REVIEW-123",
  };
  fixture.provenance.evidence = [
    {
      id: evidenceId,
      type: "written-redistribution-permission",
      issuer: "Fixture Rights Holder",
      grantedTo: "Arenzyra Fixture",
      reference: "fixture://written-permission/123",
      documentSha256: crypto
        .createHash("sha256")
        .update(evidenceDocument)
        .digest("hex"),
      reviewState: "approved",
      reviewedBy: "Fixture Legal Reviewer",
      reviewedAt: "2026-08-09T10:00:00.000Z",
      assetScope: ["*"],
    },
  ];
  for (const asset of fixture.provenance.assets) {
    asset.approvalState = "approved";
    asset.evidenceIds = [evidenceId];
  }
  fixture.evidenceDocuments.set(evidenceId, evidenceDocument);
  fixture.save();
}

function removeCommercialAssets(fixture) {
  for (const asset of fixture.assets) {
    fs.rmSync(path.join(fixture.mapsDir, asset.path));
  }
  fixture.provenance.assets = [];
  fixture.provenance.evidence = [];
  fixture.provenance.commercialReleaseApproval = {
    state: NO_BUNDLED_COMMERCIAL_ASSETS_STATE,
    reviewedBy: null,
    reviewedAt: null,
    reviewReference: null,
  };
  fixture.save();
}

test("map provenance gate rejects a missing inventory", (t) => {
  const fixture = createFixture(t);
  fs.rmSync(fixture.provenancePath);
  assert.throws(
    () => verifyDesktopMapCommercialProvenance(fixture),
    (error) =>
      error instanceof DesktopMapProvenanceError &&
      error.code === "ARENZYRA_MAP_PROVENANCE_INVENTORY_MISSING",
  );
});

test("map provenance gate accepts an exact zero raster inventory only in the explicit not-applicable state", (t) => {
  const fixture = createFixture(t);
  removeCommercialAssets(fixture);

  const result = verifyDesktopMapCommercialProvenance(fixture);
  assert.equal(result.ok, true);
  assert.equal(result.assetCount, 0);
  assert.deepEqual(result.assets, {});
  assert.deepEqual(result.approval, {
    state: NO_BUNDLED_COMMERCIAL_ASSETS_STATE,
    reviewedAt: null,
    reviewedBy: null,
    reviewReference: null,
    evidenceIds: [],
  });
});

test("map provenance gate rejects an empty raster inventory without the explicit not-applicable state", (t) => {
  const fixture = createFixture(t);
  removeCommercialAssets(fixture);
  fixture.provenance.commercialReleaseApproval.state = "unverified";
  fixture.save();

  assert.throws(
    () => verifyDesktopMapCommercialProvenance(fixture),
    (error) =>
      error instanceof DesktopMapProvenanceError &&
      error.code === "ARENZYRA_MAP_PROVENANCE_EMPTY_STATE_INVALID",
  );
});

test("map provenance gate rejects commercial evidence in the no-raster state", (t) => {
  const fixture = createFixture(t);
  removeCommercialAssets(fixture);
  fixture.provenance.evidence = [{ id: "stale-evidence" }];
  fixture.save();

  assert.throws(
    () => verifyDesktopMapCommercialProvenance(fixture),
    (error) =>
      error instanceof DesktopMapProvenanceError &&
      error.code === "ARENZYRA_MAP_PROVENANCE_EMPTY_STATE_INVALID",
  );
});

test("map provenance gate requires an exact bundled asset inventory", (t) => {
  const fixture = createFixture(t);
  fixture.provenance.assets.pop();
  fixture.save();
  assert.throws(
    () => verifyDesktopMapCommercialProvenance(fixture),
    (error) =>
      error instanceof DesktopMapProvenanceError &&
      error.code === "ARENZYRA_MAP_PROVENANCE_INVENTORY_MISMATCH" &&
      error.details.missingFromInventory.includes("rondo.webp"),
  );
});

test("map provenance gate rejects a hash mismatch", (t) => {
  const fixture = createFixture(t);
  writeFile(path.join(fixture.mapsDir, "erangel.png"), "replaced-image");
  assert.throws(
    () => verifyDesktopMapCommercialProvenance(fixture),
    (error) =>
      error instanceof DesktopMapProvenanceError &&
      error.code === "ARENZYRA_MAP_PROVENANCE_HASH_MISMATCH",
  );
});

test("map provenance gate refuses nested linked or redirected rasters", (t) => {
  const fixture = createFixture(t);
  const outsidePath = path.join(fixture.root, "outside.png");
  writeFile(outsidePath, "outside-map");
  const linkPath = path.join(fixture.mapsDir, "nested", "linked.png");
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  try {
    fs.symlinkSync(outsidePath, linkPath, "file");
  } catch (error) {
    t.skip(`Filesystem links are unavailable: ${error.code || error.message}`);
    return;
  }
  assert.throws(
    () => verifyDesktopMapCommercialProvenance(fixture),
    (error) =>
      error instanceof DesktopMapProvenanceError &&
      error.code === "ARENZYRA_MAP_PROVENANCE_LINK_REFUSED",
  );
});

test("map provenance gate refuses multiply linked map files", (t) => {
  const fixture = createFixture(t);
  const linkedPath = path.join(fixture.root, "linked-erangel.png");
  try {
    fs.linkSync(path.join(fixture.mapsDir, "erangel.png"), linkedPath);
  } catch (error) {
    t.skip(
      `Filesystem hard links are unavailable: ${error.code || error.message}`,
    );
    return;
  }
  assert.throws(
    () => verifyDesktopMapCommercialProvenance(fixture),
    (error) =>
      error instanceof DesktopMapProvenanceError &&
      error.code === "ARENZYRA_MAP_PROVENANCE_HARDLINK_REFUSED",
  );
});

test("map provenance gate rejects exact but unapproved assets", (t) => {
  const fixture = createFixture(t);
  assert.throws(
    () => verifyDesktopMapCommercialProvenance(fixture),
    (error) =>
      error instanceof DesktopMapProvenanceError &&
      error.code === "ARENZYRA_MAP_PROVENANCE_UNAPPROVED",
  );
});

test("map provenance gate accepts exact hashes with reviewed license evidence", (t) => {
  const fixture = createFixture(t);
  approveFixture(fixture);
  const result = verifyDesktopMapCommercialProvenance(fixture);
  assert.equal(result.ok, true);
  assert.equal(result.assetCount, 2);
  assert.equal(result.approval.state, "approved");
  assert.deepEqual(result.approval.evidenceIds, ["fixture-written-permission"]);
});

test("map provenance gate rejects claimed evidence without the reviewed bytes", (t) => {
  const fixture = createFixture(t);
  approveFixture(fixture);
  fixture.evidenceDocuments.clear();
  assert.throws(
    () => verifyDesktopMapCommercialProvenance(fixture),
    (error) =>
      error instanceof DesktopMapProvenanceError &&
      error.code === "ARENZYRA_MAP_PROVENANCE_EVIDENCE_DOCUMENT_MISMATCH",
  );
});

test("map provenance gate rejects future-dated approvals", (t) => {
  const fixture = createFixture(t);
  approveFixture(fixture);
  fixture.provenance.commercialReleaseApproval.reviewedAt =
    "2026-08-10T12:00:00.000Z";
  fixture.save();
  assert.throws(
    () => verifyDesktopMapCommercialProvenance(fixture),
    (error) =>
      error instanceof DesktopMapProvenanceError &&
      error.code === "ARENZYRA_MAP_PROVENANCE_UNAPPROVED",
  );
});
