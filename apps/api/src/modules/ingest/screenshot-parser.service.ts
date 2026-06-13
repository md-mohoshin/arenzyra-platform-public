import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import axios from 'axios';
import sharp from 'sharp';
import Tesseract from 'tesseract.js';
import {
  normalizeTeamTag,
  validateNormalizedTeamTag,
} from '../../common/team-tag.util';

export type ParsedScreenshotPlayer = {
  name: string;
  kills: number;
};

export type ParsedScreenshotRow = {
  position: number;
  tag: string | null;
  kills: number;
  playerNames: string[];
  players: ParsedScreenshotPlayer[];
  slotNumber: number | null;
  confidence: number | null;
  ocrIssues?: string[];
};

export type ParsedSlotMapRow = {
  slotNumber: number;
  tag: string | null;
  playerNames: string[];
  confidence: number | null;
};

export const SCREENSHOT_OCR_PROMPT = [
  'Extract battle royale final team result rows from this screenshot.',
  'Read every visible placement panel in the image, including separate winner/champion/left-side panels.',
  'The same screenshot may be provided more than once in original/enhanced form. Use the clearest version and do not duplicate rows.',
  'Some inputs may be high-contrast or row-band crops of the same screenshot. Use those variants to recover blurry tags, kills, slot numbers, and player rows, but still return each visible team only once.',
  'If rank 1 is shown with a champion medal instead of a printed "1", return it as position: 1.',
  'If a screenshot shows repeated left-side winner/top-team panels plus a right-side ranked list, extract both sides.',
  'PUBG result detail screens may show a team only through player-name prefixes such as "KKRメMOMO", "HPx NAME", "MVP义NAME", "NC|NAME", or "rs¹NAME". When multiple players in the same placement share a prefix, return that prefix as tag.',
  'Normalize obvious visual OCR variants in the tag only when the prefix is clear, for example HPx as HPX, AØN/AON/A0N as AON, NC as NC, and rs¹/rs1 as RSX when the prefix is visibly the team prefix.',
  'Return only a JSON array.',
  'For each detected team row return exactly:',
  '- position: integer team placement/rank, or null only when the visible row placement is unreadable',
  '- tag: short team tag/prefix if visible, otherwise null',
  '- kills: integer team kills/eliminations, or null only when unreadable',
  '- playerNames: array of visible player names from that row, empty array if none',
  '- players: array of objects with name and kills for visible player kill rows only',
  '- slotNumber: integer only when the row explicitly shows an in-game team/slot number, otherwise null',
  '- confidence: number from 0 to 1 for row readability',
  'Do not use placement/rank as slotNumber.',
  'Ignore headers, totals, icons, ads, and UI noise.',
  'Only include players when both the player name and individual player kills are visible and confidently paired.',
  'Do not estimate player kills from the team total. If individual player kills are not visible, return players: [].',
  'Do not invent unreadable tags, player names, slot numbers, or kills.',
  'If a visible team row is partly unclear but has any team tag, player name, slot number, or kills evidence, include it with null unreadable fields and confidence below 0.5.',
  'Only omit a visible row when it has no readable team or kill evidence at all.',
  'Return strict JSON only with no markdown or commentary.',
  'Example: [{"position":1,"tag":"DXB","kills":12,"playerNames":["DXB Rafi","DXB Sami"],"players":[{"name":"DXB Rafi","kills":7},{"name":"DXB Sami","kills":5}],"slotNumber":null,"confidence":0.92}]',
].join('\n');

export const SLOT_MAP_OCR_PROMPT = [
  'Extract in-game battle royale slot/team mapping rows from this screenshot.',
  'This screenshot is from the match start or team/player slot list, not the final result screen.',
  'Return only a JSON array.',
  'For each occupied slot return exactly:',
  '- slotNumber: integer in-game team/slot number',
  '- tag: short team tag/prefix if visible or repeated in player names, otherwise null',
  '- playerNames: array of visible player names in that slot/team',
  '- confidence: number from 0 to 1 for row readability',
  'Do not use row order as slotNumber unless a visible slot/team number is printed.',
  'Ignore empty slots, headers, spectators, totals, icons, and UI noise.',
  'Do not invent unreadable player names or slot numbers.',
  'Return strict JSON only with no markdown or commentary.',
  'Example: [{"slotNumber":7,"tag":"DXB","playerNames":["DXB Rafi","DXB Sami","DXB Roni"],"confidence":0.91}]',
].join('\n');

type ResponsesApiResponse = {
  output_text?: string | null;
  output?: Array<{
    content?: Array<{
      text?: string | { value?: string | null } | null;
    }> | null;
  }> | null;
};

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

type RawResultRow = {
  position?: unknown;
  tag?: unknown;
  kills?: unknown;
  playerNames?: unknown;
  players?: unknown;
  playerKills?: unknown;
  playerResults?: unknown;
  slotNumber?: unknown;
  confidence?: unknown;
};

type RawSlotMapRow = {
  slotNumber?: unknown;
  slot?: unknown;
  teamNumber?: unknown;
  tag?: unknown;
  playerNames?: unknown;
  players?: unknown;
  confidence?: unknown;
};

type BasicOcrLine = {
  text: string;
  confidence: number | null;
  y: number;
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

  private getImageDetail(): 'low' | 'high' | 'auto' {
    const value = (process.env.OPENAI_VISION_DETAIL ?? 'high')
      .trim()
      .toLowerCase();
    if (value === 'low' || value === 'auto') {
      return value;
    }
    return 'high';
  }

  private getMaxImageEdge(): number {
    const parsed = Number(process.env.OPENAI_VISION_MAX_IMAGE_EDGE ?? 2048);
    if (!Number.isFinite(parsed) || parsed < 768) {
      return 2048;
    }
    return Math.min(4096, Math.floor(parsed));
  }

  private getJpegQuality(): number {
    const parsed = Number(process.env.OPENAI_VISION_IMAGE_QUALITY ?? 90);
    if (!Number.isFinite(parsed)) {
      return 90;
    }
    return Math.max(70, Math.min(95, Math.floor(parsed)));
  }

  private getMaxImageVariants(): number {
    const parsed = Number(process.env.OPENAI_VISION_MAX_IMAGE_VARIANTS ?? 6);
    if (!Number.isFinite(parsed)) {
      return 6;
    }
    return Math.max(2, Math.min(8, Math.floor(parsed)));
  }

  private getRowCropCount(): number {
    const parsed = Number(process.env.OPENAI_VISION_ROW_CROPS ?? 3);
    if (!Number.isFinite(parsed)) {
      return 3;
    }
    return Math.max(0, Math.min(4, Math.floor(parsed)));
  }

  private shouldPreprocessImages(): boolean {
    const value = process.env.OPENAI_VISION_PREPROCESS?.trim().toLowerCase();
    return value !== '0' && value !== 'false' && value !== 'no';
  }

  private basicOcrLanguage(): string {
    return process.env.BASIC_OCR_LANG?.trim() || 'eng';
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

  private readInteger(value: unknown): number | null {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(
              /^\s*#?\s*(\d+)(?:st|nd|rd|th)?\s*$/i.exec(value)?.[1] ?? NaN,
            )
          : NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  private readKills(value: unknown): number | null {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(
              /^\s*(\d+)(?:\s*(?:kills?|elims?|elim|eliminations?))?\s*$/i.exec(
                value,
              )?.[1] ?? NaN,
            )
          : NaN;
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  }

  private readConfidence(value: unknown): number | null {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return Math.max(0, Math.min(1, parsed));
  }

  private readTag(value: unknown): string | null {
    const raw =
      typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : '';
    const tag = normalizeTeamTag(raw);
    if (!tag) {
      return null;
    }

    const tagError = validateNormalizedTeamTag(tag);
    if (tagError) {
      throw new BadRequestException(
        `Screenshot parser returned invalid tag "${tag}": ${tagError}`,
      );
    }
    return tag;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private readPlayerName(value: unknown): string | null {
    let rawName: unknown = value;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = this.asRecord(value);
      rawName =
        record.name ??
        record.playerName ??
        record.ign ??
        record.nickname ??
        record.username ??
        '';
    }
    const name =
      typeof rawName === 'string'
        ? rawName.trim()
        : typeof rawName === 'number'
          ? String(rawName).trim()
          : '';
    if (!name || name.length > 80) {
      return null;
    }
    return name;
  }

  private addUniquePlayerName(names: string[], name: string) {
    if (
      !names.some((current) => current.toLowerCase() === name.toLowerCase())
    ) {
      names.push(name);
    }
  }

  private addUniquePlayer(
    players: ParsedScreenshotPlayer[],
    player: ParsedScreenshotPlayer,
  ) {
    const existing = players.find(
      (entry) => entry.name.toLowerCase() === player.name.toLowerCase(),
    );
    if (existing) {
      existing.kills = Math.max(existing.kills, player.kills);
      return;
    }
    players.push({ ...player });
  }

  private readPlayerNames(...values: unknown[]): string[] {
    const names: string[] = [];
    for (const value of values) {
      if (!Array.isArray(value)) {
        continue;
      }
      for (const entry of value) {
        const name = this.readPlayerName(entry);
        if (!name) {
          continue;
        }
        this.addUniquePlayerName(names, name);
      }
    }
    return names.slice(0, 8);
  }

  private readPlayers(...values: unknown[]): ParsedScreenshotPlayer[] {
    const players: ParsedScreenshotPlayer[] = [];
    const upsertPlayer = (name: string, kills: number) => {
      const existing = players.find(
        (player) => player.name.toLowerCase() === name.toLowerCase(),
      );
      if (existing) {
        existing.kills = Math.max(existing.kills, kills);
        return;
      }
      players.push({ name, kills });
    };

    for (const value of values) {
      if (Array.isArray(value)) {
        for (const entry of value) {
          const record = this.asRecord(entry);
          const name = this.readPlayerName(entry);
          const kills = this.readKills(
            record.kills ??
              record.kill ??
              record.eliminations ??
              record.elims ??
              record.elim ??
              record.killCount,
          );
          if (!name || kills === null) {
            continue;
          }
          upsertPlayer(name, kills);
        }
        continue;
      }

      const record = this.asRecord(value);
      for (const [rawName, rawKills] of Object.entries(record)) {
        const name = this.readPlayerName(rawName);
        const kills = this.readKills(rawKills);
        if (!name || kills === null) {
          continue;
        }
        upsertPlayer(name, kills);
      }
    }

    return players.slice(0, 8);
  }

  private playerKillTotalWhenComplete(
    parsedKills: number | null,
    playerNames: string[],
    players: ParsedScreenshotPlayer[],
  ): number | null {
    if (parsedKills !== null || !players.length) {
      return parsedKills;
    }

    const normalizedPlayerNames = playerNames.map((name) => name.toLowerCase());
    const playerKillNames = new Set(
      players.map((player) => player.name.toLowerCase()),
    );
    if (
      normalizedPlayerNames.length > 0 &&
      normalizedPlayerNames.some((name) => !playerKillNames.has(name))
    ) {
      return null;
    }

    return players.reduce((total, player) => total + player.kills, 0);
  }

  private normalizeResultRow(
    row: unknown,
    fallbackPosition: number,
  ): ParsedScreenshotRow {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new BadRequestException(
        'Screenshot parser returned a non-object row',
      );
    }

    const raw = row as RawResultRow;
    const parsedPosition = this.readInteger(raw.position);
    const parsedKills = this.readKills(raw.kills);
    const tag = this.readTag(raw.tag);
    const players = this.readPlayers(
      raw.players,
      raw.playerKills,
      raw.playerResults,
    );
    const playerNames = this.readPlayerNames(
      raw.playerNames,
      raw.players,
      players.map((player) => player.name),
    );
    const slotNumber = this.readInteger(raw.slotNumber);
    const kills = this.playerKillTotalWhenComplete(
      parsedKills,
      playerNames,
      players,
    );
    let confidence = this.readConfidence(raw.confidence);
    const ocrIssues: string[] = [];

    if (!parsedPosition) {
      ocrIssues.push('POSITION_UNREADABLE');
    }
    if (kills === null) {
      ocrIssues.push('KILLS_UNREADABLE');
    }
    if (!tag && !playerNames.length && !slotNumber) {
      throw new BadRequestException(
        'Screenshot parser returned a row without team evidence',
      );
    }
    if (ocrIssues.length) {
      confidence =
        Math.min(
          confidence ?? 0.35,
          parsedPosition && parsedKills !== null ? 1 : 0.49,
        ) || 0.35;
    }

    return {
      position: parsedPosition ?? fallbackPosition,
      tag,
      kills: kills ?? 0,
      playerNames,
      players,
      slotNumber,
      confidence,
      ...(ocrIssues.length ? { ocrIssues } : {}),
    };
  }

  private parserErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown parser error';
  }

  private normalizeResultRows(rows: unknown[]): ParsedScreenshotRow[] {
    const normalized: ParsedScreenshotRow[] = [];

    rows.forEach((row, index) => {
      try {
        normalized.push(this.normalizeResultRow(row, index + 1));
      } catch (error) {
        this.logger.warn(
          `Skipping invalid result OCR row ${index + 1}: ${this.parserErrorMessage(
            error,
          )}`,
        );
      }
    });

    return normalized;
  }

  private normalizeSlotMapRow(row: unknown): ParsedSlotMapRow {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new BadRequestException(
        'Screenshot parser returned a non-object slot row',
      );
    }

    const raw = row as RawSlotMapRow;
    const slotNumber =
      this.readInteger(raw.slotNumber) ??
      this.readInteger(raw.teamNumber) ??
      this.readInteger(raw.slot);
    const tag = this.readTag(raw.tag);
    const playerNames = this.readPlayerNames(raw.playerNames, raw.players);
    const confidence = this.readConfidence(raw.confidence);

    if (!slotNumber) {
      throw new BadRequestException(
        'Screenshot parser returned an invalid slot number',
      );
    }
    if (!tag && !playerNames.length) {
      throw new BadRequestException(
        'Screenshot parser returned a slot row without player or tag evidence',
      );
    }

    return {
      slotNumber,
      tag,
      playerNames,
      confidence,
    };
  }

  private shouldUseEnhancedImageVariants(): boolean {
    const value =
      process.env.OPENAI_VISION_ENHANCED_VARIANTS?.trim().toLowerCase();
    return value !== '0' && value !== 'false' && value !== 'no';
  }

  private async encodeJpegVariant(image: sharp.Sharp): Promise<string> {
    const output = await image
      .jpeg({
        quality: this.getJpegQuality(),
        mozjpeg: true,
      })
      .toBuffer();
    return `data:image/jpeg;base64,${output.toString('base64')}`;
  }

  private resultRowCropBounds(width: number, height: number) {
    if (width < 640 || height < 420) {
      return [];
    }

    const count = this.getRowCropCount();
    if (count <= 0) {
      return [];
    }

    const candidates = [
      { topRatio: 0.02, heightRatio: 0.52 },
      { topRatio: 0.28, heightRatio: 0.52 },
      { topRatio: 0.52, heightRatio: 0.46 },
      { topRatio: 0.12, heightRatio: 0.76 },
    ];

    return candidates.slice(0, count).map(({ topRatio, heightRatio }) => {
      const top = Math.max(
        0,
        Math.min(height - 1, Math.round(height * topRatio)),
      );
      const cropHeight = Math.max(
        120,
        Math.min(height - top, Math.round(height * heightRatio)),
      );
      return {
        left: 0,
        top,
        width,
        height: cropHeight,
      };
    });
  }

  private uniqueImageInputs(inputs: string[]): string[] {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const input of inputs) {
      const key = `${input.length}:${input.slice(0, 96)}:${input.slice(-96)}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      unique.push(input);
    }
    return unique;
  }

  private async prepareImageInputs(imageUrl: string): Promise<string[]> {
    if (!this.shouldPreprocessImages() || imageUrl.startsWith('data:')) {
      return [imageUrl];
    }

    try {
      const response = await axios.get<ArrayBuffer>(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 30_000,
        maxContentLength: 12 * 1024 * 1024,
        headers: { Accept: 'image/png,image/jpeg,image/webp,image/*' },
      });
      const source = await sharp(Buffer.from(response.data), {
        limitInputPixels: 80_000_000,
        failOn: 'none',
      })
        .rotate()
        .toBuffer();
      const metadata = await sharp(source, { limitInputPixels: 80_000_000 })
        .metadata()
        .catch(() => null);
      const width = metadata?.width ?? 0;
      const height = metadata?.height ?? 0;
      const maxDimension = Math.max(
        metadata?.width ?? 0,
        metadata?.height ?? 0,
      );
      const targetEdge =
        maxDimension > 0 && maxDimension < 1800
          ? Math.min(this.getMaxImageEdge(), 1800)
          : this.getMaxImageEdge();

      const variants: string[] = [imageUrl];
      const enhanced = await this.encodeJpegVariant(
        sharp(source, { limitInputPixels: 80_000_000, failOn: 'none' })
          .resize({
            width: targetEdge,
            height: targetEdge,
            fit: 'inside',
            withoutEnlargement: maxDimension >= targetEdge,
          })
          .median(1)
          .normalise()
          .modulate({ brightness: 1.04, saturation: 0.9 })
          .sharpen({ sigma: 0.9, m1: 1.2, m2: 1.8 }),
      );
      variants.push(enhanced);

      const highContrast = await this.encodeJpegVariant(
        sharp(source, { limitInputPixels: 80_000_000, failOn: 'none' })
          .resize({
            width: targetEdge,
            height: targetEdge,
            fit: 'inside',
            withoutEnlargement: maxDimension >= targetEdge,
          })
          .grayscale()
          .normalise()
          .linear(1.18, -10)
          .sharpen({ sigma: 1.05, m1: 1.4, m2: 2.1 }),
      );
      variants.push(highContrast);

      for (const bounds of this.resultRowCropBounds(width, height)) {
        const crop = await this.encodeJpegVariant(
          sharp(source, { limitInputPixels: 80_000_000, failOn: 'none' })
            .extract(bounds)
            .resize({
              width: targetEdge,
              height: targetEdge,
              fit: 'inside',
              withoutEnlargement: false,
            })
            .median(1)
            .normalise()
            .modulate({ brightness: 1.06, saturation: 0.85 })
            .sharpen({ sigma: 1.05, m1: 1.4, m2: 2.2 }),
        );
        variants.push(crop);
      }

      const uniqueVariants = this.uniqueImageInputs(variants).slice(
        0,
        this.getMaxImageVariants(),
      );

      this.logger.debug(
        `Prepared ${uniqueVariants.length} OCR image variant(s) for screenshot`,
      );

      if (!this.shouldUseEnhancedImageVariants()) {
        return [uniqueVariants[1] ?? uniqueVariants[0]];
      }

      return uniqueVariants;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'unknown preprocessing error';
      this.logger.warn(
        `Screenshot preprocessing failed; falling back to original URL: ${message}`,
      );
      return [imageUrl];
    }
  }

  private async prepareBasicOcrImage(imageUrl: string): Promise<Buffer> {
    const response = await axios.get<ArrayBuffer>(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30_000,
      maxContentLength: 12 * 1024 * 1024,
      headers: { Accept: 'image/png,image/jpeg,image/webp,image/*' },
    });
    const source = Buffer.from(response.data);
    const metadata = await sharp(source, { limitInputPixels: 80_000_000 })
      .metadata()
      .catch(() => null);
    const maxDimension = Math.max(metadata?.width ?? 0, metadata?.height ?? 0);
    const resizeEdge = maxDimension > 0 && maxDimension < 1600 ? 1600 : 2200;

    return sharp(source, { limitInputPixels: 80_000_000 })
      .rotate()
      .resize({
        width: resizeEdge,
        height: resizeEdge,
        fit: 'inside',
        withoutEnlargement: maxDimension >= 1600,
      })
      .grayscale()
      .normalise()
      .linear(1.12, -6)
      .sharpen({ sigma: 0.9 })
      .png()
      .toBuffer();
  }

  private cleanBasicOcrLine(value: string): string {
    return value
      .replace(/[|]+/g, ' ')
      .replace(/[^\S\r\n]+/g, ' ')
      .trim();
  }

  private async readBasicOcrLines(imageUrl: string): Promise<BasicOcrLine[]> {
    try {
      const image = await this.prepareBasicOcrImage(imageUrl);
      const result = await Tesseract.recognize(image, this.basicOcrLanguage(), {
        cachePath: process.env.BASIC_OCR_CACHE_PATH?.trim() || '/tmp/tesseract',
        logger: () => undefined,
      });
      const page = result.data;
      const lines: BasicOcrLine[] = [];
      for (const block of page.blocks ?? []) {
        for (const paragraph of block.paragraphs ?? []) {
          for (const line of paragraph.lines ?? []) {
            const text = this.cleanBasicOcrLine(line.text ?? '');
            if (!text) {
              continue;
            }
            lines.push({
              text,
              confidence: Number.isFinite(line.confidence)
                ? Math.max(0, Math.min(1, line.confidence / 100))
                : null,
              y: line.bbox?.y0 ?? 0,
            });
          }
        }
      }
      if (!lines.length) {
        return (page.text ?? '')
          .split(/\r?\n/g)
          .map((line, index) => ({
            text: this.cleanBasicOcrLine(line),
            confidence: Number.isFinite(page.confidence)
              ? Math.max(0, Math.min(1, page.confidence / 100))
              : null,
            y: index,
          }))
          .filter((line) => line.text);
      }
      return lines.sort((left, right) => left.y - right.y);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'unknown basic OCR error';
      this.logger.warn(`Basic screenshot OCR failed: ${message}`);
      return [];
    }
  }

  private isBasicOcrHeader(line: string): boolean {
    return /\b(rank|team|name|wwcd|place|pts?|points|kills?|elim|total|logo|tl|kp|pp|tp)\b/i.test(
      line,
    );
  }

  private tokenLooksLikeTeamToken(token: string): boolean {
    return /[a-z]/i.test(token) && /[a-z0-9]/i.test(token);
  }

  private inferBasicTag(tokens: string[]): string | null {
    for (const token of tokens) {
      const cleaned = token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '');
      if (!cleaned || !this.tokenLooksLikeTeamToken(cleaned)) {
        continue;
      }
      try {
        const tag = this.readTag(cleaned);
        if (tag) {
          return tag;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  private parseBasicResultLine(line: BasicOcrLine): ParsedScreenshotRow | null {
    const text = this.cleanBasicOcrLine(line.text);
    if (!text || this.isBasicOcrHeader(text)) {
      return null;
    }

    const rankMatch = /^(?:#\s*)?(\d{1,2})\b/.exec(text);
    if (!rankMatch) {
      return null;
    }
    const position = this.readInteger(rankMatch[1]);
    if (!position || position > 100) {
      return null;
    }

    const rest = text.slice(rankMatch[0].length).trim();
    const tokens = rest.split(/\s+/g).filter(Boolean);
    const firstScoreIndex = tokens.findIndex((token) =>
      /^\d{1,3}$/.test(token),
    );
    if (firstScoreIndex <= 0) {
      return null;
    }

    const kills = this.readKills(tokens[firstScoreIndex]);
    const tag = this.inferBasicTag(tokens.slice(0, firstScoreIndex));
    if (
      kills === null ||
      (!tag && tokens.slice(0, firstScoreIndex).length < 1)
    ) {
      return null;
    }

    return {
      position,
      tag,
      kills,
      playerNames: [],
      players: [],
      slotNumber: null,
      confidence: line.confidence,
    };
  }

  private parseBasicSlotMapLine(line: BasicOcrLine): ParsedSlotMapRow | null {
    const text = this.cleanBasicOcrLine(line.text);
    if (!text || this.isBasicOcrHeader(text)) {
      return null;
    }

    const slotMatch = /^(?:#|slot|team)?\s*(\d{1,2})\b/i.exec(text);
    if (!slotMatch) {
      return null;
    }
    const slotNumber = this.readInteger(slotMatch[1]);
    if (!slotNumber || slotNumber > 100) {
      return null;
    }

    const rest = text.slice(slotMatch[0].length).trim();
    const tokens = rest.split(/\s+/g).filter(Boolean);
    const tag = this.inferBasicTag(tokens);
    const playerNames = tokens
      .filter((token) => this.tokenLooksLikeTeamToken(token))
      .map((token) => token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ''))
      .filter((token) => token.length >= 2)
      .slice(0, 8);
    if (!tag && !playerNames.length) {
      return null;
    }

    return {
      slotNumber,
      tag,
      playerNames,
      confidence: line.confidence,
    };
  }

  private mergeBasicRowsByNumber<T extends { confidence: number | null }>(
    rows: T[],
    numberOf: (row: T) => number,
  ): T[] {
    const merged = new Map<number, T>();
    for (const row of rows) {
      const key = numberOf(row);
      const existing = merged.get(key);
      if (!existing || (row.confidence ?? 0) > (existing.confidence ?? 0)) {
        merged.set(key, row);
      }
    }
    return [...merged.values()].sort(
      (left, right) => numberOf(left) - numberOf(right),
    );
  }

  private async callVisionJsonArray(
    imageUrl: string,
    prompt: string,
    maxOutputTokens: number,
  ): Promise<unknown[]> {
    let responseData: ResponsesApiResponse;

    try {
      const imageInputs = await this.prepareImageInputs(imageUrl);
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
                  text: prompt,
                },
                ...imageInputs.map((imageInput) => ({
                  type: 'input_image',
                  image_url: imageInput,
                  detail: this.getImageDetail(),
                })),
              ],
            },
          ],
          max_output_tokens: maxOutputTokens,
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

    if (!isUnknownArray(parsed)) {
      throw new BadRequestException(
        'Screenshot parser must return a JSON array',
      );
    }

    return parsed;
  }

  async parseScreenshot(imageUrl: string): Promise<ParsedScreenshotRow[]> {
    const parsed = await this.callVisionJsonArray(
      imageUrl,
      SCREENSHOT_OCR_PROMPT,
      3200,
    );
    const rows = this.normalizeResultRows(parsed);
    if (!rows.length) {
      throw new BadRequestException(
        'Screenshot parser did not detect any team rows',
      );
    }

    return rows.sort((left, right) => left.position - right.position);
  }

  async parseScreenshots(imageUrls: string[]): Promise<ParsedScreenshotRow[]> {
    const uniqueUrls = [
      ...new Set(imageUrls.map((url) => url.trim()).filter(Boolean)),
    ];
    if (!uniqueUrls.length) {
      throw new BadRequestException(
        'At least one screenshot image is required',
      );
    }

    const parsedResults = await Promise.allSettled(
      uniqueUrls.map((imageUrl) => this.parseScreenshot(imageUrl)),
    );
    const parsedGroups = parsedResults
      .filter(
        (result): result is PromiseFulfilledResult<ParsedScreenshotRow[]> =>
          result.status === 'fulfilled',
      )
      .map((result) => result.value);
    for (const result of parsedResults) {
      if (result.status === 'rejected') {
        const message =
          result.reason instanceof Error ? result.reason.message : 'unknown';
        this.logger.warn(`Skipping unreadable result screenshot: ${message}`);
      }
    }
    if (!parsedGroups.length) {
      throw new BadRequestException(
        'Screenshot parser did not detect any team rows',
      );
    }
    const merged = new Map<number, ParsedScreenshotRow>();
    const reviewOnlyRows: ParsedScreenshotRow[] = [];

    const rowScore = (row: ParsedScreenshotRow) =>
      (row.confidence ?? 0.5) * 100 +
      (row.tag ? 25 : 0) +
      row.players.length * 10 +
      row.playerNames.length * 4 +
      (row.slotNumber ? 5 : 0);

    const mergeRows = (
      existing: ParsedScreenshotRow,
      incoming: ParsedScreenshotRow,
    ): ParsedScreenshotRow => {
      const primary =
        rowScore(incoming) > rowScore(existing) ? incoming : existing;
      const secondary = primary === incoming ? existing : incoming;
      const playerNames = [...primary.playerNames];
      for (const name of secondary.playerNames) {
        this.addUniquePlayerName(playerNames, name);
      }

      const players: ParsedScreenshotPlayer[] = [];
      for (const player of primary.players) {
        this.addUniquePlayer(players, player);
      }
      for (const player of secondary.players) {
        this.addUniquePlayer(players, player);
      }

      return {
        position: primary.position,
        tag: primary.tag ?? secondary.tag,
        kills: primary.kills,
        playerNames: playerNames.slice(0, 8),
        players: players.slice(0, 8),
        slotNumber: primary.slotNumber ?? secondary.slotNumber,
        confidence:
          Math.max(primary.confidence ?? 0, secondary.confidence ?? 0) || null,
      };
    };

    for (const row of parsedGroups.flat()) {
      if (row.ocrIssues?.includes('POSITION_UNREADABLE')) {
        reviewOnlyRows.push(row);
        continue;
      }
      const existing = merged.get(row.position);
      merged.set(row.position, existing ? mergeRows(existing, row) : row);
    }

    return [...merged.values(), ...reviewOnlyRows].sort((left, right) => {
      if (left.position !== right.position) {
        return left.position - right.position;
      }
      const leftIssue = left.ocrIssues?.includes('POSITION_UNREADABLE') ? 1 : 0;
      const rightIssue = right.ocrIssues?.includes('POSITION_UNREADABLE')
        ? 1
        : 0;
      return leftIssue - rightIssue;
    });
  }

  async parseScreenshotBasic(imageUrl: string): Promise<ParsedScreenshotRow[]> {
    const lines = await this.readBasicOcrLines(imageUrl);
    return this.mergeBasicRowsByNumber(
      lines
        .map((line) => this.parseBasicResultLine(line))
        .filter((row): row is ParsedScreenshotRow => row !== null),
      (row) => row.position,
    );
  }

  async parseScreenshotsBasic(
    imageUrls: string[],
  ): Promise<ParsedScreenshotRow[]> {
    const uniqueUrls = [
      ...new Set(imageUrls.map((url) => url.trim()).filter(Boolean)),
    ];
    const parsedGroups = await Promise.all(
      uniqueUrls.map((imageUrl) => this.parseScreenshotBasic(imageUrl)),
    );
    return this.mergeBasicRowsByNumber(
      parsedGroups.flat(),
      (row) => row.position,
    );
  }

  async parseSlotMapScreenshot(imageUrl: string): Promise<ParsedSlotMapRow[]> {
    const parsed = await this.callVisionJsonArray(
      imageUrl,
      SLOT_MAP_OCR_PROMPT,
      1200,
    );
    const rows = parsed.map((row) => this.normalizeSlotMapRow(row));
    if (!rows.length) {
      throw new BadRequestException(
        'Screenshot parser did not detect any slot rows',
      );
    }

    return rows.sort((left, right) => left.slotNumber - right.slotNumber);
  }

  async parseSlotMapScreenshots(
    imageUrls: string[],
  ): Promise<ParsedSlotMapRow[]> {
    const uniqueUrls = [
      ...new Set(imageUrls.map((url) => url.trim()).filter(Boolean)),
    ];
    if (!uniqueUrls.length) {
      throw new BadRequestException(
        'At least one screenshot image is required',
      );
    }

    const parsedResults = await Promise.allSettled(
      uniqueUrls.map((imageUrl) => this.parseSlotMapScreenshot(imageUrl)),
    );
    const parsedGroups = parsedResults
      .filter(
        (result): result is PromiseFulfilledResult<ParsedSlotMapRow[]> =>
          result.status === 'fulfilled',
      )
      .map((result) => result.value);
    for (const result of parsedResults) {
      if (result.status === 'rejected') {
        const message =
          result.reason instanceof Error ? result.reason.message : 'unknown';
        this.logger.warn(`Skipping unreadable slot-map screenshot: ${message}`);
      }
    }
    if (!parsedGroups.length) {
      throw new BadRequestException(
        'Screenshot parser did not detect any slot rows',
      );
    }
    const merged = new Map<number, ParsedSlotMapRow>();

    const rowScore = (row: ParsedSlotMapRow) =>
      (row.confidence ?? 0.5) * 100 +
      (row.tag ? 20 : 0) +
      row.playerNames.length * 4;

    for (const row of parsedGroups.flat()) {
      const existing = merged.get(row.slotNumber);
      if (!existing || rowScore(row) > rowScore(existing)) {
        merged.set(row.slotNumber, { ...row });
        continue;
      }
      for (const name of row.playerNames) {
        this.addUniquePlayerName(existing.playerNames, name);
      }
      if (!existing.tag && row.tag) {
        existing.tag = row.tag;
      }
      existing.confidence =
        Math.max(existing.confidence ?? 0, row.confidence ?? 0) || null;
    }

    return [...merged.values()].sort(
      (left, right) => left.slotNumber - right.slotNumber,
    );
  }

  async parseSlotMapScreenshotBasic(
    imageUrl: string,
  ): Promise<ParsedSlotMapRow[]> {
    const lines = await this.readBasicOcrLines(imageUrl);
    return this.mergeBasicRowsByNumber(
      lines
        .map((line) => this.parseBasicSlotMapLine(line))
        .filter((row): row is ParsedSlotMapRow => row !== null),
      (row) => row.slotNumber,
    );
  }

  async parseSlotMapScreenshotsBasic(
    imageUrls: string[],
  ): Promise<ParsedSlotMapRow[]> {
    const uniqueUrls = [
      ...new Set(imageUrls.map((url) => url.trim()).filter(Boolean)),
    ];
    const parsedGroups = await Promise.all(
      uniqueUrls.map((imageUrl) => this.parseSlotMapScreenshotBasic(imageUrl)),
    );
    return this.mergeBasicRowsByNumber(
      parsedGroups.flat(),
      (row) => row.slotNumber,
    );
  }
}
