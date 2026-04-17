import { BadRequestException, Logger } from '@nestjs/common';
import { diskStorage } from 'multer';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import type { Request } from 'express';
import { randomUUID } from 'crypto';
import { mkdirSync, promises as fs } from 'fs';
import { extname, resolve } from 'path';
import axios from 'axios';
import FormData from 'form-data';
import sharp from 'sharp';

export const MEDIA_UPLOAD_TYPES = [
  'sponsor',
  'tournament',
  'team',
  'player',
  'org',
] as const;

export type MediaUploadType = (typeof MEDIA_UPLOAD_TYPES)[number];

export const MAX_MEDIA_UPLOAD_SIZE = 5 * 1024 * 1024; // 5MB

const OPTIMIZED_EXTENSION = '.webp';
const OPTIMIZED_QUALITY = 80;
const OPTIMIZED_MAX_WIDTH = 512;
const TEMP_UPLOAD_DIR = '_tmp';

const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/svg+xml',
  'image/webp',
]);

const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.svg', '.webp']);

const SPONSOR_ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
]);

const SPONSOR_ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

const uploadTypeCacheKey = '__mediaUploadType' as const;

const logger = new Logger('MediaUpload');
let mediaAiWarned = false;

function typeDir(type: MediaUploadType) {
  return type === 'sponsor' ? 'sponsors' : type;
}

export function resolveUploadsRoot() {
  return resolve(__dirname, '..', '..', '..', 'uploads');
}

export function resolveUploadType(req: Request): MediaUploadType {
  const reqWithCache = req as Request & {
    [uploadTypeCacheKey]?: MediaUploadType;
  };
  const cached = reqWithCache[uploadTypeCacheKey];
  if (cached && typeof cached === 'string') return cached;

  const typeParam = req.query?.type;
  const firstFromArray =
    Array.isArray(typeParam) && typeof typeParam[0] === 'string'
      ? typeParam[0]
      : null;
  const raw =
    typeof typeParam === 'string'
      ? typeParam.trim().toLowerCase()
      : typeof firstFromArray === 'string'
        ? firstFromArray.toLowerCase()
        : '';
  if (!raw) {
    throw new BadRequestException(
      `type query parameter is required. Allowed: ${MEDIA_UPLOAD_TYPES.join(', ')}`,
    );
  }

  if (!MEDIA_UPLOAD_TYPES.includes(raw as MediaUploadType)) {
    throw new BadRequestException(
      `Invalid type. Allowed: ${MEDIA_UPLOAD_TYPES.join(', ')}`,
    );
  }

  reqWithCache[uploadTypeCacheKey] = raw as MediaUploadType;
  return raw as MediaUploadType;
}

function ensureUploadDir(type: MediaUploadType) {
  const dir = resolve(resolveUploadsRoot(), typeDir(type));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function ensureTempUploadDir() {
  const dir = resolve(resolveUploadsRoot(), TEMP_UPLOAD_DIR);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function assertImageFile(
  file: { originalname?: string; mimetype?: string },
  type: MediaUploadType,
) {
  const ext = extname(file.originalname ?? '').toLowerCase();
  const mime = (file.mimetype ?? '').toLowerCase();

  const mimeAllowed = (
    type === 'sponsor' ? SPONSOR_ALLOWED_MIME_TYPES : ALLOWED_MIME_TYPES
  ).has(mime);
  const extAllowed = ext
    ? (type === 'sponsor'
        ? SPONSOR_ALLOWED_EXTENSIONS
        : ALLOWED_EXTENSIONS
      ).has(ext)
    : false;

  if (!mimeAllowed && !extAllowed) {
    throw new BadRequestException(
      type === 'sponsor'
        ? 'Only PNG, JPG, JPEG, and WEBP images are allowed'
        : 'Only PNG, JPG, JPEG, SVG, and WEBP images are allowed',
    );
  }
}

export function buildUploadedFileUrl(
  type: MediaUploadType,
  filename: string,
): { url: string } {
  return { url: `/uploads/${typeDir(type)}/${filename}` };
}

function warnMediaAiUnavailableOnce() {
  if (mediaAiWarned) return;
  mediaAiWarned = true;
  logger.warn('[MediaAI] unavailable, skipping background removal');
}

async function tryRemoveBackground(
  fileBuffer: Buffer,
  file: Express.Multer.File,
): Promise<Buffer | null> {
  const base = process.env.MEDIA_AI_URL;
  if (!base) {
    warnMediaAiUnavailableOnce();
    return null;
  }
  const endpoint = `${base.replace(/\/$/, '')}/remove-bg`;

  const form = new FormData();
  form.append('file', fileBuffer, {
    filename: file.originalname || 'upload.png',
    contentType: file.mimetype || 'application/octet-stream',
    knownLength: fileBuffer.length,
  });

  try {
    const res = await axios.post<ArrayBuffer>(endpoint, form, {
      headers: form.getHeaders(),
      responseType: 'arraybuffer',
      timeout: 12_000,
      maxContentLength: Infinity,
      maxBodyLength: MAX_MEDIA_UPLOAD_SIZE + 512 * 1024,
      validateStatus: (status) => status >= 200 && status < 300,
    });
    return Buffer.from(res.data);
  } catch {
    warnMediaAiUnavailableOnce();
    return null;
  }
}

export async function optimizeUploadedImage(
  file: Express.Multer.File,
  type: MediaUploadType,
): Promise<{ url: string; filename: string }> {
  if (!file?.path) {
    throw new BadRequestException('Upload failed: file path not found');
  }

  const targetDir = ensureUploadDir(type);
  const optimizedFilename = `${randomUUID()}${OPTIMIZED_EXTENSION}`;
  const optimizedPath = resolve(targetDir, optimizedFilename);
  let sourceBuffer: Buffer;

  try {
    const tempBuffer = await fs.readFile(file.path);
    sourceBuffer = tempBuffer;

    if (type === 'sponsor') {
      const aiBuffer = await tryRemoveBackground(tempBuffer, file);
      if (aiBuffer) {
        sourceBuffer = aiBuffer;
      }
    }

    await sharp(sourceBuffer)
      .rotate() // respect EXIF orientation
      .resize({
        width: OPTIMIZED_MAX_WIDTH,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: OPTIMIZED_QUALITY })
      .toFile(optimizedPath);
  } catch {
    await fs.rm(optimizedPath, { force: true }).catch(() => undefined);
    throw new BadRequestException('Failed to optimize image upload');
  } finally {
    await fs.rm(file.path, { force: true }).catch(() => undefined);
  }

  return {
    ...buildUploadedFileUrl(type, optimizedFilename),
    filename: optimizedFilename,
  };
}

export const mediaUploadMulterOptions: MulterOptions = {
  storage: diskStorage({
    destination: (req, _file, cb) => {
      try {
        cb(null, ensureTempUploadDir());
      } catch (err) {
        cb(err as Error, '');
      }
    },
    filename: (_req, file, cb) => {
      try {
        const ext = extname(file.originalname ?? '').toLowerCase();
        const safeExt = ext || '.upload';
        cb(null, `${randomUUID()}${safeExt}`);
      } catch (err) {
        cb(err as Error, '');
      }
    },
  }),
  limits: { fileSize: MAX_MEDIA_UPLOAD_SIZE },
  fileFilter: (req: Request, file, cb) => {
    try {
      const type = resolveUploadType(req);
      assertImageFile(file, type);
      cb(null, true);
    } catch (err) {
      cb(err as Error, false);
    }
  },
};
