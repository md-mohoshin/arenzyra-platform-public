"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const asar = require("@electron/asar");
const { NtExecutable, NtExecutableResource } = require("resedit");
const { SENTINEL, FuseState } = require("@electron/fuses/dist/constants");
const {
  REQUIRED_SHARP_NATIVE_RUNTIME_RELATIVE_PATHS,
  SHARP_NATIVE_PACKAGE_DESTINATION,
} = require("../apps/desktop/release/sharp-native-runtime-policy.cjs");

const DEFAULT_POLICY_PATH = path.resolve(
  __dirname,
  "..",
  "apps",
  "desktop",
  "release",
  "packaged-runtime-verification.json",
);
const MAX_ARCHIVE_ENTRIES = 50_000;
const MAX_ARCHIVE_EXPANDED_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 512 * 1024 * 1024;

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY);
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function inventorySha256(entries) {
  return sha256Buffer(Buffer.from(canonicalJson(entries), "utf8"));
}

function normalizedEntryPath(value, label = "Packaged runtime entry") {
  const normalized = String(value || "").replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-z]:/i.test(normalized) ||
    /[\0-\x1f\x7f:*?"<>|]/.test(normalized) ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`${label} path is unsafe: ${JSON.stringify(value)}.`);
  }
  return segments.join("/");
}

function parseSevenZipListing(output) {
  const lines = String(output || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/);
  const separator = lines.findIndex((line) => /^-{5,}\s*$/.test(line));
  if (separator < 0) {
    throw new Error("Packaged runtime archive listing is malformed.");
  }
  const records = [];
  let fields = new Map();
  const flush = () => {
    if (fields.size > 0) records.push(fields);
    fields = new Map();
  };
  for (const line of lines.slice(separator + 1)) {
    if (!line.trim()) {
      flush();
      continue;
    }
    if (/^Warnings:\s+\d+\s*$/.test(line)) {
      flush();
      continue;
    }
    const fieldSeparator = line.indexOf(" = ");
    if (fieldSeparator <= 0) {
      throw new Error("Packaged runtime archive metadata is malformed.");
    }
    const key = line.slice(0, fieldSeparator).trim();
    if (fields.has(key)) {
      throw new Error("Packaged runtime archive metadata is ambiguous.");
    }
    fields.set(key, line.slice(fieldSeparator + 3));
  }
  flush();

  if (records.length === 0 || records.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error("Packaged runtime archive entry count is invalid.");
  }
  const entries = new Map();
  let totalSize = 0;
  for (const record of records) {
    const entryPath = normalizedEntryPath(record.get("Path"));
    const key = entryPath.toLowerCase();
    if (entries.has(key)) {
      throw new Error(
        `Packaged runtime archive has duplicate or case-colliding entries: ${entryPath}.`,
      );
    }
    const folder = String(record.get("Folder") || "").trim();
    const sizeText = String(record.get("Size") || "").trim();
    const attributes = String(record.get("Attributes") || "");
    const linked = Array.from(record.entries()).some(
      ([name, value]) =>
        /(?:symbolic|hard\s*link|reparse|junction)/i.test(name) &&
        !["", "-", "0", "false", "no"].includes(
          String(value || "").trim().toLowerCase(),
        ),
    );
    const attributeDirectory = attributes.trim().split(/\s+/, 1)[0].includes("D");
    if (
      !["", "+", "-"].includes(folder) ||
      (folder === "+" && !attributeDirectory) ||
      (folder === "-" && attributeDirectory) ||
      !/^\d+$/.test(sizeText) ||
      linked ||
      attributes.trim().split(/\s+/, 1)[0].includes("L") ||
      String(record.get("Encrypted") || "-").trim() === "+"
    ) {
      throw new Error(`Packaged runtime archive entry is unsafe: ${entryPath}.`);
    }
    const size = Number(sizeText);
    if (!Number.isSafeInteger(size) || size > MAX_SINGLE_FILE_BYTES) {
      throw new Error(`Packaged runtime archive entry is too large: ${entryPath}.`);
    }
    const directory = folder === "+" || (folder === "" && attributeDirectory);
    if (directory && size !== 0) {
      throw new Error(`Packaged runtime archive directory has data: ${entryPath}.`);
    }
    if (!directory) totalSize += size;
    if (totalSize > MAX_ARCHIVE_EXPANDED_BYTES) {
      throw new Error("Packaged runtime archive expanded size is too large.");
    }
    entries.set(key, { path: entryPath, directory, size });
  }
  return entries;
}

function listArchive(archivePath, sevenZipPath, spawnSyncImpl = spawnSync) {
  const result = spawnSyncImpl(
    sevenZipPath,
    ["l", "-slt", "-bd", "-bb0", path.resolve(archivePath)],
    {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30_000,
      windowsHide: true,
    },
  );
  if (result?.error || result?.status !== 0) {
    throw new Error(
      `Packaged runtime archive listing failed: ${String(result?.stderr || result?.error?.message || "unknown error").trim()}`,
    );
  }
  return parseSevenZipListing(result.stdout);
}

function containedRealPath(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolved);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Packaged runtime extraction escaped its root: ${resolved}.`);
  }
  const physical = fs.realpathSync.native(resolved);
  const physicalRelative = path.relative(
    fs.realpathSync.native(resolvedRoot),
    physical,
  );
  if (
    physicalRelative === ".." ||
    physicalRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(physicalRelative)
  ) {
    throw new Error(`Packaged runtime extraction traversed a redirected path: ${resolved}.`);
  }
}

function readExtractedInventory(destination, listedEntries) {
  const found = new Map();
  let visited = 0;
  const visit = (directory) => {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      visited += 1;
      if (visited > MAX_ARCHIVE_ENTRIES) {
        throw new Error("Packaged runtime extraction created too many entries.");
      }
      const filePath = path.join(directory, entry.name);
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink()) {
        throw new Error(`Packaged runtime extraction created a link: ${filePath}.`);
      }
      containedRealPath(destination, filePath);
      if (stat.isDirectory()) {
        visit(filePath);
        continue;
      }
      if (!stat.isFile() || Number(stat.nlink || 1) !== 1) {
        throw new Error(`Packaged runtime extraction entry is not a regular unlinked file: ${filePath}.`);
      }
      const entryPath = normalizedEntryPath(
        path.relative(destination, filePath).replace(/\\/g, "/"),
      );
      const listed = listedEntries.get(entryPath.toLowerCase());
      if (!listed || listed.directory || listed.path !== entryPath || listed.size !== stat.size) {
        throw new Error(`Packaged runtime extraction disagrees with archive metadata: ${entryPath}.`);
      }
      found.set(entryPath.toLowerCase(), {
        path: entryPath,
        size: stat.size,
        sha256: sha256File(filePath),
        filePath,
      });
    }
  };
  visit(destination);
  const expectedFiles = Array.from(listedEntries.values()).filter(
    (entry) => !entry.directory,
  );
  if (
    found.size !== expectedFiles.length ||
    expectedFiles.some((entry) => !found.has(entry.path.toLowerCase()))
  ) {
    throw new Error("Packaged runtime extraction does not exactly match its archive inventory.");
  }
  return found;
}

function withExtractedArchive(
  archivePath,
  { sevenZipPath, spawnSyncImpl = spawnSync, tempRoot = os.tmpdir() },
  callback,
) {
  const listedEntries = listArchive(archivePath, sevenZipPath, spawnSyncImpl);
  const destination = fs.mkdtempSync(
    path.join(path.resolve(tempRoot), "arenzyra-runtime-verify-"),
  );
  try {
    const result = spawnSyncImpl(
      sevenZipPath,
      ["x", "-y", "-bd", "-bb0", `-o${destination}`, path.resolve(archivePath)],
      {
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        timeout: 120_000,
        windowsHide: true,
      },
    );
    if (result?.error || result?.status !== 0) {
      throw new Error(
        `Packaged runtime archive extraction failed: ${String(result?.stderr || result?.error?.message || "unknown error").trim()}`,
      );
    }
    const files = readExtractedInventory(destination, listedEntries);
    return callback({ destination, files });
  } finally {
    fs.rmSync(destination, { recursive: true, force: true });
  }
}

function verifyAsarFileIntegrity(asarPath) {
  const paths = asar.listPackage(asarPath);
  const caseFolded = new Set();
  const files = [];
  const dependencies = [];
  for (const listedPath of paths) {
    const entryPath = normalizedEntryPath(
      String(listedPath).replace(/^[/\\]/, "").replace(/\\/g, "/"),
      "ASAR entry",
    );
    const key = entryPath.toLowerCase();
    if (caseFolded.has(key)) {
      throw new Error(`ASAR has duplicate or case-colliding entries: ${entryPath}.`);
    }
    caseFolded.add(key);
    const platformPath = entryPath.split("/").join(path.sep);
    const metadata = asar.statFile(asarPath, platformPath, false);
    if (metadata?.files) continue;
    if (metadata?.link) {
      throw new Error(`ASAR links are forbidden in the release runtime: ${entryPath}.`);
    }
    const bytes = asar.extractFile(asarPath, platformPath, false);
    const integrity = metadata?.integrity;
    const hash = sha256Buffer(bytes);
    if (
      !integrity ||
      integrity.algorithm !== "SHA256" ||
      integrity.hash !== hash ||
      !Number.isSafeInteger(integrity.blockSize) ||
      integrity.blockSize <= 0 ||
      !Array.isArray(integrity.blocks)
    ) {
      throw new Error(`ASAR file integrity is missing or invalid: ${entryPath}.`);
    }
    const blockHashes = [];
    for (let offset = 0; offset < bytes.length; offset += integrity.blockSize) {
      blockHashes.push(
        sha256Buffer(bytes.subarray(offset, offset + integrity.blockSize)),
      );
    }
    if (bytes.length === 0) blockHashes.push(sha256Buffer(Buffer.alloc(0)));
    if (
      blockHashes.length !== integrity.blocks.length ||
      blockHashes.some((blockHash, index) => blockHash !== integrity.blocks[index])
    ) {
      throw new Error(`ASAR block integrity is invalid: ${entryPath}.`);
    }
    const record = {
      path: entryPath,
      size: bytes.length,
      sha256: hash,
      unpacked: metadata.unpacked === true,
    };
    files.push(record);
    if (entryPath.startsWith("node_modules/")) dependencies.push(record);
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  dependencies.sort((left, right) => left.path.localeCompare(right.path));
  const packageBytes = asar.extractFile(asarPath, "package.json", false);
  return {
    packageJson: JSON.parse(packageBytes.toString("utf8")),
    files,
    filesSha256: inventorySha256(files),
    dependencies,
    dependenciesSha256: inventorySha256(dependencies),
  };
}

function verifySharpNativeRuntime(asarInspection, archiveFiles) {
  const verified = [];
  for (const relativePath of REQUIRED_SHARP_NATIVE_RUNTIME_RELATIVE_PATHS) {
    const packagedPath = `${SHARP_NATIVE_PACKAGE_DESTINATION}/${relativePath}`;
    const asarEntry = asarInspection.dependencies.find(
      (entry) => entry.path === packagedPath,
    );
    if (
      !asarEntry ||
      (relativePath.endsWith(".node") && asarEntry.unpacked !== true)
    ) {
      throw new Error(
        `Sharp native module must be unpacked beside app.asar: ${packagedPath}.`,
      );
    }

    const externalPath = `resources/app.asar.unpacked/${packagedPath}`;
    const externalEntry = archiveFiles.get(externalPath.toLowerCase());
    if (
      !externalEntry ||
      externalEntry.path !== externalPath ||
      externalEntry.size !== asarEntry.size ||
      externalEntry.sha256 !== asarEntry.sha256
    ) {
      throw new Error(
        `Sharp native runtime is missing or differs outside app.asar: ${externalPath}.`,
      );
    }
    verified.push(packagedPath);
  }
  return verified;
}

function readFuseWire(executablePath) {
  const bytes = fs.readFileSync(executablePath);
  const first = bytes.indexOf(SENTINEL);
  const last = bytes.lastIndexOf(SENTINEL);
  if (first < 0 || first !== last) {
    throw new Error("Packaged launcher Electron fuse sentinel is missing or ambiguous.");
  }
  const position = first + Buffer.byteLength(SENTINEL);
  const version = bytes[position];
  const length = bytes[position + 1];
  if (version !== 1 || length < 8 || position + 2 + length > bytes.length) {
    throw new Error("Packaged launcher Electron fuse wire is invalid or unsupported.");
  }
  const values = Array.from(bytes.subarray(position + 2, position + 2 + length));
  const expected = [
    FuseState.ENABLE,
    FuseState.DISABLE,
    FuseState.DISABLE,
    FuseState.DISABLE,
    FuseState.ENABLE,
    FuseState.ENABLE,
    FuseState.DISABLE,
    FuseState.ENABLE,
  ];
  if (expected.some((value, index) => values[index] !== value)) {
    throw new Error("Packaged launcher Electron fuse policy does not match the reviewed release configuration.");
  }
  return { version: "1", values };
}

function readEmbeddedAsarIntegrity(executablePath, asarPath) {
  const executable = NtExecutable.from(fs.readFileSync(executablePath));
  const resources = NtExecutableResource.from(executable);
  const matches = resources.entries.filter(
    (entry) => entry.type === "INTEGRITY" && entry.id === "ELECTRONASAR",
  );
  if (matches.length !== 1) {
    throw new Error("Packaged launcher has missing or ambiguous embedded ASAR integrity metadata.");
  }
  let entries;
  try {
    entries = JSON.parse(Buffer.from(matches[0].bin).toString("utf8"));
  } catch (error) {
    throw new Error(`Packaged launcher ASAR integrity resource is invalid: ${error.message}`);
  }
  const appEntries = Array.isArray(entries)
    ? entries.filter(
        (entry) =>
          String(entry?.file || "").replace(/\\/g, "/").toLowerCase() ===
          "resources/app.asar",
      )
    : [];
  const rawHeader = asar.getRawHeader(asarPath);
  const headerSha256 = sha256Buffer(Buffer.from(rawHeader.headerString, "utf8"));
  if (
    appEntries.length !== 1 ||
    appEntries[0].alg !== "SHA256" ||
    String(appEntries[0].value || "").toLowerCase() !== headerSha256
  ) {
    throw new Error("Packaged launcher embedded ASAR integrity hash does not match app.asar.");
  }
  return { headerSha256, entries };
}

function readPeCertificateTable(executablePath) {
  const bytes = fs.readFileSync(executablePath);
  if (bytes.length < 256 || bytes.readUInt16LE(0) !== 0x5a4d) {
    throw new Error("Authenticode target is not a valid PE executable.");
  }
  const peOffset = bytes.readUInt32LE(0x3c);
  if (peOffset + 256 > bytes.length || bytes.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0") {
    throw new Error("Authenticode target PE header is invalid.");
  }
  const optionalOffset = peOffset + 24;
  const magic = bytes.readUInt16LE(optionalOffset);
  const dataDirectoryOffset = optionalOffset + (magic === 0x20b ? 112 : magic === 0x10b ? 96 : 0);
  if (!dataDirectoryOffset || dataDirectoryOffset + 40 > bytes.length) {
    throw new Error("Authenticode target optional header is unsupported.");
  }
  const certificateOffset = bytes.readUInt32LE(dataDirectoryOffset + 32);
  const certificateSize = bytes.readUInt32LE(dataDirectoryOffset + 36);
  if (certificateOffset === 0 && certificateSize === 0) {
    return { present: false, sha256: null, size: 0 };
  }
  if (
    certificateOffset <= 0 ||
    certificateSize < 8 ||
    certificateOffset + certificateSize > bytes.length
  ) {
    throw new Error("Authenticode target has no complete PE certificate table.");
  }
  const signature = bytes.subarray(certificateOffset, certificateOffset + certificateSize);
  return {
    present: true,
    sha256: sha256Buffer(signature),
    size: signature.length,
  };
}

function readPeSignatureBlob(executablePath) {
  const certificateTable = readPeCertificateTable(executablePath);
  if (!certificateTable.present) {
    throw new Error("Authenticode target has no complete PE certificate table.");
  }
  return {
    sha256: certificateTable.sha256,
    size: certificateTable.size,
  };
}

function publicInventory(files) {
  return Array.from(files.values())
    .map(({ path: entryPath, size, sha256 }) => ({
      path: entryPath,
      size,
      sha256,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function comparePayloadInventories(installer, portable) {
  const allowedInstallerOnly = new Set(["resources/elevate.exe"]);
  for (const [key, installerEntry] of installer.entries()) {
    const portableEntry = portable.get(key);
    if (!portableEntry) {
      if (!allowedInstallerOnly.has(installerEntry.path)) {
        throw new Error(`Installer contains an entry absent from the portable ZIP: ${installerEntry.path}.`);
      }
      continue;
    }
    if (
      installerEntry.path !== portableEntry.path ||
      installerEntry.size !== portableEntry.size ||
      installerEntry.sha256 !== portableEntry.sha256
    ) {
      throw new Error(`Installer and portable ZIP disagree for ${installerEntry.path}.`);
    }
  }
  for (const portableEntry of portable.values()) {
    if (!installer.has(portableEntry.path.toLowerCase())) {
      throw new Error(`Portable ZIP contains an entry absent from the installer: ${portableEntry.path}.`);
    }
  }
}

function inspectPackagedArchive({
  archivePath,
  desktopPackage,
  sevenZipPath,
  unsignedVerification,
  unsignedVerifier,
  certificateTableReader,
  spawnSyncImpl,
}) {
  return withExtractedArchive(
    archivePath,
    { sevenZipPath, spawnSyncImpl },
    ({ files }) => {
      const executableName = `${desktopPackage.productName || "Arenzyra Observer Launcher"}.exe`;
      const executable = files.get(executableName.toLowerCase());
      const appAsar = files.get("resources/app.asar");
      if (!executable || !appAsar) {
        throw new Error("Packaged runtime requires the launcher executable and resources/app.asar.");
      }
      const asarInspection = verifyAsarFileIntegrity(appAsar.filePath);
      if (
        asarInspection.packageJson.name !== desktopPackage.name ||
        asarInspection.packageJson.version !== desktopPackage.version
      ) {
        throw new Error("Packaged ASAR package identity does not match the reviewed desktop package.");
      }
      verifySharpNativeRuntime(asarInspection, files);
      const fuses = readFuseWire(executable.filePath);
      const embedded = readEmbeddedAsarIntegrity(
        executable.filePath,
        appAsar.filePath,
      );
      const signing = unsignedVerifier({
        ...unsignedVerification,
        installerPath: executable.filePath,
      });
      const certificateTable = certificateTableReader(executable.filePath);
      if (certificateTable.present) {
        throw new Error(
          "Unsigned packaged launcher executable contains an Authenticode certificate table.",
        );
      }
      return {
        files: new Map(
          Array.from(files.entries()).map(([key, value]) => [
            key,
            { path: value.path, size: value.size, sha256: value.sha256 },
          ]),
        ),
        inventory: publicInventory(files),
        executable: {
          sha256: executable.sha256,
          signing,
          certificateTable,
        },
        appAsar: {
          sha256: appAsar.sha256,
          ...asarInspection,
          embedded,
          fuses,
        },
      };
    },
  );
}

function verifyCompletePackagedRuntime({
  desktopPackage,
  installerPath,
  portableZipPath,
  sevenZipPath,
  unsignedVerification = {},
  signingMetadata,
  policyPath = DEFAULT_POLICY_PATH,
  spawnSyncImpl = spawnSync,
  unsignedVerifier,
  certificateTableReader = readPeCertificateTable,
} = {}) {
  const launcherVerifier = require("./launcher-release-artifact-verifier.cjs");
  const resolvedSevenZip = sevenZipPath || launcherVerifier.resolveSevenZip();
  const verifyUnsigned =
    unsignedVerifier || launcherVerifier.verifyInstallerUnsigned;
  const installer = inspectPackagedArchive({
    archivePath: installerPath,
    desktopPackage,
    sevenZipPath: resolvedSevenZip,
    unsignedVerification,
    unsignedVerifier: verifyUnsigned,
    certificateTableReader,
    spawnSyncImpl,
  });
  const portable = inspectPackagedArchive({
    archivePath: portableZipPath,
    desktopPackage,
    sevenZipPath: resolvedSevenZip,
    unsignedVerification,
    unsignedVerifier: verifyUnsigned,
    certificateTableReader,
    spawnSyncImpl,
  });
  comparePayloadInventories(installer.files, portable.files);
  if (
    installer.appAsar.sha256 !== portable.appAsar.sha256 ||
    installer.appAsar.filesSha256 !== portable.appAsar.filesSha256 ||
    installer.appAsar.dependenciesSha256 !== portable.appAsar.dependenciesSha256
  ) {
    throw new Error("Installer and portable ZIP do not contain the same integrity-checked ASAR runtime.");
  }
  const policySha256 = String(signingMetadata?.policy?.sha256 || "").toLowerCase();
  if (
    signingMetadata?.status !== "unsigned" ||
    signingMetadata?.authenticodeStatus !== "NotSigned" ||
    installer.executable.signing?.status !== "unsigned" ||
    installer.executable.signing?.authenticodeStatus !== "NotSigned" ||
    portable.executable.signing?.status !== "unsigned" ||
    portable.executable.signing?.authenticodeStatus !== "NotSigned" ||
    !/^[a-f0-9]{64}$/.test(policySha256) ||
    String(installer.executable.signing?.policy?.sha256 || "").toLowerCase() !==
      policySha256 ||
    String(portable.executable.signing?.policy?.sha256 || "").toLowerCase() !==
      policySha256
  ) {
    throw new Error(
      "Outer installer and both packaged launcher executables must be explicitly unsigned under the same reviewed policy.",
    );
  }
  const installerInventorySha256 = inventorySha256(installer.inventory);
  const portableInventorySha256 = inventorySha256(portable.inventory);
  const completeInventorySha256 = inventorySha256({
    installer: installer.inventory,
    portableZip: portable.inventory,
  });
  const policyBytes = fs.readFileSync(policyPath);
  const outerCertificateTable = certificateTableReader(installerPath);
  if (outerCertificateTable.present) {
    throw new Error(
      "Unsigned launcher installer contains an Authenticode certificate table.",
    );
  }
  return {
    schemaVersion: 1,
    status: "verified-complete",
    policySha256: sha256Buffer(policyBytes),
    inventorySha256: completeInventorySha256,
    inventories: {
      status: "verified",
      installerSha256: installerInventorySha256,
      portableZipSha256: portableInventorySha256,
      installerEntryCount: installer.inventory.length,
      portableZipEntryCount: portable.inventory.length,
    },
    asarIntegrity: {
      status: "verified",
      embeddedValidation: true,
      onlyLoadAppFromAsar: true,
      appAsarSha256: installer.appAsar.sha256,
      headerSha256: installer.appAsar.embedded.headerSha256,
      fileInventorySha256: installer.appAsar.filesSha256,
    },
    dependencies: {
      status: "verified",
      inventorySha256: installer.appAsar.dependenciesSha256,
      entryCount: installer.appAsar.dependencies.length,
    },
    innerExecutables: {
      installer: {
        status: "verified-unsigned",
        sha256: installer.executable.sha256,
        authenticodeStatus: "NotSigned",
        certificateTablePresent: false,
      },
      portableZip: {
        status: "verified-unsigned",
        sha256: portable.executable.sha256,
        authenticodeStatus: "NotSigned",
        certificateTablePresent: false,
      },
    },
    outerInstaller: {
      status: "verified-unsigned",
      sha256: sha256File(installerPath),
      authenticodeStatus: "NotSigned",
      certificateTablePresent: false,
      unsignedPolicySha256: policySha256,
      binding: "sha256-plus-complete-payload-inventory",
    },
  };
}

module.exports = {
  DEFAULT_POLICY_PATH,
  canonicalJson,
  comparePayloadInventories,
  inventorySha256,
  parseSevenZipListing,
  readEmbeddedAsarIntegrity,
  readFuseWire,
  readPeCertificateTable,
  readPeSignatureBlob,
  verifyAsarFileIntegrity,
  verifyCompletePackagedRuntime,
  verifySharpNativeRuntime,
  withExtractedArchive,
};
