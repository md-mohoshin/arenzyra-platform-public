"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { createVisualCaptureStore } = require("./visualCaptureStore.cjs");

const DEFAULT_CAPTURE_FPS = 2;
const MIN_CAPTURE_FPS = 1;
const MAX_CAPTURE_FPS = 6;
const SOURCE_LIST_THUMBNAIL_SIZE = Object.freeze({ width: 320, height: 180 });
const CAPTURE_THUMBNAIL_SIZE = Object.freeze({ width: 1280, height: 720 });
const ROSTER_CAPTURE_THUMBNAIL_SIZE = Object.freeze({
  width: 1920,
  height: 1080,
});
const VISUAL_REGION_KEYS = Object.freeze([
  "killFeed",
  "teamPanel",
  "scoreboard",
  "roster",
]);
const DEFAULT_VISUAL_REGION_KEY = "killFeed";
const VISUAL_GAME_PRESET_KEYS = Object.freeze([
  "pubgMobile",
  "freeFire",
  "valorant",
  "codMobile",
]);
const DEFAULT_VISUAL_GAME_PRESET_KEY = "pubgMobile";
const REVIEW_QUEUE_MAX_ITEMS = 20;
const REVIEW_QUEUE_MIN_INTERVAL_MS = 2500;
const DEFAULT_STABLE_FRAME_SAMPLES = 2;
const MIN_STABLE_FRAME_SAMPLES = 2;
const MAX_STABLE_FRAME_SAMPLES = 4;

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function normalizeString(value) {
  const trimmed = String(value || "").trim();
  return trimmed || null;
}

function clampRegionNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function roundRegionNumber(value) {
  return Math.round(value * 100) / 100;
}

function normalizeRegion(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const x = Number(value.x);
  const y = Number(value.y);
  const width = Number(value.width);
  const height = Number(value.height);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  const normalizedX = clampRegionNumber(x, 0, 99, 0);
  const normalizedY = clampRegionNumber(y, 0, 99, 0);

  return {
    x: roundRegionNumber(normalizedX),
    y: roundRegionNumber(normalizedY),
    width: roundRegionNumber(
      clampRegionNumber(width, 1, Math.max(1, 100 - normalizedX), 1),
    ),
    height: roundRegionNumber(
      clampRegionNumber(height, 1, Math.max(1, 100 - normalizedY), 1),
    ),
  };
}

function cloneRegion(region) {
  return region
    ? {
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
      }
    : null;
}

function createEmptyRegions() {
  return {
    killFeed: null,
    teamPanel: null,
    scoreboard: null,
    roster: null,
  };
}

function normalizeRegionKey(value) {
  const normalized = String(value || "").trim();
  return VISUAL_REGION_KEYS.includes(normalized)
    ? normalized
    : DEFAULT_VISUAL_REGION_KEY;
}

function normalizeGamePresetKey(value) {
  const normalized = String(value || "").trim();
  return VISUAL_GAME_PRESET_KEYS.includes(normalized)
    ? normalized
    : DEFAULT_VISUAL_GAME_PRESET_KEY;
}

function normalizeRegions(value, fallbackRegion) {
  const regions = createEmptyRegions();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of VISUAL_REGION_KEYS) {
      regions[key] = normalizeRegion(value[key]);
    }
  }

  const legacyRegion = normalizeRegion(fallbackRegion);
  if (!regions[DEFAULT_VISUAL_REGION_KEY] && legacyRegion) {
    regions[DEFAULT_VISUAL_REGION_KEY] = legacyRegion;
  }

  return regions;
}

function cloneRegions(regions) {
  const next = createEmptyRegions();
  for (const key of VISUAL_REGION_KEYS) {
    next[key] = cloneRegion(regions?.[key]);
  }
  return next;
}

function getActiveRegion(config) {
  const activeRegionKey = normalizeRegionKey(config?.activeRegionKey);
  return cloneRegion(config?.regions?.[activeRegionKey] || config?.region);
}

function cloneVisualModeConfig(value) {
  const activeRegionKey = normalizeRegionKey(value?.activeRegionKey);
  const gamePresetKey = normalizeGamePresetKey(value?.gamePresetKey);
  const regions = cloneRegions(value?.regions);
  const region = cloneRegion(regions[activeRegionKey] || value?.region);
  return {
    gamePresetKey,
    sourceId: normalizeString(value?.sourceId),
    sourceName: normalizeString(value?.sourceName),
    captureFps: clampNumber(
      value?.captureFps,
      MIN_CAPTURE_FPS,
      MAX_CAPTURE_FPS,
      DEFAULT_CAPTURE_FPS,
    ),
    region,
    regions,
    activeRegionKey,
    coordinateMode: "percent",
    reviewBeforePublish: true,
    autoPublish: false,
    autoOcrEnabled: value?.autoOcrEnabled === true,
    stableFrameSamples: clampNumber(
      value?.stableFrameSamples,
      MIN_STABLE_FRAME_SAMPLES,
      MAX_STABLE_FRAME_SAMPLES,
      DEFAULT_STABLE_FRAME_SAMPLES,
    ),
    ocrEnabled: false,
    aiEnabled: false,
  };
}

function normalizeVisualModeConfig(value = {}) {
  const input =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const activeRegionKey = normalizeRegionKey(input.activeRegionKey);
  const gamePresetKey = normalizeGamePresetKey(input.gamePresetKey);
  const regions = normalizeRegions(input.regions, input.region);
  const activeRegion = cloneRegion(
    regions[activeRegionKey] || normalizeRegion(input.region),
  );
  if (activeRegion && !regions[activeRegionKey]) {
    regions[activeRegionKey] = cloneRegion(activeRegion);
  }

  return {
    gamePresetKey,
    sourceId: normalizeString(input.sourceId),
    sourceName: normalizeString(input.sourceName),
    captureFps: clampNumber(
      input.captureFps,
      MIN_CAPTURE_FPS,
      MAX_CAPTURE_FPS,
      DEFAULT_CAPTURE_FPS,
    ),
    region: activeRegion,
    regions,
    activeRegionKey,
    coordinateMode: "percent",
    reviewBeforePublish: true,
    autoPublish: false,
    autoOcrEnabled: input.autoOcrEnabled === true,
    stableFrameSamples: clampNumber(
      input.stableFrameSamples,
      MIN_STABLE_FRAME_SAMPLES,
      MAX_STABLE_FRAME_SAMPLES,
      DEFAULT_STABLE_FRAME_SAMPLES,
    ),
    ocrEnabled: false,
    aiEnabled: false,
  };
}

function createDefaultStatus() {
  return {
    available: false,
    running: false,
    matchId: null,
    sessionId: null,
    gamePresetKey: DEFAULT_VISUAL_GAME_PRESET_KEY,
    sourceId: null,
    sourceName: null,
    captureFps: DEFAULT_CAPTURE_FPS,
    region: null,
    regions: createEmptyRegions(),
    activeRegionKey: DEFAULT_VISUAL_REGION_KEY,
    coordinateMode: "percent",
    calibrationReady: false,
    reviewBeforePublish: true,
    autoPublish: false,
    autoOcrEnabled: false,
    stableFrameSamples: DEFAULT_STABLE_FRAME_SAMPLES,
    stableFrameCount: 0,
    ocrEnabled: false,
    aiEnabled: false,
    connectionStatus: "stopped",
    framesSeen: 0,
    changesDetected: 0,
    lastFrameAt: null,
    lastChangeAt: null,
    lastError: null,
    startedAt: null,
    stoppedAt: null,
    pipeline: "screen-monitor",
    reviewQueueSize: 0,
    lastReviewCandidateAt: null,
  };
}

function toIsoTimestamp(date = new Date()) {
  return date instanceof Date && Number.isFinite(date.getTime())
    ? date.toISOString()
    : new Date().toISOString();
}

function sourceToView(source) {
  return {
    id: String(source?.id || "").trim(),
    name: String(source?.name || "").trim() || "Unnamed source",
    displayId: normalizeString(source?.display_id || source?.displayId),
  };
}

function hashBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return null;
  }
  return createHash("sha256").update(buffer).digest("hex");
}

function getThumbnailSize(thumbnail) {
  if (!thumbnail || typeof thumbnail.getSize !== "function") {
    return null;
  }
  try {
    const size = thumbnail.getSize();
    const width = Number(size?.width);
    const height = Number(size?.height);
    if (
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    ) {
      return { width, height };
    }
  } catch {
    return null;
  }
  return null;
}

function regionToRect(region, size) {
  if (!region || !size) {
    return null;
  }
  const x = Math.max(0, Math.floor((region.x / 100) * size.width));
  const y = Math.max(0, Math.floor((region.y / 100) * size.height));
  const maxWidth = Math.max(1, size.width - x);
  const maxHeight = Math.max(1, size.height - y);
  return {
    x,
    y,
    width: Math.max(
      1,
      Math.min(maxWidth, Math.ceil((region.width / 100) * size.width)),
    ),
    height: Math.max(
      1,
      Math.min(maxHeight, Math.ceil((region.height / 100) * size.height)),
    ),
  };
}

function thumbnailToPngBuffer(source, region) {
  const thumbnail = source?.thumbnail;
  if (!thumbnail || typeof thumbnail.toPNG !== "function") {
    return null;
  }

  let image = thumbnail;
  const size = getThumbnailSize(thumbnail);
  const cropRect = regionToRect(region, size);
  if (cropRect && typeof thumbnail.crop === "function") {
    try {
      const cropped = thumbnail.crop(cropRect);
      if (cropped && typeof cropped.toPNG === "function") {
        image = cropped;
      }
    } catch {
      image = thumbnail;
    }
  }

  const buffer = image.toPNG();
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return null;
  }

  return buffer;
}

function cloneReviewItem(item) {
  return {
    ...item,
    region: cloneRegion(item.region),
    rows: Array.isArray(item.rows) ? item.rows.map((row) => ({ ...row })) : [],
    warnings: Array.isArray(item.warnings) ? [...item.warnings] : [],
    ocrPreview:
      item.ocrPreview && typeof item.ocrPreview === "object"
        ? { ...item.ocrPreview }
        : null,
  };
}

function createVisualModeService(options = {}) {
  const desktopCapturer = options.desktopCapturer || null;
  const logger = options.logger || {};
  const getSettings =
    typeof options.getSettings === "function"
      ? options.getSettings
      : () => ({});
  const setSettings =
    typeof options.setSettings === "function" ? options.setSettings : () => {};
  const getCaptureDir =
    typeof options.getCaptureDir === "function" ? options.getCaptureDir : null;
  const now =
    typeof options.now === "function" ? options.now : () => new Date();
  const onAutoReviewCandidate =
    typeof options.onAutoReviewCandidate === "function"
      ? options.onAutoReviewCandidate
      : null;
  const captureStore = createVisualCaptureStore({
    getCaptureDir,
    logger,
    now,
    maxCaptureBytes: options.maxCaptureBytes,
    orphanRetentionMs: options.orphanRetentionMs,
    cleanupScanLimit: options.cleanupScanLimit,
    cleanupIntervalMs: options.cleanupIntervalMs,
  });

  let config = normalizeVisualModeConfig(getSettings()?.visualMode);
  let status = {
    ...createDefaultStatus(),
    available:
      desktopCapturer && typeof desktopCapturer.getSources === "function",
    ...config,
  };
  let captureTimer = null;
  let lastFrameHash = null;
  let lastQueuedFrameHash = null;
  let stableFrameCount = 0;
  let lastReviewCandidateAtMs = 0;
  let reviewQueue = [];
  let tickInFlight = false;

  function logInfo(message, meta) {
    if (typeof logger.info === "function") {
      logger.info(message, meta);
    }
  }

  function logWarn(message, meta) {
    if (typeof logger.warn === "function") {
      logger.warn(message, meta);
    }
  }

  function readConfig() {
    config = normalizeVisualModeConfig({
      ...config,
      ...(getSettings()?.visualMode || {}),
    });
    return cloneVisualModeConfig(config);
  }

  function persistConfig(nextConfig) {
    config = normalizeVisualModeConfig({
      ...readConfig(),
      ...nextConfig,
    });
    setSettings({ visualMode: config });
    status = {
      ...status,
      ...config,
      sourceId: config.sourceId,
      sourceName: config.sourceName,
      gamePresetKey: config.gamePresetKey,
      captureFps: config.captureFps,
      region: config.region,
      regions: cloneRegions(config.regions),
      activeRegionKey: config.activeRegionKey,
      coordinateMode: "percent",
      calibrationReady: Boolean(getActiveRegion(config)),
      autoOcrEnabled: config.autoOcrEnabled,
      stableFrameSamples: config.stableFrameSamples,
    };
    return readConfig();
  }

  function getPendingReviewCount() {
    return reviewQueue.filter((item) => item.status === "pending").length;
  }

  function getNowDate() {
    const candidate = now();
    if (candidate instanceof Date && Number.isFinite(candidate.getTime())) {
      return candidate;
    }
    const parsed = new Date(candidate);
    return Number.isFinite(parsed.getTime()) ? parsed : new Date();
  }

  function updateReviewStatusMeta(
    lastReviewCandidateAt = status.lastReviewCandidateAt,
  ) {
    status = {
      ...status,
      reviewQueueSize: getPendingReviewCount(),
      lastReviewCandidateAt,
    };
  }

  function getStatus() {
    const latestConfig = readConfig();
    const activeRegion = getActiveRegion(latestConfig);
    return {
      ...status,
      available:
        desktopCapturer && typeof desktopCapturer.getSources === "function",
      sourceId: latestConfig.sourceId,
      sourceName: latestConfig.sourceName,
      gamePresetKey: latestConfig.gamePresetKey,
      captureFps: latestConfig.captureFps,
      region: activeRegion,
      regions: cloneRegions(latestConfig.regions),
      activeRegionKey: latestConfig.activeRegionKey,
      coordinateMode: "percent",
      calibrationReady: Boolean(activeRegion),
      reviewBeforePublish: true,
      autoPublish: false,
      autoOcrEnabled: latestConfig.autoOcrEnabled,
      stableFrameSamples: latestConfig.stableFrameSamples,
      stableFrameCount,
      ocrEnabled: false,
      aiEnabled: false,
      reviewQueueSize: getPendingReviewCount(),
    };
  }

  async function listSources() {
    if (!desktopCapturer || typeof desktopCapturer.getSources !== "function") {
      throw new Error("Visual Mode source discovery is unavailable.");
    }

    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: SOURCE_LIST_THUMBNAIL_SIZE,
      fetchWindowIcons: false,
    });

    return (Array.isArray(sources) ? sources : [])
      .map(sourceToView)
      .filter((source) => source.id);
  }

  function saveCaptureFile(itemId, regionKey, buffer) {
    cleanupOrphanedCaptures();
    return captureStore.save(itemId, regionKey, buffer);
  }

  function removeCaptureFile(filePath) {
    if (!filePath) {
      return { removed: false, missing: true, refused: false, code: null };
    }
    const result = captureStore.remove(filePath);
    if (result.refused) {
      logWarn("visual-mode-capture-cleanup-refused", {
        code: result.code || "ARENZYRA_VISUAL_CAPTURE_PATH_REFUSED",
      });
    }
    return result;
  }

  function removeCaptureFiles(items) {
    for (const item of Array.isArray(items) ? items : []) {
      removeCaptureFile(item?.imagePath);
    }
  }

  function cleanupOrphanedCaptures(options = {}) {
    const protectedPaths = reviewQueue
      .map((item) => item?.imagePath)
      .filter(Boolean);
    const summary = captureStore.cleanup({
      force: options.force === true,
      protectedPaths,
    });
    if (summary.removed > 0 || summary.errors > 0 || summary.refused > 0) {
      logInfo("visual-mode-orphan-cleanup-complete", {
        scanned: summary.scanned,
        removed: summary.removed,
        preserved: summary.preserved,
        refused: summary.refused,
        errors: summary.errors,
        limitReached: summary.limitReached,
      });
    }
    return summary;
  }

  function enqueueReviewCandidate({
    activeConfig,
    selectedSource,
    frameHash,
    frameBuffer,
    timestamp,
    timestampMs,
    reason,
    force = false,
  }) {
    const region = getActiveRegion(activeConfig);
    if (!region) {
      if (force) {
        throw new Error(
          "Set a Visual Mode calibration region before capturing OCR review.",
        );
      }
      return null;
    }

    if (
      !force &&
      lastReviewCandidateAtMs &&
      timestampMs - lastReviewCandidateAtMs < REVIEW_QUEUE_MIN_INTERVAL_MS
    ) {
      return null;
    }

    const sourceView = sourceToView(selectedSource);
    const id = randomUUID();
    const imagePath = saveCaptureFile(
      id,
      activeConfig.activeRegionKey,
      frameBuffer,
    );
    const item = {
      id,
      matchId: status.matchId,
      sessionId: status.sessionId,
      gamePresetKey: activeConfig.gamePresetKey,
      reviewKind:
        activeConfig.activeRegionKey === "roster" ? "slot-map" : "results",
      sourceId: activeConfig.sourceId,
      sourceName: activeConfig.sourceName || sourceView.name,
      regionKey: activeConfig.activeRegionKey,
      region,
      capturedAt: timestamp,
      status: "pending",
      confidence: 0,
      rawText: "",
      rows: [],
      warnings: [
        activeConfig.activeRegionKey === "roster"
          ? "Use Map roster during READY or COUNTDOWN. Slot/player mapping is blocked once the match is LIVE."
          : activeConfig.autoOcrEnabled
            ? "Automated OCR preview is queued. Review every row before applying results in Match Control."
            : "Run OCR preview, then review every row before applying results in Match Control.",
      ],
      reason: reason || "stable-frame",
      frameHash,
      imagePath,
      imageUrl: null,
      assetId: null,
      ocrStatus: "not_started",
      ocrError: null,
      ocrPreview: null,
      okCount: 0,
      unresolvedCount: 0,
      ambiguousCount: 0,
      applyReady: false,
    };

    const nextQueue = [
      item,
      ...reviewQueue.filter((candidate) => candidate.id !== item.id),
    ].slice(0, REVIEW_QUEUE_MAX_ITEMS);
    const retainedIds = new Set(nextQueue.map((candidate) => candidate.id));
    removeCaptureFiles(
      reviewQueue.filter((candidate) => !retainedIds.has(candidate.id)),
    );
    reviewQueue = nextQueue;
    lastQueuedFrameHash = frameHash;
    lastReviewCandidateAtMs = timestampMs;
    updateReviewStatusMeta(timestamp);
    const candidate = cloneReviewItem(item);
    if (
      activeConfig.activeRegionKey !== "roster" &&
      activeConfig.autoOcrEnabled &&
      onAutoReviewCandidate
    ) {
      try {
        Promise.resolve(onAutoReviewCandidate(candidate)).catch((error) => {
          logWarn("visual-mode-auto-ocr-schedule-failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      } catch (error) {
        logWarn("visual-mode-auto-ocr-schedule-failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return candidate;
  }

  async function sampleSelectedSource(options = {}) {
    const activeConfig = readConfig();
    if (!activeConfig.sourceId) {
      throw new Error(
        "Select a screen or window source before starting Visual Mode.",
      );
    }

    const activeRegion = getActiveRegion(activeConfig);
    const thumbnailSize =
      activeConfig.activeRegionKey === "roster"
        ? ROSTER_CAPTURE_THUMBNAIL_SIZE
        : CAPTURE_THUMBNAIL_SIZE;
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize,
      fetchWindowIcons: false,
    });
    const selectedSource = (Array.isArray(sources) ? sources : []).find(
      (source) => String(source?.id || "") === activeConfig.sourceId,
    );

    if (!selectedSource) {
      throw new Error("Selected Visual Mode source is no longer available.");
    }

    const frameBuffer = thumbnailToPngBuffer(selectedSource, activeRegion);
    const frameHash = hashBuffer(frameBuffer);
    if (!frameHash) {
      throw new Error("Selected Visual Mode source did not return a frame.");
    }

    const currentTime = getNowDate();
    const timestamp = toIsoTimestamp(currentTime);
    const timestampMs = currentTime.getTime();
    const changed = lastFrameHash !== null && frameHash !== lastFrameHash;
    stableFrameCount = frameHash === lastFrameHash ? stableFrameCount + 1 : 1;
    lastFrameHash = frameHash;
    status = {
      ...status,
      sourceName: activeConfig.sourceName || sourceToView(selectedSource).name,
      connectionStatus: "monitoring",
      framesSeen: status.framesSeen + 1,
      changesDetected: changed
        ? status.changesDetected + 1
        : status.changesDetected,
      lastFrameAt: timestamp,
      lastChangeAt: changed ? timestamp : status.lastChangeAt,
      lastError: null,
      stableFrameCount,
    };
    const stableFrameReady =
      stableFrameCount >= activeConfig.stableFrameSamples &&
      frameHash !== lastQueuedFrameHash;
    if (stableFrameReady || options.forceReviewCandidate === true) {
      return enqueueReviewCandidate({
        activeConfig,
        selectedSource,
        frameHash,
        frameBuffer,
        timestamp,
        timestampMs,
        reason: options.forceReviewCandidate
          ? "manual-capture"
          : "stable-frame",
        force: options.forceReviewCandidate === true,
      });
    }

    updateReviewStatusMeta();
    return null;
  }

  async function tick() {
    if (!status.running || tickInFlight) {
      return;
    }

    tickInFlight = true;
    try {
      await sampleSelectedSource();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error || "Visual Mode failed.");
      status = {
        ...status,
        connectionStatus: "source-missing",
        lastError: message,
      };
      logWarn("visual-mode-sample-failed", { error: message });
    } finally {
      tickInFlight = false;
    }
  }

  function scheduleCapture() {
    if (captureTimer) {
      clearInterval(captureTimer);
      captureTimer = null;
    }

    const intervalMs = Math.max(
      1000 /
        clampNumber(
          config.captureFps,
          MIN_CAPTURE_FPS,
          MAX_CAPTURE_FPS,
          DEFAULT_CAPTURE_FPS,
        ),
      1000 / MAX_CAPTURE_FPS,
    );
    captureTimer = setInterval(() => {
      void tick();
    }, intervalMs);
  }

  async function start(payload = {}) {
    if (!desktopCapturer || typeof desktopCapturer.getSources !== "function") {
      throw new Error("Visual Mode is unavailable in this launcher runtime.");
    }

    const nextConfig = persistConfig(payload.config || payload);
    const matchId = normalizeString(payload.matchId);
    if (!matchId) {
      throw new Error("matchId is required.");
    }
    if (!nextConfig.sourceId) {
      throw new Error(
        "Select a screen or window source before starting Visual Mode.",
      );
    }

    if (
      status.running &&
      status.matchId === matchId &&
      status.sourceId === nextConfig.sourceId
    ) {
      return { ...getStatus(), alreadyRunning: true };
    }

    stop("restart");
    const timestamp = toIsoTimestamp(now());
    lastFrameHash = null;
    lastQueuedFrameHash = null;
    stableFrameCount = 0;
    lastReviewCandidateAtMs = 0;
    // A Visual Mode restart is not an explicit review decision. Keep pending
    // and failed evidence available; terminal items have already had their
    // owned files removed and can be dropped from the in-memory queue.
    reviewQueue = reviewQueue.filter((item) => item.status === "pending");
    status = {
      ...createDefaultStatus(),
      available: true,
      ...nextConfig,
      running: true,
      matchId,
      sessionId: randomUUID(),
      connectionStatus: "monitoring",
      startedAt: timestamp,
      stoppedAt: null,
      lastError: null,
    };
    scheduleCapture();
    await tick();
    logInfo("visual-mode-started", {
      matchId,
      sourceId: nextConfig.sourceId,
      captureFps: nextConfig.captureFps,
    });

    return { ...getStatus(), alreadyRunning: false };
  }

  function stop(reason = "stopped") {
    if (captureTimer) {
      clearInterval(captureTimer);
      captureTimer = null;
    }

    if (status.running) {
      logInfo("visual-mode-stopped", {
        matchId: status.matchId,
        reason,
        framesSeen: status.framesSeen,
        changesDetected: status.changesDetected,
      });
    }

    lastFrameHash = null;
    lastQueuedFrameHash = null;
    stableFrameCount = 0;
    status = {
      ...status,
      running: false,
      matchId: null,
      sessionId: null,
      connectionStatus:
        reason === "source-missing" ? "source-missing" : "stopped",
      stoppedAt: toIsoTimestamp(now()),
      stableFrameCount: 0,
    };

    return getStatus();
  }

  function getReviewQueue() {
    return {
      items: reviewQueue.map(cloneReviewItem),
      pendingCount: getPendingReviewCount(),
      maxItems: REVIEW_QUEUE_MAX_ITEMS,
      reviewBeforePublish: true,
      autoPublish: false,
    };
  }

  function clearReviewQueue() {
    removeCaptureFiles(reviewQueue);
    reviewQueue = [];
    updateReviewStatusMeta(null);
    return getReviewQueue();
  }

  function updateReviewItemStatus(id, nextStatus) {
    const normalizedId = normalizeString(id);
    if (!normalizedId) {
      throw new Error("Review item id is required.");
    }

    let matched = false;
    const reviewedAt = toIsoTimestamp(getNowDate());
    reviewQueue = reviewQueue.map((item) => {
      if (item.id !== normalizedId) {
        return item;
      }
      matched = true;
      const cleanup = removeCaptureFile(item.imagePath);
      return {
        ...item,
        status: nextStatus,
        reviewedAt,
        imagePath: cleanup.removed || cleanup.missing ? null : item.imagePath,
        imageUrl: null,
      };
    });

    if (!matched) {
      throw new Error("Review item was not found.");
    }

    updateReviewStatusMeta();
    return getReviewQueue();
  }

  function getReviewItem(id) {
    const normalizedId = normalizeString(id);
    if (!normalizedId) {
      throw new Error("Review item id is required.");
    }
    const item = reviewQueue.find((candidate) => candidate.id === normalizedId);
    if (!item) {
      throw new Error("Review item was not found.");
    }
    return cloneReviewItem(item);
  }

  function assertReviewItemCaptureReady(id) {
    const item = getReviewItem(id);
    if (!item.imagePath) {
      throw new Error("Capture an image before running OCR preview.");
    }
    return captureStore.assertReady(item.imagePath);
  }

  function updateReviewItem(id, updater) {
    const normalizedId = normalizeString(id);
    if (!normalizedId) {
      throw new Error("Review item id is required.");
    }

    let matched = false;
    reviewQueue = reviewQueue.map((item) => {
      if (item.id !== normalizedId) {
        return item;
      }
      matched = true;
      return updater(item);
    });

    if (!matched) {
      throw new Error("Review item was not found.");
    }

    updateReviewStatusMeta();
    return getReviewQueue();
  }

  function markReviewItemOcrProcessing(id) {
    return updateReviewItem(id, (item) => ({
      ...item,
      ocrStatus: "processing",
      ocrError: null,
      warnings: [
        "OCR preview is processing. Review is still required before apply.",
      ],
    }));
  }

  function markReviewItemSlotMapProcessing(id) {
    return updateReviewItem(id, (item) => ({
      ...item,
      reviewKind: "slot-map",
      ocrStatus: "processing",
      ocrError: null,
      warnings: [
        "Slot/player mapping is processing. Do not enter LIVE until unresolved slots are checked.",
      ],
    }));
  }

  function attachReviewItemOcrPreview(id, payload = {}) {
    const previewPayload =
      payload?.preview && typeof payload.preview === "object"
        ? payload.preview
        : {};
    const rows = Array.isArray(previewPayload.preview)
      ? previewPayload.preview.map((row) => ({ ...row }))
      : [];
    const unresolvedCount = Array.isArray(previewPayload.unresolved)
      ? previewPayload.unresolved.length
      : rows.filter((row) => row.status === "UNRESOLVED").length;
    const ambiguousCount = Array.isArray(previewPayload.ambiguous)
      ? previewPayload.ambiguous.length
      : rows.filter((row) => row.status === "AMBIGUOUS").length;
    const okCount = rows.filter((row) => row.status === "OK").length;
    const confidenceValues = rows
      .map((row) => Number(row.confidence))
      .filter((value) => Number.isFinite(value));
    const confidence = confidenceValues.length
      ? confidenceValues.reduce((sum, value) => sum + value, 0) /
        confidenceValues.length
      : 0;
    const applyReady = rows.length > 0 && okCount === rows.length;
    const warnings = [];
    if (!rows.length) {
      warnings.push("OCR preview did not return result rows for this capture.");
    }
    if (unresolvedCount > 0) {
      warnings.push(`${unresolvedCount} OCR row needs team/slot review.`);
    }
    if (ambiguousCount > 0) {
      warnings.push(`${ambiguousCount} OCR row has multiple possible teams.`);
    }
    if (applyReady) {
      warnings.push(
        "OCR rows resolved. Open Match Control before applying final results.",
      );
    }

    return updateReviewItem(id, (item) => ({
      ...item,
      rows,
      warnings,
      confidence,
      imageUrl: null,
      assetId: normalizeString(payload?.assetId) || item.assetId || null,
      ocrStatus: applyReady ? "ready" : "needs_review",
      ocrError: null,
      ocrPreview: {
        matchId: previewPayload.matchId || item.matchId,
        sessionId: previewPayload.sessionId || null,
        slotsCount: Array.isArray(previewPayload.slots)
          ? previewPayload.slots.length
          : 0,
      },
      okCount,
      unresolvedCount,
      ambiguousCount,
      applyReady,
    }));
  }

  function attachReviewItemSlotMapPreview(id, payload = {}) {
    const previewPayload =
      payload?.preview && typeof payload.preview === "object"
        ? payload.preview
        : {};
    const previewRows = Array.isArray(previewPayload.preview)
      ? previewPayload.preview
      : [];
    const fallbackRows = [
      ...(Array.isArray(previewPayload.mapped) ? previewPayload.mapped : []),
      ...(Array.isArray(previewPayload.unresolved)
        ? previewPayload.unresolved
        : []),
      ...(Array.isArray(previewPayload.ambiguous)
        ? previewPayload.ambiguous
        : []),
    ];
    const rows = (previewRows.length ? previewRows : fallbackRows).map(
      (row) => ({
        ...row,
      }),
    );
    const unresolvedCount = Array.isArray(previewPayload.unresolved)
      ? previewPayload.unresolved.length
      : rows.filter((row) => row.status === "UNRESOLVED").length;
    const ambiguousCount = Array.isArray(previewPayload.ambiguous)
      ? previewPayload.ambiguous.length
      : rows.filter((row) => row.status === "AMBIGUOUS").length;
    const okCount = rows.filter((row) => row.status === "OK").length;
    const confidenceValues = rows
      .map((row) => Number(row.confidence))
      .filter((value) => Number.isFinite(value));
    const confidence = confidenceValues.length
      ? confidenceValues.reduce((sum, value) => sum + value, 0) /
        confidenceValues.length
      : 0;
    const mappingReady =
      rows.length > 0 && unresolvedCount === 0 && ambiguousCount === 0;
    const warnings = [];
    if (!rows.length) {
      warnings.push(
        "Slot/player mapping did not return any slot rows for this capture.",
      );
    }
    if (unresolvedCount > 0) {
      warnings.push(
        `${unresolvedCount} slot/player row needs staff review before LIVE.`,
      );
    }
    if (ambiguousCount > 0) {
      warnings.push(
        `${ambiguousCount} slot/player row has multiple possible teams.`,
      );
    }
    if (mappingReady) {
      warnings.push(
        "Slot/player mappings were saved. Verify the roster in Match Control before LIVE.",
      );
    }

    return updateReviewItem(id, (item) => ({
      ...item,
      reviewKind: "slot-map",
      rows,
      warnings,
      confidence,
      imageUrl: null,
      assetId: normalizeString(payload?.assetId) || item.assetId || null,
      ocrStatus: mappingReady ? "ready" : "needs_review",
      ocrError: null,
      ocrPreview: {
        kind: "slot-map",
        matchId: previewPayload.matchId || item.matchId,
        slotsCount: rows.length,
        ocrMode: normalizeString(previewPayload.ocrMode),
      },
      okCount,
      unresolvedCount,
      ambiguousCount,
      // Slot mapping is pre-live setup only; it never makes a result apply-ready.
      applyReady: false,
    }));
  }

  function markReviewItemOcrFailed(id, errorMessage) {
    const message = normalizeString(errorMessage) || "OCR preview failed.";
    return updateReviewItem(id, (item) => ({
      ...item,
      ocrStatus: "failed",
      ocrError: message,
      warnings: [message],
      applyReady: false,
    }));
  }

  async function captureReviewCandidate() {
    if (!status.running) {
      throw new Error(
        "Start Visual Mode before capturing an OCR review candidate.",
      );
    }
    const item = await sampleSelectedSource({ forceReviewCandidate: true });
    return {
      item,
      queue: getReviewQueue(),
      status: getStatus(),
    };
  }

  return {
    getConfig: readConfig,
    setConfig: persistConfig,
    getStatus,
    getReviewQueue,
    getReviewItem,
    assertReviewItemCaptureReady,
    cleanupOrphanedCaptures,
    clearReviewQueue,
    ignoreReviewItem: (id) => updateReviewItemStatus(id, "ignored"),
    markReviewItemReviewed: (id) => updateReviewItemStatus(id, "reviewed"),
    markReviewItemOcrProcessing,
    markReviewItemSlotMapProcessing,
    attachReviewItemOcrPreview,
    attachReviewItemSlotMapPreview,
    markReviewItemOcrFailed,
    captureReviewCandidate,
    listSources,
    start,
    stop,
  };
}

module.exports = {
  createVisualModeService,
  normalizeVisualModeConfig,
  normalizeRegion,
};
