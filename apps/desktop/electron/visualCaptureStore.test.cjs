"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createVisualCaptureStore,
} = require("./visualCaptureStore.cjs");

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-capture-store-"));
}

function createStore(rootPath, options = {}) {
  return createVisualCaptureStore({
    getCaptureDir: () => path.join(rootPath, "visual-captures"),
    ...options,
  });
}

function setModifiedAt(filePath, timestampMs) {
  const timestamp = new Date(timestampMs);
  fs.utimesSync(filePath, timestamp, timestamp);
}

test("startup cleanup removes a stale app-owned crash orphan", () => {
  const rootPath = createTempRoot();
  const timestampMs = Date.now() + 48 * 60 * 60 * 1000;
  const store = createStore(rootPath, {
    now: () => new Date(timestampMs),
    orphanRetentionMs: 24 * 60 * 60 * 1000,
  });

  try {
    const orphanPath = store.save(randomUUID(), "scoreboard", Buffer.from("old"));
    setModifiedAt(orphanPath, timestampMs - 25 * 60 * 60 * 1000);

    const summary = store.cleanup({ force: true });

    assert.equal(summary.removed, 1);
    assert.equal(fs.existsSync(orphanPath), false);
  } finally {
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

test("orphan cleanup preserves recent app-owned captures", () => {
  const rootPath = createTempRoot();
  const timestampMs = Date.now() + 48 * 60 * 60 * 1000;
  const store = createStore(rootPath, {
    now: () => new Date(timestampMs),
    orphanRetentionMs: 24 * 60 * 60 * 1000,
  });

  try {
    const recentPath = store.save(randomUUID(), "roster", Buffer.from("recent"));
    setModifiedAt(recentPath, timestampMs - 60 * 60 * 1000);

    const summary = store.cleanup({ force: true });

    assert.equal(summary.removed, 0);
    assert.equal(summary.preserved, 1);
    assert.equal(fs.existsSync(recentPath), true);
  } finally {
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

test("capture removal refuses outside paths and linked capture entries", (t) => {
  const rootPath = createTempRoot();
  const captureDir = path.join(rootPath, "visual-captures");
  const store = createStore(rootPath);

  try {
    const seedPath = store.save(randomUUID(), "scoreboard", Buffer.from("seed"));
    assert.equal(fs.existsSync(seedPath), true);

    const outsidePath = path.join(
      rootPath,
      `${randomUUID()}-scoreboard.png`,
    );
    fs.writeFileSync(outsidePath, "outside");
    const outsideResult = store.remove(outsidePath);
    assert.equal(outsideResult.refused, true);
    assert.equal(fs.existsSync(outsidePath), true);

    const linkedPath = path.join(
      captureDir,
      `${randomUUID()}-scoreboard.png`,
    );
    try {
      fs.symlinkSync(outsidePath, linkedPath, "file");
    } catch (error) {
      if (error?.code === "EPERM" || error?.code === "EACCES") {
        t.diagnostic("File symlink creation is unavailable in this environment.");
        return;
      }
      throw error;
    }

    const linkedResult = store.remove(linkedPath);
    assert.equal(linkedResult.refused, true);
    assert.equal(fs.lstatSync(linkedPath).isSymbolicLink(), true);
    assert.equal(fs.existsSync(outsidePath), true);
  } finally {
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

test("orphan cleanup never scans beyond its configured per-run cap", () => {
  const rootPath = createTempRoot();
  const timestampMs = Date.now() + 48 * 60 * 60 * 1000;
  const store = createStore(rootPath, {
    now: () => new Date(timestampMs),
    orphanRetentionMs: 24 * 60 * 60 * 1000,
    cleanupScanLimit: 2,
  });

  try {
    const paths = Array.from({ length: 5 }, () =>
      store.save(randomUUID(), "scoreboard", Buffer.from("old")),
    );
    for (const filePath of paths) {
      setModifiedAt(filePath, timestampMs - 25 * 60 * 60 * 1000);
    }

    const summary = store.cleanup({ force: true });
    const remaining = paths.filter((filePath) => fs.existsSync(filePath));

    assert.equal(summary.scanned, 2);
    assert.equal(summary.limitReached, true);
    assert.equal(summary.removed, 2);
    assert.equal(remaining.length, 3);
  } finally {
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

test("oversized captures are rejected both at creation and before upload", () => {
  const rootPath = createTempRoot();
  const store = createStore(rootPath, { maxCaptureBytes: 4 });

  try {
    assert.throws(
      () => store.save(randomUUID(), "scoreboard", Buffer.alloc(5)),
      (error) => error?.code === "ARENZYRA_VISUAL_CAPTURE_TOO_LARGE",
    );

    const capturePath = store.save(
      randomUUID(),
      "scoreboard",
      Buffer.alloc(4),
    );
    fs.writeFileSync(capturePath, Buffer.alloc(5));

    assert.throws(
      () => store.assertReady(capturePath),
      (error) => error?.code === "ARENZYRA_VISUAL_CAPTURE_TOO_LARGE",
    );
    assert.equal(fs.existsSync(capturePath), true);
  } finally {
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});
