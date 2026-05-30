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
    fs.mkdirSync(getSessionDir(), { recursive: true });
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
      return { value, encrypted: false };
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

    if (!encrypted) {
      return raw;
    }

    if (!canEncrypt()) {
      return "";
    }

    try {
      return safeStorage.decryptString(Buffer.from(raw, "base64"));
    } catch {
      return "";
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
    const sessionPath = getSessionPath();
    if (!fs.existsSync(sessionPath)) {
      return null;
    }

    try {
      const payload = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
      const accessToken = readSecret(
        payload,
        "accessToken",
        "accessTokenEncrypted",
        "token",
        "encrypted",
      );
      const refreshToken = readSecret(
        payload,
        "refreshToken",
        "refreshTokenEncrypted",
      );

      if (!accessToken && !refreshToken) {
        return null;
      }

      const updatedAt = toIsoTimestamp(payload?.updatedAt);
      const lastAuthenticatedAt = toIsoTimestamp(
        payload?.lastAuthenticatedAt || payload?.updatedAt,
      );
      const lastActiveAt = toIsoTimestamp(
        payload?.lastActiveAt || payload?.lastAuthenticatedAt || payload?.updatedAt,
      );

      return {
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
    } catch {
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
    const encodedAccessToken = encodeSecret(accessTokenValue);
    const encodedRefreshToken = encodeSecret(refreshTokenValue);
    const user = session?.user ?? null;
    const organization = session?.organization ?? null;
    const lastAuthenticatedAt =
      toIsoTimestamp(session?.lastAuthenticatedAt) || nowIso;
    const lastActiveAt =
      toIsoTimestamp(session?.lastActiveAt) ||
      lastAuthenticatedAt ||
      nowIso;

    const payload = {
      version: 4,
      updatedAt: nowIso,
      lastAuthenticatedAt,
      lastActiveAt,
      accessToken: encodedAccessToken.value,
      accessTokenEncrypted: encodedAccessToken.encrypted,
      refreshToken: encodedRefreshToken.value,
      refreshTokenEncrypted: encodedRefreshToken.encrypted,
      token: encodedAccessToken.value,
      encrypted: encodedAccessToken.encrypted,
      userId: user?.id ? String(user.id) : "",
      organizationId:
        user?.organizationId || organization?.id
          ? String(user?.organizationId || organization?.id)
          : "",
      user,
      organization,
    };

    fs.writeFileSync(sessionPath, JSON.stringify(payload, null, 2));
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
    const sessionPath = getSessionPath();
    try {
      if (fs.existsSync(sessionPath)) {
        fs.unlinkSync(sessionPath);
      }
    } catch {
      // ignore session cleanup errors
    }
  }

  function getMachineId() {
    ensureSessionDir();
    const machineIdPath = getMachineIdPath();

    try {
      if (fs.existsSync(machineIdPath)) {
        const existing = fs.readFileSync(machineIdPath, "utf8").trim();
        if (existing) {
          return existing;
        }
      }
    } catch {
      // ignore machine id read errors
    }

    const machineId = randomUUID();
    fs.writeFileSync(machineIdPath, `${machineId}\n`, "utf8");
    return machineId;
  }

  return {
    getMachineId,
    getMachineIdPath,
    getSessionExpiry,
    getSessionPath,
    readSession,
    touchSessionActivity,
    writeSession,
    clearSession,
  };
}

module.exports = {
  createSessionManager,
};
