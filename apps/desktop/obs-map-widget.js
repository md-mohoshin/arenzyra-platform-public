(function () {
  const PLAYER_TTL_MS = 1800;
  const PLAYER_MIN_INTERPOLATION_MS = 90;
  const PLAYER_MAX_INTERPOLATION_MS = 420;
  const PLAYER_STALE_SNAP_MS = 2200;
  const PLAYER_SNAP_WORLD_RATIO = 0.035;
  const DEBUG_REFRESH_MS = 160;
  const COMBAT_ROLE_TTL_MS = 2600;
  const KILL_PING_TTL_MS = 3000;
  const KILL_PING_MAX_COUNT = 20;
  const COMMENTARY_REFRESH_MS = 1000;
  const DISTANCE_REFRESH_MS = 500;
  const CLUSTER_WORLD_RATIO = 0.018;
  const CLUSTER_MIN_WORLD = 9000;
  const CIRCLE_CAMERA_EDGE_RATIO = 0.92;
  const CIRCLE_CAMERA_MAX_ZOOM = 4.25;
  const CIRCLE_CAMERA_PADDING_RATIO = 0.1;
  const CIRCLE_CAMERA_PLAYER_PADDING_WORLD_RATIO = 0.018;
  const CIRCLE_CAMERA_SMOOTHING_MS = 520;
  const MATCH_FINISHED_PHASES = new Set([
    "finished",
    "ended",
    "complete",
    "completed",
    "winner",
    "postmatch",
    "post-match",
    "results",
  ]);
  const MATCH_OPENING_PHASES = new Set(["plane", "parachuting", "lobby", "waiting"]);
  const MANUAL_CAMERA_MAX_ZOOM = 6;
  const MANUAL_CAMERA_RESUME_MS = 8000;
  const MANUAL_CAMERA_ZOOM_STEP = 1.18;
  const RENDER_REFERENCE_PX = 1040;
  const DEFAULT_STYLE = "esports";
  const DEFAULT_TEAM_LOGO_URL = "/assets/default-team.png";
  const DEFAULT_TEAM_NAME = "Arenzyra";
  const DEFAULT_TEAM_TAG = "AZ";
  const OBS_LABEL_FONT_STACK = '"Bahnschrift", "Segoe UI", Arial, sans-serif';
  const DEBUG_FONT_STACK = '"Cascadia Code", Consolas, monospace';
  const FOCUS_LABEL_MAX_LENGTH = 28;
  const TEAM_COLOR_PALETTE = [
    "#FF4D4D",
    "#FFAA00",
    "#00C2FF",
    "#00E676",
    "#C084FC",
    "#FF6F91",
    "#FFD166",
    "#4DD0E1",
    "#F06292",
    "#64FFDA",
  ];
  const FALLBACK_OPERATOR_WORKFLOW_CONFIG = Object.freeze({
    mapFocusHighlightMs: 4500,
    operatorActionStatusMs: 3800,
    maxSelectableWatchTargets: 5,
  });
  const OPERATOR_HOTKEYS = Object.freeze({
    watchNow: "w",
    pin: "p",
    unpin: "u",
    replay: "r",
    suppress: "t",
    unsuppress: "y",
    acceptRecommendation: "a",
    center: "c",
    dismissAlert: "d",
  });

  const STYLE_CONFIGS = Object.freeze({
    minimal: Object.freeze({
      name: "minimal",
      defaultShowTeamNumbers: false,
      currentZoneFillAlpha: 0,
      markerGlow: false,
      markerInnerDot: false,
      showClusterRings: false,
      showZoneShade: false,
    }),
    esports: Object.freeze({
      name: "esports",
      defaultShowTeamNumbers: true,
      currentZoneFillAlpha: 0.035,
      markerGlow: true,
      markerInnerDot: true,
      showClusterRings: true,
      showZoneShade: true,
    }),
  });

  const bootstrap = window.__ARENZYRA_MAP_WIDGET_BOOTSTRAP__ || {};
  const query = new URLSearchParams(window.location.search);
  const widgetShell = document.getElementById("widget-shell");
  const stage = document.getElementById("map-stage");
  const image = document.getElementById("map-image");
  const canvas = document.getElementById("map-overlay");
  const statusPill = document.getElementById("status-pill");
  const timerValue = document.getElementById("timer-value");
  const sideRail = document.getElementById("side-rail");
  const legendPanel = document.getElementById("legend-panel");
  const legendList = document.getElementById("legend-list");
  const legendMeta = document.getElementById("legend-meta");
  const commentaryPanel = document.getElementById("commentary-panel");
  const commentaryList = document.getElementById("commentary-list");
  const commentaryMeta = document.getElementById("commentary-meta");
  const operatorStack = document.getElementById("operator-stack");
  const assistPanel = document.getElementById("assist-panel");
  const assistGrid = document.getElementById("assist-grid");
  const operatorPanel = document.getElementById("operator-panel");
  const operatorPanelBody = document.getElementById("operator-panel-body");
  const watchQueuePanel = document.getElementById("watch-queue-panel");
  const watchQueueList = document.getElementById("watch-queue-list");
  const alertsPanel = document.getElementById("alerts-panel");
  const alertsList = document.getElementById("alerts-list");
  const rightRail = document.getElementById("right-rail");
  const distancePanel = document.getElementById("distance-panel");
  const distanceList = document.getElementById("distance-list");
  const distanceMeta = document.getElementById("distance-meta");
  const debugPanel = document.getElementById("debug-panel");
  const debugGrid = document.getElementById("debug-grid");
  const context = canvas ? canvas.getContext("2d") : null;

  if (
    !widgetShell ||
    !stage ||
    !image ||
    !canvas ||
    !statusPill ||
    !timerValue ||
    !sideRail ||
    !legendPanel ||
    !legendList ||
    !legendMeta ||
    !commentaryPanel ||
    !commentaryList ||
    !commentaryMeta ||
    !operatorStack ||
    !assistPanel ||
    !assistGrid ||
    !operatorPanel ||
    !operatorPanelBody ||
    !watchQueuePanel ||
    !watchQueueList ||
    !alertsPanel ||
    !alertsList ||
    !rightRail ||
    !distancePanel ||
    !distanceList ||
    !distanceMeta ||
    !debugPanel ||
    !debugGrid ||
    !context
  ) {
    return;
  }

  function toFiniteNumber(value, fallback = null) {
    const numeric =
      typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function normalizeFlag(value) {
    return value === "1" || value === "true";
  }

  function resolveQueryFlag(name, fallback = false) {
    if (!query.has(name)) {
      return fallback;
    }
    return normalizeFlag(query.get(name));
  }

  function normalizeStyle(value) {
    return value === "minimal" ? "minimal" : "esports";
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function clamp01(value) {
    return clamp(value, 0, 1);
  }

  function lerp(start, end, progress) {
    return start + (end - start) * progress;
  }

  function drawRoundedRectPath(ctx, x, y, width, height, radius) {
    const normalizedRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(x, y, width, height, normalizedRadius);
      return;
    }

    ctx.moveTo(x + normalizedRadius, y);
    ctx.lineTo(x + width - normalizedRadius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + normalizedRadius);
    ctx.lineTo(x + width, y + height - normalizedRadius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - normalizedRadius, y + height);
    ctx.lineTo(x + normalizedRadius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - normalizedRadius);
    ctx.lineTo(x, y + normalizedRadius);
    ctx.quadraticCurveTo(x, y, x + normalizedRadius, y);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/"/g, "&quot;");
  }

  function formatNumber(value, decimals = 2) {
    return Number.isFinite(value) ? Number(value).toFixed(decimals) : "--";
  }

  function formatTimestamp(value) {
    const numeric = toFiniteNumber(value);
    return numeric !== null ? new Date(numeric).toISOString() : "--";
  }

  function formatTimer(ms) {
    if (!Number.isFinite(ms)) {
      return "--:--";
    }

    if (ms <= 0) {
      return "00:00";
    }

    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
  }

  function formatCircle(circle) {
    if (!circle) {
      return "--";
    }

    const x = toFiniteNumber(circle.centerX ?? circle.x);
    const y = toFiniteNumber(circle.centerY ?? circle.y);
    const radius = toFiniteNumber(circle.radius);
    if (x === null || y === null || radius === null) {
      return "--";
    }

    return `${formatNumber(x)}, ${formatNumber(y)} | r=${formatNumber(radius)}`;
  }

  function formatFlightPath(flightPath) {
    if (
      !flightPath ||
      !flightPath.start ||
      !flightPath.end ||
      !Number.isFinite(flightPath.start.x) ||
      !Number.isFinite(flightPath.start.y) ||
      !Number.isFinite(flightPath.end.x) ||
      !Number.isFinite(flightPath.end.y)
    ) {
      return "--";
    }

    return (
      `${formatNumber(flightPath.start.x)}, ${formatNumber(flightPath.start.y)}` +
      ` -> ${formatNumber(flightPath.end.x)}, ${formatNumber(flightPath.end.y)}`
    );
  }

  function formatRemainingDetails(ms) {
    if (!Number.isFinite(ms)) {
      return "--";
    }

    return `${formatTimer(ms)} (${Math.max(0, Math.ceil(ms))} ms)`;
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  const teamColorCache = new Map();
  const rgbCache = new Map();
  const teamLogoImageCache = new Map();

  function getHexRgb(hex) {
    if (!hex || typeof hex !== "string") {
      return null;
    }

    if (rgbCache.has(hex)) {
      return rgbCache.get(hex);
    }

    const normalized = hex.replace("#", "").trim();
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
      rgbCache.set(hex, null);
      return null;
    }

    const rgb = {
      r: Number.parseInt(normalized.slice(0, 2), 16),
      g: Number.parseInt(normalized.slice(2, 4), 16),
      b: Number.parseInt(normalized.slice(4, 6), 16),
    };
    rgbCache.set(hex, rgb);
    return rgb;
  }

  function colorWithAlpha(hex, alpha) {
    const rgb = getHexRgb(hex);
    if (!rgb) {
      return `rgba(255, 255, 255, ${clamp01(alpha)})`;
    }

    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamp01(alpha)})`;
  }

  function getTeamColor(teamId) {
    const normalized = typeof teamId === "string" ? teamId.trim().toLowerCase() : "";
    const key = normalized || "__unknown__";
    if (teamColorCache.has(key)) {
      return teamColorCache.get(key);
    }

    const color = TEAM_COLOR_PALETTE[hashString(key) % TEAM_COLOR_PALETTE.length];
    teamColorCache.set(key, color);
    return color;
  }

  function normalizeTeamKey(value) {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    return normalized || null;
  }

  function normalizeTeamSlot(value) {
    const numeric = toFiniteNumber(value);
    if (numeric === null) {
      return null;
    }

    const slot = Math.trunc(numeric);
    return slot > 0 ? slot : null;
  }

  function normalizeText(value) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    return null;
  }

  function normalizeLookupText(value) {
    const normalized = normalizeText(value);
    return normalized ? normalized.toLowerCase() : null;
  }

  function buildCombatPlayerLookupKey(teamId, playerKey) {
    const normalizedPlayerKey = normalizeLookupText(playerKey);
    if (!normalizedPlayerKey) {
      return null;
    }

    const normalizedTeamId = normalizeTeamKey(teamId);
    return normalizedTeamId ? `${normalizedTeamId}|${normalizedPlayerKey}` : normalizedPlayerKey;
  }

  function normalizeTeamBrandingRecord(record, _index) {
    if (!record || typeof record !== "object") {
      return null;
    }

    const teamId = normalizeText(record.teamId ?? record.id);
    const slot = normalizeTeamSlot(record.slot ?? record.slotNumber ?? record.teamNo);
    const teamName = normalizeText(record.teamName ?? record.name);
    const teamTag = normalizeText(record.teamTag ?? record.tag);
    const rawLogoUrl = normalizeText(record.logoUrl);
    const color = normalizeText(record.color);
    if (!teamId && slot === null && !teamName && !teamTag && !rawLogoUrl) {
      return null;
    }

    return {
      teamId,
      slot,
      teamName: teamName || teamTag || DEFAULT_TEAM_NAME,
      teamTag: teamTag || DEFAULT_TEAM_TAG,
      logoUrl: rawLogoUrl || DEFAULT_TEAM_LOGO_URL,
      color,
    };
  }

  function getTeamBranding(teamId, teamSlot) {
    const teamKey = normalizeTeamKey(teamId);
    if (teamKey && state.teamBrandingByTeamId.has(teamKey)) {
      return state.teamBrandingByTeamId.get(teamKey);
    }

    const slot = normalizeTeamSlot(teamSlot) ?? parseNumericTeamIndex(teamId);
    if (slot !== null && state.teamBrandingBySlot.has(slot)) {
      return state.teamBrandingBySlot.get(slot);
    }

    return null;
  }

  function getTeamGroupingKey(teamId, teamSlot, branding) {
    const slot = normalizeTeamSlot(teamSlot) ?? normalizeTeamSlot(branding && branding.slot);
    if (slot !== null) {
      return `slot:${slot}`;
    }
    return normalizeText(teamId) || normalizeText(branding && branding.teamId);
  }

  function getTeamDisplayIndex(teamId, teamSlot, branding) {
    const slot = normalizeTeamSlot(teamSlot) ?? normalizeTeamSlot(branding && branding.slot);
    if (slot !== null) {
      return slot;
    }
    return teamId ? ensureTeamDisplayIndex(teamId) : null;
  }

  function getTeamLogoImage(logoUrl) {
    const normalizedUrl = normalizeText(logoUrl) || DEFAULT_TEAM_LOGO_URL;
    if (teamLogoImageCache.has(normalizedUrl)) {
      return teamLogoImageCache.get(normalizedUrl);
    }

    const record = {
      image: new Image(),
      status: "loading",
    };
    record.image.onload = function () {
      record.status = "ready";
    };
    record.image.onerror = function () {
      record.status = "failed";
      if (normalizedUrl !== DEFAULT_TEAM_LOGO_URL) {
        getTeamLogoImage(DEFAULT_TEAM_LOGO_URL);
      }
    };
    record.image.src = normalizedUrl;
    teamLogoImageCache.set(normalizedUrl, record);
    return record;
  }

  function resolveAbsoluteOrigin(value) {
    const raw = normalizeText(value);
    if (!raw) {
      return null;
    }

    try {
      return new URL(raw, window.location.href).origin;
    } catch (_error) {
      return null;
    }
  }

  function buildApiPlayerMediaUrl(playerId) {
    const normalizedPlayerId = normalizeText(playerId);
    if (!normalizedPlayerId || !state.playerMediaApiBase) {
      return null;
    }

    return `${state.playerMediaApiBase}/media/players/${encodeURIComponent(normalizedPlayerId)}/photo`;
  }

  function buildPlayerImageCandidates(source) {
    if (!source) {
      return [];
    }

    const explicitCandidates = [
      source.playerPhotoUrl,
      source.playerAvatarUrl,
      source.photoUrl,
      source.avatarUrl,
      source.playerPhoto,
      source.avatar,
    ];
    const apiCandidate = buildApiPlayerMediaUrl(source.playerId);

    return Array.from(
      new Set(
        [...explicitCandidates, apiCandidate]
          .map((candidate) => normalizeText(candidate))
          .filter(Boolean),
      ),
    );
  }

  function parseNumericTeamIndex(teamId) {
    const normalized = typeof teamId === "string" ? teamId.trim() : "";
    if (!normalized) {
      return null;
    }

    if (/^\d{1,3}$/.test(normalized)) {
      const numeric = Number(normalized);
      return numeric > 0 ? numeric : null;
    }

    const directMatch = normalized.match(/^(?:team|t|slot|seed)[-_ ]?(\d{1,3})$/i);
    if (directMatch) {
      const numeric = Number(directMatch[1]);
      return numeric > 0 ? numeric : null;
    }

    return null;
  }

  function compareTeamIds(left, right) {
    const leftNumeric = parseNumericTeamIndex(left);
    const rightNumeric = parseNumericTeamIndex(right);

    if (leftNumeric !== null && rightNumeric !== null && leftNumeric !== rightNumeric) {
      return leftNumeric - rightNumeric;
    }
    if (leftNumeric !== null && rightNumeric === null) {
      return -1;
    }
    if (leftNumeric === null && rightNumeric !== null) {
      return 1;
    }

    return String(left).localeCompare(String(right), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  }

  function formatTeamLabel(teamId) {
    const numeric = parseNumericTeamIndex(teamId);
    if (numeric !== null) {
      return DEFAULT_TEAM_NAME;
    }

    const normalized = typeof teamId === "string" ? teamId.trim() : "";
    return normalized ? `${DEFAULT_TEAM_NAME} ${normalized}` : DEFAULT_TEAM_NAME;
  }

  function truncateLabel(value, maxLength = FOCUS_LABEL_MAX_LENGTH) {
    const normalized = String(value || "").trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }

    return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
  }

  const style = normalizeStyle(query.get("style") || DEFAULT_STYLE);
  const styleConfig = STYLE_CONFIGS[style] || STYLE_CONFIGS[DEFAULT_STYLE];
  const showOperatorPanel = resolveQueryFlag("operatorpanel");
  const showCameraAssist = resolveQueryFlag("cameraassist");

  const state = {
    connectionStatus: "connecting",
    debug: Boolean(bootstrap.debug) || resolveQueryFlag("debug"),
    assistFlags: {
      showHotZones: resolveQueryFlag("showhotzones"),
      showFocus: resolveQueryFlag("showfocus"),
      showProximity: resolveQueryFlag("showproximity"),
      showPanel: resolveQueryFlag("assistpanel") || Boolean(bootstrap.debug) || resolveQueryFlag("debug"),
    },
    assistMarkup: "",
    assistSnapshot: bootstrap.snapshot ? bootstrap.snapshot.observerAssist || null : null,
    commentaryFlags: {
      showPanel: resolveQueryFlag("commentary"),
    },
    commentaryMarkup: "",
    commentaryMetaLabel: "",
    debugFlags: {
      showCircleAnchors: resolveQueryFlag("showcircles"),
      showCoords: resolveQueryFlag("showcoords"),
      showFightHighlights: resolveQueryFlag("fightdebug"),
      showGrid: resolveQueryFlag("showgrid"),
      showPlayerLabels: resolveQueryFlag("showplayers"),
    },
    debugMarkup: "",
    distanceFlags: {
      showPanel: resolveQueryFlag("distances") && resolveQueryFlag("teamdistance", true),
    },
    distanceMarkup: "",
    distanceMetaLabel: "",
    frame: {
      animatedCircle: null,
      blueCircle: null,
      clusters: [],
      fightHighlights: [],
      flightPath: null,
      focusCandidates: [],
      hotZones: [],
      killPingCount: 0,
      nextCircle: null,
      now: 0,
      players: [],
      proximities: [],
      remainingMs: null,
    },
    knownTeamIds: [],
    killPings: [],
    legendMarkup: "",
    legendMetaLabel: "",
    lastAlertsRefreshAt: 0,
    lastAssistRefreshAt: 0,
    lastCommentaryRefreshAt: 0,
    lastDebugRefreshAt: 0,
    lastDistanceRefreshAt: 0,
    lastHeartbeatAt: null,
    lastMessageAt: null,
    lastOperatorActionPath: "",
    lastOperatorPanelRefreshAt: 0,
    lastPlayerMessageAt: null,
    lastLegendRefreshAt: 0,
    lastWatchQueueRefreshAt: 0,
    lastStatusLabel: "",
    lastTimerLabel: "",
    lastZoneMessageAt: null,
    lastPlayerSnapshotById: new Map(),
    mapCamera: {
      active: false,
      dragStartCameraX: 0,
      dragStartCameraY: 0,
      dragStartClientX: 0,
      dragStartClientY: 0,
      draggingPointerId: null,
      enabled: resolveQueryFlag("circlezoom", true) || resolveQueryFlag("autocirclezoom"),
      includeEdgeTeams: resolveQueryFlag("edgezoomteams"),
      lastUpdatedAt: 0,
      manualOverrideUntil: 0,
      targetX: 0,
      targetY: 0,
      targetZoom: 1,
      x: 0,
      y: 0,
      zoom: 1,
    },
    mapContext: null,
    operatorFlags: {
      showAlerts: resolveQueryFlag("alerts"),
      showBasePanel: showOperatorPanel,
      showCameraAssist,
      showPanel: showOperatorPanel || showCameraAssist,
      showWatchQueue: resolveQueryFlag("watchqueue"),
    },
    operatorPanelMarkup: "",
    playerMediaApiBase: null,
    playerMotionById: new Map(),
    playersPacket: null,
    productionSupportSnapshot: bootstrap.snapshot ? bootstrap.snapshot.productionSupport || null : null,
    alertsMarkup: "",
    renderMetrics: {
      clusterDebugFont: "",
      clusterMinRadiusPx: 10,
      clusterPaddingPx: 6,
      clusterStrokeWidth: 1.2,
      debugFont: "",
      debugLineHeight: 12,
      focusBadgeRadius: 12,
      focusFont: "",
      focusLabelFont: "",
      flightPathAccentWidth: 5,
      flightPathArrowLength: 18,
      flightPathArrowWidth: 10,
      flightPathStartRadius: 9,
      flightPathWidth: 8,
      killPingMaxRadius: 28,
      killPingMinRadius: 7,
      labelFont: "",
      labelOffsetX: 8,
      labelOffsetY: 6,
      labelStrokeWidth: 2.5,
      markerGlowBlur: 10,
      markerRadius: 5.5,
      markerStrokeWidth: 1.35,
      nextZoneLineWidth: 1.7,
      knockedCrossSize: 6,
      scale: 1,
      teamBadgeFont: "",
      teamBadgeHeight: 24,
      teamBadgeLogoSize: 18,
      teamBadgePaddingX: 6,
      zoneGlowBlur: 12,
      zoneLineWidth: 2.4,
    },
    requestedMapKey: bootstrap.requestedMapKey || null,
    showLegend: resolveQueryFlag("legend"),
    showTeamLogos: resolveQueryFlag("showteamlogos", true),
    showTeamNumbers: resolveQueryFlag("showteamnumbers", styleConfig.defaultShowTeamNumbers),
    socket: null,
    socketReconnectTimer: null,
    style,
    styleConfig,
    teamClusters: [],
    teamBrandingPacket: null,
    teamBrandingBySlot: new Map(),
    teamBrandingByTeamId: new Map(),
    teamDisplayIndexById: new Map(),
    teamMembersById: new Map(),
    visiblePlayers: [],
    watchQueueMarkup: "",
    zone: null,
  };

  function getMapDefinition() {
    return state.mapContext && state.mapContext.definition ? state.mapContext.definition : null;
  }

  function getScaleMetadata() {
    return (
      (state.zone && state.zone.coordinate) ||
      (state.playersPacket && state.playersPacket.coordinate) ||
      null
    );
  }

  function getDetectedScaleFactor() {
    return Math.max(1, toFiniteNumber(getScaleMetadata() && getScaleMetadata().detectedScaleFactor, 1));
  }

  function resolveWorldSize(mapDefinition) {
    return Math.max(1, toFiniteNumber(mapDefinition && mapDefinition.worldSize, 1));
  }

  function hasLoadedImage() {
    return Boolean(image.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
  }

  function resolveImageDimensions() {
    const map = getMapDefinition();
    if (hasLoadedImage()) {
      return {
        height: image.naturalHeight,
        width: image.naturalWidth,
      };
    }

    return {
      height: toFiniteNumber(map && map.imageHeight, null),
      width: toFiniteNumber(map && map.imageWidth, null),
    };
  }

  function normalizeRenderBounds(bounds) {
    if (!bounds || typeof bounds !== "object") {
      return null;
    }

    const x = clamp01(toFiniteNumber(bounds.x, 0) || 0);
    const y = clamp01(toFiniteNumber(bounds.y, 0) || 0);
    const maxWidth = Math.max(0.0001, 1 - x);
    const maxHeight = Math.max(0.0001, 1 - y);
    const width = clamp(toFiniteNumber(bounds.width, 1) || 1, 0.0001, maxWidth);
    const height = clamp(toFiniteNumber(bounds.height, 1) || 1, 0.0001, maxHeight);

    return { x, y, width, height };
  }

  function getMapRenderBounds(mapDefinition) {
    return normalizeRenderBounds(mapDefinition && mapDefinition.renderBounds) || {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    };
  }

  function applyMapViewport() {
    const mapDefinition = getMapDefinition();
    const imageSize = resolveImageDimensions();
    const renderBounds = getMapRenderBounds(mapDefinition);
    const imageWidth = Math.max(1, toFiniteNumber(imageSize.width, 1) || 1);
    const imageHeight = Math.max(1, toFiniteNumber(imageSize.height, imageWidth) || imageWidth);
    const aspectRatio = clamp(
      (imageWidth * renderBounds.width) / (imageHeight * renderBounds.height),
      0.35,
      2.5,
    );

    stage.style.setProperty("--map-aspect-ratio-decimal", String(aspectRatio));
    stage.style.setProperty("--map-image-width", `${(100 / renderBounds.width).toFixed(4)}%`);
    stage.style.setProperty("--map-image-height", `${(100 / renderBounds.height).toFixed(4)}%`);
    stage.style.setProperty(
      "--map-image-left",
      `${(-(renderBounds.x / renderBounds.width) * 100).toFixed(4)}%`,
    );
    stage.style.setProperty(
      "--map-image-top",
      `${(-(renderBounds.y / renderBounds.height) * 100).toFixed(4)}%`,
    );
  }

  function applyMapCameraStyle(mapDefinition, width, height) {
    const imageSize = resolveImageDimensions();
    const renderBounds = getMapRenderBounds(mapDefinition);
    const imageWidth = Math.max(1, toFiniteNumber(imageSize.width, 1) || 1);
    const imageHeight = Math.max(1, toFiniteNumber(imageSize.height, imageWidth) || imageWidth);
    const aspectRatio = clamp(
      (imageWidth * renderBounds.width) / (imageHeight * renderBounds.height),
      0.35,
      2.5,
    );
    const camera = state.mapCamera;
    const zoom = camera && camera.enabled ? Math.max(1, toFiniteNumber(camera.zoom, 1) || 1) : 1;
    const cameraX = camera && camera.enabled ? toFiniteNumber(camera.x, 0) || 0 : 0;
    const cameraY = camera && camera.enabled ? toFiniteNumber(camera.y, 0) || 0 : 0;
    const safeWidth = Math.max(1, width || 1);
    const safeHeight = Math.max(1, height || 1);
    const baseLeftPercent = -(renderBounds.x / renderBounds.width) * 100;
    const baseTopPercent = -(renderBounds.y / renderBounds.height) * 100;

    stage.style.setProperty("--map-aspect-ratio-decimal", String(aspectRatio));
    stage.style.setProperty("--map-image-width", `${((100 / renderBounds.width) * zoom).toFixed(4)}%`);
    stage.style.setProperty("--map-image-height", `${((100 / renderBounds.height) * zoom).toFixed(4)}%`);
    stage.style.setProperty(
      "--map-image-left",
      `${(baseLeftPercent * zoom - (cameraX / safeWidth) * 100 * zoom).toFixed(4)}%`,
    );
    stage.style.setProperty(
      "--map-image-top",
      `${(baseTopPercent * zoom - (cameraY / safeHeight) * 100 * zoom).toFixed(4)}%`,
    );
  }

  function normalizeWorldX(worldX, mapDefinition, options) {
    const worldSize = resolveWorldSize(mapDefinition);
    return clamp(
      toFiniteNumber(worldX, 0) * Math.max(1, toFiniteNumber(options && options.detectedScaleFactor, 1)),
      0,
      worldSize,
    );
  }

  function normalizeWorldY(worldY, mapDefinition, options) {
    const worldSize = resolveWorldSize(mapDefinition);
    return clamp(
      toFiniteNumber(worldY, 0) * Math.max(1, toFiniteNumber(options && options.detectedScaleFactor, 1)),
      0,
      worldSize,
    );
  }

  function normalizeWorldRadius(worldRadius, mapDefinition, options) {
    const worldSize = resolveWorldSize(mapDefinition);
    return clamp(
      toFiniteNumber(worldRadius, 0) * Math.max(1, toFiniteNumber(options && options.detectedScaleFactor, 1)),
      0,
      worldSize,
    );
  }

  function projectCameraX(baseX) {
    const camera = state.mapCamera;
    if (!camera || !camera.enabled) {
      return baseX;
    }

    return (baseX - camera.x) * camera.zoom;
  }

  function projectCameraY(baseY) {
    const camera = state.mapCamera;
    if (!camera || !camera.enabled) {
      return baseY;
    }

    return (baseY - camera.y) * camera.zoom;
  }

  function projectCameraRadius(baseRadius) {
    const camera = state.mapCamera;
    if (!camera || !camera.enabled) {
      return baseRadius;
    }

    return baseRadius * camera.zoom;
  }

  function worldToBasePixelX(worldX, mapDefinition, width, options) {
    const worldSize = resolveWorldSize(mapDefinition);
    const renderBounds = getMapRenderBounds(mapDefinition);
    const normalized = normalizeWorldX(worldX, mapDefinition, options) / worldSize;
    return ((normalized - renderBounds.x) / renderBounds.width) * width;
  }

  function worldToBasePixelY(worldY, mapDefinition, height, options) {
    const worldSize = resolveWorldSize(mapDefinition);
    const renderBounds = getMapRenderBounds(mapDefinition);
    const normalizedFromTop = normalizeWorldY(worldY, mapDefinition, options) / worldSize;
    return ((normalizedFromTop - renderBounds.y) / renderBounds.height) * height;
  }

  function worldRadiusToBasePixelRadius(worldRadius, mapDefinition, width, height, options) {
    const worldSize = resolveWorldSize(mapDefinition);
    const renderBounds = getMapRenderBounds(mapDefinition);
    return Math.max(
      0,
      normalizeWorldRadius(worldRadius, mapDefinition, options) *
        Math.min(width / (worldSize * renderBounds.width), height / (worldSize * renderBounds.height)),
    );
  }

  function worldToPixelX(worldX, mapDefinition, width, options) {
    return projectCameraX(worldToBasePixelX(worldX, mapDefinition, width, options));
  }

  function worldToPixelY(worldY, mapDefinition, height, options) {
    return projectCameraY(worldToBasePixelY(worldY, mapDefinition, height, options));
  }

  function worldRadiusToPixelRadius(worldRadius, mapDefinition, width, height, options) {
    return projectCameraRadius(worldRadiusToBasePixelRadius(worldRadius, mapDefinition, width, height, options));
  }

  function getCurrentCircle(zone) {
    if (!zone) {
      return null;
    }

    if (zone.circlesVisible === false) {
      return null;
    }

    if (
      zone.currentCircle &&
      Number.isFinite(zone.currentCircle.centerX) &&
      Number.isFinite(zone.currentCircle.centerY) &&
      Number.isFinite(zone.currentCircle.radius)
    ) {
      return {
        centerX: zone.currentCircle.centerX,
        centerY: zone.currentCircle.centerY,
        radius: zone.currentCircle.radius,
      };
    }

    const centerX = toFiniteNumber(zone.centerX);
    const centerY = toFiniteNumber(zone.centerY);
    const radius = toFiniteNumber(zone.radius);
    if (centerX === null || centerY === null || radius === null) {
      return null;
    }

    return { centerX, centerY, radius };
  }

  function getNextCircle(zone) {
    if (!zone) {
      return null;
    }

    if (zone.circlesVisible === false) {
      return null;
    }

    if (
      zone.nextCircle &&
      Number.isFinite(zone.nextCircle.centerX) &&
      Number.isFinite(zone.nextCircle.centerY) &&
      Number.isFinite(zone.nextCircle.radius)
    ) {
      return {
        centerX: zone.nextCircle.centerX,
        centerY: zone.nextCircle.centerY,
        radius: zone.nextCircle.radius,
      };
    }

    const centerX = toFiniteNumber(zone.nextCenterX);
    const centerY = toFiniteNumber(zone.nextCenterY);
    const radius = toFiniteNumber(zone.nextRadius);
    if (centerX === null || centerY === null || radius === null) {
      return null;
    }

    return { centerX, centerY, radius };
  }

  function getBlueCircle(zone) {
    if (!zone) {
      return null;
    }

    if (zone.circlesVisible === false) {
      return null;
    }

    if (
      zone.blueCircle &&
      Number.isFinite(zone.blueCircle.centerX) &&
      Number.isFinite(zone.blueCircle.centerY) &&
      Number.isFinite(zone.blueCircle.radius)
    ) {
      return {
        centerX: zone.blueCircle.centerX,
        centerY: zone.blueCircle.centerY,
        radius: zone.blueCircle.radius,
      };
    }

    const centerX = toFiniteNumber(zone.blueCenterX);
    const centerY = toFiniteNumber(zone.blueCenterY);
    const radius = toFiniteNumber(zone.blueRadius);
    if (centerX === null || centerY === null || radius === null) {
      return null;
    }

    return { centerX, centerY, radius };
  }

  function getFlightPath(zone, now = Date.now()) {
    if (!zone) {
      return null;
    }

    const matchPhase = String(zone.matchPhase || "").trim().toLowerCase();
    if (MATCH_FINISHED_PHASES.has(matchPhase)) {
      return null;
    }

    const remainingMs = getRemainingZoneMs(zone, now);
    // The plane route should only live through the opening sequence.
    // Once the opening timer expires, hide it even if the first circle paint lags by a tick.
    if (
      !MATCH_OPENING_PHASES.has(matchPhase) ||
      (remainingMs !== null && remainingMs <= 0)
    ) {
      return null;
    }

    if (
      zone.flightPath &&
      zone.flightPath.start &&
      zone.flightPath.end &&
      Number.isFinite(zone.flightPath.start.x) &&
      Number.isFinite(zone.flightPath.start.y) &&
      Number.isFinite(zone.flightPath.end.x) &&
      Number.isFinite(zone.flightPath.end.y)
    ) {
      return {
        start: {
          x: zone.flightPath.start.x,
          y: zone.flightPath.start.y,
        },
        end: {
          x: zone.flightPath.end.x,
          y: zone.flightPath.end.y,
        },
      };
    }

    return null;
  }

  function getRemainingZoneMs(zone, now) {
    const targetEndAt = toFiniteNumber(zone && (zone.targetEndAt || (zone.timing && zone.timing.targetEndAt)));
    if (targetEndAt === null) {
      return null;
    }

    return Math.max(0, targetEndAt - now);
  }

  function getZoneDurationMs(zone) {
    const phaseDurationMs = toFiniteNumber(zone && zone.phaseDurationMs);
    if (phaseDurationMs !== null) {
      return phaseDurationMs;
    }

    const phaseDurationSeconds = toFiniteNumber(zone && zone.phaseDuration);
    if (phaseDurationSeconds !== null) {
      return phaseDurationSeconds * 1000;
    }

    const timeRemainingMs = toFiniteNumber(zone && zone.timeRemainingMs);
    if (timeRemainingMs !== null) {
      return timeRemainingMs;
    }

    const timeRemainingSeconds = toFiniteNumber(zone && zone.timeRemaining);
    if (timeRemainingSeconds !== null) {
      return timeRemainingSeconds * 1000;
    }

    if (toFiniteNumber(zone && zone.timing && zone.timing.phaseDurationMs) !== null) {
      return toFiniteNumber(zone && zone.timing && zone.timing.phaseDurationMs);
    }

    return toFiniteNumber(zone && zone.timing && zone.timing.durationMs);
  }

  function isZoneShrinking(zone) {
    const status = String(zone && (zone.status || zone.circleStatus || "")).trim().toLowerCase();
    return status === "2" || status === "moving" || status === "shrinking" || status === "closing";
  }

  function getAnimatedCircleState(zone, now) {
    const currentCircle = getCurrentCircle(zone);
    const nextCircle = getNextCircle(zone);
    const blueCircle = getBlueCircle(zone);
    const durationMs = getZoneDurationMs(zone);
    const remainingMs = getRemainingZoneMs(zone, now);

    if (!currentCircle) {
      return {
        circle: null,
        isAnimating: false,
        progress: 0,
        remainingMs,
      };
    }

    if (
      blueCircle ||
      !isZoneShrinking(zone) ||
      !nextCircle ||
      !Number.isFinite(durationMs) ||
      durationMs <= 0 ||
      remainingMs === null
    ) {
      return {
        circle: currentCircle,
        isAnimating: false,
        progress: 0,
        remainingMs,
      };
    }

    const progress = clamp01(1 - remainingMs / durationMs);
    return {
      circle: {
        centerX: lerp(currentCircle.centerX, nextCircle.centerX, progress),
        centerY: lerp(currentCircle.centerY, nextCircle.centerY, progress),
        radius: lerp(currentCircle.radius, nextCircle.radius, progress),
      },
      isAnimating: progress > 0 && progress < 1,
      progress,
      remainingMs,
    };
  }

  function isActiveCameraPlayer(player) {
    return Boolean(
      player &&
        player.state !== "eliminated" &&
        player.combatRole !== "dead" &&
        Number.isFinite(player.x) &&
        Number.isFinite(player.y),
    );
  }

  function getCameraPlayerGroupKey(player) {
    return player?.teamGroupKey || player?.teamId || player?.playerId || null;
  }

  function countActiveCameraTeams(visiblePlayers) {
    if (!Array.isArray(visiblePlayers) || visiblePlayers.length === 0) {
      return null;
    }

    const aliveTeamKeys = new Set();
    for (const player of visiblePlayers) {
      if (!isActiveCameraPlayer(player)) {
        continue;
      }

      const groupKey = getCameraPlayerGroupKey(player);
      if (groupKey) {
        aliveTeamKeys.add(groupKey);
      }
    }

    return aliveTeamKeys.size > 0 ? aliveTeamKeys.size : null;
  }

  function isMatchFinishedForCamera(zone, visiblePlayers, now) {
    const matchPhase = String(zone?.matchPhase || "").trim().toLowerCase();
    if (MATCH_FINISHED_PHASES.has(matchPhase)) {
      return true;
    }

    const phase = toFiniteNumber(zone?.phase);
    const remainingMs = getRemainingZoneMs(zone, now);
    if (phase !== null && phase >= 7 && remainingMs !== null && remainingMs <= 0) {
      return true;
    }

    const aliveTeamCount = countActiveCameraTeams(visiblePlayers);
    return Boolean(
      aliveTeamCount === 1 &&
        (matchPhase === "endgame" || (phase !== null && phase >= 5)),
    );
  }

  function isCircleZoomActive(zone, visiblePlayers, now) {
    if (!zone) {
      return false;
    }

    const matchPhase = String(zone.matchPhase || "").trim().toLowerCase();
    if (MATCH_OPENING_PHASES.has(matchPhase)) {
      return false;
    }

    if (isMatchFinishedForCamera(zone, visiblePlayers, now)) {
      return false;
    }

    const phase = toFiniteNumber(zone.phase);
    if (phase !== null) {
      return phase > 1;
    }

    const status = String(zone.status || zone.circleStatus || "").trim().toLowerCase();
    return Boolean(status) && isZoneShrinking(zone);
  }

  function resolveCircleBaseGeometry(circle, mapDefinition, width, height) {
    if (!circle || !mapDefinition) {
      return null;
    }

    return {
      radius: Math.max(2, worldRadiusToBasePixelRadius(circle.radius, mapDefinition, width, height)),
      x: worldToBasePixelX(circle.centerX ?? circle.x, mapDefinition, width),
      y: worldToBasePixelY(circle.centerY ?? circle.y, mapDefinition, height),
    };
  }

  function expandCameraBox(box, x, y, padding = 0) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return box;
    }

    if (!box) {
      return {
        maxX: x + padding,
        maxY: y + padding,
        minX: x - padding,
        minY: y - padding,
      };
    }

    box.maxX = Math.max(box.maxX, x + padding);
    box.maxY = Math.max(box.maxY, y + padding);
    box.minX = Math.min(box.minX, x - padding);
    box.minY = Math.min(box.minY, y - padding);
    return box;
  }

  function buildCircleCameraBox(circle, visiblePlayers, mapDefinition, width, height) {
    const geometry = resolveCircleBaseGeometry(circle, mapDefinition, width, height);
    if (!geometry) {
      return null;
    }

    let box = expandCameraBox(null, geometry.x, geometry.y, geometry.radius);
    if (!state.mapCamera.includeEdgeTeams || !Array.isArray(visiblePlayers)) {
      return box;
    }

    const worldSize = resolveWorldSize(mapDefinition);
    const outsideTeamKeys = new Set();
    for (const player of visiblePlayers) {
      if (!isActiveCameraPlayer(player)) {
        continue;
      }

      const distance = Math.hypot(player.x - circle.centerX, player.y - circle.centerY);
      if (distance >= circle.radius * CIRCLE_CAMERA_EDGE_RATIO) {
        const groupKey = getCameraPlayerGroupKey(player);
        if (groupKey) {
          outsideTeamKeys.add(groupKey);
        }
      }
    }

    if (outsideTeamKeys.size === 0) {
      return box;
    }

    const playerPaddingWorld = Math.max(
      worldSize * CIRCLE_CAMERA_PLAYER_PADDING_WORLD_RATIO,
      circle.radius * 0.08,
    );
    const playerPaddingPx = Math.max(
      28,
      worldRadiusToBasePixelRadius(playerPaddingWorld, mapDefinition, width, height),
    );

    for (const player of visiblePlayers) {
      if (!isActiveCameraPlayer(player) || !outsideTeamKeys.has(getCameraPlayerGroupKey(player))) {
        continue;
      }

      box = expandCameraBox(
        box,
        worldToBasePixelX(player.x, mapDefinition, width),
        worldToBasePixelY(player.y, mapDefinition, height),
        playerPaddingPx,
      );
    }

    return box;
  }

  function resolveMapCameraTarget(box, width, height) {
    if (!box) {
      return { x: 0, y: 0, zoom: 1 };
    }

    const padding = Math.max(24, Math.min(width, height) * CIRCLE_CAMERA_PADDING_RATIO);
    const boxWidth = Math.max(1, box.maxX - box.minX + padding * 2);
    const boxHeight = Math.max(1, box.maxY - box.minY + padding * 2);
    const zoom = clamp(Math.min(width / boxWidth, height / boxHeight), 1, CIRCLE_CAMERA_MAX_ZOOM);
    const viewWidth = width / zoom;
    const viewHeight = height / zoom;
    const centerX = (box.minX + box.maxX) / 2;
    const centerY = (box.minY + box.maxY) / 2;

    return {
      x: clamp(centerX - viewWidth / 2, 0, Math.max(0, width - viewWidth)),
      y: clamp(centerY - viewHeight / 2, 0, Math.max(0, height - viewHeight)),
      zoom,
    };
  }

  function updateMapCamera(mapDefinition, circle, visiblePlayers, width, height, now) {
    const camera = state.mapCamera;
    const matchFinishedForCamera = isMatchFinishedForCamera(state.zone, visiblePlayers, now);
    if (matchFinishedForCamera) {
      camera.draggingPointerId = null;
      camera.manualOverrideUntil = 0;
      camera.lastUpdatedAt = now;
      camera.x = 0;
      camera.y = 0;
      camera.zoom = 1;
      camera.targetX = 0;
      camera.targetY = 0;
      camera.targetZoom = 1;
      camera.active = false;
      stage.classList.remove("is-dragging");
      return;
    }

    const manualOverrideActive =
      camera.enabled &&
      (camera.draggingPointerId !== null || camera.manualOverrideUntil > now);
    if (manualOverrideActive) {
      const safeZoom = clamp(toFiniteNumber(camera.zoom, 1) || 1, 1, MANUAL_CAMERA_MAX_ZOOM);
      const viewWidth = width / safeZoom;
      const viewHeight = height / safeZoom;
      camera.zoom = safeZoom;
      camera.x = clamp(camera.x, 0, Math.max(0, width - viewWidth));
      camera.y = clamp(camera.y, 0, Math.max(0, height - viewHeight));
      camera.targetX = camera.x;
      camera.targetY = camera.y;
      camera.targetZoom = camera.zoom;
      camera.active = camera.zoom > 1.002;
      camera.lastUpdatedAt = now;
      return;
    }

    const shouldZoom = camera.enabled && isCircleZoomActive(state.zone, visiblePlayers, now);
    const target =
      shouldZoom && mapDefinition && circle
        ? resolveMapCameraTarget(
            buildCircleCameraBox(circle, visiblePlayers, mapDefinition, width, height),
            width,
            height,
      )
        : { x: 0, y: 0, zoom: 1 };

    camera.active = Boolean(shouldZoom && target.zoom > 1.002);
    const previousAt = camera.lastUpdatedAt || now;
    const deltaMs = Math.max(0, now - previousAt);
    const alpha = camera.lastUpdatedAt
      ? clamp(1 - Math.exp(-deltaMs / CIRCLE_CAMERA_SMOOTHING_MS), 0.03, 1)
      : 1;

    camera.targetX = target.x;
    camera.targetY = target.y;
    camera.targetZoom = target.zoom;
    camera.x = lerp(camera.x, target.x, alpha);
    camera.y = lerp(camera.y, target.y, alpha);
    camera.zoom = lerp(camera.zoom, target.zoom, alpha);
    camera.lastUpdatedAt = now;

    if (!shouldZoom || Math.abs(camera.zoom - 1) < 0.002) {
      camera.x = 0;
      camera.y = 0;
      camera.zoom = 1;
    }
  }

  function getStagePointerPoint(event) {
    const bounds = stage.getBoundingClientRect();
    return {
      height: Math.max(1, bounds.height),
      width: Math.max(1, bounds.width),
      x: clamp(event.clientX - bounds.left, 0, Math.max(1, bounds.width)),
      y: clamp(event.clientY - bounds.top, 0, Math.max(1, bounds.height)),
    };
  }

  function clampManualCamera(width, height) {
    const camera = state.mapCamera;
    const zoom = clamp(toFiniteNumber(camera.zoom, 1) || 1, 1, MANUAL_CAMERA_MAX_ZOOM);
    const viewWidth = width / zoom;
    const viewHeight = height / zoom;
    camera.zoom = zoom;
    camera.x = clamp(toFiniteNumber(camera.x, 0) || 0, 0, Math.max(0, width - viewWidth));
    camera.y = clamp(toFiniteNumber(camera.y, 0) || 0, 0, Math.max(0, height - viewHeight));
    camera.targetX = camera.x;
    camera.targetY = camera.y;
    camera.targetZoom = camera.zoom;
    camera.active = camera.zoom > 1.002;
  }

  function holdManualCamera(now = Date.now()) {
    state.mapCamera.manualOverrideUntil = now + MANUAL_CAMERA_RESUME_MS;
  }

  function resetManualCamera() {
    const camera = state.mapCamera;
    camera.draggingPointerId = null;
    camera.manualOverrideUntil = 0;
    camera.lastUpdatedAt = 0;
    camera.x = 0;
    camera.y = 0;
    camera.zoom = 1;
    camera.targetX = 0;
    camera.targetY = 0;
    camera.targetZoom = 1;
    camera.active = false;
    stage.classList.remove("is-dragging");
  }

  function isMapCameraControlTarget(event) {
    const target = event && event.target && typeof event.target.closest === "function"
      ? event.target
      : null;
    if (!target) {
      return false;
    }

    return !target.closest(
      ".operator-stack, .status-pill, .timer-panel, .debug-panel, .legend-panel",
    );
  }

  function handleMapWheel(event) {
    if (!state.mapCamera.enabled || !isMapCameraControlTarget(event)) {
      return;
    }

    const point = getStagePointerPoint(event);
    const camera = state.mapCamera;
    const previousZoom = clamp(toFiniteNumber(camera.zoom, 1) || 1, 1, MANUAL_CAMERA_MAX_ZOOM);
    const zoomDirection = event.deltaY < 0 ? MANUAL_CAMERA_ZOOM_STEP : 1 / MANUAL_CAMERA_ZOOM_STEP;
    const nextZoom = clamp(previousZoom * zoomDirection, 1, MANUAL_CAMERA_MAX_ZOOM);
    if (Math.abs(nextZoom - previousZoom) < 0.001) {
      return;
    }

    event.preventDefault();
    const focusX = camera.x + point.x / previousZoom;
    const focusY = camera.y + point.y / previousZoom;
    camera.zoom = nextZoom;
    camera.x = focusX - point.x / nextZoom;
    camera.y = focusY - point.y / nextZoom;
    clampManualCamera(point.width, point.height);
    holdManualCamera();
  }

  function handleMapPointerDown(event) {
    if (
      !state.mapCamera.enabled ||
      event.button !== 0 ||
      !isMapCameraControlTarget(event)
    ) {
      return;
    }

    const camera = state.mapCamera;
    const point = getStagePointerPoint(event);
    camera.draggingPointerId = event.pointerId;
    camera.dragStartClientX = event.clientX;
    camera.dragStartClientY = event.clientY;
    camera.dragStartCameraX = camera.x;
    camera.dragStartCameraY = camera.y;
    holdManualCamera();
    stage.classList.add("is-dragging");
    stage.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    clampManualCamera(point.width, point.height);
  }

  function handleMapPointerMove(event) {
    const camera = state.mapCamera;
    if (camera.draggingPointerId !== event.pointerId) {
      return;
    }

    const point = getStagePointerPoint(event);
    const zoom = Math.max(1, toFiniteNumber(camera.zoom, 1) || 1);
    camera.x = camera.dragStartCameraX - (event.clientX - camera.dragStartClientX) / zoom;
    camera.y = camera.dragStartCameraY - (event.clientY - camera.dragStartClientY) / zoom;
    clampManualCamera(point.width, point.height);
    holdManualCamera();
    event.preventDefault();
  }

  function handleMapPointerUp(event) {
    const camera = state.mapCamera;
    if (camera.draggingPointerId !== event.pointerId) {
      return;
    }

    camera.draggingPointerId = null;
    stage.classList.remove("is-dragging");
    stage.releasePointerCapture?.(event.pointerId);
    holdManualCamera();
    event.preventDefault();
  }

  function handleMapDoubleClick(event) {
    if (!state.mapCamera.enabled || !isMapCameraControlTarget(event)) {
      return;
    }

    event.preventDefault();
    resetManualCamera();
  }

  function handleMapCameraHotkey(event) {
    if (!state.mapCamera.enabled || event.defaultPrevented || event.repeat) {
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || isEditableElement(event.target)) {
      return;
    }

    const key = String(event.key || "").trim().toLowerCase();
    const camera = state.mapCamera;
    const hasManualCamera =
      camera.draggingPointerId !== null ||
      camera.manualOverrideUntil > Date.now() ||
      camera.zoom > 1.002;
    if (key !== "r" || !hasManualCamera) {
      return;
    }

    event.preventDefault();
    resetManualCamera();
  }

  function clearCanvas() {
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.restore();
  }

  function updateRenderMetrics(width, height) {
    const stageSize = Math.max(1, Math.min(width, height));
    const scale = clamp(stageSize / RENDER_REFERENCE_PX, 0.72, 2.35);
    const metrics = state.renderMetrics;
    const labelFontSize = Math.max(10, Math.round(10.5 * scale));
    const debugFontSize = Math.max(9, Math.round(9.5 * scale));
    const focusFontSize = Math.max(10, Math.round(10 * scale));
    const focusLabelFontSize = Math.max(9, Math.round(9.5 * scale));
    const isMinimal = state.style === "minimal";

    metrics.scale = scale;
    metrics.markerRadius = (isMinimal ? 4.3 : 5.8) * scale;
    metrics.markerStrokeWidth = Math.max(1, 1.2 * scale);
    metrics.knockedCrossSize = metrics.markerRadius * 0.92;
    metrics.markerGlowBlur = (isMinimal ? 0 : 12) * scale;
    metrics.teamBadgeHeight = Math.max(isMinimal ? 24 : 28, (isMinimal ? 24 : 30) * scale);
    metrics.teamBadgeLogoSize = Math.max(isMinimal ? 20 : 23, (isMinimal ? 20 : 24) * scale);
    metrics.teamBadgePaddingX = Math.max(isMinimal ? 6 : 7, (isMinimal ? 7 : 8) * scale);
    metrics.clusterStrokeWidth = Math.max(1, 1.2 * scale);
    metrics.clusterPaddingPx = 6 * scale;
    metrics.clusterMinRadiusPx = 10 * scale;
    metrics.flightPathWidth = Math.max(5, 8 * scale);
    metrics.flightPathAccentWidth = Math.max(3, 5 * scale);
    metrics.flightPathStartRadius = Math.max(7, 9 * scale);
    metrics.flightPathArrowLength = Math.max(14, 18 * scale);
    metrics.flightPathArrowWidth = Math.max(8, 10 * scale);
    metrics.killPingMinRadius = 7 * scale;
    metrics.killPingMaxRadius = 30 * scale;
    metrics.zoneLineWidth = Math.max(1.8, 2.35 * scale);
    metrics.nextZoneLineWidth = Math.max(1.2, 1.7 * scale);
    metrics.zoneGlowBlur = 11 * scale;
    metrics.labelFont = `700 ${labelFontSize}px ${OBS_LABEL_FONT_STACK}`;
    metrics.teamBadgeFont = `900 ${Math.max(11, Math.round(11.75 * scale))}px ${OBS_LABEL_FONT_STACK}`;
    metrics.labelStrokeWidth = Math.max(2, 2.35 * scale);
    metrics.labelOffsetX = 8 * scale;
    metrics.labelOffsetY = 5 * scale;
    metrics.debugFont = `600 ${debugFontSize}px ${DEBUG_FONT_STACK}`;
    metrics.clusterDebugFont = `700 ${debugFontSize}px ${OBS_LABEL_FONT_STACK}`;
    metrics.debugLineHeight = debugFontSize + 4;
    metrics.focusBadgeRadius = 11.5 * scale;
    metrics.focusFont = `700 ${focusFontSize}px ${OBS_LABEL_FONT_STACK}`;
    metrics.focusLabelFont = `600 ${focusLabelFontSize}px ${OBS_LABEL_FONT_STACK}`;
  }

  function syncCanvasSize() {
    const bounds = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    const nextWidth = Math.max(1, Math.round(width * dpr));
    const nextHeight = Math.max(1, Math.round(height * dpr));

    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
    }

    updateRenderMetrics(width, height);
    return { height, width };
  }

  function resolveCircleScreenGeometry(circle, mapDefinition, width, height, options) {
    if (!mapDefinition || !circle) {
      return null;
    }

    return {
      radius: Math.max(2, worldRadiusToPixelRadius(circle.radius, mapDefinition, width, height, options)),
      x: worldToPixelX(circle.centerX ?? circle.x, mapDefinition, width, options),
      y: worldToPixelY(circle.centerY ?? circle.y, mapDefinition, height, options),
    };
  }

  function clipFlightPathToWorldBounds(flightPath, mapDefinition) {
    if (!flightPath || !mapDefinition) {
      return null;
    }

    const start = flightPath.start;
    const end = flightPath.end;
    if (
      !start ||
      !end ||
      !Number.isFinite(start.x) ||
      !Number.isFinite(start.y) ||
      !Number.isFinite(end.x) ||
      !Number.isFinite(end.y)
    ) {
      return null;
    }

    const worldSize = resolveWorldSize(mapDefinition);
    const direction = {
      x: end.x - start.x,
      y: end.y - start.y,
    };
    const epsilon = 1e-6;
    if (Math.abs(direction.x) <= epsilon && Math.abs(direction.y) <= epsilon) {
      return null;
    }

    const intersections = [];
    const pushIntersection = (t) => {
      const x = start.x + direction.x * t;
      const y = start.y + direction.y * t;
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < -epsilon ||
        x > worldSize + epsilon ||
        y < -epsilon ||
        y > worldSize + epsilon
      ) {
        return;
      }

      const clampedX = clamp(x, 0, worldSize);
      const clampedY = clamp(y, 0, worldSize);
      const duplicate = intersections.some(
        (candidate) =>
          Math.abs(candidate.x - clampedX) < 1 && Math.abs(candidate.y - clampedY) < 1,
      );
      if (!duplicate) {
        intersections.push({ x: clampedX, y: clampedY, t });
      }
    };

    if (Math.abs(direction.x) > epsilon) {
      pushIntersection((0 - start.x) / direction.x);
      pushIntersection((worldSize - start.x) / direction.x);
    }
    if (Math.abs(direction.y) > epsilon) {
      pushIntersection((0 - start.y) / direction.y);
      pushIntersection((worldSize - start.y) / direction.y);
    }

    if (intersections.length >= 2) {
      intersections.sort((left, right) => left.t - right.t);
      return {
        start: {
          x: intersections[0].x,
          y: intersections[0].y,
        },
        end: {
          x: intersections[intersections.length - 1].x,
          y: intersections[intersections.length - 1].y,
        },
      };
    }

    return {
      start: {
        x: clamp(start.x, 0, worldSize),
        y: clamp(start.y, 0, worldSize),
      },
      end: {
        x: clamp(end.x, 0, worldSize),
        y: clamp(end.y, 0, worldSize),
      },
    };
  }

  function drawFlightPath(flightPath, mapDefinition, width, height, now) {
    if (!flightPath || !mapDefinition) {
      return;
    }

    const clipped = clipFlightPathToWorldBounds(flightPath, mapDefinition);
    if (!clipped) {
      return;
    }

    const startX = worldToPixelX(clipped.start.x, mapDefinition, width);
    const startY = worldToPixelY(clipped.start.y, mapDefinition, height);
    const endX = worldToPixelX(clipped.end.x, mapDefinition, width);
    const endY = worldToPixelY(clipped.end.y, mapDefinition, height);
    if (
      !Number.isFinite(startX) ||
      !Number.isFinite(startY) ||
      !Number.isFinite(endX) ||
      !Number.isFinite(endY)
    ) {
      return;
    }

    const metrics = state.renderMetrics;
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance < 12) {
      return;
    }

    const unitX = deltaX / distance;
    const unitY = deltaY / distance;
    const dashLength = Math.max(16, 28 * metrics.scale);
    const gapLength = Math.max(10, 16 * metrics.scale);
    const dashCycle = dashLength + gapLength;
    const arrowTipX = endX;
    const arrowTipY = endY;
    const arrowBaseX = endX - unitX * metrics.flightPathArrowLength;
    const arrowBaseY = endY - unitY * metrics.flightPathArrowLength;
    const visibleEndX = arrowBaseX;
    const visibleEndY = arrowBaseY;

    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";

    context.beginPath();
    context.moveTo(startX, startY);
    context.lineTo(visibleEndX, visibleEndY);
    context.lineWidth = metrics.flightPathWidth + Math.max(2, metrics.scale * 2.2);
    context.strokeStyle = "rgba(0, 0, 0, 0.3)";
    context.shadowColor = "rgba(0, 0, 0, 0.24)";
    context.shadowBlur = 10 * metrics.scale;
    context.stroke();

    context.shadowColor = "transparent";
    context.shadowBlur = 0;
    context.beginPath();
    context.moveTo(startX, startY);
    context.lineTo(visibleEndX, visibleEndY);
    context.lineWidth = metrics.flightPathWidth;
    context.strokeStyle = "rgba(255, 255, 255, 0.96)";
    context.stroke();

    context.beginPath();
    context.moveTo(startX, startY);
    context.lineTo(visibleEndX, visibleEndY);
    context.setLineDash([dashLength, gapLength]);
    context.lineDashOffset = -((now / 85) % dashCycle);
    context.lineWidth = metrics.flightPathAccentWidth;
    context.strokeStyle = "rgba(208, 48, 48, 0.98)";
    context.stroke();
    context.setLineDash([]);

    context.beginPath();
    context.arc(startX, startY, metrics.flightPathStartRadius, 0, Math.PI * 2);
    context.fillStyle = "rgba(255, 255, 255, 0.98)";
    context.fill();
    context.lineWidth = Math.max(1.2, metrics.scale * 1.35);
    context.strokeStyle = "rgba(20, 28, 38, 0.42)";
    context.stroke();

    context.beginPath();
    context.moveTo(arrowTipX, arrowTipY);
    context.lineTo(
      arrowBaseX - unitY * metrics.flightPathArrowWidth,
      arrowBaseY + unitX * metrics.flightPathArrowWidth,
    );
    context.lineTo(
      arrowBaseX + unitY * metrics.flightPathArrowWidth,
      arrowBaseY - unitX * metrics.flightPathArrowWidth,
    );
    context.closePath();
    context.fillStyle = "rgba(255, 255, 255, 0.98)";
    context.fill();
    context.lineWidth = Math.max(1.1, metrics.scale * 1.2);
    context.strokeStyle = "rgba(20, 28, 38, 0.38)";
    context.stroke();

    context.restore();
  }

  function drawSafeZoneShade(circle, mapDefinition, width, height) {
    if (!state.styleConfig.showZoneShade || !circle || !mapDefinition) {
      return;
    }

    const geometry = resolveCircleScreenGeometry(circle, mapDefinition, width, height);
    if (!geometry) {
      return;
    }

    context.save();
    context.fillStyle =
      state.style === "minimal" ? "rgba(2, 6, 12, 0.08)" : "rgba(2, 6, 12, 0.16)";
    context.beginPath();
    context.rect(0, 0, width, height);
    context.moveTo(geometry.x + geometry.radius, geometry.y);
    context.arc(geometry.x, geometry.y, geometry.radius, 0, Math.PI * 2, true);
    context.fill("evenodd");
    context.restore();
  }

  function drawBlueZoneShade(circle, mapDefinition, width, height) {
    if (!circle || !mapDefinition) {
      return;
    }

    const geometry = resolveCircleScreenGeometry(circle, mapDefinition, width, height);
    if (!geometry) {
      return;
    }

    const metrics = state.renderMetrics;
    context.save();
    context.beginPath();
    context.rect(0, 0, width, height);
    context.moveTo(geometry.x + geometry.radius, geometry.y);
    context.arc(geometry.x, geometry.y, geometry.radius, 0, Math.PI * 2, true);
    context.fillStyle =
      state.style === "minimal" ? "rgba(37, 99, 235, 0.12)" : "rgba(37, 99, 235, 0.22)";
    context.fill("evenodd");

    context.beginPath();
    context.arc(geometry.x, geometry.y, geometry.radius, 0, Math.PI * 2);
    context.lineWidth = Math.max(1.4, metrics.zoneLineWidth * 0.82);
    context.shadowColor = "rgba(96, 165, 250, 0.5)";
    context.shadowBlur = metrics.zoneGlowBlur * 0.75;
    context.strokeStyle = "rgba(96, 165, 250, 0.82)";
    context.stroke();
    context.restore();
  }

  function drawNextZoneCircle(circle, mapDefinition, width, height) {
    const geometry = resolveCircleScreenGeometry(circle, mapDefinition, width, height);
    if (!geometry) {
      return;
    }

    const metrics = state.renderMetrics;
    context.save();
    context.beginPath();
    context.arc(geometry.x, geometry.y, geometry.radius, 0, Math.PI * 2);
    context.setLineDash([12 * metrics.scale, 8 * metrics.scale]);
    context.lineWidth = metrics.nextZoneLineWidth;
    context.strokeStyle = "rgba(255, 255, 255, 0.46)";
    context.stroke();
    context.restore();
  }

  function drawCurrentZoneCircle(circle, mapDefinition, width, height) {
    const geometry = resolveCircleScreenGeometry(circle, mapDefinition, width, height);
    if (!geometry) {
      return;
    }

    const metrics = state.renderMetrics;
    context.save();

    if (state.styleConfig.currentZoneFillAlpha > 0) {
      context.beginPath();
      context.arc(geometry.x, geometry.y, geometry.radius, 0, Math.PI * 2);
      context.fillStyle = `rgba(255, 255, 255, ${state.styleConfig.currentZoneFillAlpha})`;
      context.fill();
    }

    context.beginPath();
    context.arc(geometry.x, geometry.y, geometry.radius, 0, Math.PI * 2);
    context.lineWidth = metrics.zoneLineWidth * 2.1;
    context.strokeStyle = "rgba(255, 255, 255, 0.16)";
    context.shadowColor =
      state.style === "minimal" ? "rgba(255, 255, 255, 0.16)" : "rgba(151, 240, 255, 0.28)";
    context.shadowBlur = metrics.zoneGlowBlur;
    context.stroke();

    context.beginPath();
    context.arc(geometry.x, geometry.y, geometry.radius, 0, Math.PI * 2);
    context.lineWidth = metrics.zoneLineWidth;
    context.shadowBlur = 0;
    context.strokeStyle = "rgba(255, 255, 255, 0.97)";
    context.stroke();
    context.restore();
  }

  function drawHotZones(hotZones, mapDefinition, width, height) {
    if (!state.assistFlags.showHotZones || !mapDefinition || !Array.isArray(hotZones)) {
      return;
    }

    for (const hotZone of hotZones.slice(0, 6)) {
      const geometry = resolveCircleScreenGeometry(hotZone, mapDefinition, width, height);
      if (!geometry) {
        continue;
      }

      const intensity = clamp01((toFiniteNumber(hotZone.score, 0) || 0) / 220);
      const teamCount = Array.isArray(hotZone.involvedTeamIds) ? hotZone.involvedTeamIds.length : 0;
      const accent =
        (hotZone.recentKillCount || 0) > 0 || teamCount >= 3 ? "#F97316" : "#FBBF24";
      const fillGradient = context.createRadialGradient(
        geometry.x,
        geometry.y,
        Math.max(4, geometry.radius * 0.16),
        geometry.x,
        geometry.y,
        geometry.radius,
      );

      fillGradient.addColorStop(0, colorWithAlpha(accent, 0.14 + intensity * 0.09));
      fillGradient.addColorStop(0.6, colorWithAlpha(accent, 0.07 + intensity * 0.05));
      fillGradient.addColorStop(1, colorWithAlpha(accent, 0));

      context.save();
      context.beginPath();
      context.arc(geometry.x, geometry.y, geometry.radius, 0, Math.PI * 2);
      context.fillStyle = fillGradient;
      context.fill();

      context.beginPath();
      context.arc(geometry.x, geometry.y, geometry.radius, 0, Math.PI * 2);
      context.lineWidth = Math.max(1, state.renderMetrics.scale * 1.35);
      context.strokeStyle = colorWithAlpha(accent, 0.16 + intensity * 0.16);
      context.stroke();
      context.restore();
    }
  }

  function _drawFightHighlights(fightHighlights, mapDefinition, width, height, now) {
    if (!mapDefinition || !Array.isArray(fightHighlights) || fightHighlights.length === 0) {
      return;
    }

    const metrics = state.renderMetrics;
    const showFightDebug = state.debug || state.debugFlags.showFightHighlights;
    const visibleHighlights = showFightDebug
      ? fightHighlights
      : fightHighlights.filter((highlight) => highlight && highlight.visible);

    for (let index = 0; index < visibleHighlights.length; index += 1) {
      const highlight = visibleHighlights[index];
      if (!highlight) {
        continue;
      }

      const geometry = resolveCircleScreenGeometry(highlight, mapDefinition, width, height);
      if (!geometry) {
        continue;
      }

      const intensity = clamp01(
        toFiniteNumber(highlight.renderIntensity ?? highlight.intensity, 0.35) || 0.35,
      );
      const confidence = clamp01(
        toFiniteNumber(highlight.renderConfidence ?? highlight.confidence, 0.35) || 0.35,
      );
      const statusFade =
        highlight.status === "fading"
          ? 0.62
          : highlight.status === "candidate"
            ? 0.26
            : 1;
      const cappedFade = !highlight.visible && showFightDebug ? 0.42 : 1;
      const pulse = 0.5 + 0.5 * Math.sin(((now % 1600) / 1600) * Math.PI * 2 + index * 0.9);
      const accent =
        intensity >= 0.82 ? "#FB7185" : intensity >= 0.62 ? "#F97316" : "#FBBF24";
      const outerRadius = geometry.radius * (1.02 + pulse * 0.08);
      const pulseRadius = geometry.radius * (1.12 + pulse * 0.12);
      const coreRadius = Math.max(10 * metrics.scale, geometry.radius * (0.18 + pulse * 0.04));
      const fillGradient = context.createRadialGradient(
        geometry.x,
        geometry.y,
        Math.max(8, geometry.radius * 0.16),
        geometry.x,
        geometry.y,
        pulseRadius,
      );

      fillGradient.addColorStop(0, colorWithAlpha(accent, (0.14 + intensity * 0.18) * statusFade));
      fillGradient.addColorStop(
        0.58,
        colorWithAlpha(accent, (0.08 + intensity * 0.1) * statusFade * cappedFade),
      );
      fillGradient.addColorStop(1, colorWithAlpha(accent, 0));

      context.save();
      context.beginPath();
      context.arc(geometry.x, geometry.y, pulseRadius, 0, Math.PI * 2);
      context.fillStyle = fillGradient;
      context.fill();

      context.beginPath();
      context.arc(geometry.x, geometry.y, outerRadius, 0, Math.PI * 2);
      context.lineWidth = Math.max(1.4, metrics.scale * (1.6 + intensity * 1.9));
      context.strokeStyle = colorWithAlpha(
        accent,
        (0.32 + confidence * 0.36) * statusFade * cappedFade,
      );
      if (highlight.status === "candidate" || (!highlight.visible && showFightDebug)) {
        context.setLineDash([10 * metrics.scale, 8 * metrics.scale]);
      }
      context.stroke();
      context.setLineDash([]);

      context.beginPath();
      context.arc(geometry.x, geometry.y, Math.max(4, outerRadius * 0.72), 0, Math.PI * 2);
      context.lineWidth = Math.max(1, metrics.scale * 1.1);
      context.strokeStyle = colorWithAlpha(
        accent,
        (0.16 + confidence * 0.22) * statusFade * cappedFade,
      );
      context.stroke();

      context.beginPath();
      context.arc(geometry.x, geometry.y, coreRadius * 0.34, 0, Math.PI * 2);
      context.fillStyle = colorWithAlpha("#F8FAFC", 0.9 * statusFade);
      context.fill();

      context.beginPath();
      context.moveTo(geometry.x - coreRadius * 0.7, geometry.y);
      context.lineTo(geometry.x + coreRadius * 0.7, geometry.y);
      context.moveTo(geometry.x, geometry.y - coreRadius * 0.7);
      context.lineTo(geometry.x, geometry.y + coreRadius * 0.7);
      context.lineWidth = Math.max(1.2, metrics.scale * 1.5);
      context.strokeStyle = colorWithAlpha("#FFF7ED", 0.78 * statusFade * cappedFade);
      context.stroke();

      if (!showFightDebug && highlight.status !== "candidate") {
        const badgeLabel =
          Array.isArray(highlight.teamIds) && highlight.teamIds.length > 2
            ? `${highlight.teamIds.length}T`
            : "FIGHT";
        const badgePaddingX = 8 * metrics.scale;
        const badgeHeight = Math.max(16, 17 * metrics.scale);
        context.font = metrics.focusLabelFont;
        const badgeWidth = Math.ceil(context.measureText(badgeLabel).width + badgePaddingX * 2);
        const badgeX = clamp(geometry.x - badgeWidth / 2, 4, Math.max(4, width - badgeWidth - 4));
        const badgeY = clamp(
          geometry.y - outerRadius - badgeHeight - 6 * metrics.scale,
          4,
          Math.max(4, height - badgeHeight - 4),
        );

        context.textAlign = "center";
        context.textBaseline = "middle";
        context.beginPath();
        drawRoundedRectPath(
          context,
          badgeX,
          badgeY,
          badgeWidth,
          badgeHeight,
          Math.max(8, 8 * metrics.scale),
        );
        context.fillStyle = colorWithAlpha("#02060C", 0.74 * statusFade);
        context.strokeStyle = colorWithAlpha(accent, (0.26 + intensity * 0.24) * statusFade);
        context.lineWidth = Math.max(1, metrics.scale);
        context.fill();
        context.stroke();
        context.fillStyle = colorWithAlpha("#FFF7ED", 0.94 * statusFade);
        context.fillText(badgeLabel, badgeX + badgeWidth / 2, badgeY + badgeHeight / 2);
      }

      if (showFightDebug) {
        const teamLabel = Array.isArray(highlight.teamIds)
          ? highlight.teamIds.join(",")
          : "--";
        const debugLabel = [
          String(highlight.status || "candidate").toUpperCase(),
          `${Math.round((toFiniteNumber(highlight.confidence, 0) || 0) * 100)}%`,
          teamLabel,
          highlight.visible ? `P${highlight.priorityRank || 1}` : "HIDDEN",
        ].join(" | ");
        const paddingX = 8 * metrics.scale;
        const labelHeight = Math.max(16, 17 * metrics.scale);
        context.font = metrics.focusLabelFont;
        const labelWidth = Math.ceil(context.measureText(debugLabel).width + paddingX * 2);
        const labelX = clamp(
          geometry.x - labelWidth / 2,
          4,
          Math.max(4, width - labelWidth - 4),
        );
        const labelY = clamp(
          geometry.y + outerRadius + 6 * metrics.scale,
          4,
          Math.max(4, height - labelHeight - 4),
        );

        context.beginPath();
        drawRoundedRectPath(
          context,
          labelX,
          labelY,
          labelWidth,
          labelHeight,
          Math.max(8, 8 * metrics.scale),
        );
        context.fillStyle = colorWithAlpha("#02060C", 0.72 * cappedFade);
        context.strokeStyle = colorWithAlpha(accent, (0.22 + confidence * 0.2) * cappedFade);
        context.lineWidth = Math.max(1, metrics.scale);
        context.fill();
        context.stroke();
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillStyle = colorWithAlpha("#FFF7ED", 0.94 * cappedFade);
        context.fillText(debugLabel, labelX + labelWidth / 2, labelY + labelHeight / 2);
      }

      context.restore();
    }
  }

  function drawProximityLinks(proximities, mapDefinition, width, height) {
    if (!state.assistFlags.showProximity || !mapDefinition || !Array.isArray(proximities)) {
      return;
    }

    const metrics = state.renderMetrics;

    for (const proximity of proximities.slice(0, 14)) {
      const fromX = worldToPixelX(proximity.teamACenterX, mapDefinition, width);
      const fromY = worldToPixelY(proximity.teamACenterY, mapDefinition, height);
      const toX = worldToPixelX(proximity.teamBCenterX, mapDefinition, width);
      const toY = worldToPixelY(proximity.teamBCenterY, mapDefinition, height);
      const alpha =
        proximity.severity === "high" ? 0.3 : proximity.severity === "medium" ? 0.22 : 0.14;
      const accent =
        proximity.severity === "high"
          ? "#FB7185"
          : proximity.severity === "medium"
            ? "#FBBF24"
            : "#E2E8F0";

      context.save();
      context.setLineDash([8 * metrics.scale, 8 * metrics.scale]);
      context.lineWidth = Math.max(1, 1.1 * metrics.scale);
      context.strokeStyle = colorWithAlpha(accent, alpha);
      context.beginPath();
      context.moveTo(fromX, fromY);
      context.lineTo(toX, toY);
      context.stroke();
      context.restore();
    }
  }

  function drawFocusCandidates(focusCandidates, mapDefinition, width, height) {
    if (!state.assistFlags.showFocus || !mapDefinition || !Array.isArray(focusCandidates)) {
      return;
    }

    const metrics = state.renderMetrics;

    for (let index = 0; index < focusCandidates.length; index += 1) {
      const candidate = focusCandidates[index];
      const x = worldToPixelX(candidate.centerX, mapDefinition, width);
      const y = worldToPixelY(candidate.centerY, mapDefinition, height);
      const badgeRadius = metrics.focusBadgeRadius;
      const label = truncateLabel(candidate.label, 24);
      const accent =
        candidate.category === "recent-combat"
          ? "#FB7185"
          : candidate.category === "zone-edge"
            ? "#F97316"
            : candidate.category === "cluster"
              ? "#FBBF24"
              : "#E2E8F0";

      context.save();
      context.beginPath();
      context.arc(x, y, badgeRadius, 0, Math.PI * 2);
      context.fillStyle = "rgba(5, 9, 14, 0.88)";
      context.fill();
      context.lineWidth = Math.max(1.4, metrics.scale * 1.5);
      context.strokeStyle = colorWithAlpha(accent, 0.92);
      context.stroke();

      context.font = metrics.focusFont;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = colorWithAlpha(accent, 0.98);
      context.fillText(String(index + 1), x, y + 0.5);

      const labelX = x + badgeRadius + 8 * metrics.scale;
      const labelY = y - badgeRadius;
      const paddingX = 8 * metrics.scale;
      const labelWidth = Math.ceil(context.measureText(label).width + paddingX * 2);
      const labelHeight = Math.ceil(metrics.focusBadgeRadius * 1.55);
      const resolvedLabelX = clamp(labelX, 4, Math.max(4, width - labelWidth - 4));
      const resolvedLabelY = clamp(labelY, 4, Math.max(4, height - labelHeight - 4));

      context.fillStyle = "rgba(5, 9, 14, 0.82)";
      context.strokeStyle = colorWithAlpha(accent, 0.3);
      context.lineWidth = Math.max(1, metrics.scale);
      context.beginPath();
      drawRoundedRectPath(
        context,
        resolvedLabelX,
        resolvedLabelY,
        labelWidth,
        labelHeight,
        Math.max(8, 8 * metrics.scale),
      );
      context.fill();
      context.stroke();

      context.font = metrics.focusLabelFont;
      context.textAlign = "left";
      context.textBaseline = "middle";
      context.fillStyle = "rgba(248, 250, 252, 0.94)";
      context.fillText(label, resolvedLabelX + paddingX, resolvedLabelY + labelHeight / 2);
      context.restore();
    }
  }

  function drawWorkflowFocusHighlight(now, mapDefinition, width, height) {
    const workflowState = getOperatorWorkflowState(state.productionSupportSnapshot);
    const workflowConfig = getOperatorWorkflowConfig(state.productionSupportSnapshot);
    if (
      !mapDefinition ||
      !workflowState.mapFocusCenter ||
      !Number.isFinite(workflowState.mapFocusUntil) ||
      workflowState.mapFocusUntil <= now
    ) {
      return;
    }

    const x = worldToPixelX(workflowState.mapFocusCenter.x, mapDefinition, width);
    const y = worldToPixelY(workflowState.mapFocusCenter.y, mapDefinition, height);
    const metrics = state.renderMetrics;
    const ttlMs = Math.max(1, workflowConfig.mapFocusHighlightMs);
    const remainingMs = Math.max(0, workflowState.mapFocusUntil - now);
    const fade = clamp01(remainingMs / ttlMs);
    const pulse = 0.5 + 0.5 * Math.sin((now % 1400) / 1400 * Math.PI * 2);
    const outerRadius = (30 + pulse * 22) * metrics.scale;
    const innerRadius = (12 + pulse * 10) * metrics.scale;
    const highlightedTarget = resolveTargetLikeById(
      state.productionSupportSnapshot,
      workflowState.highlightedTargetId,
    );
    const label = highlightedTarget ? truncateLabel(highlightedTarget.label, 24) : "Focus";

    context.save();
    context.beginPath();
    context.arc(x, y, outerRadius, 0, Math.PI * 2);
    context.fillStyle = colorWithAlpha("#38BDF8", 0.08 + fade * 0.12);
    context.fill();

    context.beginPath();
    context.arc(x, y, outerRadius, 0, Math.PI * 2);
    context.lineWidth = Math.max(1.6, 2.4 * metrics.scale);
    context.strokeStyle = colorWithAlpha("#BAE6FD", 0.48 + fade * 0.34);
    context.stroke();

    context.beginPath();
    context.arc(x, y, innerRadius, 0, Math.PI * 2);
    context.lineWidth = Math.max(1.2, 1.8 * metrics.scale);
    context.strokeStyle = colorWithAlpha("#E0F2FE", 0.5 + fade * 0.28);
    context.stroke();

    context.beginPath();
    context.arc(x, y, 4.5 * metrics.scale, 0, Math.PI * 2);
    context.fillStyle = colorWithAlpha("#F8FAFC", 0.88);
    context.fill();

    context.font = metrics.focusLabelFont;
    context.textAlign = "center";
    context.textBaseline = "bottom";
    context.strokeStyle = "rgba(2, 6, 12, 0.76)";
    context.lineWidth = Math.max(2, metrics.scale * 2.1);
    context.strokeText(label, x, y - outerRadius - 8 * metrics.scale);
    context.fillStyle = colorWithAlpha("#E0F2FE", 0.96);
    context.fillText(label, x, y - outerRadius - 8 * metrics.scale);
    context.restore();
  }

  function drawGrid(width, height, mapDefinition) {
    if (!state.debug || !state.debugFlags.showGrid || !mapDefinition) {
      return;
    }

    const stepCount = 10;
    const worldSize = resolveWorldSize(mapDefinition);

    context.save();
    context.strokeStyle = "rgba(148, 163, 184, 0.18)";
    context.lineWidth = 1;
    context.setLineDash([4, 6]);

    for (let index = 1; index < stepCount; index += 1) {
      const ratio = index / stepCount;
      const x = width * ratio;
      const y = height * ratio;

      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();

      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    if (state.debugFlags.showCoords) {
      context.setLineDash([]);
      context.font = state.renderMetrics.debugFont;
      context.fillStyle = "rgba(226, 232, 240, 0.75)";

      for (let index = 0; index <= stepCount; index += 2) {
        const ratio = index / stepCount;
        const x = width * ratio;
        const y = height * ratio;
        const worldValue = Math.round(worldSize * ratio);

        context.fillText(String(worldValue), clamp(x + 4, 4, Math.max(4, width - 56)), height - 8);
        if (index < stepCount) {
          context.fillText(
            String(Math.round(worldSize * (1 - ratio))),
            6,
            clamp(y - 4, 12, Math.max(12, height - 12)),
          );
        }
      }
    }

    context.restore();
  }

  function drawCrosshair(worldX, worldY, mapDefinition, width, height, styleOptions, options) {
    const x = worldToPixelX(worldX, mapDefinition, width, options);
    const y = worldToPixelY(worldY, mapDefinition, height, options);
    const size = styleOptions.size || 8;

    context.save();
    context.strokeStyle = styleOptions.strokeStyle || "rgba(255,255,255,0.9)";
    context.lineWidth = styleOptions.lineWidth || 1.5;
    context.beginPath();
    context.moveTo(x - size, y);
    context.lineTo(x + size, y);
    context.moveTo(x, y - size);
    context.lineTo(x, y + size);
    context.stroke();

    if (styleOptions.label) {
      context.fillStyle =
        styleOptions.fillStyle || styleOptions.strokeStyle || "rgba(255,255,255,0.95)";
      context.font = state.renderMetrics.debugFont;
      context.fillText(styleOptions.label, x + size + 4, y - size - 2);
    }
    context.restore();
  }

  function getPlayerSnapDistanceWorld() {
    const mapDefinition = getMapDefinition();
    const worldSize = resolveWorldSize(mapDefinition);
    return Math.max(2000, worldSize * PLAYER_SNAP_WORLD_RATIO);
  }

  function getInterpolatedPlayerPosition(motion, now) {
    if (!motion) {
      return null;
    }

    const duration = motion.endAt - motion.startAt;
    if (!(duration > 0)) {
      return {
        x: motion.toX,
        y: motion.toY,
      };
    }

    const progress = clamp01((now - motion.startAt) / duration);
    return {
      x: lerp(motion.fromX, motion.toX, progress),
      y: lerp(motion.fromY, motion.toY, progress),
    };
  }

  function rebuildTeamDisplayIndexes() {
    state.knownTeamIds.sort(compareTeamIds);
    state.teamDisplayIndexById.clear();

    const usedIndexes = new Set();
    for (const teamId of state.knownTeamIds) {
      const numericIndex = parseNumericTeamIndex(teamId);
      if (numericIndex !== null && !usedIndexes.has(numericIndex)) {
        state.teamDisplayIndexById.set(teamId, numericIndex);
        usedIndexes.add(numericIndex);
      }
    }

    let nextFallbackIndex = 1;
    for (const teamId of state.knownTeamIds) {
      if (state.teamDisplayIndexById.has(teamId)) {
        continue;
      }

      while (usedIndexes.has(nextFallbackIndex)) {
        nextFallbackIndex += 1;
      }

      state.teamDisplayIndexById.set(teamId, nextFallbackIndex);
      usedIndexes.add(nextFallbackIndex);
      nextFallbackIndex += 1;
    }
  }

  function ensureTeamDisplayIndex(teamId) {
    if (!teamId) {
      return null;
    }

    if (!state.teamDisplayIndexById.has(teamId)) {
      if (state.knownTeamIds.indexOf(teamId) === -1) {
        state.knownTeamIds.push(teamId);
      }
      rebuildTeamDisplayIndexes();
    }

    return state.teamDisplayIndexById.get(teamId) || null;
  }

  function resetTransientState() {
    state.assistSnapshot = null;
    state.assistMarkup = "";
    state.alertsMarkup = "";
    state.commentaryMarkup = "";
    state.commentaryMetaLabel = "";
    state.distanceMarkup = "";
    state.distanceMetaLabel = "";
    state.killPings.length = 0;
    state.knownTeamIds.length = 0;
    state.legendMarkup = "";
    state.legendMetaLabel = "";
    state.lastAlertsRefreshAt = 0;
    state.lastCommentaryRefreshAt = 0;
    state.lastLegendRefreshAt = 0;
    state.lastDistanceRefreshAt = 0;
    state.lastPlayerMessageAt = null;
    state.lastOperatorPanelRefreshAt = 0;
    state.lastWatchQueueRefreshAt = 0;
    state.lastPlayerSnapshotById.clear();
    state.playerMotionById.clear();
    state.playersPacket = null;
    state.productionSupportSnapshot = null;
    resetManualCamera();
    state.operatorPanelMarkup = "";
    state.teamClusters.length = 0;
    state.teamDisplayIndexById.clear();
    for (const members of state.teamMembersById.values()) {
      members.length = 0;
    }
    state.teamMembersById.clear();
    state.visiblePlayers.length = 0;
    state.watchQueueMarkup = "";
  }

  function applyRuntimeReset() {
    state.zone = null;
    state.lastHeartbeatAt = null;
    state.lastZoneMessageAt = null;
    setConnectionStatus("disconnected");
    resetTransientState();
  }

  function applyMapContext(mapContext) {
    const nextMapKey = mapContext && mapContext.mapKey ? mapContext.mapKey : null;
    const previousMapKey = state.mapContext && state.mapContext.mapKey ? state.mapContext.mapKey : null;

    if (previousMapKey && nextMapKey && previousMapKey !== nextMapKey) {
      state.zone = null;
      resetTransientState();
    }

    state.mapContext = mapContext || null;
    applyMapViewport();
    loadMapImage();
  }

  function applyObserverAssistPacket(snapshot) {
    state.assistSnapshot = snapshot || null;
  }

  function applyProductionSupportPacket(snapshot) {
    state.productionSupportSnapshot = snapshot || null;
  }

  function applyTeamBrandingPacket(packet) {
    state.teamBrandingPacket = packet || null;
    state.teamBrandingBySlot.clear();
    state.teamBrandingByTeamId.clear();
    state.lastLegendRefreshAt = 0;
    state.playerMediaApiBase = null;

    const teams = packet && Array.isArray(packet.teams) ? packet.teams : [];
    teams.forEach((team, index) => {
      const normalized = normalizeTeamBrandingRecord(team, index);
      if (!normalized) {
        return;
      }

      const teamKey = normalizeTeamKey(normalized.teamId);
      if (teamKey) {
        state.teamBrandingByTeamId.set(teamKey, normalized);
      }
      if (normalized.slot !== null) {
        state.teamBrandingBySlot.set(normalized.slot, normalized);
      }
      if (!state.playerMediaApiBase && /^https?:\/\//i.test(normalized.logoUrl || "")) {
        state.playerMediaApiBase = resolveAbsoluteOrigin(normalized.logoUrl);
      }
      getTeamLogoImage(normalized.logoUrl);
    });
  }

  function applyZonePacket(zonePacket, receivedAt) {
    state.zone = zonePacket || null;
    state.lastZoneMessageAt = zonePacket ? receivedAt : null;
  }

  function addKillPing(x, y, teamId, startedAt) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }

    let ping;
    if (state.killPings.length >= KILL_PING_MAX_COUNT) {
      ping = state.killPings.shift();
    } else {
      ping = {};
    }

    ping.startedAt = startedAt;
    ping.teamId = teamId || null;
    ping.x = x;
    ping.y = y;
    state.killPings.push(ping);
  }

  function applyPlayerPacket(playersPacket, receivedAt) {
    state.playersPacket = playersPacket || null;
    const players = playersPacket && Array.isArray(playersPacket.players) ? playersPacket.players : [];
    if (!playersPacket) {
      state.lastPlayerMessageAt = null;
      return;
    }

    const seenIds = new Set();
    const snapDistance = getPlayerSnapDistanceWorld();
    const previousPacketAt = state.lastPlayerMessageAt;
    const interpolationWindowMs = clamp(
      (previousPacketAt ? receivedAt - previousPacketAt : 180) * 0.85,
      PLAYER_MIN_INTERPOLATION_MS,
      PLAYER_MAX_INTERPOLATION_MS,
    );

    for (const player of players) {
      const playerId = String(player.playerId || "").trim();
      if (!playerId) {
        continue;
      }

      const previousSnapshot = state.lastPlayerSnapshotById.get(playerId) || null;
      const playerTeamId =
        String(player.teamId || (previousSnapshot && previousSnapshot.teamId) || "").trim() ||
        null;
      const playerTeamSlot = normalizeTeamSlot(
        player.teamSlot ?? player.slot ?? (previousSnapshot && previousSnapshot.teamSlot),
      );
      const playerAvatarUrl =
        normalizeText(player.avatarUrl ?? player.photoUrl ?? player.playerPhoto ?? player.avatar) ||
        (previousSnapshot &&
          (previousSnapshot.playerAvatarUrl || previousSnapshot.playerPhotoUrl)) ||
        null;
      const playerPhotoUrl =
        normalizeText(player.photoUrl ?? player.playerPhoto ?? player.avatarUrl ?? player.avatar) ||
        (previousSnapshot &&
          (previousSnapshot.playerPhotoUrl || previousSnapshot.playerAvatarUrl)) ||
        null;
      if (
        previousSnapshot &&
        player.alive === false &&
        previousSnapshot.alive !== false &&
        (previousSnapshot.alive === true || previousSnapshot.knocked === true)
      ) {
        addKillPing(
          toFiniteNumber(player.x, previousSnapshot.x),
          toFiniteNumber(player.y, previousSnapshot.y),
          playerTeamId,
          receivedAt,
        );
      }

      let snapshot = previousSnapshot;
      if (!snapshot) {
        snapshot = {};
        state.lastPlayerSnapshotById.set(playerId, snapshot);
      }
      snapshot.alive = player.alive;
      snapshot.knocked = player.knocked;
      snapshot.kills = Math.max(0, Math.trunc(toFiniteNumber(player.kills, 0) || 0));
      snapshot.lastSeenAt = receivedAt;
      snapshot.playerAvatarUrl = playerAvatarUrl;
      snapshot.playerName = typeof player.playerName === "string" ? player.playerName : null;
      snapshot.playerPhotoUrl = playerPhotoUrl;
      snapshot.teamId = playerTeamId;
      snapshot.teamSlot = playerTeamSlot;
      snapshot.x = player.x;
      snapshot.y = player.y;

      seenIds.add(playerId);
      const existing = state.playerMotionById.get(playerId);
      const currentPosition = existing ? getInterpolatedPlayerPosition(existing, receivedAt) : null;
      const shouldSnap =
        !currentPosition ||
        !existing ||
        receivedAt - existing.lastSeenAt > PLAYER_STALE_SNAP_MS ||
        Math.hypot(player.x - currentPosition.x, player.y - currentPosition.y) >= snapDistance;

      state.playerMotionById.set(playerId, {
        alive: player.alive,
        endAt: shouldSnap ? receivedAt : receivedAt + interpolationWindowMs,
        fromX: shouldSnap ? player.x : currentPosition.x,
        fromY: shouldSnap ? player.y : currentPosition.y,
        knocked: player.knocked,
        kills: Math.max(0, Math.trunc(toFiniteNumber(player.kills, 0) || 0)),
        lastSeenAt: receivedAt,
        playerAvatarUrl,
        playerId,
        playerName: typeof player.playerName === "string" ? player.playerName : null,
        playerPhotoUrl,
        receivedAt,
        startAt: receivedAt,
        teamId: playerTeamId,
        teamSlot: playerTeamSlot,
        toX: player.x,
        toY: player.y,
      });
    }

    for (const [playerId, motion] of state.playerMotionById.entries()) {
      if (seenIds.has(playerId)) {
        continue;
      }
      if (receivedAt - motion.lastSeenAt > PLAYER_TTL_MS) {
        state.playerMotionById.delete(playerId);
      }
    }

    for (const [playerId, snapshot] of state.lastPlayerSnapshotById.entries()) {
      if (seenIds.has(playerId)) {
        continue;
      }
      if (receivedAt - snapshot.lastSeenAt > PLAYER_TTL_MS * 4) {
        state.lastPlayerSnapshotById.delete(playerId);
      }
    }

    state.lastPlayerMessageAt = receivedAt;
  }

  function getTeamMemberBuffer(teamId) {
    if (!teamId) {
      return null;
    }

    let members = state.teamMembersById.get(teamId);
    if (!members) {
      members = [];
      state.teamMembersById.set(teamId, members);
    }
    return members;
  }

  function collectVisiblePlayers(now) {
    for (const members of state.teamMembersById.values()) {
      members.length = 0;
    }

    const visiblePlayers = state.visiblePlayers;
    let visibleCount = 0;

    for (const [playerId, motion] of state.playerMotionById.entries()) {
      if (now - motion.lastSeenAt > PLAYER_TTL_MS) {
        state.playerMotionById.delete(playerId);
        continue;
      }

      const position = getInterpolatedPlayerPosition(motion, now);
      if (!position) {
        continue;
      }

      let entry = visiblePlayers[visibleCount];
      if (!entry) {
        entry = {};
        visiblePlayers[visibleCount] = entry;
      }

      const teamId = motion.teamId || null;
      const teamSlot = normalizeTeamSlot(motion.teamSlot);
      const teamBranding = getTeamBranding(teamId, teamSlot);
      const teamColor =
        (teamBranding && teamBranding.color) ||
        (teamId ? getTeamColor(teamId) : teamSlot !== null ? getTeamColor(`slot-${teamSlot}`) : "#E2E8F0");
      const teamIndex = getTeamDisplayIndex(teamId, teamSlot, teamBranding);
      const teamGroupKey = getTeamGroupingKey(teamId, teamSlot, teamBranding);
      const playerState =
        motion.alive === false ? "eliminated" : motion.knocked === true ? "knocked" : "alive";

      entry.alive = motion.alive;
      entry.clusterBadgeVisible = false;
      entry.kills = motion.kills;
      entry.knocked = motion.knocked;
      entry.playerAvatarUrl = motion.playerAvatarUrl || null;
      entry.playerId = playerId;
      entry.playerName = motion.playerName || null;
      entry.playerPhotoUrl = motion.playerPhotoUrl || null;
      entry.state = playerState;
      entry.teamBranding = teamBranding;
      entry.teamColor = teamColor;
      entry.teamGroupKey = teamGroupKey;
      entry.teamId = teamId;
      entry.teamIndex = teamIndex;
      entry.teamLogoUrl = (teamBranding && teamBranding.logoUrl) || null;
      entry.teamName = (teamBranding && teamBranding.teamName) || null;
      entry.teamSlot = teamSlot;
      entry.teamTag = (teamBranding && teamBranding.teamTag) || null;
      entry.x = position.x;
      entry.y = position.y;
      entry.combatRole = null;
      entry.combatRoleAt = 0;
      entry.combatRoleStrength = 0;

      visibleCount += 1;
    }

    applyRecentCombatRoles(visiblePlayers, visibleCount, now);

    let filteredCount = 0;
    for (let index = 0; index < visibleCount; index += 1) {
      const entry = visiblePlayers[index];
      if (!entry || entry.combatRole === "dead") {
        continue;
      }

      if (filteredCount !== index) {
        visiblePlayers[filteredCount] = entry;
      }
      filteredCount += 1;

      if (entry.state !== "eliminated" && entry.teamGroupKey) {
        const members = getTeamMemberBuffer(entry.teamGroupKey);
        if (members) {
          members.push(entry);
        }
      }
    }

    visiblePlayers.length = filteredCount;
    return visiblePlayers;
  }

  function getCombatRolePriority(role) {
    if (role === "dead") {
      return 3;
    }
    if (role === "victim") {
      return 2;
    }
    if (role === "attacker") {
      return 1;
    }
    return 0;
  }

  function assignCombatRole(entry, role, timestamp, ageMs) {
    if (!entry || !role) {
      return;
    }

    const previousTimestamp = toFiniteNumber(entry.combatRoleAt, 0) || 0;
    if (previousTimestamp > timestamp) {
      return;
    }

    if (
      previousTimestamp === timestamp &&
      getCombatRolePriority(entry.combatRole) >= getCombatRolePriority(role)
    ) {
      return;
    }

    entry.combatRole = role;
    entry.combatRoleAt = timestamp;
    entry.combatRoleStrength = clamp01(1 - ageMs / COMBAT_ROLE_TTL_MS);
  }

  function buildCombatPlayerLookup(players, count) {
    const byId = new Map();
    const byName = new Map();
    const byTeamAndName = new Map();

    for (let index = 0; index < count; index += 1) {
      const player = players[index];
      if (!player) {
        continue;
      }

      const playerIdKey = normalizeLookupText(player.playerId);
      if (playerIdKey && !byId.has(playerIdKey)) {
        byId.set(playerIdKey, player);
      }

      const playerNameKey = normalizeLookupText(player.playerName);
      if (playerNameKey && !byName.has(playerNameKey)) {
        byName.set(playerNameKey, player);
      }

      const teamNameKey = buildCombatPlayerLookupKey(player.teamId, player.playerName);
      if (teamNameKey && !byTeamAndName.has(teamNameKey)) {
        byTeamAndName.set(teamNameKey, player);
      }
    }

    return {
      byId,
      byName,
      byTeamAndName,
    };
  }

  function resolveCombatPlayerEntry(lookup, playerId, teamId, playerName) {
    if (!lookup) {
      return null;
    }

    const playerIdKey = normalizeLookupText(playerId);
    if (playerIdKey && lookup.byId.has(playerIdKey)) {
      return lookup.byId.get(playerIdKey) || null;
    }

    const teamNameKey = buildCombatPlayerLookupKey(teamId, playerName);
    if (teamNameKey && lookup.byTeamAndName.has(teamNameKey)) {
      return lookup.byTeamAndName.get(teamNameKey) || null;
    }

    const playerNameKey = normalizeLookupText(playerName);
    if (playerNameKey && lookup.byName.has(playerNameKey)) {
      return lookup.byName.get(playerNameKey) || null;
    }

    return null;
  }

  function applyRecentCombatRoles(players, count, now) {
    if (!Array.isArray(players) || count <= 0) {
      return;
    }

    const combatEvents =
      state.assistSnapshot && Array.isArray(state.assistSnapshot.combatEvents)
        ? state.assistSnapshot.combatEvents
        : [];
    if (combatEvents.length === 0) {
      return;
    }

    const lookup = buildCombatPlayerLookup(players, count);
    for (const event of combatEvents) {
      if (!event) {
        continue;
      }

      const timestamp = toFiniteNumber(event.timestamp, 0) || 0;
      const ageMs = now - timestamp;
      if (ageMs < 0 || ageMs > COMBAT_ROLE_TTL_MS) {
        continue;
      }

      const eventKind = normalizeLookupText(event.kind) || "kill";
      const attacker = resolveCombatPlayerEntry(
        lookup,
        event.killerPlayerId,
        event.killerTeamId,
        event.killerName,
      );
      if (attacker && attacker.state !== "eliminated" && attacker.alive !== false) {
        assignCombatRole(attacker, "attacker", timestamp, ageMs);
      }

      const victim = resolveCombatPlayerEntry(
        lookup,
        event.victimPlayerId,
        event.victimTeamId,
        event.victimName,
      );
      if (!victim) {
        continue;
      }

      if (
        eventKind === "kill" ||
        victim.alive === false ||
        victim.state === "eliminated"
      ) {
        assignCombatRole(victim, "dead", timestamp, ageMs);
        continue;
      }

      assignCombatRole(victim, "victim", timestamp, ageMs);
    }
  }

  function getClusterThresholdWorld(mapDefinition) {
    return Math.max(CLUSTER_MIN_WORLD, resolveWorldSize(mapDefinition) * CLUSTER_WORLD_RATIO);
  }

  function collectTeamClusters(mapDefinition) {
    const clusters = state.teamClusters;
    if (!mapDefinition) {
      clusters.length = 0;
      return clusters;
    }

    const thresholdWorld = getClusterThresholdWorld(mapDefinition);
    let clusterCount = 0;

    for (const [teamId, members] of state.teamMembersById.entries()) {
      if (!teamId || !members || members.length < 2) {
        continue;
      }

      let sumX = 0;
      let sumY = 0;
      for (const member of members) {
        sumX += member.x;
        sumY += member.y;
      }

      const centerX = sumX / members.length;
      const centerY = sumY / members.length;
      let maxDistanceFromCenter = 0;
      let maxPairDistance = 0;

      for (let leftIndex = 0; leftIndex < members.length; leftIndex += 1) {
        const leftMember = members[leftIndex];
        maxDistanceFromCenter = Math.max(
          maxDistanceFromCenter,
          Math.hypot(leftMember.x - centerX, leftMember.y - centerY),
        );

        for (let rightIndex = leftIndex + 1; rightIndex < members.length; rightIndex += 1) {
          const rightMember = members[rightIndex];
          maxPairDistance = Math.max(
            maxPairDistance,
            Math.hypot(leftMember.x - rightMember.x, leftMember.y - rightMember.y),
          );
        }
      }

      if (maxPairDistance > thresholdWorld) {
        continue;
      }

      let cluster = clusters[clusterCount];
      if (!cluster) {
        cluster = {};
        clusters[clusterCount] = cluster;
      }

      cluster.centerX = centerX;
      cluster.centerY = centerY;
      cluster.memberCount = members.length;
      cluster.radiusWorld = maxDistanceFromCenter;
      cluster.teamBranding = members[0].teamBranding || null;
      cluster.teamColor = members[0].teamColor || getTeamColor(teamId);
      cluster.teamId = members[0].teamId || teamId;
      cluster.teamIndex = members[0].teamIndex || ensureTeamDisplayIndex(teamId);
      cluster.teamLogoUrl = members[0].teamLogoUrl || null;
      cluster.teamName = members[0].teamName || null;
      cluster.teamSlot = members[0].teamSlot || null;
      cluster.teamTag = members[0].teamTag || null;
      for (const member of members) {
        member.clusterBadgeVisible = true;
      }
      clusterCount += 1;
    }

    clusters.length = clusterCount;
    return clusters;
  }

  function buildTeamBadgeLabel(source) {
    const label = source && source.playerName ? source.playerName : "";
    return truncateLabel(label, 16);
  }

  function buildPlayerIconText(source) {
    const name = source && source.playerName ? String(source.playerName).trim() : "";
    if (!name) {
      return "?";
    }

    const letters = name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2);
    return (letters || name.slice(0, 1) || "?").toUpperCase();
  }

  function drawImageCover(imageElement, x, y, width, height) {
    const imageWidth = imageElement.naturalWidth || imageElement.width || 1;
    const imageHeight = imageElement.naturalHeight || imageElement.height || 1;
    const scale = Math.max(width / imageWidth, height / imageHeight);
    const drawWidth = imageWidth * scale;
    const drawHeight = imageHeight * scale;
    const drawX = x + (width - drawWidth) / 2;
    const drawY = y + (height - drawHeight) / 2;
    context.drawImage(imageElement, drawX, drawY, drawWidth, drawHeight);
  }

  function drawLogoCircle(logoUrl, centerX, centerY, size, color, fallbackText, alpha) {
    const radius = size / 2;
    const scale = state.renderMetrics.scale || 1;
    const logoInset = Math.max(1.75 * scale, Math.min(4 * scale, radius * 0.2));
    const logoSize = Math.max(1, size - logoInset * 2);
    const imageRecord = getTeamLogoImage(logoUrl || DEFAULT_TEAM_LOGO_URL);
    const fallbackRecord =
      logoUrl && logoUrl !== DEFAULT_TEAM_LOGO_URL ? getTeamLogoImage(DEFAULT_TEAM_LOGO_URL) : null;
    const drawableImageRecord =
      imageRecord && imageRecord.status === "ready"
        ? imageRecord
        : fallbackRecord && fallbackRecord.status === "ready"
          ? fallbackRecord
          : null;

    context.save();
    context.globalAlpha = alpha;
    context.shadowColor = "rgba(2, 6, 12, 0.82)";
    context.shadowBlur = Math.max(2, 2.4 * scale);
    context.shadowOffsetY = Math.max(1, 1.1 * scale);
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.fillStyle = "rgba(148, 163, 184, 0.96)";
    context.fill();
    context.shadowColor = "transparent";
    context.shadowBlur = 0;
    context.shadowOffsetY = 0;
    context.lineWidth = Math.max(1.45, 1.25 * scale);
    context.strokeStyle = "rgba(2, 6, 12, 0.92)";
    context.stroke();
    context.beginPath();
    context.arc(centerX, centerY, Math.max(1, radius - 1.35 * scale), 0, Math.PI * 2);
    context.strokeStyle = "rgba(248, 250, 252, 0.86)";
    context.lineWidth = Math.max(1, state.renderMetrics.scale);
    context.stroke();
    context.beginPath();
    context.arc(centerX, centerY, Math.max(1, radius - 0.5 * scale), 0, Math.PI * 2);
    context.strokeStyle = colorWithAlpha(color || "#FFFFFF", 0.72);
    context.lineWidth = Math.max(1, 0.8 * scale);
    context.stroke();

    if (drawableImageRecord) {
      context.save();
      context.beginPath();
      context.arc(centerX, centerY, Math.max(1, radius - logoInset), 0, Math.PI * 2);
      context.clip();
      context.shadowColor = "rgba(2, 6, 12, 0.7)";
      context.shadowBlur = Math.max(1, 1.1 * scale);
      context.shadowOffsetY = Math.max(0.5, 0.6 * scale);
      drawImageCover(
        drawableImageRecord.image,
        centerX - logoSize / 2,
        centerY - logoSize / 2,
        logoSize,
        logoSize,
      );
      context.restore();
    } else {
      context.font = state.renderMetrics.teamBadgeFont || state.renderMetrics.labelFont;
      context.lineWidth = Math.max(1, 1.4 * scale);
      context.strokeStyle = "rgba(248, 250, 252, 0.8)";
      context.fillStyle = "rgba(2, 6, 12, 0.94)";
      context.textAlign = "center";
      context.textBaseline = "middle";
      const fallbackLabel = String(fallbackText || "?").slice(0, 2).toUpperCase();
      context.strokeText(fallbackLabel, centerX, centerY);
      context.fillText(fallbackLabel, centerX, centerY);
    }

    context.restore();
  }

  function _drawPlayerInitialCircle(source, centerX, centerY, size, color, alpha) {
    const radius = size / 2;
    const imageCandidates = buildPlayerImageCandidates(source);
    let imageRecord = null;
    for (const imageCandidate of imageCandidates) {
      const candidateRecord = getTeamLogoImage(imageCandidate);
      if (candidateRecord && candidateRecord.status === "ready") {
        imageRecord = candidateRecord;
        break;
      }
    }

    context.save();
    context.globalAlpha = alpha;
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.fillStyle = colorWithAlpha(color || "#FFFFFF", 0.72);
    context.fill();
    context.lineWidth = Math.max(1, state.renderMetrics.scale);
    context.strokeStyle = "rgba(2, 6, 12, 0.78)";
    context.stroke();

    if (imageRecord) {
      context.save();
      context.beginPath();
      context.arc(centerX, centerY, Math.max(1, radius - 1), 0, Math.PI * 2);
      context.clip();
      drawImageCover(
        imageRecord.image,
        centerX - radius + 1,
        centerY - radius + 1,
        Math.max(1, size - 2),
        Math.max(1, size - 2),
      );
      context.restore();
    } else {
      context.font = `800 ${Math.max(7, Math.round(size * 0.42))}px ${OBS_LABEL_FONT_STACK}`;
      context.fillStyle = "rgba(2, 6, 12, 0.94)";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(buildPlayerIconText(source), centerX, centerY + 0.4 * state.renderMetrics.scale);
    }
    context.restore();
  }

  function drawCombatRoleMarker(source, left, top, badgeWidth, badgeHeight, width, height, alpha) {
    const role = source?.combatRole;
    if (!role || role === "dead") {
      return;
    }

    const metrics = state.renderMetrics;
    const strength = clamp01(toFiniteNumber(source.combatRoleStrength, 0.82) || 0.82);
    const chipRadius =
      role === "attacker"
        ? Math.max(5.4 * metrics.scale, badgeHeight * 0.24)
        : Math.max(4.2 * metrics.scale, badgeHeight * 0.18);
    const chipX = clamp(
      left + badgeWidth - chipRadius * 0.4,
      chipRadius + 2,
      width - chipRadius - 2,
    );
    const chipY = clamp(
      top + chipRadius * 0.65,
      chipRadius + 2,
      height - chipRadius - 2,
    );
    const roleColor = role === "attacker" ? "#22D3EE" : "#FB7185";

    context.save();
    context.globalAlpha = alpha * (0.54 + strength * 0.4);
    context.beginPath();
    context.arc(chipX, chipY, chipRadius, 0, Math.PI * 2);
    context.fillStyle = "rgba(2, 6, 12, 0.9)";
    context.fill();
    context.lineWidth = Math.max(1, metrics.scale);
    context.strokeStyle = colorWithAlpha(roleColor, 0.92);
    context.stroke();

    if (role === "attacker") {
      const arm = chipRadius * 0.58;
      context.beginPath();
      context.moveTo(chipX - arm, chipY);
      context.lineTo(chipX + arm, chipY);
      context.moveTo(chipX, chipY - arm);
      context.lineTo(chipX, chipY + arm);
      context.lineWidth = Math.max(1.1, metrics.scale * 1.2);
      context.strokeStyle = colorWithAlpha("#F8FAFC", 0.96);
      context.stroke();
    } else {
      context.beginPath();
      context.arc(chipX, chipY, Math.max(1.2, chipRadius * 0.34), 0, Math.PI * 2);
      context.fillStyle = colorWithAlpha("#F8FAFC", 0.94);
      context.fill();
    }

    context.restore();
  }

  function drawTeamIdentityBadge(source, anchorX, anchorY, width, height, options = {}) {
    if (!state.showTeamLogos || !source) {
      return false;
    }

    const branding = source.teamBranding || null;
    const logoUrl = source.teamLogoUrl || (branding && branding.logoUrl) || DEFAULT_TEAM_LOGO_URL;
    const label = buildTeamBadgeLabel(source);
    if (!logoUrl && !label) {
      return false;
    }

    const metrics = state.renderMetrics;
    const alpha =
      source.state === "eliminated" ? 0.38 : source.state === "knocked" ? 0.78 : 0.98;
    const compact = options.compact === true;
    const logoSize = compact ? metrics.teamBadgeLogoSize * 0.9 : metrics.teamBadgeLogoSize;
    const badgeHeight = compact ? logoSize + 5 * metrics.scale : metrics.teamBadgeHeight;
    const paddingX = metrics.teamBadgePaddingX;
    context.save();
    context.font = metrics.teamBadgeFont || metrics.labelFont;
    const labelWidth =
      compact || !label
        ? 0
        : Math.min(Math.max(96, 130 * metrics.scale), context.measureText(label).width);
    const badgeWidth =
      compact || !label
        ? logoSize + paddingX
        : logoSize + labelWidth + paddingX * 3;
    const verticalOffset = badgeHeight * 0.5;
    const left = clamp(anchorX - badgeWidth / 2, 2, Math.max(2, width - badgeWidth - 2));
    const top = clamp(anchorY - verticalOffset, 2, Math.max(2, height - badgeHeight - 2));
    const accent = source.teamColor || (branding && branding.color) || "#FFFFFF";

    context.globalAlpha = alpha;
    context.beginPath();
    drawRoundedRectPath(context, left, top, badgeWidth, badgeHeight, 6 * metrics.scale);
    context.shadowColor = "rgba(2, 6, 12, 0.5)";
    context.shadowBlur = Math.max(3, 4 * metrics.scale);
    context.shadowOffsetY = Math.max(1, 1.2 * metrics.scale);
    context.fillStyle = source.state === "knocked" ? "rgba(15, 23, 42, 0.9)" : "rgba(2, 6, 12, 0.88)";
    context.fill();
    context.shadowColor = "transparent";
    context.shadowBlur = 0;
    context.shadowOffsetY = 0;
    context.lineWidth = Math.max(1, metrics.scale);
    context.strokeStyle = colorWithAlpha(accent, 0.98);
    context.stroke();

    const logoCenterX = left + paddingX + logoSize / 2;
    const logoCenterY = top + badgeHeight / 2;
    drawLogoCircle(
      logoUrl,
      logoCenterX,
      logoCenterY,
      logoSize,
      accent,
      label || "?",
      1,
    );

    if (!compact && label) {
      context.font = metrics.teamBadgeFont || metrics.labelFont;
      context.textAlign = "left";
      context.textBaseline = "middle";
      context.lineWidth = Math.max(3, metrics.scale * 2.4);
      context.strokeStyle = "rgba(2, 6, 12, 0.98)";
      context.fillStyle = "rgba(248, 250, 252, 0.98)";
      const textX = left + paddingX * 2 + logoSize;
      const textY = top + badgeHeight / 2;
      context.strokeText(label, textX, textY);
      context.fillText(label, textX, textY);
    }

    drawCombatRoleMarker(source, left, top, badgeWidth, badgeHeight, width, height, alpha);
    context.restore();
    return true;
  }

  function buildLegendTeamDisplayName(row) {
    if (row.teamName) {
      return row.teamName;
    }
    if (row.teamIndex) {
      return DEFAULT_TEAM_NAME;
    }
    return DEFAULT_TEAM_NAME;
  }

  function getOrCreateLegendTeamRow(rowsByKey, teamId, teamSlot, branding) {
    const key = getTeamGroupingKey(teamId, teamSlot, branding);
    if (!key) {
      return null;
    }

    let row = rowsByKey.get(key);
    if (!row) {
      row = {
        teamId: branding && branding.teamId ? branding.teamId : teamId || null,
        teamIndex: getTeamDisplayIndex(teamId, teamSlot, branding),
        teamName: branding && branding.teamName ? branding.teamName : null,
        teamTag: branding && branding.teamTag ? branding.teamTag : null,
        teamLogoUrl:
          (branding && branding.logoUrl) || DEFAULT_TEAM_LOGO_URL,
        teamColor: (branding && branding.color) || (teamId ? getTeamColor(teamId) : "#E2E8F0"),
        alivePlayers: 0,
        totalPlayers: 0,
        kills: 0,
      };
      rowsByKey.set(key, row);
    } else {
      row.teamId = row.teamId || (branding && branding.teamId) || teamId || null;
      row.teamIndex =
        row.teamIndex || getTeamDisplayIndex(teamId, teamSlot, branding);
      row.teamName = row.teamName || (branding && branding.teamName) || null;
      row.teamTag = row.teamTag || (branding && branding.teamTag) || null;
      if (
        (!row.teamLogoUrl || row.teamLogoUrl === DEFAULT_TEAM_LOGO_URL) &&
        branding &&
        branding.logoUrl
      ) {
        row.teamLogoUrl = branding.logoUrl;
      } else {
        row.teamLogoUrl = row.teamLogoUrl || DEFAULT_TEAM_LOGO_URL;
      }
      row.teamColor =
        (branding && branding.color) ||
        row.teamColor ||
        (teamId ? getTeamColor(teamId) : "#E2E8F0");
    }

    return row;
  }

  function buildLegendPlayerSources() {
    const packetPlayers =
      state.playersPacket && Array.isArray(state.playersPacket.players)
        ? state.playersPacket.players
        : [];
    if (packetPlayers.length > 0) {
      return packetPlayers;
    }

    return Array.from(state.lastPlayerSnapshotById.values());
  }

  function buildLegendRows() {
    const rowsByKey = new Map();
    const seenPlayerIds = new Set();

    for (const snapshot of buildLegendPlayerSources()) {
      if (!snapshot) {
        continue;
      }

      const playerId = normalizeText(snapshot.playerId);
      if (playerId && seenPlayerIds.has(playerId)) {
        continue;
      }
      if (playerId) {
        seenPlayerIds.add(playerId);
      }

      const teamId = normalizeText(snapshot.teamId) || null;
      const teamSlot = normalizeTeamSlot(snapshot.teamSlot ?? snapshot.slot);
      const branding = getTeamBranding(teamId, teamSlot);
      const row = getOrCreateLegendTeamRow(rowsByKey, teamId, teamSlot, branding);
      if (!row) {
        continue;
      }

      row.totalPlayers += 1;
      row.kills += Math.max(0, Math.trunc(toFiniteNumber(snapshot.kills, 0) || 0));
      if (snapshot.alive === true) {
        row.alivePlayers += 1;
      }
    }

    const rows = [...rowsByKey.values()];
    rows.sort((left, right) => {
      if (right.alivePlayers !== left.alivePlayers) {
        return right.alivePlayers - left.alivePlayers;
      }
      if (right.kills !== left.kills) {
        return right.kills - left.kills;
      }
      const leftIndex = toFiniteNumber(left.teamIndex, Number.MAX_SAFE_INTEGER);
      const rightIndex = toFiniteNumber(right.teamIndex, Number.MAX_SAFE_INTEGER);
      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }
      return buildLegendTeamDisplayName(left).localeCompare(buildLegendTeamDisplayName(right));
    });
    return rows;
  }

  function buildLegendMarkup(rows) {
    if (!rows.length) {
      return '<div class="legend-empty">Waiting for teams.</div>';
    }

    return rows
      .map((row) => {
        const displayName = buildLegendTeamDisplayName(row);
        const slotLabel = row.teamIndex ? String(row.teamIndex) : "--";
        const eliminated = row.alivePlayers <= 0;
        return `
          <div class="legend-item" data-eliminated="${eliminated ? "true" : "false"}">
            <div class="legend-slot">${escapeHtml(slotLabel)}</div>
            <img class="legend-logo" src="${escapeAttribute(row.teamLogoUrl || DEFAULT_TEAM_LOGO_URL)}" alt="${escapeAttribute(displayName)}" onerror="this.onerror=null;this.src='${escapeAttribute(DEFAULT_TEAM_LOGO_URL)}';" />
            <div class="legend-copy">
              <div class="legend-name">${escapeHtml(displayName)}</div>
            </div>
            <div class="legend-stats">
              <span class="legend-stat">
                <span class="legend-stat-label">A</span>
                <span class="legend-stat-value">${escapeHtml(String(Math.max(0, row.alivePlayers)))}</span>
              </span>
              <span class="legend-stat">
                <span class="legend-stat-label">K</span>
                <span class="legend-stat-value">${escapeHtml(String(Math.max(0, row.kills)))}</span>
              </span>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function getCommentaryTeamKey(player) {
    return (
      player.teamGroupKey ||
      normalizeText(player.teamId) ||
      (player.teamSlot ? `slot:${player.teamSlot}` : null) ||
      (player.teamIndex ? `team:${player.teamIndex}` : null) ||
      null
    );
  }

  function buildCommentaryTeamLabel(source) {
    const slot = normalizeTeamSlot(source && (source.teamIndex ?? source.teamSlot ?? source.slot));
    const displayName = buildLegendTeamDisplayName(source || {});
    const legacySlotLabel = slot !== null ? ["Team", slot].join(" ") : null;
    if (slot !== null && displayName && displayName !== legacySlotLabel) {
      return `S${slot} ${truncateLabel(displayName, 18)}`;
    }
    if (slot !== null) {
      return `S${slot}`;
    }
    if (source && source.teamId) {
      return truncateLabel(formatTeamLabel(source.teamId), 18);
    }
    return "Unknown";
  }

  function buildCommentaryTeamList(teams, maxCount = 3) {
    const labels = teams.slice(0, maxCount).map((team) => team.label);
    if (teams.length > maxCount) {
      labels.push(`+${teams.length - maxCount}`);
    }
    return labels.join(", ");
  }

  function getOutsideCircleTeams(frame) {
    const circle = frame && frame.animatedCircle ? frame.animatedCircle : null;
    if (!circle || !Number.isFinite(circle.centerX) || !Number.isFinite(circle.centerY)) {
      return [];
    }

    const radius = toFiniteNumber(circle.radius);
    if (radius === null || radius <= 0 || !Array.isArray(frame.players)) {
      return [];
    }

    const teamsByKey = new Map();
    for (const player of frame.players) {
      if (!player || player.alive === false || player.state === "eliminated") {
        continue;
      }
      if (!Number.isFinite(player.x) || !Number.isFinite(player.y)) {
        continue;
      }
      const distance = Math.hypot(player.x - circle.centerX, player.y - circle.centerY);
      if (distance <= radius) {
        continue;
      }

      const key = getCommentaryTeamKey(player);
      if (!key) {
        continue;
      }

      let team = teamsByKey.get(key);
      if (!team) {
        team = {
          key,
          label: buildCommentaryTeamLabel(player),
          maxDistance: 0,
          playerCount: 0,
        };
        teamsByKey.set(key, team);
      }
      team.maxDistance = Math.max(team.maxDistance, distance - radius);
      team.playerCount += 1;
    }

    return [...teamsByKey.values()].sort((left, right) => {
      if (right.playerCount !== left.playerCount) {
        return right.playerCount - left.playerCount;
      }
      return right.maxDistance - left.maxDistance;
    });
  }

  function getSplitTeamSummaries(frame, mapDefinition) {
    if (!frame || !Array.isArray(frame.players) || !mapDefinition) {
      return [];
    }

    const worldSize = resolveWorldSize(mapDefinition);
    const splitThreshold = Math.max(18000, worldSize * 0.055);
    const teamsByKey = new Map();

    for (const player of frame.players) {
      if (!player || player.alive === false || player.state === "eliminated") {
        continue;
      }
      const key = getCommentaryTeamKey(player);
      if (!key) {
        continue;
      }

      let team = teamsByKey.get(key);
      if (!team) {
        team = {
          key,
          label: buildCommentaryTeamLabel(player),
          players: [],
        };
        teamsByKey.set(key, team);
      }
      team.players.push(player);
    }

    const splitTeams = [];
    for (const team of teamsByKey.values()) {
      if (team.players.length < 2) {
        continue;
      }

      let maxDistance = 0;
      for (let leftIndex = 0; leftIndex < team.players.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < team.players.length; rightIndex += 1) {
          const left = team.players[leftIndex];
          const right = team.players[rightIndex];
          maxDistance = Math.max(maxDistance, Math.hypot(left.x - right.x, left.y - right.y));
        }
      }

      if (maxDistance >= splitThreshold) {
        splitTeams.push({
          label: team.label,
          maxDistance,
        });
      }
    }

    return splitTeams.sort((left, right) => right.maxDistance - left.maxDistance);
  }

  function buildCommentaryItems(frame) {
    const now = frame && frame.now ? frame.now : Date.now();
    const mapDefinition = getMapDefinition();
    const items = [];
    const assistSnapshot = state.assistSnapshot;

    if (
      assistSnapshot &&
      assistSnapshot.bestSuggestion &&
      !isAssistSuggestionStale(assistSnapshot, now)
    ) {
      const suggestion = assistSnapshot.bestSuggestion;
      items.push({
        tone: "fight",
        label: "Fight",
        line: `${formatAssistMatchup(suggestion.teamIds)} | ${
          suggestion.reason || "active fight developing"
        }`,
      });
    }

    if (frame.remainingMs !== null && frame.remainingMs <= 60_000) {
      items.push({
        tone: "zone",
        label: "Zone",
        line: `Zone closes in ${formatCompactDuration(frame.remainingMs)}; call the edge rotations.`,
      });
    } else if (frame.animatedCircle && frame.nextCircle) {
      const shiftDistance = Math.hypot(
        frame.nextCircle.centerX - frame.animatedCircle.centerX,
        frame.nextCircle.centerY - frame.animatedCircle.centerY,
      );
      if (shiftDistance >= Math.max(12000, frame.animatedCircle.radius * 0.2)) {
        items.push({
          tone: "zone",
          label: "Shift",
          line: `Next circle shifts ${Math.round(shiftDistance / 100)}m from current center.`,
        });
      }
    }

    const outsideTeams = getOutsideCircleTeams(frame);
    if (outsideTeams.length > 0) {
      const maxDistance = Math.round((outsideTeams[0].maxDistance || 0) / 100);
      items.push({
        tone: "danger",
        label: "Rotation",
        line: `${buildCommentaryTeamList(outsideTeams)} outside white circle; farthest ${maxDistance}m out.`,
      });
    }

    const splitTeams = getSplitTeamSummaries(frame, mapDefinition);
    if (splitTeams.length > 0) {
      items.push({
        tone: "split",
        label: "Split",
        line: `${splitTeams[0].label} split across ${Math.round(
          splitTeams[0].maxDistance / 100,
        )}m; possible isolation angle.`,
      });
    }

    const topFragTeam = buildLegendRows()
      .filter((row) => row.kills > 0)
      .sort((left, right) => {
        if (right.kills !== left.kills) {
          return right.kills - left.kills;
        }
        const leftIndex = toFiniteNumber(left.teamIndex, Number.MAX_SAFE_INTEGER);
        const rightIndex = toFiniteNumber(right.teamIndex, Number.MAX_SAFE_INTEGER);
        return leftIndex - rightIndex;
      })[0];
    if (topFragTeam) {
      items.push({
        tone: "kills",
        label: "Kills",
        line: `${buildCommentaryTeamLabel(topFragTeam)} leads with ${topFragTeam.kills} kills; ${topFragTeam.alivePlayers} alive.`,
      });
    }

    if (items.length === 0) {
      const aliveTeams = new Set();
      const alivePlayers = Array.isArray(frame.players)
        ? frame.players.filter((player) => player && player.alive !== false && player.state !== "eliminated")
        : [];
      for (const player of alivePlayers) {
        const key = getCommentaryTeamKey(player);
        if (key) {
          aliveTeams.add(key);
        }
      }

      items.push({
        tone: "idle",
        label: alivePlayers.length > 0 ? "Live" : "Standby",
        line:
          alivePlayers.length > 0
            ? `${aliveTeams.size} teams active; waiting for the next fight or zone pressure.`
            : "Waiting for live telemetry.",
      });
    }

    return items.slice(0, 6);
  }

  function buildCommentaryMarkup(frame) {
    return buildCommentaryItems(frame)
      .map(
        (item) => `
          <div class="commentary-card commentary-card--${escapeAttribute(item.tone || "idle")}">
            <div class="commentary-card-label">${escapeHtml(item.label || "Cue")}</div>
            <div class="commentary-card-line">${escapeHtml(item.line || "")}</div>
          </div>
        `,
      )
      .join("");
  }

  function getDistanceTone(distanceMeters) {
    if (distanceMeters <= 80) {
      return "hot";
    }
    if (distanceMeters <= 160) {
      return "close";
    }
    if (distanceMeters <= 280) {
      return "watch";
    }
    return "wide";
  }

  function getDistanceNote(distanceMeters) {
    if (distanceMeters <= 80) {
      return "Immediate fight";
    }
    if (distanceMeters <= 160) {
      return "Close contact";
    }
    if (distanceMeters <= 280) {
      return "Watch angle";
    }
    return "Rotation gap";
  }

  function collectDistanceTeamGroups(frame) {
    const groups = new Map();
    const players = frame && Array.isArray(frame.players) ? frame.players : [];
    for (const player of players) {
      if (!player || player.alive === false || player.state === "eliminated") {
        continue;
      }
      if (!Number.isFinite(player.x) || !Number.isFinite(player.y)) {
        continue;
      }

      const key = getCommentaryTeamKey(player);
      if (!key) {
        continue;
      }

      let group = groups.get(key);
      if (!group) {
        group = {
          key,
          label: buildCommentaryTeamLabel(player),
          players: [],
        };
        groups.set(key, group);
      }
      group.players.push(player);
    }

    return [...groups.values()];
  }

  function buildDistanceRows(frame) {
    const groups = collectDistanceTeamGroups(frame);
    if (groups.length < 2) {
      return [];
    }

    const rows = [];
    for (let leftIndex = 0; leftIndex < groups.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < groups.length; rightIndex += 1) {
        const left = groups[leftIndex];
        const right = groups[rightIndex];
        let minDistance = Number.POSITIVE_INFINITY;
        let nearestLeftPlayer = null;
        let nearestRightPlayer = null;

        for (const leftPlayer of left.players) {
          for (const rightPlayer of right.players) {
            const distance = Math.hypot(leftPlayer.x - rightPlayer.x, leftPlayer.y - rightPlayer.y);
            if (distance < minDistance) {
              minDistance = distance;
              nearestLeftPlayer = leftPlayer;
              nearestRightPlayer = rightPlayer;
            }
          }
        }

        if (!Number.isFinite(minDistance)) {
          continue;
        }

        const distanceMeters = Math.max(0, Math.round(minDistance / 100));
        rows.push({
          distanceMeters,
          leftAlive: left.players.length,
          leftLabel: left.label,
          leftPlayerName: nearestLeftPlayer && nearestLeftPlayer.playerName,
          rightAlive: right.players.length,
          rightLabel: right.label,
          rightPlayerName: nearestRightPlayer && nearestRightPlayer.playerName,
          tone: getDistanceTone(distanceMeters),
        });
      }
    }

    return rows.sort((left, right) => left.distanceMeters - right.distanceMeters);
  }

  function updateLegendPanel(frame) {
    legendPanel.hidden = !state.showLegend;
    if (!state.showLegend) {
      return;
    }

    if (frame.now - state.lastLegendRefreshAt < DEBUG_REFRESH_MS) {
      return;
    }

    const rows = buildLegendRows();
    const nextMarkup = buildLegendMarkup(rows);
    if (nextMarkup !== state.legendMarkup) {
      legendList.innerHTML = nextMarkup;
      state.legendMarkup = nextMarkup;
    }

    const aliveTeams = rows.filter((row) => row.alivePlayers > 0).length;
    const metaLabel = rows.length ? `${aliveTeams} alive | ${rows.length} teams` : "--";
    if (metaLabel !== state.legendMetaLabel) {
      legendMeta.textContent = metaLabel;
      state.legendMetaLabel = metaLabel;
    }

    state.lastLegendRefreshAt = frame.now;
  }

  function updateCommentaryPanel(frame) {
    commentaryPanel.hidden = !state.commentaryFlags.showPanel;
    if (!state.commentaryFlags.showPanel) {
      return;
    }

    if (frame.now - state.lastCommentaryRefreshAt < COMMENTARY_REFRESH_MS) {
      return;
    }

    const markup = buildCommentaryMarkup(frame);
    if (markup !== state.commentaryMarkup) {
      commentaryList.innerHTML = markup;
      state.commentaryMarkup = markup;
    }

    const metaLabel = state.connectionStatus === "connected" ? "Live" : "Standby";
    if (metaLabel !== state.commentaryMetaLabel) {
      commentaryMeta.textContent = metaLabel;
      state.commentaryMetaLabel = metaLabel;
    }

    state.lastCommentaryRefreshAt = frame.now;
  }

  function updateDistancePanel(frame) {
    distancePanel.hidden = !state.distanceFlags.showPanel;
    if (!state.distanceFlags.showPanel) {
      return;
    }

    if (frame.now - state.lastDistanceRefreshAt < DISTANCE_REFRESH_MS) {
      return;
    }

    const rows = buildDistanceRows(frame);
    const markup = rows.length
      ? rows
          .slice(0, 10)
          .map((row) => {
            const playerHint =
              row.leftPlayerName && row.rightPlayerName
                ? `${truncateLabel(row.leftPlayerName, 14)} / ${truncateLabel(row.rightPlayerName, 14)}`
                : `${row.leftAlive} alive / ${row.rightAlive} alive`;
            return `
              <div class="distance-row distance-row--${escapeAttribute(row.tone)}">
                <div class="distance-row-main">
                  <span class="distance-team">${escapeHtml(row.leftLabel)}</span>
                  <span class="distance-versus">vs</span>
                  <span class="distance-team">${escapeHtml(row.rightLabel)}</span>
                </div>
                <div class="distance-row-meta">
                  <span>${escapeHtml(getDistanceNote(row.distanceMeters))}</span>
                  <span>${escapeHtml(playerHint)}</span>
                </div>
                <div class="distance-value">${escapeHtml(String(row.distanceMeters))}m</div>
              </div>
            `;
          })
          .join("")
      : buildEmptyPanelMarkup("Waiting for team distance data.");

    if (markup !== state.distanceMarkup) {
      distanceList.innerHTML = markup;
      state.distanceMarkup = markup;
    }

    const metaLabel = rows.length ? `${rows.length} pairs` : "--";
    if (metaLabel !== state.distanceMetaLabel) {
      distanceMeta.textContent = metaLabel;
      state.distanceMetaLabel = metaLabel;
    }

    state.lastDistanceRefreshAt = frame.now;
  }

  function syncSideRailVisibility() {
    const visible = state.showLegend || state.commentaryFlags.showPanel;
    sideRail.hidden = !visible;
    sideRail.dataset.commentaryVisible = state.commentaryFlags.showPanel ? "true" : "false";
    rightRail.hidden = !state.distanceFlags.showPanel;
    widgetShell.dataset.leftVisible = visible ? "true" : "false";
    widgetShell.dataset.distanceVisible = state.distanceFlags.showPanel ? "true" : "false";
  }

  function drawPlayerDebugText(player, x, y) {
    if (!state.debug || (!state.debugFlags.showPlayerLabels && !state.debugFlags.showCoords)) {
      return;
    }

    const fragments = [];
    if (state.debugFlags.showPlayerLabels) {
      fragments.push(player.teamId || player.playerId || "player");
    }
    if (state.debugFlags.showCoords) {
      fragments.push(`${Math.round(player.x)},${Math.round(player.y)}`);
    }
    if (fragments.length === 0) {
      return;
    }

    context.save();
    context.font = state.renderMetrics.debugFont;
    context.lineJoin = "round";
    context.lineWidth = Math.max(2, state.renderMetrics.scale * 1.8);
    context.strokeStyle = "rgba(5, 9, 14, 0.94)";
    context.fillStyle = "rgba(248, 250, 252, 0.92)";
    context.textAlign = "left";
    context.textBaseline = "top";
    const labelX = x + state.renderMetrics.markerRadius + 8 * state.renderMetrics.scale;
    const labelY = y + 6 * state.renderMetrics.scale;
    const text = fragments.join(" | ");
    context.strokeText(text, labelX, labelY);
    context.fillText(text, labelX, labelY);
    context.restore();
  }

  function drawPlayerMarker(player, mapDefinition, width, height) {
    const x = worldToPixelX(player.x, mapDefinition, width);
    const y = worldToPixelY(player.y, mapDefinition, height);
    drawTeamIdentityBadge(player, x, y, width, height);
    drawPlayerDebugText(player, x, y);
  }

  function drawPlayers(players, mapDefinition, width, height) {
    if (!mapDefinition || players.length === 0) {
      return;
    }

    for (const player of players) {
      if (player.state !== "eliminated") {
        continue;
      }
      if (!state.debug) {
        continue;
      }
      drawPlayerMarker(player, mapDefinition, width, height);
    }

    for (const player of players) {
      if (player.state === "eliminated") {
        continue;
      }
      drawPlayerMarker(player, mapDefinition, width, height);
    }
  }

  function drawTeamClusters(clusters, mapDefinition, width, height) {
    if (!mapDefinition || clusters.length === 0) {
      return;
    }
    if (!state.debug && !state.styleConfig.showClusterRings) {
      return;
    }

    const metrics = state.renderMetrics;

    for (const cluster of clusters) {
      const x = worldToPixelX(cluster.centerX, mapDefinition, width);
      const y = worldToPixelY(cluster.centerY, mapDefinition, height);
      const radiusPx =
        Math.max(
          metrics.clusterMinRadiusPx,
          worldRadiusToPixelRadius(cluster.radiusWorld, mapDefinition, width, height) +
            metrics.clusterPaddingPx +
            metrics.markerRadius,
        );

      context.save();
      context.beginPath();
      context.arc(x, y, radiusPx, 0, Math.PI * 2);
      context.lineWidth = metrics.clusterStrokeWidth;
      context.strokeStyle = colorWithAlpha(cluster.teamColor, state.debug ? 0.55 : 0.32);
      context.stroke();
      context.restore();

      if (state.debug) {
        const radiusMeters = Math.round(cluster.radiusWorld / 100);
        const debugText = `T${cluster.teamIndex || "?"} ${radiusMeters}m`;
        context.save();
        context.font = metrics.clusterDebugFont;
        context.lineJoin = "round";
        context.lineWidth = Math.max(2, metrics.scale * 1.8);
        context.strokeStyle = "rgba(5, 9, 14, 0.94)";
        context.fillStyle = colorWithAlpha(cluster.teamColor, 0.94);
        context.textAlign = "left";
        context.textBaseline = "middle";
        context.strokeText(debugText, x + radiusPx + 6, y);
        context.fillText(debugText, x + radiusPx + 6, y);
        context.restore();
      }
    }
  }

  function _drawKillPings(now, mapDefinition, width, height) {
    if (!mapDefinition || state.killPings.length === 0) {
      return 0;
    }

    const metrics = state.renderMetrics;
    let writeIndex = 0;

    for (let readIndex = 0; readIndex < state.killPings.length; readIndex += 1) {
      const ping = state.killPings[readIndex];
      const age = now - ping.startedAt;
      if (age < 0 || age > KILL_PING_TTL_MS) {
        continue;
      }

      state.killPings[writeIndex] = ping;
      writeIndex += 1;

      const progress = clamp01(age / KILL_PING_TTL_MS);
      const alpha = 1 - progress;
      const accent = ping.teamId ? getTeamColor(ping.teamId) : "#FFFFFF";
      const x = worldToPixelX(ping.x, mapDefinition, width);
      const y = worldToPixelY(ping.y, mapDefinition, height);
      const ringRadius = metrics.killPingMinRadius + metrics.killPingMaxRadius * progress;

      context.save();
      context.globalAlpha = alpha;
      context.beginPath();
      context.arc(x, y, ringRadius, 0, Math.PI * 2);
      context.lineWidth = lerp(4.25, 1.2, progress) * metrics.scale;
      context.strokeStyle = "rgba(255, 255, 255, 0.96)";
      context.shadowColor = colorWithAlpha(accent, 0.78 * alpha);
      context.shadowBlur = metrics.markerGlowBlur + 12 * metrics.scale;
      context.stroke();

      context.beginPath();
      context.arc(x, y, Math.max(metrics.killPingMinRadius * 0.55, ringRadius * 0.22), 0, Math.PI * 2);
      context.shadowBlur = 0;
      context.fillStyle = colorWithAlpha(accent, 0.26 * alpha);
      context.fill();

      context.beginPath();
      context.arc(x, y, Math.max(metrics.killPingMinRadius, ringRadius * 0.68), 0, Math.PI * 2);
      context.lineWidth = Math.max(1, 1.1 * metrics.scale);
      context.strokeStyle = colorWithAlpha(accent, 0.76 * alpha);
      context.stroke();
      context.restore();
    }

    state.killPings.length = writeIndex;
    return writeIndex;
  }

  function drawCircleDiagnostics(zone, animatedCircle, nextCircle, mapDefinition, width, height) {
    if (!state.debug || !state.debugFlags.showCircleAnchors || !mapDefinition) {
      return;
    }

    const rawScaleOptions = {
      detectedScaleFactor: getDetectedScaleFactor(),
    };

    if (zone && zone.raw && zone.raw.currentCircle) {
      drawCrosshair(
        zone.raw.currentCircle.centerX ?? zone.raw.currentCircle.x,
        zone.raw.currentCircle.centerY ?? zone.raw.currentCircle.y,
        mapDefinition,
        width,
        height,
        {
          label: "raw",
          size: 7,
          strokeStyle: "rgba(125, 211, 252, 0.95)",
        },
        rawScaleOptions,
      );
    }

    if (animatedCircle) {
      drawCrosshair(
        animatedCircle.centerX,
        animatedCircle.centerY,
        mapDefinition,
        width,
        height,
        {
          label: "anim",
          size: 8,
          strokeStyle: "rgba(96, 165, 250, 0.98)",
        },
      );
    }

    if (nextCircle) {
      drawCrosshair(
        nextCircle.centerX,
        nextCircle.centerY,
        mapDefinition,
        width,
        height,
        {
          label: "next",
          size: 8,
          strokeStyle: "rgba(248, 250, 252, 0.94)",
        },
      );
    }
  }

  function isHeartbeatStale(now) {
    return Boolean(
      state.connectionStatus === "connected" &&
        state.lastHeartbeatAt &&
        now - state.lastHeartbeatAt > 15000,
    );
  }

  function getConnectionLabel(now) {
    if (state.connectionStatus === "connected" && isHeartbeatStale(now)) {
      return "connected (stale)";
    }

    return state.connectionStatus;
  }

  function updateStatusPill(now) {
    const mapDefinition = getMapDefinition();
    let label = "Connecting...";

    if (!mapDefinition) {
      label = "Waiting for map context";
    } else if (!mapDefinition.assetAvailable) {
      label = "Map asset missing";
    } else if (!hasLoadedImage()) {
      label = "Loading map image";
    } else if (state.connectionStatus === "connected") {
      label = isHeartbeatStale(now) ? "Telemetry stale" : "Live telemetry";
    } else if (state.connectionStatus === "error") {
      label = "Connection error";
    } else if (state.connectionStatus === "disconnected") {
      label = "Disconnected";
    }

    const text = mapDefinition ? `${mapDefinition.label} | ${label}` : label;
    if (text !== state.lastStatusLabel) {
      statusPill.textContent = text;
      state.lastStatusLabel = text;
    }
  }

  function updateTimer(remainingMs) {
    const text = formatTimer(remainingMs);
    if (text !== state.lastTimerLabel) {
      timerValue.textContent = text;
      state.lastTimerLabel = text;
    }
  }

  function formatClusterSummary(clusters) {
    if (!clusters || clusters.length === 0) {
      return "--";
    }

    return clusters
      .slice(0, 8)
      .map((cluster) => `T${cluster.teamIndex || "?"}:${Math.round(cluster.radiusWorld / 100)}m`)
      .join(" | ");
  }

  function formatAssistMatchup(teamIds) {
    const source = Array.isArray(teamIds) ? teamIds.slice().sort(compareTeamIds) : [];
    if (source.length === 0) {
      return "--";
    }
    if (source.length === 1) {
      return formatTeamLabel(source[0]);
    }
    if (source.length === 2) {
      return `${formatTeamLabel(source[0])} vs ${formatTeamLabel(source[1])}`;
    }

    return `${source.length} teams`;
  }

  function formatFightHighlightSummary(highlights) {
    if (!Array.isArray(highlights) || highlights.length === 0) {
      return "--";
    }

    const showFightDebug = state.debug || state.debugFlags.showFightHighlights;
    return highlights
      .slice(0, showFightDebug ? 6 : 4)
      .map((highlight) => {
        const radiusMeters = Math.round((toFiniteNumber(highlight.radius, 0) || 0) / 100);
        const baseSummary = `${formatAssistMatchup(highlight.teamIds)} | ${String(
          highlight.status || "candidate",
        ).toUpperCase()} | ${radiusMeters}m | ${Math.round(
          (toFiniteNumber(highlight.intensity, 0) || 0) * 100,
        )}%`;
        if (!showFightDebug) {
          return baseSummary;
        }

        return `${baseSummary} | c=${Math.round(
          (toFiniteNumber(highlight.confidence, 0) || 0) * 100,
        )}% | ids=${Array.isArray(highlight.teamIds) ? highlight.teamIds.join(",") : "--"} | ${
          highlight.visible ? `visible#${highlight.priorityRank || 1}` : "hidden"
        }`;
      })
      .join("\n");
  }

  function formatCompactTeamLabel(teamId) {
    const numeric = parseNumericTeamIndex(teamId);
    if (numeric !== null) {
      return `T${numeric}`;
    }

    const normalized = typeof teamId === "string" ? teamId.trim() : "";
    return normalized ? `T${normalized}` : "T?";
  }

  function formatCompactTeamList(teamIds) {
    const source = Array.isArray(teamIds) ? teamIds.filter(Boolean).slice().sort(compareTeamIds) : [];
    if (source.length === 0) {
      return "--";
    }

    const visible = source.slice(0, 4).map(formatCompactTeamLabel).join(", ");
    return source.length > 4 ? `${visible} +${source.length - 4}` : visible;
  }

  function formatRelativeAge(value, now = Date.now()) {
    const numeric = toFiniteNumber(value);
    if (numeric === null) {
      return "--";
    }

    const deltaSeconds = Math.max(0, Math.round((now - numeric) / 1000));
    if (deltaSeconds <= 1) {
      return "now";
    }
    if (deltaSeconds < 60) {
      return `${deltaSeconds}s ago`;
    }

    const minutes = Math.floor(deltaSeconds / 60);
    const seconds = deltaSeconds % 60;
    return `${minutes}m ${String(seconds).padStart(2, "0")}s ago`;
  }

  function formatConfidence(value) {
    const numeric = toFiniteNumber(value);
    if (numeric === null) {
      return "--";
    }

    return `${Math.round(clamp01(numeric) * 100)}%`;
  }

  function formatCompactDuration(ms) {
    const numeric = toFiniteNumber(ms);
    if (numeric === null) {
      return "--";
    }

    const totalSeconds = Math.max(0, Math.ceil(numeric / 1000));
    if (totalSeconds < 60) {
      return `${totalSeconds}s`;
    }

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }

  function formatAssistScore(value) {
    const numeric = toFiniteNumber(value);
    return numeric === null ? "--" : String(Math.round(numeric));
  }

  function getAssistSuggestionExpiryMs(snapshot) {
    return Math.max(
      2_500,
      Math.round(
        toFiniteNumber(snapshot?.config?.OBSERVER_ASSIST_SUGGESTION_EXPIRY_MS, 9_000) || 9_000,
      ),
    );
  }

  function isAssistSuggestionStale(snapshot, now) {
    const bestSuggestion = snapshot?.bestSuggestion;
    if (!bestSuggestion) {
      return false;
    }

    const lastRefreshedAt =
      toFiniteNumber(
        bestSuggestion.lastRefreshedAt ?? bestSuggestion.updatedAt ?? snapshot?.updatedAt,
        0,
      ) || 0;
    return lastRefreshedAt > 0 && now - lastRefreshedAt >= getAssistSuggestionExpiryMs(snapshot);
  }

  function resolveAssistFallbackState(snapshot, now) {
    if (isAssistSuggestionStale(snapshot, now)) {
      return {
        kind: "stale",
        title: "Suggestion expired",
        detail: "Scanning map for a fresh fight",
      };
    }

    const fallback =
      snapshot?.fallbackState && typeof snapshot.fallbackState === "object"
        ? snapshot.fallbackState
        : null;
    if (fallback) {
      return {
        kind: fallback.kind || "idle",
        title: fallback.title || "No active fight",
        detail: fallback.detail || "Scanning map",
      };
    }

    return {
      kind: "idle",
      title: "No active fight",
      detail: "Scanning map",
    };
  }

  function formatAssistSuggestedPlayer(fightOrSuggestion) {
    if (!fightOrSuggestion) {
      return "No clear player";
    }

    const playerName = String(fightOrSuggestion.suggestedPlayerName || "").trim();
    const teamId = String(fightOrSuggestion.suggestedTeamId || "").trim();
    if (!playerName) {
      return "No clear player";
    }

    return teamId
      ? `${playerName} · ${formatCompactTeamLabel(teamId)}`
      : playerName;
  }

  function buildAssistFightMeta(fight, now, options) {
    const source = fight || {};
    const tokens = [];
    if (options && options.rank) {
      tokens.push(`#${options.rank}`);
    }
    if (source.priorityLabel) {
      tokens.push(formatPanelToken(source.priorityLabel));
    }
    tokens.push(`Score ${formatAssistScore(source.displayScore ?? source.score)}`);
    if (source.phase) {
      tokens.push(`Phase ${source.phase}`);
    }
    const refreshedAt = toFiniteNumber(source.lastRefreshedAt ?? source.updatedAt);
    if (refreshedAt !== null) {
      tokens.push(`Updated ${formatRelativeAge(refreshedAt, now)}`);
    }
    return tokens.join(" | ");
  }

  function buildAssistFightCard(fight, now, options) {
    const source = fight || {};
    const classNames = ["assist-card"];
    if (options && options.best) {
      classNames.push("assist-card--best");
    } else {
      classNames.push("assist-card--secondary");
    }

    return [
      `<div class="${escapeAttribute(classNames.join(" "))}">`,
      '<div class="assist-card-header">',
      `<div class="assist-card-title">${escapeHtml(
        truncateLabel(formatAssistMatchup(source.teamIds), options && options.best ? 40 : 32),
      )}</div>`,
      `<div class="assist-card-badge">${escapeHtml(
        formatPanelToken(source.priorityLabel || "watch"),
      )}</div>`,
      "</div>",
      `<div class="assist-card-meta">${escapeHtml(
        buildAssistFightMeta(source, now, options),
      )}</div>`,
      `<div class="assist-card-reason">${escapeHtml(source.reason || "No reason available")}</div>`,
      `<div class="assist-card-player">${escapeHtml(
        formatAssistSuggestedPlayer(source),
      )}</div>`,
      "</div>",
    ].join("");
  }

  function formatPanelToken(value) {
    const normalized = String(value || "").trim();
    if (!normalized) {
      return "--";
    }

    return normalized
      .replace(/[_-]+/g, " ")
      .replace(/\b[a-z]/g, function (match) {
        return match.toUpperCase();
      });
  }

  function buildEmptyPanelMarkup(label) {
    return `<div class="empty-panel">${escapeHtml(label)}</div>`;
  }

  function buildAssistFallbackMarkup(snapshot, now, fallbackState) {
    const source = fallbackState || {
      kind: "idle",
      title: "No active fight",
      detail: "Scanning map",
    };
    const classNames = ["assist-fallback"];
    if (source.kind === "stale") {
      classNames.push("assist-fallback--stale");
    }

    const metaTokens = [
      source.kind === "stale" ? "Waiting for fresh fight telemetry" : "Monitoring live map state",
      snapshot?.updatedAt ? `Updated ${formatRelativeAge(snapshot.updatedAt, now)}` : null,
    ].filter(Boolean);

    return [
      `<div class="${escapeAttribute(classNames.join(" "))}">`,
      `<div class="assist-fallback-title">${escapeHtml(source.title || "No active fight")}</div>`,
      `<div class="assist-fallback-detail">${escapeHtml(source.detail || "Scanning map")}</div>`,
      metaTokens.length > 0
        ? `<div class="assist-fallback-meta">${escapeHtml(metaTokens.join(" | "))}</div>`
        : "",
      "</div>",
    ].join("");
  }

  function buildOperatorActionPath(action, id, paramName = "id", scope = "operator") {
    const params = new URLSearchParams();
    const normalizedId = String(id || "").trim();
    if (normalizedId) {
      params.set(paramName, normalizedId);
    }
    if (state.requestedMapKey) {
      params.set("map", state.requestedMapKey);
    }

    const queryString = params.toString();
    return `/debug/${scope}/${action}${queryString ? `?${queryString}` : ""}`;
  }

  function formatCoordinateSummary(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return "--";
    }

    return `${formatNumber(x)}, ${formatNumber(y)}`;
  }

  function formatExpiryCountdown(expiresAt, now = Date.now()) {
    const numeric = toFiniteNumber(expiresAt);
    if (numeric === null) {
      return "active";
    }

    const remainingSeconds = Math.max(0, Math.ceil((numeric - now) / 1000));
    return `${remainingSeconds}s left`;
  }

  function buildOperatorActionButtonMarkup(label, actionPath) {
    if (!actionPath) {
      return "";
    }

    return `<button class="operator-action" type="button" data-action-path="${escapeAttribute(actionPath)}">${escapeHtml(label)}</button>`;
  }

  function buildOperatorHotkeyLabel(label, hotkey) {
    return hotkey ? `${label} [${String(hotkey).toUpperCase()}]` : label;
  }

  function buildDataAttributesMarkup(attributes) {
    const entries =
      attributes && typeof attributes === "object" ? Object.entries(attributes) : [];
    if (entries.length === 0) {
      return "";
    }

    return entries
      .filter((entry) => entry[1] !== undefined && entry[1] !== null && entry[1] !== false)
      .map(([name, value]) => ` ${escapeHtml(name)}="${escapeAttribute(String(value))}"`)
      .join("");
  }

  function buildOperatorBadgesMarkup(badges) {
    const source = Array.isArray(badges) ? badges.filter(Boolean) : [];
    if (source.length === 0) {
      return "";
    }

    return [
      '<div class="operator-card-badges">',
      ...source.map((badge) => {
        const tone = badge.tone ? ` operator-badge--${escapeHtml(badge.tone)}` : "";
        return `<div class="operator-badge${tone}">${escapeHtml(badge.label)}</div>`;
      }),
      "</div>",
    ].join("");
  }

  function buildOperatorCardMarkup({
    title,
    meta,
    extra,
    badges,
    actions,
    className = "",
    attributes = null,
  }) {
    const classNames = ["operator-card"];
    if (className) {
      classNames.push(className);
    }

    return [
      `<div class="${escapeAttribute(classNames.join(" "))}"${buildDataAttributesMarkup(attributes)}>`,
      '<div class="operator-card-header">',
      `<div class="operator-card-title">${escapeHtml(truncateLabel(title, 46))}</div>`,
      buildOperatorBadgesMarkup(badges),
      "</div>",
      meta ? `<div class="operator-card-meta">${escapeHtml(meta)}</div>` : "",
      extra ? `<div class="operator-card-extra">${escapeHtml(extra)}</div>` : "",
      Array.isArray(actions) && actions.length > 0
        ? `<div class="operator-actions">${actions.join("")}</div>`
        : "",
      "</div>",
    ].join("");
  }

  function buildOperatorSectionMarkup(title, bodyMarkup, meta = "") {
    return [
      '<section class="operator-section">',
      '<div class="operator-section-header">',
      `<div class="operator-section-title">${escapeHtml(title)}</div>`,
      meta ? `<div class="operator-section-meta">${escapeHtml(meta)}</div>` : "",
      "</div>",
      `<div class="operator-section-body">${bodyMarkup}</div>`,
      "</section>",
    ].join("");
  }

  function buildTargetCardMarkup(target, now, options = {}) {
    const isWatchingNow = options.forceWatching || Boolean(target.operatorWatchingNow);
    const isPinned = options.forcePinned || Boolean(target.operatorPinned);
    const isSuppressed = options.forceSuppressed || Boolean(target.operatorSuppressed);
    const isReplay = options.forceReplay || Boolean(target.operatorReplayCandidate);
    const badges = [];

    if (isWatchingNow) {
      badges.push({ label: "Watching", tone: "watching" });
    }
    if (isPinned) {
      badges.push({ label: "Pinned", tone: "pinned" });
    }
    if (isSuppressed) {
      badges.push({ label: "Suppressed", tone: "suppressed" });
    }
    if (isReplay) {
      badges.push({ label: "Replay", tone: "replay" });
    }
    if (badges.length === 0 && target.category) {
      badges.push({ label: formatPanelToken(target.category) });
    }

    const metaParts = [
      `Teams ${formatCompactTeamList(target.involvedTeamIds)}`,
      Number.isFinite(target.priority) ? `Priority ${Math.round(target.priority)}` : null,
      target.updatedAt ? `Updated ${formatRelativeAge(target.updatedAt, now)}` : null,
    ].filter(Boolean);
    const extraParts = [];

    if (Array.isArray(target.reason) && target.reason.length > 0) {
      extraParts.push(target.reason.slice(0, 3).join(" | "));
    }
    if (Number.isFinite(target.centerX) && Number.isFinite(target.centerY)) {
      extraParts.push(`Focus ${formatCoordinateSummary(target.centerX, target.centerY)}`);
    }

    const actions = [];
    if (options.allowWatchNow !== false && !isWatchingNow) {
      actions.push(
        buildOperatorActionButtonMarkup(
          options.watchNowLabel || "Watch now",
          buildOperatorActionPath("watch-now", target.id),
        ),
      );
    }
    if (options.allowPin !== false) {
      actions.push(
        buildOperatorActionButtonMarkup(
          options.pinLabel || (isPinned ? "Unpin" : "Pin"),
          buildOperatorActionPath(isPinned ? "unpin-target" : "pin-target", target.id),
        ),
      );
    }
    if (options.allowReplay !== false) {
      actions.push(
        buildOperatorActionButtonMarkup(
          options.replayLabel || (isReplay ? "Unmark" : "Replay"),
          buildOperatorActionPath(isReplay ? "unmark-replay" : "mark-replay", target.id),
        ),
      );
    }
    if (options.allowSuppress !== false) {
      actions.push(
        buildOperatorActionButtonMarkup(
          options.suppressLabel || (isSuppressed ? "Unsuppress" : "Suppress"),
          buildOperatorActionPath(
            isSuppressed ? "unsuppress-target" : "suppress-target",
            target.id,
          ),
        ),
      );
    }
    if (options.allowCenter) {
      actions.push(
        buildOperatorActionButtonMarkup(
          options.centerLabel || "Center",
          buildOperatorActionPath("center-target", target.id),
        ),
      );
    }

    const classNames = [];
    if (options.selectable !== false) {
      classNames.push("operator-card--clickable");
    }
    if (options.selected) {
      classNames.push("operator-card--selected");
    }
    if (options.highlighted) {
      classNames.push("operator-card--highlighted");
    }

    return buildOperatorCardMarkup({
      title: target.label || target.id,
      meta: metaParts.join(" | "),
      extra: extraParts.join(" | "),
      badges,
      actions,
      className: classNames.join(" "),
      attributes:
        options.selectable === false
          ? null
          : {
              "data-select-target-id": target.id,
            },
    });
  }

  function buildAlertCardMarkup(alert, now, options = {}) {
    const isReplay = options.forceReplay || Boolean(alert.operatorReplayCandidate);
    const badges = [
      { label: formatPanelToken(alert.severity || "info") },
      ...(isReplay ? [{ label: "Replay", tone: "replay" }] : []),
    ];
    const meta = [
      formatPanelToken(alert.type || "alert"),
      `Teams ${formatCompactTeamList(alert.involvedTeamIds)}`,
      alert.createdAt ? `Triggered ${formatRelativeAge(alert.createdAt, now)}` : null,
      alert.expiresAt ? `Expires ${formatExpiryCountdown(alert.expiresAt, now)}` : null,
    ]
      .filter(Boolean)
      .join(" | ");
    const extra = Number.isFinite(alert.centerX) && Number.isFinite(alert.centerY)
      ? `Focus ${formatCoordinateSummary(alert.centerX, alert.centerY)}`
      : "";
    const actions = [];

    if (options.allowReplay !== false) {
      actions.push(
        buildOperatorActionButtonMarkup(
          options.replayLabel || (isReplay ? "Unmark" : "Replay"),
          buildOperatorActionPath(isReplay ? "unmark-replay" : "mark-replay", alert.id),
        ),
      );
    }
    if (options.allowDismiss !== false) {
      actions.push(
        buildOperatorActionButtonMarkup(
          options.dismissLabel || "Dismiss",
          buildOperatorActionPath(options.dismissAction || "dismiss-alert", alert.id),
        ),
      );
    }

    const classNames = [];
    if (options.selectable !== false) {
      classNames.push("operator-card--clickable");
    }
    if (options.selected) {
      classNames.push("operator-card--selected");
    }

    return buildOperatorCardMarkup({
      title: alert.label || alert.id,
      meta,
      extra,
      badges,
      actions,
      className: classNames.join(" "),
      attributes:
        options.selectable === false
          ? null
          : {
              "data-select-alert-id": alert.id,
            },
    });
  }

  function buildPinnedTeamMarkup(teamId) {
    const actionPath = buildOperatorActionPath(
      "unpin-team",
      teamId,
      "teamId",
      "observer",
    );

    return [
      '<div class="operator-token">',
      `<span>${escapeHtml(formatTeamLabel(teamId))}</span>`,
      `<button type="button" data-action-path="${escapeAttribute(actionPath)}">unpin</button>`,
      "</div>",
    ].join("");
  }

  function resolveTargetLikeById(snapshot, targetId) {
    const normalizedTargetId = String(targetId || "").trim();
    if (!normalizedTargetId || !snapshot) {
      return null;
    }

    const sources = [
      snapshot.cameraAssistPayload?.topWatchTargets,
      snapshot.watchTargets,
      snapshot.pinState?.pinnedTargets,
      snapshot.operatorDetails?.watchingNowTarget ? [snapshot.operatorDetails.watchingNowTarget] : [],
      snapshot.operatorDetails?.suppressedTargets,
    ];

    for (const source of sources) {
      const match = (Array.isArray(source) ? source : []).find((entry) => entry.id === normalizedTargetId);
      if (match) {
        return match;
      }
    }

    return null;
  }

  function resolveAlertLikeById(snapshot, alertId) {
    const normalizedAlertId = String(alertId || "").trim();
    if (!normalizedAlertId || !snapshot) {
      return null;
    }

    const sources = [
      snapshot.cameraAssistPayload?.activeAlerts,
      snapshot.activeAlerts,
      snapshot.operatorDetails?.dismissedAlerts,
    ];

    for (const source of sources) {
      const match = (Array.isArray(source) ? source : []).find((entry) => entry.id === normalizedAlertId);
      if (match) {
        return match;
      }
    }

    return null;
  }

  function getOperatorWorkflowState(snapshot) {
    const workflowState =
      snapshot && snapshot.operatorWorkflowState && typeof snapshot.operatorWorkflowState === "object"
        ? snapshot.operatorWorkflowState
        : {};

    return {
      selectedTargetId: workflowState.selectedTargetId || null,
      selectedAlertId: workflowState.selectedAlertId || null,
      highlightedTargetId: workflowState.highlightedTargetId || null,
      mapFocusCenter: workflowState.mapFocusCenter || null,
      mapFocusUntil: workflowState.mapFocusUntil || null,
      lastAction: workflowState.lastAction || null,
      updatedAt: workflowState.updatedAt || 0,
    };
  }

  function getOperatorWorkflowConfig(snapshot) {
    const workflowConfig =
      snapshot && snapshot.operatorWorkflowConfig && typeof snapshot.operatorWorkflowConfig === "object"
        ? snapshot.operatorWorkflowConfig
        : {};

    return {
      mapFocusHighlightMs: toFiniteNumber(
        workflowConfig.mapFocusHighlightMs,
        FALLBACK_OPERATOR_WORKFLOW_CONFIG.mapFocusHighlightMs,
      ),
      operatorActionStatusMs: toFiniteNumber(
        workflowConfig.operatorActionStatusMs,
        FALLBACK_OPERATOR_WORKFLOW_CONFIG.operatorActionStatusMs,
      ),
      maxSelectableWatchTargets: Math.max(
        1,
        Math.min(
          5,
          Math.round(
            toFiniteNumber(
              workflowConfig.maxSelectableWatchTargets,
              FALLBACK_OPERATOR_WORKFLOW_CONFIG.maxSelectableWatchTargets,
            ),
          ),
        ),
      ),
    };
  }

  function getSelectableWatchTargets(snapshot) {
    const workflowConfig = getOperatorWorkflowConfig(snapshot);
    const watchTargets = Array.isArray(snapshot?.watchTargets) ? snapshot.watchTargets : [];

    return watchTargets
      .filter((target) => target.id !== snapshot?.operatorState?.watchingNowTargetId)
      .slice(0, workflowConfig.maxSelectableWatchTargets);
  }

  function isWorkflowStatusVisible(workflowState, workflowConfig, now) {
    if (!workflowState.lastAction) {
      return false;
    }

    const updatedAt = toFiniteNumber(workflowState.updatedAt, 0);
    return updatedAt > 0 && now - updatedAt <= workflowConfig.operatorActionStatusMs;
  }

  function formatWorkflowFocusStatus(workflowState, now) {
    if (
      !workflowState.mapFocusCenter ||
      !Number.isFinite(workflowState.mapFocusUntil) ||
      workflowState.mapFocusUntil <= now
    ) {
      return null;
    }

    return `Focus ${formatCompactDuration(workflowState.mapFocusUntil - now)} remaining`;
  }

  function formatRecommendationHistory(historyEntries, snapshot) {
    const source = Array.isArray(historyEntries) ? historyEntries : [];
    if (source.length === 0) {
      return "--";
    }

    return source
      .slice(-4)
      .map((entry) => {
        const target = resolveTargetLikeById(snapshot, entry.recommendedTargetId);
        const targetLabel = target
          ? truncateLabel(target.label, 20)
          : entry.recommendedTargetId || "--";
        return `${String(entry.action || "stay").toUpperCase()} ${targetLabel}`;
      })
      .join(" -> ");
  }

  function buildWorkflowSectionMarkup(snapshot, now) {
    const workflowState = getOperatorWorkflowState(snapshot);
    const workflowConfig = getOperatorWorkflowConfig(snapshot);
    const operatorState =
      snapshot && snapshot.operatorState && typeof snapshot.operatorState === "object"
        ? snapshot.operatorState
        : {};
    const selectedTarget = resolveTargetLikeById(snapshot, workflowState.selectedTargetId);
    const selectedAlert = resolveAlertLikeById(snapshot, workflowState.selectedAlertId);
    const isSelectedAlertDismissed = Array.isArray(operatorState.dismissedAlertIds)
      ? operatorState.dismissedAlertIds.includes(workflowState.selectedAlertId)
      : false;
    const bodyParts = [];
    const focusStatus = formatWorkflowFocusStatus(workflowState, now);

    if (isWorkflowStatusVisible(workflowState, workflowConfig, now)) {
      bodyParts.push(
        `<div class="operator-status-line">${escapeHtml(workflowState.lastAction)}</div>`,
      );
    }
    if (focusStatus) {
      bodyParts.push(
        `<div class="operator-status-line operator-status-line--muted">${escapeHtml(focusStatus)}</div>`,
      );
    }

    if (selectedTarget) {
      const isSelectedTargetPinned = Boolean(
        snapshot?.watchTargets?.find((target) => target.id === selectedTarget.id)?.operatorPinned ||
          snapshot?.pinState?.pinnedTargets?.find((target) => target.id === selectedTarget.id),
      );
      const isSelectedTargetSuppressed = Boolean(
        snapshot?.watchTargets?.find((target) => target.id === selectedTarget.id)?.operatorSuppressed ||
          snapshot?.operatorState?.suppressedTargetIds?.includes(selectedTarget.id),
      );
      const isSelectedTargetReplay = Array.isArray(snapshot?.replayCandidates)
        ? snapshot.replayCandidates.some((candidate) => candidate.sourceId === selectedTarget.id)
        : false;
      bodyParts.push(
        buildTargetCardMarkup(
          {
            ...selectedTarget,
            operatorWatchingNow: selectedTarget.id === snapshot?.operatorState?.watchingNowTargetId,
            operatorPinned: isSelectedTargetPinned,
            operatorSuppressed: isSelectedTargetSuppressed,
            operatorReplayCandidate: isSelectedTargetReplay,
          },
          now,
          {
            allowCenter: true,
            centerLabel: buildOperatorHotkeyLabel("Center", OPERATOR_HOTKEYS.center),
            pinLabel: buildOperatorHotkeyLabel(
              isSelectedTargetPinned ? "Unpin" : "Pin",
              isSelectedTargetPinned ? OPERATOR_HOTKEYS.unpin : OPERATOR_HOTKEYS.pin,
            ),
            replayLabel: buildOperatorHotkeyLabel(
              isSelectedTargetReplay ? "Unmark" : "Replay",
              OPERATOR_HOTKEYS.replay,
            ),
            selected: true,
            selectable: false,
            suppressLabel: buildOperatorHotkeyLabel(
              isSelectedTargetSuppressed ? "Unsuppress" : "Suppress",
              isSelectedTargetSuppressed ? OPERATOR_HOTKEYS.unsuppress : OPERATOR_HOTKEYS.suppress,
            ),
            watchNowLabel: buildOperatorHotkeyLabel("Watch", OPERATOR_HOTKEYS.watchNow),
            highlighted: workflowState.highlightedTargetId === selectedTarget.id,
          },
        ),
      );
    } else {
      bodyParts.push(buildEmptyPanelMarkup("Click a watch target or press 1-5 to select."));
    }

    if (selectedAlert) {
      bodyParts.push(
        buildAlertCardMarkup(selectedAlert, now, {
          dismissAction: isSelectedAlertDismissed ? "undismiss-alert" : "dismiss-alert",
          dismissLabel: isSelectedAlertDismissed
            ? "Undo"
            : buildOperatorHotkeyLabel("Dismiss", OPERATOR_HOTKEYS.dismissAlert),
          replayLabel: buildOperatorHotkeyLabel(
            selectedAlert.operatorReplayCandidate ? "Unmark" : "Replay",
            OPERATOR_HOTKEYS.replay,
          ),
          selected: true,
          selectable: false,
        }),
      );
    }

    return buildOperatorSectionMarkup(
      "Workflow",
      bodyParts.join(""),
      `1-${workflowConfig.maxSelectableWatchTargets} select | W P U R T Y A C D`,
    );
  }

  function buildCameraAssistSectionMarkup(snapshot, now) {
    const payload = snapshot?.cameraAssistPayload || null;
    if (!payload || !payload.recommendation) {
      return buildOperatorSectionMarkup(
        "Camera Assist",
        buildEmptyPanelMarkup("No camera assist recommendation."),
      );
    }

    const recommendation = payload.recommendation;
    const currentTarget = resolveTargetLikeById(snapshot, recommendation.currentTargetId);
    const recommendedTarget = resolveTargetLikeById(snapshot, recommendation.recommendedTargetId);
    const backupLabels = Array.isArray(recommendation.backupTargetIds)
      ? recommendation.backupTargetIds
          .map((id) => {
            const target = resolveTargetLikeById(snapshot, id);
            return target ? truncateLabel(target.label, 24) : id;
          })
          .filter(Boolean)
      : [];
    const badges = [
      {
        label: formatPanelToken(recommendation.action),
        tone: String(recommendation.action || "stay").toLowerCase(),
      },
    ];
    const actions = [];
    if (recommendedTarget && recommendation.action !== "stay") {
      actions.push(
        buildOperatorActionButtonMarkup(
          buildOperatorHotkeyLabel("Accept", OPERATOR_HOTKEYS.acceptRecommendation),
          buildOperatorActionPath("accept-recommendation"),
        ),
      );
      actions.push(
        buildOperatorActionButtonMarkup(
          buildOperatorHotkeyLabel("Center", OPERATOR_HOTKEYS.center),
          buildOperatorActionPath("center-target", recommendedTarget.id),
        ),
      );
    }
    const meta = [
      `Current ${currentTarget ? truncateLabel(currentTarget.label, 22) : "--"}`,
      `Target ${recommendedTarget ? truncateLabel(recommendedTarget.label, 22) : "--"}`,
      `Confidence ${formatConfidence(recommendation.confidence)}`,
    ].join(" | ");
    const extraParts = [
      Array.isArray(recommendation.reasons) && recommendation.reasons.length > 0
        ? recommendation.reasons.join(" | ")
        : null,
      backupLabels.length > 0 ? `Backups ${backupLabels.join(" -> ")}` : "No backup targets.",
      recommendation.generatedAt
        ? `Updated ${formatRelativeAge(recommendation.generatedAt, now)}`
        : null,
    ]
      .filter(Boolean)
      .join(" | ");

    return buildOperatorSectionMarkup(
      "Camera Assist",
      buildOperatorCardMarkup({
        title: recommendedTarget
          ? recommendedTarget.label || recommendedTarget.id
          : currentTarget
            ? currentTarget.label || currentTarget.id
            : "No recommendation target",
        meta,
        extra: extraParts,
        badges,
        actions,
      }),
      recommendation.action,
    );
  }

  function buildOperatorPanelMarkup(snapshot) {
    const operatorState =
      snapshot && snapshot.operatorState && typeof snapshot.operatorState === "object"
        ? snapshot.operatorState
        : {};
    const workflowState = getOperatorWorkflowState(snapshot);
    const operatorDetails =
      snapshot && snapshot.operatorDetails && typeof snapshot.operatorDetails === "object"
        ? snapshot.operatorDetails
        : {};
    const pinState = snapshot && snapshot.pinState && typeof snapshot.pinState === "object" ? snapshot.pinState : {};
    const watchTargets = Array.isArray(snapshot?.watchTargets) ? snapshot.watchTargets : [];
    const activeAlerts = Array.isArray(snapshot?.activeAlerts) ? snapshot.activeAlerts : [];
    const replayCandidates = Array.isArray(snapshot?.replayCandidates) ? snapshot.replayCandidates : [];
    const pinnedTargets = Array.isArray(pinState.pinnedTargets) ? pinState.pinnedTargets : [];
    const suppressedTargets = Array.isArray(operatorDetails.suppressedTargets)
      ? operatorDetails.suppressedTargets
      : [];
    const dismissedAlerts = Array.isArray(operatorDetails.dismissedAlerts)
      ? operatorDetails.dismissedAlerts
      : [];
    const watchingNowTarget =
      operatorDetails.watchingNowTarget ||
      watchTargets.find((target) => target.id === operatorState.watchingNowTargetId) ||
      pinnedTargets.find((target) => target.id === operatorState.watchingNowTargetId) ||
      null;
    const now = Date.now();
    const topTargets = watchTargets.filter((target) => target.id !== operatorState.watchingNowTargetId);

    const watchingMarkup = watchingNowTarget
      ? buildTargetCardMarkup(
          {
            ...watchingNowTarget,
            operatorWatchingNow: true,
            operatorPinned: Boolean(
              watchTargets.find((target) => target.id === watchingNowTarget.id)?.operatorPinned,
            ),
            operatorSuppressed: Boolean(
              watchTargets.find((target) => target.id === watchingNowTarget.id)?.operatorSuppressed,
            ),
            operatorReplayCandidate: replayCandidates.some(
              (candidate) => candidate.sourceId === watchingNowTarget.id,
            ),
          },
          now,
          {
            allowWatchNow: false,
            selected: workflowState.selectedTargetId === watchingNowTarget.id,
            highlighted: workflowState.highlightedTargetId === watchingNowTarget.id,
          },
        )
      : buildEmptyPanelMarkup("No active watched target.");

    const topTargetsMarkup =
      topTargets.length > 0
        ? topTargets
            .slice(0, 5)
            .map((target) =>
              buildTargetCardMarkup(target, now, {
                selected: workflowState.selectedTargetId === target.id,
                highlighted: workflowState.highlightedTargetId === target.id,
              }),
            )
            .join("")
        : buildEmptyPanelMarkup("No active watch targets.");

    const activeAlertsMarkup =
      activeAlerts.length > 0
        ? activeAlerts
            .slice(0, 5)
            .map((alert) =>
              buildAlertCardMarkup(alert, now, {
                selected: workflowState.selectedAlertId === alert.id,
              }),
            )
            .join("")
        : buildEmptyPanelMarkup("No active production alerts.");

    const replayCandidatesMarkup =
      replayCandidates.length > 0
        ? replayCandidates.map((candidate) => {
            const meta = [
              formatPanelToken(candidate.sourceType),
              `Teams ${formatCompactTeamList(candidate.involvedTeamIds)}`,
              `Marked ${formatRelativeAge(candidate.createdAt, now)}`,
              candidate.expiresAt ? `Expires ${formatExpiryCountdown(candidate.expiresAt, now)}` : null,
            ]
              .filter(Boolean)
              .join(" | ");
            const extra = Number.isFinite(candidate.centerX) && Number.isFinite(candidate.centerY)
              ? `Focus ${formatCoordinateSummary(candidate.centerX, candidate.centerY)}`
              : "";
            const sourceTarget = candidate.sourceType === "watch_target"
              ? resolveTargetLikeById(snapshot, candidate.sourceId)
              : null;
            const sourceAlert = candidate.sourceType === "alert"
              ? resolveAlertLikeById(snapshot, candidate.sourceId)
              : null;
            return buildOperatorCardMarkup({
              title: candidate.label || candidate.id,
              meta,
              extra,
              badges: [{ label: formatPanelToken(candidate.sourceType) }, { label: "Replay", tone: "replay" }],
              actions: [
                buildOperatorActionButtonMarkup(
                  "Remove",
                  buildOperatorActionPath("remove-replay", candidate.sourceId),
                ),
              ],
              className:
                workflowState.selectedTargetId === candidate.sourceId ||
                workflowState.selectedAlertId === candidate.sourceId
                  ? "operator-card--selected operator-card--clickable"
                  : sourceTarget || sourceAlert
                    ? "operator-card--clickable"
                    : "",
              attributes: sourceTarget
                ? { "data-select-target-id": sourceTarget.id }
                : sourceAlert
                  ? { "data-select-alert-id": sourceAlert.id }
                  : null,
            });
          }).join("")
        : buildEmptyPanelMarkup("No replay candidates.");

    const pinsAndSuppressionsParts = [];
    if (Array.isArray(pinState.pinnedTeams) && pinState.pinnedTeams.length > 0) {
      pinsAndSuppressionsParts.push(
        `<div class="operator-token-list">${pinState.pinnedTeams.map(buildPinnedTeamMarkup).join("")}</div>`,
      );
    }
    if (pinnedTargets.length > 0) {
      pinsAndSuppressionsParts.push(
        pinnedTargets
          .filter((target) => target.id !== operatorState.watchingNowTargetId)
          .slice(0, 4)
          .map((target) =>
            buildTargetCardMarkup(
              { ...target, operatorPinned: true },
              now,
              {
                allowReplay: false,
                selected: workflowState.selectedTargetId === target.id,
                highlighted: workflowState.highlightedTargetId === target.id,
              },
            ),
          )
          .join(""),
      );
    }
    if (suppressedTargets.length > 0) {
      pinsAndSuppressionsParts.push(
        suppressedTargets
          .map((target) =>
            buildTargetCardMarkup(
              {
                ...target,
                updatedAt: target.suppressedAt,
                operatorSuppressed: true,
              },
              now,
              {
                allowPin: false,
                selected: workflowState.selectedTargetId === target.id,
                highlighted: workflowState.highlightedTargetId === target.id,
              },
            ),
          )
          .join(""),
      );
    }
    if (dismissedAlerts.length > 0) {
      pinsAndSuppressionsParts.push(
        dismissedAlerts
          .map((alert) =>
            buildAlertCardMarkup(
              {
                ...alert,
                type: "dismissed_alert",
                severity: "info",
                createdAt: alert.dismissedAt,
              },
              now,
              {
                allowReplay: false,
                dismissAction: "undismiss-alert",
                dismissLabel: "Undo",
                selected: workflowState.selectedAlertId === alert.id,
              },
            ),
          )
          .join(""),
      );
    }

    const pinsAndSuppressionsMarkup =
      pinsAndSuppressionsParts.length > 0
        ? pinsAndSuppressionsParts.join("")
        : buildEmptyPanelMarkup("No pins, suppressions, or dismissed alerts.");
    const sections = [];

    sections.push(buildWorkflowSectionMarkup(snapshot, now));

    if (state.operatorFlags.showCameraAssist) {
      sections.push(buildCameraAssistSectionMarkup(snapshot, now));
    }

    if (state.operatorFlags.showBasePanel) {
      sections.push(
        buildOperatorSectionMarkup(
          "Watching Now",
          watchingMarkup,
          watchingNowTarget ? "live focus" : "",
        ),
      );
      sections.push(
        buildOperatorSectionMarkup(
          "Top Watch Targets",
          topTargetsMarkup,
          `${topTargets.length} visible`,
        ),
      );
      sections.push(
        buildOperatorSectionMarkup(
          "Active Alerts",
          activeAlertsMarkup,
          `${activeAlerts.length} live`,
        ),
      );
      sections.push(
        buildOperatorSectionMarkup(
          "Replay Candidates",
          replayCandidatesMarkup,
          `${replayCandidates.length} queued`,
        ),
      );
      sections.push(
        buildOperatorSectionMarkup(
          "Pins / Suppressions",
          pinsAndSuppressionsMarkup,
          `${suppressedTargets.length} suppressed`,
        ),
      );
    }

    return sections.length > 0
      ? sections.join("")
      : buildEmptyPanelMarkup("No operator panel sections enabled.");
  }

  function buildWatchQueueMarkup(snapshot) {
    const watchTargets = Array.isArray(snapshot?.watchTargets) ? snapshot.watchTargets : [];
    if (watchTargets.length === 0) {
      return buildEmptyPanelMarkup("No active watch targets.");
    }

    const now = Date.now();
    const workflowState = getOperatorWorkflowState(snapshot);
    return watchTargets
      .map((target, index) => {
        const score = Math.round(toFiniteNumber(target.score, 0) || 0);
        const priority = Math.round(toFiniteNumber(target.priority, 0) || 0);
        const badgeLabel = target.operatorWatchingNow
          ? "Watching"
          : target.operatorSuppressed
            ? "Suppressed"
            : target.operatorPinned
              ? "Pinned"
              : formatPanelToken(target.category);
        const meta = [
          `#${index + 1}`,
          `Score ${score}`,
          `Priority ${priority}`,
          `Teams ${formatCompactTeamList(target.involvedTeamIds)}`,
          `Updated ${formatRelativeAge(target.updatedAt, now)}`,
        ].join(" | ");
        const reasons = Array.isArray(target.reason) && target.reason.length > 0
          ? target.reason.slice(0, 3).join(" | ")
          : "No reason available";
        const classNames = ["watch-item", "watch-item--clickable"];
        if (workflowState.selectedTargetId === target.id) {
          classNames.push("watch-item--selected");
        }

        return [
          `<div class="${escapeAttribute(classNames.join(" "))}" data-select-target-id="${escapeAttribute(target.id)}">`,
          '<div class="watch-item-header">',
          `<div class="watch-item-title">${escapeHtml(truncateLabel(target.label, 44))}</div>`,
          `<div class="watch-item-badge">${escapeHtml(badgeLabel)}</div>`,
          "</div>",
          `<div class="watch-item-meta">${escapeHtml(meta)}</div>`,
          `<div class="watch-item-reasons">${escapeHtml(reasons)}</div>`,
          "</div>",
        ].join("");
      })
      .join("");
  }

  function buildAlertsMarkup(snapshot) {
    const activeAlerts = Array.isArray(snapshot?.activeAlerts) ? snapshot.activeAlerts : [];
    if (activeAlerts.length === 0) {
      return buildEmptyPanelMarkup("No active production alerts.");
    }

    const now = Date.now();
    const workflowState = getOperatorWorkflowState(snapshot);
    return activeAlerts
      .map((alert) => {
        const meta = [
          formatPanelToken(alert.type),
          `Teams ${formatCompactTeamList(alert.involvedTeamIds)}`,
          `Triggered ${formatRelativeAge(alert.createdAt, now)}`,
          alert.operatorReplayCandidate ? "Replay marked" : null,
        ]
          .filter(Boolean)
          .join(" | ");
        const classNames = ["alert-item", "alert-item--clickable"];
        if (workflowState.selectedAlertId === alert.id) {
          classNames.push("alert-item--selected");
        }

        return [
          `<div class="${escapeAttribute(classNames.join(" "))}" data-select-alert-id="${escapeAttribute(alert.id)}">`,
          '<div class="alert-item-header">',
          `<div class="alert-item-title">${escapeHtml(truncateLabel(alert.label, 48))}</div>`,
          `<div class="alert-item-badge alert-item-badge--${escapeHtml(String(alert.severity || "info").toLowerCase())}">${escapeHtml(formatPanelToken(alert.severity))}</div>`,
          "</div>",
          `<div class="alert-item-meta">${escapeHtml(meta)}</div>`,
          "</div>",
        ].join("");
      })
      .join("");
  }

  function buildAssistMarkup(snapshot) {
    const now = Date.now();
    const fallbackState = resolveAssistFallbackState(snapshot, now);
    const bestSuggestion =
      snapshot?.bestSuggestion && !isAssistSuggestionStale(snapshot, now)
        ? snapshot.bestSuggestion
        : null;
    const rankedFights =
      bestSuggestion || !isAssistSuggestionStale(snapshot, now)
        ? Array.isArray(snapshot?.rankedFights)
          ? snapshot.rankedFights
          : []
        : [];

    if (!bestSuggestion && rankedFights.length === 0) {
      return buildAssistFallbackMarkup(snapshot, now, fallbackState);
    }

    const markup = [];
    if (bestSuggestion) {
      markup.push('<div class="assist-subtitle assist-subtitle--primary">Best suggestion</div>');
      markup.push(buildAssistFightCard(bestSuggestion, now, { best: true }));
    } else {
      markup.push(buildAssistFallbackMarkup(snapshot, now, fallbackState));
    }

    const secondaryFights = rankedFights
      .filter((fight) => !bestSuggestion || fight.fightId !== bestSuggestion.fightId)
      .slice(0, bestSuggestion ? 2 : 3);
    if (secondaryFights.length > 0) {
      markup.push('<div class="assist-subtitle">Ranked fights</div>');
      markup.push(
        '<div class="assist-fights">' +
          secondaryFights
            .map((fight, index) =>
              buildAssistFightCard(fight, now, {
                best: false,
                rank: bestSuggestion ? index + 2 : index + 1,
              }),
            )
            .join("") +
          "</div>",
      );
    }

    const footerTokens = [
      `Ranked ${rankedFights.length}`,
      snapshot ? `Signals ${snapshot.activeFightCount ?? 0}` : null,
      snapshot?.updatedAt ? `Updated ${formatRelativeAge(snapshot.updatedAt, now)}` : null,
    ].filter(Boolean);
    if (footerTokens.length > 0) {
      markup.push(`<div class="assist-footer">${escapeHtml(footerTokens.join(" | "))}</div>`);
    }

    return markup.join("");
  }

  function buildDebugMarkup(frame) {
    const mapDefinition = getMapDefinition();
    const zone = state.zone;
    const playersPacket = state.playersPacket;
    const imageSize = resolveImageDimensions();
    const coordinate = getScaleMetadata();
    const assistSnapshot = state.assistSnapshot;
    const productionSupportSnapshot = state.productionSupportSnapshot;
    const workflowState = getOperatorWorkflowState(productionSupportSnapshot);
    const observerControlSuggestion = productionSupportSnapshot
      ? productionSupportSnapshot.observerControlSuggestion || null
      : null;
    const cameraAssistPayload = productionSupportSnapshot
      ? productionSupportSnapshot.cameraAssistPayload || null
      : null;
    const warnings = [];

    if (mapDefinition && mapDefinition.notes) {
      warnings.push(mapDefinition.notes);
    }
    if (zone && Array.isArray(zone.warnings)) {
      warnings.push(...zone.warnings);
    }
    if (playersPacket && Array.isArray(playersPacket.warnings)) {
      warnings.push(...playersPacket.warnings);
    }

    const rows = [
      ["connection", getConnectionLabel(frame.now)],
      ["render style", state.style],
      [
        "circle zoom",
        state.mapCamera.enabled
          ? `${state.mapCamera.active ? "active" : "waiting"} x${state.mapCamera.zoom.toFixed(2)} target x${state.mapCamera.targetZoom.toFixed(2)}`
          : "off",
      ],
      ["team labels", state.showTeamNumbers ? "enabled" : "disabled"],
      ["map key", mapDefinition ? mapDefinition.key : "--"],
      ["world size", mapDefinition ? String(mapDefinition.worldSize) : "--"],
      [
        "image dims",
        imageSize.width && imageSize.height ? `${imageSize.width} x ${imageSize.height}` : "--",
      ],
      ["scale hint", coordinate ? String(coordinate.scaleHint ?? "--") : "--"],
      ["scale mode", coordinate ? String(coordinate.scaleMode ?? "--") : "--"],
      [
        "raw zone center",
        zone && zone.raw && zone.raw.currentCircle
          ? `${formatNumber(zone.raw.currentCircle.centerX ?? zone.raw.currentCircle.x)}, ${formatNumber(zone.raw.currentCircle.centerY ?? zone.raw.currentCircle.y)}`
          : "--",
      ],
      [
        "raw zone radius",
        zone && zone.raw && zone.raw.currentCircle ? formatNumber(zone.raw.currentCircle.radius) : "--",
      ],
      ["animated zone", formatCircle(frame.animatedCircle)],
      ["blue zone", formatCircle(frame.blueCircle)],
      ["flight path", formatFlightPath(frame.flightPath)],
      ["next zone", formatCircle(frame.nextCircle)],
      ["telemetry remaining", zone ? formatRemainingDetails(getZoneDurationMs(zone)) : "--"],
      ["live remaining", formatRemainingDetails(frame.remainingMs)],
      ["target end", formatTimestamp(zone && zone.targetEndAt)],
      ["zone packet ts", formatTimestamp(zone && zone.timestamp)],
      ["zone received", formatTimestamp(zone && zone.receivedAt)],
      ["player packet ts", formatTimestamp(playersPacket && playersPacket.timestamp)],
      ["player received", formatTimestamp(playersPacket && playersPacket.receivedAt)],
      ["last message", formatTimestamp(state.lastMessageAt)],
      [
        "timing source",
        zone && zone.timing && zone.timing.timingSource ? zone.timing.timingSource : "--",
      ],
      [
        "transport latency",
        zone && zone.timing && Number.isFinite(zone.timing.transportLatencyMs)
          ? `${Math.round(zone.timing.transportLatencyMs)} ms`
          : "--",
      ],
      ["player count", String(frame.players.length)],
      ["cluster count", String(frame.clusters.length)],
      ["cluster radii", formatClusterSummary(frame.clusters)],
      ["fight highlights", String(frame.fightHighlights.length)],
      [
        "fight summary",
        formatFightHighlightSummary(productionSupportSnapshot?.fightHighlights),
      ],
      [
        "assist ranked fights",
        String(assistSnapshot ? assistSnapshot.rankedFights?.length ?? 0 : 0),
      ],
      [
        "assist best fight",
        assistSnapshot?.bestSuggestion
          ? `${formatAssistMatchup(assistSnapshot.bestSuggestion.teamIds)} | ${formatPanelToken(
              assistSnapshot.bestSuggestion.priorityLabel,
            )} | ${assistSnapshot.bestSuggestion.reason}`
          : assistSnapshot?.fallbackState
            ? `${assistSnapshot.fallbackState.title} | ${assistSnapshot.fallbackState.detail}`
            : "--",
      ],
      [
        "assist player",
        assistSnapshot?.bestSuggestion
          ? formatAssistSuggestedPlayer(assistSnapshot.bestSuggestion)
          : "--",
      ],
      ["assist hot zones", String(frame.hotZones.length)],
      ["assist proximity", String(frame.proximities.length)],
      ["assist focus", String(frame.focusCandidates.length)],
      [
        "watch targets",
        String(productionSupportSnapshot ? productionSupportSnapshot.watchTargets?.length ?? 0 : 0),
      ],
      [
        "active alerts",
        String(productionSupportSnapshot ? productionSupportSnapshot.activeAlerts?.length ?? 0 : 0),
      ],
      [
        "split risks",
        String(productionSupportSnapshot ? productionSupportSnapshot.teamSplitRisks?.length ?? 0 : 0),
      ],
      [
        "pinned teams",
        productionSupportSnapshot
          ? formatCompactTeamList(productionSupportSnapshot.pinState?.pinnedTeams)
          : "--",
      ],
      [
        "pinned targets",
        productionSupportSnapshot
          ? String(productionSupportSnapshot.pinState?.pinnedTargetIds?.length ?? 0)
          : "--",
      ],
      [
        "watching now",
        productionSupportSnapshot?.operatorState?.watchingNowTargetId || "--",
      ],
      [
        "replay candidates",
        String(productionSupportSnapshot ? productionSupportSnapshot.replayCandidates?.length ?? 0 : 0),
      ],
      [
        "suppressed targets",
        productionSupportSnapshot?.operatorState?.suppressedTargetIds?.length
          ? productionSupportSnapshot.operatorState.suppressedTargetIds.join(", ")
          : "--",
      ],
      [
        "dismissed alerts",
        String(productionSupportSnapshot ? productionSupportSnapshot.operatorState?.dismissedAlertIds?.length ?? 0 : 0),
      ],
      [
        "selected target",
        workflowState.selectedTargetId || "--",
      ],
      [
        "selected alert",
        workflowState.selectedAlertId || "--",
      ],
      [
        "highlighted target",
        workflowState.highlightedTargetId || "--",
      ],
      [
        "workflow focus",
        workflowState.mapFocusCenter
          ? `${formatNumber(workflowState.mapFocusCenter.x)}, ${formatNumber(workflowState.mapFocusCenter.y)}`
          : "--",
      ],
      [
        "workflow focus until",
        formatTimestamp(workflowState.mapFocusUntil),
      ],
      [
        "workflow action",
        workflowState.lastAction || "--",
      ],
      [
        "suggested focus",
        observerControlSuggestion && observerControlSuggestion.suggestedFocusCenter
          ? `${formatNumber(observerControlSuggestion.suggestedFocusCenter.x)}, ${formatNumber(observerControlSuggestion.suggestedFocusCenter.y)}`
          : "--",
      ],
      ["recent combat", String(assistSnapshot ? assistSnapshot.recentCombatCount ?? 0 : 0)],
      ["active kill pings", String(frame.killPingCount)],
      ["map note", mapDefinition && mapDefinition.notes ? mapDefinition.notes : "--"],
      ["warnings", warnings.length > 0 ? warnings.join(" | ") : "--"],
    ];

    if (state.operatorFlags.showCameraAssist && cameraAssistPayload?.recommendation) {
      rows.push([
        "camera action",
        formatPanelToken(cameraAssistPayload.recommendation.action),
      ]);
      rows.push([
        "camera current",
        cameraAssistPayload.recommendation.currentTargetId || "--",
      ]);
      rows.push([
        "camera target",
        cameraAssistPayload.recommendation.recommendedTargetId || "--",
      ]);
      rows.push([
        "camera confidence",
        formatConfidence(cameraAssistPayload.recommendation.confidence),
      ]);
      rows.push([
        "camera reasons",
        Array.isArray(cameraAssistPayload.recommendation.reasons) &&
        cameraAssistPayload.recommendation.reasons.length > 0
          ? cameraAssistPayload.recommendation.reasons.join(" | ")
          : "--",
      ]);
      rows.push([
        "camera backups",
        Array.isArray(cameraAssistPayload.recommendation.backupTargetIds) &&
        cameraAssistPayload.recommendation.backupTargetIds.length > 0
          ? cameraAssistPayload.recommendation.backupTargetIds.join(", ")
          : "--",
      ]);
    }

    if (state.debug && state.operatorFlags.showCameraAssist && cameraAssistPayload?.debug) {
      rows.push([
        "camera current score",
        String(cameraAssistPayload.debug.currentTargetScore ?? "--"),
      ]);
      rows.push([
        "camera target score",
        String(cameraAssistPayload.debug.recommendedTargetScore ?? "--"),
      ]);
      rows.push([
        "camera delta",
        String(cameraAssistPayload.debug.scoreDelta ?? "--"),
      ]);
      rows.push([
        "camera dwell",
        cameraAssistPayload.debug.dwellRemainingMs !== null &&
        cameraAssistPayload.debug.dwellRemainingMs !== undefined
          ? `${formatCompactDuration(cameraAssistPayload.debug.dwellRemainingMs)} remaining`
          : "--",
      ]);
      rows.push([
        "camera cooldown",
        cameraAssistPayload.debug.switchCooldownRemainingMs !== null &&
        cameraAssistPayload.debug.switchCooldownRemainingMs !== undefined
          ? `${formatCompactDuration(cameraAssistPayload.debug.switchCooldownRemainingMs)} remaining`
          : "--",
      ]);
      rows.push([
        "camera emergency",
        cameraAssistPayload.debug.emergencySwitchEligible ? "yes" : "no",
      ]);
      rows.push([
        "camera flap guard",
        cameraAssistPayload.debug.flapGuardActive ? "yes" : "no",
      ]);
      rows.push([
        "camera last action",
        cameraAssistPayload.debug.lastAction || "--",
      ]);
      rows.push([
        "camera last switch",
        formatTimestamp(cameraAssistPayload.debug.lastSwitchAt),
      ]);
      rows.push([
        "camera history",
        formatRecommendationHistory(
          cameraAssistPayload.debug.recentRecommendationHistory,
          productionSupportSnapshot,
        ),
      ]);
    }

    return rows
      .map(
        ([label, value]) =>
          `<div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div>`,
      )
      .join("");
  }

  function updateAssistPanel(frame) {
    assistPanel.hidden = !state.assistFlags.showPanel;
    if (!state.assistFlags.showPanel) {
      return;
    }

    if (frame.now - state.lastAssistRefreshAt < DEBUG_REFRESH_MS) {
      return;
    }

    const markup = buildAssistMarkup(state.assistSnapshot);
    if (markup !== state.assistMarkup) {
      assistGrid.innerHTML = markup;
      state.assistMarkup = markup;
    }
    state.lastAssistRefreshAt = frame.now;
  }

  function updateOperatorPanel(frame) {
    operatorPanel.hidden = !state.operatorFlags.showPanel;
    if (!state.operatorFlags.showPanel) {
      return;
    }

    if (frame.now - state.lastOperatorPanelRefreshAt < DEBUG_REFRESH_MS) {
      return;
    }

    const markup = buildOperatorPanelMarkup(state.productionSupportSnapshot);
    if (markup !== state.operatorPanelMarkup) {
      operatorPanelBody.innerHTML = markup;
      state.operatorPanelMarkup = markup;
    }
    state.lastOperatorPanelRefreshAt = frame.now;
  }

  function updateWatchQueuePanel(frame) {
    watchQueuePanel.hidden = !state.operatorFlags.showWatchQueue;
    if (!state.operatorFlags.showWatchQueue) {
      return;
    }

    if (frame.now - state.lastWatchQueueRefreshAt < DEBUG_REFRESH_MS) {
      return;
    }

    const markup = buildWatchQueueMarkup(state.productionSupportSnapshot);
    if (markup !== state.watchQueueMarkup) {
      watchQueueList.innerHTML = markup;
      state.watchQueueMarkup = markup;
    }
    state.lastWatchQueueRefreshAt = frame.now;
  }

  function updateAlertsPanel(frame) {
    alertsPanel.hidden = !state.operatorFlags.showAlerts;
    if (!state.operatorFlags.showAlerts) {
      return;
    }

    if (frame.now - state.lastAlertsRefreshAt < DEBUG_REFRESH_MS) {
      return;
    }

    const markup = buildAlertsMarkup(state.productionSupportSnapshot);
    if (markup !== state.alertsMarkup) {
      alertsList.innerHTML = markup;
      state.alertsMarkup = markup;
    }
    state.lastAlertsRefreshAt = frame.now;
  }

  function syncOperatorStackVisibility() {
    operatorStack.hidden = !(
      state.assistFlags.showPanel ||
      state.operatorFlags.showPanel ||
      state.operatorFlags.showWatchQueue ||
      state.operatorFlags.showAlerts
    );
  }

  function updateDebug(frame) {
    debugPanel.hidden = !state.debug;
    if (!state.debug) {
      return;
    }

    if (frame.now - state.lastDebugRefreshAt < DEBUG_REFRESH_MS) {
      return;
    }

    const markup = buildDebugMarkup(frame);
    if (markup !== state.debugMarkup) {
      debugGrid.innerHTML = markup;
      state.debugMarkup = markup;
    }
    state.lastDebugRefreshAt = frame.now;
  }

  function loadMapImage() {
    const mapDefinition = getMapDefinition();
    if (!mapDefinition || !mapDefinition.imageUrl) {
      return;
    }

    if (image.dataset.currentSrc === mapDefinition.imageUrl) {
      return;
    }

    image.dataset.currentSrc = mapDefinition.imageUrl;
    image.src = mapDefinition.imageUrl;
  }

  function drawFrame(now) {
    const mapDefinition = getMapDefinition();
    const assistSnapshot = state.assistSnapshot;
    const productionSupportSnapshot = state.productionSupportSnapshot;
    const bounds = syncCanvasSize();
    const zoneAnimation = getAnimatedCircleState(state.zone, now);
    const currentCircle = zoneAnimation.circle;
    const nextCircle = getNextCircle(state.zone);
    const blueCircle = getBlueCircle(state.zone);
    const flightPath = getFlightPath(state.zone, now);
    const zoneShadeCircle = blueCircle ? null : currentCircle;
    const visiblePlayers = collectVisiblePlayers(now);
    updateMapCamera(
      mapDefinition,
      currentCircle,
      visiblePlayers,
      bounds.width,
      bounds.height,
      now,
    );
    applyMapCameraStyle(mapDefinition, bounds.width, bounds.height);
    const clusters = collectTeamClusters(mapDefinition);
    const hotZones =
      assistSnapshot && Array.isArray(assistSnapshot.hotZones) ? assistSnapshot.hotZones : [];
    const proximities =
      assistSnapshot && Array.isArray(assistSnapshot.teamProximities)
        ? assistSnapshot.teamProximities
        : [];
    const focusCandidates =
      assistSnapshot && Array.isArray(assistSnapshot.focusCandidates)
        ? assistSnapshot.focusCandidates
        : [];
    const fightHighlights =
      productionSupportSnapshot && Array.isArray(productionSupportSnapshot.fightHighlights)
        ? productionSupportSnapshot.fightHighlights
        : [];

    clearCanvas();
    drawGrid(bounds.width, bounds.height, mapDefinition);

    if (mapDefinition && zoneShadeCircle) {
      drawSafeZoneShade(zoneShadeCircle, mapDefinition, bounds.width, bounds.height);
    }

    if (mapDefinition && blueCircle) {
      drawBlueZoneShade(blueCircle, mapDefinition, bounds.width, bounds.height);
    }

    drawHotZones(hotZones, mapDefinition, bounds.width, bounds.height);

    if (mapDefinition && nextCircle) {
      drawNextZoneCircle(nextCircle, mapDefinition, bounds.width, bounds.height);
    }

    if (mapDefinition && currentCircle) {
      drawCurrentZoneCircle(currentCircle, mapDefinition, bounds.width, bounds.height);
    }

    if (mapDefinition && flightPath) {
      drawFlightPath(flightPath, mapDefinition, bounds.width, bounds.height, now);
    }

    drawProximityLinks(proximities, mapDefinition, bounds.width, bounds.height);
    drawTeamClusters(clusters, mapDefinition, bounds.width, bounds.height);
    const activeKillPingCount = 0;
    drawPlayers(visiblePlayers, mapDefinition, bounds.width, bounds.height);
    drawFocusCandidates(focusCandidates, mapDefinition, bounds.width, bounds.height);
    drawWorkflowFocusHighlight(now, mapDefinition, bounds.width, bounds.height);
    drawCircleDiagnostics(
      state.zone,
      zoneAnimation.circle,
      nextCircle,
      mapDefinition,
      bounds.width,
      bounds.height,
    );

    state.frame.animatedCircle = zoneAnimation.circle;
    state.frame.blueCircle = blueCircle;
    state.frame.clusters = clusters;
    state.frame.fightHighlights = fightHighlights;
    state.frame.flightPath = flightPath;
    state.frame.focusCandidates = focusCandidates;
    state.frame.hotZones = hotZones;
    state.frame.killPingCount = activeKillPingCount;
    state.frame.nextCircle = nextCircle;
    state.frame.now = now;
    state.frame.players = visiblePlayers;
    state.frame.proximities = proximities;
    state.frame.remainingMs = zoneAnimation.remainingMs;

    updateStatusPill(now);
    updateTimer(state.frame.remainingMs);
    updateLegendPanel(state.frame);
    updateCommentaryPanel(state.frame);
    updateDistancePanel(state.frame);
    syncSideRailVisibility();
    syncOperatorStackVisibility();
    updateAssistPanel(state.frame);
    updateOperatorPanel(state.frame);
    updateWatchQueuePanel(state.frame);
    updateAlertsPanel(state.frame);
    updateDebug(state.frame);
    window.requestAnimationFrame(renderLoop);
  }

  function buildSocketUrl() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = new URL(`${protocol}//${window.location.host}${bootstrap.wsPath || "/ws"}`);
    if (state.requestedMapKey) {
      url.searchParams.set("map", state.requestedMapKey);
    }
    return url.toString();
  }

  function setConnectionStatus(status) {
    state.connectionStatus = status;
  }

  function scheduleReconnect() {
    if (state.socketReconnectTimer) {
      return;
    }

    state.socketReconnectTimer = window.setTimeout(function () {
      state.socketReconnectTimer = null;
      connect();
    }, 2000);
  }

  function handleMessage(data) {
    let message;
    try {
      message = typeof data === "string" ? JSON.parse(data) : data;
    } catch (_) {
      return;
    }

    const receivedAt = Date.now();
    state.lastMessageAt = receivedAt;

    if (!message || typeof message !== "object") {
      return;
    }

    switch (message.type) {
      case "map_context":
        applyMapContext(message.payload || null);
        break;
      case "zone_update":
        applyZonePacket(message.payload || null, receivedAt);
        break;
      case "player_positions":
        applyPlayerPacket(message.payload || null, receivedAt);
        break;
      case "observer_assist":
        applyObserverAssistPacket(message.payload || null);
        break;
      case "production_support":
        applyProductionSupportPacket(message.payload || null);
        break;
      case "team_branding":
        applyTeamBrandingPacket(message.payload || null);
        break;
      case "runtime_reset":
        applyRuntimeReset();
        break;
      case "heartbeat":
        state.lastHeartbeatAt = receivedAt;
        break;
      default:
        break;
    }
  }

  function isEditableElement(element) {
    const node = element && element.nodeType === 1 ? element : null;
    if (!node) {
      return false;
    }

    const tagName = String(node.tagName || "").toLowerCase();
    if (tagName === "input" || tagName === "textarea" || tagName === "select") {
      return true;
    }

    return Boolean(node.isContentEditable);
  }

  function runOperatorSelection(action, id) {
    const actionPath = buildOperatorActionPath(action, id);
    if (!actionPath) {
      return;
    }

    runOperatorAction(actionPath, null);
  }

  function handleOperatorHotkey(event) {
    if (!state.operatorFlags.showPanel || event.defaultPrevented || event.repeat) {
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (isEditableElement(event.target)) {
      return;
    }

    const snapshot = state.productionSupportSnapshot;
    const workflowState = getOperatorWorkflowState(snapshot);
    const selectedTargetId = workflowState.selectedTargetId;
    const selectedAlertId = workflowState.selectedAlertId;
    const key = String(event.key || "").trim().toLowerCase();
    if (!key) {
      return;
    }

    if (/^[1-5]$/.test(key)) {
      const selectableWatchTargets = getSelectableWatchTargets(snapshot);
      const target = selectableWatchTargets[Number(key) - 1] || null;
      if (target) {
        event.preventDefault();
        runOperatorSelection("select-target", target.id);
      }
      return;
    }

    if (key === OPERATOR_HOTKEYS.acceptRecommendation) {
      event.preventDefault();
      runOperatorAction(buildOperatorActionPath("accept-recommendation"), null);
      return;
    }

    if (key === OPERATOR_HOTKEYS.dismissAlert && selectedAlertId) {
      const dismissedAlertIds = Array.isArray(snapshot?.operatorState?.dismissedAlertIds)
        ? snapshot.operatorState.dismissedAlertIds
        : [];
      event.preventDefault();
      runOperatorSelection(
        dismissedAlertIds.includes(selectedAlertId) ? "undismiss-alert" : "dismiss-alert",
        selectedAlertId,
      );
      return;
    }
    if (key === OPERATOR_HOTKEYS.replay && !selectedTargetId && selectedAlertId) {
      const replayCandidates = Array.isArray(snapshot?.replayCandidates) ? snapshot.replayCandidates : [];
      const hasReplayCandidate = replayCandidates.some(
        (candidate) => candidate.sourceId === selectedAlertId || candidate.id === selectedAlertId,
      );
      event.preventDefault();
      runOperatorSelection(
        hasReplayCandidate ? "unmark-replay" : "mark-replay",
        selectedAlertId,
      );
      return;
    }

    if (!selectedTargetId) {
      return;
    }

    if (key === OPERATOR_HOTKEYS.watchNow) {
      event.preventDefault();
      runOperatorSelection("watch-now", selectedTargetId);
      return;
    }
    if (key === OPERATOR_HOTKEYS.pin) {
      event.preventDefault();
      runOperatorSelection("pin-target", selectedTargetId);
      return;
    }
    if (key === OPERATOR_HOTKEYS.unpin) {
      event.preventDefault();
      runOperatorSelection("unpin-target", selectedTargetId);
      return;
    }
    if (key === OPERATOR_HOTKEYS.replay) {
      const replayCandidates = Array.isArray(snapshot?.replayCandidates) ? snapshot.replayCandidates : [];
      const hasReplayCandidate = replayCandidates.some(
        (candidate) => candidate.sourceId === selectedTargetId || candidate.id === selectedTargetId,
      );
      event.preventDefault();
      runOperatorSelection(
        hasReplayCandidate ? "unmark-replay" : "mark-replay",
        selectedTargetId,
      );
      return;
    }
    if (key === OPERATOR_HOTKEYS.suppress) {
      event.preventDefault();
      runOperatorSelection("suppress-target", selectedTargetId);
      return;
    }
    if (key === OPERATOR_HOTKEYS.unsuppress) {
      event.preventDefault();
      runOperatorSelection("unsuppress-target", selectedTargetId);
      return;
    }
    if (key === OPERATOR_HOTKEYS.center) {
      event.preventDefault();
      runOperatorSelection("center-target", selectedTargetId);
    }
  }

  async function runOperatorAction(actionPath, trigger) {
    if (!actionPath || state.lastOperatorActionPath === actionPath) {
      return;
    }

    state.lastOperatorActionPath = actionPath;
    if (trigger) {
      trigger.disabled = true;
    }

    try {
      const response = await window.fetch(actionPath, {
        method: "GET",
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (payload && payload.productionSupport) {
        applyProductionSupportPacket(payload.productionSupport);
        state.lastOperatorPanelRefreshAt = 0;
        state.lastWatchQueueRefreshAt = 0;
        state.lastAlertsRefreshAt = 0;
        state.lastDebugRefreshAt = 0;
      }
    } catch (_) {
      // Ignore transient local operator route failures in the OBS widget.
    } finally {
      state.lastOperatorActionPath = "";
      if (trigger) {
        trigger.disabled = false;
      }
    }
  }

  function handleOperatorPanelClick(event) {
    const actionButton =
      event.target && typeof event.target.closest === "function"
        ? event.target.closest("[data-action-path]")
        : null;
    if (!actionButton) {
      return;
    }

    event.preventDefault();
    const actionPath = actionButton.getAttribute("data-action-path");
    runOperatorAction(actionPath, actionButton);
    return;
  }

  function handleOperatorSelectionClick(event) {
    const actionButton =
      event.target && typeof event.target.closest === "function"
        ? event.target.closest("[data-action-path]")
        : null;
    if (actionButton) {
      return;
    }

    const selectableTarget =
      event.target && typeof event.target.closest === "function"
        ? event.target.closest("[data-select-target-id], [data-select-alert-id]")
        : null;
    if (!selectableTarget) {
      return;
    }

    const selectedTargetId = selectableTarget.getAttribute("data-select-target-id");
    const selectedAlertId = selectableTarget.getAttribute("data-select-alert-id");
    if (selectedTargetId) {
      event.preventDefault();
      runOperatorSelection("select-target", selectedTargetId);
      return;
    }
    if (selectedAlertId) {
      event.preventDefault();
      runOperatorSelection("select-alert", selectedAlertId);
    }
  }

  function connect() {
    if (
      state.socket &&
      (state.socket.readyState === WebSocket.OPEN || state.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const socket = new WebSocket(buildSocketUrl());
    state.socket = socket;
    setConnectionStatus("connecting");

    socket.addEventListener("open", function () {
      state.lastHeartbeatAt = Date.now();
      setConnectionStatus("connected");
    });

    socket.addEventListener("message", function (event) {
      handleMessage(event.data);
    });

    socket.addEventListener("close", function () {
      if (state.socket === socket) {
        state.socket = null;
      }
      setConnectionStatus("disconnected");
      scheduleReconnect();
    });

    socket.addEventListener("error", function () {
      setConnectionStatus("error");
    });
  }

  function renderLoop() {
    drawFrame(Date.now());
  }

  image.addEventListener("load", function () {
    applyMapViewport();
    syncCanvasSize();
  });

  image.addEventListener("error", function () {
    updateStatusPill(Date.now());
  });

  if (typeof ResizeObserver === "function") {
    const resizeObserver = new ResizeObserver(function () {
      syncCanvasSize();
    });
    resizeObserver.observe(stage);
  }

  window.addEventListener("resize", function () {
    syncCanvasSize();
  });

  operatorPanel.addEventListener("click", handleOperatorPanelClick);
  operatorPanel.addEventListener("click", handleOperatorSelectionClick);
  watchQueuePanel.addEventListener("click", handleOperatorSelectionClick);
  alertsPanel.addEventListener("click", handleOperatorSelectionClick);
  stage.addEventListener("wheel", handleMapWheel, { passive: false });
  stage.addEventListener("pointerdown", handleMapPointerDown);
  stage.addEventListener("pointermove", handleMapPointerMove);
  stage.addEventListener("pointerup", handleMapPointerUp);
  stage.addEventListener("pointercancel", handleMapPointerUp);
  stage.addEventListener("dblclick", handleMapDoubleClick);
  window.addEventListener("keydown", handleMapCameraHotkey);
  window.addEventListener("keydown", handleOperatorHotkey);

  applyMapContext(bootstrap.snapshot ? bootstrap.snapshot.mapContext : null);
  applyZonePacket(
    bootstrap.snapshot ? bootstrap.snapshot.zone : null,
    toFiniteNumber(bootstrap.serverTime, Date.now()),
  );
  applyTeamBrandingPacket(bootstrap.snapshot ? bootstrap.snapshot.teamBranding : null);
  applyPlayerPacket(
    bootstrap.snapshot ? bootstrap.snapshot.players : null,
    toFiniteNumber(bootstrap.serverTime, Date.now()),
  );
  applyObserverAssistPacket(bootstrap.snapshot ? bootstrap.snapshot.observerAssist : null);
  applyProductionSupportPacket(bootstrap.snapshot ? bootstrap.snapshot.productionSupport : null);
  syncCanvasSize();
  loadMapImage();
  connect();
  window.requestAnimationFrame(renderLoop);
})();
