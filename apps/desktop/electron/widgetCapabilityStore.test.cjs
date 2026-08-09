"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createWidgetCapabilityStore } = require("./widgetCapabilityStore.cjs");

const CAPABILITY = `wgt_${Buffer.alloc(32, 7).toString("base64url")}`;

function encryption(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`protected:${value}`, "utf8"),
    decryptString: (value) => value.toString("utf8").replace(/^protected:/, ""),
  };
}

function store(root, safeStorage = encryption()) {
  return createWidgetCapabilityStore({
    getUserDataPath: () => root,
    safeStorage,
  });
}

test("persists a widget capability only as OS-encrypted ciphertext", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-widget-cap-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = store(root);
  first.put({
    organizationId: "org-1",
    widgetKey: "player-photo",
    instanceId: "instance-1",
    generation: 2,
    credential: CAPABILITY,
  });

  const raw = fs.readFileSync(first.getStorePath(), "utf8");
  assert.doesNotMatch(raw, new RegExp(CAPABILITY));
  assert.equal(JSON.parse(raw).entries[0].encrypted, true);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(first.getStorePath()).mode & 0o777, 0o600);
  }

  const restarted = store(root);
  assert.equal(
    restarted.get({
      organizationId: "org-1",
      widgetKey: "player-photo",
      instanceId: "instance-1",
      generation: 2,
    }),
    CAPABILITY,
  );
});

test("uses memory only and removes an owned plaintext fallback", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-widget-mem-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const current = store(root, encryption(false));
  const file = current.getStorePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ credential: CAPABILITY }));

  current.put({
    organizationId: "org-1",
    widgetKey: "player-photo",
    instanceId: "instance-1",
    generation: 1,
    credential: CAPABILITY,
  });
  assert.equal(fs.existsSync(file), false);
  assert.equal(
    current.get({
      organizationId: "org-1",
      widgetKey: "player-photo",
      instanceId: "instance-1",
      generation: 1,
    }),
    CAPABILITY,
  );
  assert.equal(
    store(root, encryption(false)).get({
      organizationId: "org-1",
      widgetKey: "player-photo",
      instanceId: "instance-1",
      generation: 1,
    }),
    null,
  );
});

test("refuses to follow a linked credential file", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-widget-link-"));
  const outside = path.join(root, "outside.json");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const current = store(root);
  fs.mkdirSync(path.dirname(current.getStorePath()), { recursive: true });
  fs.writeFileSync(outside, "outside");
  try {
    fs.symlinkSync(outside, current.getStorePath(), "file");
  } catch {
    t.skip("symlink creation is unavailable");
    return;
  }

  assert.throws(
    () =>
      current.put({
        organizationId: "org-1",
        widgetKey: "player-photo",
        instanceId: "instance-1",
        generation: 1,
        credential: CAPABILITY,
      }),
    /Linked widget credential files are refused/,
  );
  assert.equal(fs.readFileSync(outside, "utf8"), "outside");
});

test("a stale catalog read cannot evict or downgrade a newer generation", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-widget-race-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const current = store(root);
  const oldCapability = `wgt_${Buffer.alloc(32, 3).toString("base64url")}`;
  current.put({
    organizationId: "org-1",
    widgetKey: "player-photo",
    instanceId: "instance-1",
    generation: 3,
    credential: CAPABILITY,
  });

  assert.equal(
    current.get({
      organizationId: "org-1",
      widgetKey: "player-photo",
      instanceId: "instance-1",
      generation: 2,
    }),
    null,
  );
  current.put({
    organizationId: "org-1",
    widgetKey: "player-photo",
    instanceId: "instance-1",
    generation: 2,
    credential: oldCapability,
  });
  assert.equal(
    current.get({
      organizationId: "org-1",
      widgetKey: "player-photo",
      instanceId: "instance-1",
      generation: 3,
    }),
    CAPABILITY,
  );
});
