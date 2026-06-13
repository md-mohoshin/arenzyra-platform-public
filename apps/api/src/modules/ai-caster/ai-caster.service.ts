import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import axios from 'axios';
import { AuditAction, Prisma, Role } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth.types';
import { effectiveOrganizationId } from '../../common/org/org.util';
import { PrismaService } from '../../db/prisma.service';
import {
  AI_CASTER_ALLOWED_ROLES,
  AI_CASTER_FEATURE_KEY,
  AI_CASTER_TTS_VOICES,
  AI_CASTER_WIDGET_KEY,
  DEFAULT_AI_CASTER_SETTINGS,
  type AiCasterAllowedRole,
  type AiCasterSettings,
  type AiCasterSpeakingSpeed,
  type AiCasterTtsVoice,
} from './ai-caster.constants';
import { PreviewAiCasterVoiceDto } from './dto/preview-ai-caster-voice.dto';
import { UpdateAiCasterSettingsDto } from './dto/update-ai-caster-settings.dto';

type AiCasterApprovalRecord = {
  widgetKey: string;
  isApproved: boolean;
  approvedAt: Date | null;
  approvedBy: string | null;
};

type AiCasterFeatureRecord = {
  isEnabled: boolean;
  config: Prisma.JsonValue | null;
};

type AiCasterPreviewRole = 'play-by-play' | 'analyst';

const OPENAI_SPEECH_ENDPOINT = 'https://api.openai.com/v1/audio/speech';
const AI_CASTER_VOICE_ALIASES: Record<string, AiCasterTtsVoice> = {
  analyst: 'onyx',
  commentator: 'coral',
  'play-by-play': 'coral',
  pbp: 'coral',
};
const AI_CASTER_PREVIEW_TEXT: Record<AiCasterPreviewRole, string> = {
  'play-by-play':
    'Fight developing on the edge of zone. Hold the camera for the commit.',
  analyst:
    'Zone five closes soon. Late rotations need to move before the pressure hits.',
};
const AI_CASTER_SPEED_VALUES: Record<AiCasterSpeakingSpeed, number> = {
  slow: 0.9,
  normal: 1,
  fast: 1.14,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanString(value: unknown, fallback: string, maxLength = 80) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return fallback;
  return normalized.slice(0, maxLength);
}

function cleanBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function cleanNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function cleanEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

@Injectable()
export class AiCasterService {
  private readonly logger = new Logger(AiCasterService.name);

  constructor(private readonly prisma: PrismaService) {}

  private isSuperAdmin(actor?: AuthUser | null) {
    return (
      actor?.role === Role.SUPER_ADMIN || actor?.actorRole === Role.SUPER_ADMIN
    );
  }

  private actorRole(actor?: AuthUser | null): Role | null {
    return actor?.actingRole ?? actor?.role ?? actor?.actorRole ?? null;
  }

  private async requireOrganization(orgId: string) {
    const organization = await this.prisma.organization.findFirst({
      where: { id: orgId, deletedAt: null },
      select: { id: true, slug: true, name: true },
    });
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }
    return organization;
  }

  private resolveOrganizationId(
    actor: AuthUser,
    requestedOrgId?: string | null,
  ) {
    if (this.isSuperAdmin(actor) && requestedOrgId) {
      return requestedOrgId;
    }

    const orgId = effectiveOrganizationId(actor);
    if (!orgId) {
      throw new ForbiddenException('organizationId is required');
    }
    return orgId;
  }

  normalizeSettings(
    input: unknown,
    feature?: AiCasterFeatureRecord | null,
  ): AiCasterSettings {
    const source = {
      ...DEFAULT_AI_CASTER_SETTINGS,
      ...asRecord(input),
    };

    const allowedRolesSource = Array.isArray(source.allowedRoles)
      ? source.allowedRoles
      : DEFAULT_AI_CASTER_SETTINGS.allowedRoles;
    const allowedRoles = Array.from(
      new Set(
        allowedRolesSource.filter((role): role is AiCasterAllowedRole =>
          AI_CASTER_ALLOWED_ROLES.includes(role),
        ),
      ),
    );

    return {
      enabled:
        typeof feature?.isEnabled === 'boolean'
          ? feature.isEnabled
          : cleanBoolean(source.enabled, DEFAULT_AI_CASTER_SETTINGS.enabled),
      muted: cleanBoolean(source.muted, DEFAULT_AI_CASTER_SETTINGS.muted),
      mode: cleanEnum(
        source.mode,
        ['professional', 'hype'] as const,
        DEFAULT_AI_CASTER_SETTINGS.mode,
      ),
      voiceMode: cleanEnum(
        source.voiceMode,
        ['single', 'dual'] as const,
        DEFAULT_AI_CASTER_SETTINGS.voiceMode,
      ),
      primaryVoice: cleanString(
        source.primaryVoice,
        DEFAULT_AI_CASTER_SETTINGS.primaryVoice,
      ),
      secondaryVoice: cleanString(
        source.secondaryVoice,
        DEFAULT_AI_CASTER_SETTINGS.secondaryVoice,
      ),
      language: cleanString(
        source.language,
        DEFAULT_AI_CASTER_SETTINGS.language,
        16,
      ),
      talkFrequency: cleanEnum(
        source.talkFrequency,
        ['low', 'balanced', 'high'] as const,
        DEFAULT_AI_CASTER_SETTINGS.talkFrequency,
      ),
      minGapMs: cleanNumber(
        source.minGapMs,
        DEFAULT_AI_CASTER_SETTINGS.minGapMs,
        4000,
        30000,
      ),
      maxLineWords: cleanNumber(
        source.maxLineWords,
        DEFAULT_AI_CASTER_SETTINGS.maxLineWords,
        8,
        40,
      ),
      speakingSpeed: cleanEnum(
        source.speakingSpeed,
        ['slow', 'normal', 'fast'] as const,
        DEFAULT_AI_CASTER_SETTINGS.speakingSpeed,
      ),
      expression: cleanEnum(
        source.expression,
        ['neutral', 'professional', 'energetic', 'dramatic'] as const,
        DEFAULT_AI_CASTER_SETTINGS.expression,
      ),
      priority: cleanEnum(
        source.priority,
        ['high-value', 'balanced', 'all'] as const,
        DEFAULT_AI_CASTER_SETTINGS.priority,
      ),
      profanityFilter: cleanBoolean(
        source.profanityFilter,
        DEFAULT_AI_CASTER_SETTINGS.profanityFilter,
      ),
      logLines: cleanBoolean(
        source.logLines,
        DEFAULT_AI_CASTER_SETTINGS.logLines,
      ),
      allowedRoles: allowedRoles.length
        ? allowedRoles
        : [...DEFAULT_AI_CASTER_SETTINGS.allowedRoles],
    };
  }

  private mapApproval(approval: AiCasterApprovalRecord | null) {
    return approval
      ? {
          widgetKey: approval.widgetKey,
          isApproved: approval.isApproved,
          approvedAt: approval.approvedAt?.toISOString() ?? null,
          approvedBy: approval.approvedBy,
        }
      : null;
  }

  private hasConfiguredRole(actor: AuthUser, settings: AiCasterSettings) {
    if (this.isSuperAdmin(actor)) return true;
    const role = this.actorRole(actor);
    return settings.allowedRoles.includes(role as AiCasterAllowedRole);
  }

  private accessReason(params: {
    approved: boolean;
    roleAllowed: boolean;
    enabled: boolean;
    muted: boolean;
  }) {
    if (!params.approved) return 'SUPER_ADMIN_APPROVAL_REQUIRED';
    if (!params.roleAllowed) return 'ROLE_NOT_ALLOWED';
    if (!params.enabled) return 'AI_CASTER_DISABLED';
    if (params.muted) return 'AI_CASTER_MUTED';
    return null;
  }

  async getAccess(actor: AuthUser, requestedOrgId?: string | null) {
    const organizationId = this.resolveOrganizationId(actor, requestedOrgId);
    const organization = await this.requireOrganization(organizationId);
    const [approval, feature] = await Promise.all([
      this.prisma.organizationWidgetApproval.findUnique({
        where: {
          organizationId_widgetKey: {
            organizationId,
            widgetKey: AI_CASTER_WIDGET_KEY,
          },
        },
        select: {
          widgetKey: true,
          isApproved: true,
          approvedAt: true,
          approvedBy: true,
        },
      }),
      this.prisma.organizationFeature.findUnique({
        where: {
          organizationId_featureKey: {
            organizationId,
            featureKey: AI_CASTER_FEATURE_KEY,
          },
        },
        select: { isEnabled: true, config: true },
      }),
    ]);

    const settings = this.normalizeSettings(feature?.config ?? null, feature);
    const approved = approval?.isApproved === true;
    const superAdmin = this.isSuperAdmin(actor);
    const roleAllowed = this.hasConfiguredRole(actor, settings);
    const canConfigure = superAdmin || (approved && roleAllowed);
    const canUse = canConfigure && settings.enabled && !settings.muted;
    const reason = this.accessReason({
      approved: superAdmin || approved,
      roleAllowed,
      enabled: settings.enabled,
      muted: settings.muted,
    });

    return {
      featureKey: AI_CASTER_FEATURE_KEY,
      widgetKey: AI_CASTER_WIDGET_KEY,
      organization,
      approved,
      approval: this.mapApproval(approval),
      canConfigure,
      canUse,
      reason,
      settings,
    };
  }

  async updateSettings(
    actor: AuthUser,
    dto: UpdateAiCasterSettingsDto,
    requestedOrgId?: string | null,
  ) {
    const access = await this.getAccess(actor, requestedOrgId);
    if (!access.canConfigure) {
      throw new ForbiddenException('AI caster is not approved for this user');
    }

    const settings = this.normalizeSettings({
      ...access.settings,
      ...dto,
    });

    await this.prisma.organizationFeature.upsert({
      where: {
        organizationId_featureKey: {
          organizationId: access.organization.id,
          featureKey: AI_CASTER_FEATURE_KEY,
        },
      },
      update: {
        isEnabled: settings.enabled,
        config: settings as unknown as Prisma.InputJsonValue,
      },
      create: {
        organizationId: access.organization.id,
        featureKey: AI_CASTER_FEATURE_KEY,
        isEnabled: settings.enabled,
        config: settings as unknown as Prisma.InputJsonValue,
      },
    });

    return this.getAccess(actor, access.organization.id);
  }

  private getOpenAiApiKey(): string {
    const apiKey = process.env.OPENAI_API_KEY?.trim() ?? '';
    if (!apiKey) {
      throw new BadRequestException('OPENAI_API_KEY is not configured');
    }
    return apiKey;
  }

  private getOpenAiTtsModel(): string {
    return process.env.OPENAI_TTS_MODEL?.trim() || 'gpt-4o-mini-tts';
  }

  private resolvePreviewVoice(
    value: unknown,
    role: AiCasterPreviewRole,
  ): AiCasterTtsVoice {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (AI_CASTER_TTS_VOICES.includes(normalized as AiCasterTtsVoice)) {
      return normalized as AiCasterTtsVoice;
    }
    return (
      AI_CASTER_VOICE_ALIASES[normalized.toLowerCase()] ??
      (role === 'analyst' ? 'onyx' : 'coral')
    );
  }

  private buildPreviewInstructions(settings: AiCasterSettings): string {
    const mode =
      settings.mode === 'hype'
        ? 'Use a high-energy esports broadcast delivery.'
        : 'Use a polished professional esports broadcast delivery.';
    const expression =
      settings.expression === 'dramatic'
        ? 'Add controlled tension and big-match intensity.'
        : settings.expression === 'energetic'
          ? 'Sound excited, but keep every word clear.'
          : settings.expression === 'neutral'
            ? 'Stay calm, clear, and restrained.'
            : 'Sound confident, sharp, and broadcast-ready.';
    const speed =
      settings.speakingSpeed === 'fast'
        ? 'Keep the pace quick without rushing or clipping words.'
        : settings.speakingSpeed === 'slow'
          ? 'Use a measured pace with clean pauses.'
          : 'Use a balanced pace with natural pauses.';

    return `${mode} ${expression} ${speed}`;
  }

  private cleanPreviewText(value: unknown, role: AiCasterPreviewRole): string {
    const text =
      typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    return (text || AI_CASTER_PREVIEW_TEXT[role]).slice(0, 220);
  }

  async previewVoice(
    actor: AuthUser,
    dto: PreviewAiCasterVoiceDto,
    requestedOrgId?: string | null,
  ) {
    const access = await this.getAccess(actor, requestedOrgId);
    if (!access.canConfigure) {
      throw new ForbiddenException('AI caster is not approved for this user');
    }

    const role: AiCasterPreviewRole =
      dto.role === 'analyst' ? 'analyst' : 'play-by-play';
    const settings = this.normalizeSettings({
      ...access.settings,
      mode: dto.mode ?? access.settings.mode,
      speakingSpeed: dto.speakingSpeed ?? access.settings.speakingSpeed,
      expression: dto.expression ?? access.settings.expression,
    });
    const voice = this.resolvePreviewVoice(
      dto.voice ??
        (role === 'analyst' ? settings.secondaryVoice : settings.primaryVoice),
      role,
    );
    const input = this.cleanPreviewText(dto.text, role);
    const model = this.getOpenAiTtsModel();
    const apiKey = this.getOpenAiApiKey();

    try {
      const response = await axios.post<ArrayBuffer>(
        OPENAI_SPEECH_ENDPOINT,
        {
          model,
          voice,
          input,
          instructions: this.buildPreviewInstructions(settings),
          response_format: 'mp3',
          speed: AI_CASTER_SPEED_VALUES[settings.speakingSpeed],
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          responseType: 'arraybuffer',
          timeout: 30_000,
        },
      );

      return {
        audioBase64: Buffer.from(response.data).toString('base64'),
        mimeType: 'audio/mpeg',
        model,
        voice,
        role,
        text: input,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'unknown speech error';
      this.logger.warn(`AI caster voice preview failed: ${message}`);
      throw new BadGatewayException('AI caster voice preview failed');
    }
  }

  async setApproval(actor: AuthUser, orgId: string, isApproved: boolean) {
    if (!this.isSuperAdmin(actor)) {
      throw new ForbiddenException('Only SUPER_ADMIN can approve AI caster');
    }

    await this.requireOrganization(orgId);
    const existing = await this.prisma.organizationWidgetApproval.findUnique({
      where: {
        organizationId_widgetKey: {
          organizationId: orgId,
          widgetKey: AI_CASTER_WIDGET_KEY,
        },
      },
      select: {
        widgetKey: true,
        isApproved: true,
        approvedAt: true,
        approvedBy: true,
      },
    });

    const updated = await this.prisma.organizationWidgetApproval.upsert({
      where: {
        organizationId_widgetKey: {
          organizationId: orgId,
          widgetKey: AI_CASTER_WIDGET_KEY,
        },
      },
      update: {
        isApproved,
        approvedAt: isApproved ? new Date() : null,
        approvedBy: isApproved ? actor.id : null,
      },
      create: {
        organizationId: orgId,
        widgetKey: AI_CASTER_WIDGET_KEY,
        isApproved,
        approvedAt: isApproved ? new Date() : null,
        approvedBy: isApproved ? actor.id : null,
      },
      select: {
        widgetKey: true,
        isApproved: true,
        approvedAt: true,
        approvedBy: true,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        action: AuditAction.ADMIN_ADJUSTMENT,
        entityType: 'AI_CASTER_APPROVAL',
        entityId: `${orgId}:${AI_CASTER_WIDGET_KEY}`,
        organizationId: orgId,
        userId: actor.id,
        before: existing ?? Prisma.JsonNull,
        after: updated,
        source: 'SUPER',
      },
    });

    return this.getAccess(actor, orgId);
  }
}
