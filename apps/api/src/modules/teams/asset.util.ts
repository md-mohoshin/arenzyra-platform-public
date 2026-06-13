import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import axios from 'axios';
import FormData from 'form-data';
import sharp from 'sharp';

type UploadFile = { buffer: Buffer; mimetype?: string };

type MediaVariant = 'logo' | 'logo-light' | 'logo-dark' | 'photo';

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

const mediaRoots = Array.from(
  new Set([
    path.join(process.cwd(), 'storage', 'media'),
    path.join(process.cwd(), 'apps', 'api', 'storage', 'media'),
    path.join(__dirname, '..', '..', '..', 'storage', 'media'),
  ]),
);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const LOGO_BACKGROUND_HARD_DISTANCE = 24;
const LOGO_BACKGROUND_SOFT_DISTANCE = 64;
const PLAYER_PHOTO_WIDTH = 448;
const PLAYER_PHOTO_HEIGHT = 557;
const PLAYER_PHOTO_SUBJECT_TARGET_HEIGHT = 549;
const PLAYER_PHOTO_ALPHA_THRESHOLD = 10;
const PLAYER_PHOTO_AI_TIMEOUT_MS = 45_000;
const logger = new Logger('AssetStorage');
let playerPhotoMediaAiWarned = false;

function normalizePublicAssetBase(value?: string | null) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return '';
  }

  const candidate = trimmed.includes('://') ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return '';
    }
    if (LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
      return '';
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

export function resolveAssetBaseUrlForStorage(
  env: NodeJS.ProcessEnv = process.env,
) {
  return normalizePublicAssetBase(
    env.ASSET_BASE_URL || env.API_PUBLIC_URL || env.APP_URL || env.API_BASE_URL,
  );
}

function safeId(id: string) {
  if (!id) throw new Error('Invalid id');
  const cleaned = id.trim();
  if (!cleaned || /[^a-zA-Z0-9_-]/.test(cleaned)) {
    throw new Error('Invalid id');
  }
  return cleaned;
}

function resolveExt(mimetype?: string) {
  const ext = mimetype ? MIME_EXT[mimetype] : null;
  if (!ext) throw new Error('Invalid file type');
  return ext;
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function resolveMediaRootForWrite() {
  return (
    mediaRoots.find((candidate) => fs.existsSync(candidate)) ?? mediaRoots[0]
  );
}

function purge(dir: string, baseName: string) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  files
    .filter((file) => file.startsWith(`${baseName}.`))
    .forEach((file) => {
      try {
        fs.unlinkSync(path.join(dir, file));
      } catch {
        /* ignore */
      }
    });
}

function purgeLegacy(
  kind: 'team' | 'player',
  id: string,
  variant: MediaVariant,
) {
  const legacyDir = path.join(
    process.cwd(),
    'public',
    'assets',
    kind === 'team' ? 'logos' : 'players',
  );
  const legacyBase =
    kind === 'team'
      ? variant === 'logo'
        ? `team_${id}`
        : `team_${id}_${variant}`
      : `player_${id}`;
  purge(legacyDir, legacyBase);
}

function buildUrl(
  kind: 'team' | 'player',
  id: string,
  variant: MediaVariant,
  version: number,
) {
  const assetBase = resolveAssetBaseUrlForStorage();
  const mediaPath =
    kind === 'team'
      ? `/media/teams/${id}/${variant}`
      : `/media/players/${id}/photo`;
  return `${assetBase}${mediaPath}?v=${version}`;
}

function store(
  kind: 'team' | 'player',
  id: string,
  file: UploadFile,
  variant: MediaVariant,
) {
  const safe = safeId(id);
  const ext = resolveExt(file?.mimetype);
  const dir = path.join(
    resolveMediaRootForWrite(),
    kind === 'team' ? 'teams' : 'players',
    safe,
  );
  ensureDir(dir);
  const baseName = kind === 'team' ? variant : 'photo';
  purge(dir, baseName);
  purgeLegacy(kind, safe, variant);
  const filePath = path.join(dir, `${baseName}.${ext}`);
  fs.writeFileSync(filePath, file.buffer);
  const version = Date.now();
  const url = buildUrl(kind, safe, variant, version);
  return { filePath, url, version };
}

export function storeTeamLogo(teamId: string, file: UploadFile) {
  return store('team', teamId, file, 'logo');
}

function colorDistance(
  red: number,
  green: number,
  blue: number,
  background: { red: number; green: number; blue: number },
) {
  const dr = red - background.red;
  const dg = green - background.green;
  const db = blue - background.blue;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function estimateEdgeBackground(
  data: Buffer,
  width: number,
  height: number,
): { red: number; green: number; blue: number } | null {
  const buckets = new Map<
    string,
    { count: number; red: number; green: number; blue: number }
  >();
  let opaqueEdgePixels = 0;

  const addPixel = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    const alpha = data[offset + 3];
    if (alpha < 220) {
      return;
    }
    opaqueEdgePixels += 1;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const key = `${Math.round(red / 16)}:${Math.round(green / 16)}:${Math.round(
      blue / 16,
    )}`;
    const bucket = buckets.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 };
    bucket.count += 1;
    bucket.red += red;
    bucket.green += green;
    bucket.blue += blue;
    buckets.set(key, bucket);
  };

  for (let x = 0; x < width; x += 1) {
    addPixel(x, 0);
    addPixel(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    addPixel(0, y);
    addPixel(width - 1, y);
  }

  if (opaqueEdgePixels < Math.max(12, Math.floor((width + height) * 0.12))) {
    return null;
  }

  const dominant = [...buckets.values()].sort((left, right) => {
    return right.count - left.count;
  })[0];
  if (!dominant || dominant.count < Math.max(12, opaqueEdgePixels * 0.08)) {
    return null;
  }

  return {
    red: Math.round(dominant.red / dominant.count),
    green: Math.round(dominant.green / dominant.count),
    blue: Math.round(dominant.blue / dominant.count),
  };
}

function removeEdgeConnectedBackground(
  data: Buffer,
  width: number,
  height: number,
  background: { red: number; green: number; blue: number },
) {
  const totalPixels = width * height;
  const visited = new Uint8Array(totalPixels);
  const queue = new Int32Array(totalPixels);
  let read = 0;
  let write = 0;

  const enqueueIfBackground = (x: number, y: number) => {
    const index = y * width + x;
    if (visited[index]) {
      return;
    }
    const offset = index * 4;
    const alpha = data[offset + 3];
    if (alpha === 0) {
      visited[index] = 1;
      queue[write++] = index;
      return;
    }
    const distance = colorDistance(
      data[offset],
      data[offset + 1],
      data[offset + 2],
      background,
    );
    if (distance > LOGO_BACKGROUND_SOFT_DISTANCE) {
      return;
    }
    visited[index] = 1;
    queue[write++] = index;
  };

  for (let x = 0; x < width; x += 1) {
    enqueueIfBackground(x, 0);
    enqueueIfBackground(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueueIfBackground(0, y);
    enqueueIfBackground(width - 1, y);
  }

  while (read < write) {
    const index = queue[read++];
    const x = index % width;
    const y = Math.floor(index / width);
    const offset = index * 4;
    const alpha = data[offset + 3];

    if (alpha > 0) {
      const distance = colorDistance(
        data[offset],
        data[offset + 1],
        data[offset + 2],
        background,
      );
      if (distance <= LOGO_BACKGROUND_HARD_DISTANCE) {
        data[offset + 3] = 0;
      } else {
        const ratio =
          (distance - LOGO_BACKGROUND_HARD_DISTANCE) /
          (LOGO_BACKGROUND_SOFT_DISTANCE - LOGO_BACKGROUND_HARD_DISTANCE);
        data[offset + 3] = Math.round(alpha * Math.min(1, Math.max(0, ratio)));
      }
    }

    if (x > 0) enqueueIfBackground(x - 1, y);
    if (x < width - 1) enqueueIfBackground(x + 1, y);
    if (y > 0) enqueueIfBackground(x, y - 1);
    if (y < height - 1) enqueueIfBackground(x, y + 1);
  }
}

function warnPlayerPhotoMediaAiFallback(reason: string) {
  if (playerPhotoMediaAiWarned) {
    return;
  }
  playerPhotoMediaAiWarned = true;
  logger.warn(
    `[MediaAI] player photo background removal unavailable, using local fallback: ${reason}`,
  );
}

async function tryRemovePlayerPhotoBackground(file: UploadFile) {
  const base = process.env.MEDIA_AI_URL?.trim();
  if (!base) {
    warnPlayerPhotoMediaAiFallback('MEDIA_AI_URL is not configured');
    return null;
  }

  const endpoint = `${base.replace(/\/$/, '')}/remove-bg`;
  const form = new FormData();
  const contentType = file.mimetype || 'application/octet-stream';
  form.append('model', 'person');
  form.append('file', file.buffer, {
    filename: `player-photo.${MIME_EXT[file.mimetype ?? ''] ?? 'png'}`,
    contentType,
    knownLength: file.buffer.length,
  });

  try {
    const response = await axios.post<ArrayBuffer>(endpoint, form, {
      headers: form.getHeaders(),
      responseType: 'arraybuffer',
      timeout:
        Number(process.env.MEDIA_AI_TIMEOUT_MS ?? '') ||
        PLAYER_PHOTO_AI_TIMEOUT_MS,
      maxContentLength: Infinity,
      maxBodyLength: file.buffer.length + 512 * 1024,
      validateStatus: (status) => status >= 200 && status < 300,
    });
    logger.log('[MediaAI] player photo background removed with person model');
    return Buffer.from(response.data);
  } catch (err) {
    const message =
      err instanceof Error && err.message ? err.message : 'request failed';
    warnPlayerPhotoMediaAiFallback(message);
    return null;
  }
}

async function normalizeLogoToTransparentPng(
  file: UploadFile,
  resize?: { width: number; height: number },
): Promise<Buffer> {
  const { data, info } = await removeEdgeBackground(file);
  let output = sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  });

  if (resize) {
    output = output.resize({
      width: resize.width,
      height: resize.height,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  }

  return output.png().toBuffer();
}

async function removeEdgeBackground(file: UploadFile) {
  const image = sharp(file.buffer, { failOn: 'none' }).rotate();
  const { data, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const background = estimateEdgeBackground(data, info.width, info.height);

  if (background) {
    removeEdgeConnectedBackground(data, info.width, info.height, background);
  }

  return { data, info };
}

function alphaBounds(data: Buffer, width: number, height: number) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha <= PLAYER_PHOTO_ALPHA_THRESHOLD) {
        continue;
      }
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  if (right < left || bottom < top) {
    return null;
  }

  return {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

async function normalizePlayerPhotoSubject(file: UploadFile): Promise<Buffer> {
  const { data, info } = await removeEdgeBackground(file);
  const bounds = alphaBounds(data, info.width, info.height);
  const source = sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  });

  if (!bounds) {
    return source
      .resize({
        width: PLAYER_PHOTO_WIDTH,
        height: PLAYER_PHOTO_HEIGHT,
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
  }

  const scale = Math.min(
    PLAYER_PHOTO_WIDTH / bounds.width,
    PLAYER_PHOTO_SUBJECT_TARGET_HEIGHT / bounds.height,
  );
  const resizedWidth = Math.max(1, Math.round(bounds.width * scale));
  const resizedHeight = Math.max(1, Math.round(bounds.height * scale));
  const subject = await source
    .extract(bounds)
    .resize({
      width: resizedWidth,
      height: resizedHeight,
      fit: 'fill',
    })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: PLAYER_PHOTO_WIDTH,
      height: PLAYER_PHOTO_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: subject,
        left: Math.round((PLAYER_PHOTO_WIDTH - resizedWidth) / 2),
        top: PLAYER_PHOTO_HEIGHT - resizedHeight,
      },
    ])
    .png()
    .toBuffer();
}

async function normalizePlayerPhotoToTransparentPng(
  file: UploadFile,
): Promise<Buffer> {
  const aiBuffer = await tryRemovePlayerPhotoBackground(file);
  return normalizePlayerPhotoSubject({
    buffer: aiBuffer ?? file.buffer,
    mimetype: aiBuffer ? 'image/png' : file.mimetype,
  });
}

export async function storeTeamLogoProcessed(teamId: string, file: UploadFile) {
  const buffer = await normalizeLogoToTransparentPng(file);
  return store(
    'team',
    teamId,
    {
      buffer,
      mimetype: 'image/png',
    },
    'logo',
  );
}

export function storeTeamBrandLogo(
  teamId: string,
  variant: 'logo-light' | 'logo-dark',
  file: UploadFile,
) {
  return store('team', teamId, file, variant);
}

export function storePlayerPhoto(playerId: string, file: UploadFile) {
  return store('player', playerId, file, 'photo');
}

export async function storePlayerPhotoProcessed(
  playerId: string,
  file: UploadFile,
) {
  const buffer = await normalizePlayerPhotoToTransparentPng(file);
  return store(
    'player',
    playerId,
    {
      buffer,
      mimetype: 'image/png',
    },
    'photo',
  );
}

export function findMediaFile(
  kind: 'team' | 'player',
  id: string,
  variant: MediaVariant = 'logo',
): string | null {
  try {
    const safe = safeId(id);
    const baseName = kind === 'team' ? variant : 'photo';
    for (const mediaRoot of mediaRoots) {
      const dir = path.join(
        mediaRoot,
        kind === 'team' ? 'teams' : 'players',
        safe,
      );
      if (!fs.existsSync(dir)) {
        continue;
      }
      const files = fs.readdirSync(dir);
      const match = files.find((file) => file.startsWith(`${baseName}.`));
      if (match) {
        return path.join(dir, match);
      }
    }
    return null;
  } catch {
    return null;
  }
}
