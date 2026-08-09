"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_MAX_CAPTURE_BYTES = 8 * 1024 * 1024;
const DEFAULT_ORPHAN_RETENTION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CLEANUP_SCAN_LIMIT = 200;
const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const OWNED_CAPTURE_FILE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-(?:killFeed|teamPanel|scoreboard|roster)\.png$/i;

function positiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.max(1, Math.floor(numeric));
}

function createCaptureError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isDirectChild(rootPath, targetPath) {
  const relativePath = path.relative(rootPath, targetPath);
  return Boolean(
    relativePath &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath) &&
      !relativePath.includes(path.sep),
  );
}

function canonicalPathKey(filePath) {
  const normalized = path.normalize(filePath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function createVisualCaptureStore(options = {}) {
  const getCaptureDir =
    typeof options.getCaptureDir === "function" ? options.getCaptureDir : null;
  const logger = options.logger || {};
  const now = typeof options.now === "function" ? options.now : () => new Date();
  const maxCaptureBytes = positiveInteger(
    options.maxCaptureBytes,
    DEFAULT_MAX_CAPTURE_BYTES,
  );
  const orphanRetentionMs = positiveInteger(
    options.orphanRetentionMs,
    DEFAULT_ORPHAN_RETENTION_MS,
  );
  const cleanupScanLimit = positiveInteger(
    options.cleanupScanLimit,
    DEFAULT_CLEANUP_SCAN_LIMIT,
  );
  const cleanupIntervalMs = positiveInteger(
    options.cleanupIntervalMs,
    DEFAULT_CLEANUP_INTERVAL_MS,
  );
  let lastCleanupAtMs = null;

  function logWarn(message, code) {
    if (typeof logger.warn === "function") {
      logger.warn(message, { code: String(code || "UNKNOWN") });
    }
  }

  function nowMs() {
    const candidate = now();
    const date = candidate instanceof Date ? candidate : new Date(candidate);
    return Number.isFinite(date.getTime()) ? date.getTime() : Date.now();
  }

  function captureRoot(options = {}) {
    if (!getCaptureDir) {
      return null;
    }
    const configured = String(getCaptureDir() || "").trim();
    if (!configured) {
      return null;
    }

    const configuredPath = path.resolve(configured);
    if (options.create === true) {
      fs.mkdirSync(configuredPath, { recursive: true, mode: 0o700 });
    }

    let rootStats;
    try {
      rootStats = fs.lstatSync(configuredPath);
    } catch (error) {
      if (error?.code === "ENOENT" && options.create !== true) {
        return null;
      }
      throw createCaptureError(
        "ARENZYRA_VISUAL_CAPTURE_ROOT_UNAVAILABLE",
        "The app-owned visual capture directory is unavailable.",
      );
    }

    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
      throw createCaptureError(
        "ARENZYRA_VISUAL_CAPTURE_ROOT_REFUSED",
        "The visual capture directory must be an app-owned physical directory.",
      );
    }

    if (process.platform !== "win32") {
      try {
        fs.chmodSync(configuredPath, 0o700);
      } catch (error) {
        logWarn("visual-mode-capture-directory-permissions-failed", error?.code);
      }
    }

    return {
      configuredPath,
      realPath: fs.realpathSync(configuredPath),
    };
  }

  function inspectOwnedFile(filePath, options = {}) {
    const normalizedInput = String(filePath || "").trim();
    if (!normalizedInput || !path.isAbsolute(normalizedInput)) {
      throw createCaptureError(
        "ARENZYRA_VISUAL_CAPTURE_PATH_REFUSED",
        "The visual capture path is not app-owned.",
      );
    }

    const root = captureRoot({ create: false });
    if (!root) {
      throw createCaptureError(
        "ARENZYRA_VISUAL_CAPTURE_ROOT_UNAVAILABLE",
        "The app-owned visual capture directory is unavailable.",
      );
    }

    const targetPath = path.resolve(normalizedInput);
    const fileName = path.basename(targetPath);
    if (
      !isDirectChild(root.configuredPath, targetPath) ||
      !OWNED_CAPTURE_FILE_PATTERN.test(fileName)
    ) {
      throw createCaptureError(
        "ARENZYRA_VISUAL_CAPTURE_PATH_REFUSED",
        "The visual capture path is not app-owned.",
      );
    }

    let stats;
    try {
      stats = fs.lstatSync(targetPath);
    } catch (error) {
      if (error?.code === "ENOENT" && options.allowMissing === true) {
        return { missing: true, path: targetPath, fileName };
      }
      throw createCaptureError(
        "ARENZYRA_VISUAL_CAPTURE_MISSING",
        "The visual capture file was not found.",
      );
    }

    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw createCaptureError(
        "ARENZYRA_VISUAL_CAPTURE_LINK_REFUSED",
        "Linked or non-file visual captures are not allowed.",
      );
    }

    const realPath = fs.realpathSync(targetPath);
    if (!isDirectChild(root.realPath, realPath)) {
      throw createCaptureError(
        "ARENZYRA_VISUAL_CAPTURE_PATH_REFUSED",
        "The visual capture path is outside the app-owned directory.",
      );
    }

    return {
      missing: false,
      path: targetPath,
      realPath,
      fileName,
      stats,
    };
  }

  function save(itemId, regionKey, buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw createCaptureError(
        "ARENZYRA_VISUAL_CAPTURE_EMPTY",
        "The visual capture is empty.",
      );
    }
    if (buffer.length > maxCaptureBytes) {
      throw createCaptureError(
        "ARENZYRA_VISUAL_CAPTURE_TOO_LARGE",
        `The visual capture exceeds the ${maxCaptureBytes}-byte local limit.`,
      );
    }

    const normalizedItemId = String(itemId || "").trim();
    const normalizedRegionKey = String(regionKey || "").trim();
    const fileName = `${normalizedItemId}-${normalizedRegionKey}.png`;
    if (!OWNED_CAPTURE_FILE_PATTERN.test(fileName)) {
      throw createCaptureError(
        "ARENZYRA_VISUAL_CAPTURE_NAME_REFUSED",
        "The visual capture filename is not app-owned.",
      );
    }

    const root = captureRoot({ create: true });
    if (!root) {
      return null;
    }
    const filePath = path.join(root.configuredPath, fileName);

    try {
      fs.writeFileSync(filePath, buffer, { flag: "wx", mode: 0o600 });
      if (process.platform !== "win32") {
        fs.chmodSync(filePath, 0o600);
      }
      return inspectOwnedFile(filePath).realPath;
    } catch (error) {
      try {
        const inspection = inspectOwnedFile(filePath, { allowMissing: true });
        if (!inspection.missing) {
          fs.unlinkSync(inspection.path);
        }
      } catch {
        // Refuse to follow or clean up anything that did not pass ownership checks.
      }
      throw error;
    }
  }

  function assertReady(filePath) {
    const inspection = inspectOwnedFile(filePath);
    if (inspection.stats.size <= 0) {
      throw createCaptureError(
        "ARENZYRA_VISUAL_CAPTURE_EMPTY",
        "The visual capture is empty.",
      );
    }
    if (inspection.stats.size > maxCaptureBytes) {
      throw createCaptureError(
        "ARENZYRA_VISUAL_CAPTURE_TOO_LARGE",
        `The visual capture exceeds the ${maxCaptureBytes}-byte local limit.`,
      );
    }
    return inspection.realPath;
  }

  function remove(filePath) {
    let inspection;
    try {
      inspection = inspectOwnedFile(filePath, { allowMissing: true });
    } catch (error) {
      return { removed: false, missing: false, refused: true, code: error?.code };
    }
    if (inspection.missing) {
      return { removed: false, missing: true, refused: false, code: null };
    }

    try {
      fs.unlinkSync(inspection.path);
      return { removed: true, missing: false, refused: false, code: null };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { removed: false, missing: true, refused: false, code: null };
      }
      logWarn("visual-mode-capture-cleanup-failed", error?.code);
      return { removed: false, missing: false, refused: false, code: error?.code };
    }
  }

  function cleanup(options = {}) {
    const timestampMs = nowMs();
    if (
      options.force !== true &&
      lastCleanupAtMs !== null &&
      timestampMs >= lastCleanupAtMs &&
      timestampMs - lastCleanupAtMs < cleanupIntervalMs
    ) {
      return {
        scanned: 0,
        removed: 0,
        preserved: 0,
        refused: 0,
        errors: 0,
        limitReached: false,
        skipped: true,
      };
    }
    let root;
    try {
      root = captureRoot({ create: true });
    } catch (error) {
      logWarn("visual-mode-capture-cleanup-root-refused", error?.code);
      return {
        scanned: 0,
        removed: 0,
        preserved: 0,
        refused: 1,
        errors: 0,
        limitReached: false,
        skipped: false,
      };
    }
    lastCleanupAtMs = timestampMs;
    if (!root) {
      return {
        scanned: 0,
        removed: 0,
        preserved: 0,
        refused: 0,
        errors: 0,
        limitReached: false,
        skipped: false,
      };
    }

    const protectedPaths = new Set();
    for (const protectedPath of Array.isArray(options.protectedPaths)
      ? options.protectedPaths
      : []) {
      try {
        const inspection = inspectOwnedFile(protectedPath);
        protectedPaths.add(canonicalPathKey(inspection.realPath));
      } catch {
        // Invalid protection entries cannot broaden the cleanup boundary.
      }
    }

    const summary = {
      scanned: 0,
      removed: 0,
      preserved: 0,
      refused: 0,
      errors: 0,
      limitReached: false,
      skipped: false,
    };
    let directory;
    try {
      directory = fs.opendirSync(root.configuredPath);
      while (summary.scanned < cleanupScanLimit) {
        const entry = directory.readSync();
        if (!entry) {
          break;
        }
        summary.scanned += 1;

        if (
          entry.isSymbolicLink() ||
          !entry.isFile() ||
          !OWNED_CAPTURE_FILE_PATTERN.test(entry.name)
        ) {
          summary.refused += 1;
          continue;
        }

        const candidatePath = path.join(root.configuredPath, entry.name);
        let inspection;
        try {
          inspection = inspectOwnedFile(candidatePath);
        } catch {
          summary.refused += 1;
          continue;
        }

        if (protectedPaths.has(canonicalPathKey(inspection.realPath))) {
          summary.preserved += 1;
          continue;
        }
        if (timestampMs - inspection.stats.mtimeMs < orphanRetentionMs) {
          summary.preserved += 1;
          continue;
        }

        try {
          fs.unlinkSync(inspection.path);
          summary.removed += 1;
        } catch (error) {
          if (error?.code !== "ENOENT") {
            summary.errors += 1;
            logWarn("visual-mode-orphan-cleanup-failed", error?.code);
          }
        }
      }
      summary.limitReached = summary.scanned >= cleanupScanLimit;
    } catch (error) {
      summary.errors += 1;
      logWarn("visual-mode-orphan-scan-failed", error?.code);
    } finally {
      try {
        directory?.closeSync();
      } catch {
        // The bounded scan is already complete; do not mask its result.
      }
    }

    return summary;
  }

  return {
    save,
    assertReady,
    remove,
    cleanup,
    limits: Object.freeze({
      maxCaptureBytes,
      orphanRetentionMs,
      cleanupScanLimit,
      cleanupIntervalMs,
    }),
  };
}

module.exports = {
  DEFAULT_CLEANUP_SCAN_LIMIT,
  DEFAULT_MAX_CAPTURE_BYTES,
  DEFAULT_ORPHAN_RETENTION_MS,
  OWNED_CAPTURE_FILE_PATTERN,
  createVisualCaptureStore,
};
