const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function parseTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toIsoTimestamp(value, fallback = null) {
  const parsed = parseTimestamp(value);
  if (parsed === null) {
    return fallback;
  }
  return new Date(parsed).toISOString();
}

function createSessionManager(options) {
  const getUserDataPath = options?.getUserDataPath;
  const safeStorage = options?.safeStorage;
  let memorySession = null;

  function getSessionDir() {
    return path.join(getUserDataPath(), "launcher");
  }

  function getSessionPath() {
    return path.join(getSessionDir(), "session.json");
  }

  function getMachineIdPath() {
    return path.join(getSessionDir(), "machine-id.txt");
  }

  function ensureSessionDir() {
    fs.mkdirSync(getSessionDir(), { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(getSessionDir(), 0o700);
    } catch {
      // Windows ACLs and some managed filesystems do not expose POSIX modes.
    }
  }

  function canEncrypt() {
    return (
      safeStorage &&
      typeof safeStorage.isEncryptionAvailable === "function" &&
      safeStorage.isEncryptionAvailable()
    );
  }

  function encodeSecret(secret) {
    const value = String(secret || "").trim();
    if (!value) {
      return { value: "", encrypted: false };
    }

    if (!canEncrypt()) {
      return { value: "", encrypted: false };
    }

    return {
      value: safeStorage.encryptString(value).toString("base64"),
      encrypted: true,
    };
  }

  function decodeSecret(raw, encrypted) {
    if (!raw) {
      return "";
    }

    if (!encrypted) return "";

    if (!canEncrypt()) {
      return "";
    }

    try {
      return safeStorage.decryptString(Buffer.from(raw, "base64"));
    } catch {
      return "";
    }
  }

  function getCredentialStorageState() {
    const available = canEncrypt();
    return {
      mode: available ? "os-encrypted" : "memory-only",
      persistentRefreshToken: available,
      reason: available
        ? null
        : "OS credential encryption is unavailable. This login stays in memory and will not survive an app restart.",
    };
  }

  function removeSessionFile() {
    try {
      if (fs.existsSync(getSessionPath())) fs.unlinkSync(getSessionPath());
    } catch {
      // Session removal is best-effort; plaintext is never read back.
    }
  }

  function writeAtomic(filePath, content) {
    ensureSessionDir();
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, content, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      fs.renameSync(temporaryPath, filePath);
      try {
        fs.chmodSync(filePath, 0o600);
      } catch {
        // Windows ACLs and some managed filesystems do not expose POSIX modes.
      }
    } finally {
      try {
        if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
      } catch {
        // Ignore temporary cleanup errors.
      }
    }
  }

  function readSecret(payload, key, encryptedKey, legacyKey, legacyEncryptedKey) {
    const raw =
      typeof payload?.[key] === "string"
        ? payload[key]
        : typeof legacyKey === "string" && typeof payload?.[legacyKey] === "string"
          ? payload[legacyKey]
          : "";
    const encrypted =
      typeof payload?.[encryptedKey] === "boolean"
        ? payload[encryptedKey]
        : typeof legacyEncryptedKey === "string" &&
            typeof payload?.[legacyEncryptedKey] === "boolean"
          ? payload[legacyEncryptedKey]
          : false;

    return decodeSecret(raw, encrypted);
  }

  function readSession() {
    if (memorySession) {
      return {
        ...memorySession,
        credentialStorage: getCredentialStorageState(),
      };
    }
    const sessionPath = getSessionPath();
    if (!fs.existsSync(sessionPath)) {
      return null;
    }

    try {
      const payload = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
      if (!canEncrypt()) {
        if (
          payload?.accessToken ||
          payload?.token ||
          (payload?.refreshToken && payload?.refreshTokenEncrypted !== true)
        ) {
          removeSessionFile();
        }
        return null;
      }
      const accessToken = "";
      const refreshToken = readSecret(
        payload,
        "refreshToken",
        "refreshTokenEncrypted",
      );

      if (!refreshToken) {
        removeSessionFile();
        return null;
      }

      const updatedAt = toIsoTimestamp(payload?.updatedAt);
      const lastAuthenticatedAt = toIsoTimestamp(
        payload?.lastAuthenticatedAt || payload?.updatedAt,
      );
      const lastActiveAt = toIsoTimestamp(
        payload?.lastActiveAt || payload?.lastAuthenticatedAt || payload?.updatedAt,
      );

      memorySession = {
        apiBase:
          typeof payload?.apiBase === "string" ? payload.apiBase.trim() : "",
        token: accessToken,
        accessToken,
        refreshToken,
        updatedAt,
        lastAuthenticatedAt,
        lastActiveAt,
        userId:
          typeof payload?.userId === "string" ? payload.userId.trim() : "",
        organizationId:
          typeof payload?.organizationId === "string"
            ? payload.organizationId.trim()
            : "",
        user: payload?.user ?? null,
        organization: payload?.organization ?? null,
      };
      const hasLegacySecretCopies = Boolean(
        payload?.accessToken ||
          payload?.token ||
          (payload?.refreshToken && payload?.refreshTokenEncrypted !== true) ||
          payload?.version !== 5,
      );
      if (hasLegacySecretCopies) {
        writeSession(memorySession);
      }
      return {
        ...memorySession,
        credentialStorage: getCredentialStorageState(),
      };
    } catch {
      removeSessionFile();
      return null;
    }
  }

  function writeSession(session) {
    ensureSessionDir();
    const sessionPath = getSessionPath();
    const nowIso = new Date().toISOString();
    const accessTokenValue = String(
      session?.accessToken || session?.token || "",
    ).trim();
    const refreshTokenValue = String(session?.refreshToken || "").trim();
    const user = session?.user ?? null;
    const organization = session?.organization ?? null;
    const lastAuthenticatedAt =
      toIsoTimestamp(session?.lastAuthenticatedAt) || nowIso;
    const lastActiveAt =
      toIsoTimestamp(session?.lastActiveAt) ||
      lastAuthenticatedAt ||
      nowIso;

    memorySession = {
      apiBase: "",
      token: accessTokenValue,
      accessToken: accessTokenValue,
      refreshToken: refreshTokenValue,
      updatedAt: nowIso,
      lastAuthenticatedAt,
      lastActiveAt,
      userId: user?.id ? String(user.id) : "",
      organizationId:
        user?.organizationId || organization?.id
          ? String(user?.organizationId || organization?.id)
          : "",
      user,
      organization,
    };

    if (!canEncrypt()) {
      removeSessionFile();
      return null;
    }

    const encodedRefreshToken = encodeSecret(refreshTokenValue);
    if (!encodedRefreshToken.value) {
      removeSessionFile();
      return null;
    }
    const payload = {
      version: 5,
      updatedAt: nowIso,
      lastAuthenticatedAt,
      lastActiveAt,
      refreshToken: encodedRefreshToken.value,
      refreshTokenEncrypted: encodedRefreshToken.encrypted,
      userId: user?.id ? String(user.id) : "",
      organizationId:
        user?.organizationId || organization?.id
          ? String(user?.organizationId || organization?.id)
          : "",
      user,
      organization,
    };

    writeAtomic(sessionPath, JSON.stringify(payload, null, 2));
    return sessionPath;
  }

  function touchSessionActivity(activityAt = new Date().toISOString()) {
    const session = readSession();
    if (!session) {
      return null;
    }

    writeSession({
      ...session,
      lastAuthenticatedAt: session.lastAuthenticatedAt,
      lastActiveAt: toIsoTimestamp(activityAt) || new Date().toISOString(),
    });
    return readSession();
  }

  function getSessionExpiry(maxInactiveMs) {
    const session = readSession();
    if (!session) {
      return {
        session: null,
        referenceAt: null,
        expiresAt: null,
        expired: false,
      };
    }

    const referenceAt =
      toIsoTimestamp(
        session.lastActiveAt || session.lastAuthenticatedAt || session.updatedAt,
      ) || null;
    const referenceMs = parseTimestamp(referenceAt);
    if (!Number.isFinite(maxInactiveMs) || maxInactiveMs <= 0 || referenceMs === null) {
      return {
        session,
        referenceAt,
        expiresAt: null,
        expired: false,
      };
    }

    const expiresAt = new Date(referenceMs + maxInactiveMs).toISOString();
    return {
      session,
      referenceAt,
      expiresAt,
      expired: Date.now() > referenceMs + maxInactiveMs,
    };
  }

  function clearSession() {
    memorySession = null;
    removeSessionFile();
  }

  function getMachineId() {
    ensureSessionDir();
    const machineIdPath = getMachineIdPath();

    try {
      if (fs.existsSync(machineIdPath)) {
        const existing = fs.readFileSync(machineIdPath, "utf8").trim();
        if (existing) {
          try {
            fs.chmodSync(machineIdPath, 0o600);
          } catch {
            // Best-effort on platforms without POSIX modes.
          }
          return existing;
        }
      }
    } catch {
      // ignore machine id read errors
    }

    const machineId = randomUUID();
    writeAtomic(machineIdPath, `${machineId}\n`);
    return machineId;
  }

  return {
    getMachineId,
    getMachineIdPath,
    getSessionExpiry,
    getSessionPath,
    getCredentialStorageState,
    readSession,
    touchSessionActivity,
    writeSession,
    clearSession,
  };
}

module.exports = {
  createSessionManager,
};
