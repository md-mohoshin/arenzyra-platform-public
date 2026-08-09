const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_LOCAL_API_BASE,
  DEFAULT_PRODUCTION_API_BASE,
  getProcessDefaultApiBase,
} = require("./apiBaseDefaults.cjs");

const DEFAULT_FALLBACK_API_BASE = DEFAULT_LOCAL_API_BASE;
const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);
const VALID_CONFIG_KEYS = new Set([
  "apiBase",
  "apiEnvironment",
  "shadowTrackerPath",
  "settings",
]);

function isEnabled(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneConfig(config) {
  return {
    ...config,
    settings: { ...config.settings },
  };
}

function normalizeApiEnvironment(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (!normalized) {
    return "auto";
  }

  if (["dev", "development", "local"].includes(normalized)) {
    return "dev";
  }

  if (["lan", "network"].includes(normalized)) {
    return "lan";
  }

  if (["stage", "staging", "qa"].includes(normalized)) {
    return "staging";
  }

  if (["prod", "production"].includes(normalized)) {
    return "production";
  }

  return "auto";
}

function getDefaultProtocolForEnvironment(apiEnvironment) {
  return ["production", "staging"].includes(apiEnvironment)
    ? "https:"
    : "http:";
}

function tryNormalizeApiBaseCandidate(value, options = {}) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  const apiEnvironment = normalizeApiEnvironment(options.apiEnvironment);
  const defaultProtocol =
    typeof options.defaultProtocol === "string" && options.defaultProtocol.trim()
      ? options.defaultProtocol.trim()
      : getDefaultProtocolForEnvironment(apiEnvironment);
  const candidate = trimmed.includes("://")
    ? trimmed
    : `${defaultProtocol}//${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) {
      return "";
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function sanitizeSettings(settings) {
  if (!isPlainObject(settings)) {
    return {};
  }

  const nextSettings = { ...settings };
  if (Object.prototype.hasOwnProperty.call(nextSettings, "rememberedEmail")) {
    const rememberedEmail = String(nextSettings.rememberedEmail || "")
      .trim()
      .toLowerCase();
    if (rememberedEmail) {
      nextSettings.rememberedEmail = rememberedEmail;
    } else {
      delete nextSettings.rememberedEmail;
    }
  }

  if (Object.prototype.hasOwnProperty.call(nextSettings, "keepSignedIn")) {
    nextSettings.keepSignedIn = nextSettings.keepSignedIn !== false;
  }

  if (Object.prototype.hasOwnProperty.call(nextSettings, "widgetLanEnabled")) {
    nextSettings.widgetLanEnabled = isEnabled(nextSettings.widgetLanEnabled);
  }

  if (
    Object.prototype.hasOwnProperty.call(
      nextSettings,
      "pinnedMapControlAlwaysOnTop",
    )
  ) {
    nextSettings.pinnedMapControlAlwaysOnTop = isEnabled(
      nextSettings.pinnedMapControlAlwaysOnTop,
    );
  }

  return nextSettings;
}

function createLauncherConfig(rawConfig = {}) {
  const apiEnvironment = normalizeApiEnvironment(
    rawConfig?.apiEnvironment || rawConfig?.environment,
  );
  const defaultProtocol = getDefaultProtocolForEnvironment(apiEnvironment);

  return {
    version:
      Number.isFinite(Number(rawConfig?.version)) && Number(rawConfig.version) > 0
        ? Number(rawConfig.version)
        : 1,
    updatedAt:
      typeof rawConfig?.updatedAt === "string" && rawConfig.updatedAt.trim()
        ? rawConfig.updatedAt.trim()
        : null,
    apiBase:
      tryNormalizeApiBaseCandidate(rawConfig?.apiBase, {
        apiEnvironment,
        defaultProtocol,
      }) || "",
    apiEnvironment,
    shadowTrackerPath:
      typeof rawConfig?.shadowTrackerPath === "string"
        ? rawConfig.shadowTrackerPath.trim()
        : "",
    settings: sanitizeSettings(rawConfig?.settings),
  };
}

function createConfigManager(options) {
  const getUserDataPath =
    typeof options?.getUserDataPath === "function"
      ? options.getUserDataPath
      : () => process.cwd();
  const isPackaged = options?.isPackaged === true;
  const env = isPlainObject(options?.env) ? options.env : process.env;
  const log = typeof options?.log === "function" ? options.log : () => {};

  let cachedConfig = null;
  let didLogLoad = false;

  function getConfigDir() {
    return path.join(getUserDataPath(), "launcher");
  }

  function getConfigPath() {
    return path.join(getConfigDir(), "config.json");
  }

  function ensureConfigDir() {
    fs.mkdirSync(getConfigDir(), { recursive: true });
  }

  function logConfigStep(message, payload) {
    try {
      if (typeof payload === "undefined") {
        log(message);
        return;
      }
      log(message, payload);
    } catch {
      // ignore logging failures
    }
  }

  function resolveRuntimeApiEnvironment(config) {
    const configuredEnvironment = normalizeApiEnvironment(config?.apiEnvironment);
    if (configuredEnvironment !== "auto") {
      return configuredEnvironment;
    }

    const resolvedEnvironment = normalizeApiEnvironment(
      env.ARENZYRA_API_ENV || env.ARENZYRA_ENV || env.NODE_ENV,
    );

    if (resolvedEnvironment !== "auto") {
      return resolvedEnvironment;
    }

    return String(env.DEV_SERVER_PORT || "").trim() ? "dev" : "production";
  }

  function isLoopbackApiBase(value) {
    const normalizedValue = tryNormalizeApiBaseCandidate(value, {
      defaultProtocol: "http:",
    });
    if (!normalizedValue) {
      return false;
    }

    try {
      const parsed = new URL(normalizedValue);
      const hostname = String(parsed.hostname || "")
        .trim()
        .toLowerCase()
        .replace(/^\[|\]$/g, "");
      return [
        "localhost",
        "127.0.0.1",
        "::1",
        "0.0.0.0",
        "host.docker.internal",
      ].includes(hostname);
    } catch {
      return false;
    }
  }

  function allowsLoopbackApiBaseOverride(config) {
    if (!isPackaged) {
      return true;
    }

    if (
      isEnabled(env.ARENZYRA_ALLOW_LOCAL_API_BASE) ||
      isEnabled(env.ARENZYRA_ALLOW_LOOPBACK_API_BASE)
    ) {
      return true;
    }

    return resolveRuntimeApiEnvironment(config) !== "production";
  }

  function isBlockedLoopbackApiBase(config, value) {
    return isLoopbackApiBase(value) && !allowsLoopbackApiBaseOverride(config);
  }

  function allowedPackagedApiHosts(config) {
    const hosts = new Set([new URL(DEFAULT_PRODUCTION_API_BASE).hostname.toLowerCase()]);
    const configuredHosts = String(env.ARENZYRA_ALLOWED_API_HOSTS || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    for (const hostname of configuredHosts) {
      hosts.add(hostname);
    }

    const runtimeEnvironment = resolveRuntimeApiEnvironment(config);
    const trustedEnvironmentBases =
      runtimeEnvironment === "staging"
        ? [env.ARENZYRA_STAGING_API_BASE, env.STAGING_API_BASE_URL]
        : [env.ARENZYRA_PRODUCTION_API_BASE, env.PRODUCTION_API_BASE_URL];
    for (const candidate of trustedEnvironmentBases) {
      const normalized = tryNormalizeApiBaseCandidate(candidate, {
        apiEnvironment: runtimeEnvironment,
      });
      if (!normalized) {
        continue;
      }
      hosts.add(new URL(normalized).hostname.toLowerCase());
    }
    return hosts;
  }

  function packagedApiBasePolicyError(config, value) {
    if (!isPackaged) {
      return null;
    }
    const runtimeEnvironment = resolveRuntimeApiEnvironment(config);
    if (!["production", "staging"].includes(runtimeEnvironment)) {
      return null;
    }
    if (isLoopbackApiBase(value) && allowsLoopbackApiBaseOverride(config)) {
      return null;
    }

    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      return "Invalid apiBase. Use a valid HTTPS URL.";
    }
    if (parsed.protocol !== "https:") {
      return "Packaged production and staging launchers require an HTTPS apiBase.";
    }
    if (isEnabled(env.ARENZYRA_ALLOW_CUSTOM_API_BASE)) {
      return null;
    }
    if (!allowedPackagedApiHosts(config).has(parsed.hostname.toLowerCase())) {
      return "This apiBase host is not in the packaged launcher allowlist. Configure ARENZYRA_ALLOWED_API_HOSTS only in a trusted deployment environment.";
    }
    return null;
  }

  function isBlockedApiBase(config, value) {
    return (
      isBlockedLoopbackApiBase(config, value) ||
      Boolean(packagedApiBasePolicyError(config, value))
    );
  }

  function shouldResetStaleApiBaseOverride(config) {
    return Boolean(config?.apiBase) && isBlockedApiBase(config, config.apiBase);
  }

  function getEnvironmentApiBaseCandidates(apiEnvironment) {
    const genericCandidates = [
      env.ARENZYRA_API_URL,
      env.ARENZYRA_API_BASE,
      env.VITE_API_BASE_URL,
      env.NEXT_PUBLIC_API_URL,
      env.API_BASE_URL,
    ];

    if (apiEnvironment === "dev") {
      return [
        env.ARENZYRA_DEV_API_BASE,
        env.VITE_DEV_API_BASE_URL,
        env.DEV_API_BASE_URL,
        ...genericCandidates,
      ];
    }

    if (apiEnvironment === "lan") {
      return [
        env.ARENZYRA_LAN_API_BASE,
        env.LAN_API_BASE_URL,
        ...genericCandidates,
      ];
    }

    if (apiEnvironment === "staging") {
      return [
        env.ARENZYRA_STAGING_API_BASE,
        env.STAGING_API_BASE_URL,
        ...genericCandidates,
      ];
    }

    if (apiEnvironment === "production") {
      return [
        env.ARENZYRA_PRODUCTION_API_BASE,
        env.PRODUCTION_API_BASE_URL,
        ...genericCandidates,
      ];
    }

    return genericCandidates;
  }

  function resolveEnvironmentApiBase(config) {
    const apiEnvironment = resolveRuntimeApiEnvironment(config);
    const defaultProtocol = getDefaultProtocolForEnvironment(apiEnvironment);

    for (const candidate of getEnvironmentApiBaseCandidates(apiEnvironment)) {
      const normalizedCandidate = tryNormalizeApiBaseCandidate(candidate, {
        apiEnvironment,
        defaultProtocol,
      });
      if (normalizedCandidate && !isBlockedApiBase(config, normalizedCandidate)) {
        return normalizedCandidate;
      }
    }

    return "";
  }

  function buildResolvedApiBaseDetails(config, candidate) {
    const normalizedConfig = createLauncherConfig(config);
    const apiEnvironment = resolveRuntimeApiEnvironment(normalizedConfig);
    const defaultProtocol = getDefaultProtocolForEnvironment(apiEnvironment);
    const normalizedCandidate = tryNormalizeApiBaseCandidate(candidate, {
      apiEnvironment,
      defaultProtocol,
    });
    const configuredApiBaseCandidate = tryNormalizeApiBaseCandidate(
      normalizedConfig.apiBase,
      {
        apiEnvironment,
        defaultProtocol,
      },
    );
    const configuredApiBase = isBlockedApiBase(
      normalizedConfig,
      configuredApiBaseCandidate,
    )
      ? ""
      : configuredApiBaseCandidate;
    const environmentApiBase = resolveEnvironmentApiBase(normalizedConfig);

    if (
      normalizedCandidate &&
      !isBlockedApiBase(normalizedConfig, normalizedCandidate)
    ) {
      return {
        apiBase: normalizedCandidate,
        source: "explicit",
        apiEnvironment,
        configuredApiBase: configuredApiBase || null,
        environmentApiBase: environmentApiBase || null,
      };
    }

    if (configuredApiBase) {
      return {
        apiBase: configuredApiBase,
        source: "config",
        apiEnvironment,
        configuredApiBase,
        environmentApiBase: environmentApiBase || null,
      };
    }

    if (environmentApiBase) {
      return {
        apiBase: environmentApiBase,
        source: "environment",
        apiEnvironment,
        configuredApiBase: null,
        environmentApiBase,
      };
    }

    return {
      apiBase:
        isPackaged && ["production", "staging"].includes(apiEnvironment)
          ? DEFAULT_PRODUCTION_API_BASE
          : getProcessDefaultApiBase(env),
      source: "fallback",
      apiEnvironment,
      configuredApiBase: null,
      environmentApiBase: null,
    };
  }

  function readConfig() {
    if (cachedConfig) {
      return cloneConfig(cachedConfig);
    }

    const configPath = getConfigPath();
    let nextConfig = createLauncherConfig();

    if (fs.existsSync(configPath)) {
      try {
        nextConfig = createLauncherConfig(
          JSON.parse(fs.readFileSync(configPath, "utf8")),
        );
      } catch (error) {
        logConfigStep("[config] failed to read launcher config, using defaults", {
          path: configPath,
          error: error instanceof Error ? error.message : String(error || ""),
        });
      }
    }

    if (shouldResetStaleApiBaseOverride(nextConfig)) {
      logConfigStep(
        "[config] clearing api base override rejected by packaged runtime policy",
        {
          path: configPath,
          previousApiBase: nextConfig.apiBase,
        },
      );
      writeConfig({
        ...nextConfig,
        apiBase: "",
      });
      nextConfig = cloneConfig(cachedConfig);
    } else {
      cachedConfig = nextConfig;
    }

    if (!didLogLoad) {
      const details = buildResolvedApiBaseDetails(nextConfig);
      logConfigStep("[config] launcher config ready", {
        path: configPath,
        apiBase: details.apiBase,
        apiBaseSource: details.source,
        apiEnvironment: details.apiEnvironment,
        hasApiBaseOverride: Boolean(nextConfig.apiBase),
      });
      didLogLoad = true;
    }

    return cloneConfig(cachedConfig);
  }

  function writeConfig(nextConfig) {
    const configPath = getConfigPath();
    const normalizedConfig = createLauncherConfig(nextConfig);
    const payload = {
      version: 1,
      updatedAt: new Date().toISOString(),
      apiBase: normalizedConfig.apiBase,
      apiEnvironment: normalizedConfig.apiEnvironment,
      shadowTrackerPath: normalizedConfig.shadowTrackerPath,
      settings: normalizedConfig.settings,
    };

    ensureConfigDir();
    fs.writeFileSync(configPath, JSON.stringify(payload, null, 2));
    cachedConfig = payload;

    const details = buildResolvedApiBaseDetails(payload);
    logConfigStep("[config] launcher config saved", {
      path: configPath,
      apiBase: details.apiBase,
      apiBaseSource: details.source,
      apiEnvironment: details.apiEnvironment,
      hasApiBaseOverride: Boolean(payload.apiBase),
    });

    return configPath;
  }

  function updateConfig(patch = {}) {
    const currentConfig = readConfig();
    const nextSettings = Object.prototype.hasOwnProperty.call(patch, "settings")
      ? sanitizeSettings({
          ...currentConfig.settings,
          ...(isPlainObject(patch.settings) ? patch.settings : {}),
        })
      : currentConfig.settings;
    const nextConfig = {
      ...currentConfig,
      ...patch,
      settings: nextSettings,
    };

    writeConfig(nextConfig);
    return readConfig();
  }

  function tryNormalizeApiBase(value, options = {}) {
    const currentConfig = readConfig();
    const apiEnvironment =
      options.apiEnvironment || resolveRuntimeApiEnvironment(currentConfig);
    return tryNormalizeApiBaseCandidate(value, {
      apiEnvironment,
      defaultProtocol:
        options.defaultProtocol || getDefaultProtocolForEnvironment(apiEnvironment),
    });
  }

  function getResolvedApiBaseDetails(candidate) {
    return buildResolvedApiBaseDetails(readConfig(), candidate);
  }

  function resolveApiBase(candidate) {
    return getResolvedApiBaseDetails(candidate).apiBase;
  }

  function validateConfig(key, value) {
    const normalizedKey = String(key || "").trim();
    if (!VALID_CONFIG_KEYS.has(normalizedKey)) {
      return {
        valid: false,
        key: normalizedKey,
        error: `Unsupported config key: ${normalizedKey}`,
      };
    }

    if (normalizedKey === "apiBase") {
      const trimmed = String(value || "").trim();
      if (!trimmed) {
        return {
          valid: true,
          key: normalizedKey,
          normalizedValue: "",
        };
      }

      const normalizedApiBase = tryNormalizeApiBase(trimmed);
      if (!normalizedApiBase) {
        return {
          valid: false,
          key: normalizedKey,
          error: "Invalid apiBase. Use an HTTP or HTTPS URL.",
        };
      }

      const policyError = packagedApiBasePolicyError(
        readConfig(),
        normalizedApiBase,
      );
      if (isBlockedLoopbackApiBase(readConfig(), normalizedApiBase) || policyError) {
        return {
          valid: false,
          key: normalizedKey,
          error:
            policyError ||
            "Loopback apiBase is blocked in the packaged production launcher. Set ARENZYRA_ALLOW_LOCAL_API_BASE=1 to allow localhost overrides.",
        };
      }

      return {
        valid: true,
        key: normalizedKey,
        normalizedValue: normalizedApiBase,
      };
    }

    if (normalizedKey === "apiEnvironment") {
      const trimmed = String(value || "").trim();
      const normalizedApiEnvironment = normalizeApiEnvironment(trimmed);
      const isRecognized =
        !trimmed ||
        trimmed.toLowerCase() === "auto" ||
        normalizedApiEnvironment !== "auto";
      if (!isRecognized) {
        return {
          valid: false,
          key: normalizedKey,
          error:
            "Invalid apiEnvironment. Use auto, dev, lan, staging, or production.",
        };
      }

      return {
        valid: true,
        key: normalizedKey,
        normalizedValue: normalizedApiEnvironment,
      };
    }

    if (normalizedKey === "shadowTrackerPath") {
      return {
        valid: true,
        key: normalizedKey,
        normalizedValue: String(value || "").trim(),
      };
    }

    if (!isPlainObject(value)) {
      return {
        valid: false,
        key: normalizedKey,
        error: "Launcher settings must be an object.",
      };
    }

    return {
      valid: true,
      key: normalizedKey,
      normalizedValue: sanitizeSettings(value),
    };
  }

  function getPublicConfig() {
    const currentConfig = readConfig();
    const details = buildResolvedApiBaseDetails(currentConfig);
    return {
      apiBase: details.apiBase,
      apiBaseSource: details.source,
      apiBaseOverride: currentConfig.apiBase || null,
      apiEnvironment: currentConfig.apiEnvironment,
      shadowTrackerPath: currentConfig.shadowTrackerPath,
      settings: { ...currentConfig.settings },
    };
  }

  function setApiBase(value, metadata = {}) {
    const trimmed = String(value || "").trim();
    const currentConfig = readConfig();

    if (!trimmed) {
      if (!currentConfig.apiBase) {
        return {
          changed: false,
          apiBase: resolveApiBase(),
          config: currentConfig,
        };
      }

      const nextConfig = updateConfig({ apiBase: "" });
      logConfigStep("[config] cleared api base override", {
        source: metadata.source || "unknown",
      });
      return {
        changed: true,
        apiBase: resolveApiBase(),
        config: nextConfig,
      };
    }

    const normalizedApiBase = tryNormalizeApiBase(trimmed);
    if (!normalizedApiBase) {
      logConfigStep("[config] rejected invalid api base override", {
        source: metadata.source || "unknown",
        value: trimmed,
      });
      return {
        changed: false,
        apiBase: resolveApiBase(),
        config: currentConfig,
      };
    }

    if (isBlockedApiBase(currentConfig, normalizedApiBase)) {
      logConfigStep(
        "[config] rejected api base override for packaged runtime policy",
        {
          source: metadata.source || "unknown",
          value: normalizedApiBase,
        },
      );
      return {
        changed: false,
        apiBase: resolveApiBase(),
        config: currentConfig,
      };
    }

    if (currentConfig.apiBase === normalizedApiBase) {
      return {
        changed: false,
        apiBase: resolveApiBase(),
        config: currentConfig,
      };
    }

    const nextConfig = updateConfig({ apiBase: normalizedApiBase });
    return {
      changed: true,
      apiBase: normalizedApiBase,
      config: nextConfig,
    };
  }

  function getShadowTrackerPath() {
    return readConfig().shadowTrackerPath;
  }

  function setShadowTrackerPath(value) {
    const trimmed = String(value || "").trim();
    const currentConfig = readConfig();
    if (currentConfig.shadowTrackerPath === trimmed) {
      return currentConfig;
    }
    return updateConfig({ shadowTrackerPath: trimmed });
  }

  function getSettings() {
    return readConfig().settings;
  }

  function setSettings(settings) {
    return updateConfig({ settings });
  }

  function setConfigValue(key, value, metadata = {}) {
    const validation = validateConfig(key, value);
    if (!validation.valid) {
      const error = new Error(validation.error);
      error.code = "ARENZYRA_INVALID_CONFIG";
      throw error;
    }

    if (validation.key === "apiBase") {
      const result = setApiBase(validation.normalizedValue, metadata);
      return {
        changed: result.changed,
        config: getPublicConfig(),
      };
    }

    if (validation.key === "apiEnvironment") {
      const currentConfig = readConfig();
      if (currentConfig.apiEnvironment === validation.normalizedValue) {
        return {
          changed: false,
          config: getPublicConfig(),
        };
      }

      updateConfig({
        apiEnvironment: validation.normalizedValue,
      });
      logConfigStep("[config] updated api environment", {
        source: metadata.source || "unknown",
        apiEnvironment: validation.normalizedValue,
      });
      return {
        changed: true,
        config: getPublicConfig(),
      };
    }

    if (validation.key === "shadowTrackerPath") {
      const currentConfig = readConfig();
      if (currentConfig.shadowTrackerPath === validation.normalizedValue) {
        return {
          changed: false,
          config: getPublicConfig(),
        };
      }

      updateConfig({
        shadowTrackerPath: validation.normalizedValue,
      });
      logConfigStep("[config] updated shadow tracker path", {
        source: metadata.source || "unknown",
        hasPath: Boolean(validation.normalizedValue),
      });
      return {
        changed: true,
        config: getPublicConfig(),
      };
    }

    const currentConfig = readConfig();
    const nextSettings = sanitizeSettings({
      ...currentConfig.settings,
      ...validation.normalizedValue,
    });
    if (
      JSON.stringify(nextSettings) === JSON.stringify(currentConfig.settings)
    ) {
      return {
        changed: false,
        config: getPublicConfig(),
      };
    }

    updateConfig({
      settings: nextSettings,
    });
    logConfigStep("[config] updated launcher settings", {
      source: metadata.source || "unknown",
      settingKeys: Object.keys(validation.normalizedValue),
    });
    return {
      changed: true,
      config: getPublicConfig(),
    };
  }

  function migrateLegacyConfig(legacyConfig = {}, metadata = {}) {
    const currentConfig = readConfig();
    const nextConfig = {
      ...currentConfig,
      settings: { ...currentConfig.settings },
    };
    const migratedKeys = [];

    const legacyApiBase = tryNormalizeApiBase(legacyConfig?.apiBase);
    if (!currentConfig.apiBase && legacyApiBase) {
      nextConfig.apiBase = legacyApiBase;
      migratedKeys.push("apiBase");
    }

    const legacyShadowTrackerPath = String(
      legacyConfig?.shadowTrackerPath || "",
    ).trim();
    if (!currentConfig.shadowTrackerPath && legacyShadowTrackerPath) {
      nextConfig.shadowTrackerPath = legacyShadowTrackerPath;
      migratedKeys.push("shadowTrackerPath");
    }

    if (isPlainObject(legacyConfig?.settings)) {
      const sanitizedLegacySettings = sanitizeSettings(legacyConfig.settings);
      for (const [key, value] of Object.entries(sanitizedLegacySettings)) {
        if (!Object.prototype.hasOwnProperty.call(nextConfig.settings, key)) {
          nextConfig.settings[key] = value;
          migratedKeys.push(`settings.${key}`);
        }
      }
    }

    if (migratedKeys.length === 0) {
      return {
        changed: false,
        config: currentConfig,
      };
    }

    writeConfig(nextConfig);
    logConfigStep("[config] migrated legacy launcher config", {
      source: metadata.source || "legacy",
      migratedKeys,
    });
    return {
      changed: true,
      config: readConfig(),
    };
  }

  return {
    getConfigDir,
    getConfigPath,
    readConfig,
    writeConfig,
    updateConfig,
    resolveApiBase,
    getResolvedApiBaseDetails,
    tryNormalizeApiBase,
    validateConfig,
    getPublicConfig,
    setConfigValue,
    setApiBase,
    getShadowTrackerPath,
    setShadowTrackerPath,
    getSettings,
    setSettings,
    migrateLegacyConfig,
  };
}

module.exports = {
  createConfigManager,
  DEFAULT_FALLBACK_API_BASE,
  DEFAULT_PRODUCTION_API_BASE,
};
