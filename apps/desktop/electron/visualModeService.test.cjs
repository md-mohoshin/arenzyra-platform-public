"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createVisualModeService,
  normalizeVisualModeConfig,
} = require("./visualModeService.cjs");

function createThumbnail(value) {
  return {
    toPNG() {
      return Buffer.from(String(value));
    },
  };
}

test("normalizes visual mode config into review-only defaults", () => {
  const config = normalizeVisualModeConfig({
    sourceId: "  screen:1  ",
    sourceName: " Main Display ",
    captureFps: 99,
    autoPublish: true,
    ocrEnabled: true,
  });

  assert.equal(config.sourceId, "screen:1");
  assert.equal(config.sourceName, "Main Display");
  assert.equal(config.captureFps, 6);
  assert.deepEqual(config.regions.killFeed, null);
  assert.equal(config.activeRegionKey, "killFeed");
  assert.equal(config.coordinateMode, "percent");
  assert.equal(config.reviewBeforePublish, true);
  assert.equal(config.autoPublish, false);
  assert.equal(config.autoOcrEnabled, false);
  assert.equal(config.stableFrameSamples, 2);
  assert.equal(config.ocrEnabled, false);
  assert.equal(config.aiEnabled, false);
});

test("normalizes visual mode calibration regions as percentages", () => {
  const config = normalizeVisualModeConfig({
    activeRegionKey: "scoreboard",
    regions: {
      scoreboard: {
        x: 95,
        y: -4,
        width: 20,
        height: 110,
      },
    },
  });

  assert.equal(config.activeRegionKey, "scoreboard");
  assert.deepEqual(config.region, {
    x: 95,
    y: 0,
    width: 5,
    height: 100,
  });
  assert.deepEqual(config.regions.scoreboard, config.region);
});

test("visual mode monitors selected source without publishing results", async () => {
  const frames = ["source-list", "a", "b"];
  const desktopCapturer = {
    async getSources() {
      const frame = frames.shift() || "b";
      return [
        {
          id: "screen:1",
          name: "Main Display",
          display_id: "1",
          thumbnail: createThumbnail(frame),
        },
      ];
    },
  };
  let settings = {};
  const service = createVisualModeService({
    desktopCapturer,
    getSettings: () => settings,
    setSettings: (nextSettings) => {
      settings = { ...settings, ...nextSettings };
    },
    now: (() => {
      let tick = 0;
      return () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++));
    })(),
  });

  const sources = await service.listSources();
  assert.deepEqual(sources, [
    { id: "screen:1", name: "Main Display", displayId: "1" },
  ]);

  try {
    const started = await service.start({
      matchId: "match-1",
      config: {
        sourceId: "screen:1",
        sourceName: "Main Display",
        captureFps: 2,
        activeRegionKey: "killFeed",
        regions: {
          killFeed: { x: 65, y: 5, width: 30, height: 25 },
        },
      },
    });

    assert.equal(started.running, true);
    assert.equal(started.matchId, "match-1");
    assert.equal(started.framesSeen, 1);
    assert.equal(started.autoPublish, false);
    assert.equal(started.reviewBeforePublish, true);
    assert.equal(started.calibrationReady, true);

    await new Promise((resolve) => setTimeout(resolve, 1150));
    const status = service.getStatus();
    assert.equal(status.framesSeen >= 2, true);
    assert.equal(status.changesDetected >= 1, true);
    assert.equal(status.reviewQueueSize >= 1, true);

    const queue = service.getReviewQueue();
    assert.equal(queue.pendingCount >= 1, true);
    assert.equal(queue.autoPublish, false);
    assert.equal(queue.items[0].status, "pending");
    assert.equal(queue.items[0].regionKey, "killFeed");
  } finally {
    service.stop("test");
  }

  const stopped = service.stop("test");
  assert.equal(stopped.running, false);
  assert.equal(stopped.connectionStatus, "stopped");
});

test("visual review queue supports manual capture and local review decisions", async () => {
  const desktopCapturer = {
    async getSources() {
      return [
        {
          id: "screen:1",
          name: "Main Display",
          display_id: "1",
          thumbnail: createThumbnail(`frame-${Date.now()}`),
        },
      ];
    },
  };
  const service = createVisualModeService({
    desktopCapturer,
    getSettings: () => ({}),
    setSettings: () => {},
    now: (() => {
      let tick = 0;
      return () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++));
    })(),
  });

  try {
    await service.start({
      matchId: "match-1",
      config: {
        sourceId: "screen:1",
        sourceName: "Main Display",
        activeRegionKey: "scoreboard",
        regions: {
          scoreboard: { x: 20, y: 10, width: 60, height: 70 },
        },
      },
    });

    const capture = await service.captureReviewCandidate();
    assert.equal(capture.item.status, "pending");
    assert.equal(capture.queue.pendingCount >= 1, true);
    assert.equal(capture.status.autoPublish, false);

    const reviewed = service.markReviewItemReviewed(capture.item.id);
    assert.equal(
      reviewed.items.find((item) => item.id === capture.item.id).status,
      "reviewed",
    );

    const ignoredCapture = await service.captureReviewCandidate();
    const ignored = service.ignoreReviewItem(ignoredCapture.item.id);
    assert.equal(
      ignored.items.find((item) => item.id === ignoredCapture.item.id).status,
      "ignored",
    );

    const cleared = service.clearReviewQueue();
    assert.equal(cleared.items.length, 0);
    assert.equal(cleared.pendingCount, 0);
  } finally {
    service.stop("test");
  }
});

test("terminal review decisions delete owned captures while OCR failures preserve them", async () => {
  const captureDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "arenzyra-visual-terminal-"),
  );
  const desktopCapturer = {
    async getSources() {
      return [
        {
          id: "screen:1",
          name: "Main Display",
          display_id: "1",
          thumbnail: createThumbnail(`frame-${Date.now()}`),
        },
      ];
    },
  };
  const service = createVisualModeService({
    desktopCapturer,
    getSettings: () => ({}),
    setSettings: () => {},
    getCaptureDir: () => captureDir,
  });

  try {
    await service.start({
      matchId: "match-1",
      config: {
        sourceId: "screen:1",
        sourceName: "Main Display",
        activeRegionKey: "scoreboard",
        regions: {
          scoreboard: { x: 20, y: 10, width: 60, height: 70 },
        },
      },
    });

    const reviewedCapture = await service.captureReviewCandidate();
    const reviewedPath = reviewedCapture.item.imagePath;
    service.markReviewItemOcrProcessing(reviewedCapture.item.id);
    service.attachReviewItemOcrPreview(reviewedCapture.item.id, {
      preview: {
        matchId: "match-1",
        preview: [
          {
            position: 1,
            tag: "AZR",
            kills: 10,
            status: "OK",
            confidence: 0.95,
          },
        ],
        unresolved: [],
        ambiguous: [],
      },
    });
    const reviewedQueue = service.markReviewItemReviewed(
      reviewedCapture.item.id,
    );
    const reviewedItem = reviewedQueue.items.find(
      (item) => item.id === reviewedCapture.item.id,
    );
    assert.equal(reviewedItem.status, "reviewed");
    assert.equal(reviewedItem.imagePath, null);
    assert.equal(fs.existsSync(reviewedPath), false);

    const ignoredCapture = await service.captureReviewCandidate();
    const ignoredPath = ignoredCapture.item.imagePath;
    const ignoredQueue = service.ignoreReviewItem(ignoredCapture.item.id);
    const ignoredItem = ignoredQueue.items.find(
      (item) => item.id === ignoredCapture.item.id,
    );
    assert.equal(ignoredItem.status, "ignored");
    assert.equal(ignoredItem.imagePath, null);
    assert.equal(fs.existsSync(ignoredPath), false);

    const failedCapture = await service.captureReviewCandidate();
    const failedPath = failedCapture.item.imagePath;
    service.markReviewItemOcrProcessing(failedCapture.item.id);
    const failedQueue = service.markReviewItemOcrFailed(
      failedCapture.item.id,
      "OCR unavailable.",
    );
    const failedItem = failedQueue.items.find(
      (item) => item.id === failedCapture.item.id,
    );
    assert.equal(failedItem.status, "pending");
    assert.equal(failedItem.ocrStatus, "failed");
    assert.equal(failedItem.imagePath, failedPath);
    assert.equal(fs.existsSync(failedPath), true);

    service.stop("test-restart");
    await service.start({
      matchId: "match-2",
      config: {
        sourceId: "screen:1",
        sourceName: "Main Display",
        activeRegionKey: "scoreboard",
        regions: {
          scoreboard: { x: 20, y: 10, width: 60, height: 70 },
        },
      },
    });
    const recoveredItem = service
      .getReviewQueue()
      .items.find((item) => item.id === failedCapture.item.id);
    assert.equal(recoveredItem.ocrStatus, "failed");
    assert.equal(recoveredItem.imagePath, failedPath);
    assert.equal(fs.existsSync(failedPath), true);

    service.clearReviewQueue();
    assert.equal(fs.existsSync(failedPath), false);
  } finally {
    service.stop("test");
    fs.rmSync(captureDir, { recursive: true, force: true });
  }
});

test("visual mode rejects an oversized capture before OCR upload", async () => {
  const captureDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "arenzyra-visual-size-"),
  );
  const desktopCapturer = {
    async getSources() {
      return [
        {
          id: "screen:1",
          name: "Main Display",
          display_id: "1",
          thumbnail: createThumbnail("12345"),
        },
      ];
    },
  };
  const service = createVisualModeService({
    desktopCapturer,
    getSettings: () => ({}),
    setSettings: () => {},
    getCaptureDir: () => captureDir,
    maxCaptureBytes: 4,
  });

  try {
    await service.start({
      matchId: "match-1",
      config: {
        sourceId: "screen:1",
        sourceName: "Main Display",
        activeRegionKey: "scoreboard",
        regions: {
          scoreboard: { x: 20, y: 10, width: 60, height: 70 },
        },
      },
    });

    await assert.rejects(
      () => service.captureReviewCandidate(),
      (error) => error?.code === "ARENZYRA_VISUAL_CAPTURE_TOO_LARGE",
    );
    assert.deepEqual(fs.readdirSync(captureDir), []);
  } finally {
    service.stop("test");
    fs.rmSync(captureDir, { recursive: true, force: true });
  }
});

test("visual review items store capture files and OCR preview state", async () => {
  const captureDir = fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-visual-"));
  const desktopCapturer = {
    async getSources() {
      return [
        {
          id: "screen:1",
          name: "Main Display",
          display_id: "1",
          thumbnail: createThumbnail(`frame-${Date.now()}`),
        },
      ];
    },
  };
  const service = createVisualModeService({
    desktopCapturer,
    getSettings: () => ({}),
    setSettings: () => {},
    getCaptureDir: () => captureDir,
    now: (() => {
      let tick = 0;
      return () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++));
    })(),
  });

  try {
    await service.start({
      matchId: "match-1",
      config: {
        sourceId: "screen:1",
        sourceName: "Main Display",
        activeRegionKey: "scoreboard",
        regions: {
          scoreboard: { x: 20, y: 10, width: 60, height: 70 },
        },
      },
    });

    const capture = await service.captureReviewCandidate();
    assert.equal(Boolean(capture.item.imagePath), true);
    assert.equal(fs.existsSync(capture.item.imagePath), true);
    const capturePath = capture.item.imagePath;

    const processing = service.markReviewItemOcrProcessing(capture.item.id);
    assert.equal(
      processing.items.find((item) => item.id === capture.item.id).ocrStatus,
      "processing",
    );

    const ready = service.attachReviewItemOcrPreview(capture.item.id, {
      assetId: "12345678-1234-4234-9234-123456789abc",
      preview: {
        matchId: "match-1",
        preview: [
          {
            position: 1,
            tag: "AZR",
            kills: 10,
            teamId: "team-1",
            slotId: "slot-1",
            status: "OK",
            confidence: 0.91,
          },
        ],
        unresolved: [],
        ambiguous: [],
        slots: [{ id: "slot-1" }],
      },
    });
    const readyItem = ready.items.find((item) => item.id === capture.item.id);
    assert.equal(readyItem.ocrStatus, "ready");
    assert.equal(readyItem.applyReady, true);
    assert.equal(readyItem.okCount, 1);
    assert.equal(readyItem.imageUrl, null);
    assert.equal(readyItem.assetId, "12345678-1234-4234-9234-123456789abc");

    service.clearReviewQueue();
    assert.equal(fs.existsSync(capturePath), false);
  } finally {
    service.stop("test");
    fs.rmSync(captureDir, { recursive: true, force: true });
  }
});

test("visual mode only schedules automated OCR after a stable frame", async () => {
  const automatedCandidates = [];
  const desktopCapturer = {
    async getSources() {
      return [
        {
          id: "screen:1",
          name: "Main Display",
          display_id: "1",
          thumbnail: createThumbnail("stable-scoreboard"),
        },
      ];
    },
  };
  const service = createVisualModeService({
    desktopCapturer,
    getSettings: () => ({}),
    setSettings: () => {},
    onAutoReviewCandidate: (item) => automatedCandidates.push(item),
  });

  try {
    const started = await service.start({
      matchId: "match-1",
      config: {
        sourceId: "screen:1",
        sourceName: "Main Display",
        captureFps: 6,
        autoOcrEnabled: true,
        activeRegionKey: "scoreboard",
        regions: {
          scoreboard: { x: 20, y: 10, width: 60, height: 70 },
        },
      },
    });

    assert.equal(started.autoOcrEnabled, true);
    assert.equal(started.autoPublish, false);
    assert.equal(automatedCandidates.length, 0);

    await new Promise((resolve) => setTimeout(resolve, 240));
    const queue = service.getReviewQueue();
    assert.equal(queue.items.length, 1);
    assert.equal(queue.items[0].reason, "stable-frame");
    assert.equal(automatedCandidates.length, 1);
    assert.equal(automatedCandidates[0].applyReady, false);
  } finally {
    service.stop("test");
  }
});

test("roster capture uses a high-resolution source and remains slot-map only", async () => {
  const thumbnailSizes = [];
  const automatedCandidates = [];
  const desktopCapturer = {
    async getSources(options) {
      thumbnailSizes.push(options.thumbnailSize);
      return [
        {
          id: "screen:1",
          name: "Main Display",
          display_id: "1",
          thumbnail: createThumbnail("roster-page-1"),
        },
      ];
    },
  };
  const service = createVisualModeService({
    desktopCapturer,
    getSettings: () => ({}),
    setSettings: () => {},
    onAutoReviewCandidate: (item) => automatedCandidates.push(item),
  });

  try {
    await service.start({
      matchId: "match-1",
      config: {
        sourceId: "screen:1",
        sourceName: "Main Display",
        captureFps: 1,
        autoOcrEnabled: true,
        activeRegionKey: "roster",
        regions: {
          roster: { x: 8, y: 15, width: 84, height: 78 },
        },
      },
    });

    const capture = await service.captureReviewCandidate();
    assert.equal(capture.item.reviewKind, "slot-map");
    assert.equal(automatedCandidates.length, 0);
    assert.equal(
      thumbnailSizes.some(
        (size) => size?.width === 1920 && size?.height === 1080,
      ),
      true,
    );

    service.markReviewItemSlotMapProcessing(capture.item.id);
    const queue = service.attachReviewItemSlotMapPreview(capture.item.id, {
      assetId: "22345678-1234-4234-9234-123456789abc",
      preview: {
        matchId: "match-1",
        ocrMode: "AI",
        preview: [
          {
            slotNumber: 16,
            tag: "LITE",
            playerNames: ["liteMeowziee", "liteGOLDY"],
            teamId: "team-16",
            slotId: "slot-16",
            status: "OK",
            confidence: 0.98,
          },
        ],
        mapped: [],
        unresolved: [],
        ambiguous: [],
      },
    });
    const item = queue.items.find((entry) => entry.id === capture.item.id);
    assert.equal(item.reviewKind, "slot-map");
    assert.equal(item.ocrStatus, "ready");
    assert.equal(item.okCount, 1);
    assert.equal(item.applyReady, false);
    assert.equal(item.imageUrl, null);
    assert.equal(item.assetId, "22345678-1234-4234-9234-123456789abc");
  } finally {
    service.stop("test");
  }
});
