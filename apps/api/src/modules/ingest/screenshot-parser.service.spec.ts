import axios from 'axios';
import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { ScreenshotParserService } from './screenshot-parser.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

describe('ScreenshotParserService', () => {
  const mockedAxios = axios as jest.Mocked<typeof axios>;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_VISION_MODEL;
  const originalPreprocess = process.env.OPENAI_VISION_PREPROCESS;
  const originalEnhancedVariants = process.env.OPENAI_VISION_ENHANCED_VARIANTS;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_VISION_MODEL = 'gpt-4.1-mini';
    process.env.OPENAI_VISION_PREPROCESS = '0';
    mockedAxios.post.mockReset();
    mockedAxios.get.mockReset();
  });

  afterAll(() => {
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_VISION_MODEL = originalModel;
    process.env.OPENAI_VISION_PREPROCESS = originalPreprocess;
    process.env.OPENAI_VISION_ENHANCED_VARIANTS = originalEnhancedVariants;
  });

  it('trims parsed tags and coerces numeric fields', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        output_text:
          '[{"position":"2","tag":" pe ak y ","kills":"9"},{"position":1,"tag":" dxb ","kills":12}]',
      },
    } as never);
    const service = new ScreenshotParserService();

    await expect(
      service.parseScreenshot('https://example.com/result.png'),
    ).resolves.toEqual([
      {
        position: 1,
        tag: 'dxb',
        kills: 12,
        playerNames: [],
        players: [],
        slotNumber: null,
        confidence: null,
      },
      {
        position: 2,
        tag: 'pe ak y',
        kills: 9,
        playerNames: [],
        players: [],
        slotNumber: null,
        confidence: null,
      },
    ]);
  });

  it('parses visible player kill rows without inventing missing values', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        output_text:
          '[{"position":1,"tag":"DXB","kills":12,"playerNames":["DXB Rafi"],"players":[{"name":"DXB Rafi","kills":7},{"playerName":"DXB Sami","elims":"5"},{"name":"Unreadable"}]}]',
      },
    } as never);
    const service = new ScreenshotParserService();

    await expect(
      service.parseScreenshot('https://example.com/result.png'),
    ).resolves.toEqual([
      {
        position: 1,
        tag: 'DXB',
        kills: 12,
        playerNames: ['DXB Rafi', 'DXB Sami', 'Unreadable'],
        players: [
          { name: 'DXB Rafi', kills: 7 },
          { name: 'DXB Sami', kills: 5 },
        ],
        slotNumber: null,
        confidence: null,
      },
    ]);
  });

  it('derives unreadable team kills from complete visible player kills', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        output_text:
          '[{"position":4,"tag":"KH","kills":"unreadable","players":[{"name":"BetterCallAws","kills":6},{"name":"nemWILLIAM","kills":2},{"name":"KHshawi","kills":1},{"name":"KHclash","kills":0}]},{"position":5,"tag":"VSN","kills":"unknown","players":[{"name":"vsn TAL","kills":4},{"name":"missing kill"}]}]',
      },
    } as never);
    const service = new ScreenshotParserService();

    await expect(
      service.parseScreenshot('https://example.com/result.png'),
    ).resolves.toEqual([
      {
        position: 4,
        tag: 'KH',
        kills: 9,
        playerNames: ['BetterCallAws', 'nemWILLIAM', 'KHshawi', 'KHclash'],
        players: [
          { name: 'BetterCallAws', kills: 6 },
          { name: 'nemWILLIAM', kills: 2 },
          { name: 'KHshawi', kills: 1 },
          { name: 'KHclash', kills: 0 },
        ],
        slotNumber: null,
        confidence: null,
      },
      {
        position: 5,
        tag: 'VSN',
        kills: 0,
        playerNames: ['vsn TAL', 'missing kill'],
        players: [{ name: 'vsn TAL', kills: 4 }],
        slotNumber: null,
        confidence: 0.35,
        ocrIssues: ['KILLS_UNREADABLE'],
      },
    ]);
  });

  it('keeps valid rows when one AI result row is malformed', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        output_text:
          '[{"position":1,"tag":"DXB","kills":"12 kills"},{"position":"N/A","tag":"BAD","kills":4},{"position":"3rd","tag":"KDM","kills":"5 elims"}]',
      },
    } as never);
    const service = new ScreenshotParserService();

    await expect(
      service.parseScreenshot('https://example.com/result.png'),
    ).resolves.toEqual([
      {
        position: 1,
        tag: 'DXB',
        kills: 12,
        playerNames: [],
        players: [],
        slotNumber: null,
        confidence: null,
      },
      {
        position: 2,
        tag: 'BAD',
        kills: 4,
        playerNames: [],
        players: [],
        slotNumber: null,
        confidence: 0.35,
        ocrIssues: ['POSITION_UNREADABLE'],
      },
      {
        position: 3,
        tag: 'KDM',
        kills: 5,
        playerNames: [],
        players: [],
        slotNumber: null,
        confidence: null,
      },
    ]);
  });

  it('keeps partly unreadable AI rows for review', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        output_text:
          '[{"position":"N/A","tag":"DXB","kills":12},{"position":2,"tag":"KDM","kills":"many"}]',
      },
    } as never);
    const service = new ScreenshotParserService();

    await expect(
      service.parseScreenshot('https://example.com/result.png'),
    ).resolves.toEqual([
      {
        position: 1,
        tag: 'DXB',
        kills: 12,
        playerNames: [],
        players: [],
        slotNumber: null,
        confidence: 0.35,
        ocrIssues: ['POSITION_UNREADABLE'],
      },
      {
        position: 2,
        tag: 'KDM',
        kills: 0,
        playerNames: [],
        players: [],
        slotNumber: null,
        confidence: 0.35,
        ocrIssues: ['KILLS_UNREADABLE'],
      },
    ]);
  });

  it('merges multi-image result screenshots by placement', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({
        data: {
          output_text:
            '[{"position":1,"tag":"SS","kills":10,"playerNames":["SS Chalos"],"players":[{"name":"SS Chalos","kills":6}],"confidence":0.75},{"position":2,"tag":"ING","kills":6,"playerNames":["ING Wolf"],"confidence":0.7}]',
        },
      } as never)
      .mockResolvedValueOnce({
        data: {
          output_text:
            '[{"position":2,"tag":"ING","kills":6,"playerNames":["ING Wolf","ING Night"],"players":[{"name":"ING Wolf","kills":4},{"name":"ING Night","kills":2}],"confidence":0.95},{"position":3,"tag":"KDM","kills":5,"confidence":0.9}]',
        },
      } as never);
    const service = new ScreenshotParserService();

    await expect(
      service.parseScreenshots([
        'https://example.com/result-1.png',
        'https://example.com/result-2.png',
      ]),
    ).resolves.toEqual([
      {
        position: 1,
        tag: 'SS',
        kills: 10,
        playerNames: ['SS Chalos'],
        players: [{ name: 'SS Chalos', kills: 6 }],
        slotNumber: null,
        confidence: 0.75,
      },
      {
        position: 2,
        tag: 'ING',
        kills: 6,
        playerNames: ['ING Wolf', 'ING Night'],
        players: [
          { name: 'ING Wolf', kills: 4 },
          { name: 'ING Night', kills: 2 },
        ],
        slotNumber: null,
        confidence: 0.95,
      },
      {
        position: 3,
        tag: 'KDM',
        kills: 5,
        playerNames: [],
        players: [],
        slotNumber: null,
        confidence: 0.9,
      },
    ]);
  });

  it('rejects parser rows with tags over the maximum length', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        output_text: '[{"position":1,"tag":"1234567890123456","kills":4}]',
      },
    } as never);
    const service = new ScreenshotParserService();

    await expect(
      service.parseScreenshot('https://example.com/result.png'),
    ).rejects.toThrow(BadRequestException);
  });

  it('sends original, enhanced, high-contrast, and row-crop images to vision when preprocessing is enabled', async () => {
    process.env.OPENAI_VISION_PREPROCESS = '1';
    process.env.OPENAI_VISION_ENHANCED_VARIANTS = '1';
    const width = 1000;
    const height = 800;
    const channels = 3;
    const pixels = Buffer.alloc(width * height * channels);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * channels;
        pixels[offset] = (x + y) % 256;
        pixels[offset + 1] = (y * 3) % 256;
        pixels[offset + 2] = (x * 2) % 256;
      }
    }
    const source = await sharp(pixels, {
      raw: { width, height, channels },
    })
      .png()
      .toBuffer();
    mockedAxios.get.mockResolvedValue({
      data: source,
    } as never);
    mockedAxios.post.mockResolvedValue({
      data: {
        output_text: '[{"position":1,"tag":"DXB","kills":12}]',
      },
    } as never);
    const service = new ScreenshotParserService();

    await service.parseScreenshot('https://example.com/result.png');

    const requestBody = mockedAxios.post.mock.calls[0][1] as {
      input: Array<{
        content: Array<{ type: string; image_url?: string }>;
      }>;
    };
    const images = requestBody.input[0].content.filter(
      (entry) => entry.type === 'input_image',
    );
    expect(images).toHaveLength(6);
    expect(images[0].image_url).toBe('https://example.com/result.png');
    expect(
      images
        .slice(1)
        .every((image) =>
          image.image_url?.startsWith('data:image/jpeg;base64,'),
        ),
    ).toBe(true);
  });

  it('parses slot/player screenshots for match mapping', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        output_text:
          '[{"slotNumber":7,"tag":"DXB","playerNames":["DXB Rafi","DXB Sami"],"confidence":0.91}]',
      },
    } as never);
    const service = new ScreenshotParserService();

    await expect(
      service.parseSlotMapScreenshot('https://example.com/slots.png'),
    ).resolves.toEqual([
      {
        slotNumber: 7,
        tag: 'DXB',
        playerNames: ['DXB Rafi', 'DXB Sami'],
        confidence: 0.91,
      },
    ]);
  });
});
