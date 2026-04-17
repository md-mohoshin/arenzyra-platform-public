"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_LOG_FILES = 3;
const DEFAULT_RECENT_LIMIT = 1000;
const DEFAULT_RECENT_RETURN_LIMIT = 100;
const FLUSH_DELAY_MS = 25;

const LOG_TARGETS = Object.freeze({
  launcher: "launcher.log",
  telemetry: "telemetry.log",
  widget: "widget.log",
  error: "error.log",
});

function normalizeScope(scope) {
  const normalized = String(scope || "launcher")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "launcher";
}

function toSerializableValue(value, seen = new WeakSet()) {
  if (value === null) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack || null,
      code:
        typeof value.code === "string" || typeof value.code === "number"
          ? value.code
          : undefined,
      status:
        typeof value.status === "number" && Number.isFinite(value.status)
          ? value.status
          : undefined,
    };
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);
    const output = value.map((entry) => toSerializableValue(entry, seen));
    seen.delete(value);
    return output;
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === "undefined") {
        continue;
      }
      output[key] = toSerializableValue(entry, seen);
    }
    seen.delete(value);
    return output;
  }

  if (typeof value === "undefined") {
    return undefined;
  }

  return String(value);
}

function normalizeMessage(message) {
  const normalized = String(message || "").trim();
  return normalized || "Log entry";
}

function resolveLogTarget(scope) {
  const normalizedScope = normalizeScope(scope);

  if (normalizedScope === "telemetry" || normalizedScope.startsWith("telemetry-")) {
    return "telemetry";
  }

  if (
    normalizedScope === "widget" ||
    normalizedScope === "widgets" ||
    normalizedScope.startsWith("widget-") ||
    normalizedScope.startsWith("widgets-")
  ) {
    return "widget";
  }

  return "launcher";
}

function createConsoleMethod(level) {
  if (level === "error") {
    return console.error.bind(console);
  }
  if (level === "warn") {
    return console.warn.bind(console);
  }
  return console.log.bind(console);
}

function createLogger(options = {}) {
  const getUserDataPath =
    typeof options?.getUserDataPath === "function"
      ? options.getUserDataPath
      : () => null;
  const fallbackLogsDir = path.resolve(
    options?.fallbackLogsDir || path.join(process.cwd(), "logs"),
  );
  const maxFileSizeBytes =
    typeof options?.maxFileSizeBytes === "number" &&
    options.maxFileSizeBytes > 0
      ? options.maxFileSizeBytes
      : DEFAULT_MAX_FILE_SIZE_BYTES;
  const maxLogFiles =
    typeof options?.maxLogFiles === "number" && options.maxLogFiles >= 2
      ? Math.floor(options.maxLogFiles)
      : DEFAULT_MAX_LOG_FILES;
  const maxArchivedFiles = Math.max(0, maxLogFiles - 1);
  const recentLimit =
    typeof options?.recentLimit === "number" && options.recentLimit > 0
      ? Math.floor(options.recentLimit)
      : DEFAULT_RECENT_LIMIT;
  const defaultRecentLimit =
    typeof options?.defaultRecentLimit === "number" &&
    options.defaultRecentLimit > 0
      ? Math.floor(options.defaultRecentLimit)
      : DEFAULT_RECENT_RETURN_LIMIT;
  const mirrorToConsole = options?.mirrorToConsole !== false;

  const fileStates = new Map();
  const recentEntries = [];

  function resolveLogsDir() {
    try {
      const userDataPath = getUserDataPath();
      if (typeof userDataPath === "string" && userDataPath.trim()) {
        return path.join(userDataPath.trim(), "logs");
      }
    } catch {
      // fall through to fallback directory
    }

    return fallbackLogsDir;
  }

  function ensureFileState(targetKey) {
    if (!fileStates.has(targetKey)) {
      fileStates.set(targetKey, {
        key: targetKey,
        fileName: LOG_TARGETS[targetKey],
        pendingChunks: [],
        flushTimer: null,
        flushChain: Promise.resolve(),
        currentFilePath: null,
        currentSizeBytes: null,
      });
    }

    return fileStates.get(targetKey);
  }

  async function ensureDirectory(dirPath) {
    await fs.promises.mkdir(dirPath, { recursive: true });
  }

  async function ensureKnownFileSize(state, filePath) {
    if (state.currentFilePath !== filePath) {
      state.currentFilePath = filePath;
      state.currentSizeBytes = null;
    }

    if (state.currentSizeBytes !== null) {
      return state.currentSizeBytes;
    }

    try {
      const stats = await fs.promises.stat(filePath);
      state.currentSizeBytes = stats.size;
    } catch (error) {
      if (error?.code === "ENOENT") {
        state.currentSizeBytes = 0;
      } else {
        throw error;
      }
    }

    return state.currentSizeBytes;
  }

  async function rotateFile(filePath) {
    if (maxArchivedFiles <= 0) {
      try {
        await fs.promises.rm(filePath, { force: true });
      } catch {
        // ignore rotation failures for the main file remove path
      }
      return;
    }

    const oldestArchivePath = `${filePath}.${maxArchivedFiles}`;
    await fs.promises.rm(oldestArchivePath, { force: true }).catch(() => {});

    for (let index = maxArchivedFiles - 1; index >= 1; index -= 1) {
      const fromPath = `${filePath}.${index}`;
      const toPath = `${filePath}.${index + 1}`;
      await fs.promises.rename(fromPath, toPath).catch((error) => {
        if (error?.code !== "ENOENT") {
          throw error;
        }
      });
    }

    await fs.promises.rename(filePath, `${filePath}.1`).catch((error) => {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    });
  }

  async function ensureRotation(state, filePath, incomingBytes) {
    const currentSizeBytes = await ensureKnownFileSize(state, filePath);
    if (currentSizeBytes + incomingBytes <= maxFileSizeBytes) {
      return;
    }

    await rotateFile(filePath);
    state.currentSizeBytes = 0;
  }

  async function flushState(state) {
    const chunks = state.pendingChunks.splice(0, state.pendingChunks.length);
    if (chunks.length === 0) {
      return;
    }

    const dirPath = resolveLogsDir();
    const filePath = path.join(dirPath, state.fileName);
    const payload = chunks.join("");
    const payloadBytes = Buffer.byteLength(payload, "utf8");

    try {
      await ensureDirectory(dirPath);
      await ensureRotation(state, filePath, payloadBytes);
      await fs.promises.appendFile(filePath, payload, "utf8");
      state.currentFilePath = filePath;
      state.currentSizeBytes =
        (state.currentSizeBytes || 0) + payloadBytes;
    } catch (error) {
      if (mirrorToConsole) {
        console.error(
          "[logger] failed to write log file",
          filePath,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  function scheduleFlush(state) {
    if (state.flushTimer) {
      return;
    }

    state.flushTimer = setTimeout(() => {
      state.flushTimer = null;
      state.flushChain = state.flushChain
        .then(() => flushState(state))
        .catch((error) => {
          if (mirrorToConsole) {
            console.error(
              "[logger] flush chain failed",
              state.fileName,
              error instanceof Error ? error.message : String(error),
            );
          }
        });
    }, FLUSH_DELAY_MS);

    if (typeof state.flushTimer.unref === "function") {
      state.flushTimer.unref();
    }
  }

  function pushRecentEntry(entry) {
    recentEntries.push(entry);
    if (recentEntries.length > recentLimit) {
      recentEntries.splice(0, recentEntries.length - recentLimit);
    }
  }

  function write(level, scope, message, meta) {
    const normalizedLevel =
      level === "warn" || level === "error" ? level : "info";
    const normalizedScope = normalizeScope(scope);
    const targetKey = resolveLogTarget(normalizedScope);
    const entry = {
      timestamp: new Date().toISOString(),
      level: normalizedLevel,
      scope: normalizedScope,
      message: normalizeMessage(message),
    };
    const serializedMeta = toSerializableValue(meta);
    if (typeof serializedMeta !== "undefined") {
      entry.meta = serializedMeta;
    }
    entry.target = LOG_TARGETS[targetKey];

    const line = `${JSON.stringify(entry)}${os.EOL}`;
    const targetState = ensureFileState(targetKey);
    targetState.pendingChunks.push(line);
    scheduleFlush(targetState);

    if (normalizedLevel === "error") {
      const errorState = ensureFileState("error");
      errorState.pendingChunks.push(line);
      scheduleFlush(errorState);
    }

    pushRecentEntry(entry);

    if (mirrorToConsole) {
      const consoleMethod = createConsoleMethod(normalizedLevel);
      if (typeof entry.meta === "undefined") {
        consoleMethod(
          `[${entry.timestamp}] [${entry.level}] [${entry.scope}] ${entry.message}`,
        );
      } else {
        consoleMethod(
          `[${entry.timestamp}] [${entry.level}] [${entry.scope}] ${entry.message}`,
          entry.meta,
        );
      }
    }

    return entry;
  }

  function getRecent(scope, limit = defaultRecentLimit) {
    const normalizedLimit =
      typeof limit === "number" && Number.isFinite(limit) && limit > 0
        ? Math.floor(limit)
        : defaultRecentLimit;
    const normalizedScope = scope ? normalizeScope(scope) : null;
    const filteredEntries = normalizedScope
      ? recentEntries.filter(
          (entry) =>
            entry.scope === normalizedScope ||
            entry.scope.startsWith(`${normalizedScope}-`) ||
            resolveLogTarget(entry.scope) === normalizedScope,
        )
      : recentEntries;
    return filteredEntries.slice(-normalizedLimit).map((entry) => ({ ...entry }));
  }

  function child(scope) {
    const normalizedScope = normalizeScope(scope);
    return {
      info(message, meta) {
        return write("info", normalizedScope, message, meta);
      },
      warn(message, meta) {
        return write("warn", normalizedScope, message, meta);
      },
      error(message, meta) {
        return write("error", normalizedScope, message, meta);
      },
      log(message, meta) {
        return write("info", normalizedScope, message, meta);
      },
    };
  }

  return {
    info(scope, message, meta) {
      return write("info", scope, message, meta);
    },
    warn(scope, message, meta) {
      return write("warn", scope, message, meta);
    },
    error(scope, message, meta) {
      return write("error", scope, message, meta);
    },
    child,
    getRecent,
  };
}

module.exports = {
  createLogger,
  normalizeScope,
  resolveLogTarget,
};
