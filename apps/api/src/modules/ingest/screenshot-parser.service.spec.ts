import axios from 'axios';
import { BadRequestException } from '@nestjs/common';
import { ScreenshotParserService } from './screenshot-parser.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
  },
}));

describe('ScreenshotParserService', () => {
  const mockedAxios = axios as jest.Mocked<typeof axios>;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_VISION_MODEL;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_VISION_MODEL = 'gpt-4.1-mini';
    mockedAxios.post.mockReset();
  });

  afterAll(() => {
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_VISION_MODEL = originalModel;
  });

  it('normalizes parsed tags and coerces numeric fields', async () => {
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
      { position: 1, tag: 'DXB', kills: 12 },
      { position: 2, tag: 'PEAKY', kills: 9 },
    ]);
  });

  it('rejects invalid parser rows', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        output_text: '[{"position":1,"tag":"DX!","kills":4}]',
      },
    } as never);
    const service = new ScreenshotParserService();

    await expect(
      service.parseScreenshot('https://example.com/result.png'),
    ).rejects.toThrow(BadRequestException);
  });
});
