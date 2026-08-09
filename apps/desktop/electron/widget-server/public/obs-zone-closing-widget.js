(function () {
  const bootstrap = window.__ARENZYRA_LOCAL_WIDGET_BOOTSTRAP__ || {};
  const timerRoot = document.getElementById("zone-timer-root");
  const timerPhaseEl = document.getElementById("zone-timer-phase");
  const timerModeEl = document.getElementById("zone-timer-mode");
  const timerCountdownEl = document.getElementById("zone-timer-countdown");
  const timerStatusEl = document.getElementById("zone-timer-status");
  const alertRoot = document.getElementById("zone-alert-root");
  const alertKickerEl = document.getElementById("zone-alert-kicker");
  const alertTitleEl = document.getElementById("zone-alert-title");
  const alertPhaseEl = document.getElementById("zone-alert-phase");
  const alertCountdownEl = document.getElementById("zone-alert-countdown");
  const alertStatusEl = document.getElementById("zone-alert-status");
  const nextZoneRoot = document.getElementById("next-zone-update-root");
  const nextZonePhaseEl = document.getElementById("next-zone-update-phase");
  const nextZoneCountdownEl = document.getElementById("next-zone-update-countdown");
  const nextZoneProgressEl = document.getElementById("next-zone-update-progress");
  const nextZoneStatusEl = document.getElementById("next-zone-update-status");

  if (
    !timerRoot &&
    !alertRoot &&
    !nextZoneRoot
  ) {
    return;
  }

  const RECONNECT_DELAY_MS = 2000;
  const ZONE_STALE_MS = 1500;
  const NEXT_ZONE_REVEAL_MS = 20 * 1000;
  const NEXT_ZONE_DISPLAY_LATENCY_COMPENSATION_MS = 0;
  const BRANDING_REFRESH_MS = 5000;
  const TIMER_RESYNC_DRIFT_MS = 500;
  const INFERRED_MODE_STABILIZE_MS = 140;
  const COUNTDOWN_CLAMP_LOG_THRESHOLD_MS = 250;
  const MIN_EVENT_TIMESTAMP_MS = Date.UTC(2020, 0, 1);
  const MAX_EVENT_CLOCK_SKEW_MS = 5 * 60 * 1000;
  const CIRCLE_DELTA_EPSILON = 1;
  const OPENING_OR_FINISHED_PHASES = new Set([
    "lobby",
    "waiting",
    "plane",
    "parachuting",
    "finished",
  ]);

  const state = {
    socket: null,
    reconnectTimer: null,
    staleTimer: null,
    renderFrame: null,
    wsConnected: false,
    zone: null,
    displayTargetEndAt: null,
    visibleRemainingMs: null,
    lastVisibleRemainingAt: 0,
    allowCountdownReset: false,
    lastZoneSeenAt: 0,
    warningTriggeredPhaseKeys: new Set(),
    closingTriggeredPhaseKeys: new Set(),
    alertState: "idle",
    lastTimerSignature: "",
    lastAlertSignature: "",
    lastNextZoneSignature: "",
    lastBrandingSignature: "",
    lastCountdownClampLogAt: 0,
    pendingInferredMode: "",
    pendingInferredModePhaseKey: "",
    pendingInferredModeSince: 0,
    lastAlertReplayIgnoredSignature: "",
    brandingRefreshTimer: null,
    brandingRefreshInFlight: false,
    nextZoneExitTimer: null,
  };

  function asString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function toFiniteNumber(value) {
    const numeric =
      typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    return Number.isFinite(numeric) ? numeric : null;
  }

  function pickFinite() {
    for (const value of arguments) {
      const numeric = toFiniteNumber(value);
      if (numeric !== null) {
        return numeric;
      }
    }

    return null;
  }

  function setText(node, value) {
    if (node && node.textContent !== value) {
      node.textContent = value;
    }
  }

  function setHidden(node, hidden) {
    if (node && node.hidden !== hidden) {
      node.hidden = hidden;
    }
  }

  function setVisible(node, visible) {
    if (!node) {
      return;
    }

    node.hidden = !visible;
    node.classList.toggle("is-visible", visible);
  }

  function setNextZoneVisible(visible) {
    if (!nextZoneRoot) {
      return;
    }

    const foldDown = nextZoneRoot.dataset.style === "fold-down";
    if (!foldDown) {
      setVisible(nextZoneRoot, visible);
      return;
    }

    if (state.nextZoneExitTimer !== null) {
      window.clearTimeout(state.nextZoneExitTimer);
      state.nextZoneExitTimer = null;
    }

    if (visible) {
      nextZoneRoot.hidden = false;
      nextZoneRoot.classList.toggle("is-exiting", false);
      nextZoneRoot.classList.toggle("is-visible", true);
      return;
    }

    if (nextZoneRoot.hidden) {
      nextZoneRoot.classList.toggle("is-visible", false);
      nextZoneRoot.classList.toggle("is-exiting", false);
      return;
    }

    nextZoneRoot.classList.toggle("is-visible", false);
    nextZoneRoot.classList.toggle("is-exiting", true);
    state.nextZoneExitTimer = window.setTimeout(() => {
      nextZoneRoot.hidden = true;
      nextZoneRoot.classList.toggle("is-exiting", false);
      state.nextZoneExitTimer = null;
    }, 240);
  }

  function setElementData(node, key, value) {
    if (node && node.dataset[key] !== value) {
      node.dataset[key] = value;
    }
  }

  function parseMaybeJsonObject(value) {
    if (!value) {
      return null;
    }

    if (typeof value === "object") {
      return value;
    }

    if (typeof value !== "string") {
      return null;
    }

    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function sanitizeCssColor(value, fallback) {
    const normalized = asString(value);
    if (
      !normalized ||
      normalized.length > 96 ||
      /[;{}<>]/.test(normalized)
    ) {
      return fallback;
    }

    return normalized;
  }

  function pickBrandingColor(source, names, fallback) {
    const branding = source && typeof source === "object" ? source : {};
    for (const name of names) {
      const value = sanitizeCssColor(branding[name], "");
      if (value) {
        return value;
      }
    }
    return fallback;
  }

  function hexToRgb(value) {
    const normalized = asString(value).replace(/^#/, "");
    if (!/^[a-fA-F0-9]{3}$|^[a-fA-F0-9]{6}$/.test(normalized)) {
      return null;
    }

    const expanded =
      normalized.length === 3
        ? normalized
            .split("")
            .map((character) => `${character}${character}`)
            .join("")
        : normalized;

    return {
      r: parseInt(expanded.slice(0, 2), 16),
      g: parseInt(expanded.slice(2, 4), 16),
      b: parseInt(expanded.slice(4, 6), 16),
    };
  }

  function alphaColor(value, alpha, fallback) {
    const rgb = hexToRgb(value);
    if (!rgb) {
      return fallback;
    }

    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  }

  function relativeLuminance(value) {
    const rgb = hexToRgb(value);
    if (!rgb) {
      return null;
    }

    const toLinear = (channel) => {
      const normalized = channel / 255;
      return normalized <= 0.03928
        ? normalized / 12.92
        : Math.pow((normalized + 0.055) / 1.055, 2.4);
    };

    return (
      0.2126 * toLinear(rgb.r) +
      0.7152 * toLinear(rgb.g) +
      0.0722 * toLinear(rgb.b)
    );
  }

  function contrastRatio(first, second) {
    const firstLuminance = relativeLuminance(first);
    const secondLuminance = relativeLuminance(second);
    if (firstLuminance === null || secondLuminance === null) {
      return null;
    }

    const light = Math.max(firstLuminance, secondLuminance);
    const dark = Math.min(firstLuminance, secondLuminance);
    return (light + 0.05) / (dark + 0.05);
  }

  function readableTextColorForBackground(background, dark, light) {
    const darkRatio = contrastRatio(background, dark);
    const lightRatio = contrastRatio(background, light);
    if (darkRatio === null || lightRatio === null) {
      return light;
    }

    return darkRatio >= lightRatio ? dark : light;
  }

  function getBrandingSource() {
    const organizationBranding = parseMaybeJsonObject(
      bootstrap.organization && bootstrap.organization.branding,
    );
    const directBranding = parseMaybeJsonObject(bootstrap.branding);
    const dataBranding = parseMaybeJsonObject(bootstrap.data);

    // The permanent-widget resolver returns branding under organization, while
    // the organization branding endpoint returns the palette directly. Merge
    // the supported shapes instead of letting an incomplete organization
    // record discard a complete direct palette during a live refresh.
    return {
      ...(dataBranding || {}),
      ...(directBranding || {}),
      ...(organizationBranding || {}),
    };
  }

  function applyBrandingFromBootstrap() {
    if (!nextZoneRoot) {
      return;
    }

    const branding = getBrandingSource();
    const primary = pickBrandingColor(
      branding,
      ["primaryColor", "primary", "liveColor", "accent"],
      "#34d399",
    );
    const accent = pickBrandingColor(
      branding,
      ["accent", "secondaryColor", "secondary", "primaryColor"],
      "#a78bfa",
    );
    const panel = pickBrandingColor(
      branding,
      ["panel", "widgetBackground", "backgroundSolid", "effectiveBackground"],
      "#1c2330",
    );
    const text = pickBrandingColor(
      branding,
      ["textPrimary", "text", "badgeText"],
      "#f8fbff",
    );
    const muted = pickBrandingColor(
      branding,
      ["textMuted", "muted"],
      "#cbd5e1",
    );
    const border = pickBrandingColor(
      branding,
      ["border"],
      alphaColor(primary, 0.34, "rgba(52, 211, 153, 0.34)"),
    );
    const glow = pickBrandingColor(
      branding,
      ["glowAccent"],
      alphaColor(primary, 0.32, "rgba(52, 211, 153, 0.32)"),
    );
    const primaryText = readableTextColorForBackground(
      primary,
      "#101410",
      "#ffffff",
    );
    const accentText = readableTextColorForBackground(
      accent,
      "#15110a",
      "#ffffff",
    );
    const signature = [
      primary,
      accent,
      panel,
      text,
      muted,
      border,
      glow,
      primaryText,
      accentText,
    ].join("|");

    if (signature === state.lastBrandingSignature) {
      return;
    }

    const style = document.documentElement.style;
    style.setProperty("--next-zone-primary", primary);
    style.setProperty("--next-zone-accent", accent);
    style.setProperty("--next-zone-panel", panel);
    style.setProperty("--next-zone-text", text);
    style.setProperty("--next-zone-muted", muted);
    style.setProperty("--next-zone-border", border);
    style.setProperty("--next-zone-glow", glow);
    style.setProperty("--next-zone-primary-text", primaryText);
    style.setProperty("--next-zone-accent-text", accentText);
    style.setProperty(
      "--next-zone-primary-soft",
      alphaColor(primary, 0.18, "rgba(52, 211, 153, 0.18)"),
    );
    style.setProperty(
      "--next-zone-accent-soft",
      alphaColor(accent, 0.16, "rgba(167, 139, 250, 0.16)"),
    );
    state.lastBrandingSignature = signature;
  }

  function applyBootstrapContext(payload) {
    if (!payload || typeof payload !== "object") {
      return;
    }

    if (payload.organization !== undefined) {
      bootstrap.organization = payload.organization;
    }
    if (payload.branding !== undefined) {
      bootstrap.branding = payload.branding;
    }
    if (payload.data !== undefined) {
      bootstrap.data = payload.data;
    }
    if (payload.tournament !== undefined) {
      bootstrap.tournament = payload.tournament;
    }
    if (payload.match !== undefined) {
      bootstrap.match = payload.match;
    }
    if (payload.organizationId !== undefined) {
      bootstrap.organizationId = payload.organizationId;
    }
    if (payload.organizationSlug !== undefined) {
      bootstrap.organizationSlug = payload.organizationSlug;
    }
    if (payload.tournamentId !== undefined) {
      bootstrap.tournamentId = payload.tournamentId;
    }
    if (payload.matchId !== undefined) {
      bootstrap.matchId = payload.matchId;
    }

    applyBrandingFromBootstrap();
  }

  async function refreshBrandingContext() {
    const path = asString(bootstrap.brandingRefreshPath);
    if (!path || state.brandingRefreshInFlight) {
      return;
    }

    state.brandingRefreshInFlight = true;
    try {
      const response = await fetch(path, {
        cache: "no-store",
      });
      if (!response.ok) {
        return;
      }
      const payload = await response.json();
      if (payload && payload.ok !== false) {
        applyBootstrapContext(payload);
      }
    } catch (_) {
      // Keep the current branding when the backend is unreachable.
    } finally {
      state.brandingRefreshInFlight = false;
    }
  }

  function clearBrandingRefreshTimer() {
    if (state.brandingRefreshTimer !== null) {
      window.clearInterval(state.brandingRefreshTimer);
      state.brandingRefreshTimer = null;
    }
  }

  function startBrandingRefresh() {
    if (!nextZoneRoot) {
      return;
    }

    applyBrandingFromBootstrap();
    refreshBrandingContext();
    clearBrandingRefreshTimer();
    if (asString(bootstrap.brandingRefreshPath)) {
      state.brandingRefreshTimer = window.setInterval(
        refreshBrandingContext,
        BRANDING_REFRESH_MS,
      );
    }
  }

  function clearRenderFrame() {
    if (state.renderFrame !== null) {
      window.cancelAnimationFrame(state.renderFrame);
      state.renderFrame = null;
    }
  }

  function clearStaleTimer() {
    if (state.staleTimer !== null) {
      window.clearTimeout(state.staleTimer);
      state.staleTimer = null;
    }
  }

  function clearPendingInferredMode() {
    state.pendingInferredMode = "";
    state.pendingInferredModePhaseKey = "";
    state.pendingInferredModeSince = 0;
  }

  function applyRuntimeReset() {
    clearStaleTimer();
    clearPendingInferredMode();
    state.zone = null;
    state.displayTargetEndAt = null;
    state.visibleRemainingMs = null;
    state.lastVisibleRemainingAt = 0;
    state.allowCountdownReset = false;
    state.lastZoneSeenAt = 0;
    state.warningTriggeredPhaseKeys.clear();
    state.closingTriggeredPhaseKeys.clear();
    state.alertState = "idle";
    state.lastTimerSignature = "";
    state.lastAlertSignature = "";
    state.lastNextZoneSignature = "";
    state.lastAlertReplayIgnoredSignature = "";
  }

  function normalizeDurationMs(value) {
    const numeric = toFiniteNumber(value);
    if (numeric === null) {
      return null;
    }

    return Math.abs(numeric) > 1000 ? Math.round(numeric) : Math.round(numeric * 1000);
  }

  function isUsableEventTimestamp(eventTimestamp, receivedAt) {
    const numeric = toFiniteNumber(eventTimestamp);
    if (numeric === null || numeric < MIN_EVENT_TIMESTAMP_MS) {
      return false;
    }

    return Math.abs(receivedAt - numeric) <= MAX_EVENT_CLOCK_SKEW_MS;
  }

  function resolveTargetEndAt(payload, fallbackTimestamp) {
    const directTargetEndAt = pickFinite(
      payload && payload.targetEndAt,
      payload && payload.timing && payload.timing.targetEndAt,
    );
    if (directTargetEndAt !== null) {
      return directTargetEndAt;
    }

    const durationMs = pickFinite(
      normalizeDurationMs(payload && payload.timeRemainingMs),
      normalizeDurationMs(payload && payload.timeRemaining),
      normalizeDurationMs(payload && payload.timing && payload.timing.durationMs),
    );
    if (durationMs === null) {
      return null;
    }

    const receivedAt = pickFinite(
      payload && payload.receivedAt,
      fallbackTimestamp,
      Date.now(),
    );
    const eventTimestamp = toFiniteNumber(payload && payload.timestamp);
    const baseTimestamp = isUsableEventTimestamp(eventTimestamp, receivedAt)
      ? eventTimestamp
      : receivedAt;

    return Math.max(baseTimestamp + durationMs, receivedAt);
  }

  function normalizePhase(value) {
    const numeric = toFiniteNumber(value);
    if (numeric !== null) {
      return Math.max(1, Math.round(numeric));
    }

    const normalized = asString(value);
    return normalized || null;
  }

  function getPhaseIdentity(phase) {
    return phase === null ? "unknown" : String(phase);
  }

  function formatPhaseLabel(phase) {
    if (phase === null) {
      return "Phase --";
    }

    return `Phase ${String(phase).toUpperCase()}`;
  }

  function formatCompactPhaseLabel(phase) {
    if (phase === null) {
      return "P--";
    }

    const numeric = toFiniteNumber(phase);
    if (numeric !== null) {
      return `P${Math.trunc(numeric)}`;
    }

    return String(phase).toUpperCase();
  }

  function resolveCircle(payload, prefix) {
    const directCircle = payload && payload[`${prefix}Circle`];
    const rawCircle =
      payload && payload.raw && payload.raw[`${prefix}Circle`];
    const source = directCircle && typeof directCircle === "object" ? directCircle : rawCircle;

    const centerX = toFiniteNumber(
      source && source.centerX !== undefined
        ? source.centerX
        : source && source.x !== undefined
          ? source.x
          : payload && payload[`${prefix === "next" ? "nextCenterX" : "centerX"}`],
    );
    const centerY = toFiniteNumber(
      source && source.centerY !== undefined
        ? source.centerY
        : source && source.y !== undefined
          ? source.y
          : payload && payload[`${prefix === "next" ? "nextCenterY" : "centerY"}`],
    );
    const radius = toFiniteNumber(
      source && source.radius !== undefined
        ? source.radius
        : payload && payload[`${prefix === "next" ? "nextRadius" : "radius"}`],
    );

    if (centerX === null || centerY === null || radius === null) {
      return null;
    }

    return {
      centerX,
      centerY,
      radius,
    };
  }

  function resolveModeCandidate(candidate) {
    const numeric = toFiniteNumber(candidate);
    if (numeric !== null) {
      const status = Math.trunc(numeric);
      if (status === 2) {
        return "closing";
      }
      if (status === 0 || status === 1) {
        return "waiting";
      }
    }

    const normalized = asString(candidate)
      .toLowerCase()
      .replace(/[_-]+/g, " ");
    if (!normalized) {
      return null;
    }

    if (
      /\b(no|not)\s+(clos|clos(?:ing)?|shrink|shrinking|move|moving|collapse|collapsing)\b/.test(
        normalized,
      )
    ) {
      return "waiting";
    }

    if (
      normalized.includes("wait") ||
      normalized.includes("idle") ||
      normalized.includes("hold") ||
      normalized.includes("next") ||
      normalized.includes("open") ||
      normalized.includes("static") ||
      normalized.includes("prepare")
    ) {
      return "waiting";
    }

    if (
      normalized.includes("clos") ||
      normalized.includes("shrink") ||
      normalized.includes("move") ||
      normalized.includes("collapse")
    ) {
      return "closing";
    }

    return null;
  }

  function resolveExplicitMode(payload) {
    const candidates = [
      payload && payload.mode,
      payload && payload.zoneMode,
      payload && payload.state,
      payload && payload.status,
      payload && payload.phaseState,
      payload && payload.timing && payload.timing.mode,
    ];

    for (const candidate of candidates) {
      const mode = resolveModeCandidate(candidate);
      if (mode) {
        return mode;
      }
    }

    return null;
  }

  function getCircleDelta(previousCircle, nextCircle) {
    if (!previousCircle || !nextCircle) {
      return 0;
    }

    return Math.max(
      Math.abs(previousCircle.centerX - nextCircle.centerX),
      Math.abs(previousCircle.centerY - nextCircle.centerY),
      Math.abs(previousCircle.radius - nextCircle.radius),
    );
  }

  function buildZonePhaseKey(payload, phase, targetEndAt) {
    const explicitKey = asString(
      payload &&
        (payload.zoneSequenceId ||
          payload.sequenceId ||
          payload.sequence ||
          payload.zoneId),
    );
    if (explicitKey) {
      return explicitKey;
    }

    const phaseIdentity = getPhaseIdentity(phase);
    if (phaseIdentity !== "unknown") {
      return phaseIdentity;
    }

    return targetEndAt === null ? "unknown" : `target:${Math.round(targetEndAt / 1000)}`;
  }

  function normalizeZoneUpdate(payload, fallbackTimestamp) {
    if (!payload || typeof payload !== "object") {
      return null;
    }

    const phase = normalizePhase(payload.phase);
    const lastUpdateAt = pickFinite(payload.receivedAt, fallbackTimestamp, Date.now());
    const targetEndAt = resolveTargetEndAt(payload, fallbackTimestamp);
    const currentCircle = resolveCircle(payload, "current");
    const nextCircle = resolveCircle(payload, "next");
    const phaseKey = buildZonePhaseKey(payload, phase, targetEndAt);
    const explicitMode = resolveExplicitMode(payload);
    const previousZone = state.zone;
    const samePhase =
      previousZone && previousZone.phaseKey === phaseKey;
    const circleDelta = samePhase
      ? getCircleDelta(previousZone.currentCircle, currentCircle)
      : 0;
    let inferredMode = "unknown";
    if (samePhase && circleDelta > CIRCLE_DELTA_EPSILON) {
      inferredMode = "closing";
    } else if (
      samePhase &&
      previousZone &&
      previousZone.mode === "closing" &&
      targetEndAt !== null
    ) {
      inferredMode = "closing";
    } else if (targetEndAt !== null) {
      inferredMode = "waiting";
    }

    const modeResolution = resolveMode({
      explicitMode,
      inferredMode,
      phaseKey,
      phase,
      lastUpdateAt,
      previousZone,
    });

    return {
      phase,
      phaseKey,
      matchPhase: asString(payload.matchPhase).toLowerCase() || null,
      targetEndAt,
      mode: modeResolution.mode,
      modeSource: modeResolution.modeSource,
      lastUpdateAt,
      stale: false,
      currentCircle,
      nextCircle,
    };
  }

  function getRawRemainingMs(now = Date.now()) {
    const targetEndAt = toFiniteNumber(state.displayTargetEndAt);
    if (targetEndAt === null) {
      return null;
    }

    return Math.max(0, targetEndAt - now);
  }

  function getRemainingMs(now = Date.now()) {
    const rawRemainingMs = getRawRemainingMs(now);
    if (rawRemainingMs === null) {
      state.visibleRemainingMs = null;
      state.lastVisibleRemainingAt = now;
      state.allowCountdownReset = false;
      return null;
    }

    if (
      state.visibleRemainingMs === null ||
      state.lastVisibleRemainingAt === 0 ||
      state.allowCountdownReset
    ) {
      state.visibleRemainingMs = rawRemainingMs;
      state.lastVisibleRemainingAt = now;
      state.allowCountdownReset = false;
      return state.visibleRemainingMs;
    }

    const elapsedMs = Math.max(0, now - state.lastVisibleRemainingAt);
    const expectedRemainingMs = Math.max(0, state.visibleRemainingMs - elapsedMs);
    let nextRemainingMs = rawRemainingMs;

    if (rawRemainingMs > expectedRemainingMs) {
      const driftMs = rawRemainingMs - expectedRemainingMs;
      nextRemainingMs = expectedRemainingMs;
      if (
        driftMs >= COUNTDOWN_CLAMP_LOG_THRESHOLD_MS &&
        now - state.lastCountdownClampLogAt >= 500
      ) {
        state.lastCountdownClampLogAt = now;
        console.info("[Widget] Zone countdown clamped", {
          phase: state.zone && state.zone.phase,
          driftMs: Math.round(driftMs),
          rawRemainingMs: Math.round(rawRemainingMs),
          visibleRemainingMs: Math.round(expectedRemainingMs),
        });
      }
    }

    state.visibleRemainingMs = Math.max(0, nextRemainingMs);
    state.lastVisibleRemainingAt = now;
    return state.visibleRemainingMs;
  }

  function formatCountdown(remainingMs) {
    if (remainingMs === null) {
      return "--:--";
    }

    const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function getTimerModeLabel(zone) {
    if (!zone) {
      return "Zone Syncing";
    }

    if (zone.mode === "closing") {
      return "Zone Closing";
    }

    if (zone.mode === "waiting") {
      return "Next Zone";
    }

    return "Zone Syncing";
  }

  function getConnectionLabel(zone) {
    if (!state.wsConnected) {
      return "WS OFFLINE";
    }

    if (zone && zone.stale) {
      return "STALE";
    }

    return "";
  }

  function isOpeningOrFinishedMatchPhase(matchPhase) {
    const normalized = asString(matchPhase).toLowerCase();
    return normalized ? OPENING_OR_FINISHED_PHASES.has(normalized) : false;
  }

  function shouldShowNextZoneUpdate(zone, remainingMs, revealWindowMs) {
    if (!zone || remainingMs === null) {
      return false;
    }

    if (zone.mode !== "closing") {
      return false;
    }

    if (isOpeningOrFinishedMatchPhase(zone.matchPhase)) {
      return false;
    }

    return remainingMs > 0 && remainingMs <= revealWindowMs;
  }

  function resolveMode({
    explicitMode,
    inferredMode,
    phaseKey,
    phase,
    lastUpdateAt,
    previousZone,
  }) {
    if (explicitMode) {
      clearPendingInferredMode();
      return {
        mode: explicitMode,
        modeSource: "explicit",
      };
    }

    if (!previousZone || previousZone.phaseKey !== phaseKey) {
      clearPendingInferredMode();
      return {
        mode: inferredMode,
        modeSource: "inferred",
      };
    }

    if (inferredMode === previousZone.mode) {
      clearPendingInferredMode();
      return {
        mode: inferredMode,
        modeSource: "inferred",
      };
    }

    if (
      state.pendingInferredModePhaseKey !== phaseKey ||
      state.pendingInferredMode !== inferredMode
    ) {
      state.pendingInferredModePhaseKey = phaseKey;
      state.pendingInferredMode = inferredMode;
      state.pendingInferredModeSince = lastUpdateAt;
      return {
        mode: previousZone.mode,
        modeSource: previousZone.modeSource || "inferred",
      };
    }

    if (lastUpdateAt - state.pendingInferredModeSince < INFERRED_MODE_STABILIZE_MS) {
      return {
        mode: previousZone.mode,
        modeSource: previousZone.modeSource || "inferred",
      };
    }

    clearPendingInferredMode();
    console.info("[Widget] Zone inferred mode stabilized", {
      phase,
      mode: inferredMode,
    });
    return {
      mode: inferredMode,
      modeSource: "inferred",
    };
  }

  function triggerAlert(nextAlertState, phaseKey, zone, remainingMs) {
    if (!phaseKey || !zone) {
      return;
    }

    const triggeredPhaseKeys =
      nextAlertState === "closing"
        ? state.closingTriggeredPhaseKeys
        : state.warningTriggeredPhaseKeys;
    if (triggeredPhaseKeys.has(phaseKey)) {
      const replaySignature = `${nextAlertState}:${phaseKey}`;
      if (state.lastAlertReplayIgnoredSignature !== replaySignature) {
        state.lastAlertReplayIgnoredSignature = replaySignature;
        console.info("[Widget] Zone alert replay ignored", {
          phase: zone.phase,
          alert: nextAlertState,
        });
      }
      return;
    }

    if (nextAlertState === "warning") {
      state.warningTriggeredPhaseKeys.add(phaseKey);
    } else if (nextAlertState === "closing") {
      state.closingTriggeredPhaseKeys.add(phaseKey);
    } else {
      return;
    }

    state.alertState = nextAlertState;
    state.lastAlertReplayIgnoredSignature = "";
    console.info("[Widget] Zone alert triggered", {
      phase: zone.phase,
      alert: nextAlertState,
      remainingMs,
    });
  }

  function syncAlertLifecycle(now, remainingMs) {
    const zone = state.zone;
    if (!zone) {
      state.alertState = "idle";
      return;
    }

    const phaseKey = zone.phaseKey;
    if (zone.mode === "closing") {
      if (
        !state.closingTriggeredPhaseKeys.has(phaseKey) ||
        state.alertState !== "closing"
      ) {
        triggerAlert("closing", phaseKey, zone, remainingMs);
      }
      state.alertState = "closing";
      return;
    }

    state.alertState = "idle";
  }

  function renderTimer(now, remainingMs) {
    if (!timerRoot) {
      return;
    }

    const zone = state.zone;
    const visible = Boolean(zone && (zone.phase !== null || zone.targetEndAt !== null));
    const countdownText = formatCountdown(remainingMs);
    const statusText = getConnectionLabel(zone);
    const signature = [
      visible ? "1" : "0",
      zone ? zone.phaseKey : "",
      zone ? zone.mode : "unknown",
      zone && zone.stale ? "1" : "0",
      state.wsConnected ? "1" : "0",
      countdownText,
      statusText,
    ].join("|");

    if (signature === state.lastTimerSignature) {
      return;
    }

    if (!visible) {
      setVisible(timerRoot, false);
      state.lastTimerSignature = signature;
      return;
    }

    setElementData(timerRoot, "mode", zone ? zone.mode : "unknown");
    setElementData(timerRoot, "stale", zone && zone.stale ? "true" : "false");
    setElementData(timerRoot, "offline", state.wsConnected ? "false" : "true");
    setText(timerPhaseEl, formatPhaseLabel(zone.phase));
    setText(timerModeEl, getTimerModeLabel(zone));
    setText(timerCountdownEl, countdownText);
    setText(timerStatusEl, statusText);
    setHidden(timerStatusEl, !statusText);
    setVisible(timerRoot, true);
    state.lastTimerSignature = signature;
  }

  function renderAlert(now, remainingMs) {
    if (!alertRoot) {
      return;
    }

    const zone = state.zone;
    const alertState = state.alertState;
    const visible = Boolean(zone && alertState !== "idle");
    const countdownText =
      alertState === "closing" && remainingMs === 0 ? "NOW" : formatCountdown(remainingMs);
    const statusText = getConnectionLabel(zone);
    const kicker =
      alertState === "closing" ? "Zone Closing" : "Zone Warning";
    const title =
      alertState === "closing"
        ? "Blue zone is moving"
        : "Zone closes in";
    const signature = [
      visible ? "1" : "0",
      alertState,
      zone ? zone.phaseKey : "",
      countdownText,
      statusText,
      zone && zone.stale ? "1" : "0",
      state.wsConnected ? "1" : "0",
    ].join("|");

    if (signature === state.lastAlertSignature) {
      return;
    }

    if (!visible) {
      setVisible(alertRoot, false);
      state.lastAlertSignature = signature;
      return;
    }

    setElementData(alertRoot, "alert", alertState);
    setElementData(alertRoot, "stale", zone && zone.stale ? "true" : "false");
    setElementData(alertRoot, "offline", state.wsConnected ? "false" : "true");
    setText(alertKickerEl, kicker.toUpperCase());
    setText(alertTitleEl, title);
    setText(alertPhaseEl, formatPhaseLabel(zone.phase));
    setText(alertCountdownEl, countdownText);
    setText(alertStatusEl, statusText);
    setHidden(alertStatusEl, !statusText);
    setVisible(alertRoot, true);
    state.lastAlertSignature = signature;
  }

  function updateNextZoneProgress(remainingMs, revealWindowMs, visible) {
    if (!nextZoneProgressEl) {
      return;
    }

    const windowMs = Math.max(1, pickFinite(revealWindowMs, NEXT_ZONE_REVEAL_MS));
    const progress =
      visible && remainingMs !== null
        ? Math.max(0, Math.min(1, remainingMs / windowMs))
        : 0;
    const transform = `scaleX(${progress.toFixed(4)})`;
    if (nextZoneProgressEl.style.transform !== transform) {
      nextZoneProgressEl.style.transform = transform;
    }
  }

  function getNextZoneDisplayRemainingMs(zone, remainingMs) {
    if (!zone || remainingMs === null || remainingMs <= 0) {
      return remainingMs;
    }

    const compensationMs = Math.max(
      0,
      pickFinite(
        bootstrap.nextZoneDisplayLatencyCompensationMs,
        bootstrap.displayLatencyCompensationMs,
        NEXT_ZONE_DISPLAY_LATENCY_COMPENSATION_MS,
      ),
    );
    if (compensationMs <= 0) {
      return remainingMs;
    }

    return Math.max(0, remainingMs + compensationMs);
  }

  function renderNextZoneUpdate(now, remainingMs) {
    if (!nextZoneRoot) {
      return;
    }

    const zone = state.zone;
    const revealWindowMs = pickFinite(bootstrap.revealWindowMs, NEXT_ZONE_REVEAL_MS);
    const visible = shouldShowNextZoneUpdate(zone, remainingMs, revealWindowMs);
    const displayRemainingMs = getNextZoneDisplayRemainingMs(zone, remainingMs);
    updateNextZoneProgress(displayRemainingMs, revealWindowMs, visible);
    const countdownText = formatCountdown(displayRemainingMs);
    const statusText = getConnectionLabel(zone);
    const signature = [
      visible ? "1" : "0",
      zone ? zone.phaseKey : "",
      zone ? zone.matchPhase || "" : "",
      zone ? zone.mode : "",
      countdownText,
      statusText,
      zone && zone.stale ? "1" : "0",
      state.wsConnected ? "1" : "0",
      state.lastBrandingSignature,
    ].join("|");

    if (signature === state.lastNextZoneSignature) {
      return;
    }

    if (!visible) {
      setNextZoneVisible(false);
      state.lastNextZoneSignature = signature;
      return;
    }

    setElementData(nextZoneRoot, "stale", zone && zone.stale ? "true" : "false");
    setElementData(nextZoneRoot, "offline", state.wsConnected ? "false" : "true");
    setText(nextZonePhaseEl, formatCompactPhaseLabel(zone.phase));
    setText(nextZoneCountdownEl, countdownText);
    setText(nextZoneStatusEl, statusText);
    setHidden(nextZoneStatusEl, !statusText);
    setNextZoneVisible(true);
    state.lastNextZoneSignature = signature;
  }

  function render(now = Date.now()) {
    const remainingMs = getRemainingMs(now);
    syncAlertLifecycle(now, remainingMs);
    renderTimer(now, remainingMs);
    renderAlert(now, remainingMs);
    renderNextZoneUpdate(now, remainingMs);
  }

  function scheduleRender() {
    if (state.renderFrame !== null) {
      return;
    }

    state.renderFrame = window.requestAnimationFrame(function () {
      state.renderFrame = null;
      render(Date.now());
      scheduleRender();
    });
  }

  function shouldResyncTimer(nextTargetEndAt) {
    const currentTargetEndAt = toFiniteNumber(state.displayTargetEndAt);
    if (currentTargetEndAt === null || nextTargetEndAt === null) {
      return currentTargetEndAt !== nextTargetEndAt;
    }

    return Math.abs(currentTargetEndAt - nextTargetEndAt) > TIMER_RESYNC_DRIFT_MS;
  }

  function markZoneStale(expectedSeenAt) {
    if (!state.zone || state.zone.stale || state.lastZoneSeenAt !== expectedSeenAt) {
      return;
    }

    state.zone = {
      ...state.zone,
      stale: true,
    };
    console.info("[Widget] Zone stale fallback", {
      phase: state.zone.phase,
      ageMs: Math.max(0, Date.now() - expectedSeenAt),
    });
  }

  function armZoneStaleTimer() {
    clearStaleTimer();
    if (!state.lastZoneSeenAt) {
      return;
    }

    const expectedSeenAt = state.lastZoneSeenAt;
    state.staleTimer = window.setTimeout(function () {
      state.staleTimer = null;
      markZoneStale(expectedSeenAt);
    }, ZONE_STALE_MS);
  }

  function applyZoneUpdate(nextZone) {
    if (!nextZone) {
      return;
    }

    const previousZone = state.zone;
    const phaseChanged =
      !previousZone || previousZone.phaseKey !== nextZone.phaseKey;
    const modeChanged = previousZone && previousZone.mode !== nextZone.mode;

    if (phaseChanged) {
      state.displayTargetEndAt = nextZone.targetEndAt;
      state.visibleRemainingMs = null;
      state.lastVisibleRemainingAt = 0;
      state.allowCountdownReset = true;
      state.alertState = "idle";
      clearPendingInferredMode();
      state.lastAlertReplayIgnoredSignature = "";
      console.info("[Widget] Zone phase updated", {
        phase: nextZone.phase,
        mode: nextZone.mode,
        targetEndAt: nextZone.targetEndAt,
      });
    } else if (modeChanged || shouldResyncTimer(nextZone.targetEndAt)) {
      state.displayTargetEndAt = nextZone.targetEndAt;
      state.allowCountdownReset = true;
      console.info("[Widget] Zone timer resynced", {
        phase: nextZone.phase,
        mode: nextZone.mode,
        targetEndAt: nextZone.targetEndAt,
      });
    }

    state.zone = nextZone;
    state.lastZoneSeenAt = nextZone.lastUpdateAt;
    armZoneStaleTimer();
  }

  function handleZoneMessage(payload, timestamp) {
    const nextZone = normalizeZoneUpdate(payload, timestamp);
    if (!nextZone) {
      return;
    }

    if (state.zone && state.zone.stale) {
      nextZone.stale = false;
    }

    applyZoneUpdate(nextZone);
  }

  function handleMessage(raw) {
    let message = null;
    try {
      message = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (_) {
      return;
    }

    if (!message || typeof message !== "object") {
      return;
    }

    if (message.type === "zone_update") {
      handleZoneMessage(message.payload || null, message.timestamp);
      return;
    }

    if (message.type === "runtime_reset") {
      applyRuntimeReset();
    }
  }

  function buildSocketUrl() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return new URL(`${protocol}//${window.location.host}${bootstrap.wsPath || "/ws"}`).toString();
  }

  function scheduleReconnect() {
    if (state.reconnectTimer !== null) {
      return;
    }

    state.reconnectTimer = window.setTimeout(function () {
      state.reconnectTimer = null;
      connect();
    }, RECONNECT_DELAY_MS);
  }

  function connect() {
    if (
      state.socket &&
      (state.socket.readyState === WebSocket.OPEN ||
        state.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const socket = new WebSocket(buildSocketUrl());
    state.socket = socket;

    socket.addEventListener("open", function () {
      if (state.socket !== socket) {
        return;
      }

      state.wsConnected = true;
      console.info("[Widget] Zone WS connected");
    });

    socket.addEventListener("message", function (event) {
      if (state.socket === socket && socket.readyState === WebSocket.OPEN) {
        state.wsConnected = true;
      }
      handleMessage(event.data);
    });

    socket.addEventListener("close", function () {
      if (state.socket === socket) {
        state.socket = null;
      }

      state.wsConnected = false;
      scheduleReconnect();
    });

    socket.addEventListener("error", function () {
      try {
        socket.close();
      } catch (_) {
        // Ignore socket close errors.
      }
    });
  }

  startBrandingRefresh();
  scheduleRender();
  connect();

  window.addEventListener("beforeunload", function () {
    clearRenderFrame();
    clearStaleTimer();
    if (state.reconnectTimer !== null) {
      window.clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    clearBrandingRefreshTimer();
    if (state.socket) {
      try {
        state.socket.close();
      } catch (_) {
        // Ignore socket close errors.
      }
    }
  });
})();
