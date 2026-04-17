import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import axios from 'axios';
import {
  normalizeTeamTag,
  validateNormalizedTeamTag,
} from '../../common/team-tag.util';

export type ParsedScreenshotRow = {
  position: number;
  tag: string;
  kills: number;
};

export const SCREENSHOT_OCR_PROMPT = [
  'Extract battle royale team leaderboard rows from this screenshot.',
  'Return only a JSON array.',
  'For each detected team row return exactly:',
  '- position: integer team placement/rank',
  '- tag: short team tag/prefix only',
  '- kills: integer team kills',
  'Ignore full team names, player names, headers, totals, icons, and UI noise.',
  'Do not invent unreadable tags.',
  'If a row is unclear, omit it.',
  'Return strict JSON only with no markdown or commentary.',
  'Example: [{"position":1,"tag":"DXB","kills":12}]',
].join('\n');

type ResponsesApiResponse = {
  output_text?: string | null;
  output?: Array<{
    content?: Array<{
      text?: string | { value?: string | null } | null;
    }> | null;
  }> | null;
};

@Injectable()
export class ScreenshotParserService {
  private readonly logger = new Logger(ScreenshotParserService.name);
  private readonly endpoint = 'https://api.openai.com/v1/responses';

  private getApiKey(): string {
    const apiKey = process.env.OPENAI_API_KEY?.trim() ?? '';
    if (!apiKey) {
      throw new BadRequestException('OPENAI_API_KEY is not configured');
    }
    return apiKey;
  }

  private getModel(): string {
    return process.env.OPENAI_VISION_MODEL?.trim() || 'gpt-4.1-mini';
  }

  private extractOutputText(response: ResponsesApiResponse): string {
    if (
      typeof response.output_text === 'string' &&
      response.output_text.trim()
    ) {
      return response.output_text.trim();
    }

    const chunks: string[] = [];
    for (const item of response.output ?? []) {
      for (const content of item.content ?? []) {
        if (typeof content?.text === 'string' && content.text.trim()) {
          chunks.push(content.text.trim());
          continue;
        }
        const value =
          content?.text &&
          typeof content.text === 'object' &&
          typeof content.text.value === 'string'
            ? content.text.value.trim()
            : '';
        if (value) {
          chunks.push(value);
        }
      }
    }

    return chunks.join('\n').trim();
  }

  private stripCodeFence(value: string): string {
    return value
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  }

  private normalizeRow(row: unknown): ParsedScreenshotRow {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new BadRequestException(
        'Screenshot parser returned a non-object row',
      );
    }

    const raw = row as {
      position?: unknown;
      tag?: unknown;
      kills?: unknown;
    };
    const position = Number(raw.position);
    const kills = Number(raw.kills);
    const rawTag =
      typeof raw.tag === 'string'
        ? raw.tag
        : typeof raw.tag === 'number' || typeof raw.tag === 'boolean'
          ? String(raw.tag)
          : '';
    const tag = normalizeTeamTag(rawTag);

    if (!Number.isInteger(position) || position < 1) {
      throw new BadRequestException(
        'Screenshot parser returned an invalid position',
      );
    }
    if (!Number.isInteger(kills) || kills < 0) {
      throw new BadRequestException(
        'Screenshot parser returned an invalid kills value',
      );
    }
    if (!tag) {
      throw new BadRequestException(
        'Screenshot parser returned an empty team tag',
      );
    }

    const tagError = validateNormalizedTeamTag(tag);
    if (tagError) {
      throw new BadRequestException(
        `Screenshot parser returned invalid tag "${tag}": ${tagError}`,
      );
    }

    return {
      position,
      tag,
      kills,
    };
  }

  async parseScreenshot(imageUrl: string): Promise<ParsedScreenshotRow[]> {
    let responseData: ResponsesApiResponse;

    try {
      const response = await axios.post<ResponsesApiResponse>(
        this.endpoint,
        {
          model: this.getModel(),
          input: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: SCREENSHOT_OCR_PROMPT,
                },
                {
                  type: 'input_image',
                  image_url: imageUrl,
                },
              ],
            },
          ],
          max_output_tokens: 800,
        },
        {
          headers: {
            Authorization: `Bearer ${this.getApiKey()}`,
            'Content-Type': 'application/json',
          },
          timeout: 45_000,
        },
      );
      responseData = response.data;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'unknown parser error';
      this.logger.warn(`Screenshot OCR request failed: ${message}`);
      throw new BadGatewayException('Screenshot OCR request failed');
    }

    const output = this.stripCodeFence(this.extractOutputText(responseData));
    if (!output) {
      throw new BadRequestException(
        'Screenshot parser returned an empty response',
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch {
      this.logger.warn(`Screenshot parser returned non-JSON output: ${output}`);
      throw new BadRequestException('Screenshot parser returned invalid JSON');
    }

    if (!Array.isArray(parsed)) {
      throw new BadRequestException(
        'Screenshot parser must return a JSON array',
      );
    }

    const rows = parsed.map((row) => this.normalizeRow(row));
    if (!rows.length) {
      throw new BadRequestException(
        'Screenshot parser did not detect any team rows',
      );
    }

    return rows.sort((left, right) => left.position - right.position);
  }
}
