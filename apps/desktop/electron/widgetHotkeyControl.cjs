"use strict";

const HOTKEY_CONTROL_APPROVAL_KEY = "feature.widget-hotkey-control";
const DEFAULT_HOTKEY_KEY = "F9";
const DEFAULT_TRANSITION_MS = 260;
const DIRECTIONS = new Set(["auto", "left", "right", "up", "down"]);

const KEY_ALIASES = Object.freeze({
  ESC: "Escape",
  ESCAPE: "Escape",
  RETURN: "Enter",
  ENTER: "Enter",
  SPACE: "Space",
  SPACEBAR: "Space",
  BACKSPACE: "Backspace",
  BACK: "Backspace",
  TAB: "Tab",
  CAPS: "CapsLock",
  CAPSLOCK: "CapsLock",
  DEL: "Delete",
  DELETE: "Delete",
  INS: "Insert",
  INSERT: "Insert",
  HOME: "Home",
  END: "End",
  PGUP: "PageUp",
  PAGEUP: "PageUp",
  PGDN: "PageDown",
  PAGEDOWN: "PageDown",
  LEFT: "ArrowLeft",
  ARROWLEFT: "ArrowLeft",
  UP: "ArrowUp",
  ARROWUP: "ArrowUp",
  RIGHT: "ArrowRight",
  ARROWRIGHT: "ArrowRight",
  DOWN: "ArrowDown",
  ARROWDOWN: "ArrowDown",
  PRINTSCREEN: "PrintScreen",
  PRTSC: "PrintScreen",
  SCROLLLOCK: "ScrollLock",
  NUMLOCK: "NumLock",
  CTRL: "Ctrl",
  CONTROL: "Ctrl",
  ALT: "Alt",
  SHIFT: "Shift",
  META: "Meta",
  WIN: "Meta",
  WINDOWS: "Meta",
  SEMICOLON: "Semicolon",
  EQUAL: "Equal",
  COMMA: "Comma",
  MINUS: "Minus",
  PERIOD: "Period",
  SLASH: "Slash",
  BACKQUOTE: "Backquote",
  BRACKETLEFT: "BracketLeft",
  BRACKETRIGHT: "BracketRight",
  BACKSLASH: "Backslash",
  QUOTE: "Quote",
});

function normalizeDirection(value, fallback = "auto") {
  const normalized = String(value || "").trim().toLowerCase();
  return DIRECTIONS.has(normalized) ? normalized : fallback;
}

function normalizeHotkeyKey(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return DEFAULT_HOTKEY_KEY;
  }

  const compact = raw.replace(/\s+/g, "");
  const upper = compact.toUpperCase();
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(upper)) {
    return upper;
  }
  if (/^[A-Z]$/.test(upper)) {
    return upper;
  }
  if (/^[0-9]$/.test(upper)) {
    return upper;
  }
  if (/^NUMPAD[0-9]$/.test(upper)) {
    return `Numpad${upper.slice(-1)}`;
  }
  if (KEY_ALIASES[upper]) {
    return KEY_ALIASES[upper];
  }

  return compact;
}

function normalizeWidgetSelection(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const widgetKey = String(value.widgetKey || value.id || "").trim();
  if (!widgetKey) {
    return null;
  }

  const id = String(value.id || widgetKey).trim() || widgetKey;
  const label = String(value.label || value.name || widgetKey).trim() || widgetKey;

  return {
    id,
    widgetKey,
    label,
    enabled: value.enabled === true,
    direction: normalizeDirection(value.direction),
  };
}

function normalizeWidgetHotkeyControlConfig(value) {
  const source = value && typeof value === "object" ? value : {};
  const transitionMs = Number(source.transitionMs);
  const widgets = Array.isArray(source.widgets)
    ? source.widgets.map(normalizeWidgetSelection).filter(Boolean)
    : [];

  return {
    enabled: source.enabled === true,
    key: normalizeHotkeyKey(source.key || source.accelerator || DEFAULT_HOTKEY_KEY),
    transitionMs:
      Number.isFinite(transitionMs) && transitionMs >= 80 && transitionMs <= 1000
        ? Math.round(transitionMs)
        : DEFAULT_TRANSITION_MS,
    widgets,
  };
}

function getEnabledWidgets(config) {
  return config.widgets.filter((widget) => widget.enabled);
}

function resolveKeyCode(keyMap, key) {
  if (!keyMap || typeof keyMap !== "object") {
    return null;
  }

  const normalized = normalizeHotkeyKey(key);
  const candidates = [normalized];
  if (/^[0-9]$/.test(normalized)) {
    candidates.push(`Numpad${normalized}`);
  }

  for (const candidate of candidates) {
    const value = keyMap[candidate];
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function buildVisibilityPayload(config, active, source) {
  return {
    active: active === true,
    source: String(source || "launcher"),
    key: config.key,
    mode: "hold",
    transitionMs: config.transitionMs,
    widgets: getEnabledWidgets(config),
    updatedAt: Date.now(),
  };
}

function createWidgetHotkeyControl({
  getConfig = () => ({}),
  setConfig = () => {},
  getWidgetServer = () => null,
  log = () => {},
  logWarn = () => {},
  logError = () => {},
} = {}) {
  let approved = false;
  let approvalReason = "SUPER_ADMIN_APPROVAL_REQUIRED";
  let hookModule = null;
  let hookLoadError = null;
  let hookStarted = false;
  let listenersAttached = false;
  let registered = false;
  let active = false;
  let currentKeyCode = null;
  let currentError = null;

  const readConfig = () => normalizeWidgetHotkeyControlConfig(getConfig());

  function loadHookModule() {
    if (hookModule || hookLoadError) {
      return hookModule;
    }
    try {
      // Lazy-load so the rest of the launcher can still run if the native hook
      // cannot initialize on a specific Windows machine.
      hookModule = require("uiohook-napi");
      return hookModule;
    } catch (error) {
      hookLoadError = error;
      hookModule = null;
      return null;
    }
  }

  function broadcastVisibility(config, nextActive, source) {
    active = nextActive === true;
    const payload = buildVisibilityPayload(config, active, source);
    const server = getWidgetServer();
    if (server && typeof server.setWidgetVisibility === "function") {
      server.setWidgetVisibility(payload);
    }
    return payload;
  }

  function clearActive(source = "system") {
    if (!active) {
      return;
    }
    broadcastVisibility(readConfig(), false, source);
  }

  function onKeyDown(event) {
    if (!registered || currentKeyCode === null || event?.keycode !== currentKeyCode) {
      return;
    }
    if (active) {
      return;
    }
    broadcastVisibility(readConfig(), true, "keyboard");
  }

  function onKeyUp(event) {
    if (!registered || currentKeyCode === null || event?.keycode !== currentKeyCode) {
      return;
    }
    if (!active) {
      return;
    }
    broadcastVisibility(readConfig(), false, "keyboard");
  }

  function attachListeners() {
    const loaded = loadHookModule();
    if (!loaded?.uIOhook || listenersAttached) {
      return;
    }
    loaded.uIOhook.on("keydown", onKeyDown);
    loaded.uIOhook.on("keyup", onKeyUp);
    listenersAttached = true;
  }

  function detachListeners() {
    if (!hookModule?.uIOhook || !listenersAttached) {
      return;
    }
    try {
      hookModule.uIOhook.off("keydown", onKeyDown);
      hookModule.uIOhook.off("keyup", onKeyUp);
    } catch (error) {
      logWarn("[widget-hotkey] failed to detach listeners", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    listenersAttached = false;
  }

  function startHook() {
    const loaded = loadHookModule();
    if (!loaded?.uIOhook) {
      throw new Error(
        hookLoadError instanceof Error
          ? hookLoadError.message
          : "Global keyboard hook is unavailable.",
      );
    }
    attachListeners();
    if (!hookStarted) {
      loaded.uIOhook.start();
      hookStarted = true;
    }
  }

  function stopHook() {
    if (!hookModule?.uIOhook) {
      return;
    }
    detachListeners();
    if (hookStarted) {
      try {
        hookModule.uIOhook.stop();
      } catch (error) {
        logWarn("[widget-hotkey] failed to stop keyboard hook", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      hookStarted = false;
    }
  }

  function sync(reason = "system") {
    const config = readConfig();
    currentError = null;
    registered = false;
    currentKeyCode = null;

    if (!approved) {
      clearActive(reason);
      stopHook();
      approvalReason = approvalReason || "SUPER_ADMIN_APPROVAL_REQUIRED";
      return getStatus();
    }

    if (!config.enabled) {
      clearActive(reason);
      stopHook();
      return getStatus();
    }

    const enabledWidgets = getEnabledWidgets(config);
    if (enabledWidgets.length === 0) {
      clearActive(reason);
      stopHook();
      currentError = "Select at least one widget for the hotkey.";
      return getStatus();
    }

    const loaded = loadHookModule();
    const keyCode = resolveKeyCode(loaded?.UiohookKey, config.key);
    if (keyCode === null) {
      clearActive(reason);
      stopHook();
      currentError = `Unsupported hotkey key: ${config.key}`;
      return getStatus();
    }

    try {
      currentKeyCode = keyCode;
      startHook();
      registered = true;
      log("[widget-hotkey] registered", {
        key: config.key,
        keyCode,
        widgetCount: enabledWidgets.length,
      });
    } catch (error) {
      currentKeyCode = null;
      registered = false;
      currentError =
        error instanceof Error ? error.message : "Global keyboard hook failed.";
      logError("[widget-hotkey] registration failed", currentError);
    }

    return getStatus();
  }

  function setApproval({ isApproved, reason } = {}) {
    approved = isApproved === true;
    approvalReason = approved
      ? null
      : String(reason || "SUPER_ADMIN_APPROVAL_REQUIRED").trim() ||
        "SUPER_ADMIN_APPROVAL_REQUIRED";
    return sync("approval");
  }

  function updateConfig(config) {
    const normalized = normalizeWidgetHotkeyControlConfig(config);
    setConfig(normalized);
    return sync("config");
  }

  function trigger(nextActive) {
    if (!approved) {
      throw new Error("Widget hotkey control requires Super Admin approval.");
    }
    const config = readConfig();
    const enabledWidgets = getEnabledWidgets(config);
    if (enabledWidgets.length === 0) {
      throw new Error("Select at least one widget for the hotkey.");
    }
    broadcastVisibility(config, nextActive === true, "preview");
    return getStatus();
  }

  function getStatus() {
    const config = readConfig();
    const reason = !approved
      ? approvalReason || "SUPER_ADMIN_APPROVAL_REQUIRED"
      : !config.enabled
        ? "DISABLED"
        : currentError
          ? "ERROR"
          : registered
            ? null
            : "NOT_REGISTERED";

    return {
      featureKey: HOTKEY_CONTROL_APPROVAL_KEY,
      approved,
      canUse: approved && !currentError,
      registered,
      active,
      key: config.key,
      keyCode: currentKeyCode,
      error: currentError,
      reason,
      config,
    };
  }

  function shutdown() {
    clearActive("shutdown");
    stopHook();
  }

  return {
    getStatus,
    setApproval,
    sync,
    trigger,
    updateConfig,
    shutdown,
  };
}

module.exports = {
  HOTKEY_CONTROL_APPROVAL_KEY,
  normalizeWidgetHotkeyControlConfig,
  createWidgetHotkeyControl,
};
