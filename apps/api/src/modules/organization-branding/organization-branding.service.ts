import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { effectiveOrganizationId } from '../../common/org/org.util';
import type { Actor } from '../../common/auth/jwt.strategy';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import {
  DEFAULT_ADVANCED_BRANDING_CONFIG,
  DEFAULT_MINIMAL_BRANDING_CONFIG,
  DEFAULT_ORGANIZATION_BRANDING,
  type AdvancedBrandingConfig,
  type BrandingAuthoringMode,
  type MinimalBrandingConfig,
  type OrganizationBrandingDto,
  type SessionBrandingDto,
} from './organization-branding.constants';
import {
  OrganizationBrandingInputDto,
  SessionBrandingInputDto,
} from './dto/update-branding.dto';
import {
  DEFAULT_BRAND_INPUTS,
  generateBorderColor,
  generatePanelColor,
  generateSecondaryColor,
  generateTextPrimaryColor,
  generateTextMutedColor,
  generateBrandTokens,
  type BrandingMode,
  type BrandingInputs,
} from '../../common/branding/smart-brand-engine';

type BrandingRecord = {
  organizationId?: string | null;
  sessionId?: string | null;
  inheritOrganization?: boolean | null;
  mode?: string | null;
  widgetBackground?: string | null;
  backgroundSolid?: string | null;
  gradientStart?: string | null;
  gradientEnd?: string | null;
  gradientDirection?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accent?: string | null;
  liveColor?: string | null;
  textPrimary?: string | null;
  textMuted?: string | null;
  border?: string | null;
  panel?: string | null;
  shadow?: string | null;
  glowAccent?: string | null;
  badgeBg?: string | null;
  badgeText?: string | null;
  defaultTeamLogoUrl?: string | null;
  defaultPlayerPhotoUrl?: string | null;
  authoringMode?: string | null;
  minimalConfig?: unknown;
  advancedConfig?: unknown;
  [key: string]: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeAuthoringMode = (value: unknown): BrandingAuthoringMode =>
  value === 'advanced' ? 'advanced' : 'minimal';

const normalizeMode = (
  value: unknown,
  fallback: BrandingMode,
): BrandingMode => {
  if (value === 'solid' || value === 'gradient') {
    return value;
  }
  return fallback;
};

const normalizeDirection = (
  value: unknown,
  fallback: BrandingInputs['gradientDirection'],
): BrandingInputs['gradientDirection'] => {
  if (
    value === 'horizontal' ||
    value === 'vertical' ||
    value === 'diagonal' ||
    value === 'reverse-diagonal'
  ) {
    return value;
  }
  return fallback;
};

const pickString = (value: unknown, fallback: string) =>
  typeof value === 'string' && value.trim().length > 0 ? value : fallback;

const createAdvancedConfigFromBranding = (
  branding: OrganizationBrandingDto,
): AdvancedBrandingConfig => ({
  mode: branding.mode,
  primaryColor: branding.primaryColor,
  accent: branding.accent,
  liveColor: branding.liveColor,
  backgroundSolid: branding.backgroundSolid,
  gradientStart: branding.gradientStart,
  gradientEnd: branding.gradientEnd,
  gradientDirection: branding.gradientDirection,
  secondaryColor: branding.secondaryColor,
  textPrimary: branding.textPrimary,
  textMuted: branding.textMuted,
  border: branding.border,
  panel: branding.panel,
  shadow: branding.shadow,
  glowAccent: branding.glowAccent,
  badgeBg: branding.badgeBg,
  badgeText: branding.badgeText,
});

const createMinimalConfigFromBranding = (
  branding: OrganizationBrandingDto,
): MinimalBrandingConfig => {
  const autoPanel = generateBrandTokens({
    mode: branding.mode,
    primaryColor: branding.primaryColor,
    accent: branding.accent,
    widgetBackground: branding.backgroundSolid,
    liveColor: branding.liveColor,
    gradientStart: branding.gradientStart,
    gradientEnd: branding.gradientEnd,
    gradientDirection: branding.gradientDirection,
  }).panel;

  return {
    mode: branding.mode,
    primaryColor: branding.primaryColor,
    accent: branding.accent,
    backgroundSolid: branding.backgroundSolid,
    gradientStart: branding.gradientStart,
    gradientEnd: branding.gradientEnd,
    gradientDirection: branding.gradientDirection,
    panelMode:
      autoPanel.toLowerCase() === branding.panel.toLowerCase()
        ? 'auto'
        : 'custom',
    panelColor: branding.panel,
  };
};

const normalizeMinimalConfig = (
  value: unknown,
  fallback: OrganizationBrandingDto,
): MinimalBrandingConfig => {
  const source = isRecord(value) ? value : {};
  const base = createMinimalConfigFromBranding(fallback);
  return {
    mode: normalizeMode(source.mode, base.mode),
    primaryColor: pickString(source.primaryColor, base.primaryColor),
    accent: pickString(source.accent, base.accent),
    backgroundSolid: pickString(source.backgroundSolid, base.backgroundSolid),
    gradientStart: pickString(source.gradientStart, base.gradientStart),
    gradientEnd: pickString(source.gradientEnd, base.gradientEnd),
    gradientDirection: normalizeDirection(
      source.gradientDirection,
      base.gradientDirection,
    ),
    panelMode: source.panelMode === 'custom' ? 'custom' : 'auto',
    panelColor: pickString(source.panelColor, base.panelColor),
  };
};

const normalizeAdvancedConfig = (
  value: unknown,
  fallback: OrganizationBrandingDto,
): AdvancedBrandingConfig => {
  const source = isRecord(value) ? value : {};
  const base = createAdvancedConfigFromBranding(fallback);
  return {
    mode: normalizeMode(
      source.mode,
      base.mode ?? DEFAULT_ADVANCED_BRANDING_CONFIG.mode!,
    ),
    primaryColor: pickString(
      source.primaryColor,
      base.primaryColor ?? fallback.primaryColor,
    ),
    accent: pickString(source.accent, base.accent ?? fallback.accent),
    liveColor: pickString(
      source.liveColor,
      base.liveColor ?? fallback.liveColor,
    ),
    backgroundSolid: pickString(
      source.backgroundSolid,
      base.backgroundSolid ?? fallback.backgroundSolid,
    ),
    gradientStart: pickString(
      source.gradientStart,
      base.gradientStart ?? fallback.gradientStart,
    ),
    gradientEnd: pickString(
      source.gradientEnd,
      base.gradientEnd ?? fallback.gradientEnd,
    ),
    gradientDirection: normalizeDirection(
      source.gradientDirection,
      base.gradientDirection ?? fallback.gradientDirection,
    ),
    secondaryColor: pickString(
      source.secondaryColor,
      base.secondaryColor ?? fallback.secondaryColor,
    ),
    textPrimary: pickString(
      source.textPrimary,
      base.textPrimary ?? fallback.textPrimary,
    ),
    textMuted: pickString(
      source.textMuted,
      base.textMuted ?? fallback.textMuted,
    ),
    border: pickString(source.border, base.border ?? fallback.border),
    panel: pickString(source.panel, base.panel ?? fallback.panel),
    shadow: pickString(source.shadow, base.shadow ?? fallback.shadow),
    glowAccent: pickString(
      source.glowAccent,
      base.glowAccent ?? fallback.glowAccent,
    ),
    badgeBg: pickString(source.badgeBg, base.badgeBg ?? fallback.badgeBg),
    badgeText: pickString(
      source.badgeText,
      base.badgeText ?? fallback.badgeText,
    ),
  };
};

@Injectable()
export class OrganizationBrandingService {
  private readonly logger = new Logger('OrganizationBrandingService');

  constructor(
    private prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  private async ensureOrganizationExists(organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }
  }

  private normalize(input: BrandingRecord = {}): OrganizationBrandingDto {
    const mode =
      typeof input.mode === 'string' && input.mode.toLowerCase() === 'gradient'
        ? 'gradient'
        : 'solid';

    const widgetBackground =
      (input.widgetBackground as string | undefined) ??
      (input.backgroundSolid as string | undefined) ??
      DEFAULT_BRAND_INPUTS.widgetBackground;

    const gradientStart =
      (input.gradientStart as string | undefined) ??
      (input.gradientEnd as string | undefined) ??
      widgetBackground ??
      DEFAULT_BRAND_INPUTS.gradientStart;

    const gradientEnd =
      (input.gradientEnd as string | undefined) ??
      (input.gradientStart as string | undefined) ??
      widgetBackground ??
      DEFAULT_BRAND_INPUTS.gradientEnd;

    const directionRaw = (
      input.gradientDirection as string | undefined
    )?.toLowerCase();
    const gradientDirection =
      directionRaw === 'horizontal' ||
      directionRaw === 'vertical' ||
      directionRaw === 'diagonal' ||
      directionRaw === 'reverse-diagonal'
        ? directionRaw
        : DEFAULT_BRAND_INPUTS.gradientDirection;

    const normalizedInput = {
      mode: mode as BrandingMode,
      widgetBackground,
      gradientStart,
      gradientEnd,
      gradientDirection: gradientDirection,
      primaryColor:
        (input.primaryColor as string | undefined) ??
        DEFAULT_BRAND_INPUTS.primaryColor,
      accent:
        (input.accent as string | undefined) ??
        (input.primaryColor as string | undefined) ??
        DEFAULT_BRAND_INPUTS.accent,
      liveColor:
        (input.liveColor as string | undefined) ??
        DEFAULT_BRAND_INPUTS.liveColor,
    } satisfies Partial<BrandingInputs>;

    const tokens = generateBrandTokens(normalizedInput);
    const secondaryColor =
      (input.secondaryColor as string | undefined) ??
      generateSecondaryColor(tokens.primaryColor, tokens.effectiveBackground);
    const panel =
      (input.panel as string | undefined) ??
      generatePanelColor(tokens.effectiveBackground);
    const textPrimary =
      (input.textPrimary as string | undefined) ??
      generateTextPrimaryColor(panel);
    const textMuted =
      (input.textMuted as string | undefined) ??
      generateTextMutedColor(textPrimary, panel);
    const authoringMode = normalizeAuthoringMode(input.authoringMode);

    const normalized: OrganizationBrandingDto = {
      ...tokens,
      organizationId: input.organizationId ?? null,
      backgroundSolid: widgetBackground,
      secondaryColor,
      textPrimary,
      textMuted,
      border:
        (input.border as string | undefined) ?? generateBorderColor(panel),
      panel,
      shadow: (input.shadow as string | undefined) ?? tokens.shadow,
      glowAccent: (input.glowAccent as string | undefined) ?? tokens.glowAccent,
      badgeBg: (input.badgeBg as string | undefined) ?? tokens.badgeBg,
      badgeText: (input.badgeText as string | undefined) ?? tokens.badgeText,
      defaultTeamLogoUrl: input.defaultTeamLogoUrl ?? null,
      defaultPlayerPhotoUrl: input.defaultPlayerPhotoUrl ?? null,
      authoringMode,
      minimalConfig: DEFAULT_MINIMAL_BRANDING_CONFIG,
      advancedConfig: DEFAULT_ADVANCED_BRANDING_CONFIG,
    };

    normalized.minimalConfig = normalizeMinimalConfig(
      input.minimalConfig,
      normalized,
    );
    normalized.advancedConfig = normalizeAdvancedConfig(
      input.advancedConfig,
      normalized,
    );

    return normalized;
  }

  private toPersistence(branding: OrganizationBrandingDto) {
    const widgetBackground =
      branding.backgroundSolid ?? branding.widgetBackground;
    return {
      mode: branding.mode,
      backgroundSolid: widgetBackground,
      widgetBackground,
      gradientStart: branding.gradientStart,
      gradientEnd: branding.gradientEnd,
      gradientDirection: branding.gradientDirection,
      primaryColor: branding.primaryColor,
      secondaryColor:
        branding.secondaryColor ?? branding.accent ?? branding.primaryColor,
      liveColor: branding.liveColor,
      accent: branding.accent,
      backgroundStart: branding.backgroundStart,
      backgroundEnd: branding.backgroundEnd,
      backgroundCss: branding.backgroundCss,
      effectiveBackground: branding.effectiveBackground,
      textPrimary: branding.textPrimary,
      textMuted: branding.textMuted,
      border: branding.border,
      panel: branding.panel,
      shadow: branding.shadow,
      glowAccent: branding.glowAccent,
      badgeBg: branding.badgeBg,
      badgeText: branding.badgeText,
      defaultTeamLogoUrl: branding.defaultTeamLogoUrl,
      defaultPlayerPhotoUrl: branding.defaultPlayerPhotoUrl,
      authoringMode: branding.authoringMode,
      minimalConfig: branding.minimalConfig,
      advancedConfig: branding.advancedConfig,
    };
  }

  private assertCanUpdate(actor: Actor | null, organizationId: string) {
    const role = actor?.actorRole ?? actor?.role;
    const impersonatedOrg = actor?.actingOrgId ?? null;
    const effectiveOrg =
      impersonatedOrg ?? (actor ? effectiveOrganizationId(actor) : null);
    if (role === Role.SUPER_ADMIN) {
      if (!effectiveOrg) {
        throw new ForbiddenException(
          'Not allowed to update this organization branding',
        );
      }
      if (effectiveOrg !== organizationId) {
        throw new ForbiddenException(
          'Not allowed to update this organization branding',
        );
      }
      return;
    }

    if (!effectiveOrg || effectiveOrg !== organizationId) {
      throw new ForbiddenException(
        'Not allowed to update this organization branding',
      );
    }

    if (role !== Role.ADMIN && role !== Role.ORGANIZER) {
      throw new ForbiddenException('Not allowed to update branding');
    }
  }

  async ensureDefaultForOrg(
    organizationId: string,
  ): Promise<OrganizationBrandingDto> {
    await this.ensureOrganizationExists(organizationId);
    const defaults = this.toPersistence(DEFAULT_ORGANIZATION_BRANDING);
    const created = await this.prisma.organizationBranding.upsert({
      where: { organizationId },
      update: {},
      create: {
        organizationId,
        ...defaults,
      },
    });
    return this.normalize({ ...created, organizationId });
  }

  async getForOrganization(
    organizationId: string,
  ): Promise<OrganizationBrandingDto> {
    const branding = await this.prisma.organizationBranding.findUnique({
      where: { organizationId },
    });
    if (branding) return this.normalize({ ...branding, organizationId });
    return this.ensureDefaultForOrg(organizationId);
  }

  private toSessionBrandingDto(
    branding: OrganizationBrandingDto,
    sessionId: string,
    inheritOrganization: boolean,
    source: SessionBrandingDto['source'],
  ): SessionBrandingDto {
    return {
      ...branding,
      sessionId,
      inheritOrganization,
      source,
    };
  }

  private assertCanAccessSessionBranding(
    actor: Actor | null,
    organizationId: string,
  ) {
    const role = actor?.actorRole ?? actor?.role;
    const effectiveOrg = actor ? effectiveOrganizationId(actor) : null;
    if (!effectiveOrg || effectiveOrg !== organizationId) {
      throw new ForbiddenException(
        'Not allowed to access this session branding',
      );
    }
    if (
      role !== Role.SUPER_ADMIN &&
      role !== Role.ADMIN &&
      role !== Role.ORGANIZER
    ) {
      throw new ForbiddenException('Not allowed to access session branding');
    }
  }

  private async getSessionBrandingContext(
    sessionId: string,
    actor: Actor | null,
  ) {
    const effectiveOrg = actor ? effectiveOrganizationId(actor) : null;
    const session = await this.prisma.session.findFirst({
      where: {
        id: sessionId,
        deletedAt: null,
        ...(effectiveOrg ? { organizationId: effectiveOrg } : {}),
      },
      select: {
        id: true,
        organizationId: true,
        branding: true,
      },
    });
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    this.assertCanAccessSessionBranding(actor, session.organizationId);
    return session;
  }

  private async resolveSessionBranding(session: {
    id: string;
    organizationId: string;
    branding?: BrandingRecord | null;
  }): Promise<SessionBrandingDto> {
    const override = session.branding;
    if (override && override.inheritOrganization !== true) {
      return this.toSessionBrandingDto(
        this.normalize({
          ...override,
          organizationId: session.organizationId,
          sessionId: session.id,
        }),
        session.id,
        false,
        'session',
      );
    }

    const inherited = await this.getForOrganization(session.organizationId);
    return this.toSessionBrandingDto(
      inherited,
      session.id,
      true,
      'organization',
    );
  }

  async getForSessionActor(
    actor: Actor | null,
    sessionId: string,
  ): Promise<SessionBrandingDto> {
    const session = await this.getSessionBrandingContext(sessionId, actor);
    return this.resolveSessionBranding(session);
  }

  async updateForSessionActor(
    actor: Actor | null,
    sessionId: string,
    dto: SessionBrandingInputDto,
  ): Promise<SessionBrandingDto> {
    const session = await this.getSessionBrandingContext(sessionId, actor);

    if (dto.inheritOrganization === true) {
      await this.prisma.sessionBranding.deleteMany({
        where: {
          sessionId: session.id,
          organizationId: session.organizationId,
        },
      });
      const inherited = await this.getForOrganization(session.organizationId);
      return this.toSessionBrandingDto(
        inherited,
        session.id,
        true,
        'organization',
      );
    }

    const inherited = await this.getForOrganization(session.organizationId);
    const normalized = this.normalize({
      ...inherited,
      ...(session.branding ?? {}),
      ...dto,
      organizationId: session.organizationId,
      sessionId: session.id,
      inheritOrganization: false,
    });
    const persistence = this.toPersistence(normalized);
    const saved = await this.prisma.sessionBranding.upsert({
      where: { sessionId: session.id },
      update: {
        organizationId: session.organizationId,
        inheritOrganization: false,
        ...persistence,
      },
      create: {
        organizationId: session.organizationId,
        sessionId: session.id,
        inheritOrganization: false,
        ...persistence,
      },
    });

    return this.toSessionBrandingDto(
      this.normalize({
        ...saved,
        organizationId: session.organizationId,
        sessionId: session.id,
      }),
      session.id,
      false,
      'session',
    );
  }

  private async getEffectiveSessionBranding(params: {
    sessionId: string;
    organizationId?: string | null;
  }): Promise<SessionBrandingDto | null> {
    const session = await this.prisma.session.findFirst({
      where: {
        id: params.sessionId,
        deletedAt: null,
        ...(params.organizationId
          ? { organizationId: params.organizationId }
          : {}),
      },
      select: {
        id: true,
        organizationId: true,
        branding: true,
      },
    });
    if (!session) return null;
    return this.resolveSessionBranding(session);
  }

  async updateForActor(
    actor: Actor | null,
    organizationId: string,
    dto: OrganizationBrandingInputDto,
  ): Promise<OrganizationBrandingDto> {
    this.assertCanUpdate(actor, organizationId);
    await this.ensureOrganizationExists(organizationId);

    const existing = await this.prisma.organizationBranding.findUnique({
      where: { organizationId },
    });

    const normalizedInput = this.normalize({
      ...existing,
      ...dto,
      organizationId,
    });

    const persistence = this.toPersistence(normalizedInput);
    const saved = await this.prisma.organizationBranding.upsert({
      where: { organizationId },
      update: persistence,
      create: {
        organizationId,
        ...persistence,
      },
    });

    const normalized = this.normalize({ ...saved, organizationId });
    this.realtime.emitBrandingUpdated(organizationId, normalized);
    this.realtime.emitThemeUpdated(organizationId, normalized);
    return normalized;
  }

  /**
   * Resolve effective branding for the given context.
   * Uses per-request cache only (if provided) and never crashes consumers.
   */
  async getEffectiveBranding(params: {
    actor?: Actor | null;
    organizationId?: string | null;
    sessionId?: string | null;
    matchId?: string | null;
    tournamentId?: string | null;
    cache?: Map<string, OrganizationBrandingDto>;
  }): Promise<OrganizationBrandingDto> {
    const cache = params.cache;
    const cacheKey =
      (params.sessionId ? `session:${params.sessionId}` : null) ??
      params.organizationId ??
      params.tournamentId ??
      params.matchId ??
      'default';
    if (cache?.has(cacheKey)) return cache.get(cacheKey)!;

    let orgId =
      params.organizationId ??
      (params.actor ? effectiveOrganizationId(params.actor) : null);
    let sessionId = params.sessionId ?? null;

    try {
      if ((!orgId || !sessionId) && params.matchId) {
        const match = await this.prisma.match.findFirst({
          where: { id: params.matchId, deletedAt: null },
          select: {
            organizationId: true,
            sessionId: true,
            tournament: { select: { organizationId: true } },
          },
        });
        orgId =
          match?.organizationId ?? match?.tournament?.organizationId ?? null;
        sessionId = sessionId ?? match?.sessionId ?? null;
      }

      if (sessionId) {
        const sessionBranding = await this.getEffectiveSessionBranding({
          sessionId,
          organizationId: orgId,
        });
        if (sessionBranding) {
          cache?.set(cacheKey, sessionBranding);
          return sessionBranding;
        }
      }

      if (!orgId && params.tournamentId) {
        const tournament = await this.prisma.tournament.findFirst({
          where: { id: params.tournamentId, deletedAt: null },
          select: { organizationId: true },
        });
        orgId = tournament?.organizationId ?? null;
      }

      if (orgId) {
        const resolved = await this.getForOrganization(orgId);
        cache?.set(cacheKey, resolved);
        return resolved;
      }
    } catch (err) {
      this.logger.warn(
        `Branding resolution failed (match=${params.matchId}, tournament=${params.tournamentId}, org=${orgId ?? 'unknown'}): ${String(err)}`,
      );
    }

    const fallback = this.normalize({ organizationId: orgId ?? null });
    cache?.set(cacheKey, fallback);
    return fallback;
  }
}
