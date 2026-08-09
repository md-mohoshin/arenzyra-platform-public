#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_MAPS_DIR = path.join(
  DEFAULT_REPO_ROOT,
  "apps",
  "desktop",
  "electron",
  "assets",
  "maps",
);
const DEFAULT_PROVENANCE_PATH = path.join(
  DEFAULT_REPO_ROOT,
  "apps",
  "desktop",
  "release",
  "pubg-map-commercial-provenance.json",
);
const COMMERCIAL_MAP_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const ACCEPTED_EVIDENCE_TYPES = new Set([
  "api-license",
  "tournament-license",
  "written-redistribution-permission",
]);
const NO_BUNDLED_COMMERCIAL_ASSETS_STATE =
  "not-applicable-no-bundled-commercial-assets";
const REVIEW_CLOCK_SKEW_MS = 5 * 60 * 1000;

class DesktopMapProvenanceError extends Error {
  constructor(message, code, details = null) {
    super(message);
    this.name = "DesktopMapProvenanceError";
    this.code = code;
    this.details = details;
  }
}

function fail(message, code, details) {
  throw new DesktopMapProvenanceError(message, code, details);
}

function sha256File(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || "").trim());
}

function isReviewedDate(value, nowMs) {
  const text = String(value || "").trim();
  const parsed = Date.parse(text);
  return Boolean(
    text && Number.isFinite(parsed) && parsed <= nowMs + REVIEW_CLOCK_SKEW_MS,
  );
}

function comparablePath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function assertPathNotRedirected(filePath, displayPath) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) {
    fail(
      `Desktop map provenance refuses linked assets: ${displayPath}.`,
      "ARENZYRA_MAP_PROVENANCE_LINK_REFUSED",
    );
  }
  const physicalPath = fs.realpathSync.native(filePath);
  if (comparablePath(physicalPath) !== comparablePath(filePath)) {
    fail(
      `Desktop map provenance refuses redirected/reparse assets: ${displayPath}.`,
      "ARENZYRA_MAP_PROVENANCE_REPARSE_REFUSED",
    );
  }
  if (stat.isFile() && stat.nlink !== 1) {
    fail(
      `Desktop map provenance refuses multiply linked files: ${displayPath}.`,
      "ARENZYRA_MAP_PROVENANCE_HARDLINK_REFUSED",
    );
  }
  return stat;
}

function sameFileSnapshot(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function readStableRegularFile(filePath, displayPath) {
  const before = assertPathNotRedirected(filePath, displayPath);
  if (!before.isFile()) {
    fail(
      `Desktop map provenance expected a regular file: ${displayPath}.`,
      "ARENZYRA_MAP_PROVENANCE_INVALID",
    );
  }
  const descriptor = fs.openSync(filePath, "r");
  try {
    const opened = fs.fstatSync(descriptor);
    if (!sameFileSnapshot(before, opened)) {
      fail(
        `Desktop map provenance input changed while opening: ${displayPath}.`,
        "ARENZYRA_MAP_PROVENANCE_RACE_REFUSED",
      );
    }
    const bytes = fs.readFileSync(descriptor);
    const afterRead = fs.fstatSync(descriptor);
    const afterPath = assertPathNotRedirected(filePath, displayPath);
    if (
      !sameFileSnapshot(opened, afterRead) ||
      !sameFileSnapshot(afterRead, afterPath) ||
      bytes.length !== afterRead.size
    ) {
      fail(
        `Desktop map provenance input changed while reading: ${displayPath}.`,
        "ARENZYRA_MAP_PROVENANCE_RACE_REFUSED",
      );
    }
    return bytes;
  } finally {
    fs.closeSync(descriptor);
  }
}

function listCommercialMapAssets(mapsDir) {
  if (!fs.existsSync(mapsDir) || !fs.statSync(mapsDir).isDirectory()) {
    fail(
      `Desktop map asset directory is missing: ${mapsDir}`,
      "ARENZYRA_MAP_PROVENANCE_MAPS_MISSING",
    );
  }
  assertPathNotRedirected(mapsDir, path.resolve(mapsDir));
  const assets = [];
  const visit = (directory, relativeDirectory = "") => {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const fullPath = path.join(directory, entry.name);
      const stat = assertPathNotRedirected(fullPath, relativePath);
      if (stat.isDirectory()) {
        visit(fullPath, relativePath);
      } else if (
        stat.isFile() &&
        COMMERCIAL_MAP_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ) {
        assets.push(relativePath);
      }
    }
  };
  visit(mapsDir);
  return assets.sort((left, right) => left.localeCompare(right));
}

function readProvenance(provenancePath) {
  if (!fs.existsSync(provenancePath)) {
    fail(
      `Desktop map provenance inventory is missing: ${provenancePath}`,
      "ARENZYRA_MAP_PROVENANCE_INVENTORY_MISSING",
    );
  }
  const bytes = readStableRegularFile(
    provenancePath,
    path.resolve(provenancePath),
  );
  try {
    return {
      bytes,
      provenance: JSON.parse(bytes.toString("utf8")),
      sha256: sha256Buffer(bytes),
    };
  } catch (error) {
    fail(
      `Desktop map provenance inventory is invalid JSON: ${error.message}`,
      "ARENZYRA_MAP_PROVENANCE_INVALID",
    );
  }
}

function normalizedAssetEntries(provenance) {
  if (provenance?.schemaVersion !== 1 || !Array.isArray(provenance?.assets)) {
    fail(
      "Desktop map provenance inventory must use schemaVersion 1 and contain assets.",
      "ARENZYRA_MAP_PROVENANCE_INVALID",
    );
  }
  const seen = new Set();
  return provenance.assets.map((asset) => {
    const assetPath = String(asset?.path || "").trim();
    const normalizedPath = path.posix.normalize(assetPath);
    if (
      !assetPath ||
      assetPath.includes("\\") ||
      path.posix.isAbsolute(assetPath) ||
      normalizedPath !== assetPath ||
      normalizedPath === ".." ||
      normalizedPath.startsWith("../") ||
      !COMMERCIAL_MAP_EXTENSIONS.has(path.extname(assetPath).toLowerCase()) ||
      seen.has(assetPath.toLowerCase())
    ) {
      fail(
        `Desktop map provenance contains an unsafe or duplicate asset path: ${assetPath || "<empty>"}`,
        "ARENZYRA_MAP_PROVENANCE_INVALID",
      );
    }
    seen.add(assetPath.toLowerCase());
    if (!isSha256(asset.sha256)) {
      fail(
        `Desktop map provenance has an invalid SHA-256 for ${assetPath}.`,
        "ARENZYRA_MAP_PROVENANCE_INVALID",
      );
    }
    return {
      path: assetPath,
      sha256: String(asset.sha256).toLowerCase(),
      approvalState: String(asset.approvalState || "")
        .trim()
        .toLowerCase(),
      evidenceIds: Array.isArray(asset.evidenceIds)
        ? asset.evidenceIds
            .map((value) => String(value || "").trim())
            .filter(Boolean)
        : [],
    };
  });
}

function assertExactAssetInventory(actualPaths, assets) {
  const actual = new Set(actualPaths.map((value) => value.toLowerCase()));
  const inventoried = new Set(assets.map((asset) => asset.path.toLowerCase()));
  const missingFromInventory = actualPaths.filter(
    (assetPath) => !inventoried.has(assetPath.toLowerCase()),
  );
  const missingFromBundle = assets
    .map((asset) => asset.path)
    .filter((assetPath) => !actual.has(assetPath.toLowerCase()));
  if (missingFromInventory.length || missingFromBundle.length) {
    fail(
      "Desktop map provenance inventory does not exactly match the bundled commercial map images.",
      "ARENZYRA_MAP_PROVENANCE_INVENTORY_MISMATCH",
      { missingFromInventory, missingFromBundle },
    );
  }
}

function validateApprovedEvidence(
  provenance,
  assets,
  { evidenceDocuments, nowMs },
) {
  const approval = provenance?.commercialReleaseApproval;
  if (
    String(approval?.state || "")
      .trim()
      .toLowerCase() !== "approved" ||
    !String(approval?.reviewedBy || "").trim() ||
    !isReviewedDate(approval?.reviewedAt, nowMs) ||
    !String(approval?.reviewReference || "").trim()
  ) {
    fail(
      "Commercial desktop redistribution of bundled PUBG map images is unverified or unapproved.",
      "ARENZYRA_MAP_PROVENANCE_UNAPPROVED",
    );
  }

  if (!Array.isArray(provenance.evidence) || provenance.evidence.length === 0) {
    fail(
      "Approved commercial map release requires reviewed redistribution, API, or tournament-license evidence.",
      "ARENZYRA_MAP_PROVENANCE_EVIDENCE_REQUIRED",
    );
  }

  const evidenceById = new Map();
  for (const evidence of provenance.evidence) {
    const id = String(evidence?.id || "").trim();
    const type = String(evidence?.type || "")
      .trim()
      .toLowerCase();
    const scope = Array.isArray(evidence?.assetScope)
      ? evidence.assetScope
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      : [];
    if (
      !id ||
      evidenceById.has(id) ||
      !ACCEPTED_EVIDENCE_TYPES.has(type) ||
      String(evidence?.reviewState || "")
        .trim()
        .toLowerCase() !== "approved" ||
      !String(evidence?.issuer || "").trim() ||
      !String(evidence?.grantedTo || "").trim() ||
      !String(evidence?.reference || "").trim() ||
      !isSha256(evidence?.documentSha256) ||
      !String(evidence?.reviewedBy || "").trim() ||
      !isReviewedDate(evidence?.reviewedAt, nowMs) ||
      scope.length === 0
    ) {
      fail(
        `Commercial map evidence is incomplete or unapproved: ${id || "<missing id>"}.`,
        "ARENZYRA_MAP_PROVENANCE_EVIDENCE_INVALID",
      );
    }
    const documentBytes =
      evidenceDocuments instanceof Map ? evidenceDocuments.get(id) : null;
    if (
      !Buffer.isBuffer(documentBytes) ||
      sha256Buffer(documentBytes) !==
        String(evidence.documentSha256).trim().toLowerCase()
    ) {
      fail(
        `Commercial map evidence document bytes are missing or do not match the reviewed SHA-256: ${id}.`,
        "ARENZYRA_MAP_PROVENANCE_EVIDENCE_DOCUMENT_MISMATCH",
      );
    }
    evidenceById.set(id, { id, scope });
  }

  for (const asset of assets) {
    if (asset.approvalState !== "approved" || asset.evidenceIds.length === 0) {
      fail(
        `Commercial release approval is missing for bundled map ${asset.path}.`,
        "ARENZYRA_MAP_PROVENANCE_ASSET_UNAPPROVED",
      );
    }
    for (const evidenceId of asset.evidenceIds) {
      const evidence = evidenceById.get(evidenceId);
      if (
        !evidence ||
        (!evidence.scope.includes("*") && !evidence.scope.includes(asset.path))
      ) {
        fail(
          `Reviewed evidence ${evidenceId} does not authorize bundled map ${asset.path}.`,
          "ARENZYRA_MAP_PROVENANCE_ASSET_EVIDENCE_MISMATCH",
        );
      }
    }
  }
  return {
    state: "approved",
    reviewedAt: approval.reviewedAt,
    reviewedBy: approval.reviewedBy,
    reviewReference: approval.reviewReference,
    evidenceIds: Array.from(evidenceById.keys()).sort(),
  };
}

function validateNoBundledCommercialAssets(provenance, assets) {
  const approval = provenance?.commercialReleaseApproval;
  const state = String(approval?.state || "")
    .trim()
    .toLowerCase();
  if (
    assets.length !== 0 ||
    state !== NO_BUNDLED_COMMERCIAL_ASSETS_STATE ||
    !Array.isArray(provenance?.evidence) ||
    provenance.evidence.length !== 0
  ) {
    fail(
      `An empty commercial map inventory must use ${NO_BUNDLED_COMMERCIAL_ASSETS_STATE} with no evidence entries.`,
      "ARENZYRA_MAP_PROVENANCE_EMPTY_STATE_INVALID",
    );
  }
  return {
    state: NO_BUNDLED_COMMERCIAL_ASSETS_STATE,
    reviewedAt: null,
    reviewedBy: null,
    reviewReference: null,
    evidenceIds: [],
  };
}

function verifyDesktopMapCommercialProvenance({
  repoRoot = DEFAULT_REPO_ROOT,
  mapsDir = path.join(
    repoRoot,
    "apps",
    "desktop",
    "electron",
    "assets",
    "maps",
  ),
  provenancePath = path.join(
    repoRoot,
    "apps",
    "desktop",
    "release",
    "pubg-map-commercial-provenance.json",
  ),
  evidenceDocuments = null,
  now = () => new Date(),
} = {}) {
  const actualPaths = listCommercialMapAssets(mapsDir);
  const provenanceSnapshot = readProvenance(provenancePath);
  const provenance = provenanceSnapshot.provenance;
  const assets = normalizedAssetEntries(provenance);
  assertExactAssetInventory(actualPaths, assets);

  for (const asset of assets) {
    const assetPath = path.join(mapsDir, ...asset.path.split("/"));
    const actualHash = sha256Buffer(
      readStableRegularFile(assetPath, asset.path),
    );
    if (actualHash !== asset.sha256) {
      fail(
        `Bundled desktop map hash mismatch for ${asset.path}: expected ${asset.sha256}, received ${actualHash}.`,
        "ARENZYRA_MAP_PROVENANCE_HASH_MISMATCH",
      );
    }
  }

  assertExactAssetInventory(listCommercialMapAssets(mapsDir), assets);
  const nowValue = now();
  const nowMs =
    nowValue instanceof Date ? nowValue.getTime() : Number(nowValue);
  if (!Number.isFinite(nowMs)) {
    fail(
      "Desktop map provenance verifier received an invalid review clock.",
      "ARENZYRA_MAP_PROVENANCE_INVALID",
    );
  }
  const approval =
    assets.length === 0
      ? validateNoBundledCommercialAssets(provenance, assets)
      : validateApprovedEvidence(provenance, assets, {
          evidenceDocuments,
          nowMs,
        });
  return {
    ok: true,
    mapsDir: path.resolve(mapsDir),
    provenancePath: path.resolve(provenancePath),
    provenanceSha256: provenanceSnapshot.sha256,
    assetCount: assets.length,
    assets: Object.fromEntries(
      assets.map((asset) => [asset.path, { sha256: asset.sha256 }]),
    ),
    approval,
  };
}

function main() {
  try {
    const result = verifyDesktopMapCommercialProvenance();
    process.stdout.write(
      `[desktop-map-provenance] verified ${result.assetCount} commercial raster assets in state ${result.approval.state} (${result.provenanceSha256})\n`,
    );
  } catch (error) {
    process.stderr.write(
      `[desktop-map-provenance] blocked: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  ACCEPTED_EVIDENCE_TYPES,
  COMMERCIAL_MAP_EXTENSIONS,
  DEFAULT_MAPS_DIR,
  DEFAULT_PROVENANCE_PATH,
  DesktopMapProvenanceError,
  NO_BUNDLED_COMMERCIAL_ASSETS_STATE,
  listCommercialMapAssets,
  sha256File,
  verifyDesktopMapCommercialProvenance,
};
