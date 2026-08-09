"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createSessionManager } = require("./sessionManager.cjs");

function encryptedStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value) =>
      value.toString("utf8").replace(/^encrypted:/, ""),
  };
}

function manager(root, safeStorage) {
  return createSessionManager({ getUserDataPath: () => root, safeStorage });
}

test("persists only an OS-encrypted refresh token with atomic restrictive output", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-session-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = manager(root, encryptedStorage());
  first.writeSession({
    accessToken: "access-secret",
    refreshToken: "refresh-secret",
    user: { id: "user-1", organizationId: "org-1" },
  });

  const sessionPath = first.getSessionPath();
  const raw = fs.readFileSync(sessionPath, "utf8");
  const payload = JSON.parse(raw);
  assert.equal(payload.version, 5);
  assert.equal("accessToken" in payload, false);
  assert.equal("token" in payload, false);
  assert.doesNotMatch(raw, /access-secret|refresh-secret/);
  assert.equal(payload.refreshTokenEncrypted, true);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(sessionPath).mode & 0o777, 0o600);
  }
  assert.equal(
    fs.readdirSync(path.dirname(sessionPath)).some((name) => name.endsWith(".tmp")),
    false,
  );

  const restarted = manager(root, encryptedStorage());
  const restored = restarted.readSession();
  assert.equal(restored.accessToken, "");
  assert.equal(restored.refreshToken, "refresh-secret");
  assert.equal(restored.credentialStorage.mode, "os-encrypted");
});

test("uses memory only and deletes stale plaintext when OS encryption is unavailable", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-session-memory-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const current = manager(root, encryptedStorage(false));
  const sessionPath = current.getSessionPath();
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  fs.writeFileSync(
    sessionPath,
    JSON.stringify({ token: "plaintext-access", refreshToken: "plaintext-refresh" }),
  );
  assert.equal(current.readSession(), null);
  assert.equal(fs.existsSync(sessionPath), false);

  current.writeSession({
    accessToken: "memory-access",
    refreshToken: "memory-refresh",
    user: { id: "user-1" },
  });
  assert.equal(fs.existsSync(sessionPath), false);
  assert.equal(current.readSession().accessToken, "memory-access");
  assert.equal(current.readSession().credentialStorage.mode, "memory-only");
  assert.match(current.readSession().credentialStorage.reason, /will not survive/);

  const restarted = manager(root, encryptedStorage(false));
  assert.equal(restarted.readSession(), null);
});
