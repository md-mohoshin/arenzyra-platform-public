#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { isDeepStrictEqual } = require("node:util");
const asar = require("@electron/asar");
const {
  NO_BUNDLED_COMMERCIAL_ASSETS_STATE,
  verifyDesktopMapCommercialProvenance,
} = require("./verify-desktop-map-provenance.cjs");
const {
  listPackagedElectronRuntimeFiles,
} = require("../apps/desktop/release/runtime-file-policy.cjs");

const repoRoot = path.resolve(__dirname, "..");
const DEFAULT_TRUSTED_SIGNER_CONFIG_PATH = path.join(
  repoRoot,
  "apps",
  "desktop",
  "release",
  "trusted-authenticode-signers.json",
);
const DEFAULT_UNSIGNED_RELEASE_POLICY_PATH = path.join(
  repoRoot,
  "apps",
  "desktop",
  "release",
  "launcher-signing-policy.json",
);
const DEFAULT_RELEASE_TOOLCHAIN_PATH = path.join(
  repoRoot,
  "apps",
  "desktop",
  "release",
  "release-toolchain.json",
);
const AUTHENTICODE_TARGET_ENV = "ARENZYRA_AUTHENTICODE_TARGET";
const DEFAULT_ARCHIVE_LIMITS = Object.freeze({
  listTimeoutMs: 30_000,
  extractTimeoutMs: 60_000,
  maxEntryCount: 50_000,
  maxFileCount: 40_000,
  maxEntrySizeBytes: 512 * 1024 * 1024,
  maxTotalExpandedSizeBytes: 4 * 1024 * 1024 * 1024,
  maxSelectedEntrySizeBytes: 64 * 1024 * 1024,
  maxSelectedExpandedSizeBytes: 1024 * 1024 * 1024,
});
const ARCHIVE_LISTING_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const ARCHIVE_EXTRACT_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const ARCHIVE_ENTRY_PATH_MAX_LENGTH = 1024;
const AUTHENTICODE_INSPECTION_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$targetPath = [Environment]::GetEnvironmentVariable('${AUTHENTICODE_TARGET_ENV}', 'Process')
if ([String]::IsNullOrWhiteSpace($targetPath)) {
  throw 'Authenticode target path is missing.'
}
$signature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $targetPath
$signer = $signature.SignerCertificate
$timeSigner = $signature.TimeStamperCertificate
function Get-CertificateSha256($certificate) {
  if ($null -eq $certificate) {
    return $null
  }
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    return [BitConverter]::ToString($sha256.ComputeHash($certificate.RawData)).Replace('-', '')
  } finally {
    $sha256.Dispose()
  }
}
$certificateSha256 = Get-CertificateSha256 $signer
$timestampCertificateSha256 = Get-CertificateSha256 $timeSigner
[PSCustomObject]@{
  status = [String]$signature.Status
  statusMessage = [String]$signature.StatusMessage
  subject = if ($null -eq $signer) { $null } else { [String]$signer.Subject }
  issuer = if ($null -eq $signer) { $null } else { [String]$signer.Issuer }
  thumbprint = if ($null -eq $signer) { $null } else { [String]$signer.Thumbprint }
  certificateSha256 = $certificateSha256
  serialNumber = if ($null -eq $signer) { $null } else { [String]$signer.SerialNumber }
  certificateNotBefore = if ($null -eq $signer) { $null } else { $signer.NotBefore.ToUniversalTime().ToString('o') }
  certificateNotAfter = if ($null -eq $signer) { $null } else { $signer.NotAfter.ToUniversalTime().ToString('o') }
  timestampSubject = if ($null -eq $timeSigner) { $null } else { [String]$timeSigner.Subject }
  timestampThumbprint = if ($null -eq $timeSigner) { $null } else { [String]$timeSigner.Thumbprint }
  timestampCertificateSha256 = $timestampCertificateSha256
} | ConvertTo-Json -Compress -Depth 3
`;

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function normalizedCertificateSubject(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizedThumbprint(value) {
  return String(value || "")
    .replace(/[^a-f0-9]/gi, "")
    .toUpperCase();
}

function readTrustedSignerConfig(configPath) {
  if (
    !fs.existsSync(configPath) ||
    !assertReleaseSourcePath(
      configPath,
      "Trusted Authenticode signer config",
    ).isFile()
  ) {
    throw new Error(
      `Trusted Authenticode signer config is missing: ${configPath}`,
    );
  }
  let value;
  let source;
  try {
    source = fs.readFileSync(configPath);
    value = JSON.parse(source.toString("utf8"));
  } catch (error) {
    throw new Error(
      `Trusted Authenticode signer config is invalid: ${error.message}`,
    );
  }
  return { value, sha256: sha256Buffer(source) };
}

function readUnsignedReleasePolicy(policyPath = DEFAULT_UNSIGNED_RELEASE_POLICY_PATH) {
  if (
    !fs.existsSync(policyPath) ||
    !assertReleaseSourcePath(
      policyPath,
      "Unsigned launcher release policy",
    ).isFile()
  ) {
    throw new Error(`Unsigned launcher release policy is missing: ${policyPath}`);
  }
  let value;
  let source;
  try {
    source = fs.readFileSync(policyPath);
    value = JSON.parse(source.toString("utf8"));
  } catch (error) {
    throw new Error(`Unsigned launcher release policy is invalid: ${error.message}`);
  }
  return { value, sha256: sha256Buffer(source) };
}

function validateUnsignedReleasePolicy(
  policy,
  policySha256 = "",
  verificationTime = new Date(),
) {
  const decision = policy?.decision;
  const verificationTimeMs =
    verificationTime instanceof Date
      ? verificationTime.getTime()
      : Number(verificationTime);
  const decidedAtMs = Date.parse(String(decision?.decidedAt || ""));
  if (
    policy?.schemaVersion !== 1 ||
    policy?.releaseMode !== "unsigned" ||
    decision?.state !== "approved" ||
    !String(decision?.decidedBy || "").trim() ||
    !Number.isFinite(verificationTimeMs) ||
    !Number.isFinite(decidedAtMs) ||
    decidedAtMs > verificationTimeMs + 5 * 60 * 1000 ||
    !String(decision?.reference || "").trim() ||
    !String(decision?.warning || "").trim()
  ) {
    throw new Error(
      "Unsigned launcher release policy is not explicitly approved or is incomplete.",
    );
  }
  return {
    schemaVersion: 1,
    releaseMode: "unsigned",
    policySha256:
      policySha256 || sha256Buffer(Buffer.from(JSON.stringify(policy), "utf8")),
    decision: {
      decidedAt: decision.decidedAt,
      decidedBy: decision.decidedBy,
      reference: decision.reference,
      warning: decision.warning,
    },
  };
}

function validateTrustedSignerConfig(
  config,
  policySha256 = "",
  verificationTime = new Date(),
) {
  const approval = config?.approval;
  const verificationTimeMs =
    verificationTime instanceof Date
      ? verificationTime.getTime()
      : Number(verificationTime);
  const reviewedAtMs = Date.parse(String(approval?.reviewedAt || ""));
  if (
    config?.schemaVersion !== 1 ||
    String(approval?.state || "")
      .trim()
      .toLowerCase() !== "approved" ||
    !String(approval?.reviewedBy || "").trim() ||
    !Number.isFinite(verificationTimeMs) ||
    !Number.isFinite(reviewedAtMs) ||
    reviewedAtMs > verificationTimeMs + 5 * 60 * 1000 ||
    !String(approval?.reviewReference || "").trim() ||
    !Array.isArray(config?.trustedSigners) ||
    config.trustedSigners.length === 0 ||
    !Array.isArray(config?.trustedTimestampAuthorities) ||
    config.trustedTimestampAuthorities.length === 0
  ) {
    throw new Error(
      "Trusted Authenticode signer allowlist is empty, unapproved, or missing reviewed approval metadata.",
    );
  }

  const ids = new Set();
  const trustedSigners = config.trustedSigners.map((signer) => {
    const id = String(signer?.id || "").trim();
    const subject = String(signer?.subject || "").trim();
    const thumbprint = normalizedThumbprint(signer?.thumbprint);
    const certificateSha256 = normalizedThumbprint(signer?.certificateSha256);
    if (
      !/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(id) ||
      ids.has(id.toLowerCase()) ||
      !subject ||
      !/^[A-F0-9]{40}$/.test(thumbprint) ||
      !/^[A-F0-9]{64}$/.test(certificateSha256) ||
      String(signer?.approvalState || "")
        .trim()
        .toLowerCase() !== "approved"
    ) {
      throw new Error(
        `Trusted Authenticode signer entry is invalid: ${id || "<missing id>"}.`,
      );
    }
    ids.add(id.toLowerCase());
    return {
      id,
      subject,
      normalizedSubject: normalizedCertificateSubject(subject),
      thumbprint,
      certificateSha256,
    };
  });

  const timestampIds = new Set();
  const trustedTimestampAuthorities = config.trustedTimestampAuthorities.map(
    (authority) => {
      const id = String(authority?.id || "").trim();
      const subject = String(authority?.subject || "").trim();
      const thumbprint = normalizedThumbprint(authority?.thumbprint);
      const certificateSha256 = normalizedThumbprint(
        authority?.certificateSha256,
      );
      if (
        !/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(id) ||
        timestampIds.has(id.toLowerCase()) ||
        !subject ||
        !/^[A-F0-9]{40}$/.test(thumbprint) ||
        !/^[A-F0-9]{64}$/.test(certificateSha256) ||
        String(authority?.approvalState || "")
          .trim()
          .toLowerCase() !== "approved"
      ) {
        throw new Error(
          `Trusted Authenticode timestamp authority entry is invalid: ${id || "<missing id>"}.`,
        );
      }
      timestampIds.add(id.toLowerCase());
      return {
        id,
        subject,
        normalizedSubject: normalizedCertificateSubject(subject),
        thumbprint,
        certificateSha256,
      };
    },
  );

  return {
    schemaVersion: 1,
    policySha256:
      policySha256 || sha256Buffer(Buffer.from(JSON.stringify(config), "utf8")),
    approval: {
      reviewedAt: approval.reviewedAt,
      reviewedBy: approval.reviewedBy,
      reviewReference: approval.reviewReference,
    },
    trustedSigners,
    trustedTimestampAuthorities,
  };
}

function normalizeWindowsRoot(value) {
  const windowsPath = path.win32;
  const normalized = windowsPath.normalize(String(value || "").trim());
  const parsed = windowsPath.parse(normalized);
  if (
    !windowsPath.isAbsolute(normalized) ||
    !/^[a-z]:\\$/i.test(parsed.root) ||
    windowsPath.basename(normalized).toLowerCase() !== "windows" ||
    windowsPath.dirname(normalized).toLowerCase() !== parsed.root.toLowerCase()
  ) {
    return "";
  }
  return normalized;
}

function resolveWindowsPowerShell({
  env = process.env,
  processExecPath = process.execPath,
  isFile = (filePath) => {
    try {
      return fs.statSync(filePath).isFile();
    } catch {
      return false;
    }
  },
} = {}) {
  const executableRoot = path.win32.parse(
    path.win32.normalize(String(processExecPath || "")),
  ).root;
  if (!/^[a-z]:\\$/i.test(executableRoot)) {
    throw new Error(
      "Trusted Windows root cannot be derived from the running Node executable.",
    );
  }
  const expectedRoot = path.win32.join(executableRoot, "Windows");
  const systemRoot = normalizeWindowsRoot(env?.SystemRoot);
  const windir = normalizeWindowsRoot(env?.WINDIR);
  if (
    (env?.SystemRoot && !systemRoot) ||
    (env?.WINDIR && !windir) ||
    (systemRoot &&
      windir &&
      systemRoot.toLowerCase() !== windir.toLowerCase()) ||
    (systemRoot && systemRoot.toLowerCase() !== expectedRoot.toLowerCase()) ||
    (windir && windir.toLowerCase() !== expectedRoot.toLowerCase())
  ) {
    throw new Error("Windows system root is unsafe or inconsistent.");
  }
  const executablePath = path.win32.join(
    expectedRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  if (!isFile(executablePath)) {
    throw new Error(
      `Trusted Windows PowerShell executable is missing: ${executablePath}`,
    );
  }
  return { executablePath, systemRoot: expectedRoot };
}

function verifyInstallerAuthenticode({
  installerPath,
  platform = process.platform,
  env = process.env,
  spawnSyncImpl = spawnSync,
  isFile,
  processExecPath,
  trustedSignerConfig,
  trustedSignerConfigPath = DEFAULT_TRUSTED_SIGNER_CONFIG_PATH,
  now = () => new Date(),
} = {}) {
  if (platform !== "win32") {
    throw new Error(
      `Authenticode verification is unsupported on ${platform}; Windows publication is refused without an equally strong verifier.`,
    );
  }
  const resolvedInstallerPath = path.resolve(String(installerPath || ""));
  if (
    !String(installerPath || "").trim() ||
    !fs.existsSync(resolvedInstallerPath) ||
    !assertReleaseSourcePath(
      resolvedInstallerPath,
      "Windows launcher installer",
    ).isFile()
  ) {
    throw new Error(
      `Windows launcher installer is missing: ${resolvedInstallerPath}`,
    );
  }

  const loadedConfig = trustedSignerConfig
    ? {
        value: trustedSignerConfig,
        sha256: sha256Buffer(
          Buffer.from(JSON.stringify(trustedSignerConfig), "utf8"),
        ),
      }
    : readTrustedSignerConfig(trustedSignerConfigPath);
  const verificationTime = now();
  if (
    !(verificationTime instanceof Date) ||
    !Number.isFinite(verificationTime.getTime())
  ) {
    throw new Error(
      "Authenticode verification received an invalid review clock.",
    );
  }
  const trustPolicy = validateTrustedSignerConfig(
    loadedConfig.value,
    loadedConfig.sha256,
    verificationTime,
  );
  const powershell = resolveWindowsPowerShell({ env, isFile, processExecPath });
  const result = spawnSyncImpl(
    powershell.executablePath,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      AUTHENTICODE_INSPECTION_SCRIPT,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      env: {
        SystemRoot: powershell.systemRoot,
        WINDIR: powershell.systemRoot,
        [AUTHENTICODE_TARGET_ENV]: resolvedInstallerPath,
      },
    },
  );
  if (result?.error || result?.status !== 0) {
    const detail = String(
      result?.stderr || result?.error?.message || "",
    ).trim();
    throw new Error(
      `Windows Authenticode inspection failed${detail ? `: ${detail}` : "."}`,
    );
  }

  let signature;
  try {
    signature = JSON.parse(
      String(result.stdout || "")
        .replace(/^\uFEFF/, "")
        .trim(),
    );
  } catch (error) {
    throw new Error(
      `Windows Authenticode inspection returned invalid data: ${error.message}`,
    );
  }
  if (signature?.status !== "Valid") {
    throw new Error(
      `Windows launcher installer Authenticode status is not Valid: ${signature?.status || "unknown"}.`,
    );
  }

  const subject = String(signature?.subject || "").trim();
  const thumbprint = normalizedThumbprint(signature?.thumbprint);
  const certificateSha256 = normalizedThumbprint(signature?.certificateSha256);
  const timestampSubject = String(signature?.timestampSubject || "").trim();
  const timestampThumbprint = normalizedThumbprint(
    signature?.timestampThumbprint,
  );
  const timestampCertificateSha256 = normalizedThumbprint(
    signature?.timestampCertificateSha256,
  );
  // `Status=Valid` is the Windows Authenticode trust verdict. Requiring its
  // timestamp certificate as well prevents publication of an otherwise-valid
  // signature that becomes unusable as soon as the signing certificate ages.
  if (
    !timestampSubject ||
    !/^[A-F0-9]{40}$/.test(timestampThumbprint) ||
    !/^[A-F0-9]{64}$/.test(timestampCertificateSha256)
  ) {
    throw new Error(
      "Windows launcher installer must have a trusted Authenticode timestamp certificate.",
    );
  }
  const trustedSigner = trustPolicy.trustedSigners.find(
    (signer) =>
      signer.thumbprint === thumbprint &&
      signer.certificateSha256 === certificateSha256 &&
      signer.normalizedSubject === normalizedCertificateSubject(subject),
  );
  if (!trustedSigner) {
    throw new Error(
      `Windows launcher installer signer certificate is not in the reviewed allowlist: ${subject || "<missing subject>"} (certificate SHA-256 ${certificateSha256 || "missing"}; SHA-1 thumbprint ${thumbprint || "missing"}).`,
    );
  }
  const trustedTimestampAuthority =
    trustPolicy.trustedTimestampAuthorities.find(
      (authority) =>
        authority.thumbprint === timestampThumbprint &&
        authority.certificateSha256 === timestampCertificateSha256 &&
        authority.normalizedSubject ===
          normalizedCertificateSubject(timestampSubject),
    );
  if (!trustedTimestampAuthority) {
    throw new Error(
      `Windows launcher installer timestamp certificate is not in the reviewed allowlist: ${timestampSubject} (certificate SHA-256 ${timestampCertificateSha256}; SHA-1 thumbprint ${timestampThumbprint}).`,
    );
  }

  return {
    status: "verified",
    authenticodeStatus: "Valid",
    publisher: subject,
    trustedSignerId: trustedSigner.id,
    subject,
    issuer: String(signature.issuer || "").trim() || null,
    certificateSha256,
    thumbprintAlgorithm: "SHA-1",
    thumbprint,
    serialNumber: String(signature.serialNumber || "").trim() || null,
    certificateNotBefore: signature.certificateNotBefore || null,
    certificateNotAfter: signature.certificateNotAfter || null,
    timestampSubject,
    trustedTimestampAuthorityId: trustedTimestampAuthority.id,
    timestampCertificateSha256,
    timestampThumbprintAlgorithm: "SHA-1",
    timestampThumbprint,
    verifiedAt: verificationTime.toISOString(),
    trustPolicy: {
      schemaVersion: trustPolicy.schemaVersion,
      sha256: trustPolicy.policySha256,
      reviewedAt: trustPolicy.approval.reviewedAt,
      reviewedBy: trustPolicy.approval.reviewedBy,
      reviewReference: trustPolicy.approval.reviewReference,
    },
  };
}

function verifyInstallerUnsigned({
  installerPath,
  platform = process.platform,
  env = process.env,
  spawnSyncImpl = spawnSync,
  isFile,
  processExecPath,
  unsignedReleasePolicy,
  unsignedReleasePolicyPath = DEFAULT_UNSIGNED_RELEASE_POLICY_PATH,
  now = () => new Date(),
} = {}) {
  if (platform !== "win32") {
    throw new Error(
      `Unsigned Windows launcher verification is unsupported on ${platform}; publication requires a Windows NotSigned verdict.`,
    );
  }
  const resolvedInstallerPath = path.resolve(String(installerPath || ""));
  if (
    !String(installerPath || "").trim() ||
    !fs.existsSync(resolvedInstallerPath) ||
    !assertReleaseSourcePath(
      resolvedInstallerPath,
      "Unsigned Windows launcher executable",
    ).isFile()
  ) {
    throw new Error(
      `Unsigned Windows launcher executable is missing: ${resolvedInstallerPath}`,
    );
  }

  const loadedPolicy = unsignedReleasePolicy
    ? {
        value: unsignedReleasePolicy,
        sha256: sha256Buffer(
          Buffer.from(JSON.stringify(unsignedReleasePolicy), "utf8"),
        ),
      }
    : readUnsignedReleasePolicy(unsignedReleasePolicyPath);
  const verificationTime = now();
  if (
    !(verificationTime instanceof Date) ||
    !Number.isFinite(verificationTime.getTime())
  ) {
    throw new Error("Unsigned launcher verification received an invalid review clock.");
  }
  const releasePolicy = validateUnsignedReleasePolicy(
    loadedPolicy.value,
    loadedPolicy.sha256,
    verificationTime,
  );
  const powershell = resolveWindowsPowerShell({ env, isFile, processExecPath });
  const result = spawnSyncImpl(
    powershell.executablePath,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      AUTHENTICODE_INSPECTION_SCRIPT,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      env: {
        SystemRoot: powershell.systemRoot,
        WINDIR: powershell.systemRoot,
        [AUTHENTICODE_TARGET_ENV]: resolvedInstallerPath,
      },
    },
  );
  if (result?.error || result?.status !== 0) {
    const detail = String(
      result?.stderr || result?.error?.message || "",
    ).trim();
    throw new Error(
      `Windows unsigned-status inspection failed${detail ? `: ${detail}` : "."}`,
    );
  }

  let signature;
  try {
    signature = JSON.parse(
      String(result.stdout || "")
        .replace(/^\uFEFF/, "")
        .trim(),
    );
  } catch (error) {
    throw new Error(
      `Windows unsigned-status inspection returned invalid data: ${error.message}`,
    );
  }
  const unexpectedIdentity = [
    signature?.subject,
    signature?.issuer,
    signature?.thumbprint,
    signature?.certificateSha256,
    signature?.serialNumber,
    signature?.timestampSubject,
    signature?.timestampThumbprint,
    signature?.timestampCertificateSha256,
  ].some((value) => String(value || "").trim());
  if (signature?.status !== "NotSigned" || unexpectedIdentity) {
    throw new Error(
      `Windows launcher must be explicitly unsigned: expected NotSigned with no certificate identity, received ${signature?.status || "unknown"}.`,
    );
  }

  return {
    status: "unsigned",
    authenticodeStatus: "NotSigned",
    publisher: null,
    certificateSha256: null,
    checkedAt: verificationTime.toISOString(),
    warning: releasePolicy.decision.warning,
    policy: {
      schemaVersion: releasePolicy.schemaVersion,
      releaseMode: releasePolicy.releaseMode,
      sha256: releasePolicy.policySha256,
      decidedAt: releasePolicy.decision.decidedAt,
      decidedBy: releasePolicy.decision.decidedBy,
      reference: releasePolicy.decision.reference,
    },
  };
}

function resolveSevenZip({
  platform = process.platform,
  arch = process.arch,
  rootDir = repoRoot,
  toolchainPath = DEFAULT_RELEASE_TOOLCHAIN_PATH,
} = {}) {
  const toolchainFile = assertReleaseSourcePath(
    toolchainPath,
    "Desktop release toolchain policy",
  );
  if (!toolchainFile.isFile()) {
    throw new Error("Desktop release toolchain policy is not a regular file.");
  }
  const toolchain = JSON.parse(fs.readFileSync(toolchainPath, "utf8"));
  const lockPath = path.join(rootDir, String(toolchain?.lockfile || ""));
  const lockFile = assertReleaseSourcePath(
    lockPath,
    "Desktop release npm lockfile",
  );
  if (!lockFile.isFile()) {
    throw new Error("Desktop release npm lockfile is not a regular file.");
  }
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  const packageName = String(toolchain?.sevenZip?.package || "");
  const version = String(toolchain?.sevenZip?.version || "");
  const integrity = String(toolchain?.sevenZip?.npmIntegrity || "");
  const lockEntry = lock?.packages?.[`node_modules/${packageName}`];
  if (
    toolchain?.schemaVersion !== 1 ||
    toolchain?.packageManager !== "npm" ||
    packageName !== "7zip-bin" ||
    lockEntry?.version !== version ||
    lockEntry?.integrity !== integrity
  ) {
    throw new Error(
      "Desktop release 7-Zip policy does not match the authoritative npm lockfile.",
    );
  }

  const platformDirectory =
    platform === "win32" ? "win" : platform === "darwin" ? "mac" : platform;
  const executableName = platform === "win32" ? "7za.exe" : "7za";
  const expectedHash = String(
    toolchain?.sevenZip?.binaries?.[`${platform}-${arch}`] || "",
  ).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
    throw new Error(
      `Desktop release 7-Zip binary is unsupported on ${platform}-${arch}.`,
    );
  }
  const packageRoot = path.join(rootDir, "node_modules", packageName);
  const packageJsonPath = path.join(packageRoot, "package.json");
  const packageFile = assertReleaseSourcePath(
    packageJsonPath,
    "Desktop release 7-Zip package",
  );
  if (!packageFile.isFile()) {
    throw new Error("Desktop release 7-Zip package is not a regular file.");
  }
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  if (packageJson.version !== version) {
    throw new Error(
      "Installed desktop release 7-Zip package does not match the lockfile.",
    );
  }
  const executablePath = path.join(
    packageRoot,
    platformDirectory,
    arch,
    executableName,
  );
  const executable = assertReleaseSourcePath(
    executablePath,
    "Desktop release 7-Zip binary",
  );
  if (!executable.isFile() || sha256File(executablePath) !== expectedHash) {
    throw new Error(
      "Installed desktop release 7-Zip binary failed hash attestation.",
    );
  }
  return executablePath;
}

function archiveLimits(overrides = {}) {
  const unknownKeys = Object.keys(overrides).filter(
    (key) => !Object.prototype.hasOwnProperty.call(DEFAULT_ARCHIVE_LIMITS, key),
  );
  if (unknownKeys.length > 0) {
    throw new Error(
      `Unknown launcher archive limit: ${unknownKeys.sort().join(", ")}.`,
    );
  }
  return Object.fromEntries(
    Object.entries(DEFAULT_ARCHIVE_LIMITS).map(([key, defaultValue]) => {
      const value = overrides[key] ?? defaultValue;
      if (!Number.isSafeInteger(value) || value <= 0 || value > defaultValue) {
        throw new Error(
          `Launcher archive limit ${key} must be a positive integer no greater than ${defaultValue}.`,
        );
      }
      return [key, value];
    }),
  );
}

function normalizedArchiveEntryPath(value, label = "Launcher archive entry") {
  const normalized = String(value || "").replace(/\\/g, "/");
  const segments = normalized.split("/");
  const unsafeWindowsSegment = segments.some(
    (segment) =>
      /[. ]$/.test(segment) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment),
  );
  if (
    !normalized ||
    normalized.length > ARCHIVE_ENTRY_PATH_MAX_LENGTH ||
    normalized.startsWith("/") ||
    normalized.startsWith("-") ||
    normalized.startsWith("@") ||
    /^[a-z]:/i.test(normalized) ||
    /[\0-\x1f\x7f:*?"<>|]/.test(normalized) ||
    segments.some(
      (segment) => !segment || segment === "." || segment === "..",
    ) ||
    unsafeWindowsSegment
  ) {
    throw new Error(`${label} path is unsafe: ${JSON.stringify(value)}.`);
  }
  return segments.join("/");
}

function archiveEntryKey(value) {
  return normalizedArchiveEntryPath(value).toLowerCase();
}

function spawnFailureDetail(result) {
  const stderr = Buffer.isBuffer(result?.stderr)
    ? result.stderr.toString("utf8")
    : String(result?.stderr || "");
  return String(stderr || result?.error?.message || "").trim();
}

function archiveMetadataMarkerEnabled(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return !["", "-", "0", "false", "no"].includes(normalized);
}

function assertArchiveCommandSucceeded(result, action) {
  if (
    result?.error?.code === "ETIMEDOUT" ||
    result?.error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ||
    result?.error?.code === "ENOBUFS" ||
    (result?.status === null && result?.signal)
  ) {
    const reason =
      result?.error?.code === "ETIMEDOUT" || result?.signal
        ? "timed out"
        : "exceeded its output limit";
    throw new Error(`Launcher archive ${action} ${reason}.`);
  }
  if (result?.error || result?.status !== 0) {
    const detail = spawnFailureDetail(result);
    throw new Error(
      `Launcher archive ${action} failed${detail ? `: ${detail}` : "."}`,
    );
  }
}

function parseArchiveListing(output, limits) {
  const lines = String(output || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/);
  const entryStart = lines.findIndex((line) => /^-{5,}\s*$/.test(line));
  if (entryStart < 0) {
    throw new Error("Launcher archive listing did not contain entry metadata.");
  }

  const records = [];
  let fields = new Map();
  const flush = () => {
    if (fields.size > 0) {
      records.push(fields);
      fields = new Map();
    }
  };
  for (const line of lines.slice(entryStart + 1)) {
    if (!line.trim()) {
      flush();
      continue;
    }
    if (/^Warnings:\s+\d+\s*$/.test(line)) {
      flush();
      continue;
    }
    const separator = line.indexOf(" = ");
    if (separator <= 0) {
      throw new Error("Launcher archive listing contains malformed metadata.");
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 3);
    if (!key || fields.has(key)) {
      throw new Error("Launcher archive listing contains ambiguous metadata.");
    }
    fields.set(key, value);
  }
  flush();

  if (records.length === 0) {
    throw new Error("Launcher archive listing is empty.");
  }
  if (records.length > limits.maxEntryCount) {
    throw new Error(
      `Launcher archive contains too many entries (${records.length}; maximum ${limits.maxEntryCount}).`,
    );
  }

  const entries = new Map();
  let fileCount = 0;
  let totalExpandedSize = 0n;
  for (const record of records) {
    const entryPath = normalizedArchiveEntryPath(
      record.get("Path"),
      "Launcher archive metadata entry",
    );
    const key = archiveEntryKey(entryPath);
    if (entries.has(key)) {
      throw new Error(
        `Launcher archive contains duplicate or case-colliding entries: ${entryPath}.`,
      );
    }
    const linkField = Array.from(record.entries()).find(
      ([name, value]) =>
        /(?:symbolic|hard\s*link|reparse|junction)/i.test(name) &&
        archiveMetadataMarkerEnabled(value),
    );
    const attributes = String(record.get("Attributes") || "");
    const windowsAttributes = attributes.trim().split(/\s+/, 1)[0];
    if (
      linkField ||
      windowsAttributes.includes("L") ||
      /(?:^|\s)l[rwxstST-]{9}(?:\s|$)/.test(attributes)
    ) {
      throw new Error(
        `Launcher archive entry must not be a link, junction, or reparse point: ${entryPath}.`,
      );
    }
    if (String(record.get("Encrypted") || "-").trim() === "+") {
      throw new Error(
        `Launcher archive entry must not be encrypted: ${entryPath}.`,
      );
    }

    const folder = String(record.get("Folder") || "").trim();
    const attributeDirectory = windowsAttributes.includes("D");
    if (
      !["", "+", "-"].includes(folder) ||
      (folder === "+" && !attributeDirectory) ||
      (folder === "-" && attributeDirectory)
    ) {
      throw new Error(
        `Launcher archive entry has incomplete folder metadata: ${entryPath}.`,
      );
    }
    const isDirectory = folder === "+" || (folder === "" && attributeDirectory);
    const sizeText = String(record.get("Size") || "").trim();
    if (!/^\d+$/.test(sizeText) || sizeText.length > 20) {
      throw new Error(
        `Launcher archive entry has an invalid expanded size: ${entryPath}.`,
      );
    }
    const size = BigInt(sizeText);
    if (size > BigInt(limits.maxEntrySizeBytes)) {
      throw new Error(
        `Launcher archive entry exceeds the expanded-size limit: ${entryPath}.`,
      );
    }
    if (!isDirectory) {
      fileCount += 1;
      totalExpandedSize += size;
    } else if (size !== 0n) {
      throw new Error(
        `Launcher archive directory has a non-zero expanded size: ${entryPath}.`,
      );
    }
    entries.set(key, {
      path: entryPath,
      isDirectory,
      size: Number(size),
    });
  }
  if (fileCount > limits.maxFileCount) {
    throw new Error(
      `Launcher archive contains too many files (${fileCount}; maximum ${limits.maxFileCount}).`,
    );
  }
  if (totalExpandedSize > BigInt(limits.maxTotalExpandedSizeBytes)) {
    throw new Error(
      `Launcher archive exceeds the total expanded-size limit (${totalExpandedSize} bytes).`,
    );
  }
  return entries;
}

function listArchiveEntries(
  archivePath,
  { sevenZipPath, spawnSyncImpl, limits },
) {
  const result = spawnSyncImpl(
    sevenZipPath,
    ["l", "-slt", "-bd", "-bb0", path.resolve(archivePath)],
    {
      encoding: "utf8",
      maxBuffer: ARCHIVE_LISTING_MAX_BUFFER_BYTES,
      timeout: limits.listTimeoutMs,
      windowsHide: true,
    },
  );
  assertArchiveCommandSucceeded(result, "metadata inspection");
  return parseArchiveListing(result.stdout, limits);
}

function comparableContainedPath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function assertContainedExtractedPath(destination, destinationReal, filePath) {
  const resolved = path.resolve(filePath);
  const relative = path.relative(destination, resolved);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      `Extracted launcher path escapes its destination: ${resolved}.`,
    );
  }
  const physical = fs.realpathSync.native(resolved);
  const physicalRelative = path.relative(destinationReal, physical);
  if (
    physicalRelative === ".." ||
    physicalRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(physicalRelative) ||
    comparableContainedPath(physical) !== comparableContainedPath(resolved)
  ) {
    throw new Error(
      `Extracted launcher path traverses a link, junction, reparse point, or containment escape: ${resolved}.`,
    );
  }
}

function sameFileIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function readStableExtractedFile(filePath, expectedSize) {
  const initial = fs.lstatSync(filePath);
  if (initial.isSymbolicLink() || !initial.isFile()) {
    throw new Error(
      `Extracted launcher entry must be a regular file: ${filePath}.`,
    );
  }
  if (Number(initial.nlink || 1) !== 1) {
    throw new Error(
      `Extracted launcher entry must not be a multiply linked file: ${filePath}.`,
    );
  }
  if (initial.size !== expectedSize) {
    throw new Error(
      `Extracted launcher entry size does not match archive metadata: ${filePath}.`,
    );
  }

  const noFollow = Number(fs.constants.O_NOFOLLOW || 0);
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || !sameFileIdentity(initial, opened)) {
      throw new Error(
        `Extracted launcher entry changed before it could be read safely: ${filePath}.`,
      );
    }
    const value = Buffer.alloc(expectedSize);
    let offset = 0;
    while (offset < expectedSize) {
      const bytesRead = fs.readSync(
        descriptor,
        value,
        offset,
        expectedSize - offset,
        offset,
      );
      if (bytesRead === 0) {
        throw new Error(
          `Extracted launcher entry ended before its declared size: ${filePath}.`,
        );
      }
      offset += bytesRead;
    }
    const afterRead = fs.fstatSync(descriptor);
    const afterPath = fs.lstatSync(filePath);
    if (
      !sameFileIdentity(opened, afterRead) ||
      !sameFileIdentity(opened, afterPath)
    ) {
      throw new Error(
        `Extracted launcher entry changed while it was being read: ${filePath}.`,
      );
    }
    return value;
  } finally {
    fs.closeSync(descriptor);
  }
}

function readExtractedEntries(destination, requestedEntries, limits) {
  const destinationReal = fs.realpathSync.native(destination);
  if (
    comparableContainedPath(destinationReal) !==
    comparableContainedPath(destination)
  ) {
    throw new Error(
      `Launcher extraction destination traverses a redirected or reparse path: ${destination}.`,
    );
  }
  const extracted = new Map();
  let visitedCount = 0;
  let extractedSize = 0;
  const visit = (directory) => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      visitedCount += 1;
      if (visitedCount > limits.maxEntryCount) {
        throw new Error(
          "Launcher extraction created too many filesystem entries.",
        );
      }
      const filePath = path.join(directory, item.name);
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink()) {
        throw new Error(
          `Extracted launcher entry must not be a link, junction, or reparse point: ${filePath}.`,
        );
      }
      assertContainedExtractedPath(destination, destinationReal, filePath);
      if (stat.isDirectory()) {
        const relativeDirectory = path
          .relative(destination, filePath)
          .replace(/\\/g, "/");
        if (
          !Array.from(requestedEntries.values()).some((entry) =>
            entry.path.startsWith(`${relativeDirectory}/`),
          )
        ) {
          throw new Error(
            `Launcher extraction created an unexpected directory: ${relativeDirectory}.`,
          );
        }
        visit(filePath);
        continue;
      }
      if (!stat.isFile()) {
        throw new Error(
          `Extracted launcher entry must be a regular file: ${filePath}.`,
        );
      }
      const relativePath = path
        .relative(destination, filePath)
        .replace(/\\/g, "/");
      const key = archiveEntryKey(relativePath);
      const requested = requestedEntries.get(key);
      if (!requested || requested.path !== relativePath) {
        throw new Error(
          `Launcher extraction created an unexpected file: ${relativePath}.`,
        );
      }
      extractedSize += stat.size;
      if (extractedSize > limits.maxSelectedExpandedSizeBytes) {
        throw new Error(
          "Launcher extraction exceeded the selected expanded-size limit.",
        );
      }
      extracted.set(
        requested.requestedPath,
        readStableExtractedFile(filePath, requested.size),
      );
    }
  };
  visit(destination);
  for (const requested of requestedEntries.values()) {
    if (!extracted.has(requested.requestedPath)) {
      throw new Error(
        `Launcher archive entry is missing: ${requested.requestedPath}`,
      );
    }
  }
  return extracted;
}

function extractArchiveEntry(archivePath, entryPath, options = {}) {
  return extractArchiveEntries(archivePath, [entryPath], options).get(
    entryPath,
  );
}

function extractArchiveEntries(archivePath, entryPaths, options = {}) {
  const archive = path.resolve(String(archivePath || ""));
  const archiveStat = assertReleaseSourcePath(
    archive,
    "Launcher release archive",
  );
  if (!archiveStat.isFile()) {
    throw new Error(
      `Launcher release archive is not a regular file: ${archive}.`,
    );
  }
  const limits = archiveLimits(options.archiveLimits);
  const sevenZipPath = options.sevenZipPath || resolveSevenZip();
  const spawnSyncImpl = options.spawnSyncImpl || spawnSync;
  const listedEntries = listArchiveEntries(archive, {
    sevenZipPath,
    spawnSyncImpl,
    limits,
  });
  const requestedEntries = new Map();
  let selectedExpandedSize = 0;
  for (const requestedPath of Array.from(new Set(entryPaths))) {
    const normalized = normalizedArchiveEntryPath(
      requestedPath,
      "Requested launcher archive entry",
    );
    const key = archiveEntryKey(normalized);
    if (requestedEntries.has(key)) {
      throw new Error(
        `Requested launcher archive entries collide: ${normalized}.`,
      );
    }
    const listed = listedEntries.get(key);
    if (!listed || listed.path !== normalized || listed.isDirectory) {
      throw new Error(`Launcher archive entry is missing: ${requestedPath}`);
    }
    if (listed.size > limits.maxSelectedEntrySizeBytes) {
      throw new Error(
        `Requested launcher archive entry exceeds the readable size limit: ${requestedPath}.`,
      );
    }
    selectedExpandedSize += listed.size;
    if (selectedExpandedSize > limits.maxSelectedExpandedSizeBytes) {
      throw new Error(
        "Requested launcher archive entries exceed the selected expanded-size limit.",
      );
    }
    requestedEntries.set(key, {
      ...listed,
      requestedPath,
    });
  }
  if (requestedEntries.size === 0) {
    throw new Error("Launcher archive verification set is empty.");
  }

  const tempRoot = path.resolve(options.tempRoot || os.tmpdir());
  if (
    !assertReleaseSourcePath(
      tempRoot,
      "Launcher verification temp root",
    ).isDirectory()
  ) {
    throw new Error(
      `Launcher verification temp root is not a directory: ${tempRoot}.`,
    );
  }
  const destination = fs.mkdtempSync(
    path.join(tempRoot, "arenzyra-launcher-verify-"),
  );
  try {
    assertReleaseSourcePath(destination, "Launcher extraction destination");
    const result = spawnSyncImpl(
      sevenZipPath,
      [
        "x",
        "-y",
        "-bd",
        "-bb0",
        `-o${destination}`,
        archive,
        ...Array.from(requestedEntries.values()).map((entry) => entry.path),
      ],
      {
        encoding: "utf8",
        maxBuffer: ARCHIVE_EXTRACT_MAX_BUFFER_BYTES,
        timeout: limits.extractTimeoutMs,
        windowsHide: true,
      },
    );
    assertArchiveCommandSucceeded(result, "extraction");
    return readExtractedEntries(destination, requestedEntries, limits);
  } finally {
    fs.rmSync(destination, { recursive: true, force: true });
  }
}

function launcherArtifactNames(version) {
  const normalized = String(version || "").trim();
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(normalized)) {
    throw new Error(`Invalid launcher version: ${version}`);
  }
  return {
    installer: `Arenzyra Observer Launcher Setup ${normalized}.exe`,
    portableZip: `Arenzyra Observer Launcher-${normalized}-win.zip`,
  };
}

function comparableReleasePath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function assertReleaseSourcePath(filePath, label = "Launcher release input") {
  const resolved = path.resolve(String(filePath || ""));
  if (!String(filePath || "").trim()) {
    throw new Error(`${label} path is empty.`);
  }
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch (error) {
    throw new Error(
      `${label} is missing: ${resolved} (${error.code || error.message})`,
    );
  }
  if (stat.isSymbolicLink()) {
    throw new Error(
      `${label} must not be a symbolic link or junction: ${resolved}`,
    );
  }
  if (stat.isFile() && Number(stat.nlink || 1) !== 1) {
    throw new Error(`${label} must not be a multiply linked file: ${resolved}`);
  }
  const physicalPath = fs.realpathSync.native(resolved);
  if (comparableReleasePath(physicalPath) !== comparableReleasePath(resolved)) {
    throw new Error(
      `${label} traverses a redirected or reparse path: ${resolved}`,
    );
  }
  return stat;
}

function recursiveSourceEntries(sourceRoot, entryRoot) {
  if (
    !fs.existsSync(sourceRoot) ||
    !assertReleaseSourcePath(
      sourceRoot,
      "Launcher release source directory",
    ).isDirectory()
  ) {
    throw new Error(
      `Launcher release source directory is missing: ${sourceRoot}`,
    );
  }
  const entries = [];
  const visit = (directory) => {
    for (const item of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const sourcePath = path.join(directory, item.name);
      const stat = assertReleaseSourcePath(
        sourcePath,
        "Launcher release source entry",
      );
      if (stat.isDirectory()) {
        visit(sourcePath);
      } else if (stat.isFile()) {
        const relative = path
          .relative(sourceRoot, sourcePath)
          .replace(/\\/g, "/");
        entries.push({
          entryPath: `${entryRoot}/${relative}`,
          sourcePath,
        });
      }
    }
  };
  visit(sourceRoot);
  return entries;
}

function defaultSourceEntries(rootDir = repoRoot) {
  const desktopRoot = path.join(rootDir, "apps", "desktop");
  const entries = [
    {
      entryPath: "resources/connectors/ob.js",
      sourcePath: path.join(rootDir, "ob.js"),
    },
    {
      entryPath: "resources/connectors/connector-http-access-policy.cjs",
      sourcePath: path.join(
        rootDir,
        "apps",
        "desktop",
        "electron",
        "connector-http-access-policy.cjs",
      ),
    },
    {
      entryPath: "resources/connectors/direct-observer-transport-payload.cjs",
      sourcePath: path.join(
        rootDir,
        "apps",
        "desktop",
        "electron",
        "direct-observer-transport-payload.cjs",
      ),
    },
    {
      entryPath: "resources/connectors/observer-runtime-health.cjs",
      sourcePath: path.join(
        rootDir,
        "apps",
        "desktop",
        "electron",
        "observer-runtime-health.cjs",
      ),
    },
    {
      entryPath: "resources/connectors/observer-telemetry-contract.cjs",
      sourcePath: path.join(
        rootDir,
        "apps",
        "desktop",
        "electron",
        "observer-telemetry-contract.cjs",
      ),
    },
    {
      entryPath: "resources/icon.ico",
      sourcePath: path.join(desktopRoot, "build", "icon.ico"),
    },
    {
      entryPath: "resources/default-team.png",
      sourcePath: path.join(desktopRoot, "build", "default-team.png"),
    },
    {
      entryPath: "resources/default-player.svg",
      sourcePath: path.join(desktopRoot, "build", "default-player.svg"),
    },
    {
      entryPath: "resources/shadow-logo-template.svg",
      sourcePath: path.join(desktopRoot, "build", "shadow-logo-template.svg"),
    },
    ...listPackagedElectronRuntimeFiles({ desktopRoot }).map(
      (relativePath) => ({
        entryPath: `resources/app/${relativePath}`,
        sourcePath: path.join(desktopRoot, ...relativePath.split("/")),
      }),
    ),
    {
      entryPath: "resources/app/dist/index.html",
      sourcePath: path.join(desktopRoot, "dist", "index.html"),
    },
    ...recursiveSourceEntries(
      path.join(desktopRoot, "dist", "assets"),
      "resources/app/dist/assets",
    ),
  ];
  return Array.from(
    new Map(entries.map((entry) => [entry.entryPath, entry])).values(),
  ).sort((left, right) => left.entryPath.localeCompare(right.entryPath));
}

function inspectLauncherArchive({
  archivePath,
  expectedVersion,
  expectedPackage = {
    name: "arenzyra-observer-launcher",
    version: expectedVersion,
  },
  sourceEntries = defaultSourceEntries(),
  sevenZipPath,
}) {
  assertReleaseSourcePath(archivePath, "Launcher release artifact");
  const resolvedSevenZipPath = sevenZipPath || resolveSevenZip();
  const limits = archiveLimits();
  const listedEntries = listArchiveEntries(archivePath, {
    sevenZipPath: resolvedSevenZipPath,
    spawnSyncImpl: spawnSync,
    limits,
  });
  const packagedWithAsar = listedEntries.has("resources/app.asar");
  const appSourceEntries = sourceEntries.filter((entry) =>
    entry.entryPath.startsWith("resources/app/"),
  );
  const outerSourceEntries = sourceEntries.filter(
    (entry) => !entry.entryPath.startsWith("resources/app/"),
  );
  const entryPaths = Array.from(
    new Set(
      packagedWithAsar
        ? [
            "resources/app.asar",
            ...outerSourceEntries.map((entry) => entry.entryPath),
          ]
        : [
            "resources/app/package.json",
            ...sourceEntries.map((entry) => entry.entryPath),
          ],
    ),
  );
  const packagedEntries = extractArchiveEntries(archivePath, entryPaths, {
    sevenZipPath: resolvedSevenZipPath,
  });
  let packageBuffer;
  let appAsarPath = null;
  let appAsarRoot = null;
  if (packagedWithAsar) {
    appAsarRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "arenzyra-launcher-asar-"),
    );
    appAsarPath = path.join(appAsarRoot, "app.asar");
    fs.writeFileSync(
      appAsarPath,
      packagedEntries.get("resources/app.asar"),
      { flag: "wx" },
    );
    packageBuffer = asar.extractFile(appAsarPath, "package.json", false);
  } else {
    packageBuffer = packagedEntries.get("resources/app/package.json");
  }
  let packaged;
  try {
    packaged = JSON.parse(packageBuffer.toString("utf8"));
  } catch (error) {
    throw new Error(
      `Packaged launcher package.json is invalid in ${archivePath}: ${error.message}`,
    );
  }
  for (const field of [
    "name",
    "version",
    "private",
    "type",
    "description",
    "author",
    "main",
    "dependencies",
  ]) {
    if (
      Object.prototype.hasOwnProperty.call(expectedPackage, field) &&
      !isDeepStrictEqual(packaged[field], expectedPackage[field])
    ) {
      throw new Error(
        `Packaged launcher package.json ${field} mismatch in ${archivePath}`,
      );
    }
  }

  const resources = {};
  try {
    for (const sourceEntry of sourceEntries) {
      if (
        !fs.existsSync(sourceEntry.sourcePath) ||
        !assertReleaseSourcePath(
          sourceEntry.sourcePath,
          "Launcher release source",
        ).isFile()
      ) {
        throw new Error(
          `Launcher release source is missing: ${sourceEntry.sourcePath}`,
        );
      }
      const expectedHash = sha256File(sourceEntry.sourcePath);
      const packagedBuffer = packagedWithAsar
        ? sourceEntry.entryPath.startsWith("resources/app/")
          ? asar.extractFile(
              appAsarPath,
              sourceEntry.entryPath
                .slice("resources/app/".length)
                .split("/")
                .join(path.sep),
              false,
            )
          : packagedEntries.get(sourceEntry.entryPath)
        : packagedEntries.get(sourceEntry.entryPath);
      if (!packagedBuffer) {
        throw new Error(
          `Launcher archive entry is missing: ${sourceEntry.entryPath}`,
        );
      }
      const packagedHash = sha256Buffer(packagedBuffer);
      if (packagedHash !== expectedHash) {
        throw new Error(
          `Stale launcher resource in ${archivePath}: ${sourceEntry.entryPath} expected ${expectedHash}, received ${packagedHash}`,
        );
      }
      resources[sourceEntry.entryPath] = {
        sha256: packagedHash,
        size: packagedBuffer.length,
      };
    }
  } finally {
    if (appAsarRoot) {
      asar.uncache(appAsarPath);
      fs.rmSync(appAsarRoot, { recursive: true, force: true });
    }
  }

  const stat = fs.statSync(archivePath);
  return {
    path: path.resolve(archivePath),
    size: stat.size,
    sha256: sha256File(archivePath),
    version: expectedVersion,
    resources,
  };
}

function assertPackagedMapProvenance(resources, mapProvenance, artifactLabel) {
  const assets = mapProvenance?.assets;
  const assetEntries =
    assets && typeof assets === "object" && !Array.isArray(assets)
      ? Object.entries(assets)
      : [];
  if (
    !Number.isSafeInteger(Number(mapProvenance?.assetCount)) ||
    Number(mapProvenance.assetCount) < 0 ||
    assetEntries.length !== Number(mapProvenance.assetCount)
  ) {
    throw new Error(
      `Verified map provenance inventory is incomplete for ${artifactLabel}.`,
    );
  }
  const approvalState = String(mapProvenance?.approval?.state || "")
    .trim()
    .toLowerCase();
  if (
    (assetEntries.length === 0 &&
      approvalState !== NO_BUNDLED_COMMERCIAL_ASSETS_STATE) ||
    (assetEntries.length > 0 && approvalState !== "approved")
  ) {
    throw new Error(
      `Verified map provenance approval state is invalid for ${artifactLabel}.`,
    );
  }
  const declaredEntryPaths = new Set();
  for (const [assetPath, metadata] of assetEntries) {
    const normalizedPath = path.posix.normalize(String(assetPath || ""));
    const expectedHash = String(metadata?.sha256 || "").toLowerCase();
    if (
      !assetPath ||
      assetPath.includes("\\") ||
      path.posix.isAbsolute(assetPath) ||
      normalizedPath !== assetPath ||
      normalizedPath === ".." ||
      normalizedPath.startsWith("../") ||
      !/^[a-f0-9]{64}$/.test(expectedHash)
    ) {
      throw new Error(
        `Verified map provenance contains an invalid asset for ${artifactLabel}.`,
      );
    }
    const entryPath = `resources/app/electron/assets/maps/${assetPath}`;
    declaredEntryPaths.add(entryPath.toLowerCase());
    if (resources?.[entryPath]?.sha256 !== expectedHash) {
      throw new Error(
        `${artifactLabel} does not contain the reviewed map bytes for ${assetPath}.`,
      );
    }
  }
  const packagedCommercialMapPaths = Object.keys(resources || {})
    .filter((entryPath) =>
      /^resources\/app\/electron\/assets\/maps\/.+\.(?:jpe?g|png|webp)$/i.test(
        entryPath,
      ),
    )
    .map((entryPath) => entryPath.toLowerCase())
    .sort((left, right) => left.localeCompare(right));
  const unexpectedPaths = packagedCommercialMapPaths.filter(
    (entryPath) => !declaredEntryPaths.has(entryPath),
  );
  if (
    unexpectedPaths.length > 0 ||
    packagedCommercialMapPaths.length !== declaredEntryPaths.size
  ) {
    throw new Error(
      `${artifactLabel} commercial map raster inventory does not exactly match the verified provenance.`,
    );
  }
}

function verifyLauncherReleaseArtifacts({
  distDir = path.join(repoRoot, "apps", "desktop", "dist"),
  packageJsonPath = path.join(repoRoot, "apps", "desktop", "package.json"),
  sourceEntries = defaultSourceEntries(),
  sevenZipPath,
  unsignedVerification = {},
  mapProvenanceVerifier = verifyDesktopMapCommercialProvenance,
  mapProvenanceOptions = { repoRoot },
  completeRuntimeVerifier = verifyCompletePackagedRuntime,
} = {}) {
  const mapProvenance = mapProvenanceVerifier(mapProvenanceOptions);
  assertReleaseSourcePath(packageJsonPath, "Desktop package.json");
  const desktopPackage = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const version = String(desktopPackage.version || "").trim();
  const names = launcherArtifactNames(version);
  const installerPath = path.join(distDir, names.installer);
  const portableZipPath = path.join(distDir, names.portableZip);
  for (const artifactPath of [installerPath, portableZipPath]) {
    if (!fs.existsSync(artifactPath)) {
      throw new Error(`Expected launcher artifact is missing: ${artifactPath}`);
    }
    if (
      !assertReleaseSourcePath(
        artifactPath,
        "Launcher release artifact",
      ).isFile()
    ) {
      throw new Error(
        `Expected launcher artifact is not a file: ${artifactPath}`,
      );
    }
  }

  const snapshotRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "arenzyra-launcher-artifact-snapshot-"),
  );
  let signingMetadata;
  let installer;
  let portableZip;
  let packagedRuntimeIntegrity;
  try {
    const installerSnapshot = path.join(snapshotRoot, "installer.exe");
    const portableZipSnapshot = path.join(snapshotRoot, "portable.zip");
    fs.copyFileSync(
      installerPath,
      installerSnapshot,
      fs.constants.COPYFILE_EXCL,
    );
    fs.copyFileSync(
      portableZipPath,
      portableZipSnapshot,
      fs.constants.COPYFILE_EXCL,
    );
    assertReleaseSourcePath(installerSnapshot, "Launcher installer snapshot");
    assertReleaseSourcePath(portableZipSnapshot, "Launcher ZIP snapshot");

    signingMetadata = verifyInstallerUnsigned({
      ...unsignedVerification,
      installerPath: installerSnapshot,
    });
    installer = inspectLauncherArchive({
      archivePath: installerSnapshot,
      expectedVersion: version,
      expectedPackage: desktopPackage,
      sourceEntries,
      sevenZipPath,
    });
    portableZip = inspectLauncherArchive({
      archivePath: portableZipSnapshot,
      expectedVersion: version,
      expectedPackage: desktopPackage,
      sourceEntries,
      sevenZipPath,
    });
    assertPackagedMapProvenance(
      installer.resources,
      mapProvenance,
      "Launcher installer",
    );
    assertPackagedMapProvenance(
      portableZip.resources,
      mapProvenance,
      "Launcher portable ZIP",
    );
    packagedRuntimeIntegrity = validatePackagedRuntimeIntegrity(
      completeRuntimeVerifier({
        desktopPackage,
        installerPath: installerSnapshot,
        portableZipPath: portableZipSnapshot,
        sourceEntries,
        sevenZipPath,
        unsignedVerification,
        signingMetadata,
      }),
    );
  } finally {
    fs.rmSync(snapshotRoot, { recursive: true, force: true });
  }

  installer.path = path.resolve(installerPath);
  portableZip.path = path.resolve(portableZipPath);

  for (const sourceEntry of sourceEntries) {
    const installerHash = installer.resources[sourceEntry.entryPath]?.sha256;
    const zipHash = portableZip.resources[sourceEntry.entryPath]?.sha256;
    if (!installerHash || installerHash !== zipHash) {
      throw new Error(
        `Launcher artifacts disagree for ${sourceEntry.entryPath}`,
      );
    }
  }

  installer.signing = signingMetadata;
  return {
    version,
    names,
    installer,
    portableZip,
    mapProvenance,
    packagedRuntimeIntegrity,
  };
}

function blockIncompletePackagedRuntimeVerification() {
  throw new Error(
    "Launcher publication is blocked: ASAR integrity plus complete NSIS/portable runtime, dependency, explicit unsigned-executable, and checksum-manifest verification is not implemented and proven against a representative real package.",
  );
}

function verifyCompletePackagedRuntime(options) {
  return require("./packaged-runtime-integrity-verifier.cjs")
    .verifyCompletePackagedRuntime(options);
}

function validatePackagedRuntimeIntegrity(value) {
  const hashes = [
    value?.policySha256,
    value?.inventorySha256,
    value?.asarIntegrity?.appAsarSha256,
    value?.dependencies?.inventorySha256,
    value?.inventories?.installerSha256,
    value?.inventories?.portableZipSha256,
    value?.innerExecutables?.installer?.sha256,
    value?.innerExecutables?.portableZip?.sha256,
    value?.outerInstaller?.sha256,
  ];
  if (
    value?.schemaVersion !== 1 ||
    value?.status !== "verified-complete" ||
    hashes.some((hash) => !/^[a-f0-9]{64}$/i.test(String(hash || ""))) ||
    value?.asarIntegrity?.status !== "verified" ||
    value?.asarIntegrity?.embeddedValidation !== true ||
    value?.asarIntegrity?.onlyLoadAppFromAsar !== true ||
    value?.dependencies?.status !== "verified" ||
    value?.inventories?.status !== "verified" ||
    value?.innerExecutables?.installer?.status !== "verified-unsigned" ||
    value?.innerExecutables?.installer?.authenticodeStatus !== "NotSigned" ||
    value?.innerExecutables?.portableZip?.status !== "verified-unsigned" ||
    value?.innerExecutables?.portableZip?.authenticodeStatus !== "NotSigned" ||
    value?.outerInstaller?.status !== "verified-unsigned" ||
    value?.outerInstaller?.authenticodeStatus !== "NotSigned" ||
    value?.outerInstaller?.certificateTablePresent !== false ||
    value?.outerInstaller?.binding !==
      "sha256-plus-complete-payload-inventory"
  ) {
    throw new Error(
      "Complete packaged-runtime integrity evidence is invalid or incomplete.",
    );
  }
  return value;
}

if (require.main === module) {
  const {
    runBlockedLauncherReleaseEntrypoint,
  } = require("./blocked-launcher-release-entrypoint.cjs");
  runBlockedLauncherReleaseEntrypoint();
}

module.exports = {
  AUTHENTICODE_INSPECTION_SCRIPT,
  AUTHENTICODE_TARGET_ENV,
  DEFAULT_RELEASE_TOOLCHAIN_PATH,
  DEFAULT_TRUSTED_SIGNER_CONFIG_PATH,
  DEFAULT_UNSIGNED_RELEASE_POLICY_PATH,
  assertPackagedMapProvenance,
  assertReleaseSourcePath,
  blockIncompletePackagedRuntimeVerification,
  defaultSourceEntries,
  extractArchiveEntry,
  extractArchiveEntries,
  inspectLauncherArchive,
  launcherArtifactNames,
  normalizeWindowsRoot,
  normalizedCertificateSubject,
  normalizedThumbprint,
  readTrustedSignerConfig,
  readUnsignedReleasePolicy,
  recursiveSourceEntries,
  resolveSevenZip,
  resolveWindowsPowerShell,
  sha256File,
  validateTrustedSignerConfig,
  validateUnsignedReleasePolicy,
  validatePackagedRuntimeIntegrity,
  verifyInstallerAuthenticode,
  verifyInstallerUnsigned,
  verifyCompletePackagedRuntime,
  verifyLauncherReleaseArtifacts,
};
