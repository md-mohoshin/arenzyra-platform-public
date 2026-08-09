"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_GSI_PORT = 31_973;
const DEFAULT_CONFIG_NAME = "arenzyra";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const MAX_MANAGED_CONFIG_BYTES = 64 * 1024;

function createCs2GsiToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function assertSafeToken(token) {
  const normalized = String(token || "").trim();
  if (!TOKEN_PATTERN.test(normalized)) {
    throw new Error(
      "CS2 GSI token must be 32-128 URL-safe characters.",
    );
  }
  return normalized;
}

function assertLoopbackUri(uri) {
  let parsed;
  try {
    parsed = new URL(String(uri || ""));
  } catch {
    throw new Error("CS2 GSI URI must be a valid URL.");
  }

  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      "CS2 GSI URI must be an uncredentialed http://127.0.0.1 URL.",
    );
  }

  if (parsed.pathname !== "/gsi") {
    throw new Error("CS2 GSI URI path must be /gsi.");
  }

  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("CS2 GSI URI must include a valid port.");
  }

  return parsed.toString();
}

function escapeVdfValue(value) {
  const normalized = String(value);
  if (/[\r\n"]/u.test(normalized)) {
    throw new Error("CS2 GSI configuration values cannot contain quotes or newlines.");
  }
  return normalized.replaceAll("\\", "\\\\");
}

function buildCs2GsiConfig({ uri, token, includePlayerData = false }) {
  const safeUri = escapeVdfValue(assertLoopbackUri(uri));
  const safeToken = escapeVdfValue(assertSafeToken(token));
  const playerSubscriptions = includePlayerData
    ? [
        '    "player_id" "1"',
        '    "player_state" "1"',
        '    "player_match_stats" "1"',
        '    "player_weapons" "1"',
        '    "allplayers_id" "1"',
        '    "allplayers_state" "1"',
        '    "allplayers_match_stats" "1"',
        '    "allplayers_weapons" "1"',
        '    "bomb" "1"',
      ]
    : [];

  return [
    '"Arenzyra CS2 GSI"',
    "{",
    `  "uri" "${safeUri}"`,
    '  "timeout" "5.0"',
    '  "buffer" "0.1"',
    '  "throttle" "0.1"',
    '  "heartbeat" "10.0"',
    '  "auth"',
    "  {",
    `    "token" "${safeToken}"`,
    "  }",
    '  "data"',
    "  {",
    '    "provider" "1"',
    '    "map" "1"',
    '    "map_round_wins" "1"',
    '    "round" "1"',
    '    "phase_countdowns" "1"',
    ...playerSubscriptions,
    "  }",
    "}",
    "",
  ].join("\r\n");
}

function normalizeConfigName(name = DEFAULT_CONFIG_NAME) {
  const normalized = String(name || "").trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,48}$/u.test(normalized)) {
    throw new Error(
      "CS2 GSI configuration name must use 1-48 lowercase letters, numbers, underscores, or hyphens.",
    );
  }
  return normalized;
}

function resolveCs2GsiConfigPath(cs2InstallDir, name = DEFAULT_CONFIG_NAME) {
  const rawRoot = String(cs2InstallDir || "").trim();
  if (!rawRoot || !path.isAbsolute(rawRoot)) {
    throw new Error("CS2 installation directory must be an absolute path.");
  }

  const installRoot = path.resolve(rawRoot);
  const safeName = normalizeConfigName(name);
  return path.join(
    installRoot,
    "game",
    "csgo",
    "cfg",
    `gamestate_integration_${safeName}.cfg`,
  );
}

function isPathInside(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return (
    relative !== "" &&
    !path.isAbsolute(relative) &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`)
  );
}

function resolveVerifiedCs2ConfigContext(
  cs2InstallDir,
  name = DEFAULT_CONFIG_NAME,
) {
  const rawRoot = String(cs2InstallDir || "").trim();
  if (!rawRoot || !path.isAbsolute(rawRoot)) {
    throw new Error("CS2 installation directory must be an absolute path.");
  }

  const requestedRoot = path.resolve(rawRoot);
  if (
    !fs.existsSync(requestedRoot) ||
    !fs.statSync(requestedRoot).isDirectory()
  ) {
    throw new Error("The selected CS2 installation directory does not exist.");
  }

  const installRoot = fs.realpathSync.native(requestedRoot);
  const requestedGameRoot = path.join(installRoot, "game", "csgo");
  if (
    !fs.existsSync(requestedGameRoot) ||
    !fs.statSync(requestedGameRoot).isDirectory()
  ) {
    throw new Error(
      "The selected folder is not a CS2 installation (game\\csgo was not found).",
    );
  }

  const gameRoot = fs.realpathSync.native(requestedGameRoot);
  if (!isPathInside(installRoot, gameRoot)) {
    throw new Error(
      "CS2 game directory resolves outside the selected installation.",
    );
  }

  const gameInfoPath = path.join(gameRoot, "gameinfo.gi");
  if (!fs.existsSync(gameInfoPath) || !fs.statSync(gameInfoPath).isFile()) {
    throw new Error(
      "The selected folder is not a verified CS2 installation (gameinfo.gi was not found).",
    );
  }

  const requestedConfigDirectory = path.join(gameRoot, "cfg");
  if (
    !fs.existsSync(requestedConfigDirectory) ||
    !fs.statSync(requestedConfigDirectory).isDirectory()
  ) {
    throw new Error("The CS2 configuration directory was not found.");
  }

  const configDirectory = fs.realpathSync.native(requestedConfigDirectory);
  if (!isPathInside(installRoot, configDirectory)) {
    throw new Error(
      "CS2 configuration directory resolves outside the selected installation.",
    );
  }

  const safeName = normalizeConfigName(name);
  return {
    installRoot,
    configPath: path.join(
      configDirectory,
      `gamestate_integration_${safeName}.cfg`,
    ),
  };
}

function readInstalledCs2GsiConfig({
  cs2InstallDir,
  name = DEFAULT_CONFIG_NAME,
}) {
  const { configPath } = resolveVerifiedCs2ConfigContext(
    cs2InstallDir,
    name,
  );
  if (!fs.existsSync(configPath)) {
    return null;
  }

  if (fs.lstatSync(configPath).isSymbolicLink()) {
    const error = new Error(
      `Refusing to read a linked CS2 GSI configuration: ${configPath}`,
    );
    error.code = "CS2_GSI_CONFIG_UNMANAGED";
    throw error;
  }

  const stat = fs.statSync(configPath);
  if (!stat.isFile() || stat.size > MAX_MANAGED_CONFIG_BYTES) {
    const error = new Error(
      `Existing CS2 GSI configuration is not a valid Arenzyra-managed file: ${configPath}`,
    );
    error.code = "CS2_GSI_CONFIG_UNMANAGED";
    throw error;
  }

  const content = fs.readFileSync(configPath, "utf8");
  if (!content.trimStart().startsWith('"Arenzyra CS2 GSI"')) {
    const error = new Error(
      `Refusing to read non-Arenzyra CS2 GSI configuration: ${configPath}`,
    );
    error.code = "CS2_GSI_CONFIG_UNMANAGED";
    throw error;
  }

  const uriMatch = content.match(/^\s*"uri"\s+"([^"\r\n]+)"\s*$/mu);
  const tokenMatch = content.match(/^\s*"token"\s+"([^"\r\n]+)"\s*$/mu);
  if (!uriMatch || !tokenMatch) {
    const error = new Error(
      `Existing Arenzyra CS2 GSI configuration is incomplete: ${configPath}`,
    );
    error.code = "CS2_GSI_CONFIG_INVALID";
    throw error;
  }

  return {
    configPath,
    uri: assertLoopbackUri(uriMatch[1]),
    token: assertSafeToken(tokenMatch[1]),
    includePlayerData: /"allplayers_id"\s+"1"/u.test(content),
  };
}

function installCs2GsiConfig({
  cs2InstallDir,
  uri,
  token,
  name = DEFAULT_CONFIG_NAME,
  includePlayerData = false,
}) {
  const { configPath } = resolveVerifiedCs2ConfigContext(
    cs2InstallDir,
    name,
  );
  const content = buildCs2GsiConfig({
    uri,
    token,
    includePlayerData,
  });

  if (fs.existsSync(configPath)) {
    if (fs.lstatSync(configPath).isSymbolicLink()) {
      const error = new Error(
        `Refusing to use a linked CS2 GSI configuration: ${configPath}`,
      );
      error.code = "CS2_GSI_CONFIG_UNMANAGED";
      throw error;
    }
    const existing = fs.readFileSync(configPath, "utf8");
    if (existing === content) {
      return { configPath, changed: false };
    }
    const error = new Error(
      `Refusing to overwrite existing CS2 GSI configuration: ${configPath}`,
    );
    error.code = "CS2_GSI_CONFIG_EXISTS";
    throw error;
  }

  fs.writeFileSync(configPath, content, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return { configPath, changed: true };
}

module.exports = {
  DEFAULT_CONFIG_NAME,
  DEFAULT_GSI_PORT,
  assertLoopbackUri,
  assertSafeToken,
  buildCs2GsiConfig,
  createCs2GsiToken,
  installCs2GsiConfig,
  readInstalledCs2GsiConfig,
  resolveCs2GsiConfigPath,
};
