import { rmSync } from 'fs';
import { dirname } from 'path';
import axios from 'axios';
import sharp from 'sharp';
import {
  resolveAssetBaseUrlForStorage,
  storePlayerPhotoProcessed,
} from './asset.util';

jest.mock('axios');

const mockedAxiosPost = jest.mocked(axios.post);

async function visibleAlphaBounds(filePath: string) {
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * info.channels + 3];
      if (alpha <= 10) {
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
    bottomPadding: info.height - 1 - bottom,
  };
}

describe('asset.util', () => {
  const originalMediaAiUrl = process.env.MEDIA_AI_URL;

  beforeEach(() => {
    mockedAxiosPost.mockReset();
    delete process.env.MEDIA_AI_URL;
  });

  afterAll(() => {
    process.env.MEDIA_AI_URL = originalMediaAiUrl;
  });

  it('stores relative media paths when only localhost api bases are configured', () => {
    expect(
      resolveAssetBaseUrlForStorage({
        API_BASE_URL: 'http://localhost:3000',
      } as NodeJS.ProcessEnv),
    ).toBe('');

    expect(
      resolveAssetBaseUrlForStorage({
        API_PUBLIC_URL: '127.0.0.1:3000',
      } as NodeJS.ProcessEnv),
    ).toBe('');
  });

  it('keeps a public api origin when one is configured', () => {
    expect(
      resolveAssetBaseUrlForStorage({
        API_PUBLIC_URL: 'https://api.arenzyra.com/',
      } as NodeJS.ProcessEnv),
    ).toBe('https://api.arenzyra.com');

    expect(
      resolveAssetBaseUrlForStorage({
        ASSET_BASE_URL: 'api.arenzyra.com',
      } as NodeJS.ProcessEnv),
    ).toBe('https://api.arenzyra.com');
  });

  it('uses Media AI person cutout before resizing player photos', async () => {
    process.env.MEDIA_AI_URL = 'http://media-ai.test';
    const playerId = 'test-player-ai-photo';
    let filePath: string | null = null;
    const source = await sharp({
      create: {
        width: 120,
        height: 120,
        channels: 3,
        background: '#dddddd',
      },
    })
      .png()
      .toBuffer();
    const personLayer = await sharp({
      create: {
        width: 48,
        height: 82,
        channels: 4,
        background: { r: 20, g: 70, b: 160, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const aiCutout = await sharp({
      create: {
        width: 120,
        height: 120,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: personLayer, left: 36, top: 20 }])
      .png()
      .toBuffer();
    mockedAxiosPost.mockResolvedValue({ data: aiCutout } as never);

    try {
      const result = await storePlayerPhotoProcessed(playerId, {
        buffer: source,
        mimetype: 'image/png',
      });
      filePath = result.filePath;
      const metadata = await sharp(filePath).metadata();

      expect(mockedAxiosPost).toHaveBeenCalledWith(
        'http://media-ai.test/remove-bg',
        expect.anything(),
        expect.objectContaining({ responseType: 'arraybuffer' }),
      );
      expect(metadata.width).toBe(448);
      expect(metadata.height).toBe(557);
      expect(metadata.format).toBe('png');
      expect(await visibleAlphaBounds(filePath)).toEqual(
        expect.objectContaining({
          height: 549,
          bottomPadding: 0,
        }),
      );
    } finally {
      if (filePath) {
        rmSync(dirname(filePath), { recursive: true, force: true });
      }
    }
  });

  it('falls back to local edge removal when Media AI is not configured', async () => {
    const playerId = 'test-player-fallback-photo';
    let filePath: string | null = null;
    const subject = await sharp({
      create: {
        width: 50,
        height: 80,
        channels: 4,
        background: { r: 220, g: 20, b: 40, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const source = await sharp({
      create: {
        width: 120,
        height: 140,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .composite([{ input: subject, left: 35, top: 35 }])
      .png()
      .toBuffer();

    try {
      const result = await storePlayerPhotoProcessed(playerId, {
        buffer: source,
        mimetype: 'image/png',
      });
      filePath = result.filePath;
      const metadata = await sharp(filePath).metadata();

      expect(mockedAxiosPost).not.toHaveBeenCalled();
      expect(metadata.width).toBe(448);
      expect(metadata.height).toBe(557);
      expect(await visibleAlphaBounds(filePath)).toEqual(
        expect.objectContaining({
          height: 549,
          bottomPadding: 0,
        }),
      );
    } finally {
      if (filePath) {
        rmSync(dirname(filePath), { recursive: true, force: true });
      }
    }
  });
});
