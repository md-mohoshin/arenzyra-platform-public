#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_CONNECTOR_PATH = path.join(DEFAULT_REPO_ROOT, "ob.js");
const DEFAULT_PROVENANCE_PATH = path.join(
  DEFAULT_REPO_ROOT,
  "apps",
  "desktop",
  "release",
  "ob-connector-commercial-provenance.json",
);
const ACCEPTED_EVIDENCE_TYPES = new Set([
  "written-commercial-redistribution-permission",
  "copyright-assignment-or-work-for-hire",
  "recognized-open-source-license-provenance-review",
]);
const MAX_CONNECTOR_BYTES = 4 * 1024 * 1024;
const MAX_PROVENANCE_BYTES = 256 * 1024;
const MAX_EVIDENCE_DOCUMENT_BYTES = 4 * 1024 * 1024;
const MAX_EVIDENCE_ENTRIES = 16;
const REVIEW_CLOCK_SKEW_MS = 5 * 60 * 1000;
const REVIEWED_UNAPPROVED_STATE = "reviewed-unapproved";

class DesktopConnectorProvenanceError extends Error {
  constructor(message, code, details = null) {
    super(message);
    this.name = "DesktopConnectorProvenanceError";
    this.code = code;
    this.details = details;
  }
}

function fail(message, code, details = null) {
  throw new DesktopConnectorProvenanceError(message, code, details);
}

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/.test(
    String(value || "")
      .trim()
      .toLowerCase(),
  );
}

function comparablePath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function sameFileSnapshot(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function assertUnlinkedRegularPath(filePath, displayPath) {
  let stat;
  try {
    stat = fs.lstatSync(filePath, { bigint: true });
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error?.code)) {
      fail(
        `Desktop connector provenance input is missing: ${displayPath}.`,
        "ARENZYRA_CONNECTOR_PROVENANCE_INPUT_MISSING",
      );
    }
    throw error;
  }
  if (stat.isSymbolicLink()) {
    fail(
      `Desktop connector provenance refuses a symbolic link or junction: ${displayPath}.`,
      "ARENZYRA_CONNECTOR_PROVENANCE_LINK_REFUSED",
    );
  }
  let physicalPath;
  try {
    physicalPath = fs.realpathSync.native(filePath);
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error?.code)) {
      fail(
        `Desktop connector provenance input changed during inspection: ${displayPath}.`,
        "ARENZYRA_CONNECTOR_PROVENANCE_RACE_REFUSED",
      );
    }
    throw error;
  }
  if (comparablePath(physicalPath) !== comparablePath(filePath)) {
    fail(
      `Desktop connector provenance refuses a redirected or reparse path: ${displayPath}.`,
      "ARENZYRA_CONNECTOR_PROVENANCE_REPARSE_REFUSED",
    );
  }
  if (!stat.isFile()) {
    fail(
      `Desktop connector provenance expected a regular file: ${displayPath}.`,
      "ARENZYRA_CONNECTOR_PROVENANCE_INVALID",
    );
  }
  if (stat.nlink !== 1n) {
    fail(
      `Desktop connector provenance refuses a multiply linked file: ${displayPath}.`,
      "ARENZYRA_CONNECTOR_PROVENANCE_HARDLINK_REFUSED",
    );
  }
  return stat;
}

function readStableRegularFile(filePath, displayPath, maxBytes) {
  const resolvedPath = path.resolve(filePath);
  const before = assertUnlinkedRegularPath(resolvedPath, displayPath);
  if (before.size > BigInt(maxBytes)) {
    fail(
      `Desktop connector provenance input exceeds its byte limit: ${displayPath}.`,
      "ARENZYRA_CONNECTOR_PROVENANCE_INPUT_TOO_LARGE",
    );
  }

  let flags = fs.constants.O_RDONLY;
  if (Number.isInteger(fs.constants.O_NOFOLLOW)) {
    flags |= fs.constants.O_NOFOLLOW;
  }
  if (Number.isInteger(fs.constants.O_NONBLOCK)) {
    flags |= fs.constants.O_NONBLOCK;
  }

  let descriptor;
  try {
    descriptor = fs.openSync(resolvedPath, flags);
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (
      !opened.isFile() ||
      opened.nlink !== 1n ||
      !sameFileSnapshot(before, opened)
    ) {
      fail(
        `Desktop connector provenance input changed while opening: ${displayPath}.`,
        "ARENZYRA_CONNECTOR_PROVENANCE_RACE_REFUSED",
      );
    }

    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const read = fs.readSync(
        descriptor,
        bytes,
        offset,
        bytes.length - offset,
        null,
      );
      if (read === 0) break;
      offset += read;
    }
    const extra = Buffer.alloc(1);
    const extraBytes = fs.readSync(descriptor, extra, 0, 1, null);
    const afterRead = fs.fstatSync(descriptor, { bigint: true });
    const afterPath = assertUnlinkedRegularPath(resolvedPath, displayPath);
    if (
      offset !== bytes.length ||
      extraBytes !== 0 ||
      !sameFileSnapshot(opened, afterRead) ||
      !sameFileSnapshot(afterRead, afterPath)
    ) {
      fail(
        `Desktop connector provenance input changed while reading: ${displayPath}.`,
        "ARENZYRA_CONNECTOR_PROVENANCE_RACE_REFUSED",
      );
    }
    return bytes;
  } catch (error) {
    if (["ELOOP", "ENOENT", "ENOTDIR"].includes(error?.code)) {
      fail(
        `Desktop connector provenance input changed while opening: ${displayPath}.`,
        "ARENZYRA_CONNECTOR_PROVENANCE_RACE_REFUSED",
      );
    }
    throw error;
  } finally {
    if (descriptor !== undefined) {
      fs.closeSync(descriptor);
    }
  }
}

function readProvenance(provenancePath) {
  const bytes = readStableRegularFile(
    provenancePath,
    path.resolve(provenancePath),
    MAX_PROVENANCE_BYTES,
  );
  let provenance;
  try {
    provenance = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(
      `Desktop connector provenance policy is invalid JSON: ${error.message}`,
      "ARENZYRA_CONNECTOR_PROVENANCE_INVALID",
    );
  }
  return { bytes, provenance, sha256: sha256Buffer(bytes) };
}

function isReviewedDate(value, nowMs) {
  const text = String(value || "").trim();
  const parsed = Date.parse(text);
  return Boolean(
    text && Number.isFinite(parsed) && parsed <= nowMs + REVIEW_CLOCK_SKEW_MS,
  );
}

function validateRepositoryReview(provenance, approvalState) {
  const review = provenance?.repositoryReview;
  const reviewState = String(review?.state || "")
    .trim()
    .toLowerCase();
  const expectedState =
    approvalState === "approved"
      ? "reviewed-approved"
      : REVIEWED_UNAPPROVED_STATE;
  if (
    reviewState !== expectedState ||
    !String(review?.historyScope || "").trim() ||
    !/^[a-f0-9]{40}$/i.test(
      String(review?.exactBytesFirstObservedAtLocalCommit || "").trim(),
    ) ||
    !["present", "absent"].includes(
      String(review?.currentHeaderLicenseNotice || "")
        .trim()
        .toLowerCase(),
    ) ||
    !String(review?.commercialRightsEvidence || "").trim() ||
    !String(review?.reviewMethod || "").trim()
  ) {
    fail(
      `Desktop connector provenance repository review must use ${expectedState} with the bounded local-history findings.`,
      "ARENZYRA_CONNECTOR_PROVENANCE_REVIEW_INVALID",
    );
  }
}

function normalizedConnector(provenance) {
  const connector = provenance?.connector;
  const connectorPath = String(connector?.path || "").trim();
  const sizeBytes = Number(connector?.sizeBytes);
  const sha256 = String(connector?.sha256 || "")
    .trim()
    .toLowerCase();
  const approvalState = String(connector?.approvalState || "")
    .trim()
    .toLowerCase();
  const evidenceIds = Array.isArray(connector?.evidenceIds)
    ? connector.evidenceIds.map((value) => String(value || "").trim())
    : null;
  if (
    provenance?.schemaVersion !== 1 ||
    connectorPath !== "ob.js" ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    sizeBytes > MAX_CONNECTOR_BYTES ||
    !isSha256(sha256) ||
    !["approved", "unapproved"].includes(approvalState) ||
    !evidenceIds ||
    evidenceIds.some((value) => !value) ||
    new Set(evidenceIds.map((value) => value.toLowerCase())).size !==
      evidenceIds.length ||
    evidenceIds.length > MAX_EVIDENCE_ENTRIES
  ) {
    fail(
      "Desktop connector provenance policy must use schemaVersion 1 and declare the exact bounded ob.js bytes.",
      "ARENZYRA_CONNECTOR_PROVENANCE_INVALID",
    );
  }
  return { connectorPath, sizeBytes, sha256, approvalState, evidenceIds };
}

function validateUnapprovedState(provenance, connector) {
  const approval = provenance?.commercialReleaseApproval;
  if (
    connector.approvalState !== "unapproved" ||
    connector.evidenceIds.length !== 0 ||
    String(approval?.state || "")
      .trim()
      .toLowerCase() !== "unapproved" ||
    approval?.reviewedBy !== null ||
    approval?.reviewedAt !== null ||
    approval?.reviewReference !== null ||
    !Array.isArray(provenance?.evidence) ||
    provenance.evidence.length !== 0
  ) {
    fail(
      "Unapproved desktop connector provenance must contain no approval identity or evidence claims.",
      "ARENZYRA_CONNECTOR_PROVENANCE_UNAPPROVED_STATE_INVALID",
    );
  }
  validateRepositoryReview(provenance, "unapproved");
  fail(
    "Commercial redistribution of the exact bundled ob.js connector is explicitly unapproved.",
    "ARENZYRA_CONNECTOR_PROVENANCE_UNAPPROVED",
    { connectorSha256: connector.sha256, sizeBytes: connector.sizeBytes },
  );
}

function validateApprovedState(
  provenance,
  connector,
  { evidenceDocuments, nowMs },
) {
  const approval = provenance?.commercialReleaseApproval;
  if (
    connector.approvalState !== "approved" ||
    String(approval?.state || "")
      .trim()
      .toLowerCase() !== "approved" ||
    !String(approval?.reviewedBy || "").trim() ||
    !isReviewedDate(approval?.reviewedAt, nowMs) ||
    !String(approval?.reviewReference || "").trim()
  ) {
    fail(
      "Commercial desktop connector redistribution is unverified or unapproved.",
      "ARENZYRA_CONNECTOR_PROVENANCE_UNAPPROVED",
    );
  }
  validateRepositoryReview(provenance, "approved");

  if (
    !Array.isArray(provenance?.evidence) ||
    provenance.evidence.length === 0 ||
    provenance.evidence.length > MAX_EVIDENCE_ENTRIES ||
    provenance.evidence.length !== connector.evidenceIds.length
  ) {
    fail(
      "Approved commercial connector release requires an exact bounded evidence inventory.",
      "ARENZYRA_CONNECTOR_PROVENANCE_EVIDENCE_REQUIRED",
    );
  }

  const requestedIds = new Set(
    connector.evidenceIds.map((value) => value.toLowerCase()),
  );
  const evidenceById = new Map();
  for (const evidence of provenance.evidence) {
    const id = String(evidence?.id || "").trim();
    const normalizedId = id.toLowerCase();
    const type = String(evidence?.type || "")
      .trim()
      .toLowerCase();
    const documentSha256 = String(evidence?.documentSha256 || "")
      .trim()
      .toLowerCase();
    const authorizedConnectorSha256 = String(
      evidence?.authorizedConnectorSha256 || "",
    )
      .trim()
      .toLowerCase();
    if (
      !id ||
      evidenceById.has(normalizedId) ||
      !requestedIds.has(normalizedId) ||
      !ACCEPTED_EVIDENCE_TYPES.has(type) ||
      !String(evidence?.issuer || "").trim() ||
      !String(evidence?.grantedTo || "").trim() ||
      !String(evidence?.reference || "").trim() ||
      !isSha256(documentSha256) ||
      authorizedConnectorSha256 !== connector.sha256 ||
      String(evidence?.reviewState || "")
        .trim()
        .toLowerCase() !== "approved" ||
      !String(evidence?.reviewedBy || "").trim() ||
      !isReviewedDate(evidence?.reviewedAt, nowMs)
    ) {
      fail(
        `Commercial connector evidence is incomplete, unapproved, or not bound to the exact connector: ${id || "<missing id>"}.`,
        "ARENZYRA_CONNECTOR_PROVENANCE_EVIDENCE_INVALID",
      );
    }

    const providedBytes =
      evidenceDocuments instanceof Map ? evidenceDocuments.get(id) : null;
    if (
      !Buffer.isBuffer(providedBytes) ||
      providedBytes.length === 0 ||
      providedBytes.length > MAX_EVIDENCE_DOCUMENT_BYTES
    ) {
      fail(
        `Reviewed connector evidence document bytes are missing or outside the byte limit: ${id}.`,
        "ARENZYRA_CONNECTOR_PROVENANCE_EVIDENCE_DOCUMENT_MISMATCH",
      );
    }
    const evidenceSnapshot = Buffer.from(providedBytes);
    if (sha256Buffer(evidenceSnapshot) !== documentSha256) {
      fail(
        `Reviewed connector evidence document bytes do not match documentSha256: ${id}.`,
        "ARENZYRA_CONNECTOR_PROVENANCE_EVIDENCE_DOCUMENT_MISMATCH",
      );
    }
    evidenceById.set(normalizedId, id);
  }

  if (
    evidenceById.size !== requestedIds.size ||
    Array.from(requestedIds).some((id) => !evidenceById.has(id))
  ) {
    fail(
      "Commercial connector approval and evidence inventories do not exactly match.",
      "ARENZYRA_CONNECTOR_PROVENANCE_EVIDENCE_INVALID",
    );
  }
  return {
    state: "approved",
    reviewedAt: approval.reviewedAt,
    reviewedBy: approval.reviewedBy,
    reviewReference: approval.reviewReference,
    evidenceIds: connector.evidenceIds.slice().sort(),
  };
}

function verifyDesktopConnectorCommercialProvenance({
  repoRoot = DEFAULT_REPO_ROOT,
  connectorPath = path.join(repoRoot, "ob.js"),
  provenancePath = path.join(
    repoRoot,
    "apps",
    "desktop",
    "release",
    "ob-connector-commercial-provenance.json",
  ),
  evidenceDocuments = null,
  now = () => new Date(),
} = {}) {
  const provenanceSnapshot = readProvenance(provenancePath);
  const connector = normalizedConnector(provenanceSnapshot.provenance);
  const connectorBytes = readStableRegularFile(
    connectorPath,
    path.resolve(connectorPath),
    MAX_CONNECTOR_BYTES,
  );
  const actualSha256 = sha256Buffer(connectorBytes);
  if (
    connectorBytes.length !== connector.sizeBytes ||
    actualSha256 !== connector.sha256
  ) {
    fail(
      `Bundled desktop connector bytes do not match the reviewed policy: expected ${connector.sizeBytes} bytes/${connector.sha256}, received ${connectorBytes.length} bytes/${actualSha256}.`,
      "ARENZYRA_CONNECTOR_PROVENANCE_HASH_MISMATCH",
      {
        expectedSha256: connector.sha256,
        actualSha256,
        expectedSizeBytes: connector.sizeBytes,
        actualSizeBytes: connectorBytes.length,
      },
    );
  }

  const nowValue = now();
  const nowMs =
    nowValue instanceof Date ? nowValue.getTime() : Number(nowValue);
  if (!Number.isFinite(nowMs)) {
    fail(
      "Desktop connector provenance verifier received an invalid review clock.",
      "ARENZYRA_CONNECTOR_PROVENANCE_INVALID",
    );
  }
  if (connector.approvalState !== "approved") {
    validateUnapprovedState(provenanceSnapshot.provenance, connector);
  }
  const approval = validateApprovedState(
    provenanceSnapshot.provenance,
    connector,
    { evidenceDocuments, nowMs },
  );
  return {
    ok: true,
    connectorPath: path.resolve(connectorPath),
    connectorSha256: actualSha256,
    connectorSizeBytes: connectorBytes.length,
    provenancePath: path.resolve(provenancePath),
    provenanceSha256: provenanceSnapshot.sha256,
    approval,
  };
}

function main() {
  try {
    const result = verifyDesktopConnectorCommercialProvenance();
    process.stdout.write(
      `[desktop-connector-provenance] approved ${result.connectorSizeBytes} bytes/${result.connectorSha256} (${result.provenanceSha256})\n`,
    );
  } catch (error) {
    process.stderr.write(
      `[desktop-connector-provenance] blocked: ${
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
  DEFAULT_CONNECTOR_PATH,
  DEFAULT_PROVENANCE_PATH,
  DesktopConnectorProvenanceError,
  MAX_CONNECTOR_BYTES,
  MAX_EVIDENCE_DOCUMENT_BYTES,
  MAX_EVIDENCE_ENTRIES,
  MAX_PROVENANCE_BYTES,
  readStableRegularFile,
  sha256Buffer,
  verifyDesktopConnectorCommercialProvenance,
};
