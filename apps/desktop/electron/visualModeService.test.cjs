"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createVisualModeService, normalizeVisualModeConfig } = require("./visualModeService.cjs");

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

    await new Promise((resolve) => setTimeout(resolve, 650));
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
    assert.equal(reviewed.items.find((item) => item.id === capture.item.id).status, "reviewed");

    const ignoredCapture = await service.captureReviewCandidate();
    const ignored = service.ignoreReviewItem(ignoredCapture.item.id);
    assert.equal(ignored.items.find((item) => item.id === ignoredCapture.item.id).status, "ignored");

    const cleared = service.clearReviewQueue();
    assert.equal(cleared.items.length, 0);
    assert.equal(cleared.pendingCount, 0);
  } finally {
    service.stop("test");
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

    const processing = service.markReviewItemOcrProcessing(capture.item.id);
    assert.equal(
      processing.items.find((item) => item.id === capture.item.id).ocrStatus,
      "processing",
    );

    const ready = service.attachReviewItemOcrPreview(capture.item.id, {
      imageUrl: "https://example.com/result.png",
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
    assert.equal(readyItem.imageUrl, "https://example.com/result.png");
  } finally {
    service.stop("test");
    fs.rmSync(captureDir, { recursive: true, force: true });
  }
});
