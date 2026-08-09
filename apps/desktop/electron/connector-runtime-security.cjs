"use strict";

const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const CHILD_ENV_ALLOWLIST = new Set(
  [
    "APPDATA",
    "COMSPEC",
    "LANG",
    "LOCALAPPDATA",
    "PATHEXT",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "PROGRAMW6432",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "TZ",
    "WINDIR",
  ].map((name) => name.toUpperCase()),
);

const FORBIDDEN_CHILD_ENV = new Set(
  [
    "BASH_ENV",
    "ENV",
    "ELECTRON_RUN_AS_NODE",
    "NODE_OPTIONS",
    "NODE_PATH",
  ].map((name) => name.toUpperCase()),
);

const WINDOWS_SYSTEM_COMMAND_RELATIVE_PATHS = Object.freeze({
  powershell: ["WindowsPowerShell", "v1.0", "powershell.exe"],
  taskkill: ["taskkill.exe"],
  where: ["where.exe"],
  whoami: ["whoami.exe"],
  wmic: ["wbem", "WMIC.exe"],
});

function normalizeComparablePath(value, platform = process.platform) {
  const resolved = path.resolve(String(value || ""));
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isPathInside(rootPath, candidatePath, platform = process.platform) {
  const root = normalizeComparablePath(rootPath, platform);
  const candidate = normalizeComparablePath(candidatePath, platform);
  if (!root || !candidate || root === candidate) {
    return root === candidate;
  }
  const relative = path.relative(root, candidate);
  return Boolean(
    relative &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative),
  );
}

function connectorSecurityError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertPathHasNoLinks(
  inputPath,
  { allowMissingLeaf = false, requireFile = false, label = "Connector path" } = {},
) {
  const resolved = path.resolve(String(inputPath || ""));
  if (!String(inputPath || "").trim() || resolved === path.parse(resolved).root) {
    throw connectorSecurityError(`${label} is unsafe.`, "ARENZYRA_CONNECTOR_PATH_UNSAFE");
  }

  const root = path.parse(resolved).root;
  const relativeParts = path.relative(root, resolved).split(path.sep).filter(Boolean);
  let current = root;
  let lastStat = null;
  for (let index = 0; index < relativeParts.length; index += 1) {
    current = path.join(current, relativeParts[index]);
    try {
      lastStat = fs.lstatSync(current);
    } catch (error) {
      if (error?.code === "ENOENT" && allowMissingLeaf) {
        lastStat = null;
        break;
      }
      throw error;
    }
    if (lastStat.isSymbolicLink()) {
      throw connectorSecurityError(
        `${label} traverses a symbolic link or junction: ${current}`,
        "ARENZYRA_CONNECTOR_REPARSE_POINT",
      );
    }
    const physicalPath = fs.realpathSync.native(current);
    if (
      normalizeComparablePath(physicalPath) !==
      normalizeComparablePath(current)
    ) {
      throw connectorSecurityError(
        `${label} traverses a redirected filesystem path: ${current}`,
        "ARENZYRA_CONNECTOR_REPARSE_POINT",
      );
    }
    if (
      index === relativeParts.length - 1 &&
      lastStat.isFile() &&
      Number(lastStat.nlink) > 1
    ) {
      throw connectorSecurityError(
        `${label} is a multiply linked file: ${current}`,
        "ARENZYRA_CONNECTOR_HARD_LINK",
      );
    }
  }

  if (requireFile && (!lastStat || !lastStat.isFile())) {
    throw connectorSecurityError(
      `${label} is not a regular file: ${resolved}`,
      "ARENZYRA_CONNECTOR_FILE_REQUIRED",
    );
  }
  return resolved;
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function readCaseInsensitiveEnv(env, name) {
  const expected = String(name || "").toUpperCase();
  for (const [candidate, value] of Object.entries(env || {})) {
    if (candidate.toUpperCase() === expected) {
      return String(value || "").trim();
    }
  }
  return "";
}

function normalizeWindowsRoot(value) {
  const windowsPath = path.win32;
  const raw = String(value || "").trim();
  if (!raw || !windowsPath.isAbsolute(raw)) {
    return "";
  }
  const normalized = windowsPath.normalize(raw);
  const parsed = windowsPath.parse(normalized);
  if (
    !/^[a-z]:\\$/i.test(parsed.root) ||
    windowsPath.basename(normalized).toLowerCase() !== "windows" ||
    windowsPath.dirname(normalized).toLowerCase() !== parsed.root.toLowerCase()
  ) {
    return "";
  }
  return normalized;
}

function assertInspectedWindowsPath(candidatePath, kind, inspectPath) {
  if (typeof inspectPath !== "function") {
    assertPathHasNoLinks(candidatePath, {
      label: `Trusted Windows ${kind}`,
      requireFile: kind === "file",
    });
    if (kind === "directory" && !fs.statSync(candidatePath).isDirectory()) {
      throw connectorSecurityError(
        `Trusted Windows directory is unavailable: ${candidatePath}`,
        "ARENZYRA_WINDOWS_SYSTEM_PATH_UNTRUSTED",
      );
    }
    return;
  }

  const inspected = inspectPath(candidatePath, { kind });
  const accepted =
    inspected === true ||
    (inspected &&
      typeof inspected === "object" &&
      inspected.exists !== false &&
      inspected.isSymbolicLink !== true &&
      inspected.isReparsePoint !== true &&
      inspected.redirected !== true &&
      Number(inspected.nlink ?? 1) === 1 &&
      (kind !== "file" || inspected.isFile === true) &&
      (kind !== "directory" || inspected.isDirectory === true) &&
      (!inspected.realpath ||
        path.win32.normalize(inspected.realpath).toLowerCase() ===
          path.win32.normalize(candidatePath).toLowerCase()));
  if (!accepted) {
    throw connectorSecurityError(
      `Trusted Windows ${kind} failed filesystem verification: ${candidatePath}`,
      "ARENZYRA_WINDOWS_SYSTEM_PATH_UNTRUSTED",
    );
  }
}

function resolveTrustedWindowsSystemContext({
  platform = process.platform,
  execPath = process.execPath,
  env = process.env,
  inspectPath,
} = {}) {
  if (platform !== "win32") {
    throw connectorSecurityError(
      "Trusted Windows commands are unavailable on this platform.",
      "ARENZYRA_WINDOWS_SYSTEM_UNAVAILABLE",
    );
  }

  const windowsPath = path.win32;
  const normalizedExecPath = windowsPath.normalize(String(execPath || "").trim());
  const execRoot = windowsPath.parse(normalizedExecPath).root;
  if (!windowsPath.isAbsolute(normalizedExecPath) || !/^[a-z]:\\$/i.test(execRoot)) {
    throw connectorSecurityError(
      "The running executable does not provide a trusted Windows drive.",
      "ARENZYRA_WINDOWS_DRIVE_UNTRUSTED",
    );
  }

  const systemRoot = windowsPath.join(execRoot, "Windows");
  for (const name of ["SystemRoot", "WINDIR"]) {
    const ambient = readCaseInsensitiveEnv(env, name);
    if (!ambient) {
      continue;
    }
    const normalizedAmbient = normalizeWindowsRoot(ambient);
    if (
      !normalizedAmbient ||
      normalizedAmbient.toLowerCase() !== systemRoot.toLowerCase()
    ) {
      throw connectorSecurityError(
        `${name} does not agree with the trusted running-executable drive.`,
        "ARENZYRA_WINDOWS_ROOT_MISMATCH",
      );
    }
  }
  const ambientSystemDrive = readCaseInsensitiveEnv(env, "SystemDrive");
  const systemDrive = execRoot.slice(0, 2);
  if (
    ambientSystemDrive &&
    ambientSystemDrive.replace(/[\\/]+$/, "").toLowerCase() !==
      systemDrive.toLowerCase()
  ) {
    throw connectorSecurityError(
      "SystemDrive does not agree with the trusted running-executable drive.",
      "ARENZYRA_WINDOWS_ROOT_MISMATCH",
    );
  }

  const system32 = windowsPath.join(systemRoot, "System32");
  assertInspectedWindowsPath(systemRoot, "directory", inspectPath);
  assertInspectedWindowsPath(system32, "directory", inspectPath);
  const rawTemp = readCaseInsensitiveEnv(env, "TEMP");
  const rawTmp = readCaseInsensitiveEnv(env, "TMP");
  let trustedTemp = "";
  for (const candidate of [rawTemp, rawTmp].filter(Boolean)) {
    const normalized = windowsPath.normalize(candidate);
    if (
      !windowsPath.isAbsolute(normalized) ||
      windowsPath.parse(normalized).root.toLowerCase() !== execRoot.toLowerCase() ||
      (trustedTemp && trustedTemp.toLowerCase() !== normalized.toLowerCase())
    ) {
      throw connectorSecurityError(
        "TEMP and TMP must agree on an absolute directory on the trusted Windows drive.",
        "ARENZYRA_WINDOWS_TEMP_UNTRUSTED",
      );
    }
    trustedTemp = normalized;
  }
  if (trustedTemp) {
    assertInspectedWindowsPath(trustedTemp, "directory", inspectPath);
  }
  const minimalEnv = {
    SystemDrive: systemDrive,
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
  };
  if (trustedTemp) {
    minimalEnv.TEMP = trustedTemp;
    minimalEnv.TMP = trustedTemp;
  }
  return {
    systemDrive,
    systemRoot,
    system32,
    env: minimalEnv,
  };
}

function resolveTrustedWindowsCommand(commandName, options = {}) {
  const normalizedName = String(commandName || "").trim().toLowerCase();
  const relativePath = WINDOWS_SYSTEM_COMMAND_RELATIVE_PATHS[normalizedName];
  if (!relativePath) {
    throw connectorSecurityError(
      `Windows system command is not allowlisted: ${normalizedName || "(empty)"}`,
      "ARENZYRA_WINDOWS_COMMAND_NOT_ALLOWED",
    );
  }
  const context = resolveTrustedWindowsSystemContext(options);
  const executablePath = path.win32.join(context.system32, ...relativePath);
  assertInspectedWindowsPath(executablePath, "file", options.inspectPath);
  return {
    ...context,
    commandName: normalizedName,
    executablePath,
  };
}

function inspectWindowsProcessIntegrity({
  platform = process.platform,
  env = process.env,
  execPath = process.execPath,
  inspectPath,
  resolveCommand = resolveTrustedWindowsCommand,
  spawnSyncImpl = spawnSync,
} = {}) {
  if (platform !== "win32") {
    return "standard";
  }
  let command;
  try {
    command = resolveCommand("whoami", {
      platform,
      env,
      execPath,
      inspectPath,
    });
  } catch {
    return "unknown";
  }
  const result = spawnSyncImpl(
    command.executablePath,
    ["/groups", "/fo", "csv", "/nh"],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 3_000,
      env: command.env,
    },
  );
  if (result?.status !== 0) {
    return "unknown";
  }
  const levels = [...String(result.stdout || "").matchAll(/S-1-16-(\d+)/gi)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  if (levels.length === 0) {
    return "unknown";
  }
  return Math.max(...levels) >= 12_288 ? "elevated" : "standard";
}

function assertConnectorInstallPlan({
  sourceFiles,
  targetFiles,
  allowedTargetRoots,
  shadowTrackerPath,
}) {
  const roots = (allowedTargetRoots || []).map((rootPath) =>
    assertPathHasNoLinks(rootPath, {
      label: "ShadowTracker install root",
    }),
  );
  if (roots.length === 0) {
    throw connectorSecurityError(
      "No trusted ShadowTracker install root was resolved.",
      "ARENZYRA_CONNECTOR_ROOT_REQUIRED",
    );
  }
  assertPathHasNoLinks(shadowTrackerPath, {
    label: "ShadowTracker executable",
    requireFile: true,
  });
  for (const sourceFile of sourceFiles || []) {
    assertPathHasNoLinks(sourceFile, {
      label: "Bundled connector source",
      requireFile: true,
    });
  }
  for (const targetFile of targetFiles || []) {
    const target = path.resolve(targetFile);
    if (!roots.some((rootPath) => isPathInside(rootPath, target))) {
      throw connectorSecurityError(
        `Connector target escapes the ShadowTracker install roots: ${target}`,
        "ARENZYRA_CONNECTOR_TARGET_ESCAPE",
      );
    }
    assertPathHasNoLinks(target, {
      allowMissingLeaf: true,
      label: "Connector target",
    });
  }
  return true;
}

function assertVerifiedRuntimeInputs({ files, trustedRoot }) {
  const root = assertPathHasNoLinks(trustedRoot, {
    label: "Managed connector resource root",
  });
  for (const file of files || []) {
    const filePath = path.resolve(String(file?.path || ""));
    if (!isPathInside(root, filePath)) {
      throw connectorSecurityError(
        `Managed connector input escapes its resource root: ${filePath}`,
        "ARENZYRA_CONNECTOR_RUNTIME_ESCAPE",
      );
    }
    assertPathHasNoLinks(filePath, {
      label: "Managed connector runtime input",
      requireFile: true,
    });
    if (!file?.sha256 || sha256File(filePath) !== file.sha256) {
      throw connectorSecurityError(
        `Managed connector input failed hash verification: ${filePath}`,
        "ARENZYRA_CONNECTOR_RUNTIME_HASH_MISMATCH",
      );
    }
  }
  return true;
}

function hashBuffer(value) {
  return crypto
    .createHash("sha256")
    .update(Buffer.isBuffer(value) ? value : Buffer.from(value))
    .digest("hex");
}

function readVerifiedRegularFile(
  filePath,
  { expectedSha256 = "", fsImpl = fs, label = "Verified file" } = {},
) {
  const resolved = assertPathHasNoLinks(filePath, {
    label,
    requireFile: true,
  });
  const before = fsImpl.lstatSync(resolved, { bigint: true });
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    Number(before.nlink) !== 1
  ) {
    throw connectorSecurityError(
      `${label} is not a single-link regular file: ${resolved}`,
      "ARENZYRA_CONNECTOR_FILE_UNTRUSTED",
    );
  }
  const flags = fs.constants.O_RDONLY | Number(fs.constants.O_NOFOLLOW || 0);
  let descriptor = null;
  let data;
  try {
    descriptor = fsImpl.openSync(resolved, flags);
    const opened = fsImpl.fstatSync(descriptor, { bigint: true });
    if (
      !opened.isFile() ||
      opened.isSymbolicLink?.() ||
      Number(opened.nlink) !== 1 ||
      String(opened.dev) !== String(before.dev) ||
      String(opened.ino) !== String(before.ino)
    ) {
      throw connectorSecurityError(
        `${label} changed while it was opened: ${resolved}`,
        "ARENZYRA_CONNECTOR_FILE_CHANGED",
      );
    }
    data = fsImpl.readFileSync(descriptor);
  } finally {
    if (descriptor !== null) {
      fsImpl.closeSync(descriptor);
    }
  }
  const after = fsImpl.lstatSync(resolved, { bigint: true });
  if (
    !after.isFile() ||
    after.isSymbolicLink() ||
    Number(after.nlink) !== 1 ||
    String(after.dev) !== String(before.dev) ||
    String(after.ino) !== String(before.ino)
  ) {
    throw connectorSecurityError(
      `${label} changed during verification: ${resolved}`,
      "ARENZYRA_CONNECTOR_FILE_CHANGED",
    );
  }
  const actualSha256 = hashBuffer(data);
  if (
    expectedSha256 &&
    actualSha256 !== String(expectedSha256).trim().toLowerCase()
  ) {
    throw connectorSecurityError(
      `${label} failed hash verification: ${resolved}`,
      "ARENZYRA_CONNECTOR_RUNTIME_HASH_MISMATCH",
    );
  }
  return { data, sha256: actualSha256 };
}

function captureVerifiedDirectoryIdentity(directoryPath, fsImpl = fs) {
  const resolved = assertPathHasNoLinks(directoryPath, {
    label: "Connector install directory",
  });
  const stat = fsImpl.lstatSync(resolved, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw connectorSecurityError(
      `Connector install directory is not a trusted directory: ${resolved}`,
      "ARENZYRA_CONNECTOR_DIRECTORY_UNTRUSTED",
    );
  }
  const dev = stat.dev;
  const ino = stat.ino;
  if (
    (typeof dev !== "bigint" && typeof dev !== "number") ||
    (typeof ino !== "bigint" && typeof ino !== "number") ||
    BigInt(ino) === 0n
  ) {
    throw connectorSecurityError(
      `Connector install directory identity is unavailable: ${resolved}`,
      "ARENZYRA_CONNECTOR_DIRECTORY_IDENTITY_UNAVAILABLE",
    );
  }
  const realpath = fsImpl.realpathSync.native
    ? fsImpl.realpathSync.native(resolved)
    : fsImpl.realpathSync(resolved);
  if (normalizeComparablePath(realpath) !== normalizeComparablePath(resolved)) {
    throw connectorSecurityError(
      `Connector install directory was redirected: ${resolved}`,
      "ARENZYRA_CONNECTOR_REPARSE_POINT",
    );
  }
  return {
    dev: String(dev),
    ino: String(ino),
    realpath: normalizeComparablePath(realpath),
  };
}

function assertSameDirectoryIdentity(expected, actual) {
  if (
    !expected ||
    !actual ||
    expected.dev !== actual.dev ||
    expected.ino !== actual.ino ||
    expected.realpath !== actual.realpath
  ) {
    throw connectorSecurityError(
      "Connector install directory changed during repair.",
      "ARENZYRA_CONNECTOR_DIRECTORY_CHANGED",
    );
  }
}

function fsyncDirectoryWhereSupported(directoryPath, fsImpl = fs) {
  let descriptor = null;
  try {
    descriptor = fsImpl.openSync(directoryPath, fs.constants.O_RDONLY);
    fsImpl.fsyncSync(descriptor);
  } catch (error) {
    if (
      !["EACCES", "EBADF", "EINVAL", "EISDIR", "ENOSYS", "ENOTSUP", "EPERM"].includes(
        String(error?.code || ""),
      )
    ) {
      throw error;
    }
  } finally {
    if (descriptor !== null) {
      try {
        fsImpl.closeSync(descriptor);
      } catch {
        // Directory fsync is a durability best effort on unsupported platforms.
      }
    }
  }
}

function unlinkFileIfIdentityMatches(filePath, expectedIdentity, fsImpl = fs) {
  if (!expectedIdentity) {
    return false;
  }
  try {
    const stat = fsImpl.lstatSync(filePath, { bigint: true });
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      Number(stat.nlink) !== 1 ||
      String(stat.dev) !== expectedIdentity.dev ||
      String(stat.ino) !== expectedIdentity.ino
    ) {
      return false;
    }
    fsImpl.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function writeExclusiveVerifiedTempFile({
  tempPath,
  data,
  expectedSha256,
  fsImpl = fs,
}) {
  const noFollow = Number(fs.constants.O_NOFOLLOW || 0);
  const flags =
    fs.constants.O_WRONLY |
    fs.constants.O_CREAT |
    fs.constants.O_EXCL |
    noFollow;
  let descriptor = null;
  let created = false;
  let createdIdentity = null;
  try {
    descriptor = fsImpl.openSync(tempPath, flags, 0o600);
    created = true;
    const opened = fsImpl.fstatSync(descriptor, { bigint: true });
    if (
      !opened.isFile() ||
      opened.isSymbolicLink?.() ||
      Number(opened.nlink) !== 1
    ) {
      throw connectorSecurityError(
        `Connector temp file identity is unsafe: ${tempPath}`,
        "ARENZYRA_CONNECTOR_TEMP_UNTRUSTED",
      );
    }
    createdIdentity = {
      dev: String(opened.dev),
      ino: String(opened.ino),
    };
    let offset = 0;
    while (offset < data.length) {
      const written = fsImpl.writeSync(
        descriptor,
        data,
        offset,
        data.length - offset,
        offset,
      );
      if (!Number.isInteger(written) || written <= 0) {
        throw connectorSecurityError(
          `Connector temp write did not make progress: ${tempPath}`,
          "ARENZYRA_CONNECTOR_TEMP_WRITE_FAILED",
        );
      }
      offset += written;
    }
    fsImpl.fsyncSync(descriptor);
    const stat = fsImpl.fstatSync(descriptor, { bigint: true });
    if (
      !stat.isFile() ||
      stat.isSymbolicLink?.() ||
      Number(stat.nlink) !== 1 ||
      String(stat.dev) !== createdIdentity.dev ||
      String(stat.ino) !== createdIdentity.ino
    ) {
      throw connectorSecurityError(
        `Connector temp file identity is unsafe: ${tempPath}`,
        "ARENZYRA_CONNECTOR_TEMP_UNTRUSTED",
      );
    }
  } catch (error) {
    if (descriptor !== null) {
      try {
        fsImpl.closeSync(descriptor);
      } catch {
        // Preserve the original staging failure.
      }
      descriptor = null;
    }
    if (created) {
      unlinkFileIfIdentityMatches(tempPath, createdIdentity, fsImpl);
    }
    throw error;
  } finally {
    if (descriptor !== null) {
      fsImpl.closeSync(descriptor);
    }
  }
  try {
    assertPathHasNoLinks(tempPath, {
      label: "Connector staged temp file",
      requireFile: true,
    });
    readVerifiedRegularFile(tempPath, {
      expectedSha256,
      fsImpl,
      label: "Connector staged temp file",
    });
  } catch (error) {
    unlinkFileIfIdentityMatches(tempPath, createdIdentity, fsImpl);
    throw error;
  }
  return createdIdentity;
}

function atomicReplaceVerifiedFiles({
  directoryPath,
  replacements,
  validateDirectory = () => {},
  fsImpl = fs,
  hooks = {},
  randomBytesImpl = crypto.randomBytes,
} = {}) {
  const directory = path.resolve(String(directoryPath || ""));
  const entries = (Array.isArray(replacements) ? replacements : []).map(
    (replacement, index) => {
      const targetPath = path.resolve(String(replacement?.targetPath || ""));
      if (path.dirname(targetPath) !== directory) {
        throw connectorSecurityError(
          `Atomic connector target is not a direct child of its install directory: ${targetPath}`,
          "ARENZYRA_CONNECTOR_TARGET_ESCAPE",
        );
      }
      const data = Buffer.isBuffer(replacement?.data)
        ? Buffer.from(replacement.data)
        : Buffer.from(String(replacement?.data ?? ""), "utf8");
      const expectedSha256 = String(
        replacement?.sha256 || hashBuffer(data),
      ).toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(expectedSha256) || hashBuffer(data) !== expectedSha256) {
        throw connectorSecurityError(
          `Atomic connector replacement data failed hash verification: ${targetPath}`,
          "ARENZYRA_CONNECTOR_REPLACEMENT_HASH_MISMATCH",
        );
      }
      return {
        data,
        expectedSha256,
        index,
        targetPath,
        tempIdentity: null,
        tempPath: "",
      };
    },
  );
  if (entries.length === 0) {
    throw connectorSecurityError(
      "Atomic connector replacement requires at least one file.",
      "ARENZYRA_CONNECTOR_REPLACEMENT_REQUIRED",
    );
  }
  if (new Set(entries.map((entry) => entry.targetPath)).size !== entries.length) {
    throw connectorSecurityError(
      "Atomic connector replacement targets must be unique.",
      "ARENZYRA_CONNECTOR_REPLACEMENT_DUPLICATE",
    );
  }

  validateDirectory({ phase: "initial" });
  const originalIdentity = captureVerifiedDirectoryIdentity(directory, fsImpl);
  const assertDirectoryStable = (context = {}) => {
    validateDirectory(context);
    assertSameDirectoryIdentity(
      originalIdentity,
      captureVerifiedDirectoryIdentity(directory, fsImpl),
    );
  };

  try {
    for (const entry of entries) {
      assertDirectoryStable({
        index: entry.index,
        phase: "before-stage",
        targetPath: entry.targetPath,
      });
      const randomSuffix = randomBytesImpl(16).toString("hex");
      const tempPath = path.join(
        directory,
        `.arenzyra-${path.basename(entry.targetPath)}-${randomSuffix}.tmp`,
      );
      entry.tempIdentity = writeExclusiveVerifiedTempFile({
        tempPath,
        data: entry.data,
        expectedSha256: entry.expectedSha256,
        fsImpl,
      });
      entry.tempPath = tempPath;
    }

    for (const entry of entries) {
      hooks.beforeReplace?.({
        directoryPath: directory,
        index: entry.index,
        targetPath: entry.targetPath,
        tempPath: entry.tempPath,
      });
      assertDirectoryStable({
        index: entry.index,
        phase: "before-replace",
        targetPath: entry.targetPath,
      });
      assertPathHasNoLinks(entry.tempPath, {
        label: "Connector staged temp file",
        requireFile: true,
      });
      assertPathHasNoLinks(entry.targetPath, {
        allowMissingLeaf: true,
        label: "Connector replacement target",
      });
      readVerifiedRegularFile(entry.tempPath, {
        expectedSha256: entry.expectedSha256,
        fsImpl,
        label: "Connector staged temp file",
      });
      fsImpl.renameSync(entry.tempPath, entry.targetPath);
      entry.tempPath = "";
      entry.tempIdentity = null;
      hooks.afterRename?.({
        directoryPath: directory,
        index: entry.index,
        targetPath: entry.targetPath,
      });
      assertDirectoryStable({
        index: entry.index,
        phase: "after-replace",
        targetPath: entry.targetPath,
      });
      assertPathHasNoLinks(entry.targetPath, {
        label: "Installed connector file",
        requireFile: true,
      });
      readVerifiedRegularFile(entry.targetPath, {
        expectedSha256: entry.expectedSha256,
        fsImpl,
        label: "Installed connector file",
      });
      hooks.afterReplace?.({
        directoryPath: directory,
        index: entry.index,
        targetPath: entry.targetPath,
      });
      fsyncDirectoryWhereSupported(directory, fsImpl);
    }
  } finally {
    let directoryStable = false;
    try {
      assertSameDirectoryIdentity(
        originalIdentity,
        captureVerifiedDirectoryIdentity(directory, fsImpl),
      );
      directoryStable = true;
    } catch {
      directoryStable = false;
    }
    if (directoryStable) {
      for (const entry of entries) {
        if (!entry.tempPath) {
          continue;
        }
        unlinkFileIfIdentityMatches(
          entry.tempPath,
          entry.tempIdentity,
          fsImpl,
        );
      }
    }
  }

  return entries.map((entry) => ({
    sha256: entry.expectedSha256,
    targetPath: entry.targetPath,
  }));
}

function createSanitizedConnectorEnv({
  parentEnv = process.env,
  overrides = {},
  dependencyRoots,
  electronRunAsNode = false,
} = {}) {
  const env = {};
  for (const [name, value] of Object.entries(parentEnv || {})) {
    if (CHILD_ENV_ALLOWLIST.has(name.toUpperCase()) && value !== undefined) {
      env[name] = String(value);
    }
  }
  for (const [name, value] of Object.entries(overrides || {})) {
    const upperName = name.toUpperCase();
    if (FORBIDDEN_CHILD_ENV.has(upperName) || /^GIT_/i.test(name)) {
      continue;
    }
    if (value !== undefined && value !== null) {
      env[name] = String(value);
    }
  }
  env.ARENZYRA_MANAGED_CONNECTOR = "1";
  const normalizedDependencyRoots = {};
  for (const packageName of ["axios", "express"]) {
    const packageRoot = String(dependencyRoots?.[packageName] || "").trim();
    if (!packageRoot || !path.isAbsolute(packageRoot)) {
      throw connectorSecurityError(
        `Managed connector dependency root is required: ${packageName}`,
        "ARENZYRA_CONNECTOR_DEPENDENCY_ROOT_REQUIRED",
      );
    }
    normalizedDependencyRoots[packageName] = path.resolve(packageRoot);
  }
  env.ARENZYRA_CONNECTOR_DEPENDENCY_MAP = JSON.stringify(
    normalizedDependencyRoots,
  );
  if (Object.keys(normalizedDependencyRoots).length !== 2) {
    throw connectorSecurityError(
      "Managed connector dependency roots are required.",
      "ARENZYRA_CONNECTOR_DEPENDENCY_ROOT_REQUIRED",
    );
  }
  if (electronRunAsNode) {
    env.ELECTRON_RUN_AS_NODE = "1";
  }
  return env;
}

module.exports = {
  CHILD_ENV_ALLOWLIST,
  FORBIDDEN_CHILD_ENV,
  assertConnectorInstallPlan,
  assertPathHasNoLinks,
  assertVerifiedRuntimeInputs,
  atomicReplaceVerifiedFiles,
  captureVerifiedDirectoryIdentity,
  createSanitizedConnectorEnv,
  inspectWindowsProcessIntegrity,
  isPathInside,
  normalizeComparablePath,
  readVerifiedRegularFile,
  resolveTrustedWindowsCommand,
  resolveTrustedWindowsSystemContext,
  sha256File,
  WINDOWS_SYSTEM_COMMAND_RELATIVE_PATHS,
};
