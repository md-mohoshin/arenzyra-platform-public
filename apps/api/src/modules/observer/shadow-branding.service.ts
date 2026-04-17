import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Prisma } from '@prisma/client';
import sharp from 'sharp';
import { PrismaService } from '../../db/prisma.service';
import { findMediaFile } from '../teams/asset.util';

const TOTAL_SLOTS = 25;
const DEFAULT_TEAM_NAME = 'Arenzyra';
const DEFAULT_TEAM_TAG = 'AZ';
const DEFAULT_TEAM_COLOR = { r: 255, g: 255, b: 255 } as const;
const DEFAULT_TEAM_LOGO_NAME = 'arenzyra-default.png';
const DEFAULT_SHADOW_LOGO_TEMPLATE = 'shadow-logo-template.svg';
const SHADOW_LOGO_FIT_RATIO = 0.88;
const PLACEHOLDER_LOGO_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axzwoAAAAASUVORK5CYII=';
const SHADOW_LOGO_VARIANTS = [
  { key: 'base', suffix: '', size: 256 },
  { key: 'size64', suffix: '_64', size: 64 },
  { key: 'size128', suffix: '_128', size: 128 },
  { key: 'size256', suffix: '_256', size: 256 },
] as const;

type BrandingTeam = {
  id: string;
  name: string | null;
  tag: string | null;
  logoUrl: string | null;
  accentLight: string | null;
  accentDark: string | null;
};

type ShadowBrandingLogoPaths = {
  base: string;
  size64: string;
  size128: string;
  size256: string;
};

type RgbColor = {
  r: number;
  g: number;
  b: number;
};

type HsvColor = {
  h: number;
  s: number;
  v: number;
};

type ShadowBrandingPalette = {
  team: RgbColor;
  player: RgbColor;
  teamHex: string;
  playerHex: string;
};

export type ShadowBrandingSlot = {
  id: string;
  matchId: string;
  slotNumber: number;
  teamId: string | null;
  lobbyStatus: string | null;
  playersInLobby: number | null;
  resolvedColor: string;
  playerColor: string;
  localLogoPath: string;
  logoPaths: ShadowBrandingLogoPaths;
  isDefaultBranding: boolean;
  team: BrandingTeam | null;
};

type SlotRow = Prisma.MatchSlotGetPayload<{
  include: { team: true };
}>;

@Injectable()
export class ShadowBrandingService {
  private readonly logger = new Logger(ShadowBrandingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async generateShadowBranding(matchId: string) {
    const normalizedMatchId = String(matchId || '').trim();
    if (!normalizedMatchId) {
      throw new NotFoundException('Match not found');
    }

    const match = await this.prisma.match.findFirst({
      where: { id: normalizedMatchId, deletedAt: null },
      select: { id: true },
    });
    if (!match) {
      throw new NotFoundException('Match not found');
    }

    const slots = await this.prisma.matchSlot.findMany({
      where: { matchId: match.id, deletedAt: null },
      include: { team: true },
      orderBy: { slotNumber: 'asc' },
    });

    const brandingConfigPath = this.getBrandingConfigPath();
    const teamAssetsDir = this.getTeamAssetsDir();
    await fs.mkdir(path.dirname(brandingConfigPath), { recursive: true });
    await fs.mkdir(teamAssetsDir, { recursive: true });

    const defaultLogoPath = await this.ensureDefaultTeamLogo(teamAssetsDir);
    const slotsByNumber = new Map<number, SlotRow>();
    for (const slot of slots) {
      if (
        Number.isFinite(slot.slotNumber) &&
        slot.slotNumber >= 1 &&
        slot.slotNumber <= TOTAL_SLOTS
      ) {
        slotsByNumber.set(slot.slotNumber, slot);
      }
    }

    const preparedSlots: ShadowBrandingSlot[] = [];
    const lines = [
      '[/Script/ShadowTrackerExtra.FCustomTeamLogoAndColor]',
      'EnableTeamLogoAndColor=1',
    ];

    for (let slotNumber = 1; slotNumber <= TOTAL_SLOTS; slotNumber += 1) {
      const slot = slotsByNumber.get(slotNumber) ?? null;
      const hasAssignedTeam = Boolean(slot?.team);
      const teamName = slot?.team?.name ?? DEFAULT_TEAM_NAME;
      const sourceLogoPath = await this.resolveSourceLogoPath(
        slot?.team ?? null,
      );
      const palette = await this.resolveSlotPalette(
        slot?.team ?? null,
        sourceLogoPath ?? defaultLogoPath,
      );
      const logoPaths = await this.prepareSlotLogoPaths(
        slotNumber,
        teamName,
        sourceLogoPath,
        defaultLogoPath,
        teamAssetsDir,
      );
      const localLogoPath = logoPaths.base;
      const shadowTeamName = this.toShadowTeamName(teamName, slotNumber);

      preparedSlots.push({
        id: String(slot?.id ?? `slot-${slotNumber}`),
        matchId: match.id,
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
        isDefaultBranding: !hasAssignedTeam,
        team: slot?.team
          ? {
              id: String(slot.team.id),
              name: slot.team.name ?? null,
              tag: slot.team.tag ?? null,
              logoUrl: slot.team.logoUrl ?? null,
              accentLight: slot.team.accentLight ?? palette.teamHex,
              accentDark: slot.team.accentDark ?? palette.playerHex,
            }
          : {
              id: `arenzyra-${slotNumber}`,
              name: DEFAULT_TEAM_NAME,
              tag: DEFAULT_TEAM_TAG,
              logoUrl: defaultLogoPath,
              accentLight: palette.teamHex,
              accentDark: palette.playerHex,
            },
      });

      lines.push(
        `TeamLogoAndColor=(TeamNo=${slotNumber},TeamName=${shadowTeamName},TeamLogoPath=${localLogoPath},KillInfoPath=${localLogoPath},TeamColorR=${palette.team.r},TeamColorG=${palette.team.g},TeamColorB=${palette.team.b},TeamColorA=255,PlayerColorR=${palette.player.r},PlayerColorG=${palette.player.g},PlayerColorB=${palette.player.b},PlayerColorA=255,CornerMarkPath=,fin)`,
      );
    }

    await fs.writeFile(brandingConfigPath, lines.join('\r\n'), 'utf8');
    this.logger.log(
      `[SHADOW_BRANDING] wrote ${preparedSlots.length} slots to ${brandingConfigPath} for match ${match.id}`,
    );
    this.logger.log(
      `[SHADOW_BRANDING] final file path written: ${brandingConfigPath}`,
    );

    return {
      ok: true,
      matchId: match.id,
      teamCount: preparedSlots.length,
      teamAssetsDir,
      brandingConfigPath,
      slots: preparedSlots,
    };
  }

  private getTeamAssetsDir() {
    return (
      process.env.ARENZYRA_OBSERVER_TEAM_ASSETS_DIR ||
      'C:\\ArenzyraObserver\\assets\\teams'
    );
  }

  private getBrandingConfigPath() {
    const localAppData =
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(
      localAppData,
      'ShadowTrackerExtra',
      'Saved',
      'TeamLogoAndColor.ini',
    );
  }

  private async ensureDefaultTeamLogo(teamAssetsDir: string) {
    const targetPath = path.join(teamAssetsDir, DEFAULT_TEAM_LOGO_NAME);
    const defaultSource = await this.resolveDefaultTeamLogoSource();

    try {
      if (defaultSource) {
        await this.renderLogoVariant(defaultSource, targetPath, 256);
      } else {
        await fs.writeFile(
          targetPath,
          Buffer.from(PLACEHOLDER_LOGO_BASE64, 'base64'),
        );
      }
      return targetPath;
    } catch {
      await fs.writeFile(
        targetPath,
        Buffer.from(PLACEHOLDER_LOGO_BASE64, 'base64'),
      );
      return targetPath;
    }
  }

  private async prepareSlotLogoPaths(
    slotNumber: number,
    teamName: string | null,
    sourceLogoPath: string | null,
    defaultLogoPath: string,
    teamAssetsDir: string,
  ): Promise<ShadowBrandingLogoPaths> {
    const targetStem = path.join(
      teamAssetsDir,
      this.buildShadowLogoBaseName(slotNumber),
    );
    const sourceCandidates = sourceLogoPath
      ? [sourceLogoPath, defaultLogoPath]
      : [defaultLogoPath];

    for (const candidate of sourceCandidates) {
      try {
        return await this.writeSlotLogoVariants(candidate, targetStem);
      } catch (error) {
        this.logger.warn(
          `[SHADOW_BRANDING] failed to render logo variants for slot ${slotNumber} (${teamName || DEFAULT_TEAM_NAME}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return await this.writeSlotLogoVariants(defaultLogoPath, targetStem, true);
  }

  private async resolveSlotPalette(
    team: SlotRow['team'] | null,
    sourceLogoPath: string,
  ): Promise<ShadowBrandingPalette> {
    const accentColor =
      this.parseHexColor(team?.accentLight) ??
      this.parseHexColor(team?.accentDark);
    const logoColor =
      accentColor ??
      (sourceLogoPath
        ? ((await this.extractAccentColor(sourceLogoPath)) ??
          (await this.extractDominantColor(sourceLogoPath)))
        : null) ??
      DEFAULT_TEAM_COLOR;
    const teamColor = this.normalizeTeamColor(logoColor);
    const playerColor = this.mixColors(teamColor, { r: 0, g: 0, b: 0 }, 0.24);

    return {
      team: teamColor,
      player: playerColor,
      teamHex: this.rgbToHex(teamColor),
      playerHex: this.rgbToHex(playerColor),
    };
  }

  private async resolveSourceLogoPath(team: SlotRow['team'] | null) {
    const directPath = String(team?.logoUrl || '').trim();
    if (
      directPath &&
      path.isAbsolute(directPath) &&
      (await this.pathExists(directPath))
    ) {
      return directPath;
    }

    if (team?.id) {
      const mediaPath = findMediaFile('team', team.id, 'logo');
      if (mediaPath && (await this.pathExists(mediaPath))) {
        return mediaPath;
      }
    }

    return null;
  }

  private parseHexColor(value: string | null | undefined): RgbColor | null {
    const normalized = String(value || '')
      .trim()
      .replace(/^#/, '');
    if (!normalized) {
      return null;
    }

    const hex =
      normalized.length === 3
        ? normalized
            .split('')
            .map((part) => `${part}${part}`)
            .join('')
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

  private async extractDominantColor(
    sourceLogoPath: string,
  ): Promise<RgbColor | null> {
    try {
      const stats = await sharp(sourceLogoPath)
        .trim()
        .resize(128, 128, { fit: 'inside' })
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

  private async extractAccentColor(
    sourceLogoPath: string,
  ): Promise<RgbColor | null> {
    try {
      const { data, info } = await sharp(sourceLogoPath)
        .ensureAlpha()
        .trim()
        .resize(96, 96, { fit: 'inside' })
        .raw()
        .toBuffer({ resolveWithObject: true });

      const channels = info.channels;
      const buckets = new Map<
        number,
        { weight: number; r: number; g: number; b: number }
      >();

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
        const hsv = this.rgbToHsv(color);

        if (hsv.s < 0.24 || hsv.v < 0.12) {
          continue;
        }

        const bucketId = this.getAccentBucketId(hsv);
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

      let winningBucket: {
        weight: number;
        r: number;
        g: number;
        b: number;
      } | null = null;
      for (const bucket of buckets.values()) {
        if (!winningBucket || bucket.weight > winningBucket.weight) {
          winningBucket = bucket;
        }
      }

      if (!winningBucket || winningBucket.weight <= 0) {
        return null;
      }

      return this.clampColor({
        r: winningBucket.r / winningBucket.weight,
        g: winningBucket.g / winningBucket.weight,
        b: winningBucket.b / winningBucket.weight,
      });
    } catch {
      return null;
    }
  }

  private rgbToHsv(color: RgbColor): HsvColor {
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

  private getAccentBucketId(color: HsvColor) {
    const hueBucket = Math.min(23, Math.floor(color.h / 15));
    const saturationBucket = color.s >= 0.55 ? 1 : 0;
    return hueBucket * 2 + saturationBucket;
  }

  private normalizeTeamColor(color: RgbColor): RgbColor {
    let normalized = this.clampColor(color);
    const luminance = this.relativeLuminance(normalized);

    if (luminance < 0.16) {
      normalized = this.mixColors(normalized, { r: 255, g: 255, b: 255 }, 0.35);
    } else if (luminance > 0.82) {
      normalized = this.mixColors(normalized, { r: 0, g: 0, b: 0 }, 0.18);
    }

    return this.clampColor(normalized);
  }

  private mixColors(
    base: RgbColor,
    target: RgbColor,
    amount: number,
  ): RgbColor {
    const ratio = Math.max(0, Math.min(1, amount));
    return this.clampColor({
      r: base.r + (target.r - base.r) * ratio,
      g: base.g + (target.g - base.g) * ratio,
      b: base.b + (target.b - base.b) * ratio,
    });
  }

  private clampColor(color: RgbColor): RgbColor {
    return {
      r: Math.max(0, Math.min(255, Math.round(color.r))),
      g: Math.max(0, Math.min(255, Math.round(color.g))),
      b: Math.max(0, Math.min(255, Math.round(color.b))),
    };
  }

  private rgbToHex(color: RgbColor) {
    return `#${[color.r, color.g, color.b]
      .map((part) => part.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()}`;
  }

  private relativeLuminance(color: RgbColor) {
    const convert = (value: number) => {
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

  private async resolveDefaultTeamLogoSource() {
    const candidates = [
      path.join(
        process.cwd(),
        'public',
        'assets',
        'defaults',
        'default-team.png',
      ),
      path.join(
        process.cwd(),
        'apps',
        'api',
        'public',
        'assets',
        'defaults',
        'default-team.png',
      ),
      path.join(
        __dirname,
        '..',
        '..',
        '..',
        'public',
        'assets',
        'defaults',
        'default-team.png',
      ),
    ];

    for (const candidate of candidates) {
      if (await this.pathExists(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private buildShadowLogoBaseName(slotNumber: number) {
    return String(slotNumber).padStart(3, '0');
  }

  private async writeSlotLogoVariants(
    sourceLogoPath: string,
    targetStem: string,
    usePlaceholder = false,
  ): Promise<ShadowBrandingLogoPaths> {
    const logoPaths = {} as ShadowBrandingLogoPaths;

    for (const variant of SHADOW_LOGO_VARIANTS) {
      const targetPath = `${targetStem}${variant.suffix}.png`;
      if (usePlaceholder) {
        await fs.writeFile(
          targetPath,
          Buffer.from(PLACEHOLDER_LOGO_BASE64, 'base64'),
        );
      } else {
        await this.renderLogoVariant(sourceLogoPath, targetPath, variant.size);
      }
      logoPaths[variant.key] = targetPath;
    }

    return logoPaths;
  }

  private async renderLogoVariant(
    sourceLogoPath: string,
    targetPath: string,
    size: number,
  ) {
    const templateBuffer = await this.resolveShadowLogoTemplate(size);
    const logoBuffer = await sharp(sourceLogoPath)
      .resize(
        Math.round(size * SHADOW_LOGO_FIT_RATIO),
        Math.round(size * SHADOW_LOGO_FIT_RATIO),
        {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      )
      .png()
      .toBuffer();

    let pipeline = sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    });

    if (templateBuffer) {
      pipeline = pipeline.composite([{ input: templateBuffer }]);
    }

    await pipeline
      .composite([{ input: logoBuffer, gravity: 'center' }])
      .png()
      .toFile(targetPath);
  }

  private async resolveShadowLogoTemplate(size: number) {
    const templatePath = await this.findShadowLogoTemplate();
    if (!templatePath) {
      return null;
    }

    return await sharp(templatePath)
      .resize(size, size, {
        fit: 'fill',
      })
      .png()
      .toBuffer();
  }

  private async findShadowLogoTemplate() {
    const candidates = [
      path.join(
        process.cwd(),
        'public',
        'assets',
        'defaults',
        DEFAULT_SHADOW_LOGO_TEMPLATE,
      ),
      path.join(
        process.cwd(),
        'apps',
        'api',
        'public',
        'assets',
        'defaults',
        DEFAULT_SHADOW_LOGO_TEMPLATE,
      ),
      path.join(
        __dirname,
        '..',
        '..',
        '..',
        'public',
        'assets',
        'defaults',
        DEFAULT_SHADOW_LOGO_TEMPLATE,
      ),
    ];

    for (const candidate of candidates) {
      if (await this.pathExists(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private toShadowTeamName(name: string | null, slotNumber: number) {
    const cleaned = String(name || DEFAULT_TEAM_NAME)
      .replace(/[,\r\n()]+/g, ' ')
      .replace(/\s+/g, '')
      .trim();
    return cleaned || `Arenzyra${slotNumber}`;
  }

  private async pathExists(targetPath: string) {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }
}
