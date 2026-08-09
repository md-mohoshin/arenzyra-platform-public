"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const STORE_FILE_NAME = "widget-capabilities.json";
const STORE_VERSION = 1;
const MAX_STORE_BYTES = 1024 * 1024;
const MAX_ENTRIES = 500;
const LEGACY_CAPABILITY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NEW_CAPABILITY_PATTERN = /^wgt_[A-Za-z0-9_-]{43}$/;

function isWidgetCapability(value) {
  if (typeof value !== "string") return false;
  if (LEGACY_CAPABILITY_PATTERN.test(value)) return true;
  if (!NEW_CAPABILITY_PATTERN.test(value)) return false;
  try {
    const encoded = value.slice(4);
    const decoded = Buffer.from(encoded, "base64url");
    return decoded.length === 32 && decoded.toString("base64url") === encoded;
  } catch {
    return false;
  }
}

function createWidgetCapabilityStore(options = {}) {
  const getUserDataPath = options.getUserDataPath;
  const safeStorage = options.safeStorage;
  const records = new Map();
  let loaded = false;

  function canEncrypt() {
    return Boolean(
      safeStorage &&
      typeof safeStorage.isEncryptionAvailable === "function" &&
      safeStorage.isEncryptionAvailable() &&
      typeof safeStorage.encryptString === "function" &&
      typeof safeStorage.decryptString === "function",
    );
  }

  function rootPath() {
    return path.resolve(getUserDataPath(), "launcher");
  }

  function storePath() {
    return path.join(rootPath(), STORE_FILE_NAME);
  }

  function isDirectChild(root, target) {
    const relative = path.relative(root, target);
    return Boolean(
      relative &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative) &&
      !relative.includes(path.sep),
    );
  }

  function inspectRoot(create) {
    const root = rootPath();
    if (create) fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    let stats;
    try {
      stats = fs.lstatSync(root);
    } catch (error) {
      if (error?.code === "ENOENT" && !create) return null;
      throw error;
    }
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(
        "Widget credential directory is not a physical directory",
      );
    }
    if (process.platform !== "win32") fs.chmodSync(root, 0o700);
    return { configured: root, real: fs.realpathSync(root) };
  }

  function inspectStoreFile({ allowMissing = false } = {}) {
    const root = inspectRoot(false);
    if (!root) return allowMissing ? null : null;
    const target = storePath();
    if (
      path.basename(target) !== STORE_FILE_NAME ||
      !isDirectChild(root.configured, target)
    ) {
      throw new Error("Widget credential path is outside app storage");
    }
    let stats;
    try {
      stats = fs.lstatSync(target);
    } catch (error) {
      if (error?.code === "ENOENT" && allowMissing) return null;
      throw error;
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error("Linked widget credential files are refused");
    }
    const real = fs.realpathSync(target);
    if (!isDirectChild(root.real, real)) {
      throw new Error("Widget credential file is outside app storage");
    }
    if (stats.size > MAX_STORE_BYTES) {
      throw new Error("Widget credential file exceeds its local size limit");
    }
    return { path: target, stats };
  }

  function removeOwnedStoreFile() {
    try {
      const inspected = inspectStoreFile({ allowMissing: true });
      if (inspected) fs.unlinkSync(inspected.path);
    } catch {
      // Never follow or remove a path that failed the ownership checks.
    }
  }

  function identity(value, label) {
    const normalized = String(value || "").trim();
    if (!normalized || normalized.length > 128) {
      throw new Error(`Invalid ${label}`);
    }
    return normalized;
  }

  function recordKey(organizationId, widgetKey) {
    return `${identity(organizationId, "organization")}:${identity(
      widgetKey,
      "widget",
    )}`;
  }

  function load() {
    if (loaded) return;
    loaded = true;
    if (!canEncrypt()) {
      removeOwnedStoreFile();
      return;
    }
    let inspected;
    try {
      inspected = inspectStoreFile({ allowMissing: true });
      if (!inspected) return;
      const payload = JSON.parse(fs.readFileSync(inspected.path, "utf8"));
      if (
        payload?.version !== STORE_VERSION ||
        !Array.isArray(payload.entries) ||
        payload.entries.length > MAX_ENTRIES
      ) {
        throw new Error("Invalid widget credential store");
      }
      for (const entry of payload.entries) {
        if (
          !entry ||
          typeof entry !== "object" ||
          "credential" in entry ||
          "token" in entry ||
          "key" in entry ||
          entry.encrypted !== true ||
          typeof entry.ciphertext !== "string" ||
          !Number.isSafeInteger(entry.generation) ||
          entry.generation < 1
        ) {
          throw new Error("Plaintext or malformed widget credential entry");
        }
        const organizationId = identity(entry.organizationId, "organization");
        const widgetKey = identity(entry.widgetKey, "widget");
        const instanceId = identity(entry.instanceId, "instance");
        const credential = safeStorage.decryptString(
          Buffer.from(entry.ciphertext, "base64"),
        );
        if (!isWidgetCapability(credential)) {
          throw new Error("Invalid encrypted widget capability");
        }
        records.set(recordKey(organizationId, widgetKey), {
          organizationId,
          widgetKey,
          instanceId,
          generation: entry.generation,
          credential,
          updatedAt:
            typeof entry.updatedAt === "string" ? entry.updatedAt : null,
        });
      }
    } catch {
      records.clear();
      removeOwnedStoreFile();
    }
  }

  function writeAtomic(content) {
    const root = inspectRoot(true);
    const target = storePath();
    const current = inspectStoreFile({ allowMissing: true });
    if (current && current.path !== target) {
      throw new Error("Widget credential path changed unexpectedly");
    }
    const temporary = path.join(
      root.configured,
      `${STORE_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`,
    );
    try {
      fs.writeFileSync(temporary, content, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      const temporaryStats = fs.lstatSync(temporary);
      if (!temporaryStats.isFile() || temporaryStats.isSymbolicLink()) {
        throw new Error("Widget credential temporary file is not physical");
      }
      if (!isDirectChild(root.real, fs.realpathSync(temporary))) {
        throw new Error("Widget credential temporary file escaped app storage");
      }
      inspectStoreFile({ allowMissing: true });
      fs.renameSync(temporary, target);
      if (process.platform !== "win32") fs.chmodSync(target, 0o600);
    } finally {
      try {
        const stats = fs.lstatSync(temporary);
        if (stats.isFile() && !stats.isSymbolicLink()) fs.unlinkSync(temporary);
      } catch {
        // The rename normally consumed the temporary file.
      }
    }
  }

  function persist() {
    if (!canEncrypt()) {
      removeOwnedStoreFile();
      return false;
    }
    const entries = Array.from(records.values()).map((record) => ({
      organizationId: record.organizationId,
      widgetKey: record.widgetKey,
      instanceId: record.instanceId,
      generation: record.generation,
      ciphertext: safeStorage
        .encryptString(record.credential)
        .toString("base64"),
      encrypted: true,
      updatedAt: record.updatedAt,
    }));
    writeAtomic(JSON.stringify({ version: STORE_VERSION, entries }, null, 2));
    return true;
  }

  function put(input) {
    load();
    const organizationId = identity(input?.organizationId, "organization");
    const widgetKey = identity(input?.widgetKey, "widget");
    const instanceId = identity(input?.instanceId, "instance");
    const generation = Number(input?.generation);
    const credential = String(input?.credential || "").trim();
    if (!Number.isSafeInteger(generation) || generation < 1) {
      throw new Error("Invalid widget capability generation");
    }
    if (!isWidgetCapability(credential)) {
      throw new Error("Invalid widget capability");
    }
    const key = recordKey(organizationId, widgetKey);
    const existing = records.get(key);
    if (
      existing &&
      existing.instanceId === instanceId &&
      existing.generation > generation
    ) {
      return {
        persisted: persist(),
        mode: canEncrypt() ? "os-encrypted" : "memory-only",
      };
    }
    records.set(key, {
      organizationId,
      widgetKey,
      instanceId,
      generation,
      credential,
      updatedAt: new Date().toISOString(),
    });
    return {
      persisted: persist(),
      mode: canEncrypt() ? "os-encrypted" : "memory-only",
    };
  }

  function get(input) {
    load();
    const key = recordKey(input?.organizationId, input?.widgetKey);
    const record = records.get(key);
    if (!record) return null;
    const expectedInstanceId = String(input?.instanceId || "").trim();
    const expectedGeneration = Number(input?.generation);
    if (
      record.instanceId !== expectedInstanceId ||
      record.generation !== expectedGeneration
    ) {
      if (
        record.instanceId !== expectedInstanceId ||
        (Number.isSafeInteger(expectedGeneration) &&
          expectedGeneration > record.generation)
      ) {
        records.delete(key);
        persist();
      }
      return null;
    }
    return record.credential;
  }

  function remove(input) {
    load();
    const removed = records.delete(
      recordKey(input?.organizationId, input?.widgetKey),
    );
    if (removed) persist();
    return removed;
  }

  return {
    get,
    put,
    remove,
    getStorePath: storePath,
    getStorageMode: () => (canEncrypt() ? "os-encrypted" : "memory-only"),
  };
}

module.exports = { createWidgetCapabilityStore, isWidgetCapability };
