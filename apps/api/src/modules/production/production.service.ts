import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import {
  AuditAction,
  AdminAdjustment,
  DataMode,
  LiveState,
  MatchDataSource,
  Match,
  MatchStatus,
  OrganizationStatus,
  PcobStatus,
  Role,
  SessionRegistrationStatus,
  SessionStatus,
  SessionType,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import type { AuthUser } from '../../common/auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { ScoringService } from '../scoring/scoring.service';
import { PcobGateway } from '../pcob/pcob.gateway';
import { MatchControlService } from '../match-control/match-control.service';
import type { Actor as ControlActor } from '../matches/matches.service';
import type { AdminAdjustmentDto } from './dto/adjustment.dto';
import { randomUUID } from 'crypto';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { RankingEmitterService } from '../../realtime/ranking-emitter.service';
import { isMatchFinishedStatus } from '../../common/match-status.util';
import { effectiveOrganizationId } from '../../common/org/org.util';
import { organizationHasActiveSubscription } from '../../common/org/launcher-license-state.util';
import { normalizeAndValidateTeamTag } from '../../common/team-tag.util';
import {
  parseDiscordEventSlotRows,
  type DiscordEventSlotRow,
  type DiscordMessage,
} from '../sessions/session-discord-sync.service';
import {
  syncMatchSlotsWithSessionRegistrations,
  type SyncSessionMatchSlotsResult,
} from '../sessions/session-match-slot-sync';
import {
  buildPcobBindingData,
  buildPcobUnbindingData,
  hasLegacyPcobControlSignal,
} from '../../common/pcob-binding.util';
import type {
  CreateProductionDiscordSetDto,
  ImportProductionDiscordSlotsDto,
  UpdateProductionDiscordConfigDto,
  UpsertProductionDiscordTeamDto,
} from './dto/production-discord.dto';

type ActorLike = Partial<AuthUser> & { sub?: string | null };
export const PRODUCTION_DISCORD_FEATURE_KEY = 'production.discord.enabled';
type ProductionDiscordChannelKind =
  | 'slots'
  | 'logos'
  | 'player-photos'
  | 'idp'
  | 'logs'
  | 'control';
type ProductionDiscordSlot = DiscordEventSlotRow & {
  teamId: string;
  sourceChannelId: string | null;
  sourceMessageId: string | null;
  importedAt: string;
};
type ProductionDiscordLastSlotImport = {
  sourceChannelId: string | null;
  sourceMessageId: string | null;
  importedAt: string;
  parsedSlotRows: number;
  importedTeams: number;
};
type ProductionDiscordSet = {
  key: string;
  index: number;
  setName: string | null;
  eventId: string | null;
  eventName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  slotsChannelId: string | null;
  slotsChannelName: string | null;
  logosChannelId: string | null;
  logosChannelName: string | null;
  playerPhotosChannelId: string | null;
  playerPhotosChannelName: string | null;
  idpChannelId: string | null;
  idpChannelName: string | null;
  logsChannelId: string | null;
  logsChannelName: string | null;
  controlChannelId: string | null;
  controlChannelName: string | null;
  productionRoleId: string | null;
  productionRoleName: string | null;
  startSlot: number | null;
  normalSlots: number | null;
  vipSlots: number | null;
  slots: ProductionDiscordSlot[];
  lastSlotImport: ProductionDiscordLastSlotImport | null;
};
type ProductionDiscordConfig = {
  enabled: boolean;
  guildId: string | null;
  guildName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  slotsChannelId: string | null;
  slotsChannelName: string | null;
  logosChannelId: string | null;
  logosChannelName: string | null;
  playerPhotosChannelId: string | null;
  playerPhotosChannelName: string | null;
  idpChannelId: string | null;
  idpChannelName: string | null;
  logsChannelId: string | null;
  logsChannelName: string | null;
  controlChannelId: string | null;
  controlChannelName: string | null;
  productionRoleId: string | null;
  productionRoleName: string | null;
  startSlot: number | null;
  normalSlots: number | null;
  vipSlots: number | null;
  slots: ProductionDiscordSlot[];
  lastSlotImport: ProductionDiscordLastSlotImport | null;
  sets: ProductionDiscordSet[];
};
type ProductionEventAutoSyncTarget = {
  id: string;
  name: string;
  slotCount: number;
  maxTeams: number;
};
type ProductionEventAutoSyncResult = {
  sessionId: string;
  sessionName: string;
  importedTeams: number;
  removedTeams: number;
  skipped: Array<{
    slotNumber: number;
    teamName: string;
    reason: string;
  }>;
  syncedMatches: SyncSessionMatchSlotsResult[];
};
type MatchWithTournament = Prisma.MatchGetPayload<{
  include: { tournament: true };
}> & {
  tournamentId: string;
  tournament: NonNullable<
    Prisma.MatchGetPayload<{
      include: { tournament: true };
    }>['tournament']
  >;
};

const PRODUCTION_DISCORD_DEFAULT_CONFIG: ProductionDiscordConfig = {
  enabled: true,
  guildId: null,
  guildName: null,
  categoryId: null,
  categoryName: null,
  slotsChannelId: null,
  slotsChannelName: null,
  logosChannelId: null,
  logosChannelName: null,
  playerPhotosChannelId: null,
  playerPhotosChannelName: null,
  idpChannelId: null,
  idpChannelName: null,
  logsChannelId: null,
  logsChannelName: null,
  controlChannelId: null,
  controlChannelName: null,
  productionRoleId: null,
  productionRoleName: 'Production',
  startSlot: null,
  normalSlots: null,
  vipSlots: null,
  slots: [],
  lastSlotImport: null,
  sets: [],
};
const PRODUCTION_EVENT_IMPORT_NOTE_PREFIX = 'PRODUCTION_EVENT_IMPORT:';
const PRODUCTION_EVENT_IMPORT_CATEGORY_ID = 'production-slots';
const PRODUCTION_EVENT_AUTO_SYNC_STATUSES = [
  SessionStatus.DRAFT,
  SessionStatus.OPEN,
  SessionStatus.CHECKIN,
  SessionStatus.LOCKED,
] as const;

@Injectable()
export class ProductionService {
  private readonly logger = new Logger(ProductionService.name);

  constructor(
    private prisma: PrismaService,
    private scoring: ScoringService,
    private auditService: AuditService,
    private pcobGateway: PcobGateway,
    @Inject(forwardRef(() => MatchControlService))
    private readonly matchControl: MatchControlService,
    private readonly realtime: RealtimeGateway,
    private readonly rankingEmitter: RankingEmitterService,
  ) {}

  private isSuperActor(actor: ActorLike | null | undefined): boolean {
    const role = actor?.actorRole ?? actor?.role;
    return role === Role.SUPER_ADMIN;
  }

  private cleanString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private cleanSnowflake(value: unknown, label: string): string | null {
    const clean = this.cleanString(value);
    if (!clean) return null;
    if (!/^\d{15,25}$/.test(clean)) {
      throw new BadRequestException(`${label} must be a Discord snowflake`);
    }
    return clean;
  }

  private cleanSlotCount(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 100) {
      return null;
    }
    return numeric;
  }

  private productionDiscordSetKey(index: number): string {
    return `production-${Math.min(20, Math.max(1, index))}`;
  }

  private cleanProductionDiscordSetKey(
    value: unknown,
    fallbackIndex = 1,
  ): string {
    const clean = this.cleanString(value);
    if (clean) {
      const normalized = clean.toLowerCase().replace(/[_\s]+/g, '-');
      const keyed = /^(?:production|set)-(\d{1,2})$/.exec(normalized);
      const numeric = /^(\d{1,2})$/.exec(normalized);
      const index = Number(keyed?.[1] ?? numeric?.[1]);
      if (Number.isInteger(index) && index >= 1 && index <= 20) {
        return this.productionDiscordSetKey(index);
      }
    }
    return this.productionDiscordSetKey(fallbackIndex);
  }

  private productionDiscordSetIndex(key: string, fallbackIndex = 1): number {
    const match = /^production-(\d{1,2})$/.exec(key);
    const index = Number(match?.[1]);
    return Number.isInteger(index) && index >= 1 && index <= 20
      ? index
      : fallbackIndex;
  }

  private normalizeProductionDiscordSlots(
    value: unknown,
  ): ProductionDiscordSlot[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          return null;
        }
        const candidate = entry as Record<string, unknown>;
        const slotNumber = Number(candidate.slotNumber);
        const teamName = this.cleanString(candidate.teamName);
        const teamId = this.cleanString(candidate.teamId);
        if (
          !Number.isInteger(slotNumber) ||
          slotNumber < 1 ||
          slotNumber > 100 ||
          !teamName ||
          !teamId
        ) {
          return null;
        }
        return {
          slotNumber,
          teamName,
          teamTag: this.cleanString(candidate.teamTag),
          teamId,
          sourceChannelId: this.cleanString(candidate.sourceChannelId),
          sourceMessageId: this.cleanString(candidate.sourceMessageId),
          importedAt:
            this.cleanString(candidate.importedAt) ?? new Date(0).toISOString(),
        } satisfies ProductionDiscordSlot;
      })
      .filter((entry): entry is ProductionDiscordSlot => entry !== null)
      .sort((left, right) => left.slotNumber - right.slotNumber);
  }

  private normalizeProductionDiscordConfig(
    value: Prisma.JsonValue | null | undefined,
  ): ProductionDiscordConfig {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return this.withPrimaryProductionDiscordSet({
        ...PRODUCTION_DISCORD_DEFAULT_CONFIG,
        sets: [this.defaultProductionDiscordSet(1)],
      });
    }
    const raw = value as Record<string, unknown>;
    const legacySet = this.normalizeProductionDiscordSet(raw, 1);
    const rawSets = Array.isArray(raw.sets) ? raw.sets : [];
    const seenSetKeys = new Set<string>();
    const sets =
      rawSets.length > 0
        ? rawSets
            .map((entry, index) =>
              this.normalizeProductionDiscordSet(
                entry,
                index + 1,
                index === 0 ? legacySet : undefined,
              ),
            )
            .filter((set) => {
              if (seenSetKeys.has(set.key)) return false;
              seenSetKeys.add(set.key);
              return true;
            })
        : [legacySet];

    return this.withPrimaryProductionDiscordSet({
      enabled: raw.enabled !== false,
      guildId: this.cleanString(raw.guildId),
      guildName: this.cleanString(raw.guildName),
      categoryId: legacySet.categoryId,
      categoryName: legacySet.categoryName,
      slotsChannelId: legacySet.slotsChannelId,
      slotsChannelName: legacySet.slotsChannelName,
      logosChannelId: legacySet.logosChannelId,
      logosChannelName: legacySet.logosChannelName,
      playerPhotosChannelId: legacySet.playerPhotosChannelId,
      playerPhotosChannelName: legacySet.playerPhotosChannelName,
      idpChannelId: legacySet.idpChannelId,
      idpChannelName: legacySet.idpChannelName,
      logsChannelId: legacySet.logsChannelId,
      logsChannelName: legacySet.logsChannelName,
      controlChannelId: legacySet.controlChannelId,
      controlChannelName: legacySet.controlChannelName,
      productionRoleId: legacySet.productionRoleId,
      productionRoleName: legacySet.productionRoleName,
      startSlot: legacySet.startSlot,
      normalSlots: legacySet.normalSlots,
      vipSlots: legacySet.vipSlots,
      slots: legacySet.slots,
      lastSlotImport: legacySet.lastSlotImport,
      sets,
    });
  }

  private normalizeProductionDiscordLastSlotImport(
    value: unknown,
  ): ProductionDiscordLastSlotImport | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const raw = value as Record<string, unknown>;
    return {
      sourceChannelId: this.cleanString(raw.sourceChannelId),
      sourceMessageId: this.cleanString(raw.sourceMessageId),
      importedAt: this.cleanString(raw.importedAt) ?? new Date(0).toISOString(),
      parsedSlotRows: Math.max(0, Number(raw.parsedSlotRows) || 0),
      importedTeams: Math.max(0, Number(raw.importedTeams) || 0),
    };
  }

  private defaultProductionDiscordSet(index: number): ProductionDiscordSet {
    return {
      key: this.productionDiscordSetKey(index),
      index,
      setName: null,
      eventId: null,
      eventName: null,
      categoryId: null,
      categoryName: null,
      slotsChannelId: null,
      slotsChannelName: null,
      logosChannelId: null,
      logosChannelName: null,
      playerPhotosChannelId: null,
      playerPhotosChannelName: null,
      idpChannelId: null,
      idpChannelName: null,
      logsChannelId: null,
      logsChannelName: null,
      controlChannelId: null,
      controlChannelName: null,
      productionRoleId: null,
      productionRoleName: `Production ${index}`,
      startSlot: null,
      normalSlots: null,
      vipSlots: null,
      slots: [],
      lastSlotImport: null,
    };
  }

  private normalizeProductionDiscordSet(
    value: unknown,
    fallbackIndex: number,
    fallback?: ProductionDiscordSet,
  ): ProductionDiscordSet {
    const raw =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const fallbackSet =
      fallback ?? this.defaultProductionDiscordSet(fallbackIndex);
    const key = this.cleanProductionDiscordSetKey(
      raw.key ?? raw.setKey,
      fallbackSet.index,
    );
    const index = this.productionDiscordSetIndex(key, fallbackSet.index);
    return {
      key,
      index,
      setName:
        raw.setName !== undefined
          ? this.cleanString(raw.setName)
          : fallbackSet.setName,
      eventId:
        raw.eventId !== undefined
          ? this.cleanString(raw.eventId)
          : fallbackSet.eventId,
      eventName:
        raw.eventName !== undefined
          ? this.cleanString(raw.eventName)
          : fallbackSet.eventName,
      categoryId:
        raw.categoryId !== undefined
          ? this.cleanString(raw.categoryId)
          : fallbackSet.categoryId,
      categoryName:
        raw.categoryName !== undefined
          ? this.cleanString(raw.categoryName)
          : fallbackSet.categoryName,
      slotsChannelId:
        raw.slotsChannelId !== undefined
          ? this.cleanString(raw.slotsChannelId)
          : fallbackSet.slotsChannelId,
      slotsChannelName:
        raw.slotsChannelName !== undefined
          ? this.cleanString(raw.slotsChannelName)
          : fallbackSet.slotsChannelName,
      logosChannelId:
        raw.logosChannelId !== undefined
          ? this.cleanString(raw.logosChannelId)
          : fallbackSet.logosChannelId,
      logosChannelName:
        raw.logosChannelName !== undefined
          ? this.cleanString(raw.logosChannelName)
          : fallbackSet.logosChannelName,
      playerPhotosChannelId:
        raw.playerPhotosChannelId !== undefined
          ? this.cleanString(raw.playerPhotosChannelId)
          : fallbackSet.playerPhotosChannelId,
      playerPhotosChannelName:
        raw.playerPhotosChannelName !== undefined
          ? this.cleanString(raw.playerPhotosChannelName)
          : fallbackSet.playerPhotosChannelName,
      idpChannelId:
        raw.idpChannelId !== undefined
          ? this.cleanString(raw.idpChannelId)
          : fallbackSet.idpChannelId,
      idpChannelName:
        raw.idpChannelName !== undefined
          ? this.cleanString(raw.idpChannelName)
          : fallbackSet.idpChannelName,
      logsChannelId:
        raw.logsChannelId !== undefined
          ? this.cleanString(raw.logsChannelId)
          : fallbackSet.logsChannelId,
      logsChannelName:
        raw.logsChannelName !== undefined
          ? this.cleanString(raw.logsChannelName)
          : fallbackSet.logsChannelName,
      controlChannelId:
        raw.controlChannelId !== undefined
          ? this.cleanString(raw.controlChannelId)
          : fallbackSet.controlChannelId,
      controlChannelName:
        raw.controlChannelName !== undefined
          ? this.cleanString(raw.controlChannelName)
          : fallbackSet.controlChannelName,
      productionRoleId:
        raw.productionRoleId !== undefined
          ? this.cleanString(raw.productionRoleId)
          : fallbackSet.productionRoleId,
      productionRoleName:
        raw.productionRoleName !== undefined
          ? (this.cleanString(raw.productionRoleName) ?? `Production ${index}`)
          : (fallbackSet.productionRoleName ?? `Production ${index}`),
      startSlot:
        raw.startSlot !== undefined
          ? this.cleanSlotCount(raw.startSlot)
          : fallbackSet.startSlot,
      normalSlots:
        raw.normalSlots !== undefined
          ? this.cleanSlotCount(raw.normalSlots)
          : fallbackSet.normalSlots,
      vipSlots:
        raw.vipSlots !== undefined
          ? this.cleanSlotCount(raw.vipSlots)
          : fallbackSet.vipSlots,
      slots:
        raw.slots !== undefined
          ? this.normalizeProductionDiscordSlots(raw.slots)
          : fallbackSet.slots,
      lastSlotImport:
        raw.lastSlotImport !== undefined
          ? this.normalizeProductionDiscordLastSlotImport(raw.lastSlotImport)
          : fallbackSet.lastSlotImport,
    };
  }

  private withPrimaryProductionDiscordSet(
    config: ProductionDiscordConfig,
  ): ProductionDiscordConfig {
    const sets =
      config.sets.length > 0
        ? config.sets
        : [this.defaultProductionDiscordSet(1)];
    const primary = sets[0];
    return {
      ...config,
      categoryId: primary.categoryId,
      categoryName: primary.categoryName,
      slotsChannelId: primary.slotsChannelId,
      slotsChannelName: primary.slotsChannelName,
      logosChannelId: primary.logosChannelId,
      logosChannelName: primary.logosChannelName,
      playerPhotosChannelId: primary.playerPhotosChannelId,
      playerPhotosChannelName: primary.playerPhotosChannelName,
      idpChannelId: primary.idpChannelId,
      idpChannelName: primary.idpChannelName,
      logsChannelId: primary.logsChannelId,
      logsChannelName: primary.logsChannelName,
      controlChannelId: primary.controlChannelId,
      controlChannelName: primary.controlChannelName,
      productionRoleId: primary.productionRoleId,
      productionRoleName: primary.productionRoleName,
      startSlot: primary.startSlot,
      normalSlots: primary.normalSlots,
      vipSlots: primary.vipSlots,
      slots: primary.slots,
      lastSlotImport: primary.lastSlotImport,
      sets,
    };
  }

  private productionDiscordConfigPatch(
    dto: UpdateProductionDiscordConfigDto,
  ): Partial<ProductionDiscordConfig> {
    const patch: Partial<ProductionDiscordConfig> = {};
    if (dto.enabled !== undefined) patch.enabled = dto.enabled !== false;
    if (dto.guildId !== undefined) {
      patch.guildId = this.cleanSnowflake(dto.guildId, 'guildId');
    }
    if (dto.guildName !== undefined) {
      patch.guildName = this.cleanString(dto.guildName);
    }
    if (dto.categoryId !== undefined) {
      patch.categoryId = this.cleanSnowflake(dto.categoryId, 'categoryId');
    }
    if (dto.categoryName !== undefined) {
      patch.categoryName = this.cleanString(dto.categoryName);
    }
    if (dto.slotsChannelId !== undefined) {
      patch.slotsChannelId = this.cleanSnowflake(
        dto.slotsChannelId,
        'slotsChannelId',
      );
    }
    if (dto.slotsChannelName !== undefined) {
      patch.slotsChannelName = this.cleanString(dto.slotsChannelName);
    }
    if (dto.logosChannelId !== undefined) {
      patch.logosChannelId = this.cleanSnowflake(
        dto.logosChannelId,
        'logosChannelId',
      );
    }
    if (dto.logosChannelName !== undefined) {
      patch.logosChannelName = this.cleanString(dto.logosChannelName);
    }
    if (dto.playerPhotosChannelId !== undefined) {
      patch.playerPhotosChannelId = this.cleanSnowflake(
        dto.playerPhotosChannelId,
        'playerPhotosChannelId',
      );
    }
    if (dto.playerPhotosChannelName !== undefined) {
      patch.playerPhotosChannelName = this.cleanString(
        dto.playerPhotosChannelName,
      );
    }
    if (dto.idpChannelId !== undefined) {
      patch.idpChannelId = this.cleanSnowflake(
        dto.idpChannelId,
        'idpChannelId',
      );
    }
    if (dto.idpChannelName !== undefined) {
      patch.idpChannelName = this.cleanString(dto.idpChannelName);
    }
    if (dto.logsChannelId !== undefined) {
      patch.logsChannelId = this.cleanSnowflake(
        dto.logsChannelId,
        'logsChannelId',
      );
    }
    if (dto.logsChannelName !== undefined) {
      patch.logsChannelName = this.cleanString(dto.logsChannelName);
    }
    if (dto.controlChannelId !== undefined) {
      patch.controlChannelId = this.cleanSnowflake(
        dto.controlChannelId,
        'controlChannelId',
      );
    }
    if (dto.controlChannelName !== undefined) {
      patch.controlChannelName = this.cleanString(dto.controlChannelName);
    }
    if (dto.productionRoleId !== undefined) {
      patch.productionRoleId = this.cleanSnowflake(
        dto.productionRoleId,
        'productionRoleId',
      );
    }
    if (dto.productionRoleName !== undefined) {
      patch.productionRoleName =
        this.cleanString(dto.productionRoleName) ?? 'Production';
    }
    if (dto.startSlot !== undefined) {
      patch.startSlot = this.cleanSlotCount(dto.startSlot);
    }
    if (dto.normalSlots !== undefined) {
      patch.normalSlots = this.cleanSlotCount(dto.normalSlots);
    }
    if (dto.vipSlots !== undefined) {
      patch.vipSlots = this.cleanSlotCount(dto.vipSlots);
    }
    return patch;
  }

  private productionDiscordSetPatch(
    dto: UpdateProductionDiscordConfigDto,
  ): Partial<ProductionDiscordSet> {
    const patch = this.productionDiscordConfigPatch(dto);
    delete patch.enabled;
    delete patch.guildId;
    delete patch.guildName;
    return patch as Partial<ProductionDiscordSet>;
  }

  private updateDtoTargetsProductionSet(dto: UpdateProductionDiscordConfigDto) {
    return [
      dto.setKey,
      dto.setIndex,
      dto.setName,
      dto.eventId,
      dto.categoryId,
      dto.categoryName,
      dto.slotsChannelId,
      dto.slotsChannelName,
      dto.logosChannelId,
      dto.logosChannelName,
      dto.playerPhotosChannelId,
      dto.playerPhotosChannelName,
      dto.idpChannelId,
      dto.idpChannelName,
      dto.logsChannelId,
      dto.logsChannelName,
      dto.controlChannelId,
      dto.controlChannelName,
      dto.productionRoleId,
      dto.productionRoleName,
      dto.startSlot,
      dto.normalSlots,
      dto.vipSlots,
    ].some((value) => value !== undefined);
  }

  private async applyProductionDiscordSetMetadataPatch(
    organizationId: string,
    productionSet: ProductionDiscordSet,
    dto: UpdateProductionDiscordConfigDto,
  ): Promise<ProductionDiscordSet> {
    const nextSet: ProductionDiscordSet = {
      ...productionSet,
      ...this.productionDiscordSetPatch(dto),
    };
    if (dto.setName !== undefined) {
      nextSet.setName = this.cleanString(dto.setName);
    }
    if (dto.eventId !== undefined) {
      const eventId = this.cleanString(dto.eventId);
      if (!eventId) {
        nextSet.eventId = null;
        nextSet.eventName = null;
      } else {
        const event = await this.prisma.session.findFirst({
          where: {
            id: eventId,
            organizationId,
            type: SessionType.EVENT,
            deletedAt: null,
          },
          select: { id: true, name: true },
        });
        if (!event) {
          throw new BadRequestException(
            'Production Discord set must be linked to an event in this organization',
          );
        }
        nextSet.eventId = event.id;
        nextSet.eventName = event.name;
      }
    }
    return nextSet;
  }

  private productionDiscordChannelKind(
    config: Pick<
      ProductionDiscordSet,
      | 'slotsChannelId'
      | 'logosChannelId'
      | 'playerPhotosChannelId'
      | 'idpChannelId'
      | 'logsChannelId'
      | 'controlChannelId'
    >,
    channelId: string,
  ): ProductionDiscordChannelKind | null {
    if (config.slotsChannelId === channelId) return 'slots';
    if (config.logosChannelId === channelId) return 'logos';
    if (config.playerPhotosChannelId === channelId) return 'player-photos';
    if (config.idpChannelId === channelId) return 'idp';
    if (config.logsChannelId === channelId) return 'logs';
    if (config.controlChannelId === channelId) return 'control';
    return null;
  }

  private productionDiscordSetForChannel(
    config: ProductionDiscordConfig,
    channelId: string,
  ): {
    set: ProductionDiscordSet;
    channelKind: ProductionDiscordChannelKind;
  } | null {
    for (const set of config.sets) {
      const channelKind = this.productionDiscordChannelKind(set, channelId);
      if (channelKind) return { set, channelKind };
    }
    return null;
  }

  private productionDiscordSetLabel(set: ProductionDiscordSet) {
    return set.setName ?? `set-${set.index}`;
  }

  private productionDiscordSetHasResources(set: ProductionDiscordSet) {
    return Boolean(
      set.categoryId ||
      set.slotsChannelId ||
      set.logosChannelId ||
      set.playerPhotosChannelId ||
      set.idpChannelId ||
      set.logsChannelId ||
      set.controlChannelId ||
      set.productionRoleId ||
      set.slots.length > 0 ||
      set.lastSlotImport,
    );
  }

  private nextProductionDiscordSetIndex(config: ProductionDiscordConfig) {
    for (let index = 1; index <= 20; index += 1) {
      const key = this.productionDiscordSetKey(index);
      const existing = config.sets.find((set) => set.key === key);
      if (!existing) return index;
      if (
        !existing.eventId &&
        !this.productionDiscordSetHasResources(existing)
      ) {
        return index;
      }
    }
    throw new BadRequestException('Production Discord set limit reached');
  }

  private upsertProductionDiscordSet(
    config: ProductionDiscordConfig,
    nextSet: ProductionDiscordSet,
  ): ProductionDiscordConfig {
    const sets = [...config.sets];
    const existingIndex = sets.findIndex((set) => set.key === nextSet.key);
    if (existingIndex >= 0) {
      sets[existingIndex] = nextSet;
    } else {
      sets.push(nextSet);
    }
    sets.sort((left, right) => left.index - right.index);
    return this.withPrimaryProductionDiscordSet({ ...config, sets });
  }

  private async getProductionDiscordFeatureRow(organizationId: string) {
    return this.prisma.organizationFeature.findUnique({
      where: {
        organizationId_featureKey: {
          organizationId,
          featureKey: PRODUCTION_DISCORD_FEATURE_KEY,
        },
      },
    });
  }

  private async assertProductionDiscordApproved(
    organizationId: string,
    actor?: ActorLike | null,
  ) {
    const feature = await this.getProductionDiscordFeatureRow(organizationId);
    if (feature?.isEnabled === true || this.isSuperActor(actor)) {
      return feature;
    }
    throw new ForbiddenException(
      'Production Discord is not approved for this organization',
    );
  }

  private async assertProductionDiscordGuildAllowed(
    organizationId: string,
    guildId: string | null,
  ) {
    if (!guildId) return;
    const linkedGuild = await this.prisma.organizationDiscordGuild.findFirst({
      where: {
        organizationId,
        guildId,
        enabled: true,
        organization: { deletedAt: null },
      },
      select: { guildId: true },
    });
    if (linkedGuild) return;
    const legacyConfig = await this.prisma.organizationDiscordConfig.findFirst({
      where: {
        organizationId,
        guildId,
        enabled: true,
        organization: { deletedAt: null },
      },
      select: { guildId: true },
    });
    if (legacyConfig) return;
    throw new BadRequestException(
      'Production Discord guild must be connected to this organization',
    );
  }

  private actorId(actor?: ActorLike | null): string | null {
    return actor?.actorId ?? actor?.id ?? actor?.sub ?? null;
  }

  private async productionTeamOwnerId(
    tx: Prisma.TransactionClient,
    organizationId: string,
    actor?: ActorLike | null,
  ) {
    const actorId = this.actorId(actor);
    if (actorId) return actorId;
    const organization = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { ownerUserId: true },
    });
    if (organization?.ownerUserId) return organization.ownerUserId;
    throw new BadRequestException('Team owner could not be resolved');
  }

  private async findOrCreateProductionTeam(params: {
    tx: Prisma.TransactionClient;
    organizationId: string;
    ownerUserId: string;
    name: string;
    tag?: string | null;
  }) {
    const name = params.name.trim().replace(/\s+/g, ' ');
    if (!name) {
      throw new BadRequestException('Team name is required');
    }
    const tagResult = normalizeAndValidateTeamTag(params.tag);
    if (tagResult.error) {
      throw new BadRequestException(tagResult.error);
    }
    const tag = tagResult.normalized;
    const existingByName = await params.tx.team.findFirst({
      where: {
        organizationId: params.organizationId,
        deletedAt: null,
        name: { equals: name, mode: 'insensitive' },
      },
      select: { id: true, name: true, tag: true, logoUrl: true },
    });
    if (existingByName) {
      if (tag && !existingByName.tag) {
        return params.tx.team.update({
          where: { id: existingByName.id },
          data: { tag },
          select: { id: true, name: true, tag: true, logoUrl: true },
        });
      }
      return existingByName;
    }
    return params.tx.team.create({
      data: {
        organizationId: params.organizationId,
        ownerUserId: params.ownerUserId,
        name,
        tag,
      },
      select: { id: true, name: true, tag: true, logoUrl: true },
    });
  }

  private productionEventNoteValue(
    note: string | null | undefined,
    key: string,
  ): string | null {
    if (!note?.startsWith(PRODUCTION_EVENT_IMPORT_NOTE_PREFIX)) return null;
    const payload = note.slice(PRODUCTION_EVENT_IMPORT_NOTE_PREFIX.length);
    for (const part of payload.split(';')) {
      const [rawKey, ...rawValue] = part.split('=');
      if (rawKey?.trim() !== key) continue;
      const value = rawValue.join('=').trim();
      return value || null;
    }
    return null;
  }

  private productionEventNoteMatchesChannel(
    note: string | null | undefined,
    channelId: string | null,
  ) {
    if (!note?.startsWith(PRODUCTION_EVENT_IMPORT_NOTE_PREFIX)) return false;
    if (!channelId) return true;
    const noteChannelId = this.productionEventNoteValue(note, 'channel');
    return !noteChannelId || noteChannelId === channelId;
  }

  private productionEventImportNote(params: {
    setKey: string | null;
    categoryId: string | null;
    slotListChannelId: string | null;
    sourceMessageId: string | null;
    slotNumber: number;
  }) {
    const parts = [
      `category=${params.categoryId ?? PRODUCTION_EVENT_IMPORT_CATEGORY_ID}`,
      `channel=${params.slotListChannelId ?? ''}`,
    ];
    if (params.setKey) {
      parts.push(`set=${params.setKey}`);
    }
    if (params.sourceMessageId) {
      parts.push(`message=${params.sourceMessageId}`);
    }
    parts.push(`slot=${params.slotNumber}`);
    return `${PRODUCTION_EVENT_IMPORT_NOTE_PREFIX}${parts.join(';')}`;
  }

  private productionEventSlotCount(
    slots: ProductionDiscordSlot[],
    currentSlotCount: number,
  ) {
    const maxSlot = slots.reduce(
      (max, slot) => Math.max(max, slot.slotNumber),
      0,
    );
    return Math.min(100, Math.max(currentSlotCount, maxSlot));
  }

  private async findProductionEventAutoSyncTargetById(params: {
    organizationId: string;
    eventId: string | null;
  }): Promise<ProductionEventAutoSyncTarget | null> {
    if (!params.eventId) return null;
    const session = await this.prisma.session.findFirst({
      where: {
        id: params.eventId,
        organizationId: params.organizationId,
        deletedAt: null,
        type: SessionType.EVENT,
        status: { in: [...PRODUCTION_EVENT_AUTO_SYNC_STATUSES] },
      },
      select: {
        id: true,
        name: true,
        slotCount: true,
        maxTeams: true,
      },
    });
    if (!session) return null;
    return {
      id: session.id,
      name: session.name,
      slotCount: session.slotCount,
      maxTeams: session.maxTeams,
    };
  }

  private async applyProductionSlotsToEvent(params: {
    tx: Prisma.TransactionClient;
    organizationId: string;
    target: ProductionEventAutoSyncTarget;
    productionSet: ProductionDiscordSet;
  }) {
    const sourceChannelId = params.productionSet.slotsChannelId;
    const nextSlotCount = this.productionEventSlotCount(
      params.productionSet.slots,
      params.target.slotCount,
    );
    const nextMaxTeams = Math.max(params.target.maxTeams, nextSlotCount);
    if (
      nextSlotCount !== params.target.slotCount ||
      nextMaxTeams !== params.target.maxTeams
    ) {
      await params.tx.session.update({
        where: { id: params.target.id },
        data: {
          slotCount: nextSlotCount,
          maxTeams: nextMaxTeams,
        },
        select: { id: true },
      });
    }

    const existingRegistrations = await params.tx.sessionRegistration.findMany({
      where: {
        organizationId: params.organizationId,
        sessionId: params.target.id,
        deletedAt: null,
      },
      select: {
        id: true,
        teamId: true,
        status: true,
        slotNumber: true,
        note: true,
      },
    });
    const productionRegistrations = existingRegistrations.filter(
      (registration) =>
        this.productionEventNoteMatchesChannel(
          registration.note,
          sourceChannelId,
        ),
    );
    const touchedRegistrationIds = new Set<string>();
    const touchedTeamIds = new Set<string>();
    const skipped: ProductionEventAutoSyncResult['skipped'] = [];
    const now = new Date();

    for (const slot of params.productionSet.slots) {
      if (touchedTeamIds.has(slot.teamId)) {
        skipped.push({
          slotNumber: slot.slotNumber,
          teamName: slot.teamName,
          reason: 'team appears more than once in the production slot-list',
        });
        continue;
      }

      const slotConflict = existingRegistrations.find(
        (registration) =>
          registration.slotNumber === slot.slotNumber &&
          registration.teamId !== slot.teamId &&
          !this.productionEventNoteMatchesChannel(
            registration.note,
            sourceChannelId,
          ) &&
          registration.status !== SessionRegistrationStatus.REMOVED &&
          registration.status !== SessionRegistrationStatus.DECLINED,
      );
      if (slotConflict) {
        skipped.push({
          slotNumber: slot.slotNumber,
          teamName: slot.teamName,
          reason: 'slot is already held by a manual registration',
        });
        continue;
      }

      touchedTeamIds.add(slot.teamId);
      const note = this.productionEventImportNote({
        setKey: params.productionSet.key,
        categoryId: params.productionSet.categoryId,
        slotListChannelId: sourceChannelId,
        sourceMessageId:
          params.productionSet.lastSlotImport?.sourceMessageId ?? null,
        slotNumber: slot.slotNumber,
      });
      const existing = existingRegistrations.find(
        (registration) => registration.teamId === slot.teamId,
      );
      const importedSlot = existingRegistrations.find(
        (registration) =>
          registration.slotNumber === slot.slotNumber &&
          this.productionEventNoteMatchesChannel(
            registration.note,
            sourceChannelId,
          ),
      );

      if (existing && importedSlot && existing.id !== importedSlot.id) {
        await params.tx.sessionRegistration.update({
          where: { id: importedSlot.id },
          data: {
            status: SessionRegistrationStatus.REMOVED,
            slotNumber: null,
            waitlistPosition: null,
            removedAt: now,
            removalReason: 'Replaced by production slot-list import',
          },
          select: { id: true },
        });
        importedSlot.status = SessionRegistrationStatus.REMOVED;
        importedSlot.slotNumber = null;
      }

      if (existing) {
        const updated = await params.tx.sessionRegistration.update({
          where: { id: existing.id },
          data: {
            teamId: slot.teamId,
            status: SessionRegistrationStatus.CONFIRMED,
            slotNumber: slot.slotNumber,
            waitlistPosition: null,
            confirmedAt: now,
            checkedInAt: null,
            removedAt: null,
            removalReason: null,
            deletedAt: null,
            note,
          },
          select: { id: true },
        });
        existing.status = SessionRegistrationStatus.CONFIRMED;
        existing.slotNumber = slot.slotNumber;
        existing.note = note;
        touchedRegistrationIds.add(updated.id);
      } else if (importedSlot) {
        const updated = await params.tx.sessionRegistration.update({
          where: { id: importedSlot.id },
          data: {
            teamId: slot.teamId,
            status: SessionRegistrationStatus.CONFIRMED,
            slotNumber: slot.slotNumber,
            waitlistPosition: null,
            confirmedAt: now,
            checkedInAt: null,
            removedAt: null,
            removalReason: null,
            deletedAt: null,
            note,
          },
          select: { id: true },
        });
        importedSlot.teamId = slot.teamId;
        importedSlot.status = SessionRegistrationStatus.CONFIRMED;
        importedSlot.slotNumber = slot.slotNumber;
        importedSlot.note = note;
        touchedRegistrationIds.add(updated.id);
      } else {
        const created = await params.tx.sessionRegistration.create({
          data: {
            organizationId: params.organizationId,
            sessionId: params.target.id,
            teamId: slot.teamId,
            status: SessionRegistrationStatus.CONFIRMED,
            slotNumber: slot.slotNumber,
            waitlistPosition: null,
            confirmedAt: now,
            checkedInAt: null,
            note,
          },
          select: { id: true },
        });
        existingRegistrations.push({
          id: created.id,
          teamId: slot.teamId,
          status: SessionRegistrationStatus.CONFIRMED,
          slotNumber: slot.slotNumber,
          note,
        });
        touchedRegistrationIds.add(created.id);
      }
    }

    let removedTeams = 0;
    for (const registration of productionRegistrations) {
      if (touchedRegistrationIds.has(registration.id)) continue;
      if (registration.status !== SessionRegistrationStatus.REMOVED) {
        removedTeams += 1;
      }
      await params.tx.sessionRegistration.update({
        where: { id: registration.id },
        data: {
          status: SessionRegistrationStatus.REMOVED,
          slotNumber: null,
          waitlistPosition: null,
          removedAt: now,
          removalReason: 'Removed from production slot-list import',
        },
        select: { id: true },
      });
    }

    return {
      importedTeams: touchedRegistrationIds.size,
      removedTeams,
      skipped,
    };
  }

  private async syncDraftProductionEventMatchesFromRegistrations(
    sessionId: string,
    organizationId: string,
  ) {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, organizationId, deletedAt: null },
      select: { slotCount: true },
    });
    const matches = await this.prisma.match.findMany({
      where: {
        sessionId,
        organizationId,
        deletedAt: null,
        status: MatchStatus.DRAFT,
        liveState: LiveState.UPCOMING,
      },
      select: {
        id: true,
        slotCount: true,
        dataMode: true,
        dataSource: true,
      },
      orderBy: [{ matchNumber: 'asc' }, { createdAt: 'asc' }],
    });

    const synced: SyncSessionMatchSlotsResult[] = [];
    for (const match of matches) {
      if (session && match.slotCount !== session.slotCount) {
        await this.prisma.match.update({
          where: { id: match.id },
          data: { slotCount: session.slotCount },
        });
      }
      const result = await syncMatchSlotsWithSessionRegistrations(this.prisma, {
        sessionId,
        organizationId,
        matchId: match.id,
        dataMode: match.dataMode,
        dataSource: match.dataSource,
      });
      synced.push(result);
    }
    return synced;
  }

  private async syncLinkedProductionEventFromSlots(params: {
    organizationId: string;
    productionSet: ProductionDiscordSet;
  }): Promise<ProductionEventAutoSyncResult | null> {
    if (params.productionSet.slots.length === 0) return null;
    const target = await this.findProductionEventAutoSyncTargetById({
      organizationId: params.organizationId,
      eventId: params.productionSet.eventId,
    });
    if (!target) return null;

    const slotImport = await this.prisma.$transaction((tx) =>
      this.applyProductionSlotsToEvent({
        tx,
        organizationId: params.organizationId,
        target,
        productionSet: params.productionSet,
      }),
    );
    const syncedMatches =
      await this.syncDraftProductionEventMatchesFromRegistrations(
        target.id,
        params.organizationId,
      );

    return {
      sessionId: target.id,
      sessionName: target.name,
      importedTeams: slotImport.importedTeams,
      removedTeams: slotImport.removedTeams,
      skipped: slotImport.skipped,
      syncedMatches,
    };
  }

  private async saveProductionDiscordConfig(
    organizationId: string,
    config: ProductionDiscordConfig,
    enabled: boolean,
  ) {
    const storedConfig = this.withPrimaryProductionDiscordSet(config);
    await this.prisma.organizationFeature.upsert({
      where: {
        organizationId_featureKey: {
          organizationId,
          featureKey: PRODUCTION_DISCORD_FEATURE_KEY,
        },
      },
      update: {
        config: storedConfig as unknown as Prisma.InputJsonValue,
      },
      create: {
        organizationId,
        featureKey: PRODUCTION_DISCORD_FEATURE_KEY,
        isEnabled: enabled,
        config: storedConfig as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private async hydrateProductionDiscordConfigEvents(
    organizationId: string,
    config: ProductionDiscordConfig,
  ): Promise<ProductionDiscordConfig> {
    const eventIds = [
      ...new Set(
        config.sets
          .map((set) => set.eventId)
          .filter((eventId): eventId is string => Boolean(eventId)),
      ),
    ];
    if (eventIds.length === 0) return config;
    const events = await this.prisma.session.findMany({
      where: {
        organizationId,
        id: { in: eventIds },
        type: SessionType.EVENT,
        deletedAt: null,
      },
      select: { id: true, name: true },
    });
    const eventsById = new Map(events.map((event) => [event.id, event]));
    return this.withPrimaryProductionDiscordSet({
      ...config,
      sets: config.sets.map((set) => {
        if (!set.eventId) return set;
        const event = eventsById.get(set.eventId);
        return event ? { ...set, eventName: event.name } : set;
      }),
    });
  }

  async getProductionDiscordConfig(
    organizationId: string,
    actor?: ActorLike | null,
  ) {
    const feature = await this.getProductionDiscordFeatureRow(organizationId);
    const config = await this.hydrateProductionDiscordConfigEvents(
      organizationId,
      this.normalizeProductionDiscordConfig(feature?.config),
    );
    return {
      organizationId,
      featureKey: PRODUCTION_DISCORD_FEATURE_KEY,
      approved: feature?.isEnabled === true,
      config,
      canEdit: feature?.isEnabled === true || this.isSuperActor(actor),
    };
  }

  async updateProductionDiscordConfig(
    organizationId: string,
    dto: UpdateProductionDiscordConfigDto,
    actor?: ActorLike | null,
  ) {
    const feature = await this.assertProductionDiscordApproved(
      organizationId,
      actor,
    );
    const current = this.normalizeProductionDiscordConfig(feature?.config);
    let next = this.withPrimaryProductionDiscordSet({
      ...current,
      ...this.productionDiscordConfigPatch(dto),
    });
    if (this.updateDtoTargetsProductionSet(dto)) {
      const setKey =
        dto.setKey !== undefined
          ? this.cleanProductionDiscordSetKey(dto.setKey, 1)
          : dto.setIndex !== undefined && dto.setIndex !== null
            ? this.productionDiscordSetKey(dto.setIndex)
            : (current.sets[0]?.key ?? this.productionDiscordSetKey(1));
      const setIndex = this.productionDiscordSetIndex(
        setKey,
        current.sets.length + 1,
      );
      const currentSet =
        current.sets.find((set) => set.key === setKey) ??
        this.defaultProductionDiscordSet(setIndex);
      const nextSet = await this.applyProductionDiscordSetMetadataPatch(
        organizationId,
        currentSet,
        dto,
      );
      next = this.upsertProductionDiscordSet(next, nextSet);
    }
    await this.assertProductionDiscordGuildAllowed(
      organizationId,
      next.guildId,
    );
    await this.saveProductionDiscordConfig(
      organizationId,
      next,
      feature?.isEnabled === true,
    );
    return this.getProductionDiscordConfig(organizationId, actor);
  }

  async createProductionDiscordSet(
    organizationId: string,
    dto: CreateProductionDiscordSetDto,
    actor?: ActorLike | null,
  ) {
    const feature = await this.assertProductionDiscordApproved(
      organizationId,
      actor,
    );
    const current = this.normalizeProductionDiscordConfig(feature?.config);
    const eventId = this.cleanString(dto.eventId);
    if (eventId) {
      const linked = current.sets.find((set) => set.eventId === eventId);
      if (linked) {
        return {
          ...(await this.getProductionDiscordConfig(organizationId, actor)),
          setKey: linked.key,
          setName: this.productionDiscordSetLabel(linked),
        };
      }
    }

    const setIndex = this.nextProductionDiscordSetIndex(current);
    const setKey = this.productionDiscordSetKey(setIndex);
    const baseSet =
      current.sets.find((set) => set.key === setKey) ??
      this.defaultProductionDiscordSet(setIndex);
    const nextSet = await this.applyProductionDiscordSetMetadataPatch(
      organizationId,
      {
        ...baseSet,
        setName: baseSet.setName ?? `set-${setIndex}`,
        productionRoleName:
          baseSet.productionRoleName ?? `Production ${setIndex}`,
      },
      {
        setKey,
        setIndex,
        setName: baseSet.setName ?? `set-${setIndex}`,
        eventId: eventId ?? null,
      },
    );
    const next = this.upsertProductionDiscordSet(current, nextSet);
    await this.assertProductionDiscordGuildAllowed(
      organizationId,
      next.guildId,
    );
    await this.saveProductionDiscordConfig(
      organizationId,
      next,
      feature?.isEnabled === true,
    );
    return {
      ...(await this.getProductionDiscordConfig(organizationId, actor)),
      setKey: nextSet.key,
      setName: this.productionDiscordSetLabel(nextSet),
    };
  }

  async deleteProductionDiscordSet(
    organizationId: string,
    setKeyValue: string,
    actor?: ActorLike | null,
  ) {
    const feature = await this.assertProductionDiscordApproved(
      organizationId,
      actor,
    );
    const current = this.normalizeProductionDiscordConfig(feature?.config);
    const setKey = this.cleanProductionDiscordSetKey(setKeyValue, 1);
    const existing = current.sets.find((set) => set.key === setKey);
    if (!existing) {
      throw new NotFoundException('Production Discord set not found');
    }
    const next = this.withPrimaryProductionDiscordSet({
      ...current,
      sets: current.sets.filter((set) => set.key !== setKey),
    });
    await this.saveProductionDiscordConfig(
      organizationId,
      next,
      feature?.isEnabled === true,
    );
    return {
      ...(await this.getProductionDiscordConfig(organizationId, actor)),
      deletedSetKey: setKey,
      deletedSetName: this.productionDiscordSetLabel(existing),
    };
  }

  async resolveProductionDiscordChannel(params: {
    guildId?: string | null;
    channelId?: string | null;
    actor?: ActorLike | null;
  }) {
    const guildId = this.cleanSnowflake(params.guildId, 'guildId');
    const channelId = this.cleanSnowflake(params.channelId, 'channelId');
    if (!guildId || !channelId) {
      throw new BadRequestException('guildId and channelId are required');
    }
    const role = params.actor?.actorRole ?? params.actor?.role ?? null;
    if (role !== Role.SUPER_ADMIN && role !== Role.ORGANIZER) {
      throw new ForbiddenException('Organizer role required');
    }
    let organizationId: string | null = null;
    if (
      !params.actor?.serviceToken &&
      !(role === Role.SUPER_ADMIN && !params.actor?.actingOrgId)
    ) {
      organizationId = effectiveOrganizationId(params.actor as AuthUser);
      if (!organizationId) {
        throw new ForbiddenException('Organization context missing');
      }
    }

    const rows = await this.prisma.organizationFeature.findMany({
      where: {
        featureKey: PRODUCTION_DISCORD_FEATURE_KEY,
        isEnabled: true,
        ...(organizationId ? { organizationId } : {}),
        organization: { deletedAt: null },
      },
      select: {
        organizationId: true,
        config: true,
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            isActive: true,
            status: true,
            subscriptionStatus: true,
            trialEndsAt: true,
            paidUntil: true,
            discordGuilds: {
              where: { guildId, enabled: true },
              select: { guildId: true, guildName: true },
            },
            discordConfig: {
              select: {
                guildId: true,
                guildName: true,
                enabled: true,
              },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    for (const row of rows) {
      const config = this.normalizeProductionDiscordConfig(row.config);
      const setMatch = this.productionDiscordSetForChannel(config, channelId);
      if (config.enabled === false || config.guildId !== guildId || !setMatch) {
        continue;
      }
      const linkedGuild =
        row.organization.discordGuilds.some(
          (guild) => guild.guildId === guildId,
        ) ||
        (row.organization.discordConfig?.enabled === true &&
          row.organization.discordConfig.guildId === guildId);
      if (!linkedGuild) continue;
      if (
        row.organization.isActive === false ||
        row.organization.status !== OrganizationStatus.APPROVED ||
        !organizationHasActiveSubscription(row.organization)
      ) {
        continue;
      }
      return {
        organizationId: row.organizationId,
        organizationName: row.organization.name,
        organizationSlug: row.organization.slug,
        guildId,
        channelId,
        channelKind: setMatch.channelKind,
        setKey: setMatch.set.key,
        setName: this.productionDiscordSetLabel(setMatch.set),
        eventId: setMatch.set.eventId,
        eventName: setMatch.set.eventName,
        set: setMatch.set,
        config,
      };
    }

    throw new NotFoundException(
      'Discord channel is not linked to production Discord',
    );
  }

  async importProductionDiscordSlots(
    organizationId: string,
    dto: ImportProductionDiscordSlotsDto,
    actor?: ActorLike | null,
  ) {
    const feature = await this.assertProductionDiscordApproved(
      organizationId,
      actor,
    );
    const config = this.normalizeProductionDiscordConfig(feature?.config);
    const setKey = dto.setKey
      ? this.cleanProductionDiscordSetKey(dto.setKey, 1)
      : null;
    const channelSet = dto.sourceChannelId
      ? this.productionDiscordSetForChannel(config, dto.sourceChannelId)
      : null;
    const productionSet =
      (setKey
        ? (config.sets.find((set) => set.key === setKey) ?? null)
        : (channelSet?.set ?? config.sets[0] ?? null)) ??
      this.defaultProductionDiscordSet(1);
    if (dto.guildId && config.guildId && dto.guildId !== config.guildId) {
      throw new BadRequestException(
        'Discord guild does not match production config',
      );
    }
    if (
      dto.sourceChannelId &&
      productionSet.slotsChannelId &&
      dto.sourceChannelId !== productionSet.slotsChannelId
    ) {
      throw new BadRequestException(
        'Discord channel does not match production slots channel',
      );
    }
    if (
      dto.sourceChannelId &&
      channelSet &&
      channelSet.channelKind !== 'slots'
    ) {
      throw new BadRequestException(
        'Discord channel is not a production slots channel',
      );
    }
    const message = {
      id: dto.sourceMessageId ?? 'production-slot-import',
      content: dto.content,
      embeds: [],
    } satisfies DiscordMessage;
    const rows = parseDiscordEventSlotRows([message], {
      startSlot: productionSet.startSlot,
      normalSlots: productionSet.normalSlots,
      vipSlots: productionSet.vipSlots,
      allowPlainTeamList: true,
    });
    if (rows.length === 0) {
      throw new BadRequestException('No slot rows detected');
    }

    const importedAt = new Date().toISOString();
    const ownerUserId = await this.prisma.$transaction(async (tx) =>
      this.productionTeamOwnerId(tx, organizationId, actor),
    );
    const slots = await this.prisma.$transaction(async (tx) => {
      const nextSlots: ProductionDiscordSlot[] = [];
      for (const row of rows) {
        const team = await this.findOrCreateProductionTeam({
          tx,
          organizationId,
          ownerUserId,
          name: row.teamName,
          tag: row.teamTag,
        });
        nextSlots.push({
          ...row,
          teamId: team.id,
          teamName: team.name,
          teamTag: team.tag,
          sourceChannelId: dto.sourceChannelId ?? null,
          sourceMessageId: dto.sourceMessageId ?? null,
          importedAt,
        });
      }
      return nextSlots.sort(
        (left, right) => left.slotNumber - right.slotNumber,
      );
    });

    const nextSet: ProductionDiscordSet = {
      ...productionSet,
      slots,
      lastSlotImport: {
        sourceChannelId: dto.sourceChannelId ?? null,
        sourceMessageId: dto.sourceMessageId ?? null,
        importedAt,
        parsedSlotRows: rows.length,
        importedTeams: slots.length,
      },
    };
    const nextConfig = this.upsertProductionDiscordSet(config, nextSet);
    await this.saveProductionDiscordConfig(organizationId, nextConfig, true);
    const autoSyncedEvent = await this.syncLinkedProductionEventFromSlots({
      organizationId,
      productionSet: nextSet,
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Production Discord slot sync failed for organization ${organizationId} set ${nextSet.key}: ${message}`,
      );
      return null;
    });
    return {
      organizationId,
      setKey: nextSet.key,
      setName: this.productionDiscordSetLabel(nextSet),
      eventId: nextSet.eventId,
      eventName: nextSet.eventName,
      importedTeams: slots.length,
      parsedSlotRows: rows.length,
      slots,
      config: nextConfig,
      autoSyncedEvent,
    };
  }

  async upsertProductionDiscordTeam(
    organizationId: string,
    dto: UpsertProductionDiscordTeamDto,
    actor?: ActorLike | null,
  ) {
    await this.assertProductionDiscordApproved(organizationId, actor);
    const ownerUserId = await this.prisma.$transaction(async (tx) =>
      this.productionTeamOwnerId(tx, organizationId, actor),
    );
    const team = await this.prisma.$transaction((tx) =>
      this.findOrCreateProductionTeam({
        tx,
        organizationId,
        ownerUserId,
        name: dto.name,
        tag: dto.tag,
      }),
    );
    return {
      organizationId,
      team,
      source: {
        guildId: dto.guildId ?? null,
        sourceChannelId: dto.sourceChannelId ?? null,
        sourceMessageId: dto.sourceMessageId ?? null,
      },
    };
  }

  private canControl(
    actor: ActorLike | null | undefined,
    ownerUserId: string,
  ): boolean {
    if (!actor) return false;
    const role = actor.role ?? actor.actorRole;
    const actorId = actor.actorId ?? actor.id ?? actor.sub;
    if (role === Role.SUPER_ADMIN) return true;
    return actorId === ownerUserId;
  }

  private async ensureTournament(
    orgId: string | null,
    tournamentId: string,
  ): Promise<{ id: string; organizationId: string | null }> {
    const tournament = await this.prisma.tournament.findFirst({
      where: { id: tournamentId, deletedAt: null },
      select: { id: true, organizationId: true },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    if (
      orgId &&
      tournament.organizationId &&
      tournament.organizationId !== orgId
    ) {
      throw new BadRequestException('Org mismatch');
    }
    if (!tournament.organizationId && orgId) {
      await this.prisma.tournament.update({
        where: { id: tournamentId },
        data: { organizationId: orgId },
      });
      return { ...tournament, organizationId: orgId };
    }
    return tournament;
  }

  private async getMatchOrThrow(
    orgId: string | null,
    matchId: string,
    actor?: ActorLike | null,
  ): Promise<MatchWithTournament> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: { tournament: true },
    });
    if (!match || match.deletedAt)
      throw new NotFoundException('Match not found');
    if (!match.tournamentId || !match.tournament) {
      throw new BadRequestException(
        'Session matches are not supported by production controls',
      );
    }
    const scopedMatch = match as MatchWithTournament;
    if (match.tournament.deletedAt)
      throw new NotFoundException('Tournament not found');
    if (actor && !this.canControl(actor, match.tournament.ownerUserId)) {
      throw new BadRequestException('Not allowed to control this match');
    }
    if (
      orgId &&
      match.tournament.organizationId &&
      match.tournament.organizationId !== orgId
    )
      throw new BadRequestException('Org mismatch');
    if (!match.tournament.organizationId && orgId) {
      await this.prisma.tournament.update({
        where: { id: match.tournamentId },
        data: { organizationId: orgId },
      });
      match.tournament.organizationId = orgId;
    }
    return scopedMatch;
  }

  private emitStatus(
    matchId: string,
    organizationId: string | null,
    status: 'UPCOMING' | 'LIVE' | 'ENDED' | 'PAUSED' | 'CANCELLED',
  ) {
    this.realtime.emitMatchStatusUpdated(organizationId, {
      matchId,
      status,
      updatedAt: new Date().toISOString(),
    });
  }

  private resolveEffectiveStatus(
    match: Pick<Match, 'status' | 'liveState'>,
  ): MatchStatus {
    if (match.liveState === 'LIVE') {
      return MatchStatus.LIVE;
    }
    if (match.liveState === 'ENDED') {
      return MatchStatus.FINISHED;
    }
    return isMatchFinishedStatus(match.status)
      ? MatchStatus.FINISHED
      : match.status;
  }

  private toControlActor(actor?: ActorLike | null): ControlActor | null {
    return actor
      ? {
          id: actor.id ?? actor.actorId ?? actor.sub ?? '',
          actorId: actor.actorId ?? actor.id ?? actor.sub ?? '',
          role: actor.role ?? actor.actorRole ?? null,
          actorRole: actor.actorRole ?? actor.role ?? null,
          organizationId: actor.organizationId ?? actor.actingOrgId ?? null,
          actingOrgId: actor.actingOrgId ?? null,
        }
      : null;
  }

  private isLegacyPcobControlMatch(match: {
    dataSource?: string | null;
    dataMode?: string | null;
    pcobSessionId?: string | null;
    pcobMode?: boolean | null;
    adapterKey?: string | null;
  }): boolean {
    return hasLegacyPcobControlSignal(match);
  }

  async startMatch(
    orgId: string | null,
    matchId: string,
    actor?: ActorLike | null,
  ): Promise<{ ok: true; dataMode: DataMode; notice?: string }> {
    const match = await this.getMatchOrThrow(orgId, matchId, actor);
    const effectiveStatus = this.resolveEffectiveStatus(match);

    if (effectiveStatus === MatchStatus.LIVE) {
      return {
        ok: true,
        dataMode: match.dataMode,
        notice:
          match.pcobMode === true ||
          match.dataMode === DataMode.PCOB ||
          match.dataSource === MatchDataSource.PCOB
            ? 'PCOB mode enabled - awaiting feed'
            : undefined,
      };
    }

    if (effectiveStatus !== MatchStatus.DRAFT) {
      throw new BadRequestException(
        'Match cannot be started from current status',
      );
    }

    const isPcob =
      match.pcobMode === true ||
      match.dataMode === DataMode.PCOB ||
      match.dataSource === MatchDataSource.PCOB;
    const shouldGenerateSession = isPcob && !match.pcobSessionId;
    const sessionUpdates: Prisma.MatchUpdateInput = shouldGenerateSession
      ? buildPcobBindingData(`sess_${randomUUID()}`)
      : {};

    const prepUpdates: Prisma.MatchUpdateInput = {
      ...sessionUpdates,
      pcobStatus: isPcob ? PcobStatus.PENDING : match.pcobStatus,
    };

    if (Object.keys(prepUpdates).length) {
      await this.prisma.match.update({
        where: { id: matchId },
        data: prepUpdates,
      });
    }

    const actorForControl = this.toControlActor(actor);

    await this.matchControl.startMatch(actorForControl, matchId, null, {
      source: 'production-service',
      requestedMatchId: matchId,
    });

    // Best-effort scoreboard refresh. Starting the match should not fail if
    // stale slot results from a previous run are temporarily inconsistent.
    void this.scoring.recomputeMatchAndTournament(matchId).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Post-start scoring refresh failed for match ${matchId}: ${message}`,
      );
    });

    return {
      ok: true,
      dataMode: match.dataMode,
      notice: isPcob ? 'PCOB mode enabled - awaiting feed' : undefined,
    };
  }

  async endMatch(
    orgId: string | null,
    matchId: string,
    actor?: ActorLike | null,
  ): Promise<{ ok: true }> {
    const match = await this.getMatchOrThrow(orgId, matchId, actor);

    if (this.resolveEffectiveStatus(match) !== MatchStatus.LIVE) {
      throw new BadRequestException('Match must be LIVE to end');
    }
    const actorForControl = this.toControlActor(actor);
    if (!actorForControl) {
      throw new BadRequestException('Actor is required to end a match');
    }
    await this.matchControl.endMatch(actorForControl, matchId);
    return { ok: true };
  }

  async publishOfficial(
    orgId: string | null,
    matchId: string,
    userId: string,
    actor?: ActorLike | null,
  ): Promise<{ ok: true }> {
    const match = await this.getMatchOrThrow(orgId, matchId, actor);

    if (!isMatchFinishedStatus(match.status)) {
      throw new BadRequestException(
        'Match must be ENDED before publishing official',
      );
    }

    const actorForControl =
      this.toControlActor(actor) ??
      ({
        id: userId,
        actorId: userId,
        role: Role.SUPER_ADMIN,
        actorRole: Role.SUPER_ADMIN,
        organizationId: null,
        actingOrgId: null,
      } satisfies ControlActor);
    await this.matchControl.confirmFinished(
      actorForControl,
      matchId,
      'publish-official',
    );

    this.emitStatus(
      matchId,
      match.tournament.organizationId ?? orgId ?? null,
      'ENDED',
    );
    void this.rankingEmitter.emitLiveRanking(matchId, { force: true });
    void this.rankingEmitter.emitOverallRanking(match.tournamentId, {
      force: true,
    });

    await this.auditService.log({
      organizationId: match.tournament.organizationId ?? orgId ?? null,
      userId,
      action: AuditAction.MATCH_STATUS_CHANGE,
      entityType: 'MATCH',
      entityId: matchId,
      source: 'SYSTEM',
    });

    return { ok: true };
  }

  async resetMatch(
    orgId: string | null,
    matchId: string,
    actor?: ActorLike | null,
  ): Promise<{ ok: true }> {
    await this.getMatchOrThrow(orgId, matchId, actor);

    // clear computed slot results instead of legacy team stats
    await this.prisma.matchSlotResult.updateMany({
      where: { matchId },
      data: {
        wasPresentInMatch: null,
        placement: null,
        placementPoints: 0,
        totalKills: 0,
        points: 0,
        totalPoints: 0,
        manualTotalKills: false,
      },
    });
    const actorForControl = this.toControlActor(actor);
    if (!actorForControl) {
      throw new BadRequestException('Actor is required to reset a match');
    }
    await this.matchControl.setStatus(actorForControl, matchId, {
      status: 'READY',
    });

    // recompute/publish to keep clients updated
    await this.scoring.recomputeMatchAndTournament(matchId);

    return { ok: true };
  }

  async createAdjustment(
    orgId: string | null,
    tournamentId: string,
    body: AdminAdjustmentDto,
  ): Promise<AdminAdjustment> {
    const tournament = await this.ensureTournament(orgId, tournamentId);

    // Validate team is registered in tournament
    const tt = await this.prisma.tournamentTeam.findFirst({
      where: { tournamentId, teamId: body.teamId, deletedAt: null },
    });
    if (!tt) throw new BadRequestException('Team not registered in tournament');

    const adjustmentData = {
      organizationId: tournament.organizationId ?? orgId ?? null,
      tournamentId,
      matchId: body.matchId ?? null,
      teamId: body.teamId,
      scope: body.matchId ? 'MATCH' : 'TOURNAMENT',
      type: 'POINT_DELTA',
      pointsDelta: Number(body.pointsDelta),
      reason: body.reason ?? 'Adjustment',
      createdById: body.createdById ?? null,
    } satisfies Prisma.AdminAdjustmentUncheckedCreateInput;

    const adj = await this.prisma.adminAdjustment.create({
      data: adjustmentData,
    });

    const anyMatch = await this.prisma.match.findFirst({
      where: { tournamentId, deletedAt: null },
    });
    if (anyMatch) {
      await this.scoring.recomputeMatchAndTournament(anyMatch.id);
      void this.rankingEmitter.emitLiveRanking(anyMatch.id, { force: true });
    }
    void this.rankingEmitter.emitOverallRanking(tournamentId, { force: true });

    return adj;
  }

  async softDeleteAdjustment(
    orgId: string | null,
    adjustmentId: string,
  ): Promise<{ ok: true }> {
    const adj = await this.prisma.adminAdjustment.findUnique({
      where: { id: adjustmentId },
    });
    if (!adj || adj.deletedAt)
      throw new NotFoundException('Adjustment not found');

    if (!adj.tournamentId) {
      throw new BadRequestException('Adjustment has no tournament scope');
    }
    await this.ensureTournament(orgId, adj.tournamentId);

    await this.prisma.adminAdjustment.update({
      where: { id: adjustmentId },
      data: { deletedAt: new Date() },
    });

    const anyMatch = await this.prisma.match.findFirst({
      where: { tournamentId: adj.tournamentId, deletedAt: null },
    });
    if (anyMatch) {
      await this.scoring.recomputeMatchAndTournament(anyMatch.id);
      void this.rankingEmitter.emitLiveRanking(anyMatch.id, { force: true });
    }
    void this.rankingEmitter.emitOverallRanking(adj.tournamentId, {
      force: true,
    });

    return { ok: true };
  }

  async restoreAdjustment(
    orgId: string | null,
    adjustmentId: string,
  ): Promise<{ ok: true }> {
    const adj = await this.prisma.adminAdjustment.findUnique({
      where: { id: adjustmentId },
    });
    if (!adj) throw new NotFoundException('Adjustment not found');

    if (!adj.tournamentId) {
      throw new BadRequestException('Adjustment has no tournament scope');
    }
    await this.ensureTournament(orgId, adj.tournamentId);

    await this.prisma.adminAdjustment.update({
      where: { id: adjustmentId },
      data: { deletedAt: null },
    });

    const anyMatch = await this.prisma.match.findFirst({
      where: { tournamentId: adj.tournamentId, deletedAt: null },
    });
    if (anyMatch) {
      await this.scoring.recomputeMatchAndTournament(anyMatch.id);
      void this.rankingEmitter.emitLiveRanking(anyMatch.id, { force: true });
    }
    void this.rankingEmitter.emitOverallRanking(adj.tournamentId, {
      force: true,
    });

    return { ok: true };
  }

  async bindPcob(
    orgId: string | null,
    matchId: string,
    sessionId: string,
    actor?: ActorLike | null,
  ): Promise<Match> {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new BadRequestException('pcobSessionId is required');
    }
    const match = await this.getMatchOrThrow(orgId, matchId, actor);
    if (isMatchFinishedStatus(match.status)) {
      throw new BadRequestException('Cannot bind PCOB on an ended match');
    }
    if (!this.isLegacyPcobControlMatch(match)) {
      throw new BadRequestException(
        'Legacy PCOB binding is disabled for API and MANUAL matches',
      );
    }
    const normalizedSessionId = sessionId.trim();
    const updated = await this.prisma.match.update({
      where: { id: matchId },
      data: buildPcobBindingData(normalizedSessionId),
    });
    this.pcobGateway.emitStatus(matchId, {
      type: 'pcob:match:bound',
      pcobSessionId: normalizedSessionId,
    });
    return updated;
  }

  async unbindPcob(
    orgId: string | null,
    matchId: string,
    actor?: ActorLike | null,
  ): Promise<Match> {
    const match = await this.getMatchOrThrow(orgId, matchId, actor);
    if (isMatchFinishedStatus(match.status)) {
      throw new BadRequestException('Cannot unbind PCOB on an ended match');
    }
    if (!this.isLegacyPcobControlMatch(match)) {
      throw new BadRequestException(
        'Legacy PCOB binding is disabled for API and MANUAL matches',
      );
    }
    const updated = await this.prisma.match.update({
      where: { id: matchId },
      data: buildPcobUnbindingData(),
    });
    this.pcobGateway.emitStatus(matchId, { type: 'pcob:match:unbound' });
    return updated;
  }
}
