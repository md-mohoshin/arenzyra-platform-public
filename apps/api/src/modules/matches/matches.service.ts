/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unsafe-call */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  DataMode,
  MatchDataSource,
  MatchResultSource,
  MatchEventType,
  MatchMap,
  MatchStatus,
  MatchTeamStatus,
  LiveState,
  LobbyStatus,
  PcobStatus,
  GameKey,
  Role,
  Prisma,
  AuditAction,
  SessionRegistrationStatus,
  TeamBanScope,
  TelemetrySource,
  TournamentStatus,
} from '@prisma/client';
import type { Actor as AuthActor } from '../../common/auth/jwt.strategy';
import { PrismaService } from '../../db/prisma.service';
import { ScoringService } from '../scoring/scoring.service';
import { PcobGateway } from '../pcob/pcob.gateway';
import { AdaptersService } from '../adapters/adapters.service';
import { ScoreboardService } from '../scoreboard/scoreboard.service';
import { AuditService } from '../audit/audit.service';
import { ResultsService } from '../results/results.service';
import { MatchControlService } from '../match-control/match-control.service';
import { ResultsEventsService } from '../results/results-events.service';
import { BroadcastService } from '../broadcast/broadcast.service';
import { StandingsService } from '../standings/standings.service';
import { type ResultLockState } from '../results/results.lock';
import {
  deriveControlLiveState,
  deriveGroupStateFromMatches,
  deriveStageStateFromGroups,
} from '../../common/live-state.util';
import {
  MatchControlStateStore,
  type LiveMatchState,
} from '../match-control/state.store';
import { CanonicalControlReadService } from '../realtime/canonical-control-read.service';
import { UpdateTeamResultsDto } from '../results/dto/update-team-results.dto';
import { detectOrganizationLiveMatchConflicts } from '../../common/live-match-conflict.util';
import { assertOrganizationGameAccess } from '../../common/org/organization-plan.util';
import { buildMatchPlayerKey } from '../../common/match-player-key.util';
import { uniqueSlotPlayerNames } from '../../common/slot-player-name.util';
import {
  comparePresenceStatus,
  derivePresenceStatus,
  isCompetitiveResultsTeam,
  isPresentInMatch,
} from '../../common/results-presence.util';
import { compareRankingRows } from '../../common/ranking-tiebreakers.util';
import {
  readLiveSyncContract,
  type LiveSyncAuditEntry,
} from '../../common/live-sync-contract.util';
import { derivePubgMatchState } from '../../common/pubg-match-rules.util';
import {
  deriveControlStateFromMatchStatus,
  deriveCanonicalMatchLifecycleStatus,
  deriveMatchLockContract,
  MATCH_FINISHED_STATUSES,
  normalizeMatchLifecycleStatus,
} from '../../common/match-status.util';
import { PCOB_ADAPTER_KEY } from '../../common/pcob-binding.util';
import {
  derivePcobBindingFlags,
  exposeCanonicalTelemetryProvider,
  exposeSourceMode,
  exposeTelemetryProvider,
  resolveCanonicalTelemetryProvider,
  resolveTelemetryProviderInput,
  type TelemetryProvider,
} from '../../common/match-telemetry-provider.util';
import {
  defaultSlotCountForGame,
  defaultTeamSizeForGame,
  resolvePlacementPointsForGame,
} from '../../common/game-rules.util';
import {
  ADMIN_ADJUSTMENT_SCOPES,
  ADMIN_ADJUSTMENT_TYPES,
  applyMatchScoreAdjustments,
  type AdminAdjustmentScopeValue,
  type AdminAdjustmentTypeValue,
  type ScoreAdjustmentMatchContext,
  type ScoreAdjustmentRecord,
} from '../../common/admin-adjustments.util';

export type Actor = Pick<
  AuthActor,
  'id' | 'actorId' | 'role' | 'actorRole' | 'organizationId' | 'actingOrgId'
>;

export type MatchCreatePayload = {
  name?: string | null;
  groupId?: string | null;
  map?: string | null;
  mapName?: string | null;
  slotCount?: number | null;
  recallEnabled?: boolean;
  dataMode?: string | null;
  dataSource?: string | null;
  resultSource?: string | null;
  pcobStatus?: string | null;
  pcobSessionId?: string | null;
  matchNumber?: number | null;
  gameId?: string | null;
  gameKey?: string | null;
  adapterKey?: string | null;
  status?: MatchStatus | null;
  scheduledAt?: string | number | Date | null;
  startAt?: string | number | Date | null;
  endsAt?: string | number | Date | null;
  loadTeamsFromGroup?: boolean | null;
};

export type MatchResultAdjustmentPayload = {
  teamId?: string | null;
  scope?: AdminAdjustmentScopeValue | string | null;
  type?: AdminAdjustmentTypeValue | string | null;
  pointsDelta?: number | string | null;
  reason?: string | null;
};

type ResultAdjustmentMatchContext = {
  id: string;
  organizationId: string | null;
  tournamentId: string | null;
  stageId: string | null;
  groupId: string | null;
  sessionId: string | null;
  tournament: {
    ownerUserId: string | null;
    organizationId: string | null;
    status: TournamentStatus;
  } | null;
};

type OrganizerResultsPlayerRow = {
  id: string;
  playerId: string;
  externalPlayerId: string | null;
  name: string;
  avatar: string | null;
  kills: number;
  damage: number | null;
  knocks: number | null;
  assists: number | null;
  alive: boolean | null;
  isAlive: boolean | null;
  isKnocked: boolean | null;
  ownership: unknown;
  audit: unknown;
};

export type SessionMatchCreatePayload = Omit<
  MatchCreatePayload,
  'groupId' | 'loadTeamsFromGroup'
> & {
  rulesetId?: string | null;
  loadTeamsFromEvent?: boolean | null;
};

export type ManualKillPayload = {
  teamId?: string;
  count?: number;
  playerId?: string;
};
const LOBBY_STATUS = {
  EMPTY: 'EMPTY',
  WAITING: 'WAITING',
  READY: 'READY',
  OFFLINE: 'OFFLINE',
} as const;

export type LobbyStatusValue = (typeof LOBBY_STATUS)[keyof typeof LOBBY_STATUS];

export type ManualPlacementPayload = {
  teamId?: string;
  placement?: number;
};

export type ManualMatchResultsPayload = {
  expectedVersion?: number | null;
  results?: Array<{
    teamId?: string;
    placement?: number;
    kills?: number;
  }>;
};
export type AssignSlotDto = {
  teamId: string;
  slot: number;
  replace?: boolean;
};

export type MoveSlotDto = {
  teamId: string;
  targetSlotNumber: number;
  sourceSlotNumber?: number | null;
};

export type SyncPreviousMatchSlotsDto = {
  overwrite?: boolean;
  dryRun?: boolean;
};

const getPlacementPoints = (
  placement?: number | null,
  gameKey?: GameKey | null,
): number => {
  return resolvePlacementPointsForGame(
    placement,
    gameKey ?? GameKey.PUBG_MOBILE,
  );
};

type SlotCapability = {
  usesSlots: boolean;
  maxSlots: number | null;
  adapterKey: string | null;
  gameKey: GameKey | null;
};

type SlotMatch = {
  id: string;
  organizationId: string;
  ownerUserId: string | null;
  tournamentId: string | null;
  sessionId: string | null;
  stageId: string | null;
  groupId: string | null;
  matchNumber?: number | null;
  adapterKey: string | null;
  status?: MatchStatus | null;
  slotCount?: number | null;
  dataSource?: string | null;
  dataMode?: string | null;
  liveState?: string | null;
  controlState?: { state?: string | null } | null;
  game: { key: GameKey } | null;
  tournament: {
    ownerUserId: string;
    organizationId: string | null;
    game?: GameKey | null;
  } | null;
};

type SlotContext = {
  match: SlotMatch;
  capability: SlotCapability;
};

type MatchTelemetryState = {
  dataMode?: string | null;
  dataSource?: string | null;
  pcobSessionId?: string | null;
  pcobMode?: boolean | null;
  pcobBoundAt?: Date | null;
  pcobLastSeenAt?: Date | null;
  adapterKey?: string | null;
  pcobKillSyncEnabled?: boolean | null;
};

type MatchTelemetryWriteData = {
  dataSource: MatchDataSource;
  dataMode: DataMode;
  pcobSessionId: string | null;
  pcobMode: boolean;
  adapterKey: string | null;
  pcobBoundAt?: Date | null;
  pcobLastSeenAt?: Date | null;
  pcobKillSyncEnabled?: boolean;
};

export type LiveStateUpdatePayload = {
  entity: 'MATCH' | 'GROUP' | 'STAGE' | 'TOURNAMENT';
  id: string;
  liveState: LiveState;
};

const MATCH_BASE_SELECT_TEMPLATE = {
  id: true,
  name: true,
  tournamentId: true,
  stageId: true,
  groupId: true,
  sessionId: true,
  gameId: true,
  map: true,
  recallEnabled: true,
  dataMode: true,
  dataSource: true,
  resultSource: true,
  telemetrySource: true,
  telemetrySourceLockedAt: true,
  pcobSessionId: true,
  pcobMode: true,
  pcobBoundAt: true,
  pcobLastSeenAt: true,
  pcobStatus: true,
  matchNumber: true,
  adapterKey: true,
  status: true,
  scheduledAt: true,
  startedAt: true,
  endedAt: true,
  liveState: true as any,
  liveAt: true as any,
  createdAt: true,
  updatedAt: true,
  controlState: { select: { state: true } },
  slotCount: true,
} as const;

const buildBaseSelect = (prisma: PrismaService) => {
  const select: Record<string, unknown> = { ...MATCH_BASE_SELECT_TEMPLATE };
  const fields: string[] =
    (
      (prisma as any)?._dmmf?.modelMap?.Match?.fields as
        | Array<{ name: string }>
        | undefined
    )?.map((f) => f.name) ?? [];
  // If DMMF metadata is unavailable (e.g., in some driver-adapter builds), keep the full template
  // so newer fields like liveState remain selected.
  if (!fields.length) return select;
  const supported = new Set(fields);
  Object.keys(select).forEach((key) => {
    if (!supported.has(key)) delete select[key];
  });
  return select;
};

const buildWithOwnerSelect = (base: Record<string, unknown>) => ({
  ...base,
  tournament: {
    select: {
      ownerUserId: true,
      organizationId: true,
      name: true,
      game: true,
      id: true,
    },
  },
  stage: { select: { id: true, name: true } },
  group: { select: { id: true, name: true } },
});

const buildListSelect = (base: Record<string, unknown>) => ({
  ...base,
  game: { select: { key: true, name: true } },
  tournament: { select: { id: true, name: true, game: true } },
  group: { select: { id: true, name: true } },
  matchTeams: {
    where: { deletedAt: null },
    include: { team: true },
    orderBy: { createdAt: 'asc' },
  },
  matchSlots: {
    select: {
      slotNumber: true,
      teamId: true,
      team: {
        select: {
          id: true,
          name: true,
          tag: true,
          logoUrl: true,
        },
      },
    },
    orderBy: { slotNumber: 'asc' },
  },
});

const buildContextSelect = (base: Record<string, unknown>) => ({
  ...base,
  tournament: true,
  game: { select: { key: true } },
  matchSlots: {
    select: {
      slotNumber: true,
      teamId: true,
      team: {
        select: {
          id: true,
          name: true,
          tag: true,
          logoUrl: true,
          players: true,
        },
      },
    },
    orderBy: { slotNumber: 'asc' },
  },
  matchTeams: {
    where: { deletedAt: null },
    include: { team: { include: { players: true } } },
  },
});

const sessionMatchListSelect = {
  id: true,
  name: true,
  sessionId: true,
  status: true,
  liveState: true,
  matchNumber: true,
  slotCount: true,
  map: true,
  dataMode: true,
  dataSource: true,
  resultSource: true,
  pcobSessionId: true,
  pcobMode: true,
  pcobBoundAt: true,
  pcobLastSeenAt: true,
  adapterKey: true,
  scheduledAt: true,
  startedAt: true,
  endedAt: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { matchTeams: true } },
} satisfies Prisma.MatchSelect;

type MatchCore = Record<string, unknown>;
type MatchWithOwner = Record<string, unknown>;
type MatchListItem = Record<string, unknown>;
export type SessionMatchListItem = Prisma.MatchGetPayload<{
  select: typeof sessionMatchListSelect;
}>;

const PUBGM_MAPS: MatchMap[] = [
  MatchMap.ERANGEL,
  MatchMap.MIRAMAR,
  MatchMap.SANHOK,
  MatchMap.VIKENDI,
  MatchMap.LIVIK,
  MatchMap.NUSA,
  MatchMap.KARAKIN,
  MatchMap.DESTON,
  MatchMap.RONDO,
];

const PUBGM_DATA_SOURCES: MatchDataSource[] = [
  MatchDataSource.MANUAL,
  MatchDataSource.API,
];

const TELEMETRY_RESULT_SOURCES: MatchDataSource[] = [MatchDataSource.API];

@Injectable()
export class MatchesService {
  private readonly logger = new Logger('MatchesService');
  private matchSelect: Record<string, unknown>;
  private matchWithOwnerSelect: Record<string, unknown>;
  private matchListSelect: Record<string, unknown>;
  private matchContextSelect: Record<string, unknown>;
  private readonly matchFieldSet: Set<string>;

  private hasModelField(model: string, field: string): boolean {
    const fields: Array<{ name: string }> =
      ((this.prisma as any)?._dmmf?.modelMap?.[model]?.fields as
        | Array<{ name: string }>
        | undefined) ?? [];
    return fields.some((f) => f.name === field);
  }

  private maybeOrg(
    model: string,
    orgId: string | null | undefined,
  ): Record<string, string> {
    if (!orgId) return {};
    return this.hasModelField(model, 'organizationId')
      ? ({ organizationId: orgId } as Record<string, string>)
      : {};
  }

  private getActorOrg(actor: Actor | null | undefined): string {
    const org = actor?.actingOrgId ?? actor?.organizationId ?? null;
    const actorRole = actor?.actorRole ?? actor?.role;
    if (!org) {
      if (actorRole === Role.SUPER_ADMIN) {
        throw new ForbiddenException(
          'SUPER_ADMIN must impersonate an organization to access this resource',
        );
      }
      throw new ForbiddenException('Organization context required');
    }
    return org;
  }

  private ensureOrgMatch(actor: Actor, targetOrgId: string | null) {
    const actorRole = actor?.actorRole ?? actor?.role;
    if (actorRole === Role.SUPER_ADMIN) return;
    const actorOrg = this.getActorOrg(actor);
    if (!targetOrgId || actorOrg !== targetOrgId) {
      throw new ForbiddenException('Not allowed to access this organization');
    }
  }

  constructor(
    private prisma: PrismaService,
    private scoring: ScoringService,
    private pcobGateway: PcobGateway,
    private adapters: AdaptersService,
    private scoreboard: ScoreboardService,
    @Inject(forwardRef(() => ResultsService))
    private readonly results: ResultsService,
    private readonly resultsEvents: ResultsEventsService,
    private readonly standings: StandingsService,
    private readonly broadcast: BroadcastService,
    private readonly auditService: AuditService,
    @Inject(forwardRef(() => MatchControlService))
    private readonly matchControl: MatchControlService,
    private readonly controlStateStore: MatchControlStateStore = null as never,
    @Inject(forwardRef(() => CanonicalControlReadService))
    private readonly canonicalRead: CanonicalControlReadService = null as never,
  ) {
    const base = buildBaseSelect(this.prisma);
    const fields: string[] =
      (
        (this.prisma as any)?._dmmf?.modelMap?.Match?.fields as
          | Array<{ name: string }>
          | undefined
      )?.map((f) => f.name) ?? [];
    this.matchFieldSet = new Set(fields);
    this.matchSelect = { id: true, ...base };
    this.matchWithOwnerSelect = { id: true, ...buildWithOwnerSelect(base) };
    this.matchListSelect = { id: true, ...buildListSelect(base) };
    this.matchContextSelect = { id: true, ...buildContextSelect(base) };
  }

  private normalizeMirrorPlayerKey(
    value: string | null | undefined,
  ): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim().toLowerCase();
    return trimmed.length ? trimmed : null;
  }

  private buildLiveMirrorPlayerIndex(team: LiveMatchState['teams'][number]) {
    const byExternalPlayerId = new Map<
      string,
      NonNullable<LiveMatchState['teams'][number]['players']>[number]
    >();
    const byName = new Map<
      string,
      NonNullable<LiveMatchState['teams'][number]['players']>[number]
    >();

    for (const player of team.players ?? []) {
      const externalPlayerId =
        this.normalizeMirrorPlayerKey(
          player.externalPlayerId ?? player.pubgPlayerId ?? player.playerId,
        ) ?? null;
      if (externalPlayerId && !byExternalPlayerId.has(externalPlayerId)) {
        byExternalPlayerId.set(externalPlayerId, player);
      }

      const name =
        this.normalizeMirrorPlayerKey(player.name ?? player.ign) ?? null;
      if (name && !byName.has(name)) {
        byName.set(name, player);
      }
    }

    return {
      byExternalPlayerId,
      byName,
    };
  }

  private overlayLiveMirrorPlayerRows(
    players: OrganizerResultsPlayerRow[],
    team: LiveMatchState['teams'][number] | null,
  ): OrganizerResultsPlayerRow[] {
    if (!team || !Array.isArray(team.players) || team.players.length === 0) {
      return players;
    }

    const index = this.buildLiveMirrorPlayerIndex(team);
    return players.map((player) => {
      const externalPlayerId =
        this.normalizeMirrorPlayerKey(player.externalPlayerId) ?? null;
      const name = this.normalizeMirrorPlayerKey(player.name) ?? null;
      const mirrorPlayer =
        (externalPlayerId
          ? index.byExternalPlayerId.get(externalPlayerId)
          : undefined) ??
        (name ? index.byName.get(name) : undefined) ??
        null;
      if (!mirrorPlayer) {
        return player;
      }

      return {
        ...player,
        kills: mirrorPlayer.kills ?? player.kills,
        alive: mirrorPlayer.alive,
        isAlive: mirrorPlayer.alive,
        isKnocked: mirrorPlayer.knocked,
      };
    });
  }

  private selectOrUndefined<T extends Record<string, unknown>>(
    select: T | undefined | null,
  ): T | undefined {
    if (!select) return undefined;
    return Object.keys(select).length ? select : undefined;
  }

  private pruneUnsupportedMatchFields<T extends Record<string, unknown>>(
    data: T,
  ): T {
    if (this.matchFieldSet.size === 0) return data;
    ['gameId', 'adapterKey', 'rulesetId', 'sessionId'].forEach((key) => {
      if (!this.matchFieldSet.has(key)) {
        delete (data as Record<string, unknown>)[key];
      }
    });
    return data;
  }

  private normalizeStatus(raw?: string | null): MatchStatus | undefined {
    if (!raw) return undefined;
    const upper = raw.toString().toUpperCase();
    return (Object.values(MatchStatus) as string[]).includes(upper)
      ? (upper as MatchStatus)
      : undefined;
  }

  private statusPriority(status?: MatchStatus | null): number {
    const value = (status ?? '').toString().toUpperCase();
    if (value === MatchStatus.LIVE) return 0;
    if (value === MatchStatus.DRAFT) return 1;
    return 2;
  }

  private readonly autoAssignSlotsOnLive =
    process.env.AUTO_ASSIGN_SLOTS_ON_LIVE !== 'false';

  async validatePubgSlots(matchId: string) {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        id: true,
        slotCount: true,
        game: { select: { key: true } },
        matchTeams: { where: { deletedAt: null }, select: { teamId: true } },
        matchSlots: {
          select: { slotNumber: true, teamId: true },
          orderBy: { slotNumber: 'asc' },
        },
      },
    });
    if (!match) throw new NotFoundException('Match not found');
    const maxSlots =
      (match.game?.key === GameKey.PUBG_MOBILE ? 25 : null) ??
      match.slotCount ??
      null;
    if (!maxSlots) return;

    const msg = `Matches require 2–${maxSlots} teams assigned to slots to go LIVE.`;
    const teamIds = new Set<string>();
    for (const slot of match.matchSlots ?? []) {
      if (slot.teamId) teamIds.add(slot.teamId);
    }
    const teamCount = teamIds.size;
    if (teamCount < 2 || teamCount > maxSlots) {
      throw new BadRequestException(msg);
    }

    // Validate provided slot numbers without requiring them.
    const seenSlots = new Set<number>();
    for (const slot of match.matchSlots ?? []) {
      const slotNumber = slot.slotNumber;
      if (slotNumber === null || slotNumber === undefined) continue;
      if (
        !Number.isInteger(slotNumber) ||
        slotNumber < 1 ||
        slotNumber > maxSlots
      ) {
        throw new BadRequestException(
          `Slot numbers must be between 1 and ${maxSlots}.`,
        );
      }
      if (seenSlots.has(slotNumber)) {
        throw new BadRequestException(
          'Slot numbers must be unique when provided.',
        );
      }
      seenSlots.add(slotNumber);
    }
  }

  async assignSlotsIfMissing(
    matchId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Array<{ teamId: string; slotNumber: number }>> {
    if (!this.autoAssignSlotsOnLive) return [];
    const run = async (prismaClient: Prisma.TransactionClient) => {
      const matchOrg = await prismaClient.match.findUnique({
        where: { id: matchId },
        select: {
          slotCount: true,
          dataSource: true,
          dataMode: true,
          controlState: { select: { metaJson: true } },
          game: { select: { key: true } },
          tournament: { select: { organizationId: true } },
        },
      });
      const manualClearedTeamIds = this.readMetaStringSet(
        this.toJsonRecord(matchOrg?.controlState?.metaJson ?? null)?.[
          'manualClearedTeamIds'
        ],
      );
      const maxSlots =
        matchOrg?.slotCount ??
        (matchOrg?.game?.key === GameKey.PUBG_MOBILE ? 25 : null) ??
        25;
      const teams = await prismaClient.matchTeam.findMany({
        where: { matchId, deletedAt: null },
        select: { teamId: true },
      });
      const slots = await prismaClient.matchSlot.findMany({
        where: { matchId },
        select: { slotNumber: true, teamId: true },
      });
      const used = new Set<number>();
      const slotByTeam = new Map<string, number>();
      slots.forEach((s) => {
        if (s.slotNumber && s.slotNumber >= 1 && s.slotNumber <= maxSlots) {
          used.add(s.slotNumber);
          if (s.teamId) slotByTeam.set(s.teamId, s.slotNumber);
        }
      });
      const available: number[] = [];
      for (let i = 1; i <= maxSlots; i++) {
        if (!used.has(i)) available.push(i);
      }
      const assignments: Array<{ teamId: string; slotNumber: number }> = [];
      for (const team of teams) {
        const tid = team.teamId;
        if (!tid) continue;
        if (slotByTeam.has(tid)) continue;
        if (manualClearedTeamIds.has(tid)) continue;
        const slotNumber = available.shift();
        if (!slotNumber) break;
        assignments.push({ teamId: tid, slotNumber });
        await prismaClient.matchSlot.upsert({
          where: { matchId_slotNumber: { matchId, slotNumber } },
          update: {
            teamId: tid,
            lobbyStatus:
              (
                matchOrg?.dataSource ??
                matchOrg?.dataMode ??
                ''
              ).toUpperCase() === MatchDataSource.MANUAL
                ? LOBBY_STATUS.WAITING
                : LOBBY_STATUS.OFFLINE,
            playersInLobby: 0,
          },
          create: {
            matchId,
            slotNumber,
            teamId: tid,
            lobbyStatus:
              (
                matchOrg?.dataSource ??
                matchOrg?.dataMode ??
                ''
              ).toUpperCase() === MatchDataSource.MANUAL
                ? LOBBY_STATUS.WAITING
                : LOBBY_STATUS.OFFLINE,
            playersInLobby: 0,
          },
        });
        await prismaClient.matchTeam.updateMany({
          where: { matchId, teamId: tid },
          data: { slot: slotNumber },
        });
      }
      return assignments;
    };

    if (tx) return run(tx);
    return this.prisma.$transaction((t) => run(t));
  }

  private canEdit(
    actor: Actor | null | undefined,
    ownerUserId: string | null | undefined,
    orgId?: string | null,
  ) {
    if (!actor) return false;
    const actorRole = actor.actorRole ?? actor.role;
    const actorId = actor.actorId ?? actor.id;
    if (actorRole === Role.SUPER_ADMIN) return true;
    if (
      orgId &&
      (actor.organizationId === orgId || actor.actingOrgId === orgId)
    )
      return true;
    return ownerUserId ? actorId === ownerUserId : false;
  }

  private resolveSlotCapability(
    adapterKey: string | null,
    gameKey: GameKey | null,
    slotCount?: number | null,
  ): SlotCapability {
    const adapter = this.adapters.getAdapterByKey(adapterKey);
    const forcedMax = gameKey === GameKey.PUBG_MOBILE ? 25 : null;
    const normalized =
      slotCount !== undefined && slotCount !== null ? Number(slotCount) : null;

    const maxSlots =
      (normalized && Number.isFinite(normalized) ? normalized : null) ??
      forcedMax ??
      adapter?.maxSlots ??
      null;

    const usesSlots =
      maxSlots !== null ||
      (adapter?.usesSlots ?? false) ||
      gameKey === GameKey.PUBG_MOBILE;

    return {
      usesSlots,
      maxSlots,
      adapterKey,
      gameKey,
    };
  }

  private ensureSlotsEnabled(capability: SlotCapability) {
    if (!capability.usesSlots) {
      throw new BadRequestException('This match/game does not use slots');
    }
  }

  private ensureSlotsEditable(match: {
    status?: MatchStatus | null;
    liveState?: string | null;
    dataSource?: string | null;
    dataMode?: string | null;
    controlState?: {
      state?: string | null;
      metaJson?: Prisma.JsonValue | null;
      resultsManualLock?: boolean | null;
      resultsForceUnlock?: boolean | null;
    } | null;
  }) {
    const lock = deriveMatchLockContract({
      status: match.status ?? null,
      liveState: match.liveState ?? match.controlState?.state ?? null,
      controlState: match.controlState?.state ?? null,
      metaJson: match.controlState?.metaJson ?? null,
      dataSource: match.dataSource ?? null,
      dataMode: match.dataMode ?? null,
      manualLock: match.controlState?.resultsManualLock ?? null,
      forceUnlock: match.controlState?.resultsForceUnlock ?? null,
    });
    if (lock.slotLocked) {
      throw new ForbiddenException('Slots cannot be edited after match ends');
    }
  }

  private validateSlotNumber(
    slotNumber: number,
    capability: SlotCapability,
  ): number {
    if (!Number.isInteger(slotNumber)) {
      throw new BadRequestException('slotNumber must be an integer');
    }
    if (slotNumber < 1) {
      throw new BadRequestException('slotNumber must be at least 1');
    }
    if (
      capability.maxSlots !== null &&
      capability.maxSlots !== undefined &&
      slotNumber > capability.maxSlots
    ) {
      throw new BadRequestException(
        `slotNumber must be between 1 and ${capability.maxSlots}`,
      );
    }
    return slotNumber;
  }

  private toJsonRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private toStringValue(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private readMetaStringSet(value: unknown): Set<string> {
    if (!Array.isArray(value)) {
      return new Set<string>();
    }

    return new Set<string>(
      value
        .map((entry) => this.toStringValue(entry))
        .filter((entry): entry is string => entry !== null),
    );
  }

  private async updateManualClearedTeamIds(
    matchId: string,
    organizationId: string | null | undefined,
    updater: (current: Set<string>) => Set<string>,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (!organizationId) {
      return;
    }

    const controlStateClient =
      tx &&
      'matchControlState' in tx &&
      tx.matchControlState &&
      typeof tx.matchControlState.findUnique === 'function' &&
      typeof tx.matchControlState.upsert === 'function'
        ? tx.matchControlState
        : this.prisma.matchControlState &&
            typeof this.prisma.matchControlState.findUnique === 'function' &&
            typeof this.prisma.matchControlState.upsert === 'function'
          ? this.prisma.matchControlState
          : null;
    if (!controlStateClient) {
      return;
    }
    const existing = await controlStateClient.findUnique({
      where: { matchId },
      select: { metaJson: true },
    });
    const meta = this.toJsonRecord(existing?.metaJson) ?? {};
    const current = this.readMetaStringSet(meta['manualClearedTeamIds']);
    const next = updater(new Set(current));
    const currentValues = [...current].sort();
    const nextValues = [...next].sort();

    if (
      currentValues.length === nextValues.length &&
      currentValues.every((value, index) => value === nextValues[index])
    ) {
      return;
    }

    const nextMeta: Record<string, unknown> = { ...meta };
    if (nextValues.length > 0) {
      nextMeta['manualClearedTeamIds'] = nextValues;
    } else {
      delete nextMeta['manualClearedTeamIds'];
    }

    await controlStateClient.upsert({
      where: { matchId },
      update: { metaJson: nextMeta as Prisma.InputJsonObject },
      create: {
        matchId,
        organizationId,
        state: 'READY',
        metaJson: nextMeta as Prisma.InputJsonObject,
      },
    });
  }

  private toIntValue(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    }
    return null;
  }

  private expectedLobbyReadyPlayers(gameKey: GameKey | null): number {
    switch (gameKey) {
      case GameKey.VALORANT:
      case GameKey.CS2:
      case GameKey.DOTA2:
      case GameKey.LOL:
      case GameKey.MLBB:
        return 5;
      case GameKey.PUBG_MOBILE:
      case GameKey.FREE_FIRE:
      case GameKey.CALL_OF_DUTY:
      case GameKey.FORTNITE:
      default:
        return 4;
    }
  }

  private extractTelemetryPlayerList(
    payload: Prisma.JsonValue | null,
  ): Array<Record<string, unknown>> {
    for (const source of this.collectTelemetryPayloadRecords(payload)) {
      for (const key of [
        'TotalPlayerList',
        'totalPlayerList',
        'PlayerList',
        'playerList',
        'PlayerInfoList',
        'playerInfoList',
        'players',
      ]) {
        const entries = this.toJsonRecordArray(source[key]);
        if (entries.length > 0) {
          return entries;
        }
      }
    }

    return [];
  }

  private telemetryTeamId(entry: Record<string, unknown>): string | null {
    const team = this.toJsonRecord(entry.team);
    return (
      this.toStringValue(entry.teamId) ??
      this.toStringValue(entry.teamID) ??
      this.toStringValue(entry.TeamId) ??
      this.toStringValue(entry.TeamID) ??
      this.toStringValue(entry.team_id) ??
      this.toStringValue(team?.id) ??
      null
    );
  }

  private telemetrySlotNumber(entry: Record<string, unknown>): number | null {
    const team = this.toJsonRecord(entry.team);
    const raw =
      entry.slot ??
      entry.slotNumber ??
      entry.Slot ??
      entry.SlotNumber ??
      entry.teamSlot ??
      team?.slot ??
      team?.slotNumber ??
      null;
    const parsed = this.toIntValue(raw);
    return parsed && parsed > 0 ? parsed : null;
  }

  private extractTelemetryTeamSnapshots(
    payload: Prisma.JsonValue | null,
  ): Array<{
    teamId: string | null;
    slotNumber: number | null;
    playersInLobby: number;
  }> {
    const teamEntries = this.collectTelemetryPayloadRecords(payload).flatMap(
      (source) =>
        ['teams', 'teamInfoList', 'TeamInfoList']
          .map((key) => this.toJsonRecordArray(source[key]))
          .find((entries) => entries.length > 0) ?? [],
    );

    if (teamEntries.length > 0) {
      return teamEntries
        .map((entry) => {
          const teamId =
            this.telemetryTeamId(entry) ?? this.toStringValue(entry.id) ?? null;
          const slotNumber = this.telemetrySlotNumber(entry);
          const players = this.extractTelemetryPlayerList(
            (entry.players as Prisma.JsonValue | null) ?? null,
          );
          return {
            teamId,
            slotNumber,
            playersInLobby: players.length,
          };
        })
        .filter((entry) => entry.teamId || entry.slotNumber !== null);
    }

    const playerEntries = this.extractTelemetryPlayerList(payload);
    const counts = new Map<
      string,
      {
        teamId: string | null;
        slotNumber: number | null;
        playersInLobby: number;
      }
    >();

    for (const player of playerEntries) {
      const teamId = this.telemetryTeamId(player);
      const slotNumber = this.telemetrySlotNumber(player);
      if (!teamId && slotNumber === null) continue;
      const key = teamId ? `team:${teamId}` : `slot:${slotNumber}`;
      const current = counts.get(key) ?? {
        teamId,
        slotNumber,
        playersInLobby: 0,
      };
      current.playersInLobby += 1;
      if (!current.teamId && teamId) current.teamId = teamId;
      if (current.slotNumber === null && slotNumber !== null) {
        current.slotNumber = slotNumber;
      }
      counts.set(key, current);
    }

    return Array.from(counts.values());
  }

  private collectTelemetryPayloadRecords(
    payload: unknown,
  ): Array<Record<string, unknown>> {
    const root = this.toJsonRecord(payload);
    if (!root) {
      return [];
    }

    const queue: Array<Record<string, unknown>> = [root];
    const records: Array<Record<string, unknown>> = [];
    const seen = new Set<Record<string, unknown>>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || seen.has(current)) {
        continue;
      }
      seen.add(current);
      records.push(current);

      for (const key of [
        'totalmessage',
        'setcircleinfo',
        'setobservingplayer',
        'setteambackpackinfo',
        'setteaminfo',
        'setteaminfolist',
      ]) {
        const nested = this.toJsonRecord(current[key]);
        if (nested && !seen.has(nested)) {
          queue.push(nested);
        }
      }
    }

    return records;
  }

  private toJsonRecordArray(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => this.toJsonRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item));
  }

  private deriveAutoLobbyStatus(
    playersInLobby: number,
    readyThreshold: number,
  ): LobbyStatusValue {
    if (playersInLobby <= 0) return LOBBY_STATUS.OFFLINE;
    if (playersInLobby >= readyThreshold) return LOBBY_STATUS.READY;
    return LOBBY_STATUS.WAITING;
  }

  private async syncAutoLobbyStatus(
    matchId: string,
    gameKey: GameKey | null,
  ): Promise<void> {
    const [telemetry, slots] = await Promise.all([
      this.prisma.matchTelemetry.findUnique({
        where: { matchId },
        select: { payload: true },
      }),
      this.prisma.matchSlot.findMany({
        where: { matchId, deletedAt: null },
        select: {
          id: true,
          slotNumber: true,
          teamId: true,
          lobbyStatus: true,
          playersInLobby: true,
        } as any,
      }) as unknown as Promise<
        Array<{
          id: string;
          slotNumber: number;
          teamId: string | null;
          lobbyStatus: LobbyStatusValue | null;
          playersInLobby: number;
        }>
      >,
    ]);

    if (!slots.length) return;

    const snapshots = this.extractTelemetryTeamSnapshots(
      telemetry?.payload ?? null,
    );
    const byTeamId = new Map<
      string,
      {
        teamId: string | null;
        slotNumber: number | null;
        playersInLobby: number;
      }
    >();
    const bySlot = new Map<
      number,
      {
        teamId: string | null;
        slotNumber: number | null;
        playersInLobby: number;
      }
    >();

    for (const snapshot of snapshots) {
      if (snapshot.teamId) byTeamId.set(snapshot.teamId, snapshot);
      if (snapshot.slotNumber !== null)
        bySlot.set(snapshot.slotNumber, snapshot);
    }

    const readyThreshold = this.expectedLobbyReadyPlayers(gameKey);
    const updates = slots
      .map((slot) => {
        if (!slot.teamId) {
          return {
            id: slot.id,
            playersInLobby: 0,
            lobbyStatus: LOBBY_STATUS.EMPTY,
          };
        }
        const snapshot =
          byTeamId.get(slot.teamId) ?? bySlot.get(slot.slotNumber) ?? null;
        const playersInLobby = snapshot?.playersInLobby ?? 0;
        return {
          id: slot.id,
          playersInLobby,
          lobbyStatus: this.deriveAutoLobbyStatus(
            playersInLobby,
            readyThreshold,
          ),
        };
      })
      .filter(
        (update, index) =>
          update.playersInLobby !== slots[index].playersInLobby ||
          update.lobbyStatus !== slots[index].lobbyStatus,
      );

    if (!updates.length) return;

    await this.prisma.$transaction(
      updates.map((update) =>
        this.prisma.matchSlot.update({
          where: { id: update.id },
          data: {
            playersInLobby: update.playersInLobby,
            lobbyStatus: update.lobbyStatus,
          } as any,
        }),
      ),
    );
  }

  private async getSlotContext(
    actor: Actor,
    matchId: string,
  ): Promise<SlotContext> {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        id: true,
        organizationId: true,
        ownerUserId: true,
        tournamentId: true,
        sessionId: true,
        stageId: true,
        groupId: true,
        matchNumber: true,
        adapterKey: true,
        status: true,
        slotCount: true,
        dataSource: true,
        dataMode: true,
        liveState: true,
        game: { select: { key: true } },
        controlState: { select: { state: true } },
        tournament: {
          select: { ownerUserId: true, organizationId: true, game: true },
        },
      },
    });
    if (!match) throw new NotFoundException('Match not found');
    const ownerUserId = match.tournament?.ownerUserId ?? match.ownerUserId;
    const organizationId =
      match.organizationId ?? match.tournament?.organizationId ?? null;
    if (!this.canEdit(actor, ownerUserId, organizationId)) {
      throw new ForbiddenException('Not allowed to access match');
    }
    if (!match.tournamentId && !match.sessionId) {
      throw new BadRequestException(
        'Match must belong to a tournament or event session',
      );
    }
    const gameKey = match.game?.key ?? match.tournament?.game ?? null;
    const capability = this.resolveSlotCapability(
      match.adapterKey ?? null,
      gameKey,
      match.slotCount ?? null,
    );
    return { match: match as SlotMatch, capability };
  }

  private async ensureTeamAllowedForMatch(
    match: SlotMatch,
    teamId: string,
  ): Promise<void> {
    if (!match.tournamentId) {
      if (!match.sessionId) {
        throw new BadRequestException(
          'Match must belong to a tournament or event session',
        );
      }
      const sessionMatchTeam = await this.prisma.matchTeam.findFirst({
        where: { matchId: match.id, teamId, deletedAt: null },
        select: { id: true },
      });
      if (sessionMatchTeam) {
        return;
      }
      const sessionSlotTeam = await this.prisma.matchSlot.findFirst({
        where: { matchId: match.id, teamId, deletedAt: null },
        select: { id: true },
      });
      if (sessionSlotTeam) {
        return;
      }
      const sessionRegistration =
        await this.prisma.sessionRegistration.findFirst({
          where: {
            sessionId: match.sessionId,
            organizationId: match.organizationId,
            teamId,
            deletedAt: null,
            status: {
              in: [
                SessionRegistrationStatus.CONFIRMED,
                SessionRegistrationStatus.CHECKED_IN,
              ],
            },
          },
          select: { id: true },
        });
      if (sessionRegistration) {
        return;
      }
      throw new BadRequestException(
        'Team must be assigned to this event match first',
      );
    }
    if (!match.groupId) {
      throw new BadRequestException(
        'Match must belong to a group to assign slots',
      );
    }
    const tournamentTeam = await this.prisma.tournamentTeam.findFirst({
      where: {
        tournamentId: match.tournamentId,
        teamId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!tournamentTeam) {
      throw new BadRequestException('Team must be added to tournament first');
    }
    const groupMembership = await this.prisma.groupTeam.findFirst({
      where: {
        groupId: match.groupId,
        tournamentTeamId: tournamentTeam.id,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!groupMembership) {
      throw new BadRequestException('Team is not part of this group');
    }
  }

  private async logSlotAudit(
    action: AuditAction,
    matchId: string,
    organizationId: string | null,
    actor: Actor,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const userId = actor.actorId ?? actor.id;
    if (!userId) return;
    try {
      await this.auditService.log({
        action,
        entityType: 'MATCH',
        entityId: matchId,
        userId,
        organizationId,
        before: action === AuditAction.SLOT_CLEARED ? payload : undefined,
        after: action === AuditAction.SLOT_SET ? payload : undefined,
        source: 'MANUAL',
      });
    } catch (err) {
      this.logger.warn(
        `[Matches] Audit log failed for slot ${matchId} action ${action}: ${String(
          err,
        )}`,
      );
    }
  }

  private async getTournamentOwner(
    tournamentId: string,
  ): Promise<string | null> {
    const t = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { ownerUserId: true },
    });
    return t?.ownerUserId ?? null;
  }

  private async getTournamentGameKey(
    tournamentId: string,
  ): Promise<GameKey | null> {
    const t = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { game: true },
    });
    return t?.game ?? null;
  }

  private async ensureTournament(actor: Actor, tournamentId: string) {
    const t = await this.prisma.tournament.findFirst({
      where: { id: tournamentId, deletedAt: null },
      select: { id: true, ownerUserId: true, organizationId: true },
    });
    if (!t) throw new NotFoundException('Tournament not found');
    this.ensureOrgMatch(actor, t.organizationId);
    return t;
  }

  private async ensureGroup(actor: Actor, groupId: string) {
    const group = await this.prisma.group.findFirst({
      where: {
        id: groupId,
        deletedAt: null,
        stage: { deletedAt: null, tournament: { deletedAt: null } },
      },
      include: { stage: { include: { tournament: true } } },
    });
    if (!group) throw new NotFoundException('Group not found');
    this.ensureOrgMatch(actor, group.stage.tournament?.organizationId ?? null);
    return group;
  }

  private async resolveGroupContext(
    actor: Actor,
    groupId?: string | null,
    expectedTournamentId?: string,
  ) {
    if (!groupId) {
      throw new BadRequestException('Match must belong to a group');
    }
    const group = await this.ensureGroup(actor, groupId);
    if (
      expectedTournamentId &&
      group.stage.tournamentId !== expectedTournamentId
    ) {
      throw new BadRequestException(
        'Group does not belong to the specified tournament',
      );
    }
    const tournament = group.stage.tournament;
    const organizationId = tournament?.organizationId ?? null;
    if (!organizationId) {
      throw new BadRequestException(
        'organizationId is required for match creation',
      );
    }
    const tournamentGameKey = tournament?.game ?? null;
    return {
      group,
      groupId: group.id,
      stageId: group.stageId,
      tournamentId: group.stage.tournamentId,
      organizationId,
      tournamentGameKey,
    };
  }

  private async resolveSessionContext(actor: Actor, sessionId: string) {
    if (!sessionId) {
      throw new BadRequestException('sessionId is required');
    }
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, deletedAt: null },
      select: {
        id: true,
        name: true,
        organizationId: true,
        slotCount: true,
        gameId: true,
        rulesetId: true,
        adapterKey: true,
        game: { select: { key: true } },
      },
    });
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    this.ensureOrgMatch(actor, session.organizationId);
    return {
      sessionId: session.id,
      sessionName: session.name,
      organizationId: session.organizationId,
      slotCount: session.slotCount ?? 25,
      gameId: session.gameId ?? null,
      rulesetId: session.rulesetId ?? null,
      adapterKey: session.adapterKey ?? null,
      sessionGameKey: session.game?.key ?? null,
    };
  }

  private async getMatch(
    matchId: string,
    actor: Actor,
    requireActive = true,
  ): Promise<MatchWithOwner> {
    const match = (await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: requireActive ? null : undefined },
      select: this.matchWithOwnerSelect as any,
    })) as any;
    if (!match) throw new NotFoundException('Match not found');
    this.ensureOrgMatch(
      actor,
      match.organizationId ?? match.tournament?.organizationId ?? null,
    );
    return match;
  }

  async getMatchWithOrg(
    matchId: string,
    actor: Actor,
  ): Promise<{
    id: string;
    tournamentId: string;
    tournament: { ownerUserId: string; organizationId: string | null };
  }> {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        id: true,
        tournamentId: true,
        tournament: { select: { ownerUserId: true, organizationId: true } },
      },
    });
    if (!match) throw new NotFoundException('Match not found');
    if (!match.tournament) {
      throw new NotFoundException('Tournament not found for match');
    }
    if (!match.tournamentId) {
      throw new BadRequestException(
        'Session matches are not supported by this endpoint',
      );
    }

    this.ensureOrgMatch(actor, match.tournament.organizationId ?? null);

    return match as {
      id: string;
      tournamentId: string;
      tournament: { ownerUserId: string; organizationId: string | null };
    };
  }

  private async ensureNoOtherLive(
    tournamentId: string,
    actor: Actor,
    excludeMatchId?: string,
  ): Promise<void> {
    await this.ensureTournament(actor, tournamentId);
    const other = await this.prisma.match.findFirst({
      where: {
        status: MatchStatus.LIVE,
        deletedAt: null,
        id: excludeMatchId ? { not: excludeMatchId } : undefined,
        tournamentId,
      },
      select: { id: true },
    });
    if (other) {
      throw new BadRequestException('Another match is already LIVE');
    }
  }

  /**
   * Resolve any data drift where multiple matches in the same organization are marked LIVE.
   * Keeps the most recently started/live match and forces the rest to ENDED.
   */
  private async detectLiveConflicts(organizationId: string) {
    const resolved = await detectOrganizationLiveMatchConflicts(
      this.prisma,
      organizationId,
    );
    if (resolved.wouldEndIds.length > 0) {
      this.logger.warn(
        `[Matches] LIVE conflict detected org=${organizationId} preferred=${resolved.keptId ?? 'none'} live=${resolved.liveIds.join(',')} blockedAutoEnd=${resolved.wouldEndIds.join(',')}`,
      );
    }
  }

  async get(actor: Actor, matchId: string): Promise<MatchWithOwner> {
    return this.withMode((await this.getMatch(matchId, actor)) as any);
  }

  async listOrganizerMatches(
    actor: Actor,
    status?: string | null,
    orgIdOverride?: string | null,
  ) {
    const role = actor?.actorRole ?? actor?.role ?? null;
    if (role === Role.SUPER_ADMIN && !actor?.actingOrgId) {
      throw new ForbiddenException(
        'Organization context missing for SUPER_ADMIN; impersonation required',
      );
    }
    if (role !== Role.ORGANIZER && role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Organizer role required');
    }

    const orgId = orgIdOverride ?? null;
    if (!orgId) {
      throw new ForbiddenException('Organization context missing');
    }

    // Safety net: ensure only one LIVE per organization before returning list.
    await this.detectLiveConflicts(orgId);

    const raw = (status ?? '').toString().toUpperCase();
    const where: Prisma.MatchWhereInput = {
      organizationId: orgId,
      deletedAt: null,
      tournament: { deletedAt: null },
    };

    if (raw === 'LIVE') {
      // Live tab should surface anything currently live via control state or match status.
      where.OR = [{ liveState: LiveState.LIVE }, { status: MatchStatus.LIVE }];
    } else if (raw === 'DRAFT') {
      where.status = { in: [MatchStatus.DRAFT] };
    } else if (raw === 'ENDED') {
      where.status = { in: MATCH_FINISHED_STATUSES };
    }

    const matches = await this.prisma.match.findMany({
      where,
      select: {
        id: true,
        matchNumber: true,
        map: true,
        status: true,
        liveState: true,
        startedAt: true,
        endedAt: true,
        createdAt: true,
        game: { select: { key: true, name: true } },
        tournament: {
          select: { id: true, name: true, status: true, game: true },
        },
        stage: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    const toTs = (value?: Date | null) => (value ? value.valueOf() : 0);

    const prioritized = matches
      .map((m) => ({
        id: m.id,
        matchNumber: m.matchNumber ?? null,
        map: m.map ?? null,
        status:
          m.liveState === LiveState.LIVE
            ? (MatchStatus.LIVE as MatchStatus)
            : ((m.status as MatchStatus | null) ?? null),
        liveState: m.liveState ?? null,
        stageName: m.stage?.name ?? null,
        groupName: m.group?.name ?? null,
        tournamentName: m.tournament?.name ?? null,
        tournamentStatus: m.tournament?.status ?? null,
        gameKey: m.game?.key ?? m.tournament?.game ?? null,
        startedAt: m.startedAt ?? null,
        endedAt: m.endedAt ?? null,
        createdAt: m.createdAt ?? null,
      }))
      .sort((a, b) => {
        const diff =
          this.statusPriority(a.status) - this.statusPriority(b.status);
        if (diff !== 0) return diff;
        const tsA = toTs(a.startedAt) || toTs(a.endedAt) || toTs(a.createdAt);
        const tsB = toTs(b.startedAt) || toTs(b.endedAt) || toTs(b.createdAt);
        return tsB - tsA;
      });

    return prioritized.map((item) => {
      const { createdAt, ...rest } = item;
      void createdAt;
      return rest;
    });
  }

  async list(tournamentId: string, actor: Actor): Promise<MatchListItem[]> {
    await this.ensureTournament(actor, tournamentId);
    const matches = (await this.prisma.match.findMany({
      where: {
        tournamentId,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      select: this.matchListSelect as any,
    })) as any[];
    return matches.map((m) => this.withMode(m));
  }

  async getActiveMatch(actor: Actor) {
    const organizationId = this.getActorOrg(actor);
    const match = await this.prisma.match.findFirst({
      where: {
        organizationId,
        deletedAt: null,
        endedAt: null,
        status: MatchStatus.LIVE,
        liveState: { not: LiveState.ENDED },
      },
      orderBy: [
        { liveAt: 'desc' },
        { startedAt: 'desc' },
        { updatedAt: 'desc' },
      ],
      select: {
        id: true,
        name: true,
        status: true,
        liveState: true,
        tournamentId: true,
        sessionId: true,
        stageId: true,
        groupId: true,
        matchNumber: true,
        map: true,
        scheduledAt: true,
        liveAt: true,
        startedAt: true,
        updatedAt: true,
        session: { select: { name: true } },
      },
    });

    if (!match) {
      return null;
    }

    return {
      id: match.id,
      matchId: match.id,
      status: normalizeMatchLifecycleStatus(match.status),
      liveState: match.liveState ?? null,
      tournamentId: match.tournamentId ?? null,
      sessionId: match.sessionId ?? null,
      sessionName: match.session?.name ?? null,
      stageId: match.stageId ?? null,
      groupId: match.groupId ?? null,
      matchNumber: match.matchNumber ?? null,
      matchName: match.name ?? null,
      map: match.map ?? null,
      startsAt:
        match.scheduledAt?.toISOString?.() ??
        match.liveAt?.toISOString?.() ??
        match.startedAt?.toISOString?.() ??
        match.updatedAt?.toISOString?.() ??
        null,
    };
  }

  async listByGroup(actor: Actor, groupId: string): Promise<MatchListItem[]> {
    await this.ensureGroup(actor, groupId);
    const matches = (await this.prisma.match.findMany({
      where: {
        groupId,
        deletedAt: null,
      },
      orderBy: [{ matchNumber: 'asc' }, { createdAt: 'desc' }],
      select: this.matchListSelect as any,
    })) as any[];
    return matches.map((m) => this.withMode(m));
  }

  async listTeams(actor: Actor, matchId: string) {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        id: true,
        organizationId: true,
        ownerUserId: true,
        tournamentId: true,
        sessionId: true,
        groupId: true,
        tournament: { select: { ownerUserId: true, organizationId: true } },
        matchSlots: {
          include: { team: { select: { id: true } } },
          orderBy: { slotNumber: 'asc' },
        },
      },
    });
    if (!match) throw new NotFoundException('Match not found');
    if (!match.tournament || !match.tournamentId) {
      if (!match.sessionId) {
        throw new BadRequestException(
          'Match must belong to a tournament or event session',
        );
      }
      if (
        !this.canEdit(actor, match.ownerUserId, match.organizationId ?? null)
      ) {
        throw new ForbiddenException('Not allowed to access match teams');
      }

      const [sessionRegistrations, matchTeams, slots, stats] =
        await Promise.all([
          this.prisma.sessionRegistration.findMany({
            where: {
              sessionId: match.sessionId,
              organizationId: match.organizationId,
              deletedAt: null,
              status: {
                in: [
                  SessionRegistrationStatus.CONFIRMED,
                  SessionRegistrationStatus.CHECKED_IN,
                ],
              },
            },
            include: {
              team: {
                select: { id: true, name: true, tag: true, logoUrl: true },
              },
            },
            orderBy: [{ slotNumber: 'asc' }, { createdAt: 'asc' }],
          }),
          this.prisma.matchTeam.findMany({
            where: { matchId: match.id, deletedAt: null },
            include: {
              team: {
                select: { id: true, name: true, tag: true, logoUrl: true },
              },
            },
            orderBy: [{ slot: 'asc' }, { createdAt: 'asc' }],
          }),
          this.prisma.matchSlot.findMany({
            where: { matchId: match.id, deletedAt: null },
            include: {
              team: {
                select: { id: true, name: true, tag: true, logoUrl: true },
              },
            },
            orderBy: { slotNumber: 'asc' },
          }),
          this.prisma.matchSlotResult.findMany({
            where: { matchId: match.id },
            select: {
              teamId: true,
              placement: true,
              totalKills: true,
              wasPresentInMatch: true,
            },
          }),
        ]);

      const teamsById = new Map<
        string,
        {
          id: string;
          name: string | null;
          tag: string | null;
          logoUrl: string | null;
        }
      >();
      for (const registration of sessionRegistrations) {
        if (registration.team?.id) {
          teamsById.set(registration.team.id, registration.team);
        }
      }
      for (const row of matchTeams) {
        if (row.team?.id) {
          teamsById.set(row.team.id, row.team);
        }
      }
      for (const slot of slots) {
        if (slot.team?.id && !teamsById.has(slot.team.id)) {
          teamsById.set(slot.team.id, slot.team);
        }
      }

      const slotByTeam = new Map<string, number>();
      slots.forEach((slot) => {
        if (slot.teamId) slotByTeam.set(slot.teamId, slot.slotNumber);
      });
      const statByTeam = new Map<
        string,
        {
          placement: number | null;
          kills: number | null;
          wasPresentInMatch: boolean | null;
        }
      >();
      stats.forEach(
        (stat) =>
          stat.teamId &&
          statByTeam.set(stat.teamId, {
            placement: isPresentInMatch(stat.wasPresentInMatch)
              ? (stat.placement ?? null)
              : null,
            kills: isPresentInMatch(stat.wasPresentInMatch)
              ? (stat.totalKills ?? null)
              : 0,
            wasPresentInMatch: stat.wasPresentInMatch ?? null,
          }),
      );

      const items = Array.from(teamsById.values()).map((team) => {
        const slot = slotByTeam.get(team.id) ?? null;
        const stat = statByTeam.get(team.id);
        return {
          slot,
          teamId: team.id,
          teamName: team.name ?? '',
          teamTag: team.tag ?? null,
          logoUrl: team.logoUrl ?? null,
          placement: stat?.placement ?? null,
          kills: stat?.kills ?? null,
          aliveCount: null,
          wasPresentInMatch: stat?.wasPresentInMatch ?? null,
          presenceStatus: derivePresenceStatus(stat?.wasPresentInMatch ?? null),
          status: !isPresentInMatch(stat?.wasPresentInMatch)
            ? ('NO_SHOW' as const)
            : stat?.placement && stat.placement > 0
              ? ('ELIMINATED' as const)
              : ('UNKNOWN' as const),
        };
      });

      items.sort((a, b) => {
        const presenceOrder = comparePresenceStatus(
          a.wasPresentInMatch,
          b.wasPresentInMatch,
        );
        if (presenceOrder !== 0) {
          return presenceOrder;
        }
        const slotA = a.slot ?? 9999;
        const slotB = b.slot ?? 9999;
        return slotA - slotB;
      });

      return items;
    }
    if (
      !this.canEdit(
        actor,
        match.tournament.ownerUserId,
        match.tournament.organizationId ?? null,
      )
    ) {
      throw new ForbiddenException('Not allowed to access match teams');
    }

    const tournamentTeams: Prisma.TournamentTeamGetPayload<{
      include: {
        team: { select: { id: true; name: true; tag: true; logoUrl: true } };
      };
    }>[] = await this.prisma.tournamentTeam.findMany({
      where: { tournamentId: match.tournamentId, deletedAt: null },
      include: {
        team: { select: { id: true, name: true, tag: true, logoUrl: true } },
      },
    });

    let allowedTeamIds: Set<string> | null = null;
    if (match.groupId) {
      const memberships = await this.prisma.groupTeam.findMany({
        where: {
          groupId: match.groupId,
          deletedAt: null,
        },
        select: {
          tournamentTeam: { select: { teamId: true } },
        },
      });
      allowedTeamIds = new Set(
        memberships
          .map((m) => m.tournamentTeam?.teamId ?? null)
          .filter((id): id is string => Boolean(id)),
      );
    }

    const slots = await this.prisma.matchSlot.findMany({
      where: { matchId: match.id },
      include: { team: { select: { id: true } } },
      orderBy: { slotNumber: 'asc' },
    });

    const stats = await this.prisma.matchSlotResult.findMany({
      where: { matchId: match.id },
      select: {
        teamId: true,
        placement: true,
        totalKills: true,
        wasPresentInMatch: true,
      },
    });

    const slotByTeam = new Map<string, number>();
    slots.forEach((s) => {
      if (s.teamId) slotByTeam.set(s.teamId, s.slotNumber);
    });
    const statByTeam = new Map<
      string,
      {
        placement: number | null;
        kills: number | null;
        wasPresentInMatch: boolean | null;
      }
    >();
    stats.forEach(
      (s) =>
        s.teamId &&
        statByTeam.set(s.teamId, {
          placement: isPresentInMatch(s.wasPresentInMatch)
            ? (s.placement ?? null)
            : null,
          kills: isPresentInMatch(s.wasPresentInMatch)
            ? (s.totalKills ?? null)
            : 0,
          wasPresentInMatch: s.wasPresentInMatch ?? null,
        }),
    );

    const items = tournamentTeams
      .map((tt) => {
        const team = tt.team ?? null;
        if (!team?.id) return null;
        if (allowedTeamIds && !allowedTeamIds.has(team.id)) return null;
        const slot = slotByTeam.get(team.id) ?? null;
        const stat = statByTeam.get(team.id);
        return {
          slot,
          teamId: team.id,
          teamName: team.name ?? '',
          teamTag: team.tag ?? null,
          logoUrl: team.logoUrl ?? null,
          placement: stat?.placement ?? null,
          kills: stat?.kills ?? null,
          aliveCount: null,
          wasPresentInMatch: stat?.wasPresentInMatch ?? null,
          presenceStatus: derivePresenceStatus(stat?.wasPresentInMatch ?? null),
          status: !isPresentInMatch(stat?.wasPresentInMatch)
            ? ('NO_SHOW' as const)
            : stat?.placement && stat.placement > 0
              ? ('ELIMINATED' as const)
              : ('UNKNOWN' as const),
        };
      })
      .filter((t): t is NonNullable<typeof t> => Boolean(t));

    items.sort((a, b) => {
      const presenceOrder = comparePresenceStatus(
        a.wasPresentInMatch,
        b.wasPresentInMatch,
      );
      if (presenceOrder !== 0) {
        return presenceOrder;
      }
      const sa = a.slot ?? 9999;
      const sb = b.slot ?? 9999;
      return sa - sb;
    });

    return items;
  }

  async listSlots(actor: Actor, matchId: string) {
    const { match, capability } = await this.getSlotContext(actor, matchId);
    this.ensureSlotsEnabled(capability);
    if (this.resolveAutoSource(match) !== MatchDataSource.MANUAL) {
      await this.syncAutoLobbyStatus(match.id, capability.gameKey);
    }
    type MatchSlotListRow = {
      id: string | null;
      matchId: string;
      slotNumber: number;
      teamId: string | null;
      lobbyStatus: LobbyStatus;
      playersInLobby: number;
      team: {
        id: string;
        name: string;
        tag: string | null;
        logoUrl: string | null;
      } | null;
    };
    const slots = (await this.prisma.matchSlot.findMany({
      where: { matchId: match.id, deletedAt: null },
      select: {
        id: true,
        matchId: true,
        slotNumber: true,
        teamId: true,
        lobbyStatus: true,
        playersInLobby: true,
        team: { select: { id: true, name: true, tag: true, logoUrl: true } },
      } as any,
      orderBy: { slotNumber: 'asc' },
    })) as unknown as MatchSlotListRow[];
    const slotsByNumber = new Map(
      slots.map((slot) => [slot.slotNumber, slot] as const),
    );
    const slotCount = Math.max(
      match.slotCount ?? 0,
      slots.reduce((max, slot) => Math.max(max, slot.slotNumber), 0),
    );
    const layoutSlots: MatchSlotListRow[] = [];
    for (let slotNumber = 1; slotNumber <= slotCount; slotNumber += 1) {
      const existing = slotsByNumber.get(slotNumber);
      if (existing) {
        layoutSlots.push(existing);
        continue;
      }
      layoutSlots.push({
        id: null,
        matchId: match.id,
        slotNumber,
        teamId: null,
        lobbyStatus: LobbyStatus.EMPTY,
        playersInLobby: 0,
        team: null,
      });
    }
    return layoutSlots;
  }

  private shouldRefreshLiveSlotContract(match: {
    status?: MatchStatus | null;
    controlState?: { state?: string | null } | null;
  }): boolean {
    return (
      match.status === MatchStatus.LIVE || match.controlState?.state === 'LIVE'
    );
  }

  private async notifyLobbyContractChanged(
    matchId: string,
    options: { refreshLiveState?: boolean } = {},
  ): Promise<void> {
    if (options.refreshLiveState) {
      try {
        await this.matchControl.refreshLiveContractState?.(matchId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `[Slots] Failed to refresh live contract for match ${matchId}: ${message}`,
        );
      }
    }

    this.resultsEvents.emitControlContractUpdated?.(matchId, 'SLOTS_CHANGED');
  }

  async updateSlotLobbyStatus(
    actor: Actor,
    matchId: string,
    slotNumber: number,
    lobbyStatus: LobbyStatusValue,
  ) {
    const { match, capability } = await this.getSlotContext(actor, matchId);
    this.ensureSlotsEnabled(capability);
    this.ensureSlotsEditable(match);

    if (this.resolveAutoSource(match) !== MatchDataSource.MANUAL) {
      throw new BadRequestException(
        'Lobby readiness is controlled by telemetry for automatic sources',
      );
    }

    if (
      lobbyStatus !== LOBBY_STATUS.READY &&
      lobbyStatus !== LOBBY_STATUS.WAITING
    ) {
      throw new BadRequestException(
        'lobbyStatus must be READY or WAITING for manual matches',
      );
    }

    const normalizedSlot = this.validateSlotNumber(slotNumber, capability);
    const slot = await this.prisma.matchSlot.findFirst({
      where: {
        matchId: match.id,
        slotNumber: normalizedSlot,
        deletedAt: null,
      },
      select: { id: true, teamId: true } as any,
    });

    if (!slot?.teamId) {
      throw new BadRequestException(
        'Slot must have an assigned team before setting lobby readiness',
      );
    }

    await this.prisma.matchSlot.update({
      where: { id: slot.id },
      data: {
        lobbyStatus,
        playersInLobby: 0,
      } as any,
    });
    await this.notifyLobbyContractChanged(match.id);

    return this.listSlots(actor, match.id);
  }

  async generateMatchResults(matchId: string) {
    // Phase 1: slot results are the source of truth; just ensure they exist.
    await this.results.ensureResultsFromSlots(matchId);
    await this.results.recomputeAllSlots(matchId);
  }

  async getResults(actor: Actor, matchId: string) {
    const match = await this.ensureMatchOrg(actor, matchId);
    await this.results.syncLiveTelemetryResultsForRead(matchId);
    await this.results.ensureResultsFromSlots(matchId);
    const liveMirrorPromise = this.controlStateStore
      ? this.controlStateStore.get(matchId).catch(() => null)
      : Promise.resolve(null);
    const liveSyncContract = readLiveSyncContract(match.controlState?.metaJson);
    const auditTrail = [...liveSyncContract.auditTrail].sort(
      (left, right) => right.timestamp - left.timestamp,
    );
    const summarizeAudit = (
      predicate: (entry: LiveSyncAuditEntry) => boolean,
    ) => {
      const relevant = auditTrail.filter(predicate);
      return {
        lastOverride:
          relevant.find((entry) => entry.action === 'OVERRIDE') ?? null,
        lastRelease:
          relevant.find((entry) => entry.action === 'RELEASE') ?? null,
      };
    };
    const lifecycleStatus = deriveCanonicalMatchLifecycleStatus({
      status: match.status ?? null,
      liveState: match.liveState ?? match.controlState?.state ?? null,
      controlState: match.controlState?.state ?? null,
      metaJson: match.controlState?.metaJson ?? null,
    });
    const resultMeta =
      match.controlState?.metaJson &&
      typeof match.controlState.metaJson === 'object'
        ? (match.controlState.metaJson as { resultFinalized?: boolean })
        : null;
    const overrideReleaseAllowed =
      match.controlState?.resultsManualLock !== true &&
      resultMeta?.resultFinalized !== true &&
      lifecycleStatus !== 'FINISHED';
    const overrideReleaseReason = overrideReleaseAllowed
      ? null
      : match.controlState?.resultsManualLock
        ? 'Overrides cannot be released while match control lock is active.'
        : 'Overrides cannot be released after results are finalized.';
    const telemetry = derivePcobBindingFlags(match, {
      lifecycleStatus,
    });
    const runtimeSourceMode = telemetry.sourceMode;
    const sourceMode = exposeSourceMode(telemetry.telemetryProvider);
    const effectivePresence = (slot: {
      teamId?: string | null;
      wasPresentInMatch?: boolean | null;
    }): boolean | null => {
      if (
        runtimeSourceMode === MatchDataSource.MANUAL &&
        slot.teamId &&
        slot.wasPresentInMatch == null
      ) {
        return true;
      }
      return slot.wasPresentInMatch ?? null;
    };

    const [slotResults, liveMirrorState] = await Promise.all([
      this.prisma.matchSlotResult.findMany({
        where: { matchId, teamId: { not: null } },
        orderBy: { slotNumber: 'asc' },
        include: {
          team: { select: { id: true, name: true, tag: true, logoUrl: true } },
          players: {
            select: {
              id: true,
              slotResultId: true,
              playerId: true,
              playerName: true,
              kills: true,
              knocks: true,
              assists: true,
              isKnocked: true,
              isAlive: true,
              isAutoFilled: true,
              player: {
                select: {
                  externalPlayerId: true,
                  id: true,
                  ign: true,
                  photoUrl: true,
                  realName: true,
                },
              },
            },
            orderBy: { playerName: 'asc' },
          },
        },
      }),
      liveMirrorPromise,
    ]);
    const assignedSlotResults = slotResults.filter((sr) => Boolean(sr.teamId));
    const activeSlotResults = assignedSlotResults.filter((sr) =>
      isPresentInMatch(effectivePresence(sr)),
    );

    const canonical = derivePubgMatchState<number>({
      eliminationMarker: Date.now(),
      teams: activeSlotResults.map((sr) => ({
        teamId: sr.teamId as string,
        sortKey: `${String(sr.slotNumber).padStart(4, '0')}:${sr.id}`,
        players: (sr.players ?? []).map((player) => ({
          id: player.id,
          teamId: sr.teamId as string,
          kills: player.kills ?? 0,
          alive:
            ((player as { isAlive?: boolean | null }).isAlive ??
              (player as { alive?: boolean | null }).alive ??
              true) === true,
          knocked:
            ((player as { isKnocked?: boolean | null }).isKnocked ?? false) ===
            true,
        })),
        totalPlayers: sr.players?.length ?? 0,
        eliminatedOrder:
          (sr as { eliminatedOrder?: number | null }).eliminatedOrder ?? null,
        eliminatedAt:
          (sr as { eliminatedAt?: Date | null }).eliminatedAt?.getTime() ??
          null,
        manualTotalKills:
          (sr as { manualTotalKills?: boolean | null }).manualTotalKills ??
          false,
        totalKillsOverride: sr.totalKills ?? null,
      })),
    });
    const canonicalByTeamId = new Map(
      canonical.teams.map((team) => [team.teamId, team] as const),
    );
    const useLiveMirrorAuthority =
      sourceMode !== MatchDataSource.MANUAL &&
      lifecycleStatus === 'LIVE' &&
      Boolean(liveMirrorState) &&
      Array.isArray(liveMirrorState?.teams) &&
      liveMirrorState.teams.length > 0;
    const liveMirrorTeamById = new Map(
      useLiveMirrorAuthority
        ? (liveMirrorState?.teams ?? [])
            .filter(
              (
                team,
              ): team is NonNullable<LiveMatchState['teams']>[number] & {
                teamId: string;
              } => typeof team?.teamId === 'string' && team.teamId.length > 0,
            )
            .map((team) => [team.teamId, team] as const)
        : [],
    );
    const totalTeamsCount = useLiveMirrorAuthority
      ? (liveMirrorState?.summary?.totalTeams ?? liveMirrorTeamById.size)
      : canonical.totalTeams;
    const aliveTeamsCount = useLiveMirrorAuthority
      ? (liveMirrorState?.summary?.aliveTeams ??
        Array.from(liveMirrorTeamById.values()).filter(
          (team) => (team.alivePlayers ?? 0) > 0,
        ).length)
      : canonical.aliveTeams;
    const assignedTeamIds = new Set(
      assignedSlotResults
        .map((slotResult) => slotResult.teamId)
        .filter((teamId): teamId is string => typeof teamId === 'string'),
    );
    const adjustmentFilters: Prisma.AdminAdjustmentWhereInput[] = [{ matchId }];
    const matchGroupId = (match as { groupId?: string | null }).groupId;
    const matchStageId = (match as { stageId?: string | null }).stageId;
    if (matchGroupId) adjustmentFilters.push({ groupId: matchGroupId });
    if (matchStageId) adjustmentFilters.push({ stageId: matchStageId });
    if (match.tournamentId) {
      adjustmentFilters.push({ tournamentId: match.tournamentId });
    }
    if (match.sessionId) {
      adjustmentFilters.push({ sessionId: match.sessionId });
    }
    const resultAdjustments: ScoreAdjustmentRecord[] = adjustmentFilters.length
      ? await this.prisma.adminAdjustment.findMany({
          where: {
            deletedAt: null,
            revokedAt: null,
            OR: adjustmentFilters,
          },
          select: {
            teamId: true,
            pointsDelta: true,
            scope: true,
            type: true,
            matchId: true,
            groupId: true,
            stageId: true,
            tournamentId: true,
            sessionId: true,
            deletedAt: true,
            revokedAt: true,
          },
        })
      : [];
    const adjustmentsByTeam = new Map<string, ScoreAdjustmentRecord[]>();
    resultAdjustments.forEach((adjustment) => {
      const list = adjustmentsByTeam.get(adjustment.teamId) ?? [];
      list.push(adjustment);
      adjustmentsByTeam.set(adjustment.teamId, list);
    });
    const adjustmentMatchContext: ScoreAdjustmentMatchContext = {
      id: matchId,
      tournamentId: match.tournamentId ?? null,
      stageId: (match as { stageId?: string | null }).stageId ?? null,
      groupId: (match as { groupId?: string | null }).groupId ?? null,
      sessionId: match.sessionId ?? null,
    };

    const rows = assignedSlotResults.map((sr) => {
      const liveMirrorTeam = useLiveMirrorAuthority
        ? (liveMirrorTeamById.get(sr.teamId as string) ?? null)
        : null;
      const liveMirrorPresenceStatus = liveMirrorTeam?.presenceStatus ?? null;
      const wasPresentInMatch = liveMirrorTeam
        ? liveMirrorPresenceStatus === 'NO_SHOW'
          ? false
          : liveMirrorPresenceStatus === 'ACTIVE'
            ? true
            : effectivePresence(sr)
        : effectivePresence(sr);
      const presenceStatus = liveMirrorPresenceStatus
        ? liveMirrorPresenceStatus
        : derivePresenceStatus(wasPresentInMatch);
      const isActiveTeam = liveMirrorTeam
        ? presenceStatus === 'ACTIVE'
        : isPresentInMatch(wasPresentInMatch);
      const isCompetitiveTeam = isCompetitiveResultsTeam(wasPresentInMatch);
      const canonicalTeam = canonicalByTeamId.get(sr.teamId as string) ?? null;
      const teamAudit = summarizeAudit(
        (entry) =>
          entry.scope.level === 'TEAM' &&
          entry.scope.teamId === (sr.teamId as string),
      );
      const players =
        sr.players
          ?.map((p) => ({
            playerKey:
              buildMatchPlayerKey({
                playerId: p.playerId ?? null,
                playerResultId: p.id,
              }) ?? p.id,
            // Use result row id for edits; also expose underlying playerId for roster mapping.
            id: p.id,
            playerId:
              buildMatchPlayerKey({
                playerId: p.playerId ?? null,
                playerResultId: p.id,
              }) ?? p.id,
            externalPlayerId: p.player?.externalPlayerId ?? null,
            name:
              p.player?.ign ?? p.player?.realName ?? p.playerName ?? 'Player',
            avatar: p.player?.photoUrl ?? null,
            kills: p.kills ?? 0,
            damage: (p as { damage?: number | null }).damage ?? null,
            knocks: p.knocks ?? null,
            assists: p.assists ?? null,
            // alive is deprecated mirror; isAlive is canonical.
            alive: p?.isAlive ?? null,
            isAlive: p?.isAlive ?? null,
            isKnocked: p?.isKnocked ?? null,
            ownership: null as
              | (typeof liveSyncContract.overrides.players)[string]
              | null,
            audit: summarizeAudit(
              (entry) =>
                entry.scope.level === 'PLAYER' &&
                entry.scope.playerId ===
                  (buildMatchPlayerKey({
                    playerId: p.playerId ?? null,
                    playerResultId: p.id,
                  }) ?? p.id),
            ),
          }))
          .map((player) => ({
            ...player,
            kills: isCompetitiveTeam ? player.kills : 0,
            alive: isCompetitiveTeam ? player.alive : null,
            isAlive: isCompetitiveTeam ? player.isAlive : null,
            isKnocked: isCompetitiveTeam ? player.isKnocked : null,
            ownership:
              liveSyncContract.overrides.players[player.playerKey] ?? null,
          }))
          .map((player) => {
            const { playerKey, ...rest } = player;
            void playerKey;
            return rest;
          }) ?? [];
      const livePlayers = this.overlayLiveMirrorPlayerRows(
        players,
        liveMirrorTeam,
      );

      const alivePlayers = isCompetitiveTeam
        ? (liveMirrorTeam?.alivePlayers ??
          canonicalTeam?.aliveCount ??
          livePlayers.filter((p) => (p.isAlive ?? p.alive ?? false) === true)
            .length)
        : null;
      const eliminatedOrder = isCompetitiveTeam
        ? (canonicalTeam?.eliminatedOrder ??
          (sr as { eliminatedOrder?: number | null }).eliminatedOrder ??
          null)
        : null;
      const teamKills = isCompetitiveTeam
        ? (liveMirrorTeam?.kills ??
          canonicalTeam?.teamKills ??
          livePlayers.reduce((sum, p) => sum + (p.kills ?? 0), 0))
        : 0;
      const totalKills = teamKills;
      const placement = isCompetitiveTeam
        ? (liveMirrorTeam?.placement ??
          canonicalTeam?.placement ??
          sr.placement ??
          null)
        : null;
      const placementPoints = getPlacementPoints(placement, match.game?.key);
      const killPoints =
        typeof sr.points === 'number' && Number.isFinite(sr.points)
          ? sr.points
          : totalKills;
      const adjustedScore = applyMatchScoreAdjustments(
        placementPoints + killPoints,
        adjustmentsByTeam.get(sr.teamId as string) ?? [],
        adjustmentMatchContext,
      );
      const totalPoints = isCompetitiveTeam ? adjustedScore.totalPoints : 0;
      const eliminated = isCompetitiveTeam
        ? (liveMirrorTeam?.eliminated ??
          canonicalTeam?.eliminated ??
          (Boolean(sr.eliminatedAt) || eliminatedOrder !== null))
        : false;

      return {
        id: sr.id,
        matchId: sr.matchId,
        teamId: sr.teamId as string,
        wasPresentInMatch,
        presenceStatus,
        slot: sr.slotNumber,
        kills: totalKills,
        teamKills,
        alivePlayers,
        hasTelemetryPresence:
          liveMirrorTeam?.hasTelemetryPresence ?? isActiveTeam,
        eliminated,
        eliminatedOrder,
        placement,
        eliminatedAt: isCompetitiveTeam
          ? ((sr as { eliminatedAt?: Date | null }).eliminatedAt ?? null)
          : null,
        teamLocked: isCompetitiveTeam
          ? Boolean((sr as { isLocked?: boolean }).isLocked) || eliminated
          : false,
        placementPoints,
        totalPoints,
        adjustmentPoints: isCompetitiveTeam
          ? totalPoints - placementPoints - killPoints
          : 0,
        disqualified: isCompetitiveTeam ? adjustedScore.disqualified : false,
        manualTotalKills: isCompetitiveTeam
          ? ((sr as { manualTotalKills?: boolean }).manualTotalKills ?? false)
          : false,
        ownership:
          liveSyncContract.overrides.teams[sr.teamId as string] ?? null,
        audit: teamAudit,
        team: sr.team,
        players: livePlayers,
      };
    });
    const liveOnlyUnassignedRows = useLiveMirrorAuthority
      ? Array.from(liveMirrorTeamById.values())
          .filter((team) => !assignedTeamIds.has(team.teamId))
          .filter((team) => {
            if (team.presenceStatus === 'NO_SHOW') {
              return false;
            }
            const alivePlayers =
              typeof team.alivePlayers === 'number' &&
              Number.isFinite(team.alivePlayers)
                ? Math.max(0, Math.trunc(team.alivePlayers))
                : 0;
            const totalPlayers =
              typeof team.totalPlayers === 'number' &&
              Number.isFinite(team.totalPlayers)
                ? Math.max(0, Math.trunc(team.totalPlayers))
                : Array.isArray(team.players)
                  ? team.players.length
                  : 0;
            return (
              team.hasTelemetryPresence === true ||
              alivePlayers > 0 ||
              totalPlayers > 0 ||
              (team.kills ?? 0) > 0 ||
              (team.placement ?? null) !== null ||
              (team.points ?? null) !== null
            );
          })
          .map((team) => {
            const rawAlivePlayers =
              typeof team.alivePlayers === 'number' &&
              Number.isFinite(team.alivePlayers)
                ? Math.max(0, Math.trunc(team.alivePlayers))
                : null;
            const rawTotalPlayers =
              typeof team.totalPlayers === 'number' &&
              Number.isFinite(team.totalPlayers)
                ? Math.max(0, Math.trunc(team.totalPlayers))
                : null;
            const alivePlayers = rawAlivePlayers;
            const totalPlayers =
              rawTotalPlayers ??
              Math.max(
                alivePlayers ?? 0,
                Array.isArray(team.players) ? team.players.length : 0,
              ) ??
              null;
            const placement =
              typeof team.placement === 'number' &&
              Number.isFinite(team.placement)
                ? Math.max(1, Math.trunc(team.placement))
                : null;
            const kills =
              typeof team.kills === 'number' && Number.isFinite(team.kills)
                ? Math.max(0, Math.trunc(team.kills))
                : 0;
            const wasPresentInMatch = true;
            const placementPoints = getPlacementPoints(
              placement,
              match.game?.key,
            );
            const totalPoints =
              typeof team.points === 'number' && Number.isFinite(team.points)
                ? Math.max(0, Math.trunc(team.points))
                : placementPoints + kills;
            const fallbackName =
              typeof team.name === 'string' && team.name.trim().length > 0
                ? team.name.trim()
                : typeof team.slot === 'number' && Number.isFinite(team.slot)
                  ? `Unassigned Live Team ${Math.trunc(team.slot)}`
                  : 'Unassigned Live Team';

            return {
              id: `live-unassigned:${team.teamId}`,
              matchId,
              teamId: team.teamId,
              liveTeamId: team.teamId,
              isLiveOnlyUnassigned: true,
              liveOnlyReason:
                'Detected from live telemetry, but not assigned to a saved match slot yet.',
              wasPresentInMatch,
              presenceStatus: 'ACTIVE' as const,
              slot:
                typeof team.slot === 'number' && Number.isFinite(team.slot)
                  ? Math.trunc(team.slot)
                  : null,
              kills,
              teamKills: kills,
              alivePlayers,
              hasTelemetryPresence: team.hasTelemetryPresence ?? true,
              eliminated:
                team.eliminated ??
                (alivePlayers !== null
                  ? alivePlayers <= 0 &&
                    ((totalPlayers ?? 0) > 0 || placement !== null)
                  : false),
              eliminatedOrder: null,
              placement,
              eliminatedAt: null,
              teamLocked: true,
              placementPoints,
              totalPoints,
              manualTotalKills: false,
              ownership: null,
              audit: {
                lastOverride: null,
                lastRelease: null,
              },
              team: {
                id: team.teamId,
                name: fallbackName,
                tag:
                  typeof team.tag === 'string' && team.tag.trim().length > 0
                    ? team.tag.trim()
                    : null,
                logoUrl: team.logoUrl ?? null,
              },
              players: [],
            };
          })
      : [];

    if (process.env.NODE_ENV !== 'production') {
      this.logger.debug('results placement snapshot', {
        matchId,
        teams: [...rows, ...liveOnlyUnassignedRows].map((r) => ({
          teamId: r.teamId,
          alivePlayers: r.alivePlayers,
          eliminatedOrder: r.eliminatedOrder,
          derivedPlacement: r.placement,
        })),
      });
    }

    const sorted = this.sortResults([
      ...rows,
      ...liveOnlyUnassignedRows,
    ] as any);

    const lockContract = deriveMatchLockContract({
      status: match.status ?? null,
      liveState: match.liveState ?? match.controlState?.state ?? null,
      controlState: match.controlState?.state ?? null,
      metaJson: match.controlState?.metaJson ?? null,
      dataSource: match.dataSource ?? null,
      dataMode: match.dataMode ?? null,
      manualLock: match.controlState?.resultsManualLock ?? null,
      forceUnlock: match.controlState?.resultsForceUnlock ?? null,
    });
    const lockState = lockContract.resultLockState;
    const locked = lockContract.resultsLocked;
    const lockReason = lockContract.reason;
    return {
      results: sorted,
      data: sorted,
      version: liveSyncContract.version,
      locked,
      lockState,
      lockReason,
      lockedAt: locked ? (match.controlState?.updatedAt ?? null) : null,
      lockedBy: locked ? (match.controlState?.updatedByUserId ?? null) : null,
      aliveTeamsCount,
      totalTeamsCount,
      matchLocked: locked,
      telemetryProvider: exposeTelemetryProvider(telemetry.telemetryProvider),
      lifecycleStatus: lockContract.lifecycleStatus,
      slotLocked: lockContract.slotLocked,
      sourceMode,
      noShowCount: assignedSlotResults.filter(
        (row) => row.wasPresentInMatch === false,
      ).length,
      liveMirrorVersion: liveMirrorState?.version ?? null,
      liveSyncVersion: liveSyncContract.version,
      overrideAudit: auditTrail.slice(0, 12),
      overrideReleaseAllowed,
      overrideReleaseReason,
    };
  }

  async listResultAdjustments(actor: Actor, matchId: string) {
    const match = await this.ensureResultAdjustmentMatch(actor, matchId);
    const filters = this.adjustmentContextFilters(match);
    const adjustments = await this.prisma.adminAdjustment.findMany({
      where: {
        deletedAt: null,
        OR: filters,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        organizationId: true,
        tournamentId: true,
        stageId: true,
        groupId: true,
        sessionId: true,
        matchId: true,
        teamId: true,
        scope: true,
        type: true,
        pointsDelta: true,
        reason: true,
        note: true,
        createdAt: true,
        createdById: true,
        revokedAt: true,
        revokedById: true,
        revokeReason: true,
        team: { select: { id: true, name: true, tag: true, logoUrl: true } },
      },
    });
    return { adjustments };
  }

  async createResultAdjustment(
    actor: Actor,
    matchId: string,
    payload: MatchResultAdjustmentPayload,
  ) {
    const match = await this.ensureResultAdjustmentMatch(actor, matchId);
    const teamId = this.cleanAdjustmentTeamId(payload?.teamId);
    await this.ensureAdjustmentTeamInMatch(match.id, teamId);

    const type = this.normalizeResultAdjustmentType(payload?.type);
    const scope = this.normalizeResultAdjustmentScope(
      payload?.scope,
      type,
      match,
    );
    const pointsDelta =
      type === 'POINT_DELTA'
        ? this.normalizeAdjustmentDelta(payload?.pointsDelta)
        : 0;
    const reason =
      this.toStringValue(payload?.reason) ??
      this.defaultAdjustmentReason(type, scope, pointsDelta);

    const adjustment = await this.prisma.adminAdjustment.create({
      data: {
        organizationId:
          match.organizationId ?? match.tournament?.organizationId ?? null,
        tournamentId: match.tournamentId ?? null,
        stageId: match.stageId ?? null,
        groupId: match.groupId ?? null,
        sessionId: match.sessionId ?? null,
        matchId: scope === 'MATCH' ? match.id : null,
        teamId,
        scope,
        type,
        pointsDelta,
        reason,
        createdById: actor.actorId ?? actor.id ?? null,
      } as Prisma.AdminAdjustmentUncheckedCreateInput,
    });

    await this.refreshAdjustmentScope(match, teamId, scope);
    return { ok: true, adjustment };
  }

  async revokeResultAdjustment(
    actor: Actor,
    matchId: string,
    adjustmentId: string,
    body: { reason?: string | null } = {},
  ) {
    const match = await this.ensureResultAdjustmentMatch(actor, matchId);
    const adjustment = await this.prisma.adminAdjustment.findUnique({
      where: { id: adjustmentId },
    });
    if (!adjustment || adjustment.deletedAt) {
      throw new NotFoundException('Adjustment not found');
    }
    if (!this.adjustmentBelongsToMatchContext(adjustment, match)) {
      throw new ForbiddenException('Adjustment is outside this match context');
    }
    const revoked = await this.prisma.adminAdjustment.update({
      where: { id: adjustmentId },
      data: {
        revokedAt: new Date(),
        revokedById: actor.actorId ?? actor.id ?? null,
        revokeReason: this.toStringValue(body?.reason) ?? 'Revoked',
      },
    });
    await this.refreshAdjustmentScope(
      match,
      adjustment.teamId,
      (adjustment.scope ?? 'MATCH') as AdminAdjustmentScopeValue,
    );
    return { ok: true, adjustment: revoked };
  }

  async updateResult(
    actor: Actor,
    matchId: string,
    teamId: string,
    payload: {
      kills?: number | null;
      teamKills?: number | null;
      placement?: number | null;
      playerKills?: Array<{
        playerId?: string | null;
        playerResultId?: string | null;
        kills: number;
        isAlive?: boolean | null;
        alive?: boolean | null;
        isKnocked?: boolean | null;
        knocked?: boolean | null;
      }>;
    },
  ) {
    const match = await this.ensureMatchOrg(actor, matchId);
    if (
      this.resolveTelemetryProvider(match as MatchTelemetryState) !==
      MatchDataSource.MANUAL
    ) {
      throw new BadRequestException(
        'Players are detected from telemetry for automatic matches',
      );
    }
    const lockState = this.lockStateFromMatch(match);
    if (lockState === 'LOCKED') {
      throw new ConflictException('Results are locked.');
    }

    await this.results.ensureResultsFromSlots(matchId);
    const slot = await this.prisma.matchSlotResult.findFirst({
      where: { matchId, teamId },
      select: { slotNumber: true, id: true },
    });
    if (!slot) {
      throw new BadRequestException('Team has no slot assignment');
    }

    if (payload?.playerKills?.length) {
      for (const pk of payload.playerKills) {
        const playerResultId = pk.playerResultId ?? null;
        if (!playerResultId) continue;
        const incomingAlive = pk.isAlive ?? pk.alive ?? null;
        await this.results.updatePlayerResult(
          actor as any,
          matchId,
          slot.slotNumber,
          playerResultId,
          {
            kills: pk.kills,
            alive: incomingAlive, // mirror only
            isAlive: incomingAlive,
            isKnocked: pk.isKnocked ?? pk.knocked,
          },
        );
      }
    }

    if (
      payload.placement !== undefined ||
      payload.teamKills !== undefined ||
      payload.kills !== undefined
    ) {
      await this.results.updateSlotResult(
        actor as any,
        matchId,
        slot.slotNumber,
        {
          placement:
            payload.placement !== undefined ? payload.placement : undefined,
          manualTotalKills:
            payload.teamKills !== undefined || payload.kills !== undefined
              ? true
              : undefined,
          totalKills:
            payload.teamKills !== undefined
              ? payload.teamKills
              : (payload.kills ?? undefined),
        },
      );
    } else {
      // still recompute to sync totals after player edits
      await this.results.recomputeSlotResult(matchId, slot.slotNumber);
    }
    const results = await this.getResults(actor, matchId);
    const result = results.results.find((r) => r.teamId === teamId) ?? null;
    return {
      ok: true,
      result,
      teams: results.results,
      locked: results.locked,
      lockState: results.lockState,
      lockReason: results.lockReason,
    };
  }

  async updateResultPlayers(
    actor: Actor,
    matchId: string,
    teamId: string,
    payload: UpdateTeamResultsDto,
  ) {
    return this.results.updateTeamPlayers(
      actor as any,
      matchId,
      teamId,
      payload ?? { players: [] },
    );
  }

  async updatePlacements(
    actor: Actor,
    matchId: string,
    placements: Array<{ teamId: string; placement: number }>,
    expectedVersion?: number | null,
  ) {
    return this.results.setPlacements(
      actor as any,
      matchId,
      placements,
      expectedVersion,
    );
  }

  async updateManualMatchResults(
    actor: Actor,
    matchId: string,
    payload: ManualMatchResultsPayload,
  ) {
    return this.results.setManualMatchResults(
      actor as any,
      matchId,
      (payload.results ?? []).map((row) => ({
        teamId: row.teamId ?? '',
        placement: Number(row.placement),
        kills: Number(row.kills),
      })),
      payload.expectedVersion ?? null,
    );
  }

  async releaseMatchResultOverrides(actor: Actor, matchId: string) {
    return this.results.releaseMatchOverrides(actor as any, matchId);
  }

  async releaseTeamResultOverrides(
    actor: Actor,
    matchId: string,
    teamId: string,
  ) {
    return this.results.releaseTeamOverrides(actor as any, matchId, teamId);
  }

  async releasePlayerResultOverrides(
    actor: Actor,
    matchId: string,
    playerId: string,
  ) {
    return this.results.releasePlayerOverrides(actor as any, matchId, playerId);
  }

  async setMatchPlayers(
    actor: Actor,
    matchId: string,
    teamId: string,
    playerIds: string[],
  ) {
    const match = await this.ensureMatchOrg(actor, matchId);
    const lockState = this.lockStateFromMatch(match);
    if (lockState === 'LOCKED') {
      throw new ConflictException('Results are locked.');
    }
    const gameKey = (match as any)?.game?.key ?? null;
    const maxPlayers = defaultTeamSizeForGame(gameKey);
    const unique = Array.from(new Set(playerIds.filter(Boolean)));
    // Match-level roster: game team-size cap. Zero players allowed.
    if (gameKey === GameKey.PUBG_MOBILE && unique.length > maxPlayers) {
      throw new BadRequestException(
        'PUBG MOBILE squads can include up to 4 players',
      );
    }
    if (gameKey !== GameKey.PUBG_MOBILE && unique.length > maxPlayers) {
      throw new BadRequestException(
        `Maximum ${maxPlayers} players can be selected for this match`,
      );
    }

    // Ensure team is assigned to match and slot exists
    const slot = await this.prisma.matchSlot.findFirst({
      where: { matchId, teamId, deletedAt: null },
      select: { slotNumber: true, id: true },
    });
    if (!slot) {
      throw new BadRequestException('Team is not assigned to this match');
    }

    // Validate roster membership
    if (unique.length) {
      const roster = await this.prisma.rosterEntry.findMany({
        where: { teamId, isActive: true, playerId: { in: unique } },
        select: { playerId: true },
      });
      const rosterIds = new Set(roster.map((r) => r.playerId));
      const missing = unique.filter((id) => !rosterIds.has(id));
      if (missing.length) {
        throw new BadRequestException(
          `Players not in roster: ${missing.join(', ')}`,
        );
      }
    }

    const organizationId =
      match.tournament?.organizationId ??
      actor.organizationId ??
      actor.actingOrgId ??
      (() => {
        throw new BadRequestException('organizationId is required');
      })();

    await this.prisma.$transaction(async (tx) => {
      await this.results.ensureResultsFromSlots(matchId, { tx });
      const slotResult = await tx.matchSlotResult.findUnique({
        where: { matchId_slotNumber: { matchId, slotNumber: slot.slotNumber } },
        select: { id: true },
      });
      if (!slotResult) {
        throw new BadRequestException('Slot result missing for team');
      }

      // Remove players no longer selected
      await tx.matchSlotPlayerResult.deleteMany({
        where: {
          slotResultId: slotResult.id,
          playerId: { notIn: unique.length ? unique : ['__none__'] },
        },
      });

      // Upsert selected players into slot results.
      const selectedPlayers = await Promise.all(
        unique.map(async (pid) => {
          const player = await tx.player.findUnique({
            where: { id: pid },
            select: { ign: true, realName: true, playerOpenId: true },
          });
          return {
            playerId: pid,
            playerName: player?.ign ?? player?.realName ?? 'Player',
            pubgAccountId: player?.playerOpenId ?? null,
          };
        }),
      );
      const selectedPlayerNames = uniqueSlotPlayerNames(
        selectedPlayers.map((player) => ({
          playerName: player.playerName,
          stableId: player.playerId,
        })),
      );

      for (const [playerIndex, selectedPlayer] of selectedPlayers.entries()) {
        const pid = selectedPlayer.playerId;
        const name = selectedPlayerNames[playerIndex];
        const pubgAccountId = selectedPlayer.pubgAccountId;
        const existing = await tx.matchSlotPlayerResult.findFirst({
          where: { slotResultId: slotResult.id, playerId: pid },
          select: { id: true },
        });
        if (existing) {
          await tx.matchSlotPlayerResult.update({
            where: { id: existing.id },
            data: { playerName: name, pubgAccountId },
          });
        } else {
          await tx.matchSlotPlayerResult.create({
            data: {
              slotResultId: slotResult.id,
              playerId: pid,
              pubgAccountId,
              playerName: name,
              kills: 0,
              knocks: 0,
              isAlive: true,
              alive: true,
              isKnocked: false,
              isAutoFilled: true,
              organizationId,
            },
          });
        }
      }

      await this.results.syncMatchPlayers(matchId, { tx });
    });

    await this.results.recomputeSlotResult(matchId, slot.slotNumber);
    return { ok: true };
  }

  private normalizeKills(value?: number, fallback?: number | null): number {
    if (value === null || value === undefined) return fallback ?? 0;
    const num = Math.trunc(Number(value));
    if (!Number.isFinite(num)) return fallback ?? 0;
    return Math.max(0, num);
  }

  private normalizePlacement(
    value?: number | null,
    fallback?: number | null,
  ): number | null {
    if (value === undefined) return fallback ?? null;
    if (value === null) return null;
    const num = Math.trunc(Number(value));
    if (!Number.isFinite(num)) return fallback ?? null;
    return Math.max(1, num);
  }

  private async derivedTeamKills(
    matchId: string,
    teamId: string,
  ): Promise<number> {
    const sr = (await this.prisma.matchSlotResult.findFirst({
      where: { matchId, teamId },
      include: { players: { select: { kills: true } } },
    })) as any;
    if (!sr) return 0;
    const killsFromPlayers =
      sr.players?.reduce((sum, p) => sum + (p.kills ?? 0), 0) ?? 0;
    return killsFromPlayers;
  }

  private ensurePlayerStatsForTeam(): void {
    return;
  }

  private async orderedMatchResults(matchId: string) {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { game: { select: { key: true } } },
    });
    const slotResults = await this.prisma.matchSlotResult.findMany({
      where: { matchId, teamId: { not: null } },
      orderBy: { slotNumber: 'asc' },
      include: {
        team: { select: { id: true, name: true, tag: true, logoUrl: true } },
        players: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    const assignedSlotResults = slotResults.filter((sr) => Boolean(sr.teamId));

    const rows = assignedSlotResults.map((sr) => {
      const wasPresentInMatch = sr.wasPresentInMatch ?? null;
      const isCompetitiveTeam = isCompetitiveResultsTeam(wasPresentInMatch);
      const placement = isCompetitiveTeam ? (sr.placement ?? null) : null;
      const placementPoints = getPlacementPoints(placement, match?.game?.key);
      const totalKills = isCompetitiveTeam ? (sr.totalKills ?? 0) : 0;
      const totalPoints = isCompetitiveTeam
        ? (sr.totalPoints ?? placementPoints + totalKills)
        : 0;
      const players =
        sr.players?.map((p) => {
          const alive = isCompetitiveTeam ? (p?.isAlive ?? null) : null;
          return {
            id: p.id,
            playerId: buildMatchPlayerKey({
              playerId: p.playerId ?? null,
              playerResultId: p.id,
            }),
            name: p.playerName ?? 'Player',
            kills: isCompetitiveTeam ? (p.kills ?? 0) : 0,
            knocks: p.knocks ?? null,
            assists: p.assists ?? null,
            isAlive: alive,
            alive,
            isKnocked: isCompetitiveTeam ? (p?.isKnocked ?? null) : null,
          };
        }) ?? [];
      return {
        id: sr.id,
        matchId: sr.matchId,
        teamId: sr.teamId as string,
        wasPresentInMatch,
        presenceStatus: derivePresenceStatus(wasPresentInMatch),
        slot: sr.slotNumber,
        kills: totalKills,
        placement,
        eliminatedAt: isCompetitiveTeam
          ? ((sr as { eliminatedAt?: Date | null }).eliminatedAt ?? null)
          : null,
        isLocked: isCompetitiveTeam
          ? ((sr as { isLocked?: boolean }).isLocked ?? false)
          : false,
        placementPoints,
        totalPoints,
        manualTotalKills: isCompetitiveTeam
          ? ((sr as { manualTotalKills?: boolean }).manualTotalKills ?? false)
          : false,
        team: sr.team,
        players,
      };
    });

    return this.sortResults(rows as any);
  }

  private sortResults<
    T extends {
      teamId: string;
      totalPoints: number;
      kills: number;
      placementPoints?: number | null;
      placement: number | null;
      slot: number;
      wasPresentInMatch?: boolean | null;
    },
  >(rows: T[]): T[] {
    return rows.slice().sort((a, b) => {
      const presenceOrder = comparePresenceStatus(
        a.wasPresentInMatch,
        b.wasPresentInMatch,
      );
      if (presenceOrder !== 0) return presenceOrder;
      const rankingOrder = compareRankingRows(a, b);
      if (rankingOrder !== 0) return rankingOrder;
      const aPlacement = a.placement ?? Number.POSITIVE_INFINITY;
      const bPlacement = b.placement ?? Number.POSITIVE_INFINITY;
      if (aPlacement !== bPlacement) return aPlacement - bPlacement;
      return a.slot - b.slot;
    });
  }

  private lockStateFromMatch(match: {
    status?: MatchStatus | null;
    liveState?: LiveState | null;
    dataSource?: MatchDataSource | null;
    dataMode?: DataMode | null;
    controlState?: {
      state?: string | null;
      metaJson?: Prisma.JsonValue | null;
      resultsManualLock?: boolean | null;
      resultsForceUnlock?: boolean | null;
    } | null;
  }): ResultLockState {
    return deriveMatchLockContract({
      status: match.status ?? null,
      liveState: match.liveState ?? match.controlState?.state ?? null,
      controlState: match.controlState?.state ?? null,
      metaJson: match.controlState?.metaJson ?? null,
      dataSource: match.dataSource ?? null,
      dataMode: match.dataMode ?? null,
      manualLock: match.controlState?.resultsManualLock ?? null,
      forceUnlock: match.controlState?.resultsForceUnlock ?? null,
    }).resultLockState;
  }

  private async ensureResultAdjustmentMatch(
    actor: Actor,
    matchId: string,
  ): Promise<ResultAdjustmentMatchContext> {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        id: true,
        organizationId: true,
        tournamentId: true,
        stageId: true,
        groupId: true,
        sessionId: true,
        tournament: {
          select: {
            ownerUserId: true,
            organizationId: true,
            status: true,
          },
        },
      },
    });
    if (!match) throw new NotFoundException('Match not found');
    const orgId = match.tournament?.organizationId ?? match.organizationId;
    if (!this.canEdit(actor, match.tournament?.ownerUserId ?? null, orgId)) {
      throw new ForbiddenException('Not allowed to adjust results');
    }
    if (match.tournament?.status === TournamentStatus.ARCHIVED) {
      throw new BadRequestException('Tournament is not active');
    }
    return match;
  }

  private cleanAdjustmentTeamId(value: string | null | undefined): string {
    const teamId = this.toStringValue(value);
    if (!teamId) {
      throw new BadRequestException('teamId is required');
    }
    return teamId;
  }

  private normalizeResultAdjustmentType(
    value: string | null | undefined,
  ): AdminAdjustmentTypeValue {
    const normalized = (value ?? 'POINT_DELTA').toString().trim().toUpperCase();
    if (
      ADMIN_ADJUSTMENT_TYPES.includes(normalized as AdminAdjustmentTypeValue)
    ) {
      return normalized as AdminAdjustmentTypeValue;
    }
    throw new BadRequestException('Invalid adjustment type');
  }

  private normalizeResultAdjustmentScope(
    value: string | null | undefined,
    type: AdminAdjustmentTypeValue,
    match: ResultAdjustmentMatchContext,
  ): AdminAdjustmentScopeValue {
    const forcedScope =
      type === 'ZERO_MATCH_POINTS' || type === 'DISQUALIFY_MATCH'
        ? 'MATCH'
        : type === 'DISQUALIFY_GROUP'
          ? 'GROUP'
          : type === 'DISQUALIFY_STAGE'
            ? 'STAGE'
            : type === 'DISQUALIFY_TOURNAMENT'
              ? 'TOURNAMENT'
              : type === 'DISQUALIFY_SESSION'
                ? 'SESSION'
                : null;
    const normalized = (forcedScope ?? value ?? 'MATCH')
      .toString()
      .trim()
      .toUpperCase();
    if (
      !ADMIN_ADJUSTMENT_SCOPES.includes(normalized as AdminAdjustmentScopeValue)
    ) {
      throw new BadRequestException('Invalid adjustment scope');
    }
    const scope = normalized as AdminAdjustmentScopeValue;
    if (scope === 'GROUP' && !match.groupId) {
      throw new BadRequestException('This match has no group scope');
    }
    if (scope === 'STAGE' && !match.stageId) {
      throw new BadRequestException('This match has no stage scope');
    }
    if (scope === 'TOURNAMENT' && !match.tournamentId) {
      throw new BadRequestException('This match has no tournament scope');
    }
    if (scope === 'SESSION' && !match.sessionId) {
      throw new BadRequestException('This match has no event/session scope');
    }
    return scope;
  }

  private normalizeAdjustmentDelta(value: number | string | null | undefined) {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim().length > 0
          ? Number(value)
          : NaN;
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      throw new BadRequestException('pointsDelta must be an integer');
    }
    if (parsed === 0) {
      throw new BadRequestException('pointsDelta cannot be zero');
    }
    return parsed;
  }

  private defaultAdjustmentReason(
    type: AdminAdjustmentTypeValue,
    scope: AdminAdjustmentScopeValue,
    pointsDelta: number,
  ) {
    if (type === 'POINT_DELTA') {
      return `${scope.toLowerCase()} point adjustment ${pointsDelta > 0 ? '+' : ''}${pointsDelta}`;
    }
    if (type === 'ZERO_MATCH_POINTS') return 'Zero match points';
    return `${scope.toLowerCase()} disqualification`;
  }

  private async ensureAdjustmentTeamInMatch(matchId: string, teamId: string) {
    const exists =
      (await this.prisma.matchSlot.findFirst({
        where: { matchId, teamId, deletedAt: null },
        select: { id: true },
      })) ??
      (await this.prisma.matchTeam.findFirst({
        where: { matchId, teamId, deletedAt: null },
        select: { id: true },
      })) ??
      (await this.prisma.matchSlotResult.findFirst({
        where: { matchId, teamId },
        select: { id: true },
      }));
    if (!exists) {
      throw new BadRequestException('Team is not assigned to this match');
    }
  }

  private adjustmentContextFilters(match: ResultAdjustmentMatchContext) {
    return [
      { matchId: match.id },
      match.groupId ? { groupId: match.groupId } : null,
      match.stageId ? { stageId: match.stageId } : null,
      match.tournamentId ? { tournamentId: match.tournamentId } : null,
      match.sessionId ? { sessionId: match.sessionId } : null,
    ].filter(Boolean) as Prisma.AdminAdjustmentWhereInput[];
  }

  private adjustmentBelongsToMatchContext(
    adjustment: {
      matchId?: string | null;
      groupId?: string | null;
      stageId?: string | null;
      tournamentId?: string | null;
      sessionId?: string | null;
    },
    match: ResultAdjustmentMatchContext,
  ) {
    return (
      adjustment.matchId === match.id ||
      Boolean(adjustment.groupId && adjustment.groupId === match.groupId) ||
      Boolean(adjustment.stageId && adjustment.stageId === match.stageId) ||
      Boolean(
        adjustment.tournamentId &&
        adjustment.tournamentId === match.tournamentId,
      ) ||
      Boolean(adjustment.sessionId && adjustment.sessionId === match.sessionId)
    );
  }

  private adjustmentMatchWhere(
    match: ResultAdjustmentMatchContext,
    scope: AdminAdjustmentScopeValue,
  ): Prisma.MatchWhereInput {
    if (scope === 'MATCH') return { id: match.id };
    if (scope === 'GROUP') return { groupId: match.groupId ?? undefined };
    if (scope === 'STAGE') return { stageId: match.stageId ?? undefined };
    if (scope === 'TOURNAMENT') {
      return { tournamentId: match.tournamentId ?? undefined };
    }
    return { sessionId: match.sessionId ?? undefined };
  }

  private async refreshAdjustmentScope(
    match: ResultAdjustmentMatchContext,
    teamId: string,
    scope: AdminAdjustmentScopeValue,
  ) {
    const matchWhere = this.adjustmentMatchWhere(match, scope);
    const matches = await this.prisma.match.findMany({
      where: { ...matchWhere, deletedAt: null },
      select: { id: true, tournamentId: true },
    });
    for (const affected of matches) {
      try {
        await this.results.recomputeSlotAfterAdjustment(
          affected.id,
          teamId,
          null,
          { enforceEditable: false },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Adjustment slot refresh skipped match=${affected.id} team=${teamId}: ${message}`,
        );
      }
      if (affected.tournamentId) {
        try {
          await this.scoring.recomputeMatchAndTournament(affected.id);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Adjustment scoring refresh skipped match=${affected.id}: ${message}`,
          );
        }
      }
    }
  }

  private async ensureMatchOrg(actor: Actor, matchId: string) {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        id: true,
        organizationId: true,
        tournamentId: true,
        stageId: true,
        groupId: true,
        sessionId: true,
        liveState: true,
        status: true,
        dataSource: true,
        dataMode: true,
        slotCount: true,
        adapterKey: true,
        controlState: {
          select: {
            state: true,
            metaJson: true,
            resultsManualLock: true,
            resultsForceUnlock: true,
            updatedAt: true,
            updatedByUserId: true,
          },
        },
        tournament: {
          select: {
            ownerUserId: true,
            organizationId: true,
            status: true,
          },
        },
        game: { select: { key: true } },
      },
    });
    if (!match) throw new NotFoundException('Match not found');
    if (
      !this.canEdit(
        actor,
        match.tournament?.ownerUserId ?? null,
        match.tournament?.organizationId ?? match.organizationId ?? null,
      )
    ) {
      throw new ForbiddenException('Not allowed to edit slots for this match');
    }
    if (match.tournament?.status === TournamentStatus.ARCHIVED) {
      throw new BadRequestException('Tournament is not active');
    }
    return match;
  }

  async assignMatchTeamSlot(actor: Actor, matchId: string, dto: AssignSlotDto) {
    const teamId = dto.teamId;
    if (!teamId) throw new BadRequestException('teamId is required');
    const slot = Number(dto.slot);
    await this.setSlot(matchId, slot, teamId, actor);
    return { ok: true, slot, teamId };
  }

  private parseDateInput(
    input: string | number | Date | null | undefined,
  ): Date | null {
    if (input === null || input === undefined) return null;
    return input instanceof Date ? input : new Date(input);
  }

  private parseScheduledDateInput(
    input: string | number | Date | null | undefined,
  ): Date | null {
    if (input === null || input === undefined || input === '') return null;
    if (typeof input === 'string') {
      const trimmed = input.trim();
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
      if (match) {
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const date = new Date(Date.UTC(year, month - 1, day));
        if (
          date.getUTCFullYear() !== year ||
          date.getUTCMonth() !== month - 1 ||
          date.getUTCDate() !== day
        ) {
          throw new BadRequestException('scheduledAt must be a valid date');
        }
        return date;
      }
    }
    return this.parseDateInput(input);
  }

  private async resolveGameIdentity(params: {
    preferredGameId?: string | null;
    gameKey?: GameKey | null;
    fallbackGameKey?: GameKey | null;
  }): Promise<{ id: string; key: GameKey }> {
    const preferredGameId = params.preferredGameId?.trim() || null;
    const explicitGameKey = params.gameKey ?? null;
    const fallbackGameKey = params.fallbackGameKey ?? null;

    const gameById = preferredGameId
      ? await this.prisma.game.findUnique({
          where: { id: preferredGameId },
          select: { id: true, key: true },
        })
      : null;

    if (preferredGameId && !gameById) {
      throw new BadRequestException(`Invalid gameId: ${preferredGameId}`);
    }

    const resolvedGameKey =
      explicitGameKey ?? fallbackGameKey ?? gameById?.key ?? null;

    if (!resolvedGameKey) {
      throw new BadRequestException('gameKey is required');
    }

    if (gameById && gameById.key !== resolvedGameKey) {
      throw new BadRequestException(
        `gameId ${gameById.id} does not match gameKey ${resolvedGameKey}`,
      );
    }

    if (gameById) {
      return gameById;
    }

    const gameByKey = await this.prisma.game.findUnique({
      where: { key: resolvedGameKey },
      select: { id: true, key: true },
    });

    if (!gameByKey) {
      throw new BadRequestException(
        `No Game record found for gameKey ${resolvedGameKey}`,
      );
    }

    return gameByKey;
  }

  private async resolveGameId(
    preferredGameId?: string | null,
    gameKey?: GameKey | null,
    fallbackGameKey?: GameKey | null,
  ): Promise<string> {
    const game = await this.resolveGameIdentity({
      preferredGameId,
      gameKey,
      fallbackGameKey,
    });
    return game.id;
  }

  private normalizeAdapterKey(input: string | null | undefined): string | null {
    if (input === undefined || input === null) return input ?? null;
    const trimmed = input.trim();
    if (!trimmed) return null;
    return trimmed;
  }

  private validateAdapterKeyForGame(
    adapterKey: string | null,
    gameKey: GameKey,
  ): string | null {
    if (!adapterKey) return null;
    const adapter = this.adapters.getAdapterByKey(adapterKey);
    if (!adapter) {
      throw new BadRequestException(`Unknown adapterKey: ${adapterKey}`);
    }
    if (adapter.gameKey !== gameKey) {
      throw new BadRequestException(
        `adapterKey ${adapter.key} is not valid for gameKey ${gameKey}`,
      );
    }
    return adapter.key;
  }

  private normalizePcobSessionId(
    input: string | null | undefined,
  ): string | null {
    if (input === undefined || input === null) return null;
    const trimmed = input.trim();
    return trimmed ? trimmed : null;
  }

  private resolveTelemetryProvider(
    match: MatchTelemetryState,
  ): TelemetryProvider {
    return resolveCanonicalTelemetryProvider({
      dataSource: match.dataSource ?? null,
      dataMode: match.dataMode ?? null,
      pcobSessionId: match.pcobSessionId ?? null,
      pcobMode: match.pcobMode ?? null,
      adapterKey: match.adapterKey ?? null,
    });
  }

  private resolveTelemetryWriteData(params: {
    current?: MatchTelemetryState | null;
    requestedProvider: TelemetryProvider;
    requestedAdapterKey?: string | null;
    requestedPcobSessionId?: string | null;
    effectiveGameKey: GameKey;
  }): MatchTelemetryWriteData {
    const current = params.current ?? null;
    const requestedProvider = params.requestedProvider;
    if (
      requestedProvider !== MatchDataSource.MANUAL &&
      requestedProvider !== MatchDataSource.API
    ) {
      throw new BadRequestException('dataSource must be one of MANUAL, API');
    }
    if (
      params.effectiveGameKey === GameKey.VALORANT &&
      requestedProvider === MatchDataSource.API
    ) {
      throw new BadRequestException(
        'VALORANT API source is pending Riot approval; use MANUAL for now',
      );
    }
    const requestedAdapterKey =
      params.requestedAdapterKey !== undefined
        ? this.normalizeAdapterKey(params.requestedAdapterKey)
        : undefined;
    const requestedPcobSessionId =
      params.requestedPcobSessionId !== undefined
        ? this.normalizePcobSessionId(params.requestedPcobSessionId)
        : undefined;

    if (requestedPcobSessionId !== undefined) {
      throw new BadRequestException(
        'pcobSessionId is no longer a supported live source field',
      );
    }

    let nextAdapterKey =
      requestedAdapterKey !== undefined
        ? requestedAdapterKey
        : this.normalizeAdapterKey(current?.adapterKey ?? null);

    if (nextAdapterKey === PCOB_ADAPTER_KEY) {
      if (requestedAdapterKey !== undefined) {
        throw new BadRequestException(
          'adapterKey pubgm-pcob is no longer a supported live source',
        );
      }
      nextAdapterKey = null;
    }

    const validatedAdapterKey = this.validateAdapterKeyForGame(
      nextAdapterKey,
      params.effectiveGameKey,
    );

    return {
      dataSource: requestedProvider,
      dataMode: DataMode.MANUAL,
      pcobSessionId: null,
      pcobBoundAt: null,
      pcobLastSeenAt: null,
      pcobMode: false,
      pcobKillSyncEnabled: false,
      adapterKey: validatedAdapterKey,
    };
  }

  private async broadcastScoreboardSafe(matchId: string) {
    try {
      await this.scoreboard.broadcast(matchId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[Matches] scoreboard broadcast failed: ${msg}`);
    }
  }

  private async seedControlState(
    tx: Prisma.TransactionClient,
    matchId: string,
    organizationId: string | null,
  ) {
    if (!organizationId) {
      throw new BadRequestException(
        'organizationId is required for control state seed',
      );
    }
    await tx.matchControlState.upsert({
      where: { matchId },
      create: {
        matchId,
        state: 'READY',
        organizationId,
      },
      update: { organizationId },
    });
  }

  private async buildMatchCreateInput(
    body: MatchCreatePayload,
    ctx: {
      groupId: string;
      stageId: string;
      tournamentId: string;
      organizationId: string;
      tournamentGameKey: GameKey | null;
    },
  ): Promise<Prisma.MatchUncheckedCreateInput & Record<string, unknown>> {
    if (body?.pcobStatus !== undefined) {
      throw new BadRequestException(
        'pcobStatus is no longer a supported live source field',
      );
    }
    const pcobStatus = PcobStatus.PENDING;
    const requestedGameKey = this.normalizeGameKey(body?.gameKey);
    const game = await this.resolveGameIdentity({
      preferredGameId: body?.gameId ?? null,
      gameKey: requestedGameKey,
      fallbackGameKey: ctx.tournamentGameKey ?? null,
    });
    const effectiveGameKey = game.key;
    await assertOrganizationGameAccess(
      this.prisma,
      ctx.organizationId,
      effectiveGameKey,
    );
    const slotCount = this.normalizeSlotCount(
      effectiveGameKey,
      body?.slotCount ?? null,
    );
    const requestedAdapterKey = this.normalizeAdapterKey(body?.adapterKey);
    const requestedPcobSessionId =
      body?.pcobSessionId !== undefined
        ? this.normalizePcobSessionId(body.pcobSessionId ?? null)
        : undefined;

    let map: MatchMap | null = null;
    let recallEnabled = false;
    let requestedProvider: TelemetryProvider = MatchDataSource.MANUAL;

    if (effectiveGameKey === GameKey.PUBG_MOBILE) {
      map = this.parsePubgMap(body?.map);
      const fallbackRecall = map === MatchMap.RONDO ? true : false;
      recallEnabled =
        body?.recallEnabled !== undefined && body.recallEnabled !== null
          ? !!body.recallEnabled
          : fallbackRecall;
      requestedProvider =
        resolveTelemetryProviderInput({
          dataSource: this.parsePubgDataSource(body?.dataSource),
          dataMode: this.parseDataMode(body?.dataMode),
        }) ?? MatchDataSource.MANUAL;
    } else {
      map = this.parseMap(body?.map) ?? null;
      const fallbackRecall = map === MatchMap.RONDO ? true : false;
      recallEnabled =
        body?.recallEnabled !== undefined && body.recallEnabled !== null
          ? !!body.recallEnabled
          : fallbackRecall;
      requestedProvider =
        resolveTelemetryProviderInput({
          dataSource: this.parseDataSource(body?.dataSource),
          dataMode: this.parseDataMode(body?.dataMode),
        }) ?? MatchDataSource.MANUAL;
    }

    const providerData = this.resolveTelemetryWriteData({
      requestedProvider,
      requestedAdapterKey,
      requestedPcobSessionId,
      effectiveGameKey,
    });
    const resultSource = this.parseMatchResultSource(
      body?.resultSource,
      requestedProvider,
    );

    return {
      name: body?.name ?? null,
      tournamentId: ctx.tournamentId,
      organizationId: ctx.organizationId,
      stageId: ctx.stageId,
      groupId: ctx.groupId,
      gameId: game.id,
      map,
      recallEnabled,
      ...providerData,
      resultSource,
      pcobStatus,
      matchNumber: body?.matchNumber ?? null,
      status: body?.status ?? MatchStatus.DRAFT,
      scheduledAt: this.parseScheduledDateInput(body?.scheduledAt),
      startedAt: this.parseDateInput(body?.startAt),
      endedAt: this.parseDateInput(body?.endsAt),
      slotCount,
    };
  }

  private async buildSessionMatchCreateInput(
    body: SessionMatchCreatePayload,
    ctx: {
      sessionId: string;
      organizationId: string;
      slotCount: number;
      gameId: string | null;
      rulesetId: string | null;
      adapterKey: string | null;
      sessionGameKey: GameKey | null;
    },
  ): Promise<Prisma.MatchUncheckedCreateInput & Record<string, unknown>> {
    if (body?.pcobStatus !== undefined) {
      throw new BadRequestException(
        'pcobStatus is no longer a supported live source field',
      );
    }
    const pcobStatus = PcobStatus.PENDING;
    const requestedGameKey = this.normalizeGameKey(body?.gameKey);
    const game = await this.resolveGameIdentity({
      preferredGameId: body?.gameId ?? ctx.gameId,
      gameKey: requestedGameKey,
      fallbackGameKey: ctx.sessionGameKey ?? null,
    });
    const effectiveGameKey = game.key;
    await assertOrganizationGameAccess(
      this.prisma,
      ctx.organizationId,
      effectiveGameKey,
    );
    const slotCount = this.normalizeSlotCount(
      effectiveGameKey,
      body?.slotCount ?? ctx.slotCount,
    );

    let map: MatchMap | null = null;
    let recallEnabled = false;
    let requestedProvider: TelemetryProvider = MatchDataSource.MANUAL;
    const requestedAdapterKey =
      this.normalizeAdapterKey(body?.adapterKey) ??
      this.normalizeAdapterKey(ctx.adapterKey);
    const requestedPcobSessionId =
      body?.pcobSessionId !== undefined
        ? this.normalizePcobSessionId(body.pcobSessionId ?? null)
        : undefined;

    if (effectiveGameKey === GameKey.PUBG_MOBILE) {
      map = this.parsePubgMap(body?.map);
      const fallbackRecall = map === MatchMap.RONDO;
      recallEnabled =
        body?.recallEnabled !== undefined && body.recallEnabled !== null
          ? !!body.recallEnabled
          : fallbackRecall;
      requestedProvider =
        resolveTelemetryProviderInput({
          dataSource: this.parsePubgDataSource(body?.dataSource),
          dataMode: this.parseDataMode(body?.dataMode),
        }) ?? MatchDataSource.MANUAL;
    } else {
      map = this.parseMap(body?.map) ?? null;
      const fallbackRecall = map === MatchMap.RONDO;
      recallEnabled =
        body?.recallEnabled !== undefined && body.recallEnabled !== null
          ? !!body.recallEnabled
          : fallbackRecall;
      requestedProvider =
        resolveTelemetryProviderInput({
          dataSource: this.parseDataSource(body?.dataSource),
          dataMode: this.parseDataMode(body?.dataMode),
        }) ?? MatchDataSource.MANUAL;
    }

    const providerData = this.resolveTelemetryWriteData({
      requestedProvider,
      requestedAdapterKey,
      requestedPcobSessionId,
      effectiveGameKey,
    });
    const resultSource = this.parseMatchResultSource(
      body?.resultSource,
      requestedProvider,
    );

    return {
      name: body?.name ?? null,
      sessionId: ctx.sessionId,
      tournamentId: null,
      stageId: null,
      groupId: null,
      organizationId: ctx.organizationId,
      ownerUserId: null,
      gameId: game.id,
      rulesetId: body?.rulesetId ?? ctx.rulesetId ?? null,
      map,
      recallEnabled,
      ...providerData,
      resultSource,
      pcobStatus,
      matchNumber: body?.matchNumber ?? null,
      status: body?.status ?? MatchStatus.DRAFT,
      scheduledAt: this.parseScheduledDateInput(body?.scheduledAt),
      startedAt: this.parseDateInput(body?.startAt),
      endedAt: this.parseDateInput(body?.endsAt),
      slotCount,
    };
  }

  private async getGroupTeamContext(
    tx: Prisma.TransactionClient,
    groupId: string,
  ) {
    const groupTeams = await tx.groupTeam.findMany({
      where: {
        groupId,
        deletedAt: null,
        tournamentTeam: { deletedAt: null },
      },
      include: { tournamentTeam: { select: { teamId: true } } },
    });

    const teamMap = new Map<string, string>();
    for (const gt of groupTeams) {
      const teamId = gt.tournamentTeam?.teamId ?? null;
      if (teamId && !teamMap.has(teamId)) {
        teamMap.set(teamId, gt.tournamentTeamId);
      }
    }

    return { groupTeams, teamMap };
  }

  private async attachGroupTeams(
    tx: Prisma.TransactionClient,
    matchId: string,
    teamMap: Map<string, string>,
  ) {
    if (teamMap.size === 0) return;
    const existingCount = await tx.matchTeam.count({
      where: { matchId, deletedAt: null },
    });
    if (existingCount > 0) return;
    await tx.matchTeam.createMany({
      data: Array.from(teamMap.entries()).map(([teamId, tournamentTeamId]) => ({
        matchId,
        teamId,
        tournamentTeamId,
      })),
    });
  }

  private async createMatchWithTeams(
    ctx: {
      groupId: string;
      stageId: string;
      tournamentId: string;
      organizationId: string;
    },
    data: Prisma.MatchUncheckedCreateInput & Record<string, unknown>,
  ): Promise<MatchCore> {
    return this.prisma.$transaction(async (tx) => {
      const { teamMap } = await this.getGroupTeamContext(tx, ctx.groupId);
      const match = await tx.match.create({
        data: this.pruneUnsupportedMatchFields(
          data,
        ) as Prisma.MatchUncheckedCreateInput,
        select: this.selectOrUndefined(this.matchSelect),
      });
      await this.seedControlState(tx, match.id, ctx.organizationId);
      await this.attachGroupTeams(tx, match.id, teamMap);
      return match;
    });
  }

  async create(
    tournamentId: string,
    body: MatchCreatePayload,
    actor: Actor,
  ): Promise<MatchCore> {
    const ctx = await this.resolveGroupContext(
      actor,
      body?.groupId ?? null,
      tournamentId,
    );
    const data = await this.buildMatchCreateInput(
      { ...body, groupId: ctx.groupId },
      ctx,
    );
    return this.withMode((await this.createMatchWithTeams(ctx, data)) as any);
  }

  async createForGroup(
    actor: Actor,
    groupId: string,
    body: MatchCreatePayload,
  ) {
    const ctx = await this.resolveGroupContext(actor, body?.groupId ?? groupId);
    if (body?.groupId && body.groupId !== groupId) {
      throw new BadRequestException('Body groupId must match route groupId');
    }
    const data = await this.buildMatchCreateInput(
      { ...body, groupId: ctx.groupId },
      ctx,
    );
    return this.withMode((await this.createMatchWithTeams(ctx, data)) as any);
  }

  async createForSession(
    actor: Actor,
    sessionId: string,
    body: SessionMatchCreatePayload,
  ): Promise<MatchCore> {
    const ctx = await this.resolveSessionContext(actor, sessionId);
    return this.prisma.$transaction(async (tx) => {
      const existingMax = await tx.match.aggregate({
        where: {
          sessionId: ctx.sessionId,
          deletedAt: null,
        },
        _max: { matchNumber: true },
      });
      const data = await this.buildSessionMatchCreateInput(
        {
          ...body,
          matchNumber:
            body?.matchNumber ?? (existingMax._max.matchNumber ?? 0) + 1,
        },
        ctx,
      );
      data.ownerUserId = actor.actorId ?? actor.id ?? null;
      const match = await tx.match.create({
        data: this.pruneUnsupportedMatchFields(
          data,
        ) as Prisma.MatchUncheckedCreateInput,
        select: this.selectOrUndefined(this.matchSelect),
      });
      await this.seedControlState(tx, match.id, ctx.organizationId);

      // Seed event teams as match candidates only. Slot placement stays a
      // per-match decision unless an organizer explicitly syncs from a slot source.
      const shouldLoadTeamsFromEvent = body?.loadTeamsFromEvent !== false;
      const registrations = shouldLoadTeamsFromEvent
        ? await tx.sessionRegistration.findMany({
            where: {
              sessionId: ctx.sessionId,
              deletedAt: null,
              status: {
                in: [
                  SessionRegistrationStatus.CONFIRMED,
                  SessionRegistrationStatus.CHECKED_IN,
                ],
              },
            },
            select: {
              teamId: true,
              slotNumber: true,
            },
            orderBy: { slotNumber: 'asc' },
          })
        : [];

      const sessionDiscordConfig = (
        tx as Prisma.TransactionClient & {
          sessionDiscordConfig?: Prisma.TransactionClient['sessionDiscordConfig'];
        }
      ).sessionDiscordConfig;
      const discordConfig =
        registrations.length > 0
          ? sessionDiscordConfig
            ? await sessionDiscordConfig.findUnique({
                where: { sessionId: ctx.sessionId },
                select: { id: true },
              })
            : { id: '__legacy_test_discord_session__' }
          : null;
      const bannedTeamIds =
        registrations.length > 0 && discordConfig
          ? new Set(
              (
                await tx.teamBan.findMany({
                  where: {
                    organizationId: ctx.organizationId,
                    teamId: {
                      in: registrations.map(
                        (registration) => registration.teamId,
                      ),
                    },
                    revokedAt: null,
                    OR: [
                      { expiresAt: null },
                      { expiresAt: { gt: new Date() } },
                    ],
                    AND: [
                      {
                        OR: [
                          { scope: TeamBanScope.TEAM },
                          {
                            scope: TeamBanScope.SESSION,
                            sessionId: ctx.sessionId,
                          },
                        ],
                      },
                    ],
                  },
                  select: { teamId: true },
                })
              ).map((ban) => ban.teamId),
            )
          : new Set<string>();
      const eligibleRegistrations = registrations.filter(
        (registration) => !bannedTeamIds.has(registration.teamId),
      );

      if (eligibleRegistrations.length > 0) {
        await tx.matchTeam.createMany({
          data: eligibleRegistrations.map((registration) => ({
            matchId: match.id,
            teamId: registration.teamId,
            slot: null,
          })),
          skipDuplicates: true,
        });
      }

      return this.withMode(match);
    });
  }

  async listBySession(
    actor: Actor,
    sessionId: string,
  ): Promise<SessionMatchListItem[]> {
    const ctx = await this.resolveSessionContext(actor, sessionId);
    const matches = await this.prisma.match.findMany({
      where: {
        sessionId: ctx.sessionId,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
      orderBy: [{ matchNumber: 'asc' }, { createdAt: 'asc' }],
      select: sessionMatchListSelect,
    });
    return matches.map((match) => this.withMode(match));
  }

  async createBulkForGroup(
    actor: Actor,
    groupId: string,
    payload: { matches: MatchCreatePayload[] } | MatchCreatePayload[],
  ): Promise<MatchCore[]> {
    const drafts = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.matches)
        ? payload.matches
        : [];
    if (drafts.length === 0) return [];

    const ctx = await this.resolveGroupContext(actor, groupId);
    const dataList = await Promise.all(
      drafts.map(async (draft) => {
        if (draft?.groupId && draft.groupId !== groupId) {
          throw new BadRequestException(
            'All matches must target the same group',
          );
        }
        const data = await this.buildMatchCreateInput(
          { ...draft, groupId: ctx.groupId },
          ctx,
        );
        if (!data.id) {
          (data as { id: string }).id = randomUUID();
        }
        return data;
      }),
    );

    return this.prisma.$transaction(async (tx) => {
      const { teamMap } = await this.getGroupTeamContext(tx, ctx.groupId);

      await tx.match.createMany({
        data: dataList.map(
          (d) =>
            this.pruneUnsupportedMatchFields(
              d,
            ) as Prisma.MatchUncheckedCreateInput,
        ),
      });

      for (const entry of dataList) {
        await this.seedControlState(
          tx,
          (entry as { id: string }).id,
          ctx.organizationId,
        );
      }

      if (teamMap.size > 0) {
        const matchTeamRows = dataList.flatMap((entry) =>
          Array.from(teamMap.entries()).map(([teamId, tournamentTeamId]) => ({
            matchId: (entry as { id: string }).id,
            teamId,
            tournamentTeamId,
          })),
        );
        if (matchTeamRows.length > 0) {
          await tx.matchTeam.createMany({
            data: matchTeamRows,
            skipDuplicates: true,
          });
        }
      }

      const created = await tx.match.findMany({
        where: {
          id: {
            in: dataList.map((entry) => (entry as { id: string }).id),
          },
        },
        select: this.selectOrUndefined(this.matchSelect),
      });

      return created.map((m) => this.withMode(m));
    });
  }

  async addTeams(matchId: string, teamIds: string[], actor: Actor) {
    const match = (await this.getMatch(matchId, actor)) as any;
    this.ensureSlotsEditable(match);
    const normalizedTeamIds = Array.from(
      new Set(
        (teamIds ?? [])
          .map((teamId) => (typeof teamId === 'string' ? teamId.trim() : ''))
          .filter((teamId) => teamId.length > 0),
      ),
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.matchTeam.deleteMany({
        where: { matchId, deletedAt: null },
      });
      if (normalizedTeamIds.length) {
        await tx.matchTeam.createMany({
          data: normalizedTeamIds.map((teamId) => ({ matchId, teamId })),
          skipDuplicates: true,
        });
      }
      await tx.matchSlot.deleteMany({
        where:
          normalizedTeamIds.length > 0
            ? {
                matchId,
                OR: [
                  { teamId: null },
                  { teamId: { notIn: normalizedTeamIds } },
                ],
              }
            : { matchId },
      });
      await this.results.ensureResultsFromSlots(match.id as string, { tx });
      await this.syncMatchTeamSlotMirrorFromSlotsInTransaction(
        tx,
        match.id as string,
      );
      await this.updateManualClearedTeamIds(
        match.id as string,
        match.organizationId ?? match.tournament?.organizationId ?? null,
        (current) => {
          for (const teamId of [...current]) {
            if (!normalizedTeamIds.includes(teamId)) {
              current.delete(teamId);
            }
          }
          return current;
        },
        tx,
      );
    });
    await this.notifyLobbyContractChanged(match.id as string, {
      refreshLiveState: this.shouldRefreshLiveSlotContract(match),
    });
    return this.listTeams(actor, match.id as string);
  }

  async removeTeam(matchId: string, teamId: string, actor: Actor) {
    const match = (await this.getMatch(matchId, actor)) as any;
    this.ensureSlotsEditable(match);
    await this.prisma.$transaction(async (tx) => {
      await tx.matchTeam.deleteMany({
        where: { matchId: match.id, teamId },
      });
      await tx.matchSlot.deleteMany({
        where: { matchId: match.id, teamId },
      });
      await this.results.ensureResultsFromSlots(match.id as string, { tx });
      await this.clearMatchTeamSlotMirrorInTransaction(tx, match.id as string, {
        teamId,
      });
      await this.updateManualClearedTeamIds(
        match.id,
        match.organizationId ?? match.tournament?.organizationId ?? null,
        (current) => {
          current.delete(teamId);
          return current;
        },
        tx,
      );
    });
    if ((match.status as MatchStatus) === MatchStatus.LIVE) {
      await this.autoEndIfLastTeamAlive(matchId);
    }
    await this.notifyLobbyContractChanged(match.id as string, {
      refreshLiveState: this.shouldRefreshLiveSlotContract(match),
    });
    return this.listTeams(actor, match.id as string);
  }

  async setSlot(
    matchId: string,
    slotNumber: number,
    teamId: string,
    actor: Actor,
  ) {
    const { match, capability } = await this.getSlotContext(actor, matchId);
    this.ensureSlotsEnabled(capability);
    this.ensureSlotsEditable(match);
    const normalizedSlot = this.validateSlotNumber(slotNumber, capability);
    if (!teamId) {
      throw new BadRequestException('teamId is required');
    }
    await this.ensureTeamAllowedForMatch(match, teamId);
    await this.prisma.$transaction(async (tx) => {
      await this.applySlotAssignmentInTransaction(
        tx,
        match,
        normalizedSlot,
        teamId,
      );
    });

    await this.logSlotAudit(
      AuditAction.SLOT_SET,
      match.id,
      match.organizationId ?? match.tournament?.organizationId ?? null,
      actor,
      { slotNumber: normalizedSlot, teamId },
    );
    await this.notifyLobbyContractChanged(match.id, {
      refreshLiveState: this.shouldRefreshLiveSlotContract(match),
    });

    return this.listSlots(actor, match.id);
  }

  async moveSlot(matchId: string, dto: MoveSlotDto, actor: Actor) {
    const { match, capability } = await this.getSlotContext(actor, matchId);
    this.ensureSlotsEnabled(capability);
    this.ensureSlotsEditable(match);

    const teamId = dto.teamId?.trim();
    if (!teamId) {
      throw new BadRequestException('teamId is required');
    }

    const targetSlotNumber = this.validateSlotNumber(
      Number(dto.targetSlotNumber),
      capability,
    );
    await this.ensureTeamAllowedForMatch(match, teamId);
    const expectedSourceSlot =
      dto.sourceSlotNumber === null || dto.sourceSlotNumber === undefined
        ? null
        : this.validateSlotNumber(Number(dto.sourceSlotNumber), capability);
    let sourceSlotNumber: number | null = null;
    let displacedTeamId: string | null = null;

    await this.prisma.$transaction(async (tx) => {
      const sourceAssignment = await tx.matchSlot.findFirst({
        where: { matchId: match.id, teamId, deletedAt: null },
        select: { slotNumber: true },
      });
      sourceSlotNumber =
        typeof sourceAssignment?.slotNumber === 'number'
          ? sourceAssignment.slotNumber
          : null;

      if (
        expectedSourceSlot !== null &&
        sourceSlotNumber !== expectedSourceSlot
      ) {
        throw new ConflictException(
          'Slot assignment changed. Reload slots and try again.',
        );
      }

      if (sourceSlotNumber === targetSlotNumber) {
        return;
      }

      const targetAssignment = await tx.matchSlot.findFirst({
        where: {
          matchId: match.id,
          slotNumber: targetSlotNumber,
          deletedAt: null,
        },
        select: { teamId: true },
      });
      displacedTeamId =
        targetAssignment?.teamId && targetAssignment.teamId !== teamId
          ? targetAssignment.teamId
          : null;

      await this.applySlotAssignmentInTransaction(
        tx,
        match,
        targetSlotNumber,
        teamId,
      );

      if (sourceSlotNumber !== null && displacedTeamId) {
        await this.applySlotAssignmentInTransaction(
          tx,
          match,
          sourceSlotNumber,
          displacedTeamId,
        );
      }
    });

    if (sourceSlotNumber === targetSlotNumber) {
      return this.listSlots(actor, match.id);
    }

    await this.logSlotAudit(
      AuditAction.SLOT_SET,
      match.id,
      match.organizationId ?? match.tournament?.organizationId ?? null,
      actor,
      {
        teamId,
        sourceSlotNumber,
        targetSlotNumber,
        displacedTeamId,
      },
    );
    await this.notifyLobbyContractChanged(match.id, {
      refreshLiveState: this.shouldRefreshLiveSlotContract(match),
    });

    return this.listSlots(actor, match.id);
  }

  async assignSlot(
    matchId: string,
    slotNumber: number,
    teamId: string,
    actor: Actor,
  ) {
    return this.setSlot(matchId, slotNumber, teamId, actor);
  }

  async addSlot(
    matchId: string,
    slotNumber: number,
    teamId: string,
    actor: Actor,
  ) {
    return this.setSlot(matchId, slotNumber, teamId, actor);
  }

  async clearSlot(matchId: string, slotNumber: number, actor: Actor) {
    return this.removeSlot(matchId, slotNumber, actor);
  }

  async syncSlotsFromPreviousMatch(
    matchId: string,
    actor: Actor,
    options?: SyncPreviousMatchSlotsDto,
  ) {
    const { match, capability } = await this.getSlotContext(actor, matchId);
    this.ensureSlotsEnabled(capability);
    this.ensureSlotsEditable(match);

    const slotSyncPlan = await this.resolvePreviousMatchSlotSyncPlan(match);
    const { previousMatch, previousSlots, currentAssignedCount, needsSync } =
      slotSyncPlan;
    const overwrite = options?.overwrite === true;
    const dryRun = options?.dryRun === true;

    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        previousMatchId: previousMatch.id,
        previousMatchNumber: previousMatch.matchNumber ?? null,
        syncedSlots: previousSlots.length,
        replaced: false,
        currentAssignedCount,
        needsSync,
        message: needsSync
          ? 'Previous populated match slots are available for recovery.'
          : 'Current match already matches the nearest populated previous match.',
      };
    }

    if (!needsSync) {
      return {
        ok: true,
        previousMatchId: previousMatch.id,
        previousMatchNumber: previousMatch.matchNumber ?? null,
        syncedSlots: previousSlots.length,
        replaced: false,
        currentAssignedCount,
        needsSync: false,
        message:
          'Current match already matches the nearest populated previous match.',
      };
    }

    if (currentAssignedCount > 0 && !overwrite) {
      throw new ConflictException(
        'This match already has slot assignments. Replace them with previous match slots?',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const existingResults = await tx.matchSlotResult.findMany({
        where: { matchId: match.id },
        select: { id: true },
      });
      const slotResultIds = existingResults.map((result) => result.id);

      if (slotResultIds.length > 0) {
        await tx.matchSlotPlayerResult.deleteMany({
          where: { slotResultId: { in: slotResultIds } },
        });
        await tx.matchSlotResult.deleteMany({
          where: { id: { in: slotResultIds } },
        });
      }

      await tx.matchSlot.deleteMany({
        where: { matchId: match.id },
      });

      await tx.matchSlot.createMany({
        data: previousSlots
          .filter(
            (
              slot,
            ): slot is {
              slotNumber: number;
              teamId: string;
            } => Boolean(slot.teamId),
          )
          .map((slot) => ({
            matchId: match.id,
            slotNumber: slot.slotNumber,
            teamId: slot.teamId,
            lobbyStatus:
              this.resolveAutoSource(match) === MatchDataSource.MANUAL
                ? LOBBY_STATUS.WAITING
                : LOBBY_STATUS.OFFLINE,
            playersInLobby: 0,
          })),
      });

      await this.results.ensureResultsFromSlots(match.id, { tx });
      await this.syncMatchTeamSlotMirrorFromSlotsInTransaction(tx, match.id);
      await this.updateManualClearedTeamIds(
        match.id,
        match.organizationId ?? match.tournament?.organizationId ?? null,
        () => new Set<string>(),
        tx,
      );
    });
    await this.notifyLobbyContractChanged(match.id, {
      refreshLiveState: this.shouldRefreshLiveSlotContract(match),
    });

    return {
      ok: true,
      previousMatchId: previousMatch.id,
      previousMatchNumber: previousMatch.matchNumber ?? null,
      syncedSlots: previousSlots.length,
      replaced: overwrite,
      currentAssignedCount,
      needsSync: false,
      message: 'Teams synced from the nearest populated previous match.',
    };
  }

  private async resolvePreviousMatchSlotSyncPlan(match: SlotMatch): Promise<{
    previousMatch: { id: string; matchNumber: number | null };
    previousSlots: Array<{ slotNumber: number; teamId: string }>;
    currentAssignedCount: number;
    needsSync: boolean;
  }> {
    const currentMatchNumber = Number(match.matchNumber ?? 0);
    if (!Number.isInteger(currentMatchNumber) || currentMatchNumber <= 1) {
      throw new BadRequestException(
        'Sync from previous match is not available for the first match',
      );
    }

    const previousMatchScope: Prisma.MatchWhereInput = match.sessionId
      ? {
          sessionId: match.sessionId,
          organizationId: match.organizationId,
        }
      : {
          tournamentId: match.tournamentId,
          ...(match.groupId
            ? { groupId: match.groupId }
            : match.stageId
              ? { stageId: match.stageId }
              : {}),
        };

    const previousCandidates = await this.prisma.match.findMany({
      where: {
        ...previousMatchScope,
        deletedAt: null,
        matchNumber: { lt: currentMatchNumber },
      },
      select: {
        id: true,
        matchNumber: true,
      },
      orderBy: { matchNumber: 'desc' },
    });

    let previousMatch: { id: string; matchNumber: number | null } | null = null;
    let previousSlots: Array<{ slotNumber: number; teamId: string }> = [];

    for (const candidate of previousCandidates) {
      const candidateSlots = await this.prisma.matchSlot.findMany({
        where: {
          matchId: candidate.id,
          deletedAt: null,
          teamId: { not: null },
        },
        select: {
          slotNumber: true,
          teamId: true,
        },
        orderBy: { slotNumber: 'asc' },
      });
      if (!candidateSlots.length) {
        continue;
      }
      previousMatch = candidate;
      previousSlots = candidateSlots.filter(
        (
          slot,
        ): slot is {
          slotNumber: number;
          teamId: string;
        } => Number.isInteger(slot.slotNumber) && Boolean(slot.teamId),
      );
      if (previousSlots.length > 0) {
        break;
      }
    }

    if (!previousMatch || !previousSlots.length) {
      throw new NotFoundException(
        'Previous populated match not found for slot sync',
      );
    }

    const currentSlots = await this.prisma.matchSlot.findMany({
      where: {
        matchId: match.id,
        deletedAt: null,
        teamId: { not: null },
      },
      select: {
        slotNumber: true,
        teamId: true,
      },
      orderBy: { slotNumber: 'asc' },
    });
    const normalizedCurrentSlots = currentSlots.filter(
      (
        slot,
      ): slot is {
        slotNumber: number;
        teamId: string;
      } => Number.isInteger(slot.slotNumber) && Boolean(slot.teamId),
    );

    return {
      previousMatch,
      previousSlots,
      currentAssignedCount: normalizedCurrentSlots.length,
      needsSync: this.slotAssignmentsDiffer(
        normalizedCurrentSlots,
        previousSlots,
      ),
    };
  }

  private slotAssignmentsDiffer(
    currentSlots: Array<{ slotNumber: number; teamId: string }>,
    previousSlots: Array<{ slotNumber: number; teamId: string }>,
  ): boolean {
    if (currentSlots.length !== previousSlots.length) {
      return true;
    }

    for (let index = 0; index < currentSlots.length; index += 1) {
      const current = currentSlots[index];
      const previous = previousSlots[index];
      if (
        current?.slotNumber !== previous?.slotNumber ||
        current?.teamId !== previous?.teamId
      ) {
        return true;
      }
    }

    return false;
  }

  async removeSlot(matchId: string, slotNumber: number, actor: Actor) {
    const { match, capability } = await this.getSlotContext(actor, matchId);
    this.ensureSlotsEnabled(capability);
    this.ensureSlotsEditable(match);
    const normalizedSlot = this.validateSlotNumber(slotNumber, capability);
    const existing = await this.prisma.matchSlot.findFirst({
      where: { matchId: match.id, slotNumber: normalizedSlot, deletedAt: null },
    });
    if (existing) {
      await this.prisma.$transaction(async (tx) => {
        const slotResult = await tx.matchSlotResult.findUnique({
          where: {
            matchId_slotNumber: {
              matchId: match.id,
              slotNumber: normalizedSlot,
            },
          },
          select: { id: true },
        });
        await tx.matchSlot.deleteMany({
          where: { matchId: match.id, slotNumber: normalizedSlot },
        });
        if (slotResult) {
          await tx.matchSlotPlayerResult.deleteMany({
            where: { slotResultId: slotResult.id },
          });
          await tx.matchSlotResult.update({
            where: { id: slotResult.id },
            data: {
              teamId: null,
              wasPresentInMatch: null,
              placement: null,
              eliminatedOrder: null,
              placementPoints: 0,
              totalKills: 0,
              manualTotalKills: false,
              finalPlacement: null,
              finalKills: null,
              finalizedAt: null,
              totalPoints: 0,
              points: 0,
              isAutoFilled: false,
              isLocked: false,
              eliminatedAt: null,
              placementAuto: true,
            },
          });
        }
        await this.clearMatchTeamSlotMirrorInTransaction(tx, match.id, {
          teamId: existing.teamId ?? null,
          slotNumber: normalizedSlot,
        });
        if (existing.teamId) {
          await this.updateManualClearedTeamIds(
            match.id,
            match.organizationId ?? match.tournament?.organizationId ?? null,
            (current) => {
              current.add(existing.teamId as string);
              return current;
            },
            tx,
          );
        }
      });
      await this.logSlotAudit(
        AuditAction.SLOT_CLEARED,
        match.id,
        match.organizationId ?? match.tournament?.organizationId ?? null,
        actor,
        { slotNumber: normalizedSlot, teamId: existing.teamId },
      );
      await this.notifyLobbyContractChanged(match.id, {
        refreshLiveState: this.shouldRefreshLiveSlotContract(match),
      });
    }
    return this.listSlots(actor, match.id);
  }

  private async applySlotAssignmentInTransaction(
    tx: Prisma.TransactionClient,
    match: SlotMatch,
    slotNumber: number,
    teamId: string,
  ) {
    const isAutoFilled =
      this.resolveTelemetryProvider(match as MatchTelemetryState) !==
      MatchDataSource.MANUAL;
    const initialLobbyStatus = isAutoFilled
      ? LOBBY_STATUS.OFFLINE
      : LOBBY_STATUS.WAITING;
    const priorResult = await tx.matchSlotResult.findUnique({
      where: {
        matchId_slotNumber: { matchId: match.id, slotNumber },
      },
      select: { id: true, teamId: true },
    });
    const displacedSlot = await tx.matchSlot.findFirst({
      where: {
        matchId: match.id,
        slotNumber,
        deletedAt: null,
      },
      select: { teamId: true },
    });

    await tx.matchSlot.deleteMany({
      where: { matchId: match.id, slotNumber },
    });
    await tx.matchSlot.deleteMany({
      where: { matchId: match.id, teamId },
    });
    await tx.matchSlot.create({
      data: {
        matchId: match.id,
        slotNumber,
        teamId,
        lobbyStatus: initialLobbyStatus,
        playersInLobby: 0,
      } as any,
    } as any);

    const slotResults = await this.results.ensureResultsFromSlots(match.id, {
      tx,
    });
    const slotResult =
      slotResults.find((sr) => sr.slotNumber === slotNumber) ?? null;
    const needsReset = !priorResult || priorResult.teamId !== teamId;

    if (slotResult) {
      if (needsReset && priorResult?.id) {
        await tx.matchSlotPlayerResult.deleteMany({
          where: { slotResultId: priorResult.id },
        });
      }
      await tx.matchSlotResult.update({
        where: { id: slotResult.id },
        data: {
          teamId,
          isAutoFilled: false,
          ...(needsReset
            ? {
                wasPresentInMatch: null,
                placement: null,
                eliminatedOrder: null,
                placementPoints: 0,
                totalKills: 0,
                manualTotalKills: false,
                finalPlacement: null,
                finalKills: null,
                finalizedAt: null,
                totalPoints: 0,
                points: 0,
                isLocked: false,
                eliminatedAt: null,
                placementAuto: true,
              }
            : {}),
        },
      });
    }

    if (
      needsReset &&
      displacedSlot?.teamId &&
      displacedSlot.teamId !== teamId
    ) {
      await tx.matchTeam.updateMany({
        where: { matchId: match.id, teamId: displacedSlot.teamId },
        data: { slot: null },
      });
      await this.updateManualClearedTeamIds(
        match.id,
        match.organizationId ?? match.tournament?.organizationId ?? null,
        (current) => {
          current.add(displacedSlot.teamId as string);
          return current;
        },
        tx,
      );
    }

    await this.setMatchTeamSlotMirrorInTransaction(
      tx,
      match.id,
      teamId,
      slotNumber,
    );
    await this.updateManualClearedTeamIds(
      match.id,
      match.organizationId ?? match.tournament?.organizationId ?? null,
      (current) => {
        current.delete(teamId);
        return current;
      },
      tx,
    );

    const teamPlayers = await tx.player.findMany({
      where: { teamId, deletedAt: null },
      select: { id: true, ign: true, realName: true, playerOpenId: true },
    });
    if (!isAutoFilled && teamPlayers.length && slotResult) {
      const teamPlayerNames = uniqueSlotPlayerNames(
        teamPlayers.map((player) => ({
          playerName: player.ign ?? player.realName ?? 'Unknown',
          stableId: player.id,
        })),
      );
      const toCreate = teamPlayers.map((player, index) => ({
        slotResultId: slotResult.id,
        playerId: player.id,
        pubgAccountId: player.playerOpenId ?? null,
        playerName: teamPlayerNames[index],
        kills: 0,
        knocks: 0,
        isAlive: true,
        alive: true,
        isKnocked: false,
        isAutoFilled,
        organizationId:
          match.organizationId ??
          match.tournament?.organizationId ??
          (() => {
            throw new BadRequestException('organizationId is required');
          })(),
      }));
      await tx.matchSlotPlayerResult.createMany({
        data: toCreate,
        skipDuplicates: true,
      });
    }
  }

  private async clearMatchTeamSlotMirrorInTransaction(
    tx: Prisma.TransactionClient,
    matchId: string,
    args: { teamId?: string | null; slotNumber?: number | null },
  ) {
    const OR: Prisma.MatchTeamWhereInput[] = [];
    if (args.teamId) {
      OR.push({ teamId: args.teamId });
    }
    if (typeof args.slotNumber === 'number') {
      OR.push({ slot: args.slotNumber });
    }
    if (!OR.length) return;
    await tx.matchTeam.updateMany({
      where: { matchId, OR },
      data: { slot: null },
    });
  }

  private async setMatchTeamSlotMirrorInTransaction(
    tx: Prisma.TransactionClient,
    matchId: string,
    teamId: string,
    slotNumber: number,
  ) {
    await this.clearMatchTeamSlotMirrorInTransaction(tx, matchId, {
      teamId,
      slotNumber,
    });
    await tx.matchTeam.upsert({
      where: {
        matchId_teamId: {
          matchId,
          teamId,
        },
      },
      update: {
        slot: slotNumber,
        status: MatchTeamStatus.ACTIVE,
        deletedAt: null,
      },
      create: {
        matchId,
        teamId,
        slot: slotNumber,
        status: MatchTeamStatus.ACTIVE,
      },
    });
  }

  private async syncMatchTeamSlotMirrorFromSlotsInTransaction(
    tx: Prisma.TransactionClient,
    matchId: string,
  ) {
    const slots = await tx.matchSlot.findMany({
      where: { matchId, deletedAt: null, teamId: { not: null } },
      select: { teamId: true, slotNumber: true },
      orderBy: { slotNumber: 'asc' },
    });

    await tx.matchTeam.updateMany({
      where: { matchId, slot: { not: null } },
      data: { slot: null },
    });

    for (const slot of slots) {
      if (!slot.teamId) continue;
      await tx.matchTeam.upsert({
        where: {
          matchId_teamId: {
            matchId,
            teamId: slot.teamId,
          },
        },
        update: {
          slot: slot.slotNumber,
          status: MatchTeamStatus.ACTIVE,
          deletedAt: null,
        },
        create: {
          matchId,
          teamId: slot.teamId,
          slot: slot.slotNumber,
          status: MatchTeamStatus.ACTIVE,
        },
      });
    }
  }

  private async findFirstAvailableSlot(matchId: string) {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { slotCount: true, game: { select: { key: true } } },
    });
    const maxSlots =
      match?.slotCount ??
      (match?.game?.key === GameKey.PUBG_MOBILE ? 25 : null) ??
      25;
    const slots = await this.prisma.matchSlot.findMany({
      where: { matchId },
      orderBy: { slotNumber: 'asc' },
    });
    const occupied = new Set(slots.map((s) => s.slotNumber));
    for (let i = 1; i <= maxSlots; i++) {
      if (!occupied.has(i)) return i;
    }
    return null;
  }

  private parseMap(input?: string | null) {
    if (!input) return null;
    const normalized = input.toUpperCase();
    const allowed = Object.values(MatchMap);
    if (!allowed.includes(normalized as MatchMap)) {
      throw new BadRequestException(`map must be one of ${allowed.join(', ')}`);
    }
    return normalized as MatchMap;
  }

  private parsePubgMap(input?: string | null) {
    const parsed = this.parseMap(input);
    if (!parsed) {
      throw new BadRequestException('map is required for PUBG_MOBILE matches');
    }
    if (!PUBGM_MAPS.includes(parsed)) {
      throw new BadRequestException(
        `map must be one of ${PUBGM_MAPS.join(', ')}`,
      );
    }
    return parsed;
  }

  private parseDataMode(input?: string | null) {
    if (!input) return DataMode.MANUAL;
    const normalized = input.toUpperCase();
    if (normalized !== DataMode.MANUAL) {
      throw new BadRequestException('dataMode must be MANUAL');
    }
    return DataMode.MANUAL;
  }

  private parseDataSource(input?: string | null) {
    if (input === undefined || input === null) return null;
    const normalized = input.toUpperCase();
    if (normalized === MatchDataSource.MANUAL) {
      return MatchDataSource.MANUAL;
    }
    if (normalized === MatchDataSource.API) {
      return MatchDataSource.API;
    }
    if (normalized === 'AUTO') {
      return MatchDataSource.API;
    }
    const allowed: MatchDataSource[] = [
      MatchDataSource.MANUAL,
      MatchDataSource.API,
    ];
    throw new BadRequestException(
      `dataSource must be one of ${allowed.join(', ')}`,
    );
  }

  private parsePubgDataSource(input?: string | null) {
    const parsed = this.parseDataSource(input) ?? MatchDataSource.MANUAL;
    if (!PUBGM_DATA_SOURCES.includes(parsed)) {
      throw new BadRequestException(
        `dataSource must be one of ${PUBGM_DATA_SOURCES.join(', ')}`,
      );
    }
    return parsed;
  }

  private parseMatchResultSource(
    input: string | null | undefined,
    telemetryProvider: TelemetryProvider,
  ): MatchResultSource {
    const inferred = TELEMETRY_RESULT_SOURCES.includes(
      telemetryProvider as MatchDataSource,
    )
      ? MatchResultSource.TELEMETRY
      : MatchResultSource.MANUAL;

    if (input === undefined || input === null || input === '') {
      return inferred;
    }

    const normalized = input.toString().trim().toUpperCase();
    const resultSource =
      normalized === 'API'
        ? MatchResultSource.TELEMETRY
        : normalized === 'TELEMETRY'
          ? MatchResultSource.TELEMETRY
          : normalized === MatchResultSource.OCR
            ? MatchResultSource.OCR
            : normalized === MatchResultSource.MANUAL
              ? MatchResultSource.MANUAL
              : null;

    if (!resultSource) {
      throw new BadRequestException(
        `resultSource must be one of ${Object.values(MatchResultSource).join(', ')}`,
      );
    }

    if (
      resultSource === MatchResultSource.OCR &&
      telemetryProvider !== MatchDataSource.MANUAL
    ) {
      throw new BadRequestException(
        'OCR result source requires a MANUAL dataSource',
      );
    }

    if (
      resultSource === MatchResultSource.TELEMETRY &&
      telemetryProvider === MatchDataSource.MANUAL
    ) {
      throw new BadRequestException(
        'TELEMETRY result source requires an API dataSource',
      );
    }

    if (
      resultSource === MatchResultSource.MANUAL &&
      telemetryProvider !== MatchDataSource.MANUAL
    ) {
      throw new BadRequestException(
        'MANUAL result source requires a MANUAL dataSource',
      );
    }

    return resultSource;
  }

  private resolveAutoSource(match: {
    dataSource?: MatchDataSource | string | null;
    pcobStatus?: PcobStatus | null;
    dataMode?: DataMode | string | null;
    pcobSessionId?: string | null;
    pcobMode?: boolean | null;
    adapterKey?: string | null;
  }): MatchDataSource {
    return resolveCanonicalTelemetryProvider({
      dataSource: match.dataSource ?? null,
      dataMode: match.dataMode ?? null,
      pcobSessionId: match.pcobSessionId ?? null,
      pcobMode: match.pcobMode ?? null,
      adapterKey: match.adapterKey ?? null,
    });
  }

  private normalizeSlotCount(
    gameKey: GameKey | null,
    input?: number | null,
  ): number {
    if (gameKey === GameKey.PUBG_MOBILE) return 25;
    const fallback = input ?? defaultSlotCountForGame(gameKey);
    const val = Number(fallback);
    if (!Number.isFinite(val)) {
      throw new BadRequestException('slotCount must be a number');
    }
    if (val < 2 || val > 100) {
      throw new BadRequestException('slotCount must be between 2 and 100');
    }
    return Math.trunc(val);
  }

  private normalizeGameKey(input?: string | null) {
    if (!input) return null;
    const normalized = input.trim().toUpperCase();
    const allowed = Object.values(GameKey);
    if (!allowed.includes(normalized as GameKey)) {
      throw new BadRequestException(
        `gameKey must be one of ${allowed.join(', ')}`,
      );
    }
    return normalized as GameKey;
  }

  private parsePcobStatus(input?: string | null) {
    if (!input) return PcobStatus.PENDING;
    const normalized = input.toUpperCase();
    const allowed = Object.values(PcobStatus);
    if (!allowed.includes(normalized as PcobStatus)) {
      throw new BadRequestException(
        `pcobStatus must be one of ${allowed.join(', ')}`,
      );
    }
    return normalized as PcobStatus;
  }

  private ensureManualAllowed(match: { dataMode?: DataMode } | any) {
    const dataMode = match?.dataMode as DataMode | undefined;
    if (dataMode === DataMode.PCOB) {
      throw new BadRequestException(
        'Manual updates are disabled while legacy PCOB dataMode is present',
      );
    }
  }

  private withMode<
    T extends MatchCore & {
      dataSource?: MatchDataSource | null;
      dataMode?: DataMode | null;
      pcobSessionId?: string | null;
      pcobMode?: boolean | null;
      pcobBoundAt?: Date | null;
      pcobLastSeenAt?: Date | null;
      adapterKey?: string | null;
    },
  >(match: T): T {
    const {
      pcobSessionId: _pcobSessionId,
      pcobMode: _pcobMode,
      pcobBoundAt: _pcobBoundAt,
      pcobLastSeenAt: _pcobLastSeenAt,
      adapterKey: _adapterKey,
      ...publicMatch
    } = (match as Record<string, unknown>) ?? {};
    void _pcobSessionId;
    void _pcobMode;
    void _pcobBoundAt;
    void _pcobLastSeenAt;
    void _adapterKey;
    const controlState = ((match as any)?.controlState?.state ?? null) as
      | string
      | null;
    const derivedLiveState = controlState
      ? deriveControlLiveState(controlState as any)
      : null;
    const liveState = derivedLiveState ?? (match as any)?.liveState ?? null;
    const status =
      controlState === 'LIVE' ||
      controlState === 'PAUSED' ||
      liveState === 'LIVE'
        ? MatchStatus.LIVE
        : controlState === 'ENDED' ||
            controlState === 'CONFIRMED' ||
            liveState === 'ENDED'
          ? MatchStatus.ENDED
          : ((match as any)?.status ?? null);
    const lifecycleStatus = deriveCanonicalMatchLifecycleStatus({
      status,
      liveState,
      controlState,
      metaJson: ((match as any)?.controlState?.metaJson ??
        null) as Prisma.JsonValue | null,
    });
    const telemetry = derivePcobBindingFlags(match, { lifecycleStatus });
    return {
      ...publicMatch,
      status,
      liveState,
      dataSource: exposeCanonicalTelemetryProvider(match),
      telemetryProvider: exposeTelemetryProvider(telemetry.telemetryProvider),
      sourceMode: exposeSourceMode(telemetry.telemetryProvider),
    } as unknown as T;
  }

  async update(
    matchId: string,
    body: MatchCreatePayload,
    actor: Actor,
  ): Promise<MatchCore> {
    const match = await this.getMatch(matchId, actor, false);

    let targetGroupContext: {
      groupId: string;
      stageId: string;
      tournamentId: string;
      organizationId: string;
    } | null = null;

    const data: Prisma.MatchUncheckedUpdateInput & Record<string, unknown> = {};
    if (body?.name !== undefined) data.name = body.name ?? null;
    if (body?.map !== undefined) data.map = this.parseMap(body.map);
    if (body?.recallEnabled !== undefined)
      data.recallEnabled = !!body.recallEnabled;
    if (body?.matchNumber !== undefined)
      data.matchNumber = body.matchNumber ?? null;
    if (body?.groupId !== undefined) {
      if (!body.groupId) {
        throw new BadRequestException('Match must belong to a group');
      }
      const ctx = await this.resolveGroupContext(
        actor,
        body.groupId,
        (match as any)?.tournamentId ?? null,
      );
      if (ctx.tournamentId !== (match as any)?.tournamentId) {
        throw new BadRequestException(
          'Cannot move a match to a different tournament',
        );
      }
      targetGroupContext = {
        groupId: ctx.groupId,
        stageId: ctx.stageId,
        tournamentId: ctx.tournamentId,
        organizationId: ctx.organizationId,
      };
      data.groupId = ctx.groupId;
      data.stageId = ctx.stageId;
      data.tournamentId = ctx.tournamentId;
      data.organizationId = ctx.organizationId;
    }
    if (body?.scheduledAt !== undefined)
      data.scheduledAt = this.parseScheduledDateInput(body.scheduledAt);
    if (body?.startAt !== undefined)
      data.startedAt = this.parseDateInput(body.startAt);
    if (body?.endsAt !== undefined)
      data.endedAt = this.parseDateInput(body.endsAt);
    const tournamentGameKey = targetGroupContext?.tournamentId
      ? await this.getTournamentGameKey(targetGroupContext.tournamentId)
      : (((match as any)?.tournament?.game as GameKey | null | undefined) ??
        null);
    const requestedGameKey = this.normalizeGameKey(body?.gameKey);
    const resolvedGame = await this.resolveGameIdentity({
      preferredGameId:
        body?.gameId !== undefined
          ? (body.gameId ?? null)
          : (((match as any)?.gameId as string | null | undefined) ?? null),
      gameKey: requestedGameKey,
      fallbackGameKey: tournamentGameKey,
    });
    const effectiveGameKey = resolvedGame.key;
    if (
      body?.gameId !== undefined ||
      body?.gameKey !== undefined ||
      targetGroupContext
    ) {
      await assertOrganizationGameAccess(
        this.prisma,
        targetGroupContext?.organizationId ??
          ((match as any)?.organizationId as string),
        effectiveGameKey,
      );
    }
    if (body?.slotCount !== undefined) {
      const nextSlotCount = this.normalizeSlotCount(
        effectiveGameKey,
        body.slotCount,
      );
      const maxExistingSlot = await this.prisma.matchSlot.aggregate({
        where: { matchId },
        _max: { slotNumber: true },
      });
      const currentMax = maxExistingSlot?._max?.slotNumber ?? 0;
      if (currentMax > nextSlotCount) {
        throw new BadRequestException(
          `slotCount (${nextSlotCount}) cannot be lower than existing slot number (${currentMax})`,
        );
      }
      data.slotCount = nextSlotCount;
    }
    if (body?.gameId !== undefined || body?.gameKey !== undefined) {
      data.gameId = resolvedGame.id;
    }
    const currentTelemetryProvider = this.resolveTelemetryProvider(
      match as MatchTelemetryState,
    );
    const requestedTelemetryProvider =
      resolveTelemetryProviderInput({
        dataSource:
          body?.dataSource !== undefined
            ? effectiveGameKey === GameKey.PUBG_MOBILE
              ? this.parsePubgDataSource(body.dataSource)
              : this.parseDataSource(body.dataSource)
            : undefined,
        dataMode:
          body?.dataMode !== undefined
            ? this.parseDataMode(body.dataMode)
            : undefined,
        currentProvider: currentTelemetryProvider,
      }) ?? currentTelemetryProvider;
    if (
      body?.resultSource !== undefined ||
      body?.dataSource !== undefined ||
      body?.dataMode !== undefined
    ) {
      data.resultSource = this.parseMatchResultSource(
        body?.resultSource,
        requestedTelemetryProvider,
      );
    }
    Object.assign(
      data,
      this.resolveTelemetryWriteData({
        current: {
          dataMode:
            ((match as any)?.dataMode as DataMode | null | undefined) ?? null,
          dataSource:
            ((match as any)?.dataSource as
              | MatchDataSource
              | null
              | undefined) ?? null,
          pcobSessionId:
            ((match as any)?.pcobSessionId as string | null | undefined) ??
            null,
          pcobMode:
            ((match as any)?.pcobMode as boolean | null | undefined) ?? null,
          pcobBoundAt:
            ((match as any)?.pcobBoundAt as Date | null | undefined) ?? null,
          pcobLastSeenAt:
            ((match as any)?.pcobLastSeenAt as Date | null | undefined) ?? null,
          adapterKey:
            ((match as any)?.adapterKey as string | null | undefined) ?? null,
          pcobKillSyncEnabled:
            ((match as any)?.pcobKillSyncEnabled as
              | boolean
              | null
              | undefined) ?? null,
        },
        requestedProvider: requestedTelemetryProvider,
        requestedAdapterKey:
          body?.adapterKey !== undefined
            ? this.normalizeAdapterKey(body.adapterKey)
            : undefined,
        requestedPcobSessionId:
          body?.pcobSessionId !== undefined
            ? (body.pcobSessionId ?? null)
            : undefined,
        effectiveGameKey,
      }),
    );
    if (body?.pcobStatus !== undefined) {
      throw new BadRequestException(
        'pcobStatus is no longer a supported live source field',
      );
    }

    let statusChanged = false;
    let requestedStatus: MatchStatus | null = null;
    if (body?.status !== undefined) {
      statusChanged = true;
      const next = body.status as MatchStatus;
      requestedStatus = next;
      const current = (match as any).status as MatchStatus;
      if (next !== current) {
        const allowed =
          (current === MatchStatus.DRAFT && next === MatchStatus.LIVE) ||
          (current === MatchStatus.LIVE && next === MatchStatus.ENDED) ||
          (current === MatchStatus.LIVE &&
            next === MatchStatus.FINISH_PENDING) ||
          (current === MatchStatus.FINISH_PENDING &&
            next === MatchStatus.ENDED) ||
          (current === MatchStatus.ENDED && next === MatchStatus.DRAFT);
        if (!allowed) {
          throw new BadRequestException(
            `Invalid status transition from ${match.status} to ${next}`,
          );
        }
      }
    }

    if (Object.keys(data).length > 0) {
      if (Object.keys(data).length > 0) {
        await this.prisma.match.update({
          where: { id: matchId },
          data: this.pruneUnsupportedMatchFields(data),
          select: { id: true },
        });
      }
      if (data.liveState) {
        const refreshed = (await this.getMatch(matchId, actor, false)) as any;
        await this.syncLiveHierarchy({
          matchId,
          groupId: refreshed.groupId ?? null,
          stageId: refreshed.stageId ?? null,
          tournamentId: refreshed.tournamentId,
        });
      }
    }

    if (requestedStatus) {
      await this.setStatus(matchId, requestedStatus, actor);
    }

    const updated = await this.getMatch(matchId, actor, false);
    if (statusChanged) {
      void this.broadcast.emitForMatch(matchId, 'match-status');
    }
    return this.withMode(updated as any);
  }

  async softDelete(actor: Actor, matchId: string) {
    const match = await this.getMatch(matchId, actor, false);
    const controlState = ((match as any)?.controlState?.state ?? null) as
      | string
      | null;
    const derivedLiveState = controlState
      ? deriveControlLiveState(controlState as any)
      : null;
    const liveState = derivedLiveState ?? (match as any)?.liveState ?? null;
    const isLiveMatch =
      (match.status as MatchStatus | null) === MatchStatus.LIVE ||
      liveState === LiveState.LIVE ||
      controlState === 'LIVE' ||
      controlState === 'PAUSED';

    if (isLiveMatch) {
      throw new BadRequestException('Cannot delete match while LIVE');
    }

    const deletedAt = new Date();
    await this.prisma.match.update({
      where: { id: matchId },
      data: { deletedAt },
      select: { id: true },
    });
    await this.prisma.matchSlot.deleteMany({ where: { matchId } });
    await this.prisma.matchTeam.deleteMany({ where: { matchId } });
    await this.syncLiveHierarchy({
      matchId,
      groupId: (match as any).groupId ?? null,
      stageId: (match as any).stageId ?? null,
      tournamentId: (match as any).tournamentId,
    });
    return { ok: true };
  }

  async setStatus(matchId: string, target: MatchStatus, actor: Actor) {
    const match = (await this.getMatch(matchId, actor)) as any;
    if (match?.tournament?.status === TournamentStatus.ARCHIVED) {
      throw new BadRequestException('Tournament is not active');
    }
    if (
      match?.tournament?.status &&
      match.tournament.status !== TournamentStatus.ACTIVE
    ) {
      throw new BadRequestException('Tournament is not active');
    }

    const current = match.status as MatchStatus;
    if (current === target) return this.withMode(match);

    if (target === MatchStatus.LIVE) {
      await this.validatePubgSlots(matchId);
      await this.matchControl.startMatch(actor, matchId, null, {
        source: 'matches-service-set-status',
        requestedMatchId: matchId,
      });
      await this.generateMatchResults(matchId);
      const refreshed = await this.getMatch(matchId, actor);
      void this.resultsEvents.emitResultsLockState(matchId);
      void this.broadcast.emitForMatch(matchId, 'match-status');
      return this.withMode(refreshed);
    }
    if (target === MatchStatus.DRAFT) {
      await this.prisma.matchSlotResult.updateMany({
        where: { matchId },
        data: {
          wasPresentInMatch: null,
          placement: null,
          eliminatedAt: null,
          placementAuto: true,
        } as any,
      });
      await this.matchControl.setStatus(actor, matchId, {
        status: 'READY',
      });
      const refreshed = await this.getMatch(matchId, actor);
      return this.withMode(refreshed);
    }
    if (target === MatchStatus.FINISH_PENDING) {
      await this.matchControl.setStatus(actor, matchId, {
        status: 'FINISH_PENDING',
        reason: 'matches-service-set-status',
      });
      const refreshed = await this.getMatch(matchId, actor);
      return this.withMode(refreshed);
    }
    if (target === MatchStatus.ENDED) {
      await this.matchControl.endMatch(actor, matchId, 'matches-service-end');
      const refreshed = await this.getMatch(matchId, actor);
      return this.withMode(refreshed);
    }
    if (target === MatchStatus.FINISHED) {
      await this.matchControl.setStatus(actor, matchId, {
        status: 'FINISHED',
        reason: 'matches-service-confirm',
      });
      const refreshed = await this.getMatch(matchId, actor);
      return this.withMode(refreshed);
    }

    throw new BadRequestException(
      `Invalid status transition from ${current} to ${target}`,
    );
  }

  private async requireManualLiveMatch(actor: Actor, matchId: string) {
    const match = (await this.prisma.match.findFirst({
      where: {
        id: matchId,
        deletedAt: null,
      },
      select: {
        ...this.matchSelect,
        organizationId: true,
        tournament: { select: { ownerUserId: true, organizationId: true } },
      },
    } as any)) as any;
    if (!match) throw new NotFoundException('Match not found');
    if (
      !this.canEdit(
        actor,
        match.tournament?.ownerUserId,
        match.tournament?.organizationId ?? null,
      )
    ) {
      throw new ForbiddenException('Not allowed to score this match');
    }
    if (match.status !== MatchStatus.LIVE) {
      throw new BadRequestException({ error: 'Match is not live' });
    }
    const source = this.resolveTelemetryProvider(match as MatchTelemetryState);
    if (source !== MatchDataSource.MANUAL) {
      throw new ConflictException({
        error: 'TELEMETRY_PROVIDER_ACTIVE',
        message:
          'Manual scoring is disabled while telemetry provider authority is active.',
      });
    }
    return { match };
  }

  private async ensureTeamAssigned(matchId: string, teamId: string) {
    const slot = await this.prisma.matchSlot.findFirst({
      where: { matchId, teamId },
      select: { id: true },
    });
    if (!slot)
      throw new BadRequestException('Team is not assigned to this match');
  }

  async autoEndIfLastTeamAlive(matchId: string) {
    const matchStatus = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { status: true },
    });
    if (!matchStatus || matchStatus.status !== MatchStatus.LIVE) return;

    const snapshot = await this.canonicalRead.getStateSnapshot(matchId, {
      preferCached: false,
    });
    const aliveTeams =
      snapshot.teams?.filter((team) => {
        const alive =
          team.alivePlayers ??
          (Array.isArray(team.players)
            ? team.players.filter((player) => player?.alive === true).length
            : 0);
        return alive > 0;
      }) ?? [];
    if (aliveTeams.length === 1) {
      const lastAlive = aliveTeams[0];
      await this.finalizePlacementsOnEnd(matchId, lastAlive.teamId ?? null);
      const systemActor: Actor = {
        id: 'system',
        actorId: 'system',
        role: Role.SUPER_ADMIN,
        actorRole: Role.SUPER_ADMIN,
        organizationId: null,
        actingOrgId: null,
      };
      await this.setStatus(matchId, MatchStatus.ENDED, systemActor);
    }
  }

  private async finalizePlacementsOnEnd(
    matchId: string,
    lastAliveTeamId: string | null,
  ) {
    const slotResults = (await this.prisma.matchSlotResult.findMany({
      where: { matchId, teamId: { not: null } },
      orderBy: [{ slotNumber: 'asc' }],
    })) as Array<{
      id: string;
      teamId: string | null;
      slotNumber: number | null;
      wasPresentInMatch?: boolean | null;
      placement: number | null;
      eliminatedAt?: Date | null;
      placementAuto?: boolean | null;
    }>;
    const activeSlotResults = slotResults.filter((slotResult) =>
      isPresentInMatch(slotResult.wasPresentInMatch),
    );
    const totalTeams = activeSlotResults.length;
    if (totalTeams === 0) return;

    // Determine alive teams from player state
    const aliveCounts = await this.prisma.matchSlotPlayerResult.groupBy({
      by: ['slotResultId'],
      where: {
        slotResult: { matchId, wasPresentInMatch: true },
        OR: [{ isAlive: true }, { alive: true }],
      },
      _count: { slotResultId: true },
    });
    const aliveBySlot = new Map<string, number>();
    for (const row of aliveCounts) {
      aliveBySlot.set(row.slotResultId, row._count.slotResultId);
    }

    const aliveTeams = activeSlotResults.filter(
      (sr) => (aliveBySlot.get(sr.id) ?? 0) > 0,
    );
    const winnerTeamId =
      aliveTeams.length === 1
        ? (aliveTeams[0].teamId ?? null)
        : aliveTeams.length === 0
          ? lastAliveTeamId
          : null;
    if (aliveTeams.length > 1) {
      throw new ConflictException(
        'Cannot end the match while multiple teams are still alive.',
      );
    }
    if (!winnerTeamId) {
      throw new ConflictException(
        'Cannot finalize placements without a determined winner.',
      );
    }

    // Fallback elimination ordering
    const eliminationEvents = await this.prisma.matchEvent.findMany({
      where: { matchId, type: MatchEventType.TEAM_PLACEMENT },
      select: { teamId: true, timestamp: true, seq: true, payload: true },
      orderBy: [{ timestamp: 'asc' }, { seq: 'asc' }],
    });
    const eliminationTime = new Map<string, number>();
    for (const ev of eliminationEvents) {
      const teamId = ev.teamId ?? null;
      if (!teamId || eliminationTime.has(teamId)) continue;
      const payloadTime =
        (ev.payload as { eliminationAt?: string })?.eliminationAt ?? null;
      const ts = payloadTime
        ? new Date(payloadTime).getTime()
        : ev.timestamp.getTime();
      eliminationTime.set(teamId, ts);
    }

    const preservedPlacements = new Map<number, string>();
    for (const slotResult of activeSlotResults) {
      if (slotResult.placementAuto === true || slotResult.placement === null) {
        continue;
      }
      if (slotResult.placement < 1 || slotResult.placement > totalTeams) {
        throw new ConflictException(
          `Manual placement ${slotResult.placement} is out of range for slot ${slotResult.slotNumber}.`,
        );
      }
      const priorSlotId = preservedPlacements.get(slotResult.placement);
      if (priorSlotId && priorSlotId !== slotResult.id) {
        throw new ConflictException(
          `Duplicate manual placement ${slotResult.placement} prevents match finalization.`,
        );
      }
      preservedPlacements.set(slotResult.placement, slotResult.id);
    }

    const availablePlacements = Array.from(
      { length: totalTeams },
      (_, index) => index + 1,
    ).filter((placement) => !preservedPlacements.has(placement));
    const nextPlacements = new Map<string, number | null>();
    for (const slotResult of activeSlotResults) {
      if (slotResult.placementAuto === true) {
        nextPlacements.set(slotResult.id, null);
      }
    }

    const winner = activeSlotResults.find((sr) => sr.teamId === winnerTeamId);
    if (!winner) {
      throw new ConflictException(
        'Winning team is not present in the active slot results.',
      );
    }
    if (winner?.placementAuto === true) {
      if (!availablePlacements.includes(1)) {
        throw new ConflictException(
          'Placement 1 is already reserved by another result.',
        );
      }
      nextPlacements.set(winner.id, 1);
      availablePlacements.splice(availablePlacements.indexOf(1), 1);
    }

    // Losers ordered by eliminationAt asc, nulls last; tie-breaker slotNumber asc
    const losers = activeSlotResults.filter(
      (sr) => sr.teamId !== winnerTeamId && (aliveBySlot.get(sr.id) ?? 0) === 0,
    );
    const losersSorted = losers.sort((a, b) => {
      const ta =
        (a.eliminatedAt ? a.eliminatedAt.getTime() : undefined) ??
        eliminationTime.get(a.teamId ?? '') ??
        Number.POSITIVE_INFINITY;
      const tb =
        (b.eliminatedAt ? b.eliminatedAt.getTime() : undefined) ??
        eliminationTime.get(b.teamId ?? '') ??
        Number.POSITIVE_INFINITY;
      if (ta === tb) return (a.slotNumber ?? 0) - (b.slotNumber ?? 0);
      return ta - tb;
    });

    const loserPlacements = availablePlacements
      .filter((placement) => placement > 1)
      .sort((left, right) => right - left);
    let loserPlacementIndex = 0;
    for (const sr of losersSorted) {
      if (sr.placementAuto !== true) continue;
      nextPlacements.set(sr.id, loserPlacements[loserPlacementIndex] ?? null);
      loserPlacementIndex += 1;
    }

    const updates = Array.from(nextPlacements.entries())
      .filter(([id, placement]) => {
        const current = activeSlotResults.find(
          (slotResult) => slotResult.id === id,
        );
        return current && current.placement !== placement;
      })
      .map(([id, placement]) => ({ id, placement }));
    if (updates.length === 0) return;

    await this.prisma.$transaction(
      updates.map((u) =>
        this.prisma.matchSlotResult.update({
          where: { id: u.id },
          data: { placement: u.placement },
        }),
      ),
    );
  }

  private async nextSeq(matchId: string) {
    const last = await this.prisma.matchEvent.findFirst({
      where: { matchId },
      select: { seq: true },
      orderBy: { seq: 'desc' },
    });
    return (last?.seq ?? 0) + 1;
  }

  async manualKill(actor: Actor, matchId: string, body: ManualKillPayload) {
    const match: any = await this.requireManualLiveMatch(actor, matchId);
    const organizationId =
      match.organizationId ??
      match.tournament?.organizationId ??
      (() => {
        throw new BadRequestException('organizationId is required');
      })();
    const teamId = body?.teamId;
    if (!teamId) throw new BadRequestException('teamId is required');
    await this.ensureTeamAssigned(matchId, teamId);
    await this.results.assertSlotPresentForMutation(
      { matchId, teamId },
      { allowManualPromote: true },
    );

    const deltaRaw = Number(body?.count ?? 1);
    const delta = Number.isFinite(deltaRaw) ? Math.trunc(deltaRaw) : 0;

    const currentKills = await this.prisma.matchEvent.count({
      where: { matchId, teamId, type: MatchEventType.KILL },
    });
    const nextKills = Math.max(0, currentKills + delta);

    await this.prisma.matchEvent.deleteMany({
      where: { matchId, teamId, type: MatchEventType.KILL },
    });

    if (nextKills > 0) {
      let seq = await this.nextSeq(matchId);
      const now = Date.now();
      const data = Array.from({ length: nextKills }).map((_, idx) => ({
        eventId: `manual-kill-${now}-${teamId}-${idx}`,
        matchId,
        teamId,
        type: MatchEventType.KILL,
        seq: seq++,
        timestamp: new Date(),
        payload: {},
        rawPayload: {},
        organizationId,
      }));
      await this.prisma.matchEvent.createMany({ data, skipDuplicates: true });
    }

    await this.scoring.recomputeMatchAndTournament(matchId);
    await this.autoEndIfLastTeamAlive(matchId);
    this.pcobGateway.emitKill(matchId, {
      source: 'MANUAL',
      teamId,
      delta,
      playerId: body?.playerId ?? null,
    });
    this.resultsEvents.emitResultsUpdated?.(matchId, 0, {
      source: 'MANUAL',
      mode: 'MANUAL_SCORING',
      type: 'KILL',
      teamId,
      delta,
      playerId: body?.playerId ?? null,
    });
    this.resultsEvents.emitLeaderboardUpdated?.(matchId, {
      source: 'MANUAL',
      mode: 'MANUAL_SCORING',
      type: 'KILL',
      teamId,
    });
    void this.broadcastScoreboardSafe(matchId);
    return { ok: true, kills: nextKills };
  }

  async manualPlacement(
    actor: Actor,
    matchId: string,
    body: ManualPlacementPayload,
  ) {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        id: true,
        liveState: true,
        organizationId: true,
        tournament: {
          select: { ownerUserId: true, organizationId: true },
        },
      },
    });
    if (!match) throw new NotFoundException('Match not found');
    if (
      !this.canEdit(
        actor,
        match.tournament?.ownerUserId ?? null,
        match.tournament?.organizationId ?? null,
      )
    ) {
      throw new ForbiddenException(
        'Not allowed to edit placements for this match',
      );
    }
    if ((match.liveState ?? '').toString().toUpperCase() === 'LIVE') {
      throw new BadRequestException(
        'Cannot edit placement while match is LIVE',
      );
    }
    const organizationId =
      match.organizationId ??
      match.tournament?.organizationId ??
      (() => {
        throw new BadRequestException('organizationId is required');
      })();
    const teamId = body?.teamId;
    if (!teamId) throw new BadRequestException('teamId is required');
    await this.ensureTeamAssigned(matchId, teamId);
    await this.results.assertSlotPresentForMutation(
      { matchId, teamId },
      { allowManualPromote: true },
    );

    const placementRaw = Number(body?.placement);
    if (!Number.isFinite(placementRaw) || placementRaw <= 0) {
      throw new BadRequestException('placement must be a positive number');
    }
    const placement = Math.trunc(placementRaw);

    await this.prisma.matchEvent.deleteMany({
      where: { matchId, teamId, type: MatchEventType.TEAM_PLACEMENT },
    });

    const seq = await this.nextSeq(matchId);
    await this.prisma.matchEvent.create({
      data: {
        eventId: `manual-placement-${Date.now()}-${teamId}`,
        matchId,
        teamId,
        type: MatchEventType.TEAM_PLACEMENT,
        seq,
        timestamp: new Date(),
        payload: { placement },
        rawPayload: {},
        organizationId,
      },
    });

    await this.prisma.matchSlotResult.updateMany({
      where: { matchId, teamId },
      data: { placement, placementAuto: false } as any,
    });

    await this.scoring.recomputeMatchAndTournament(matchId);
    this.pcobGateway.emitPlacement(matchId, { teamId, placement });
    this.resultsEvents.emitResultsUpdated?.(matchId, 0, {
      source: 'MANUAL',
      mode: 'MANUAL_SCORING',
      type: 'PLACEMENT',
      teamId,
      placement,
    });
    this.resultsEvents.emitLeaderboardUpdated?.(matchId, {
      source: 'MANUAL',
      mode: 'MANUAL_SCORING',
      type: 'PLACEMENT',
      teamId,
    });
    void this.broadcastScoreboardSafe(matchId);
    return { ok: true, placement };
  }

  async linkPcobSession(actor: Actor, matchId: string, sessionId: string) {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new BadRequestException('pcobSessionId is required');
    }
    const match = await this.getMatch(matchId, actor);
    if (
      actor.organizationId &&
      match.organizationId &&
      actor.organizationId !== match.organizationId
    ) {
      throw new ForbiddenException('Not allowed for this organization');
    }
    if (
      match.status !== MatchStatus.DRAFT &&
      match.status !== MatchStatus.LIVE
    ) {
      throw new BadRequestException(
        'Link allowed only when match is DRAFT or LIVE',
      );
    }
    throw new BadRequestException(
      'Legacy PCOB session linking is disabled; use API or MANUAL',
    );
  }

  async unlinkPcobSession(actor: Actor, matchId: string) {
    const match = await this.getMatch(matchId, actor);
    if (
      actor.organizationId &&
      match.organizationId &&
      actor.organizationId !== match.organizationId
    ) {
      throw new ForbiddenException('Not allowed for this organization');
    }
    throw new BadRequestException(
      'Legacy PCOB session linking is disabled; use API or MANUAL',
    );
  }

  setPcobKillSync(actor: Actor, matchId: string, enabled: boolean) {
    void actor;
    void matchId;
    void enabled;
    throw new BadRequestException(
      'Legacy PCOB kill sync is disabled; use API or MANUAL',
    );
  }

  async setDataSource(
    actor: Actor,
    matchId: string,
    dataSource: MatchDataSource,
  ) {
    const requestedDataSource = this.parseDataSource(dataSource as string);
    if (!requestedDataSource)
      throw new BadRequestException('Invalid dataSource');
    const match = await this.prisma.match.findFirst({
      where: {
        id: matchId,
        deletedAt: null,
      },
      select: {
        status: true,
        dataSource: true,
        dataMode: true,
        pcobSessionId: true,
        pcobMode: true,
        pcobBoundAt: true,
        pcobLastSeenAt: true,
        adapterKey: true,
        game: { select: { key: true } },
        tournament: {
          select: { ownerUserId: true, organizationId: true, game: true },
        },
      },
    });
    if (!match) throw new NotFoundException('Match not found');
    if (!match.tournament) {
      throw new BadRequestException(
        'Session matches are not supported by data source updates',
      );
    }
    if (
      !this.canEdit(
        actor,
        match.tournament.ownerUserId,
        match.tournament?.organizationId ?? null,
      )
    ) {
      throw new ForbiddenException('Not allowed to update data source');
    }
    const effectiveGameKey = match.game?.key ?? match.tournament.game ?? null;
    if (!effectiveGameKey) {
      throw new BadRequestException('gameKey is required');
    }
    const currentProvider = this.resolveTelemetryProvider(
      match as MatchTelemetryState,
    );
    const requestedProvider =
      resolveTelemetryProviderInput({
        dataSource: requestedDataSource,
        currentProvider,
      }) ?? currentProvider;
    const updated = await this.prisma.match.update({
      where: { id: matchId },
      data: {
        ...this.resolveTelemetryWriteData({
          current: match as MatchTelemetryState,
          requestedProvider,
          effectiveGameKey,
        }),
        resultSource: this.parseMatchResultSource(undefined, requestedProvider),
      },
      select: this.matchSelect,
    });
    void this.resultsEvents.emitResultsLockState(matchId, {
      status: match.status,
      dataSource: requestedProvider,
      liveState: (updated as any)?.liveState ?? null,
    });
    return this.withMode(updated as any);
  }

  async resetTelemetrySource(
    actor: Actor,
    matchId: string,
    options: { force?: boolean } = {},
  ) {
    const force = options.force === true;
    const match = await this.prisma.match.findFirst({
      where: {
        id: matchId,
        deletedAt: null,
      },
      select: {
        id: true,
        status: true,
        liveState: true,
        organizationId: true,
        telemetrySource: true,
        telemetrySourceLockedAt: true,
        controlState: {
          select: {
            state: true,
            metaJson: true,
            organizationId: true,
          },
        },
        tournament: {
          select: { ownerUserId: true, organizationId: true },
        },
      },
    });
    if (!match) {
      throw new NotFoundException('Match not found');
    }
    if (
      !this.canEdit(
        actor,
        match.tournament?.ownerUserId ?? null,
        match.tournament?.organizationId ?? null,
      )
    ) {
      throw new ForbiddenException('Not allowed to reset telemetry source');
    }

    const actorRole = actor.actorRole ?? actor.role ?? null;
    if (force && actorRole !== Role.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Force telemetry source reset requires SUPER_ADMIN',
      );
    }

    const isLiveOrLocked =
      match.status !== MatchStatus.DRAFT ||
      match.liveState === LiveState.LIVE ||
      match.controlState?.state === MatchStatus.LIVE;
    if (isLiveOrLocked && !force) {
      throw new BadRequestException(
        'Telemetry source can only be reset before LIVE',
      );
    }

    const currentMeta = this.toJsonRecord(match.controlState?.metaJson) ?? {};
    const nextMeta: Record<string, unknown> = {
      ...currentMeta,
      telemetrySource: TelemetrySource.AUTO,
    };
    delete nextMeta.telemetryIngress;
    delete nextMeta.telemetryRuntime;

    const organizationId =
      match.controlState?.organizationId ??
      match.organizationId ??
      match.tournament?.organizationId ??
      null;

    const updated = await this.prisma.$transaction(async (tx) => {
      const nextMatch = await tx.match.update({
        where: { id: matchId },
        data: {
          telemetrySource: TelemetrySource.AUTO,
          telemetrySourceLockedAt: null,
        },
        select: {
          id: true,
          telemetrySource: true,
          telemetrySourceLockedAt: true,
        },
      });

      if (organizationId) {
        await tx.matchControlState.upsert({
          where: { matchId },
          update: {
            metaJson: nextMeta as Prisma.InputJsonObject,
          },
          create: {
            matchId,
            organizationId,
            state: (match.controlState?.state ??
              deriveControlStateFromMatchStatus(match.status)) as never,
            reason: 'TELEMETRY_SOURCE_RESET',
            metaJson: nextMeta as Prisma.InputJsonObject,
          },
        });
      }

      return nextMatch;
    });

    await this.auditService.log({
      organizationId,
      userId: actor.actorId ?? actor.id ?? 'system',
      action: AuditAction.MATCH_CONTROL_STATE_CHANGED,
      entityType: 'MATCH',
      entityId: matchId,
      before: {
        telemetrySource: match.telemetrySource ?? TelemetrySource.AUTO,
        telemetrySourceLockedAt: match.telemetrySourceLockedAt ?? null,
      },
      after: {
        telemetrySource: updated.telemetrySource,
        telemetrySourceLockedAt: updated.telemetrySourceLockedAt ?? null,
        force,
      },
      source: 'SYSTEM',
      reason: force
        ? 'Telemetry source reset (forced)'
        : 'Telemetry source reset',
    });

    return {
      ok: true,
      matchId,
      telemetrySource: updated.telemetrySource,
      telemetrySourceLockedAt: updated.telemetrySourceLockedAt,
      force,
    };
  }

  async getMatchContext(actor: Actor, matchId: string) {
    const match = (await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        ...(this.matchContextSelect as any),
        tournament: { select: { ownerUserId: true, organizationId: true } },
      },
    })) as any;
    if (!match) throw new NotFoundException('Match not found');
    if (
      !this.canEdit(
        actor,
        match.tournament?.ownerUserId,
        match.tournament?.organizationId ?? null,
      )
    ) {
      throw new ForbiddenException('Not allowed to access match');
    }
    const teams = new Map<
      string,
      {
        id: string;
        name: string | null;
        tag: string | null;
        logoUrl: string | null;
        players?: {
          id: string;
          ign: string;
          realName: string | null;
          name?: string | null;
        }[];
      }
    >();
    (match.matchTeams ?? []).forEach((mt) => {
      if (mt.team) teams.set(mt.team.id, mt.team);
    });
    (match.matchSlots ?? []).forEach((slot) => {
      if (slot.team) teams.set(slot.team.id, slot.team);
    });
    const gameKey =
      (match.game as { key?: GameKey } | null)?.key ??
      (match.tournament as { game?: GameKey } | null)?.game ??
      null;
    const capability = this.resolveSlotCapability(
      (match as { adapterKey?: string | null })?.adapterKey ?? null,
      gameKey,
      (match as { slotCount?: number | null })?.slotCount ?? null,
    );
    const teamList = Array.from(teams.values()).map((t) => ({
      id: t.id,
      name: t.name,
      tag: t.tag,
      logoUrl: t.logoUrl,
      players: t.players?.map((p) => ({
        id: p.id,
        ign: p.ign,
        realName: p.realName ?? p.name ?? null,
      })),
    }));
    const slots =
      match.matchSlots?.map((s) => ({
        slotNumber: s.slotNumber,
        slot: s.slotNumber,
        teamId: s.teamId,
        teamName: s.team?.name ?? null,
        teamTag: s.team?.tag ?? null,
        teamLogoUrl: s.team?.logoUrl ?? null,
      })) ?? [];
    return {
      match: this.withMode(match),
      tournament: match.tournament,
      teams: teamList,
      players: teamList.flatMap((t) => t.players ?? []),
      slots,
      usesSlots: capability.usesSlots,
      maxSlots: capability.maxSlots ?? null,
      rules: (match.tournament as { ruleset?: unknown })?.ruleset ?? {},
    };
  }

  async getMatchState(actor: Actor, matchId: string) {
    const ctx = await this.getMatchContext(actor, matchId);
    return {
      matchId: ctx.match.id,
      status: ctx.match.status,
      dataSource: ctx.match.dataSource ?? ctx.match.dataMode,
      slots: ctx.slots,
      teams: ctx.teams,
      usesSlots: ctx.usesSlots ?? false,
      maxSlots: ctx.maxSlots ?? null,
    };
  }

  private resolveLiveStateFromCounts(
    liveCount: number,
    totalCount: number,
    endedCount: number,
  ): LiveState {
    if (liveCount > 0) return 'LIVE';
    if (totalCount > 0 && endedCount === totalCount) return 'ENDED';
    return 'UPCOMING';
  }

  private async recalcGroupLiveState(
    groupId: string | null | undefined,
    tx: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<{ state: LiveState; stageId: string | null } | null> {
    if (!groupId) return null;
    const group = (await tx.group.findFirst({
      where: { id: groupId, deletedAt: null },
      select: {
        id: true,
        stageId: true,
        liveState: true as any,
        liveAt: true as any,
        endedAt: true as any,
        matches: {
          where: { deletedAt: null },
          select: { controlState: { select: { state: true } } },
        },
      } as any,
    })) as any;
    if (!group) return null;
    const derivedStates = (group.matches ?? []).map((m: any) =>
      deriveControlLiveState(m?.controlState?.state ?? null),
    );
    const liveCount = derivedStates.filter(
      (s: LiveState) => s === 'LIVE',
    ).length;
    const endedCount = derivedStates.filter(
      (s: LiveState) => s === 'ENDED',
    ).length;
    const totalCount = derivedStates.length;
    const next = this.resolveLiveStateFromCounts(
      liveCount,
      totalCount,
      endedCount,
    );
    const now = new Date();
    const shouldUpdate =
      group.liveState !== next ||
      (next === 'LIVE' && !group.liveAt) ||
      (next === 'ENDED' && !group.endedAt);
    if (shouldUpdate) {
      const data: Prisma.GroupUpdateInput & Record<string, unknown> = {
        liveState: next as any,
      };
      if (next === 'LIVE') {
        (data as any).liveAt = group.liveAt ?? now;
      } else if (next === 'ENDED') {
        (data as any).endedAt = group.endedAt ?? now;
      }
      await tx.group.update({ where: { id: groupId }, data });
    }
    return { state: next, stageId: group.stageId };
  }

  private async recalcStageLiveState(
    stageId: string | null | undefined,
    tx: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<{
    state: LiveState;
    tournamentId: string;
    stageId: string;
  } | null> {
    if (!stageId) return null;
    const stage = (await tx.stage.findFirst({
      where: { id: stageId, deletedAt: null },
      select: {
        id: true,
        tournamentId: true,
        liveState: true as any,
        liveAt: true as any,
        endedAt: true as any,
        groups: {
          where: { deletedAt: null },
          select: {
            id: true,
            liveState: true as any,
            liveAt: true as any,
            endedAt: true as any,
            matches: {
              where: { deletedAt: null },
              select: { controlState: { select: { state: true } } },
            },
          },
        },
        matches: {
          where: { deletedAt: null },
          select: { controlState: { select: { state: true } } },
        },
      } as any,
    })) as any;
    if (!stage) return null;

    const hasGroups = (stage.groups?.length ?? 0) > 0;
    const next = hasGroups
      ? deriveStageStateFromGroups(
          (stage.groups ?? []).map((g: any) => ({
            state: deriveGroupStateFromMatches(g.matches ?? []),
            matches: g.matches ?? [],
          })),
        )
      : deriveGroupStateFromMatches(stage.matches ?? []);

    const now = new Date();
    const shouldUpdate =
      stage.liveState !== next ||
      (next === 'LIVE' && !stage.liveAt) ||
      (next === 'ENDED' && !stage.endedAt);
    if (shouldUpdate) {
      const data: Prisma.StageUpdateInput & Record<string, unknown> = {
        liveState: next as any,
      };
      if (next === 'LIVE') {
        (data as any).liveAt = stage.liveAt ?? now;
      } else if (next === 'ENDED') {
        (data as any).endedAt = stage.endedAt ?? now;
      }
      await tx.stage.update({ where: { id: stageId }, data });
    }
    return {
      state: next,
      tournamentId: stage.tournamentId,
      stageId: stage.id,
    };
  }

  private async recalcTournamentLiveState(
    tournamentId: string | null | undefined,
    tx: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<LiveState | null> {
    if (!tournamentId) return null;
    const tournament = (await tx.tournament.findFirst({
      where: { id: tournamentId, deletedAt: null },
      select: {
        id: true,
        liveState: true as any,
        liveAt: true as any,
        endedAt: true as any,
        matches: {
          where: { deletedAt: null },
          select: { controlState: { select: { state: true } } },
        },
      } as any,
    })) as any;
    if (!tournament) return null;

    const derivedStates = (tournament.matches ?? []).map((m: any) =>
      deriveControlLiveState(m?.controlState?.state ?? null),
    );
    const liveCount = derivedStates.filter(
      (s: LiveState) => s === 'LIVE',
    ).length;
    const endedCount = derivedStates.filter(
      (s: LiveState) => s === 'ENDED',
    ).length;
    const totalCount = derivedStates.length;
    const next = this.resolveLiveStateFromCounts(
      liveCount,
      totalCount,
      endedCount,
    );
    const now = new Date();
    const shouldUpdate =
      tournament.liveState !== next ||
      (next === 'LIVE' && !tournament.liveAt) ||
      (next === 'ENDED' && !tournament.endedAt);
    if (shouldUpdate) {
      const data: Prisma.TournamentUpdateInput & Record<string, unknown> = {
        liveState: next as any,
      };
      if (next === 'LIVE') {
        (data as any).liveAt = tournament.liveAt ?? now;
      } else if (next === 'ENDED') {
        (data as any).endedAt = tournament.endedAt ?? now;
      }
      await tx.tournament.update({ where: { id: tournamentId }, data });
    }
    return next;
  }

  async liveRadar(actor: Actor) {
    const orgId = actor.organizationId ?? actor.actingOrgId ?? null;
    if (!orgId) {
      this.logger.warn(
        '[LIVE RADAR] actor missing organizationId; returning empty radar',
      );
      return {
        liveTournament: null,
        liveStage: null,
        liveGroup: null,
        liveMatch: null,
      };
    }

    const live = await this.prisma.match.findFirst({
      where: {
        organizationId: orgId,
        deletedAt: null,
        OR: [
          { liveState: 'LIVE' as any },
          { status: 'LIVE' as any },
          { controlState: { state: 'LIVE' as any } },
        ],
      },
      select: {
        id: true,
        name: true,
        matchNumber: true,
        status: true,
        liveState: true as any,
        liveAt: true as any,
        startedAt: true,
        scheduledAt: true,
        controlState: { select: { state: true } },
        tournament: { select: { id: true, name: true } },
        stage: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
      },
      orderBy: [
        { liveAt: 'desc' },
        { startedAt: 'desc' },
        { updatedAt: 'desc' },
      ],
    });

    if (!live) {
      return {
        liveTournament: null,
        liveStage: null,
        liveGroup: null,
        liveMatch: null,
      };
    }

    return {
      liveTournament: live.tournament ?? null,
      liveStage: live.stage ?? null,
      liveGroup: live.group ?? null,
      liveMatch: {
        id: live.id,
        name: live.name ?? null,
        matchNumber: live.matchNumber ?? null,
        status: live.status,
        liveState: live.liveState,
        controlState: live.controlState?.state ?? null,
        startedAt: live.startedAt ?? null,
        scheduledAt: live.scheduledAt ?? null,
      },
    };
  }

  async syncLiveHierarchy(params: {
    matchId: string;
    groupId: string | null;
    stageId: string | null;
    tournamentId: string;
  }): Promise<LiveStateUpdatePayload[]> {
    const updates: LiveStateUpdatePayload[] = [];
    const groupResult = await this.recalcGroupLiveState(params.groupId);
    const stageResult = await this.recalcStageLiveState(
      params.stageId ?? groupResult?.stageId ?? null,
    );
    const tournamentState = await this.recalcTournamentLiveState(
      stageResult?.tournamentId ?? params.tournamentId,
    );

    if (groupResult && params.groupId) {
      updates.push({
        entity: 'GROUP',
        id: params.groupId,
        liveState: groupResult.state,
      });
    }
    if (
      stageResult &&
      (params.stageId ?? groupResult?.stageId ?? stageResult.stageId)
    ) {
      const stageId =
        params.stageId ?? groupResult?.stageId ?? stageResult.stageId;
      updates.push({
        entity: 'STAGE',
        id: stageId,
        liveState: stageResult.state,
      });
    }
    if (tournamentState) {
      updates.push({
        entity: 'TOURNAMENT',
        id: stageResult?.tournamentId ?? params.tournamentId,
        liveState: tournamentState,
      });
    }
    return updates;
  }
}

// Re-export resolver for convenience in other modules
export { resolveMatchDataSource } from './match-datasource.util';
