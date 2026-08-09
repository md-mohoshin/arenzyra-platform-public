"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  validatePackagedRuntimeIntegrity,
} = require("./launcher-release-artifact-verifier.cjs");
const {
  NO_BUNDLED_COMMERCIAL_ASSETS_STATE,
} = require("./verify-desktop-map-provenance.cjs");

const repoRoot = path.resolve(__dirname, "..");
const defaultStagingRoot = path.join(repoRoot, "deploy-artifacts", "launcher");
const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function validatedVersion(value) {
  const version = String(value || "").trim();
  if (!RELEASE_VERSION_PATTERN.test(version)) {
    throw new Error(`Launcher stage version is invalid: ${value}`);
  }
  return version;
}

function releaseIdForVersion(value) {
  return `launcher-${validatedVersion(value)}`;
}

function stagedArtifactNames(value) {
  const version = validatedVersion(value);
  return {
    installer: `Arenzyra-Observer-Launcher-${version}-Setup.exe`,
    portableZip: `Arenzyra-Observer-Launcher-${version}-Portable.zip`,
  };
}

function comparablePath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function assertPathInside(rootPath, candidatePath, label) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${label} escapes the launcher staging root: ${candidate}`);
  }
  return candidate;
}

function assertDirectoryHasNoLinks(directoryPath) {
  const resolved = path.resolve(directoryPath);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  for (const segment of path
    .relative(parsed.root, resolved)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`Launcher staging path traverses a link: ${current}`);
    }
    if (
      comparablePath(fs.realpathSync.native(current)) !==
      comparablePath(current)
    ) {
      throw new Error(
        `Launcher staging path traverses a redirected path: ${current}`,
      );
    }
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error(`Launcher staging root is not a directory: ${resolved}`);
  }
  return resolved;
}

function validatedArtifact(artifact, label) {
  const sourcePath = path.resolve(String(artifact?.path || ""));
  const sizeBytes = Number(artifact?.size);
  const sha256 = String(artifact?.sha256 || "")
    .trim()
    .toLowerCase();
  if (
    !String(artifact?.path || "").trim() ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    !/^[a-f0-9]{64}$/.test(sha256)
  ) {
    throw new Error(`Verified ${label} metadata is incomplete.`);
  }
  const stat = fs.statSync(sourcePath);
  if (!stat.isFile()) {
    throw new Error(`Verified ${label} source is not a file: ${sourcePath}`);
  }
  return { sourcePath, sizeBytes, sha256 };
}

function validateVerifiedRelease(verified) {
  const version = validatedVersion(verified?.version);
  const installer = validatedArtifact(verified?.installer, "installer");
  const portableZip = validatedArtifact(verified?.portableZip, "portable ZIP");
  const signing = verified?.installer?.signing;
  if (
    signing?.status !== "verified" ||
    signing?.authenticodeStatus !== "Valid" ||
    !/^[a-f0-9]{64}$/i.test(String(signing?.certificateSha256 || "")) ||
    !/^[a-f0-9]{64}$/i.test(String(signing?.trustPolicy?.sha256 || ""))
  ) {
    throw new Error("Verified installer signing metadata is incomplete.");
  }
  const mapProvenance = verified?.mapProvenance;
  const mapAssetCount = Number(mapProvenance?.assetCount);
  const mapApprovalState = String(mapProvenance?.approval?.state || "")
    .trim()
    .toLowerCase();
  if (
    !/^[a-f0-9]{64}$/i.test(String(mapProvenance?.provenanceSha256 || "")) ||
    !Number.isSafeInteger(mapAssetCount) ||
    mapAssetCount < 0 ||
    (mapAssetCount === 0 &&
      mapApprovalState !== NO_BUNDLED_COMMERCIAL_ASSETS_STATE) ||
    (mapAssetCount > 0 && mapApprovalState !== "approved")
  ) {
    throw new Error("Verified map provenance metadata is incomplete.");
  }
  let packagedRuntimeIntegrity;
  try {
    packagedRuntimeIntegrity = validatePackagedRuntimeIntegrity(
      verified?.packagedRuntimeIntegrity,
    );
  } catch (error) {
    throw new Error(
      `Verified complete packaged-runtime integrity metadata is incomplete: ${error.message}`,
    );
  }
  return {
    installer,
    mapProvenance,
    packagedRuntimeIntegrity,
    portableZip,
    signing,
    version,
  };
}

function buildStagedReleaseManifest(verified, stagedAt) {
  const validated = validateVerifiedRelease(verified);
  const names = stagedArtifactNames(validated.version);
  const releaseId = releaseIdForVersion(validated.version);
  const verifiedResources = stableValue(verified?.installer?.resources || {});
  const installer = {
    ...validated.installer,
    signing: stableValue(validated.signing),
  };
  const verifiedMapProvenance = {
    provenanceSha256: String(
      verified.mapProvenance.provenanceSha256,
    ).toLowerCase(),
    assetCount: Number(validated.mapProvenance.assetCount),
    approval: stableValue(validated.mapProvenance.approval),
  };
  return {
    schemaVersion: 1,
    kind: "arenzyra.launcher.staged-release.v1",
    publicationState: "pending-independent-upload-verification",
    deployable: false,
    version: validated.version,
    releaseId,
    stagedAt,
    artifacts: {
      installer: {
        fileName: names.installer,
        sizeBytes: installer.sizeBytes,
        sha256: installer.sha256,
        signing: installer.signing,
        signingMetadataSha256: sha256Buffer(
          Buffer.from(stableJson(installer.signing)),
        ),
      },
      portableZip: {
        fileName: names.portableZip,
        sizeBytes: validated.portableZip.sizeBytes,
        sha256: validated.portableZip.sha256,
      },
    },
    verifiedResources,
    verifiedResourcesSha256: sha256Buffer(
      Buffer.from(stableJson(verifiedResources)),
    ),
    verifiedMapProvenance,
    packagedRuntimeIntegrity: stableValue(validated.packagedRuntimeIntegrity),
  };
}

function buildPendingOperatorTemplate({ releaseId, version }) {
  return {
    schemaVersion: 0,
    kind: "arenzyra.launcher.publication-pending.v1",
    status: "pending-independent-upload-and-remote-verification",
    deployable: false,
    releaseId,
    version,
    runtimeEnvironmentVariable: "ARENZYRA_LAUNCHER_RELEASE_JSON",
    runtimeValue: null,
    warning:
      "This file is intentionally not valid launcher runtime configuration. Do not put it in ARENZYRA_LAUNCHER_RELEASE_JSON.",
    requiredIndependentChecks: [
      "Upload the versioned artifacts and manifest to one immutable HTTPS release prefix.",
      "Download every remote object independently and compare its SHA-256 and byte size with manifest.json.",
      "Re-verify the remote installer and portable executable Authenticode identities and timestamps.",
      "Confirm the immutable manifest, installer, and portable ZIP URLs are independently reachable.",
      "Only then construct and review the schemaVersion 1 server configuration documented by the web application.",
    ],
  };
}

function pendingInstructions(releaseId) {
  return [
    "ARENZYRA LAUNCHER RELEASE - PUBLICATION PENDING",
    "",
    `Local stage: ${releaseId}`,
    "This directory is not a public release and has not been uploaded or remotely verified.",
    "Do not serve it from apps/arenzyra-web/public and do not use pending-runtime-config.json",
    "as ARENZYRA_LAUNCHER_RELEASE_JSON.",
    "",
    "Upload the versioned files to an immutable HTTPS prefix, independently download",
    "and verify them against manifest.json, re-check Authenticode, and confirm public",
    "reachability. Only after those checks should an operator construct the reviewed",
    "server-only runtime JSON described in apps/arenzyra-web/docs/launcher-release-downloads.md.",
    "",
  ].join("\n");
}

function writeExclusive(filePath, value) {
  fs.writeFileSync(filePath, value, { flag: "wx", mode: 0o600 });
}

function copyVerifiedArtifact({
  sourcePath,
  destinationPath,
  sizeBytes,
  sha256,
}) {
  fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
  const stat = fs.statSync(destinationPath);
  if (
    !stat.isFile() ||
    stat.size !== sizeBytes ||
    sha256File(destinationPath) !== sha256
  ) {
    throw new Error(
      `Launcher artifact changed while staging: ${path.basename(destinationPath)}`,
    );
  }
}

function removeCreatedStageFiles(directoryPath, createdFiles) {
  for (const filePath of [...createdFiles].reverse()) {
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  try {
    fs.rmdirSync(directoryPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function stageVerifiedLauncherRelease({
  verified,
  stagingRoot = defaultStagingRoot,
  now = () => new Date(),
  randomId = () => crypto.randomUUID(),
} = {}) {
  const validated = validateVerifiedRelease(verified);
  const releaseId = releaseIdForVersion(validated.version);
  const names = stagedArtifactNames(validated.version);
  const resolvedStagingRoot = path.resolve(stagingRoot);
  if (resolvedStagingRoot === path.parse(resolvedStagingRoot).root) {
    throw new Error("Launcher staging root must not be a filesystem root.");
  }
  fs.mkdirSync(resolvedStagingRoot, { recursive: true });
  assertDirectoryHasNoLinks(resolvedStagingRoot);

  const releaseDirectory = assertPathInside(
    resolvedStagingRoot,
    path.join(resolvedStagingRoot, releaseId),
    "Launcher release directory",
  );
  const lockPath = assertPathInside(
    resolvedStagingRoot,
    path.join(resolvedStagingRoot, `.${releaseId}.stage.lock`),
    "Launcher stage lock",
  );
  if (fs.existsSync(releaseDirectory)) {
    throw new Error(
      `Launcher release stage already exists and will not be overwritten: ${releaseDirectory}`,
    );
  }

  const tempDirectory = assertPathInside(
    resolvedStagingRoot,
    path.join(resolvedStagingRoot, `.${releaseId}.stage-${randomId()}`),
    "Launcher temporary stage",
  );
  writeExclusive(
    lockPath,
    `${JSON.stringify({ releaseId, pid: process.pid, startedAt: now().toISOString() })}\n`,
  );
  const createdFiles = [];
  let tempDirectoryCreated = false;
  let stagedResult = null;
  let operationError = null;
  try {
    if (fs.existsSync(releaseDirectory)) {
      throw new Error(
        `Launcher release stage already exists and will not be overwritten: ${releaseDirectory}`,
      );
    }
    fs.mkdirSync(tempDirectory, { recursive: false, mode: 0o700 });
    tempDirectoryCreated = true;

    const installerPath = path.join(tempDirectory, names.installer);
    createdFiles.push(installerPath);
    copyVerifiedArtifact({
      ...validated.installer,
      destinationPath: installerPath,
    });

    const portableZipPath = path.join(tempDirectory, names.portableZip);
    createdFiles.push(portableZipPath);
    copyVerifiedArtifact({
      ...validated.portableZip,
      destinationPath: portableZipPath,
    });

    const stagedAt = now().toISOString();
    const manifest = buildStagedReleaseManifest(verified, stagedAt);
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    const pendingTemplate = buildPendingOperatorTemplate({
      releaseId,
      version: validated.version,
    });
    const pendingPath = path.join(tempDirectory, "pending-runtime-config.json");
    createdFiles.push(pendingPath);
    writeExclusive(
      pendingPath,
      `${JSON.stringify(pendingTemplate, null, 2)}\n`,
    );

    const instructionsPath = path.join(tempDirectory, "PUBLISH-PENDING.txt");
    createdFiles.push(instructionsPath);
    writeExclusive(instructionsPath, pendingInstructions(releaseId));

    const manifestHashPath = path.join(tempDirectory, "manifest.json.sha256");
    createdFiles.push(manifestHashPath);
    writeExclusive(
      manifestHashPath,
      `${sha256Buffer(manifestBytes)}  manifest.json\n`,
    );

    const manifestPath = path.join(tempDirectory, "manifest.json");
    createdFiles.push(manifestPath);
    writeExclusive(manifestPath, manifestBytes);

    // The exclusive lock prevents two staging commands for one release ID. The
    // complete sibling directory becomes visible with one rename, and an
    // existing release directory is never intentionally replaced.
    if (fs.existsSync(releaseDirectory)) {
      throw new Error(
        `Launcher release stage appeared concurrently and will not be overwritten: ${releaseDirectory}`,
      );
    }
    fs.renameSync(tempDirectory, releaseDirectory);
    tempDirectoryCreated = false;
    stagedResult = {
      releaseDirectory,
      releaseId,
      version: validated.version,
      manifest,
      pendingTemplate,
      files: {
        installer: path.join(releaseDirectory, names.installer),
        portableZip: path.join(releaseDirectory, names.portableZip),
        manifest: path.join(releaseDirectory, "manifest.json"),
        pendingTemplate: path.join(
          releaseDirectory,
          "pending-runtime-config.json",
        ),
      },
    };
  } catch (error) {
    operationError = error;
    try {
      if (tempDirectoryCreated) {
        removeCreatedStageFiles(tempDirectory, createdFiles);
      }
    } catch (cleanupError) {
      operationError = new AggregateError(
        [error, cleanupError],
        "Launcher staging and temporary-file cleanup both failed.",
      );
    }
  }

  let lockCleanupError = null;
  try {
    fs.unlinkSync(lockPath);
  } catch (error) {
    if (error?.code !== "ENOENT") lockCleanupError = error;
  }
  if (operationError && lockCleanupError) {
    throw new AggregateError(
      [operationError, lockCleanupError],
      "Launcher staging and stage-lock cleanup both failed.",
    );
  }
  if (operationError) throw operationError;
  if (lockCleanupError) throw lockCleanupError;
  return stagedResult;
}

if (require.main === module) {
  const {
    runBlockedLauncherReleaseEntrypoint,
  } = require("./blocked-launcher-release-entrypoint.cjs");
  runBlockedLauncherReleaseEntrypoint();
}

module.exports = {
  buildPendingOperatorTemplate,
  buildStagedReleaseManifest,
  releaseIdForVersion,
  sha256File,
  stageVerifiedLauncherRelease,
  stagedArtifactNames,
};
