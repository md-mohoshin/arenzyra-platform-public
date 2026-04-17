import * as fs from 'fs';
import * as path from 'path';

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
