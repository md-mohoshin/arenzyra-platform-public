const fs = require("node:fs");
const path = require("node:path");

const TOTAL_SLOTS = 25;
const DEFAULT_TEAM_NAME = "Arenzyra";
const DEFAULT_TEAM_TAG = "AZ";
const DEFAULT_TEAM_COLOR = { r: 255, g: 255, b: 255 };
const DEFAULT_TEAM_LOGO_NAME = "arenzyra-default.png";
const BRANDING_CACHE_FILE_NAME = ".shadow-branding-cache.json";
const BRANDING_CACHE_VERSION = 1;
const BRANDING_RENDER_CONCURRENCY = 4;
const SHADOW_LOGO_FIT_RATIO = 0.88;
const PLACEHOLDER_LOGO_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axzwoAAAAASUVORK5CYII=";
const SHADOW_LOGO_VARIANTS = Object.freeze([
  { key: "base", suffix: "", size: 256 },
  { key: "size64", suffix: "_64", size: 64 },
  { key: "size128", suffix: "_128", size: 128 },
  { key: "size256", suffix: "_256", size: 256 },
]);

let sharpModule = null;
const shadowLogoTemplateCache = new Map();

function getSharp() {
  if (sharpModule) {
    return sharpModule;
  }

  try {
    sharpModule = require("sharp");
    return sharpModule;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`sharp module unavailable: ${detail}`);
  }
}

async function assertSharpRuntimeReady() {
  const sharp = getSharp();
  try {
    await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    sharpModule = null;
    throw new Error(`sharp runtime unavailable: ${detail}`);
  }
}

async function generateShadowBranding(options = {}) {
  const matchId = String(options.matchId || "").trim();
  const teamAssetsDir = String(options.teamAssetsDir || "").trim();
  const brandingConfigPath = String(options.brandingConfigPath || "").trim();
  const defaultLogoPath = String(options.defaultLogoPath || "").trim();
  const shadowLogoTemplatePath = String(options.shadowLogoTemplatePath || "").trim();
  const providedSlots = Array.isArray(options.slots) ? options.slots : [];
  const logInfo =
    typeof options.logInfo === "function" ? options.logInfo : () => {};
  const logWarn =
    typeof options.logWarn === "function" ? options.logWarn : () => {};

  if (!matchId) {
    throw new Error("Match not found");
  }
  if (!teamAssetsDir) {
    throw new Error("Team assets directory is not configured.");
  }
  if (!brandingConfigPath) {
    throw new Error("Branding config path is not configured.");
  }
  if (!defaultLogoPath) {
    throw new Error("Default team logo is not configured.");
  }
  await assertSharpRuntimeReady();

  await fs.promises.mkdir(path.dirname(brandingConfigPath), { recursive: true });
  await fs.promises.mkdir(teamAssetsDir, { recursive: true });

  const placeholderLogoPath = await ensureDefaultTeamLogo(
    teamAssetsDir,
    defaultLogoPath,
  );
  const slotsByNumber = new Map();
  for (const slot of providedSlots) {
    const slotNumber = Number(slot?.slotNumber ?? slot?.teamNo ?? 0);
    if (Number.isFinite(slotNumber) && slotNumber >= 1 && slotNumber <= TOTAL_SLOTS) {
      slotsByNumber.set(slotNumber, slot);
    }
  }

  const cachePath = getBrandingCachePath(teamAssetsDir);
  const brandingCache = await readBrandingCache(cachePath);
  const slotNumbers = Array.from(
    { length: TOTAL_SLOTS },
    (_entry, index) => index + 1,
  );
  const slotResults = await mapWithConcurrency(
    slotNumbers,
    normalizeConcurrency(options.renderConcurrency),
    (slotNumber) =>
      prepareBrandingSlot({
        matchId,
        slotNumber,
        slot: slotsByNumber.get(slotNumber) ?? null,
        placeholderLogoPath,
        teamAssetsDir,
        shadowLogoTemplatePath,
        brandingCache,
        logWarn,
      }),
  );
  const sortedSlotResults = [...slotResults].sort(
    (left, right) => left.slotNumber - right.slotNumber,
  );
  const preparedSlots = sortedSlotResults.map((result) => result.preparedSlot);
  const lines = [
    "[/Script/ShadowTrackerExtra.FCustomTeamLogoAndColor]",
    "EnableTeamLogoAndColor=1",
    ...sortedSlotResults.map((result) => result.line),
  ];
  const nextCache = {
    version: BRANDING_CACHE_VERSION,
    updatedAt: new Date().toISOString(),
    slots: {},
  };
  for (const result of sortedSlotResults) {
    nextCache.slots[String(result.slotNumber)] = result.cacheEntry;
  }
  const cacheHitCount = sortedSlotResults.filter(
    (result) => result.cacheHit === true,
  ).length;
  const renderedCount = sortedSlotResults.length - cacheHitCount;

  await fs.promises.writeFile(brandingConfigPath, lines.join("\r\n"), "utf8");
  try {
    await writeJsonFileAtomic(cachePath, nextCache);
  } catch (error) {
    logWarn(
      `[shadow-branding] failed to update cache: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  logInfo(
    `[shadow-branding] wrote ${preparedSlots.length} slots to ${brandingConfigPath} for match ${matchId} (${renderedCount} rendered, ${cacheHitCount} reused)`,
  );

  return {
    ok: true,
    matchId,
    teamCount: preparedSlots.length,
    teamAssetsDir,
    brandingConfigPath,
    slots: preparedSlots,
    cachePath,
    cacheHitCount,
    renderedCount,
  };
}

async function prepareBrandingSlot(options) {
  const slot = options.slot;
  const slotNumber = options.slotNumber;
  const placeholderLogoPath = options.placeholderLogoPath;
  const teamName = slot?.team?.name ?? DEFAULT_TEAM_NAME;
  const sourceLogoPath =
    await resolveSourceLogoPath(slot?.localLogoPath, placeholderLogoPath);
  const fingerprint = await buildSlotCacheFingerprint({
    matchId: options.matchId,
    slotNumber,
    slot,
    sourceLogoPath,
    shadowLogoTemplatePath: options.shadowLogoTemplatePath,
  });
  const cached = await getUsableCachedSlot(
    options.brandingCache,
    slotNumber,
    fingerprint,
  );
  if (cached) {
    return {
      slotNumber,
      preparedSlot: {
        ...cached.preparedSlot,
        matchId: options.matchId,
      },
      line: cached.line,
      cacheEntry: cached,
      cacheHit: true,
    };
  }

  const hasAssignedTeam = Boolean(slot?.teamId || slot?.team);
  const palette = await resolveSlotPalette(slot?.team ?? null, sourceLogoPath);
  const logoPaths = await prepareSlotLogoPaths({
    slotNumber,
    teamName,
    sourceLogoPath,
    defaultLogoPath: placeholderLogoPath,
    teamAssetsDir: options.teamAssetsDir,
    shadowLogoTemplatePath: options.shadowLogoTemplatePath,
    logWarn: options.logWarn,
  });
  const localLogoPath = logoPaths.base;
  const shadowTeamName = toShadowTeamName(teamName, slotNumber);
  const preparedSlot = {
    id: String(slot?.id ?? `slot-${slotNumber}`),
    matchId: options.matchId,
    slotNumber,
    teamId: slot?.teamId ? String(slot.teamId) : null,
    lobbyStatus: slot?.lobbyStatus ? String(slot.lobbyStatus) : null,
    playersInLobby:
      slot?.playersInLobby === null || slot?.playersInLobby === undefined
        ? null
        : Number(slot.playersInLobby),
    resolvedColor: palette.teamHex,
    playerColor: palette.playerHex,
    localLogoPath,
    logoPaths,
    sourceLogoPath,
    usedPlaceholder:
      slot?.usedPlaceholder === true ||
      normalizeComparablePath(sourceLogoPath) ===
        normalizeComparablePath(placeholderLogoPath),
    logoDownloaded: slot?.logoDownloaded === true,
    isDefaultBranding: !hasAssignedTeam,
    team: buildPreparedTeam(slot, palette, placeholderLogoPath, slotNumber),
  };
  const line = buildTeamLogoAndColorLine({
    slotNumber,
    shadowTeamName,
    localLogoPath,
    palette,
  });
  const cacheEntry = {
    fingerprint,
    line,
    preparedSlot,
  };

  return {
    slotNumber,
    preparedSlot,
    line,
    cacheEntry,
    cacheHit: false,
  };
}

async function ensureDefaultTeamLogo(teamAssetsDir, defaultLogoPath) {
  const targetPath = path.join(teamAssetsDir, DEFAULT_TEAM_LOGO_NAME);

  try {
    await renderLogoVariant({
      sourceLogoPath: defaultLogoPath,
      targetPath,
      size: 256,
      shadowLogoTemplatePath: "",
    });
    return targetPath;
  } catch {
    await fs.promises.writeFile(
      targetPath,
      Buffer.from(PLACEHOLDER_LOGO_BASE64, "base64"),
    );
    return targetPath;
  }
}

async function prepareSlotLogoPaths(options) {
  const targetStem = path.join(
    options.teamAssetsDir,
    buildShadowLogoBaseName(options.slotNumber),
  );
  const sourceCandidates = options.sourceLogoPath
    ? [options.sourceLogoPath, options.defaultLogoPath]
    : [options.defaultLogoPath];

  for (const candidate of sourceCandidates) {
    try {
      return await writeSlotLogoVariants({
        sourceLogoPath: candidate,
        targetStem,
        shadowLogoTemplatePath: options.shadowLogoTemplatePath,
      });
    } catch (error) {
      options.logWarn(
        `[shadow-branding] failed to render slot ${options.slotNumber} (${options.teamName || DEFAULT_TEAM_NAME}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return writeSlotLogoVariants({
    sourceLogoPath: options.defaultLogoPath,
    targetStem,
    shadowLogoTemplatePath: options.shadowLogoTemplatePath,
    usePlaceholder: true,
  });
}

async function resolveSourceLogoPath(localLogoPath, defaultLogoPath) {
  const normalizedLogoPath = String(localLogoPath || "").trim();
  if (normalizedLogoPath && (await pathExists(normalizedLogoPath))) {
    return normalizedLogoPath;
  }
  return defaultLogoPath;
}

async function resolveSlotPalette(team, sourceLogoPath) {
  const accentColor =
    parseHexColor(team?.accentLight) ?? parseHexColor(team?.accentDark);
  const logoColor =
    accentColor ??
    (sourceLogoPath
      ? ((await extractAccentColor(sourceLogoPath)) ??
        (await extractDominantColor(sourceLogoPath)))
      : null) ??
    DEFAULT_TEAM_COLOR;
  const teamColor = normalizeTeamColor(logoColor);
  const playerColor = mixColors(teamColor, { r: 0, g: 0, b: 0 }, 0.24);

  return {
    team: teamColor,
    player: playerColor,
    teamHex: rgbToHex(teamColor),
    playerHex: rgbToHex(playerColor),
  };
}

function buildPreparedTeam(slot, palette, defaultLogoPath, slotNumber) {
  if (slot?.team && typeof slot.team === "object") {
    return {
      id: String(slot.team.id ?? slot.teamId ?? `team-${slotNumber}`),
      name: slot.team.name ? String(slot.team.name) : null,
      tag: slot.team.tag ? String(slot.team.tag) : null,
      logoUrl: slot.team.logoUrl ? String(slot.team.logoUrl) : null,
      accentLight: slot.team.accentLight
        ? String(slot.team.accentLight)
        : palette.teamHex,
      accentDark: slot.team.accentDark
        ? String(slot.team.accentDark)
        : palette.playerHex,
    };
  }

  if (slot?.teamId) {
    return {
      id: String(slot.teamId),
      name: null,
      tag: null,
      logoUrl: null,
      accentLight: palette.teamHex,
      accentDark: palette.playerHex,
    };
  }

  return {
    id: `arenzyra-${slotNumber}`,
    name: DEFAULT_TEAM_NAME,
    tag: DEFAULT_TEAM_TAG,
    logoUrl: defaultLogoPath,
    accentLight: palette.teamHex,
    accentDark: palette.playerHex,
  };
}

function buildTeamLogoAndColorLine(options) {
  const { slotNumber, shadowTeamName, localLogoPath, palette } = options;
  return `TeamLogoAndColor=(TeamNo=${slotNumber},TeamName=${shadowTeamName},TeamLogoPath=${localLogoPath},KillInfoPath=${localLogoPath},TeamColorR=${palette.team.r},TeamColorG=${palette.team.g},TeamColorB=${palette.team.b},TeamColorA=255,PlayerColorR=${palette.player.r},PlayerColorG=${palette.player.g},PlayerColorB=${palette.player.b},PlayerColorA=255,CornerMarkPath=,fin)`;
}

function getBrandingCachePath(teamAssetsDir) {
  return path.join(teamAssetsDir, BRANDING_CACHE_FILE_NAME);
}

async function readBrandingCache(cachePath) {
  try {
    const raw = await fs.promises.readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      parsed.version === BRANDING_CACHE_VERSION &&
      parsed.slots &&
      typeof parsed.slots === "object" &&
      !Array.isArray(parsed.slots)
    ) {
      return parsed;
    }
  } catch {
    // Missing or invalid cache files are expected on first run.
  }
  return {
    version: BRANDING_CACHE_VERSION,
    slots: {},
  };
}

async function getUsableCachedSlot(cache, slotNumber, fingerprint) {
  const entry = cache?.slots?.[String(slotNumber)] ?? null;
  if (
    !entry ||
    entry.fingerprint !== fingerprint ||
    !entry.line ||
    !entry.preparedSlot ||
    typeof entry.preparedSlot !== "object"
  ) {
    return null;
  }

  const logoPaths =
    entry.preparedSlot.logoPaths &&
    typeof entry.preparedSlot.logoPaths === "object"
      ? entry.preparedSlot.logoPaths
      : {};
  const expectedPaths = SHADOW_LOGO_VARIANTS
    .map((variant) => logoPaths[variant.key])
    .filter(Boolean);
  if (expectedPaths.length !== SHADOW_LOGO_VARIANTS.length) {
    return null;
  }

  for (const filePath of expectedPaths) {
    if (!(await pathExists(filePath))) {
      return null;
    }
  }

  return entry;
}

async function buildSlotCacheFingerprint(options) {
  const slot = options.slot ?? null;
  const team = slot?.team && typeof slot.team === "object" ? slot.team : null;
  const payload = {
    version: BRANDING_CACHE_VERSION,
    matchId: String(options.matchId || ""),
    slotNumber: options.slotNumber,
    slot: {
      id: slot?.id ? String(slot.id) : null,
      teamId: slot?.teamId ? String(slot.teamId) : null,
      localLogoPath: normalizeComparablePath(slot?.localLogoPath),
      usedPlaceholder: slot?.usedPlaceholder === true,
      logoDownloaded: slot?.logoDownloaded === true,
      teamName: slot?.teamName ? String(slot.teamName) : null,
      teamTag: slot?.teamTag ? String(slot.teamTag) : null,
      teamColor: slot?.teamColor ? String(slot.teamColor) : null,
    },
    team: team
      ? {
          id: team.id ? String(team.id) : null,
          name: team.name ? String(team.name) : null,
          tag: team.tag ? String(team.tag) : null,
          logoUrl: team.logoUrl ? String(team.logoUrl) : null,
          accentLight: team.accentLight ? String(team.accentLight) : null,
          accentDark: team.accentDark ? String(team.accentDark) : null,
        }
      : null,
    sourceLogo: await getFileCacheDescriptor(options.sourceLogoPath),
    shadowLogoTemplate: await getFileCacheDescriptor(
      options.shadowLogoTemplatePath,
    ),
  };

  return stableStringify(payload);
}

async function getFileCacheDescriptor(filePath) {
  const normalizedPath = String(filePath || "").trim();
  if (!normalizedPath) {
    return null;
  }

  try {
    const stats = await fs.promises.stat(normalizedPath);
    if (!stats.isFile()) {
      return null;
    }
    return {
      path: normalizeComparablePath(normalizedPath),
      size: stats.size,
      mtimeMs: Math.trunc(stats.mtimeMs),
    };
  } catch {
    return null;
  }
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function normalizeConcurrency(value) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return BRANDING_RENDER_CONCURRENCY;
  }
  return Math.max(1, Math.min(8, Math.trunc(normalized)));
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: workerCount }, () => worker()),
  );
  return results;
}

async function writeTextFileAtomic(targetPath, content) {
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tempPath, content, "utf8");
  await fs.promises.rename(tempPath, targetPath);
}

async function writeJsonFileAtomic(targetPath, value) {
  await writeTextFileAtomic(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}

function parseHexColor(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/^#/, "");
  if (!normalized) {
    return null;
  }

  const hex =
    normalized.length === 3
      ? normalized
          .split("")
          .map((part) => `${part}${part}`)
          .join("")
      : normalized;

  if (!/^[0-9a-f]{6}$/i.test(hex)) {
    return null;
  }

  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

async function extractDominantColor(sourceLogoPath) {
  try {
    const sharp = getSharp();
    const stats = await sharp(sourceLogoPath)
      .trim()
      .resize(128, 128, { fit: "inside" })
      .stats();
    return {
      r: stats.dominant.r,
      g: stats.dominant.g,
      b: stats.dominant.b,
    };
  } catch {
    return null;
  }
}

async function extractAccentColor(sourceLogoPath) {
  try {
    const sharp = getSharp();
    const { data, info } = await sharp(sourceLogoPath)
      .ensureAlpha()
      .trim()
      .resize(96, 96, { fit: "inside" })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    const buckets = new Map();

    for (let index = 0; index < data.length; index += channels) {
      const alpha = channels >= 4 ? (data[index + 3] ?? 255) : 255;
      if (alpha < 24) {
        continue;
      }

      const color = {
        r: data[index] ?? 0,
        g: data[index + 1] ?? 0,
        b: data[index + 2] ?? 0,
      };
      const hsv = rgbToHsv(color);

      if (hsv.s < 0.24 || hsv.v < 0.12) {
        continue;
      }

      const bucketId = getAccentBucketId(hsv);
      const weight =
        (alpha / 255) *
        Math.max(0.2, hsv.s * hsv.s + Math.max(0, hsv.v - 0.2));
      const bucket = buckets.get(bucketId) ?? {
        weight: 0,
        r: 0,
        g: 0,
        b: 0,
      };

      bucket.weight += weight;
      bucket.r += color.r * weight;
      bucket.g += color.g * weight;
      bucket.b += color.b * weight;
      buckets.set(bucketId, bucket);
    }

    let winningBucket = null;
    for (const bucket of buckets.values()) {
      if (!winningBucket || bucket.weight > winningBucket.weight) {
        winningBucket = bucket;
      }
    }

    if (!winningBucket || winningBucket.weight <= 0) {
      return null;
    }

    return clampColor({
      r: winningBucket.r / winningBucket.weight,
      g: winningBucket.g / winningBucket.weight,
      b: winningBucket.b / winningBucket.weight,
    });
  } catch {
    return null;
  }
}

function rgbToHsv(color) {
  const red = color.r / 255;
  const green = color.g / 255;
  const blue = color.b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  let hue = 0;
  if (delta > 0) {
    if (max === red) {
      hue = 60 * (((green - blue) / delta) % 6);
    } else if (max === green) {
      hue = 60 * ((blue - red) / delta + 2);
    } else {
      hue = 60 * ((red - green) / delta + 4);
    }
  }

  return {
    h: hue < 0 ? hue + 360 : hue,
    s: max === 0 ? 0 : delta / max,
    v: max,
  };
}

function getAccentBucketId(color) {
  const hueBucket = Math.min(23, Math.floor(color.h / 15));
  const saturationBucket = color.s >= 0.55 ? 1 : 0;
  return hueBucket * 2 + saturationBucket;
}

function normalizeTeamColor(color) {
  let normalized = clampColor(color);
  const luminance = relativeLuminance(normalized);

  if (luminance < 0.16) {
    normalized = mixColors(normalized, { r: 255, g: 255, b: 255 }, 0.35);
  } else if (luminance > 0.82) {
    normalized = mixColors(normalized, { r: 0, g: 0, b: 0 }, 0.18);
  }

  return clampColor(normalized);
}

function mixColors(base, target, amount) {
  const ratio = Math.max(0, Math.min(1, amount));
  return clampColor({
    r: base.r + (target.r - base.r) * ratio,
    g: base.g + (target.g - base.g) * ratio,
    b: base.b + (target.b - base.b) * ratio,
  });
}

function clampColor(color) {
  return {
    r: Math.max(0, Math.min(255, Math.round(color.r))),
    g: Math.max(0, Math.min(255, Math.round(color.g))),
    b: Math.max(0, Math.min(255, Math.round(color.b))),
  };
}

function rgbToHex(color) {
  return `#${[color.r, color.g, color.b]
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

function relativeLuminance(color) {
  const convert = (value) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  return (
    0.2126 * convert(color.r) +
    0.7152 * convert(color.g) +
    0.0722 * convert(color.b)
  );
}

function buildShadowLogoBaseName(slotNumber) {
  return String(slotNumber).padStart(3, "0");
}

function normalizeComparablePath(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  const resolved = path.resolve(normalized);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function writeSlotLogoVariants(options) {
  const logoPaths = {};

  for (const variant of SHADOW_LOGO_VARIANTS) {
    const targetPath = `${options.targetStem}${variant.suffix}.png`;
    if (options.usePlaceholder === true) {
      await fs.promises.writeFile(
        targetPath,
        Buffer.from(PLACEHOLDER_LOGO_BASE64, "base64"),
      );
    } else {
      await renderLogoVariant({
        sourceLogoPath: options.sourceLogoPath,
        targetPath,
        size: variant.size,
        shadowLogoTemplatePath: options.shadowLogoTemplatePath,
      });
    }
    logoPaths[variant.key] = targetPath;
  }

  return logoPaths;
}

async function renderLogoVariant(options) {
  const sharp = getSharp();
  const templateBuffer = await resolveShadowLogoTemplate(
    options.shadowLogoTemplatePath,
    options.size,
  );
  const logoBuffer = await sharp(options.sourceLogoPath)
    .resize(
      Math.round(options.size * SHADOW_LOGO_FIT_RATIO),
      Math.round(options.size * SHADOW_LOGO_FIT_RATIO),
      {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    )
    .png()
    .toBuffer();

  let pipeline = sharp({
    create: {
      width: options.size,
      height: options.size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });

  if (templateBuffer) {
    pipeline = pipeline.composite([{ input: templateBuffer }]);
  }

  const outputBuffer = await pipeline
    .composite([{ input: logoBuffer, gravity: "center" }])
    .png()
    .toBuffer();
  await writeBufferIfChanged(options.targetPath, outputBuffer);
}

async function resolveShadowLogoTemplate(templatePath, size) {
  const descriptor = await getFileCacheDescriptor(templatePath);
  if (!descriptor) {
    return null;
  }

  const cacheKey = stableStringify({
    ...descriptor,
    size,
  });
  const cached = shadowLogoTemplateCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const sharp = getSharp();
  const buffer = await sharp(templatePath)
    .resize(size, size, { fit: "fill" })
    .png()
    .toBuffer();
  shadowLogoTemplateCache.set(cacheKey, buffer);
  return buffer;
}

function toShadowTeamName(name, slotNumber) {
  const cleaned = String(name || DEFAULT_TEAM_NAME)
    .replace(/[,\r\n()]+/g, " ")
    .replace(/\s+/g, "")
    .trim();
  return cleaned || `Arenzyra${slotNumber}`;
}

async function pathExists(targetPath) {
  try {
    await fs.promises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function writeBufferIfChanged(targetPath, buffer) {
  try {
    const existingBuffer = await fs.promises.readFile(targetPath);
    if (
      existingBuffer.length === buffer.length &&
      existingBuffer.equals(buffer)
    ) {
      return false;
    }
  } catch {
    // Missing files are expected on first render.
  }
  await fs.promises.writeFile(targetPath, buffer);
  return true;
}

module.exports = {
  generateShadowBranding,
};
