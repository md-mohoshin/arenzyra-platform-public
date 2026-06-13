import { existsSync, mkdtempSync, promises as fs, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import sharp from 'sharp';
import {
  optimizeUploadedImage,
  resolveUploadsRoot,
} from './media-upload.config';

describe('media upload optimization', () => {
  it('crops widget template uploads to the Discord widget canvas size', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'widget-template-upload-'));
    const sourcePath = join(tempDir, 'portrait.png');
    let outputPath: string | null = null;

    await sharp({
      create: {
        width: 900,
        height: 1400,
        channels: 3,
        background: '#123456',
      },
    })
      .png()
      .toFile(sourcePath);

    try {
      const result = await optimizeUploadedImage(
        {
          path: sourcePath,
          originalname: 'portrait.png',
          mimetype: 'image/png',
        } as Express.Multer.File,
        'widget-template',
      );

      outputPath = resolve(
        resolveUploadsRoot(),
        'widget-templates',
        result.filename,
      );

      const metadata = await sharp(await fs.readFile(outputPath)).metadata();

      expect(result.url).toBe(`/uploads/widget-templates/${result.filename}`);
      expect(metadata.width).toBe(1200);
      expect(metadata.height).toBe(630);
      expect(existsSync(sourcePath)).toBe(false);
    } finally {
      if (outputPath) rmSync(outputPath, { force: true });
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('preserves widget overlay proportions for logo placement', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'widget-overlay-upload-'));
    const sourcePath = join(tempDir, 'logo.png');
    let outputPath: string | null = null;

    await sharp({
      create: {
        width: 420,
        height: 120,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 0.5 },
      },
    })
      .png()
      .toFile(sourcePath);

    try {
      const result = await optimizeUploadedImage(
        {
          path: sourcePath,
          originalname: 'logo.png',
          mimetype: 'image/png',
        } as Express.Multer.File,
        'widget-overlay',
      );

      outputPath = resolve(
        resolveUploadsRoot(),
        'widget-overlays',
        result.filename,
      );

      const metadata = await sharp(await fs.readFile(outputPath)).metadata();

      expect(result.url).toBe(`/uploads/widget-overlays/${result.filename}`);
      expect(metadata.width).toBe(420);
      expect(metadata.height).toBe(120);
      expect(existsSync(sourcePath)).toBe(false);
    } finally {
      if (outputPath) rmSync(outputPath, { force: true });
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
