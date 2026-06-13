import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
  forwardRef,
} from '@nestjs/common';
import {
  MatchStatus,
  Prisma,
  AuditAction,
  LiveState,
  MatchDataSource,
  Role,
  TelemetrySource,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../db/prisma.service';
import type { Actor } from '../matches/matches.service';
import { ScoringService } from '../scoring/scoring.service';
import { MatchControlGateway } from './match-control.gateway';
import {
  CONTROL_STATES,
  ControlState,
  PersistedControlState,
  SetStatusDto,
  UpdateScoreDto,
} from './dto/control.dto';
import {
  computeAliveTeams,
  computeTotalTeams,
  isAutomaticMatchStateSourceMode,
  LiveMatchState,
  MatchControlStateStore,
  MatchStatePlayer,
  TeamScoreState,
} from './state.store';
import { MatchStateService } from './match-state.service';
import { ScoreboardService } from '../scoreboard/scoreboard.service';
import { MatchesService } from '../matches/matches.service';
import { AuditService } from '../audit/audit.service';
import type { LiveStateUpdatePayload } from '../matches/matches.service';
import { ResultsEventsService } from '../results/results-events.service';
import { ResultsService } from '../results/results.service';
import { BroadcastService } from '../broadcast/broadcast.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { RankingEmitterService } from '../../realtime/ranking-emitter.service';
import { MatchStateBroadcaster } from '../../realtime/match-state-broadcaster.service';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  MatchConclusionService,
  type ComputedFinalResults,
  type ComputedFinalPlayerResult,
  type ComputedFinalStanding,
  type ComputedFinalTeamResult,
  type MatchConclusionPlan,
} from '../results/match-conclusion.service';
import { LiveStateMirrorService } from './live-state-mirror.service';
import { buildWidgetScoreboardSnapshot } from '../widgets/widgets.snapshot';
import { PcobGateway } from '../pcob/pcob.gateway';
import { TopFraggerService } from '../widgets/top-fragger/top-fragger.service';
import { MvpService } from '../widgets/mvp/mvp.service';
import {
  derivePresenceStatus,
  isPresentInMatch,
} from '../../common/results-presence.util';
import { normalizePublicAssetUrl } from '../../common/public-asset-url.util';
import {
  canStartMatchForLifecycle,
  deriveCanonicalMatchLifecycleStatus,
  deriveControlStateFromMatchStatus,
  deriveMatchLockContract,
  derivePublicControlStatus,
  type MatchLockContract,
  type PublicControlStatus,
  isMatchFinalizingStatus,
  isMatchFinishedStatus,
  isMatchLockedStatus,
  isMatchLiveStatus,
  isMatchStartableStatus,
  normalizeMatchLifecycleStatus,
} from '../../common/match-status.util';
import {
  buildApiObserverBindingData,
  buildPcobBindingData,
  hasPcobAdapterBindingSignal,
} from '../../common/pcob-binding.util';
import { buildMatchPlayerKey } from '../../common/match-player-key.util';
import {
  derivePcobBindingFlags,
  exposeCanonicalTelemetryProvider,
  exposeSourceMode,
  exposeTelemetryProvider,
} from '../../common/match-telemetry-provider.util';
import {
  deriveTelemetryRuntimeContract,
  readTelemetryRuntimeMeta,
  type TelemetryRuntimeContract,
} from '../../common/telemetry-runtime-contract.util';
import type {
  TelemetryMatchState,
  TelemetryStateEvent,
  TelemetryTeamState,
} from '../telemetry/telemetry.types';

type MatchSummary = {
  id: string;
  organizationId: string | null;
  groupId: string | null;
  stageId: string | null;
  tournamentId: string;
  status: MatchStatus;
  pcobSessionId: string | null;
  pcobMode?: boolean | null;
  pcobBoundAt?: Date | null;
  pcobLastSeenAt?: Date | null;
  adapterKey?: string | null;
  dataMode?: string | null;
  dataSource: string | null;
  liveState: LiveState;
  liveAt: Date | null;
  startedAt: Date | null;
  endedAt: Date | null;
  endedReason: string | null;
  updatedAt: Date;
  tournament: { ownerUserId: string; organizationId: string | null };
  controlState?: {
    state: PersistedControlState;
    version?: number;
    metaJson?: Prisma.JsonValue | null;
  } | null;
};

type MatchControlMeta = {
  resultFinalized?: boolean;
  finalizedAt?: string | null;
  winnerTeamId?: string | null;
  aliveTeamsAtEnd?: number | null;
  finalizationStartedAt?: string | null;
  finishEligibilityVerifiedAt?: string | null;
  finishEligibilitySource?: string | null;
  finishEligibilityAliveTeams?: number | null;
  finishEligibilityAlivePlayers?: number | null;
  finishEligibilityTotalTeams?: number | null;
  finishEligibilityCirclePhase?: number | null;
  resultNeedsConfirmation?: boolean;
  resultAmbiguities?: Array<{
    code: string;
    teamIds: string[];
    placementFrom: number;
    placementTo: number;
    detectedAt: string | null;
    message: string;
  }> | null;
  postMatchWidgets?: Array<{
    name: string;
    obsUrl: string;
  }> | null;
  telemetryPromotionDiagnostics?: Record<string, unknown> | null;
} | null;

type LiveConflictCandidate = {
  id: string;
};

type MatchStartContext = {
  source?: string | null;
  clientId?: string | null;
  requestedMatchId?: string | null;
  expectedVersion?: number | null;
};

type AuthoritativeLifecycleSignal = {
  source?: string | null;
  sessionId?: string | null;
  winnerTeamId?: string | null;
};

type ControlStateMetaInput =
  | Prisma.InputJsonValue
  | ((
      currentMeta: Prisma.JsonValue | null | undefined,
    ) => Prisma.InputJsonValue);

const FINALIZATION_WARNING_THRESHOLD_MS = 60_000;
const MAX_INIT_WAIT_MS = 120_000;
const MIN_LIVE_DURATION_MS = 30_000;
const MIN_TELEMETRY_FINISH_ELIGIBLE_MS = 6 * 60_000;
const MIN_SINGLE_ALIVE_STABILITY_MS = 15_000;
const MIN_FINISH_CIRCLE_PHASE = 2;
const FINALIZATION_RECOVERY_COOLDOWN_MS = 10_000;
const FINALIZED_POST_MATCH_WIDGETS = [
  { key: 'champions', name: 'Champions' },
  { key: 'first-runner-up', name: '1st Runner Up' },
  { key: 'second-runner-up', name: '2nd Runner Up' },
  { key: 'top-3-podium', name: 'Top 3 Podium' },
  { key: 'match-results', name: 'Match Results' },
  { key: 'match-summary', name: 'Match Summary' },
  { key: 'head-to-head-comparison', name: 'Head to Head Comparison' },
  { key: 'mvp-top-fragger', name: 'MVP / Top Fragger' },
  { key: 'group-mvp', name: 'Group MVP' },
  { key: 'top-5-fraggers', name: 'Top 5 Fraggers' },
  {
    key: 'top-5-overall-group-fraggers',
    name: 'Top 5 Overall Group Fraggers',
  },
  { key: 'overall-standings', name: 'Overall Standings' },
  { key: 'qualification-line', name: 'Qualification Line' },
  { key: 'match-schedule', name: 'Match Schedule' },
] as const;
const SYSTEM_ACTOR: Actor = {
  id: 'system',
  actorId: 'system',
  role: 'SUPER_ADMIN',
  actorRole: 'SUPER_ADMIN',
  organizationId: null,
  actingOrgId: null,
};

const asTelemetrySnapshot = (value: unknown): TelemetryMatchState | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as TelemetryMatchState;
};

export type ControlHealth = {
  status: 'ok';
  serverTime: number;
  uptimeMs: number;
  matchId: string | null;
  matchStatus?: ControlState;
  version?: number | null;
};

export type MatchLifecycleSnapshot = {
  matchId: string;
  organizationSlug: string | null;
  status: string | null;
  lifecycleStatus: string | null;
  controlStatus: PublicControlStatus;
  controlVersion: number | null;
  liveState: LiveState | null;
  startedAt: string | null;
  endedAt: string | null;
  updatedAt: string;
  isLocked: boolean;
  isFinalizing: boolean;
  resultFinalized: boolean;
  resultNeedsConfirmation: boolean;
  resultAmbiguities: Array<{
    code: string;
    teamIds: string[];
    placementFrom: number;
    placementTo: number;
    detectedAt: string | null;
    message: string;
  }>;
  postMatchWidgets: Array<{
    name: string;
    obsUrl: string;
  }>;
  locks: MatchLockContract;
  finalizationStartedAt: string | null;
  finalizationDurationMs: number | null;
  telemetry: TelemetryRuntimeContract;
  binding: {
    sessionId: string | null;
    dataSource: string | null;
    dataMode: string | null;
    telemetryProvider: string;
    sourceMode: 'MANUAL' | 'API';
    boundAt: string | null;
    lastSeenAt: string | null;
    isConfigured: boolean;
    isBound: boolean;
    isReady: boolean;
  };
};

export type NextEligibleMatchSummary = {
  id: string;
  name: string | null;
  matchNumber: number | null;
  status: string | null;
  tournamentId: string | null;
  stageId: string | null;
  groupId: string | null;
};

export type NextMatchResolution = {
  currentMatchId: string;
  currentStatus: string | null;
  currentIsFinished: boolean;
  isAfterFinished: boolean;
  nextMatch: NextEligibleMatchSummary | null;
};

@Injectable()
export class MatchControlService implements OnModuleInit {
  private readonly logger = new Logger(MatchControlService.name);
  private readonly delayedFinalizationWarnings = new Set<string>();
  private readonly finalizationRecoveryInFlight = new Set<string>();
  private readonly finalizationRecoveryCooldownUntil = new Map<
    string,
    number
  >();
  private finishPendingControlStateSupported: boolean | null = null;
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoring: ScoringService,
    private readonly store: MatchControlStateStore,
    @Inject(forwardRef(() => MatchControlGateway))
    private readonly gateway: MatchControlGateway,
    private readonly matchStateService: MatchStateService,
    private readonly scoreboard: ScoreboardService,
    @Inject(forwardRef(() => MatchesService))
    private readonly matchesService: MatchesService,
    private readonly audit: AuditService,
    @Inject(forwardRef(() => ResultsService))
    private readonly resultsService: ResultsService,
    private readonly resultsEvents: ResultsEventsService,
    private readonly broadcast: BroadcastService,
    private readonly realtime: RealtimeGateway,
    private readonly rankingEmitter: RankingEmitterService,
    @Inject(forwardRef(() => MatchConclusionService))
    private readonly conclusion: MatchConclusionService,
    private readonly liveStateMirror: LiveStateMirrorService,
    @Optional()
    @Inject(forwardRef(() => PcobGateway))
    private readonly pcobGateway?: PcobGateway,
    @Optional()
    private readonly topFragger?: TopFraggerService,
    @Optional()
    private readonly mvp?: MvpService,
    @Optional()
    private readonly matchStateBroadcaster?: MatchStateBroadcaster,
  ) {}

  async onModuleInit() {
    await this.rehydrateLiveStates();
  }

  private hasModelField(model: string, field: string): boolean {
    const maybeDmmf = (this.prisma as unknown as { _dmmf?: unknown })?._dmmf;
    const modelMap = (maybeDmmf as { modelMap?: Record<string, any> })
      ?.modelMap;
    const modelEntry = modelMap?.[model] as
      | { fields?: Array<{ name: string }> }
      | undefined;
    const fields: Array<{ name: string }> = modelEntry?.fields ?? [];
    return fields.some((f) => f.name === field);
  }

  private requireTournamentMatch<
    T extends {
      organizationId?: string | null;
      ownerUserId?: string | null;
      tournamentId: string | null;
      tournament: { ownerUserId: string; organizationId: string | null } | null;
    },
  >(
    match: T,
  ): T & {
    tournamentId: string;
    tournament: { ownerUserId: string; organizationId: string | null };
  } {
    if (!match.tournamentId || !match.tournament) {
      return {
        ...match,
        tournament: {
          ownerUserId: match.ownerUserId ?? '',
          organizationId: match.organizationId ?? null,
        },
      } as T & {
        tournamentId: string;
        tournament: { ownerUserId: string; organizationId: string | null };
      };
    }

    return match as T & {
      tournamentId: string;
      tournament: { ownerUserId: string; organizationId: string | null };
    };
  }

  private requireMatchOrganizationId(match: {
    organizationId?: string | null;
    tournament?: { organizationId: string | null } | null;
  }): string {
    const organizationId =
      match.organizationId ?? match.tournament?.organizationId ?? null;

    if (!organizationId) {
      throw new BadRequestException('Match organization context is missing');
    }

    return organizationId;
  }

  private ensurePermission(
    actor: Actor,
    ownerUserId: string | null,
    organizationId: string | null = null,
  ) {
    const actorId = actor.actorId ?? actor.id;
    const actorRole = actor.actorRole ?? actor.role;
    if (actorRole === 'SUPER_ADMIN') return;

    if (ownerUserId && actorId && actorId === ownerUserId) {
      if (organizationId !== null) {
        this.ensureOrgAccess(actor, organizationId);
      }
      return;
    }

    if (organizationId !== null) {
      this.ensureOrgAccess(actor, organizationId);
      return;
    }

    throw new ForbiddenException('Not allowed to control this match');
  }

  private ensureOrgAccess(actor: Actor, organizationId: string | null) {
    const actorOrg =
      actor.actingOrgId ?? actor.organizationId ?? actor.actorId ?? null;
    const actorRole = actor.actorRole ?? actor.role;
    if (!organizationId) {
      throw new ForbiddenException('Organization not found for match');
    }
    if (actorRole === 'SUPER_ADMIN' && actorOrg === null) {
      throw new ForbiddenException(
        'SUPER_ADMIN must impersonate an organization to control this match',
      );
    }
    if (!actorOrg || actorOrg !== organizationId) {
      throw new ForbiddenException('Not allowed to control this match');
    }
  }

  private mapControlToBusinessStatus(
    control: ControlState,
    current: MatchStatus,
  ): MatchStatus {
    if (control === 'LIVE') return MatchStatus.LIVE;
    if (control === 'FINISH_PENDING') return MatchStatus.FINISH_PENDING;
    if (control === 'READY' || control === 'COUNTDOWN') {
      return MatchStatus.DRAFT;
    }
    if (control === 'FINISHED') return MatchStatus.FINISHED;
    return current;
  }

  private resolveControlMetaInput(
    metaJson: ControlStateMetaInput | undefined,
    currentMeta: Prisma.JsonValue | null | undefined,
  ): Prisma.InputJsonValue | undefined {
    if (metaJson === undefined) {
      return undefined;
    }
    return typeof metaJson === 'function' ? metaJson(currentMeta) : metaJson;
  }

  private async writeControlStateCas(
    tx: Prisma.TransactionClient,
    params: {
      matchId: string;
      organizationId: string;
      state: PersistedControlState;
      reason?: string | null;
      metaJson?: ControlStateMetaInput;
      expectedVersion?: number | null;
      updatedAt?: Date;
      updatedByUserId?: string | null;
      patch?: Record<string, unknown>;
    },
  ): Promise<{
    previousState: PersistedControlState | null;
    previousVersion: number | null;
    version: number;
    state: PersistedControlState;
  }> {
    const now = params.updatedAt ?? new Date();
    const current = await tx.matchControlState.findUnique({
      where: { matchId: params.matchId },
      select: {
        state: true,
        version: true,
        metaJson: true,
      },
    });
    const expectedVersion =
      params.expectedVersion === undefined
        ? (current?.version ?? null)
        : params.expectedVersion;
    const metaJson = this.resolveControlMetaInput(
      params.metaJson,
      current?.metaJson ?? null,
    );
    const metaPatch = metaJson === undefined ? {} : { metaJson: metaJson };
    const reasonPatch =
      params.reason === undefined ? {} : { reason: params.reason ?? null };
    const userPatch =
      params.updatedByUserId === undefined
        ? {}
        : { updatedByUserId: params.updatedByUserId };

    if (!current) {
      if (
        expectedVersion !== null &&
        expectedVersion !== undefined &&
        expectedVersion !== 0
      ) {
        throw new ConflictException('Control state version mismatch');
      }
      try {
        await tx.matchControlState.create({
          data: {
            matchId: params.matchId,
            organizationId: params.organizationId,
            state: params.state as never,
            version: 1,
            updatedAt: now,
            ...(reasonPatch as Record<string, unknown>),
            ...(metaPatch as Record<string, unknown>),
            ...(userPatch as Record<string, unknown>),
            ...(params.patch ?? {}),
          } as Prisma.MatchControlStateUncheckedCreateInput,
        });
      } catch (error) {
        if (
          params.state === 'FINISH_PENDING' &&
          this.isStaleControlStateEnumError(error) &&
          !params.patch
        ) {
          const rawMeta =
            metaJson === undefined ? null : JSON.stringify(metaJson);
          await tx.$executeRaw`
            INSERT INTO "MatchControlState"
              ("matchId", "organizationId", "state", "version", "updatedAt", "reason", "metaJson", "updatedByUserId")
            VALUES
              (${params.matchId}, ${params.organizationId}, ${params.state}::"ControlState", 1, ${now}, ${
                params.reason ?? null
              }, ${rawMeta}::jsonb, ${params.updatedByUserId ?? null})
          `;
          return {
            previousState: null,
            previousVersion: null,
            state: params.state,
            version: 1,
          };
        }
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException('Control state version mismatch');
        }
        throw error;
      }
      return {
        previousState: null,
        previousVersion: null,
        state: params.state,
        version: 1,
      };
    }

    if (
      expectedVersion !== null &&
      expectedVersion !== undefined &&
      current.version !== expectedVersion
    ) {
      throw new ConflictException('Control state version mismatch');
    }

    let result: { count: number };
    try {
      result = await tx.matchControlState.updateMany({
        where: {
          matchId: params.matchId,
          version: current.version,
        },
        data: {
          state: params.state as never,
          version: { increment: 1 },
          updatedAt: now,
          ...(reasonPatch as Record<string, unknown>),
          ...(metaPatch as Record<string, unknown>),
          ...(userPatch as Record<string, unknown>),
          ...(params.patch ?? {}),
        } as Prisma.MatchControlStateUncheckedUpdateManyInput,
      });
    } catch (error) {
      if (
        params.state !== 'FINISH_PENDING' ||
        !this.isStaleControlStateEnumError(error) ||
        params.patch
      ) {
        throw error;
      }

      const updates = [
        Prisma.sql`"state" = ${params.state}::"ControlState"`,
        Prisma.sql`"version" = "version" + 1`,
        Prisma.sql`"updatedAt" = ${now}`,
      ];
      if (params.reason !== undefined) {
        updates.push(Prisma.sql`"reason" = ${params.reason ?? null}`);
      }
      if (metaJson !== undefined) {
        updates.push(
          Prisma.sql`"metaJson" = ${JSON.stringify(metaJson)}::jsonb`,
        );
      }
      if (params.updatedByUserId !== undefined) {
        updates.push(Prisma.sql`"updatedByUserId" = ${params.updatedByUserId}`);
      }
      const rows = await tx.$queryRaw<Array<{ version: number }>>`
        UPDATE "MatchControlState"
        SET ${Prisma.join(updates)}
        WHERE "matchId" = ${params.matchId}
          AND "version" = ${current.version}
        RETURNING "version"
      `;
      result = { count: rows.length };
    }
    if (result.count !== 1) {
      throw new ConflictException('Control state version mismatch');
    }

    return {
      previousState: current.state as PersistedControlState,
      previousVersion: current.version,
      state: params.state,
      version: current.version + 1,
    };
  }

  private isStaleControlStateEnumError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientValidationError &&
      error.message.includes('Invalid value for argument `state`')
    );
  }

  private async supportsFinishPendingControlState(
    client: Pick<PrismaService, '$queryRaw'> | Prisma.TransactionClient,
  ): Promise<boolean> {
    if (this.finishPendingControlStateSupported !== null) {
      return this.finishPendingControlStateSupported;
    }
    if (typeof client.$queryRaw !== 'function') {
      return true;
    }
    try {
      const rows = await client.$queryRaw<Array<{ enumlabel: string }>>`
        SELECT e.enumlabel
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'ControlState'
          AND e.enumlabel = 'FINISH_PENDING'
        LIMIT 1
      `;
      this.finishPendingControlStateSupported = rows.length > 0;
    } catch {
      this.finishPendingControlStateSupported = false;
    }
    return this.finishPendingControlStateSupported;
  }

  private async resolvePersistedControlState(
    state: ControlState,
    client: Pick<PrismaService, '$queryRaw'> | Prisma.TransactionClient = this
      .prisma,
  ): Promise<PersistedControlState> {
    if (state !== 'FINISH_PENDING') {
      return state;
    }
    return (await this.supportsFinishPendingControlState(client))
      ? 'FINISH_PENDING'
      : 'ENDED';
  }

  private toControlStateFromMatch(status: MatchStatus): PersistedControlState {
    return deriveControlStateFromMatchStatus(status) as PersistedControlState;
  }

  private toLifecycleContext(match: {
    status: MatchStatus;
    liveState?: string | null;
    dataSource?: string | null;
    dataMode?: string | null;
    controlState?: {
      state?: PersistedControlState | null;
      metaJson?: Prisma.JsonValue | null;
      resultsManualLock?: boolean | null;
      resultsForceUnlock?: boolean | null;
    } | null;
  }) {
    return {
      status: match.status ?? null,
      liveState: match.liveState ?? match.controlState?.state ?? null,
      controlState: match.controlState?.state ?? null,
      metaJson: match.controlState?.metaJson ?? null,
      dataSource: match.dataSource ?? null,
      dataMode: match.dataMode ?? null,
      manualLock: match.controlState?.resultsManualLock ?? null,
      forceUnlock: match.controlState?.resultsForceUnlock ?? null,
    };
  }

  private toPublicControlStatus(match: {
    status: MatchStatus;
    liveState?: string | null;
    dataSource?: string | null;
    dataMode?: string | null;
    controlState?: {
      state?: PersistedControlState | null;
      metaJson?: Prisma.JsonValue | null;
    } | null;
  }): PublicControlStatus {
    return derivePublicControlStatus(this.toLifecycleContext(match));
  }

  private toPublicStatus(
    status: MatchStatus,
    controlState?: PersistedControlState | null,
    metaJson?: Prisma.JsonValue | null,
  ): 'UPCOMING' | 'LIVE' | 'ENDED' | 'CANCELLED' {
    const publicControlStatus = derivePublicControlStatus({
      status,
      controlState,
      metaJson,
    });
    if (publicControlStatus === 'LIVE') return 'LIVE';
    if (
      publicControlStatus === 'FINISH_PENDING' ||
      publicControlStatus === 'FINISHED'
    ) {
      return 'ENDED';
    }
    return 'UPCOMING';
  }

  private parseMeta(
    value: Prisma.JsonValue | null | undefined,
  ): MatchControlMeta {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return value as MatchControlMeta;
  }

  private parseMetaRecord(
    value: Prisma.JsonValue | null | undefined,
  ): Record<string, unknown> {
    const meta = this.parseMeta(value);
    if (!meta || typeof meta !== 'object') {
      return {};
    }
    return meta as Record<string, unknown>;
  }

  private normalizeSavedPostMatchWidgets(
    value: unknown,
  ): Array<{ name: string; obsUrl: string }> {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return [];
      }
      const candidate = entry as { name?: unknown; obsUrl?: unknown };
      const name =
        typeof candidate.name === 'string' ? candidate.name.trim() : '';
      const obsUrl =
        typeof candidate.obsUrl === 'string' ? candidate.obsUrl.trim() : '';
      if (!name || !obsUrl) {
        return [];
      }
      return [{ name, obsUrl }];
    });
  }

  private buildSavedPostMatchWidgets(
    organizationSlug: string | null | undefined,
    matchId: string,
  ): Array<{ name: string; obsUrl: string }> {
    const slug = organizationSlug?.trim();
    if (!slug) {
      return [];
    }

    const encodedSlug = encodeURIComponent(slug);
    const encodedMatchId = encodeURIComponent(matchId);
    return FINALIZED_POST_MATCH_WIDGETS.map((widget) => ({
      name: widget.name,
      obsUrl: `/widgets/${encodedSlug}/${widget.key}?matchId=${encodedMatchId}`,
    }));
  }

  private async backfillSavedPostMatchWidgets(params: {
    matchId: string;
    organizationSlug: string | null | undefined;
    controlVersion: number | null | undefined;
    controlMeta: MatchControlMeta;
  }): Promise<Array<{ name: string; obsUrl: string }>> {
    if (params.controlMeta?.resultFinalized !== true) {
      return [];
    }

    const postMatchWidgets = this.buildSavedPostMatchWidgets(
      params.organizationSlug,
      params.matchId,
    );
    if (postMatchWidgets.length === 0) {
      return [];
    }

    const controlVersion = params.controlVersion;
    if (typeof controlVersion !== 'number') {
      return postMatchWidgets;
    }

    const nextMeta = {
      ...(params.controlMeta ?? {}),
      postMatchWidgets,
    };
    try {
      await this.prisma.matchControlState.updateMany({
        where: {
          matchId: params.matchId,
          version: controlVersion,
        },
        data: {
          metaJson: nextMeta as Prisma.InputJsonValue,
          updatedAt: new Date(),
        } as Prisma.MatchControlStateUncheckedUpdateManyInput,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'unknown backfill failure';
      this.logger.warn(
        JSON.stringify({
          stage: 'match-control',
          action: 'post-match-widgets-backfill-skipped',
          matchId: params.matchId,
          reason: message,
        }),
      );
    }
    return postMatchWidgets;
  }

  private normalizeTimestamp(value: unknown): string | null {
    const parsed =
      value instanceof Date
        ? value.getTime()
        : typeof value === 'number' && Number.isFinite(value)
          ? value
          : typeof value === 'string' && value.trim()
            ? Date.parse(value)
            : Number.NaN;
    if (!Number.isFinite(parsed)) {
      return null;
    }

    return new Date(parsed).toISOString();
  }

  private normalizeOptionalInteger(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    }
    return null;
  }

  private buildFinalizationEligibilityMeta(
    currentMeta: Prisma.JsonValue | null | undefined,
    params: {
      finalizationStartedAt: string;
      source: string;
      aliveTeams?: number | null;
      alivePlayers?: number | null;
      totalTeams?: number | null;
      circlePhase?: number | null;
    },
  ): Prisma.JsonObject {
    const nextMeta = this.parseMetaRecord(currentMeta);
    nextMeta.finalizationStartedAt = params.finalizationStartedAt;
    nextMeta.finishEligibilityVerifiedAt = params.finalizationStartedAt;
    nextMeta.finishEligibilitySource = params.source;

    if (params.aliveTeams !== undefined) {
      nextMeta.finishEligibilityAliveTeams = params.aliveTeams;
    }
    if (params.alivePlayers !== undefined) {
      nextMeta.finishEligibilityAlivePlayers = params.alivePlayers;
    }
    if (params.totalTeams !== undefined) {
      nextMeta.finishEligibilityTotalTeams = params.totalTeams;
    }
    if (params.circlePhase !== undefined) {
      nextMeta.finishEligibilityCirclePhase = params.circlePhase;
    }

    return nextMeta as Prisma.JsonObject;
  }

  private hasValidatedFinalizationEligibility(meta: MatchControlMeta): boolean {
    if (!meta) {
      return false;
    }
    const verifiedAt = this.normalizeTimestamp(
      meta.finishEligibilityVerifiedAt,
    );
    const aliveTeams = this.normalizeOptionalInteger(
      meta.finishEligibilityAliveTeams,
    );
    return verifiedAt !== null && aliveTeams !== null && aliveTeams <= 1;
  }

  private queuePendingFinalizationRecovery(
    matchId: string,
    reason: string = 'FINALIZATION_RECOVERY',
  ): void {
    const now = Date.now();
    const cooldownUntil =
      this.finalizationRecoveryCooldownUntil.get(matchId) ?? 0;
    if (this.finalizationRecoveryInFlight.has(matchId) || cooldownUntil > now) {
      return;
    }

    this.finalizationRecoveryCooldownUntil.set(
      matchId,
      now + FINALIZATION_RECOVERY_COOLDOWN_MS,
    );
    this.finalizationRecoveryInFlight.add(matchId);

    void this.confirmFinishedIfEligible(matchId, reason)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `[Match] Finalization recovery deferred matchId=${matchId} reason=${message}`,
        );
      })
      .finally(() => {
        this.finalizationRecoveryInFlight.delete(matchId);
      });
  }

  private buildTelemetrySnapshot(match: {
    status: MatchStatus;
    pcobLastSeenAt?: Date | null;
    controlState?: { metaJson?: Prisma.JsonValue | null } | null;
  }): TelemetryRuntimeContract {
    const lifecycleStatus = deriveCanonicalMatchLifecycleStatus(
      this.toLifecycleContext(match),
    );
    const metaRecord =
      (this.parseMeta(match.controlState?.metaJson) as Record<
        string,
        unknown
      > | null) ?? {};
    return deriveTelemetryRuntimeContract({
      lifecycleStatus,
      metaJson: match.controlState?.metaJson ?? null,
      fallbackTransportAt: match.pcobLastSeenAt ?? null,
      fallbackPacketAt: match.pcobLastSeenAt ?? null,
      fallbackAcceptedAt:
        readTelemetryRuntimeMeta(match.controlState?.metaJson ?? null)
          .lastAcceptedAt ??
        metaRecord.telemetryUpdatedAt ??
        null,
    });
  }

  private buildBindingSnapshot(match: {
    status: MatchStatus;
    pcobSessionId?: string | null;
    pcobMode?: boolean | null;
    pcobBoundAt?: Date | null;
    pcobLastSeenAt?: Date | null;
    adapterKey?: string | null;
    dataSource?: string | null;
    dataMode?: string | null;
    liveState?: string | null;
    controlState?: {
      state?: PersistedControlState | null;
      metaJson?: Prisma.JsonValue | null;
    } | null;
  }) {
    const lifecycleStatus = deriveCanonicalMatchLifecycleStatus(
      this.toLifecycleContext(match),
    );
    const sessionId = this.normalizeSessionId(match.pcobSessionId ?? null);
    const boundAt = this.normalizeTimestamp(match.pcobBoundAt ?? null);
    const lastSeenAt = this.normalizeTimestamp(match.pcobLastSeenAt ?? null);
    const binding = derivePcobBindingFlags(match, { lifecycleStatus });
    const isConfigured = Boolean(binding.pcobConfigured && sessionId);
    const isBound = Boolean(binding.pcobBound && boundAt);
    return {
      sessionId,
      dataSource: exposeCanonicalTelemetryProvider(match),
      dataMode: match.dataMode ?? null,
      telemetryProvider: exposeTelemetryProvider(binding.telemetryProvider),
      sourceMode: exposeSourceMode(binding.telemetryProvider),
      boundAt,
      lastSeenAt,
      isConfigured,
      isBound,
      isReady: binding.pcobReady,
    };
  }

  private logLifecycleTransition(
    matchId: string,
    previousLifecycleStatus: string | null,
    nextLifecycleStatus: string | null,
    reason: string,
    extra: Record<string, unknown> = {},
  ) {
    this.logger.log(
      JSON.stringify({
        stage: 'match-control',
        action: 'lifecycle-status-transition',
        matchId,
        previousLifecycleStatus,
        nextLifecycleStatus,
        reason,
        ...extra,
      }),
    );
  }

  private normalizeSessionId(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private normalizeStartContextValue(
    value: unknown,
    maxLength = 120,
  ): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    return trimmed.slice(0, maxLength);
  }

  private normalizeStartContext(
    context: MatchStartContext = {},
  ): MatchStartContext {
    return {
      source: this.normalizeStartContextValue(context.source),
      clientId: this.normalizeStartContextValue(context.clientId, 160),
      requestedMatchId: this.normalizeStartContextValue(
        context.requestedMatchId,
      ),
      expectedVersion:
        typeof context.expectedVersion === 'number'
          ? Math.max(0, Math.trunc(context.expectedVersion))
          : null,
    };
  }

  private hasPriorRun(match: {
    startedAt?: Date | null;
    endedAt?: Date | null;
  }): boolean {
    return Boolean(match.startedAt ?? match.endedAt);
  }

  private shouldUsePcobSession(match: {
    dataSource?: string | null;
    dataMode?: string | null;
    pcobSessionId?: string | null;
    pcobMode?: boolean | null;
    pcobBoundAt?: Date | null;
    pcobLastSeenAt?: Date | null;
    adapterKey?: string | null;
  }): boolean {
    return (
      derivePcobBindingFlags(match).telemetryProvider ===
        MatchDataSource.PCOB || hasPcobAdapterBindingSignal(match)
    );
  }

  private shouldUseApiSessionBinding(
    match: {
      dataSource?: string | null;
      dataMode?: string | null;
      pcobSessionId?: string | null;
      pcobMode?: boolean | null;
      pcobBoundAt?: Date | null;
      pcobLastSeenAt?: Date | null;
      adapterKey?: string | null;
    },
    forcedTelemetrySource: TelemetrySource | null,
  ): boolean {
    if (forcedTelemetrySource === TelemetrySource.API) {
      return true;
    }
    return (
      exposeCanonicalTelemetryProvider(match) === MatchDataSource.API &&
      hasPcobAdapterBindingSignal(match)
    );
  }

  private resolveStartSessionBinding(
    match: {
      dataSource?: string | null;
      dataMode?: string | null;
      pcobSessionId?: string | null;
      pcobMode?: boolean | null;
      pcobBoundAt?: Date | null;
      pcobLastSeenAt?: Date | null;
      adapterKey?: string | null;
      startedAt?: Date | null;
      endedAt?: Date | null;
    },
    sessionId?: string | null,
  ): {
    sessionId: string | null;
    previousSessionId: string | null;
    action: 'EXPLICIT' | 'KEEP' | 'GENERATE' | 'ROTATE' | 'NONE';
  } {
    const explicitSessionId = this.normalizeSessionId(sessionId);
    const previousSessionId = this.normalizeSessionId(match.pcobSessionId);
    if (explicitSessionId) {
      return {
        sessionId: explicitSessionId,
        previousSessionId,
        action: 'EXPLICIT',
      };
    }

    if (!this.shouldUsePcobSession(match)) {
      return {
        sessionId: null,
        previousSessionId,
        action: 'NONE',
      };
    }

    if (previousSessionId && !this.hasPriorRun(match)) {
      return {
        sessionId: previousSessionId,
        previousSessionId,
        action: 'KEEP',
      };
    }

    return {
      sessionId: `sess_${randomUUID()}`,
      previousSessionId,
      action: previousSessionId ? 'ROTATE' : 'GENERATE',
    };
  }

  private buildRunResetMatchData(match: {
    pcobSessionId?: string | null;
  }): Prisma.MatchUpdateInput {
    const sessionId = this.normalizeSessionId(match.pcobSessionId);
    return {
      status: MatchStatus.DRAFT,
      liveState: LiveState.UPCOMING,
      liveAt: null,
      startedAt: null,
      endedAt: null,
      endedReason: null,
      pcobLastSeenAt: null,
      ...(sessionId
        ? {
            pcobSessionId: null,
            pcobBoundAt: null,
          }
        : {}),
    };
  }

  private logRunBoundaryReset(
    matchId: string,
    reason: string,
    match: {
      pcobSessionId?: string | null;
      controlState?: { metaJson?: Prisma.JsonValue | null } | null;
    },
  ) {
    const meta = this.parseMetaRecord(match.controlState?.metaJson);
    const hasMetaKey = (key: string) => Object.hasOwn(meta, key);
    this.logger.log(
      JSON.stringify({
        stage: 'match-control',
        action: 'match-run-reset',
        matchId,
        reason,
        invalidatedSessionId: this.normalizeSessionId(match.pcobSessionId),
        clearedLiveSync: hasMetaKey('liveSync'),
        clearedTelemetryRuntime: hasMetaKey('telemetryRuntime'),
        clearedTelemetryIngress: hasMetaKey('telemetryIngress'),
      }),
    );
  }

  private shouldPreserveTelemetryOnLiveTransition(
    match: MatchSummary,
    context: MatchStartContext,
    nextSessionId: string | null,
    previousLifecycleStatus: string | null,
  ): boolean {
    if (previousLifecycleStatus === 'LIVE') {
      return false;
    }

    const normalizedSource = this.normalizeStartContextValue(context.source)
      ?.trim()
      .toLowerCase();
    const forcedTelemetrySource = this.resolveForcedTelemetrySource(context);
    const telemetryAuthoritativeStart =
      normalizedSource === 'telemetry-engine' ||
      normalizedSource?.includes('pcob') === true ||
      normalizedSource?.includes('telemetry') === true ||
      forcedTelemetrySource === TelemetrySource.API;
    if (!telemetryAuthoritativeStart) {
      return false;
    }

    const currentSessionId = this.normalizeSessionId(match.pcobSessionId);
    if (
      currentSessionId &&
      nextSessionId &&
      currentSessionId !== nextSessionId
    ) {
      return false;
    }

    const meta = this.parseMetaRecord(match.controlState?.metaJson);
    const runtime = readTelemetryRuntimeMeta(match.controlState?.metaJson);
    return Boolean(
      runtime.lastAcceptedAt ||
      meta.telemetryUpdatedAt ||
      meta.telemetrySequence ||
      meta.liveSync,
    );
  }

  private toTimestampMs(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? value.getTime() : null;
    }
    if (typeof value !== 'string' || !value.trim()) {
      return null;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private hasPersistedTelemetryFreshness(
    metaJson: Prisma.JsonValue | null | undefined,
    snapshot: TelemetryMatchState,
  ): boolean {
    const meta = this.parseMetaRecord(metaJson);
    const telemetryUpdatedAtMs = this.toTimestampMs(meta.telemetryUpdatedAt);
    const runtimeAcceptedAtMs = this.toTimestampMs(
      readTelemetryRuntimeMeta(metaJson ?? null).lastAcceptedAt,
    );
    const freshnessMs = telemetryUpdatedAtMs ?? runtimeAcceptedAtMs;
    if (freshnessMs === null) {
      return false;
    }

    const snapshotAcceptedAtMs = this.toTimestampMs(
      snapshot.telemetryAcceptedAt ?? null,
    );
    if (snapshotAcceptedAtMs !== null) {
      return snapshotAcceptedAtMs >= freshnessMs;
    }

    const snapshotUpdatedAtMs = this.toTimestampMs(snapshot.updatedAt);
    return snapshotUpdatedAtMs !== null && snapshotUpdatedAtMs >= freshnessMs;
  }

  private assertTelemetrySession(
    match: { pcobSessionId?: string | null },
    sessionId?: string | null,
  ): void {
    const expectedSessionId = this.normalizeSessionId(match.pcobSessionId);
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    if (
      expectedSessionId &&
      normalizedSessionId &&
      normalizedSessionId !== expectedSessionId
    ) {
      throw new ConflictException(
        'Telemetry session does not match this match',
      );
    }
  }

  private resolveFinalizationTiming(match: {
    id: string;
    status: MatchStatus;
    endedAt: Date | null;
    updatedAt: Date;
    controlState?: { metaJson?: Prisma.JsonValue | null } | null;
  }): {
    finalizationStartedAt: string | null;
    finalizationDurationMs: number | null;
  } {
    const meta = this.parseMeta(match.controlState?.metaJson);
    const finalizationStartedAt = this.normalizeTimestamp(
      meta?.finalizationStartedAt ?? null,
    );

    if (!finalizationStartedAt) {
      this.delayedFinalizationWarnings.delete(match.id);
      this.finalizationRecoveryCooldownUntil.delete(match.id);
      return {
        finalizationStartedAt: null,
        finalizationDurationMs: null,
      };
    }

    const startedAtMs = Date.parse(finalizationStartedAt);
    if (!Number.isFinite(startedAtMs)) {
      this.delayedFinalizationWarnings.delete(match.id);
      this.finalizationRecoveryCooldownUntil.delete(match.id);
      return {
        finalizationStartedAt: null,
        finalizationDurationMs: null,
      };
    }

    let endMs: number | null = null;
    if (isMatchFinalizingStatus(match.status)) {
      endMs = Date.now();
    } else if (isMatchFinishedStatus(match.status)) {
      endMs = match.endedAt?.getTime() ?? match.updatedAt.getTime();
    }

    const finalizationDurationMs =
      endMs === null ? null : Math.max(0, endMs - startedAtMs);

    if (
      isMatchFinalizingStatus(match.status) &&
      finalizationDurationMs !== null &&
      finalizationDurationMs >= FINALIZATION_WARNING_THRESHOLD_MS
    ) {
      if (!this.delayedFinalizationWarnings.has(match.id)) {
        this.delayedFinalizationWarnings.add(match.id);
        this.logger.warn(
          `[Match] Finalization taking longer than expected matchId=${match.id} durationMs=${finalizationDurationMs} thresholdMs=${FINALIZATION_WARNING_THRESHOLD_MS}`,
        );
      }
      this.queuePendingFinalizationRecovery(match.id);
    } else {
      this.delayedFinalizationWarnings.delete(match.id);
      this.finalizationRecoveryCooldownUntil.delete(match.id);
    }

    return {
      finalizationStartedAt,
      finalizationDurationMs,
    };
  }

  async getLifecycleState(matchId: string): Promise<MatchLifecycleSnapshot> {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        id: true,
        status: true,
        pcobSessionId: true,
        pcobMode: true,
        pcobBoundAt: true,
        pcobLastSeenAt: true,
        adapterKey: true,
        dataSource: true,
        dataMode: true,
        liveState: true,
        startedAt: true,
        endedAt: true,
        updatedAt: true,
        organization: {
          select: {
            slug: true,
          },
        },
        controlState: {
          select: {
            state: true,
            version: true,
            metaJson: true,
            resultsManualLock: true,
            resultsForceUnlock: true,
          },
        },
      },
    });
    if (!match) {
      throw new NotFoundException('Match not found');
    }

    const finalization = this.resolveFinalizationTiming(match);
    const lifecycleContext = this.toLifecycleContext(match);
    const locks = deriveMatchLockContract(lifecycleContext);
    const lifecycleStatus =
      deriveCanonicalMatchLifecycleStatus(lifecycleContext);
    const controlMeta = this.parseMeta(match.controlState?.metaJson) ?? {};
    let postMatchWidgets = this.normalizeSavedPostMatchWidgets(
      controlMeta.postMatchWidgets,
    );
    if (controlMeta.resultFinalized === true && postMatchWidgets.length === 0) {
      postMatchWidgets = await this.backfillSavedPostMatchWidgets({
        matchId: match.id,
        organizationSlug: match.organization?.slug ?? null,
        controlVersion: match.controlState?.version ?? null,
        controlMeta,
      });
    }
    const telemetry = this.buildTelemetrySnapshot(match);
    const binding = this.buildBindingSnapshot(match);

    return {
      matchId: match.id,
      organizationSlug: match.organization?.slug ?? null,
      status: lifecycleStatus,
      lifecycleStatus,
      controlStatus: this.toPublicControlStatus(match),
      controlVersion: match.controlState?.version ?? null,
      liveState: match.liveState ?? null,
      startedAt: match.startedAt ? match.startedAt.toISOString() : null,
      endedAt: match.endedAt ? match.endedAt.toISOString() : null,
      updatedAt: match.updatedAt.toISOString(),
      isLocked: locks.lifecycleLocked,
      isFinalizing: isMatchFinalizingStatus(match.status),
      resultFinalized: controlMeta.resultFinalized === true,
      resultNeedsConfirmation: controlMeta.resultNeedsConfirmation === true,
      resultAmbiguities: Array.isArray(controlMeta.resultAmbiguities)
        ? controlMeta.resultAmbiguities
        : [],
      postMatchWidgets,
      locks,
      finalizationStartedAt: finalization.finalizationStartedAt,
      finalizationDurationMs: finalization.finalizationDurationMs,
      telemetry,
      binding,
    };
  }

  private isMatchStartable(match: { status: string | null | undefined }) {
    return isMatchStartableStatus(match.status);
  }

  async resolveNextEligibleMatch(
    matchId: string,
    opts: { suggestedMatchId?: string | null } = {},
  ): Promise<NextMatchResolution> {
    const currentMatch = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        id: true,
        name: true,
        status: true,
        organizationId: true,
        tournamentId: true,
        sessionId: true,
        stageId: true,
        groupId: true,
        matchNumber: true,
        scheduledAt: true,
        createdAt: true,
      },
    });

    if (!currentMatch) {
      throw new NotFoundException('Match not found');
    }

    const matchScope: Prisma.MatchWhereInput = currentMatch.tournamentId
      ? { tournamentId: currentMatch.tournamentId }
      : currentMatch.sessionId
        ? {
            sessionId: currentMatch.sessionId,
            organizationId: currentMatch.organizationId,
          }
        : { id: currentMatch.id };

    const candidates = await this.prisma.match.findMany({
      where: {
        ...matchScope,
        deletedAt: null,
        id: { not: currentMatch.id },
      },
      select: {
        id: true,
        name: true,
        status: true,
        tournamentId: true,
        sessionId: true,
        stageId: true,
        groupId: true,
        matchNumber: true,
        scheduledAt: true,
        createdAt: true,
        matchSlots: {
          where: { deletedAt: null, teamId: { not: null } },
          select: { id: true },
          take: 1,
        },
      },
    });
    const eligibleCandidates = candidates.filter(
      (candidate) =>
        this.isMatchStartable(candidate) &&
        Array.isArray(candidate.matchSlots) &&
        candidate.matchSlots.length > 0,
    );
    const normalizedSuggestedMatchId =
      typeof opts.suggestedMatchId === 'string' && opts.suggestedMatchId.trim()
        ? opts.suggestedMatchId.trim()
        : null;
    if (
      normalizedSuggestedMatchId &&
      !eligibleCandidates.some(
        (candidate) => candidate.id === normalizedSuggestedMatchId,
      )
    ) {
      this.logger.warn(
        `[Match] Suggested next match no longer eligible currentMatchId=${currentMatch.id} suggestedMatchId=${normalizedSuggestedMatchId}`,
      );
    }

    const byContext = (candidate: {
      stageId: string | null;
      groupId: string | null;
    }): number => {
      if (candidate.groupId === currentMatch.groupId) {
        return 0;
      }
      if (candidate.stageId === currentMatch.stageId) {
        return 1;
      }
      return 2;
    };

    const isAfterCurrent = (candidate: {
      matchNumber: number | null;
      scheduledAt: Date | null;
      createdAt: Date;
    }): boolean => {
      if (
        typeof currentMatch.matchNumber === 'number' &&
        Number.isFinite(currentMatch.matchNumber) &&
        typeof candidate.matchNumber === 'number' &&
        Number.isFinite(candidate.matchNumber)
      ) {
        return candidate.matchNumber > currentMatch.matchNumber;
      }

      if (currentMatch.scheduledAt && candidate.scheduledAt) {
        return (
          candidate.scheduledAt.getTime() >= currentMatch.scheduledAt.getTime()
        );
      }

      return candidate.createdAt.getTime() >= currentMatch.createdAt.getTime();
    };

    const compareNullableDateAsc = (left: Date | null, right: Date | null) => {
      if (left && right) {
        return left.getTime() - right.getTime();
      }
      if (left) return -1;
      if (right) return 1;
      return 0;
    };

    const compareNullableNumberAsc = (
      left: number | null,
      right: number | null,
    ) => {
      if (typeof left === 'number' && typeof right === 'number') {
        return left - right;
      }
      if (typeof left === 'number') return -1;
      if (typeof right === 'number') return 1;
      return 0;
    };

    const sortedCandidates = [...eligibleCandidates].sort((left, right) => {
      const contextDelta = byContext(left) - byContext(right);
      if (contextDelta !== 0) {
        return contextDelta;
      }

      const afterDelta =
        Number(isAfterCurrent(left)) - Number(isAfterCurrent(right));
      if (afterDelta !== 0) {
        return afterDelta === 1 ? -1 : 1;
      }

      const scheduledDelta = compareNullableDateAsc(
        left.scheduledAt ?? null,
        right.scheduledAt ?? null,
      );
      if (scheduledDelta !== 0) {
        return scheduledDelta;
      }

      const matchNumberDelta = compareNullableNumberAsc(
        left.matchNumber ?? null,
        right.matchNumber ?? null,
      );
      if (matchNumberDelta !== 0) {
        return matchNumberDelta;
      }

      return left.createdAt.getTime() - right.createdAt.getTime();
    });

    const nextMatch = sortedCandidates[0] ?? null;
    const normalizedCurrentStatus = normalizeMatchLifecycleStatus(
      currentMatch.status,
    );

    if (!nextMatch) {
      this.logger.log(
        `[Match] No next eligible match found currentMatchId=${currentMatch.id} currentStatus=${normalizedCurrentStatus ?? currentMatch.status}`,
      );
      return {
        currentMatchId: currentMatch.id,
        currentStatus: normalizedCurrentStatus,
        currentIsFinished: isMatchLockedStatus(currentMatch.status),
        isAfterFinished: isMatchLockedStatus(currentMatch.status),
        nextMatch: null,
      };
    }

    const scope =
      nextMatch.groupId === currentMatch.groupId
        ? 'group'
        : nextMatch.stageId === currentMatch.stageId
          ? 'stage'
          : 'tournament';
    this.logger.log(
      `[Match] Resolved next eligible match currentMatchId=${currentMatch.id} nextMatchId=${nextMatch.id} scope=${scope}`,
    );

    return {
      currentMatchId: currentMatch.id,
      currentStatus: normalizedCurrentStatus,
      currentIsFinished: isMatchLockedStatus(currentMatch.status),
      isAfterFinished: isMatchLockedStatus(currentMatch.status),
      nextMatch: {
        id: nextMatch.id,
        name: nextMatch.name ?? null,
        matchNumber: nextMatch.matchNumber ?? null,
        status: normalizeMatchLifecycleStatus(nextMatch.status),
        tournamentId: nextMatch.tournamentId,
        stageId: nextMatch.stageId,
        groupId: nextMatch.groupId,
      },
    };
  }

  private clearFinalizationMeta(
    value: Prisma.JsonValue | null | undefined,
  ): Prisma.InputJsonValue {
    return this.buildControlMetaJson(value, {
      clearFinalization: true,
    });
  }

  private clearTelemetryIngressMeta(
    value: Prisma.JsonValue | null | undefined,
  ): Prisma.InputJsonValue {
    return this.buildControlMetaJson(value, {
      clearTelemetryIngress: true,
    });
  }

  private resolveForcedTelemetrySource(
    context: MatchStartContext = {},
  ): TelemetrySource | null {
    const normalizedSource = this.normalizeStartContextValue(context.source)
      ?.trim()
      .toLowerCase();
    if (
      normalizedSource === 'desktop-launcher' ||
      normalizedSource === 'direct-observer-feed'
    ) {
      return TelemetrySource.API;
    }
    return null;
  }

  private buildControlMetaJson(
    value: Prisma.JsonValue | null | undefined,
    options: {
      clearFinalization?: boolean;
      clearTelemetryIngress?: boolean;
      preserveTelemetryRuntime?: boolean;
      telemetrySource?: TelemetrySource | null;
    } = {},
  ): Prisma.InputJsonValue {
    const jsonNull = Prisma.JsonNull as unknown as Prisma.InputJsonValue;
    const meta = this.parseMetaRecord(value);
    if (options.clearFinalization) {
      delete meta.resultFinalized;
      delete meta.finalizedAt;
      delete meta.winnerTeamId;
      delete meta.aliveTeamsAtEnd;
      delete meta.finalizationStartedAt;
      delete meta.resultNeedsConfirmation;
      delete meta.resultAmbiguities;
      delete meta.postMatchWidgets;
      delete meta.telemetryPromotionDiagnostics;
      if (!options.preserveTelemetryRuntime) {
        delete meta.telemetryRuntime;
        delete meta.telemetrySequence;
        delete meta.telemetryUpdatedAt;
        delete meta.telemetryIngress;
        delete meta.liveSync;
      }
    } else if (options.clearTelemetryIngress) {
      delete meta.telemetryIngress;
    }

    if (options.telemetrySource) {
      meta.telemetrySource = options.telemetrySource;
    }

    return Object.keys(meta).length > 0
      ? (meta as Prisma.JsonObject)
      : jsonNull;
  }

  async detectMatchFinish(
    matchId: string,
    sessionId?: string | null,
  ): Promise<MatchLifecycleSnapshot> {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        id: true,
        status: true,
        liveAt: true,
        startedAt: true,
        pcobSessionId: true,
        organizationId: true,
        tournament: { select: { organizationId: true } },
        controlState: {
          select: { state: true, version: true, metaJson: true },
        },
      },
    });
    if (!match) {
      throw new NotFoundException('Match not found');
    }
    this.assertTelemetrySession(match, sessionId);

    if (
      isMatchFinalizingStatus(match.status) ||
      isMatchLockedStatus(match.status)
    ) {
      return this.getLifecycleState(matchId);
    }
    if (!isMatchLiveStatus(match.status)) {
      throw new BadRequestException(
        'Finish detection is only allowed while the match is LIVE',
      );
    }

    const now = Date.now();
    const liveStartedAt =
      match.liveAt?.getTime?.() ?? match.startedAt?.getTime?.() ?? 0;
    const liveDuration = now - liveStartedAt;
    const lifecycleStatus = deriveCanonicalMatchLifecycleStatus({
      status: match.status,
      controlState: match.controlState?.state ?? null,
      metaJson: match.controlState?.metaJson ?? null,
    });
    let state = await this.store.get(matchId);
    const persistStatePatch = async (
      patch: Partial<
        Pick<
          LiveMatchState,
          'initialized' | 'firstValidAt' | 'lastAliveTeams' | 'lastAliveTeamsAt'
        >
      >,
    ) => {
      if (!state) {
        return;
      }

      try {
        state = await this.store.save(
          matchId,
          {
            ...state,
            ...patch,
          },
          state.version,
        );
      } catch (error) {
        if (error instanceof ConflictException) {
          state = await this.store.get(matchId);
          return;
        }
        throw error;
      }
    };

    if (!state?.initialized && liveDuration > MAX_INIT_WAIT_MS && state) {
      await persistStatePatch({
        initialized: true,
        firstValidAt: state.firstValidAt ?? now,
      });
    }

    const aliveTeams = state ? computeAliveTeams(state) : 0;
    const alivePlayers = state
      ? state.teams.reduce(
          (sum, team) => sum + Math.max(0, team.alivePlayers ?? 0),
          0,
        )
      : 0;
    const totalTeams = state ? computeTotalTeams(state) : 0;
    const stableDuration =
      aliveTeams === 1 && state?.lastAliveTeams === 1
        ? now - (state.lastAliveTeamsAt ?? 0)
        : 0;
    const telemetryStartedAt =
      this.toTimestampMs(state?.firstValidAt ?? null) ??
      this.toTimestampMs(state?.updatedAt ?? null);
    const telemetryDuration =
      telemetryStartedAt === null ? null : now - telemetryStartedAt;
    const circlePhase =
      typeof state?.circle?.phase === 'number' &&
      Number.isFinite(state.circle.phase)
        ? Math.trunc(state.circle.phase)
        : null;
    const logMatchEndCheck = (reason?: string) => {
      this.logger.debug(
        JSON.stringify({
          tag: 'match-end-check',
          matchId,
          aliveTeams,
          alivePlayers,
          totalTeams,
          initialized: state?.initialized === true,
          lifecycle: lifecycleStatus,
          firstValidAt: state?.firstValidAt ?? null,
          telemetryDurationMs: telemetryDuration,
          circlePhase,
          lastAliveTeams: state?.lastAliveTeams ?? null,
          lastAliveTeamsAt: state?.lastAliveTeamsAt ?? null,
          stableDurationMs: stableDuration,
          ...(reason ? { reason } : {}),
        }),
      );
    };

    if (!state?.initialized) {
      logMatchEndCheck('STATE_NOT_INITIALIZED');
      return this.getLifecycleState(matchId);
    }

    if (lifecycleStatus === 'LIVE') {
      if (liveDuration < MIN_LIVE_DURATION_MS) {
        logMatchEndCheck('LIVE_STABILIZATION_WINDOW');
        return this.getLifecycleState(matchId);
      }
    }

    const isValidGameState = totalTeams >= 10 && state.initialized === true;
    if (!isValidGameState) {
      logMatchEndCheck('INVALID_GAME_STATE');
      return this.getLifecycleState(matchId);
    }

    if (aliveTeams === 0) {
      logMatchEndCheck('ZERO_ALIVE_TEAMS_IGNORED');
      return this.getLifecycleState(matchId);
    }

    if (aliveTeams !== 1) {
      logMatchEndCheck('ALIVE_TEAMS_GT_ONE');
      return this.getLifecycleState(matchId);
    }

    if (telemetryDuration === null) {
      logMatchEndCheck('TELEMETRY_START_UNKNOWN');
      return this.getLifecycleState(matchId);
    }

    if (telemetryDuration < MIN_TELEMETRY_FINISH_ELIGIBLE_MS) {
      logMatchEndCheck('TELEMETRY_STABILIZATION_WINDOW');
      return this.getLifecycleState(matchId);
    }

    if (circlePhase !== null && circlePhase < MIN_FINISH_CIRCLE_PHASE) {
      logMatchEndCheck('EARLY_CIRCLE_PHASE');
      return this.getLifecycleState(matchId);
    }

    if (state?.lastAliveTeams !== 1) {
      await persistStatePatch({
        lastAliveTeams: 1,
        lastAliveTeamsAt: now,
      });
      logMatchEndCheck('SINGLE_TEAM_PENDING_STABILITY');
      return this.getLifecycleState(matchId);
    }

    if (stableDuration < MIN_SINGLE_ALIVE_STABILITY_MS) {
      logMatchEndCheck('ALIVE_TEAMS_NOT_STABLE');
      return this.getLifecycleState(matchId);
    }

    logMatchEndCheck();
    const finalizationStartedAt = new Date().toISOString();
    const previousLifecycleStatus = lifecycleStatus;
    const persistedPendingControlState =
      await this.resolvePersistedControlState('FINISH_PENDING');
    await this.prisma.$transaction(async (tx) => {
      await tx.match.update({
        where: { id: matchId },
        data: { status: MatchStatus.FINISH_PENDING },
      });
      await this.writeControlStateCas(tx, {
        matchId,
        organizationId: this.requireMatchOrganizationId(match),
        state: persistedPendingControlState,
        reason: 'OBSERVER_FINISH_DETECTED',
        metaJson: (currentMeta) =>
          this.buildFinalizationEligibilityMeta(currentMeta, {
            finalizationStartedAt,
            source: 'OBSERVER_FINISH_DETECTED',
            aliveTeams,
            alivePlayers,
            totalTeams,
            circlePhase,
          }),
        updatedAt: new Date(finalizationStartedAt),
      });
    });

    this.logger.log(`[Match] Finish detected matchId=${matchId}`);
    this.logger.log(`[Match] Entered FINISH_PENDING matchId=${matchId}`);
    this.logLifecycleTransition(
      matchId,
      previousLifecycleStatus,
      'FINISH_PENDING',
      'OBSERVER_FINISH_DETECTED',
      {
        dbStatus: MatchStatus.FINISH_PENDING,
        finalizationStartedAt,
      },
    );

    try {
      const lifecycle = await this.confirmFinishedIfEligible(
        matchId,
        'OBSERVER_FINISH_DETECTED',
      );
      if (lifecycle.lifecycleStatus !== 'FINISHED') {
        this.queuePendingFinalizationRecovery(
          matchId,
          'OBSERVER_FINISH_DETECTED',
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[Match] Finish confirmation deferred matchId=${matchId} reason=${message}`,
      );
      this.queuePendingFinalizationRecovery(
        matchId,
        'OBSERVER_FINISH_DETECTED',
      );
    }

    return this.getLifecycleState(matchId);
  }

  async confirmFinishedIfEligible(
    matchId: string,
    source: string = 'MATCH_FINISH_ELIGIBILITY_CHECK',
  ): Promise<MatchLifecycleSnapshot> {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        id: true,
        status: true,
        controlState: {
          select: {
            metaJson: true,
          },
        },
      },
    });
    if (!match) {
      throw new NotFoundException('Match not found');
    }
    if (match.status === MatchStatus.FINISHED) {
      return this.getLifecycleState(matchId);
    }
    if (
      !isMatchFinalizingStatus(match.status) &&
      !isMatchLiveStatus(match.status)
    ) {
      return this.getLifecycleState(matchId);
    }

    const slotResultsRaw = await this.prisma.matchSlotResult.findMany({
      where: { matchId, teamId: { not: null } },
      select: {
        teamId: true,
        wasPresentInMatch: true,
        players: {
          select: {
            isAlive: true,
            alive: true,
          },
        },
      },
    });
    const slotResults = Array.isArray(slotResultsRaw) ? slotResultsRaw : [];

    if (!slotResults.length) {
      if (match.status !== MatchStatus.FINISH_PENDING) {
        return this.getLifecycleState(matchId);
      }
    } else {
      const aliveTeams = slotResults.reduce((count, slot) => {
        if (!isPresentInMatch(slot.wasPresentInMatch)) {
          return count;
        }
        const alive = (slot.players ?? []).some(
          (player) =>
            player.isAlive === true ||
            (player as { alive?: boolean | null }).alive === true,
        );
        return alive ? count + 1 : count;
      }, 0);
      if (aliveTeams <= 1) {
        await this.confirmFinished(SYSTEM_ACTOR, matchId, source);
        return this.getLifecycleState(matchId);
      }
      if (match.status !== MatchStatus.FINISH_PENDING) {
        return this.getLifecycleState(matchId);
      }
    }

    const controlMeta = this.parseMeta(match.controlState?.metaJson);
    if (this.hasValidatedFinalizationEligibility(controlMeta)) {
      await this.confirmFinished(
        SYSTEM_ACTOR,
        matchId,
        controlMeta?.finishEligibilitySource ?? source,
      );
      return this.getLifecycleState(matchId);
    }

    const liveState = await this.store.get(matchId);
    if (liveState?.initialized === true && computeAliveTeams(liveState) <= 1) {
      await this.confirmFinished(SYSTEM_ACTOR, matchId, source);
      return this.getLifecycleState(matchId);
    }

    return this.getLifecycleState(matchId);
  }

  async unlockMatch(
    actor: Actor,
    matchId: string,
    opts: {
      targetStatus?: 'READY' | 'LIVE';
      reason?: string | null;
      sessionId?: string | null;
    } = {},
  ): Promise<LiveMatchState> {
    const match = await this.loadMatch(matchId);
    this.ensurePermission(
      actor,
      match.tournament.ownerUserId,
      match.tournament.organizationId,
    );

    if (
      !isMatchLockedStatus(match.status) &&
      !isMatchFinalizingStatus(match.status)
    ) {
      throw new BadRequestException(
        'Only finalizing or finished matches can be unlocked',
      );
    }

    const targetStatus = opts.targetStatus === 'LIVE' ? 'LIVE' : 'READY';
    const reason = opts.reason ?? 'ADMIN_UNLOCK';
    const previousControlState =
      match.controlState?.state ?? this.toControlStateFromMatch(match.status);
    const now = new Date();
    const controlState = await this.prisma.matchControlState.findUnique({
      where: { matchId },
      select: { metaJson: true },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.match.update({
        where: { id: matchId },
        data: this.buildRunResetMatchData(match),
      });
      await this.writeControlStateCas(tx, {
        matchId,
        organizationId: this.requireMatchOrganizationId(match),
        state: 'READY',
        reason,
        metaJson: (currentMeta) => this.clearFinalizationMeta(currentMeta),
        updatedAt: now,
      });
    });
    await this.store.evictMatches([matchId]);
    this.logRunBoundaryReset(matchId, reason, {
      pcobSessionId: match.pcobSessionId,
      controlState,
    });

    this.logger.log(
      `[Match] Unlock applied matchId=${matchId} actor=${actor.actorId ?? actor.id ?? 'unknown'} previousStatus=${normalizeMatchLifecycleStatus(match.status) ?? match.status} newStatus=${targetStatus} at=${now.toISOString()}`,
    );

    if (targetStatus === 'LIVE') {
      const resetMatch = await this.loadMatch(matchId);
      return this.setMatchLiveInternal(
        actor,
        matchId,
        resetMatch,
        opts.sessionId ?? null,
      );
    }

    const resetMatch = await this.loadMatch(matchId);
    const readyState = await this.buildState(resetMatch);
    const saved = await this.persistAndBroadcast(matchId, readyState);
    this.gateway.emitMatchStateChanged(
      matchId,
      previousControlState,
      'READY',
      reason,
      match.tournament.organizationId,
    );
    this.emitStatus(matchId, 'UPCOMING', match.tournament.organizationId);
    void this.broadcast.emitForMatch(matchId, 'match-status');
    return saved;
  }

  private emitStatus(
    matchId: string,
    status: 'UPCOMING' | 'LIVE' | 'ENDED' | 'CANCELLED',
    organizationId: string | null | undefined,
  ) {
    this.realtime.emitMatchStatusUpdated(organizationId ?? null, {
      matchId,
      status,
      updatedAt: new Date().toISOString(),
    });
    this.resultsEvents.emitControlContractUpdated(
      matchId,
      'CONTROL_STATE_CHANGED',
    );
  }

  private async loadMatch(matchId: string): Promise<MatchSummary> {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        id: true,
        organizationId: true,
        ownerUserId: true,
        groupId: true,
        stageId: true,
        tournamentId: true,
        status: true,
        pcobSessionId: true,
        pcobMode: true,
        pcobBoundAt: true,
        pcobLastSeenAt: true,
        adapterKey: true,
        dataSource: true,
        dataMode: true,
        liveState: true,
        liveAt: true,
        startedAt: true,
        endedAt: true,
        endedReason: true,
        updatedAt: true,
        tournament: { select: { ownerUserId: true, organizationId: true } },
        controlState: {
          select: { state: true, version: true, metaJson: true },
        },
      },
    });
    if (!match) throw new NotFoundException('Match not found');
    return this.requireTournamentMatch(match) as MatchSummary;
  }

  private async rehydrateLiveStates(): Promise<void> {
    try {
      const liveMatches = await this.prisma.match.findMany({
        where: {
          deletedAt: null,
          OR: [
            { status: MatchStatus.LIVE },
            { controlState: { state: 'LIVE' } },
          ],
        },
        select: {
          id: true,
          organizationId: true,
          ownerUserId: true,
          groupId: true,
          stageId: true,
          tournamentId: true,
          status: true,
          pcobSessionId: true,
          pcobMode: true,
          pcobBoundAt: true,
          pcobLastSeenAt: true,
          adapterKey: true,
          dataSource: true,
          dataMode: true,
          liveState: true,
          liveAt: true,
          startedAt: true,
          endedAt: true,
          endedReason: true,
          updatedAt: true,
          tournament: { select: { ownerUserId: true, organizationId: true } },
          controlState: {
            select: { state: true, version: true, metaJson: true },
          },
        },
      });

      for (const match of liveMatches) {
        try {
          const summary: MatchSummary = {
            ...this.requireTournamentMatch(match),
            controlState: match.controlState ?? undefined,
          };
          const state = await this.buildState(summary);
          this.liveStateMirror.lockCanonicalRoster(match.id, state);
          const current = await this.store.get(match.id);
          const saved =
            current && this.hasActiveTelemetryMirrorOwnership(current)
              ? current
              : await this.liveStateMirror.publish(state, {
                  writer: 'match-control',
                });
          if (current && this.hasActiveTelemetryMirrorOwnership(current)) {
            this.logger.warn(
              JSON.stringify({
                tag: '[TELEMETRY][BLOCKED]',
                stage: 'match-control',
                action: 'rehydrate-runtime-overwrite-blocked',
                matchId: match.id,
                currentSourceMode: current.sourceMode ?? null,
                currentVersion: current.version,
                currentPlayers: current.teams.reduce(
                  (sum, team) => sum + (team.players?.length ?? 0),
                  0,
                ),
                canonicalPlayers: state.teams.reduce(
                  (sum, team) => sum + (team.players?.length ?? 0),
                  0,
                ),
              }),
            );
          }
          this.gateway.emitMatchState(
            match.id,
            saved,
            summary.tournament.organizationId ?? null,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`[REHYDRATE] Failed for match=${match.id}: ${msg}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[REHYDRATE] Skipped due to error: ${msg}`);
    }
  }

  async authorize(actor: Actor, matchId: string): Promise<MatchSummary> {
    const match = await this.loadMatch(matchId);
    this.ensurePermission(
      actor,
      match.tournament.ownerUserId,
      match.tournament.organizationId,
    );
    return match;
  }

  private async loadTeams(matchId: string): Promise<TeamScoreState[]> {
    const [teams, slots, stats] = await Promise.all([
      this.prisma.matchTeam.findMany({
        where: { matchId, deletedAt: null },
        select: {
          teamId: true,
          team: { select: { name: true, tag: true, logoUrl: true } },
        },
      }),
      this.prisma.matchSlot.findMany({
        where: { matchId, deletedAt: null },
        select: {
          teamId: true,
          slotNumber: true,
          team: {
            select: {
              name: true,
              tag: true,
              logoUrl: true,
              players: {
                select: {
                  id: true,
                  ign: true,
                  photoUrl: true,
                  externalPlayerId: true,
                  playerOpenId: true,
                  inGameId: true,
                  pubgPlayerId: true,
                },
                orderBy: { ign: 'asc' },
              },
            },
          },
        },
      }),
      this.prisma.matchSlotResult.findMany({
        where: { matchId },
        select: {
          teamId: true,
          wasPresentInMatch: true,
          totalKills: true,
          placement: true,
          totalPoints: true,
          slotNumber: true,
          players: {
            select: {
              id: true,
              playerId: true,
              playerName: true,
              kills: true,
              isAlive: true,
              alive: true,
              isKnocked: true,
              externalPlayerId: true,
              pubgAccountId: true,
              player: {
                select: {
                  ign: true,
                  photoUrl: true,
                  externalPlayerId: true,
                  playerOpenId: true,
                  inGameId: true,
                  pubgPlayerId: true,
                },
              },
            },
            orderBy: { playerName: 'asc' },
          },
        },
      }),
    ]);

    const matchTeamById = new Map(teams.map((team) => [team.teamId, team]));
    const statByTeamId = new Map(
      stats
        .filter((stat) => Boolean(stat.teamId))
        .map((stat) => [stat.teamId as string, stat] as const),
    );
    type LoadedSlot = (typeof slots)[number];
    type LoadedMatchTeam = (typeof teams)[number];
    type TeamSource = {
      teamId: string;
      matchTeam: LoadedMatchTeam | null;
      slot: LoadedSlot | null;
    };
    const assignedSlots = slots.filter(
      (slot): slot is LoadedSlot & { teamId: string } =>
        typeof slot.teamId === 'string' && slot.teamId.length > 0,
    );
    const teamSources: TeamSource[] =
      assignedSlots.length > 0
        ? assignedSlots.map((slot) => ({
            teamId: slot.teamId,
            matchTeam: matchTeamById.get(slot.teamId) ?? null,
            slot,
          }))
        : teams.map((team) => ({
            teamId: team.teamId,
            matchTeam: team,
            slot: slots.find((entry) => entry.teamId === team.teamId) ?? null,
          }));

    return teamSources.map(({ teamId, matchTeam, slot }) => {
      const stat = statByTeamId.get(teamId) ?? null;
      const slotPlayers = this.toLivePlayersFromSlotResult(
        teamId,
        stat?.slotNumber ?? slot?.slotNumber ?? null,
        stat?.players ?? [],
      );
      const fallbackPlayers =
        slotPlayers.length > 0
          ? slotPlayers
          : this.toLivePlayersFromSlotRoster(
              teamId,
              slot?.slotNumber ?? stat?.slotNumber ?? null,
              slot?.team?.players ?? [],
            );
      const totalPlayers =
        fallbackPlayers.length > 0 ? fallbackPlayers.length : undefined;
      const alivePlayers =
        fallbackPlayers.length > 0
          ? fallbackPlayers.filter((player) => player.alive === true).length
          : undefined;
      return {
        teamId,
        name: slot?.team?.name ?? matchTeam?.team?.name ?? null,
        tag: slot?.team?.tag ?? matchTeam?.team?.tag ?? null,
        logoUrl: normalizePublicAssetUrl(
          slot?.team?.logoUrl ?? matchTeam?.team?.logoUrl,
        ),
        wasPresentInMatch: stat?.wasPresentInMatch ?? null,
        presenceStatus: derivePresenceStatus(stat?.wasPresentInMatch ?? null),
        slot: stat?.slotNumber ?? slot?.slotNumber ?? null,
        kills: stat?.totalKills ?? 0,
        placement: stat?.placement ?? null,
        points: stat?.totalPoints ?? null,
        hasTelemetryPresence: false,
        totalPlayers,
        alivePlayers,
        alive: typeof alivePlayers === 'number' ? alivePlayers > 0 : undefined,
        eliminated:
          typeof alivePlayers === 'number' ? alivePlayers <= 0 : undefined,
        players: fallbackPlayers,
      };
    });
  }

  private toLivePlayersFromSlotResult(
    teamId: string,
    slot: number | null,
    players: Array<{
      id: string;
      playerId?: string | null;
      playerName?: string | null;
      kills?: number | null;
      isAlive?: boolean | null;
      alive?: boolean | null;
      isKnocked?: boolean | null;
      knocked?: boolean | null;
      externalPlayerId?: string | null;
      pubgAccountId?: string | null;
      player?: {
        ign?: string | null;
        photoUrl?: string | null;
        externalPlayerId?: string | null;
        playerOpenId?: string | null;
        inGameId?: string | null;
        pubgPlayerId?: string | null;
      } | null;
    }>,
  ): MatchStatePlayer[] {
    return (players ?? []).map((player) => {
      const playerKey =
        buildMatchPlayerKey({
          playerId: player.playerId ?? null,
          playerResultId: player.id,
        }) ?? player.id;
      const alive =
        ((player as { isAlive?: boolean | null }).isAlive ??
          (player as { alive?: boolean | null }).alive ??
          true) === true;
      const knocked =
        alive &&
        ((player as { isKnocked?: boolean | null }).isKnocked ??
          (player as { knocked?: boolean | null }).knocked ??
          false) === true;
      return {
        id: playerKey,
        playerId: playerKey,
        externalPlayerId:
          player.externalPlayerId ?? player.player?.externalPlayerId ?? null,
        pubgPlayerId:
          player.pubgAccountId ??
          player.player?.inGameId ??
          player.player?.pubgPlayerId ??
          null,
        name: player.playerName ?? player.player?.ign ?? playerKey,
        ign: player.playerName ?? player.player?.ign ?? playerKey,
        avatarUrl: normalizePublicAssetUrl(player.player?.photoUrl),
        teamId,
        slot,
        alive,
        knocked,
        eliminated: !alive,
        kills: Math.max(0, player.kills ?? 0),
        position: null,
      };
    });
  }

  private toLivePlayersFromSlotRoster(
    teamId: string,
    slot: number | null,
    players: Array<{
      id: string;
      ign?: string | null;
      photoUrl?: string | null;
      externalPlayerId?: string | null;
      playerOpenId?: string | null;
      inGameId?: string | null;
      pubgPlayerId?: string | null;
    }>,
  ): MatchStatePlayer[] {
    return (players ?? []).slice(0, 4).map((player) => ({
      id: player.id,
      playerId: player.id,
      externalPlayerId: player.externalPlayerId ?? player.playerOpenId ?? null,
      pubgPlayerId: player.inGameId ?? player.pubgPlayerId ?? null,
      name: player.ign ?? player.id,
      ign: player.ign ?? player.id,
      avatarUrl: normalizePublicAssetUrl(player.photoUrl),
      teamId,
      slot,
      alive: true,
      knocked: false,
      eliminated: false,
      kills: 0,
      position: null,
    }));
  }

  private countKnownAlivePlayers(team: TeamScoreState): number | null {
    if (
      typeof team.alivePlayers === 'number' &&
      Number.isFinite(team.alivePlayers)
    ) {
      return Math.max(0, Math.floor(team.alivePlayers));
    }

    if (Array.isArray(team.players) && team.players.length > 0) {
      return team.players.filter((player) => player.alive === true).length;
    }

    if (typeof team.alive === 'boolean') {
      return team.alive ? 1 : 0;
    }

    return null;
  }

  private summarizeAssignedTeams(
    teams: TeamScoreState[],
  ): LiveMatchState['summary'] {
    const slottedTeams = teams.filter(
      (team) => team.slot !== null && team.slot !== undefined,
    );
    const winnerTeam =
      slottedTeams.find((team) => team.placement === 1) ?? null;
    const aliveSignals = slottedTeams.map((team) =>
      this.countKnownAlivePlayers(team),
    );
    const hasAliveSignal = aliveSignals.some((count) => count !== null);
    const aliveTeams: number = hasAliveSignal
      ? aliveSignals.reduce<number>(
          (count, alive) => (alive !== null && alive > 0 ? count + 1 : count),
          0,
        )
      : slottedTeams.filter((team) => team.placement === null).length;
    const totalPlayers = slottedTeams.reduce(
      (sum, team) => sum + Math.max(0, team.totalPlayers ?? 0),
      0,
    );
    const alivePlayers: number = hasAliveSignal
      ? aliveSignals.reduce<number>(
          (sum, alive) => sum + Math.max(0, alive ?? 0),
          0,
        )
      : 0;

    return {
      totalTeams: slottedTeams.length,
      aliveTeams,
      totalPlayers,
      alivePlayers,
      winnerTeamId: winnerTeam?.teamId ?? null,
      winnerSlot: winnerTeam?.slot ?? null,
    };
  }

  private summarizeLiveTeams(
    teams: TeamScoreState[],
    fallback?: LiveMatchState['summary'] | null,
  ): LiveMatchState['summary'] {
    if (teams.length === 0) {
      return (
        fallback ?? {
          totalTeams: 0,
          aliveTeams: 0,
          totalPlayers: 0,
          alivePlayers: 0,
          winnerTeamId: null,
          winnerSlot: null,
        }
      );
    }

    const aliveSignals = teams.map((team) => this.countKnownAlivePlayers(team));
    const hasAliveSignal = aliveSignals.some((count) => count !== null);
    const aliveTeams: number = hasAliveSignal
      ? aliveSignals.reduce<number>(
          (count, alive) => (alive !== null && alive > 0 ? count + 1 : count),
          0,
        )
      : Math.max(0, fallback?.aliveTeams ?? 0);
    const totalPlayers = teams.reduce((sum, team) => {
      if (
        typeof team.totalPlayers === 'number' &&
        Number.isFinite(team.totalPlayers)
      ) {
        return sum + Math.max(0, Math.floor(team.totalPlayers));
      }
      return sum + Math.max(0, team.players?.length ?? 0);
    }, 0);
    const alivePlayers: number = hasAliveSignal
      ? aliveSignals.reduce<number>(
          (sum, alive) => sum + Math.max(0, alive ?? 0),
          0,
        )
      : Math.max(0, fallback?.alivePlayers ?? 0);
    const winnerTeam =
      teams.find((team) => team.placement === 1) ??
      (aliveTeams === 1
        ? (teams.find((team) => (this.countKnownAlivePlayers(team) ?? 0) > 0) ??
          null)
        : null);

    return {
      totalTeams: teams.length,
      aliveTeams,
      totalPlayers,
      alivePlayers,
      winnerTeamId: winnerTeam?.teamId ?? null,
      winnerSlot: winnerTeam?.slot ?? null,
    };
  }

  private async buildState(match: MatchSummary): Promise<LiveMatchState> {
    const teams = await this.loadTeams(match.id);
    return {
      matchId: match.id,
      status: this.toPublicControlStatus(match),
      startedAt: match.startedAt ? match.startedAt.toISOString() : null,
      endedAt: match.endedAt ? match.endedAt.toISOString() : null,
      version: 0,
      updatedAt: new Date().toISOString(),
      summary: this.summarizeAssignedTeams(teams),
      teams,
    };
  }

  private isLiveControlStatus(
    status: MatchStatus,
    controlState?: PersistedControlState | null,
  ): boolean {
    return status === MatchStatus.LIVE || controlState === 'LIVE';
  }

  private cachedStateHasTelemetrySignal(state: LiveMatchState | null): boolean {
    if (!state) {
      return false;
    }

    if (state.circle || state.observedPlayer) {
      return true;
    }

    if ((state.killFeed?.length ?? 0) > 0 || (state.events?.length ?? 0) > 0) {
      return true;
    }

    return state.teams.some((team) => {
      if (team.hasTelemetryPresence === true) {
        return true;
      }
      return (team.players ?? []).some((player) => {
        if (player.lifeTelemetryFresh === true) {
          return true;
        }
        return Boolean(player.position);
      });
    });
  }

  private hasActiveTelemetryMirrorOwnership(
    state: LiveMatchState | null | undefined,
  ): boolean {
    return Boolean(
      state &&
      state.status === 'LIVE' &&
      (isAutomaticMatchStateSourceMode(state.sourceMode) ||
        this.cachedStateHasTelemetrySignal(state)),
    );
  }

  private mergeLiveTelemetryTeamMetadata(
    existing: TeamScoreState,
    fresh: TeamScoreState | null,
  ): TeamScoreState {
    if (!fresh) {
      return existing;
    }

    return {
      ...existing,
      name: fresh.name ?? existing.name,
      tag: fresh.tag ?? existing.tag,
      slot: fresh.slot ?? existing.slot,
      logoUrl: fresh.logoUrl ?? existing.logoUrl,
      wasPresentInMatch:
        existing.wasPresentInMatch ?? fresh.wasPresentInMatch ?? null,
      presenceStatus: existing.presenceStatus ?? fresh.presenceStatus ?? null,
      updatedAt: existing.updatedAt ?? fresh.updatedAt ?? null,
    };
  }

  private persistedTelemetryHasSignal(snapshot: TelemetryMatchState): boolean {
    if (
      typeof snapshot.telemetryAcceptedAt === 'number' &&
      Number.isFinite(snapshot.telemetryAcceptedAt)
    ) {
      return true;
    }

    if (snapshot.teamsAlive > 0) {
      return true;
    }

    if (
      (snapshot.events?.length ?? 0) > 0 ||
      (snapshot.killFeed?.length ?? 0) > 0
    ) {
      return true;
    }

    if (
      snapshot.circle?.phase !== null &&
      snapshot.circle?.phase !== undefined
    ) {
      return true;
    }
    return false;
  }

  private telemetrySnapshotPlayerAliases(
    player: TelemetryMatchState['players'][string],
  ): string[] {
    const aliases = [
      player.metadata?.slotPlayerResultId,
      player.metadata?.externalPlayerId,
      player.metadata?.inGameId,
      player.metadata?.playerName,
    ]
      .map((value) =>
        typeof value === 'string' ? value.trim().toLowerCase() : '',
      )
      .filter((value) => value.length > 0);
    return Array.from(new Set(aliases));
  }

  private dedupeTelemetrySnapshotPlayers(
    players: Array<TelemetryMatchState['players'][string]>,
  ): Array<TelemetryMatchState['players'][string]> {
    const canonical = new Map<string, TelemetryMatchState['players'][string]>();
    const aliasesToCanonical = new Map<string, string>();

    const sorted = [...players].sort((left, right) => {
      const leftScore =
        (typeof left.metadata?.slotPlayerResultId === 'string' &&
        left.metadata.slotPlayerResultId.trim().length > 0
          ? 0
          : 10) +
        (left.metadata?.observedInTelemetry === true ? 0 : 5) +
        (left.metadata?.provisional === true ? 5 : 0);
      const rightScore =
        (typeof right.metadata?.slotPlayerResultId === 'string' &&
        right.metadata.slotPlayerResultId.trim().length > 0
          ? 0
          : 10) +
        (right.metadata?.observedInTelemetry === true ? 0 : 5) +
        (right.metadata?.provisional === true ? 5 : 0);
      if (leftScore !== rightScore) {
        return leftScore - rightScore;
      }
      return left.playerId.localeCompare(right.playerId);
    });

    for (const player of sorted) {
      const aliases = this.telemetrySnapshotPlayerAliases(player);
      const canonicalKey =
        aliases.map((alias) => aliasesToCanonical.get(alias)).find(Boolean) ??
        player.playerId;
      const existing = canonical.get(canonicalKey);
      if (!existing) {
        canonical.set(canonicalKey, player);
        for (const alias of aliases) {
          aliasesToCanonical.set(alias, canonicalKey);
        }
        continue;
      }

      const preferredLifeSource =
        player.metadata?.observedInTelemetry === true &&
        existing.metadata?.observedInTelemetry !== true
          ? player
          : existing;
      const merged = {
        ...existing,
        alive: preferredLifeSource.alive,
        knocked: preferredLifeSource.knocked,
        kills: Math.max(existing.kills, player.kills),
        metadata: {
          ...(player.metadata ?? {}),
          ...(existing.metadata ?? {}),
          playerName:
            existing.metadata?.playerName ??
            player.metadata?.playerName ??
            existing.playerId,
          slotPlayerResultId:
            existing.metadata?.slotPlayerResultId ??
            player.metadata?.slotPlayerResultId ??
            null,
          externalPlayerId:
            existing.metadata?.externalPlayerId ??
            player.metadata?.externalPlayerId ??
            null,
          inGameId:
            existing.metadata?.inGameId ?? player.metadata?.inGameId ?? null,
          position:
            existing.metadata?.position ?? player.metadata?.position ?? null,
          observedInTelemetry:
            existing.metadata?.observedInTelemetry === true ||
            player.metadata?.observedInTelemetry === true,
          provisional:
            existing.metadata?.provisional === true &&
            player.metadata?.provisional === true,
        },
      };
      canonical.set(canonicalKey, merged);
      for (const alias of aliases) {
        aliasesToCanonical.set(alias, canonicalKey);
      }
    }

    return Array.from(canonical.values()).sort((left, right) =>
      left.playerId.localeCompare(right.playerId),
    );
  }

  private playersForTelemetryTeam(
    snapshot: TelemetryMatchState,
    teamId: string,
  ) {
    return this.dedupeTelemetrySnapshotPlayers(
      Object.values(snapshot.players ?? {}).filter(
        (player) => player.teamId === teamId,
      ),
    );
  }

  private sortTelemetryTeams(
    left: TelemetryTeamState,
    right: TelemetryTeamState,
  ) {
    if (left.alivePlayers > 0 && right.alivePlayers === 0) return -1;
    if (left.alivePlayers === 0 && right.alivePlayers > 0) return 1;
    const leftPlacement = left.placement ?? Number.MAX_SAFE_INTEGER;
    const rightPlacement = right.placement ?? Number.MAX_SAFE_INTEGER;
    if (leftPlacement !== rightPlacement) {
      return leftPlacement - rightPlacement;
    }
    if (right.totalKills !== left.totalKills) {
      return right.totalKills - left.totalKills;
    }
    return (
      (left.metadata?.slot ?? Number.MAX_SAFE_INTEGER) -
      (right.metadata?.slot ?? Number.MAX_SAFE_INTEGER)
    );
  }

  private toControlStateFromTelemetryStatus(
    status: TelemetryMatchState['status'],
  ): ControlState {
    if (status === 'LIVE') return 'LIVE';
    if (status === 'LOCKED') return 'FINISHED';
    if (status === 'ENDED') return 'FINISH_PENDING';
    return 'READY';
  }

  private toMatchStateEventType(event: TelemetryStateEvent) {
    switch (event.type) {
      case 'PLAYER_ALIVE_CHANGED':
        return event.payload?.alive === false ? 'PLAYER_DIED' : 'PLAYER_SEEN';
      case 'PLAYER_KNOCKED_CHANGED':
        return event.payload?.knocked === true
          ? 'PLAYER_KNOCKED'
          : 'PLAYER_REVIVED';
      default:
        return event.type;
    }
  }

  private toLiveStateFromTelemetrySnapshot(
    snapshot: TelemetryMatchState,
  ): LiveMatchState {
    const phase =
      typeof snapshot.circle?.phase === 'number' &&
      Number.isFinite(snapshot.circle.phase)
        ? Math.trunc(snapshot.circle.phase)
        : null;
    const earlyTelemetryPhase = phase !== null && phase < 2;
    const computedTeamInputs = Object.values(snapshot.teams ?? {})
      .sort((left, right) => this.sortTelemetryTeams(left, right))
      .map((team) => ({
        team,
        freshTelemetry: this.readFreshSnapshotTeamTelemetry(
          team,
          snapshot.updatedAt,
        ),
        teamPlayers: this.playersForTelemetryTeam(snapshot, team.teamId),
      }));
    const hasFreshTelemetryTeams = computedTeamInputs.some(
      (entry) => entry.freshTelemetry !== null,
    );

    const computedTeams = computedTeamInputs.map(
      ({ team, freshTelemetry, teamPlayers }) => {
        const suppressStaleCanonicalRoster =
          earlyTelemetryPhase &&
          hasFreshTelemetryTeams &&
          freshTelemetry === null;
        const observedAlivePlayers = teamPlayers.filter(
          (player) => player.alive === true,
        ).length;
        const canonicalTotalPlayers =
          typeof team.metadata?.totalPlayers === 'number' &&
          Number.isFinite(team.metadata.totalPlayers)
            ? Math.max(0, Math.trunc(team.metadata.totalPlayers))
            : null;
        const explicitTelemetryTotalPlayers =
          typeof team.totalPlayers === 'number' &&
          Number.isFinite(team.totalPlayers)
            ? Math.max(0, Math.trunc(team.totalPlayers))
            : null;
        const explicitAlivePlayers =
          typeof team.alivePlayers === 'number' &&
          Number.isFinite(team.alivePlayers)
            ? Math.max(0, Math.trunc(team.alivePlayers))
            : null;
        const totalPlayers = suppressStaleCanonicalRoster
          ? 0
          : (freshTelemetry?.totalPlayers ??
            (canonicalTotalPlayers !== null
              ? Math.max(teamPlayers.length, canonicalTotalPlayers)
              : Math.max(
                  teamPlayers.length,
                  explicitTelemetryTotalPlayers ?? 0,
                )));
        const alivePlayers = Math.min(
          totalPlayers,
          suppressStaleCanonicalRoster
            ? 0
            : Math.max(
                observedAlivePlayers,
                freshTelemetry?.alivePlayers ?? explicitAlivePlayers ?? 0,
              ),
        );
        const playerKills = teamPlayers.reduce(
          (sum, player) => sum + Math.max(0, player.kills ?? 0),
          0,
        );
        return {
          freshTelemetry,
          team: {
            teamId: team.teamId,
            name: team.metadata?.teamName ?? null,
            tag: team.metadata?.teamTag ?? null,
            slot: team.metadata?.slot ?? null,
            wasPresentInMatch: team.metadata?.wasPresentInMatch ?? null,
            presenceStatus: derivePresenceStatus(
              team.metadata?.wasPresentInMatch ?? null,
            ),
            kills: Math.max(
              suppressStaleCanonicalRoster ? 0 : (freshTelemetry?.kills ?? 0),
              suppressStaleCanonicalRoster ? 0 : team.totalKills,
              suppressStaleCanonicalRoster ? 0 : playerKills,
            ),
            placement: suppressStaleCanonicalRoster
              ? null
              : (freshTelemetry?.placement ?? team.placement),
            points: null,
            logoUrl: normalizePublicAssetUrl(team.metadata?.logoUrl),
            alivePlayers,
            totalPlayers,
            alive: alivePlayers > 0,
            eliminated: alivePlayers === 0,
            hasTelemetryPresence:
              freshTelemetry !== null ||
              team.metadata?.observedInTelemetry === true ||
              team.metadata?.wasPresentInMatch === true ||
              teamPlayers.some(
                (player) => player.metadata?.observedInTelemetry === true,
              ),
            sourceMode: snapshot.mode,
            updatedAt: new Date(snapshot.updatedAt).toISOString(),
            ownership: team.ownership,
            players: suppressStaleCanonicalRoster
              ? []
              : teamPlayers.map((player) => ({
                  id: player.playerId,
                  playerId: player.playerId,
                  externalPlayerId: player.metadata?.externalPlayerId ?? null,
                  pubgPlayerId: player.metadata?.inGameId ?? null,
                  name: player.metadata?.playerName ?? player.playerId,
                  ign: player.metadata?.playerName ?? player.playerId,
                  avatarUrl: normalizePublicAssetUrl(
                    player.metadata?.avatarUrl,
                  ),
                  teamId: player.teamId,
                  slot: team.metadata?.slot ?? null,
                  alive: player.alive,
                  knocked: player.knocked,
                  eliminated: !player.alive,
                  health: player.health ?? null,
                  kills: player.kills,
                  position: player.metadata?.position ?? null,
                  updatedAt: new Date(snapshot.updatedAt).toISOString(),
                  lifeTelemetryFresh:
                    player.metadata?.observedInTelemetry === true,
                  ownership: player.ownership,
                })),
          },
        };
      },
    );

    const teams = computedTeams.map((entry) => entry.team);
    const freshTelemetryTeams = computedTeams
      .filter((entry) => entry.freshTelemetry !== null)
      .map((entry) => entry.team);
    const summarySourceTeams =
      freshTelemetryTeams.length > 0 ? freshTelemetryTeams : teams;
    const winnerTeam =
      summarySourceTeams.find((team) => team.placement === 1) ?? null;
    const totalPlayers = summarySourceTeams.reduce(
      (sum, team) => sum + (team.totalPlayers ?? team.players?.length ?? 0),
      0,
    );
    const alivePlayers = summarySourceTeams.reduce(
      (sum, team) => sum + (team.alivePlayers ?? 0),
      0,
    );
    const aliveTeams = summarySourceTeams.reduce(
      (sum, team) =>
        team.alivePlayers && team.alivePlayers > 0 ? sum + 1 : sum,
      0,
    );

    return {
      matchId: snapshot.matchId,
      status: this.toControlStateFromTelemetryStatus(snapshot.status),
      startedAt: snapshot.startedAt
        ? new Date(snapshot.startedAt).toISOString()
        : null,
      endedAt: snapshot.endedAt
        ? new Date(snapshot.endedAt).toISOString()
        : null,
      version: snapshot.version,
      updatedAt: new Date(snapshot.updatedAt).toISOString(),
      sourceMode: snapshot.mode,
      summary: {
        totalTeams: summarySourceTeams.length,
        aliveTeams,
        totalPlayers,
        alivePlayers,
        winnerTeamId: winnerTeam?.teamId ?? null,
        winnerSlot: winnerTeam?.slot ?? null,
      },
      teams,
      killFeed: (snapshot.killFeed ?? []).map((item) => ({
        id: item.id,
        type: 'PLAYER_KILL' as const,
        ts: item.ts,
        killerTeamId: item.killerTeamId ?? null,
        killerPlayerId: item.killerPlayerId ?? null,
        killerName: item.killerName ?? null,
        victimTeamId: item.victimTeamId ?? null,
        victimPlayerId: item.victimPlayerId ?? null,
        victimName: item.victimName ?? null,
        delta: item.delta,
        totalKills: item.totalKills ?? null,
        weapon: item.weapon ?? null,
      })),
      events: (snapshot.events ?? []).map((item) => ({
        id: item.id,
        type: this.toMatchStateEventType(item),
        ts: item.ts,
        teamId: item.teamId ?? null,
        playerId: item.playerId ?? null,
        payload: item.payload ?? null,
      })),
      observedPlayer: null,
      circle: snapshot.circle
        ? {
            phase: snapshot.circle.phase ?? null,
            nextShrinkAt: snapshot.circle.nextShrinkAt ?? null,
            safeZone: snapshot.circle.safeZone ?? null,
            nextZone: snapshot.circle.nextZone ?? null,
          }
        : null,
    };
  }

  private readFreshSnapshotTeamTelemetry(
    team: TelemetryTeamState,
    updatedAt: number,
  ): {
    alivePlayers: number | null;
    totalPlayers: number | null;
    kills: number | null;
    placement: number | null;
  } | null {
    const lastSeenAt =
      typeof team.metadata?.telemetryLastSeenAt === 'number' &&
      Number.isFinite(team.metadata.telemetryLastSeenAt)
        ? Math.trunc(team.metadata.telemetryLastSeenAt)
        : null;
    if (lastSeenAt === null || lastSeenAt !== Math.trunc(updatedAt)) {
      return null;
    }

    const alivePlayers =
      typeof team.metadata?.telemetryAlivePlayers === 'number' &&
      Number.isFinite(team.metadata.telemetryAlivePlayers)
        ? Math.max(0, Math.trunc(team.metadata.telemetryAlivePlayers))
        : null;
    const totalPlayers =
      typeof team.metadata?.telemetryTotalPlayers === 'number' &&
      Number.isFinite(team.metadata.telemetryTotalPlayers)
        ? Math.max(
            alivePlayers ?? 0,
            Math.trunc(team.metadata.telemetryTotalPlayers),
          )
        : alivePlayers;
    const kills =
      typeof team.metadata?.telemetryKills === 'number' &&
      Number.isFinite(team.metadata.telemetryKills)
        ? Math.max(0, Math.trunc(team.metadata.telemetryKills))
        : null;
    const placement =
      typeof team.metadata?.telemetryPlacement === 'number' &&
      Number.isFinite(team.metadata.telemetryPlacement)
        ? Math.max(1, Math.trunc(team.metadata.telemetryPlacement))
        : null;

    return {
      alivePlayers,
      totalPlayers,
      kills,
      placement,
    };
  }

  private async hydrateMirrorFromPersistedTelemetry(
    matchId: string,
  ): Promise<LiveMatchState | null> {
    const persisted = await this.prisma.match.findFirst({
      where: {
        id: matchId,
        deletedAt: null,
      },
      select: {
        status: true,
        controlState: {
          select: {
            state: true,
            metaJson: true,
          },
        },
        stateSnapshot: {
          select: {
            stateJson: true,
          },
        },
      },
    });

    if (!persisted) {
      return null;
    }
    const snapshot = asTelemetrySnapshot(persisted?.stateSnapshot?.stateJson);
    if (!snapshot || !this.persistedTelemetryHasSignal(snapshot)) {
      return null;
    }
    if (
      this.isLiveControlStatus(
        persisted.status,
        persisted.controlState?.state ?? null,
      ) &&
      (snapshot.status === 'ENDED' || snapshot.status === 'LOCKED')
    ) {
      this.logger.warn(
        JSON.stringify({
          stage: 'match-control',
          action: 'telemetry-mirror-hydration-skipped',
          reason: 'STALE_ENDED_SNAPSHOT',
          matchId,
          snapshotStatus: snapshot.status,
          snapshotUpdatedAt: snapshot.updatedAt,
        }),
      );
      return null;
    }
    if (
      !this.hasPersistedTelemetryFreshness(
        persisted.controlState?.metaJson ?? null,
        snapshot,
      )
    ) {
      this.logger.warn(
        JSON.stringify({
          stage: 'match-control',
          action: 'telemetry-mirror-hydration-skipped',
          reason: 'MISSING_FRESHNESS_PROOF',
          matchId,
          snapshotStatus: snapshot.status,
          snapshotUpdatedAt: snapshot.updatedAt,
          snapshotAcceptedAt: snapshot.telemetryAcceptedAt ?? null,
        }),
      );
      return null;
    }

    return this.toLiveStateFromTelemetrySnapshot(snapshot);
  }

  private resolveAliveTeamsFromSnapshot(
    snapshot: LiveMatchState | null,
  ): number | null {
    const summaryAliveTeams = snapshot?.summary?.aliveTeams;
    if (
      typeof summaryAliveTeams === 'number' &&
      Number.isFinite(summaryAliveTeams)
    ) {
      return Math.max(0, Math.floor(summaryAliveTeams));
    }

    if (!Array.isArray(snapshot?.teams) || snapshot.teams.length === 0) {
      return null;
    }

    let hasAliveSignal = false;
    let aliveTeams = 0;
    for (const team of snapshot.teams) {
      if (
        typeof team.alivePlayers === 'number' &&
        Number.isFinite(team.alivePlayers)
      ) {
        hasAliveSignal = true;
        if (team.alivePlayers > 0) {
          aliveTeams += 1;
        }
        continue;
      }

      if (Array.isArray(team.players) && team.players.length > 0) {
        hasAliveSignal = true;
        if (team.players.some((player) => player.alive === true)) {
          aliveTeams += 1;
        }
        continue;
      }

      if (typeof team.alive === 'boolean') {
        hasAliveSignal = true;
        if (team.alive) {
          aliveTeams += 1;
        }
      }
    }

    return hasAliveSignal ? aliveTeams : null;
  }

  private async countAliveTeamsFromSlots(
    tx: Prisma.TransactionClient,
    matchId: string,
  ): Promise<number | null> {
    const slotResults = await tx.matchSlotResult.findMany({
      where: {
        matchId,
        teamId: { not: null },
      },
      select: {
        wasPresentInMatch: true,
        players: {
          select: {
            isAlive: true,
            alive: true,
          },
        },
      },
    });

    if (!slotResults.length) {
      return null;
    }

    return slotResults.reduce((count, slot) => {
      if (!isPresentInMatch(slot.wasPresentInMatch)) {
        return count;
      }
      const alive = (slot.players ?? []).some(
        (player) =>
          player.isAlive === true ||
          (player as { alive?: boolean | null }).alive === true,
      );
      return alive ? count + 1 : count;
    }, 0);
  }

  private async resolveLiveConflictAliveTeams(
    tx: Prisma.TransactionClient,
    matchId: string,
  ): Promise<number | null> {
    const snapshot = await this.store.get(matchId).catch(() => null);
    const snapshotAliveTeams = this.resolveAliveTeamsFromSnapshot(snapshot);
    if (snapshotAliveTeams !== null) {
      return snapshotAliveTeams;
    }

    return this.countAliveTeamsFromSlots(tx, matchId);
  }

  private async partitionLiveScopeConflicts(
    tx: Prisma.TransactionClient,
    candidates: LiveConflictCandidate[],
  ): Promise<{
    blocking: Array<{ id: string; aliveTeams: number | null }>;
    ignored: Array<{ id: string; aliveTeams: 0 }>;
  }> {
    const blocking: Array<{ id: string; aliveTeams: number | null }> = [];
    const ignored: Array<{ id: string; aliveTeams: 0 }> = [];

    for (const candidate of candidates) {
      const aliveTeams = await this.resolveLiveConflictAliveTeams(
        tx,
        candidate.id,
      );
      if (aliveTeams === 0) {
        ignored.push({ id: candidate.id, aliveTeams: 0 });
        continue;
      }
      blocking.push({ id: candidate.id, aliveTeams });
    }

    return { blocking, ignored };
  }

  private async autoEndOtherLiveMatchesInScope(
    tx: Prisma.TransactionClient,
    startingMatch: MatchSummary,
    candidates: LiveConflictCandidate[],
    endedAt: Date,
  ): Promise<Array<{ id: string; aliveTeams: number | null }>> {
    const { blocking, ignored } = await this.partitionLiveScopeConflicts(
      tx,
      candidates,
    );
    const conflicts = [...blocking, ...ignored];
    if (!conflicts.length) {
      return [];
    }
    const endedConflicts: Array<{ id: string; aliveTeams: number | null }> = [];

    this.logger.warn(
      JSON.stringify({
        stage: 'match-control',
        action: 'live-start-conflicts-auto-ended',
        matchId: startingMatch.id,
        conflicts,
        reason: 'AUTO_ENDED_BY_NEW_LIVE_MATCH',
      }),
    );

    for (const conflict of conflicts) {
      const current = await tx.match.findFirst({
        where: {
          id: conflict.id,
          deletedAt: null,
        },
        select: {
          id: true,
          status: true,
          organizationId: true,
          tournament: { select: { organizationId: true } },
          controlState: {
            select: {
              version: true,
            },
          },
        },
      });
      if (!current) {
        continue;
      }

      const ended = await tx.match.updateMany({
        where: {
          id: conflict.id,
          deletedAt: null,
          OR: [
            { status: MatchStatus.LIVE },
            { controlState: { state: 'LIVE' } },
          ],
        },
        data: {
          status: MatchStatus.ENDED,
          liveState: LiveState.ENDED,
          endedAt,
          endedReason: 'AUTO_ENDED_BY_NEW_LIVE_MATCH',
        },
      });
      if (ended.count !== 1) {
        continue;
      }

      await this.writeControlStateCas(tx, {
        matchId: conflict.id,
        organizationId:
          current.organizationId ??
          current.tournament?.organizationId ??
          this.requireMatchOrganizationId(startingMatch),
        state: 'ENDED',
        reason: 'AUTO_ENDED_BY_NEW_LIVE_MATCH',
        expectedVersion: current.controlState?.version ?? null,
        updatedAt: endedAt,
      });
      endedConflicts.push(conflict);
    }

    return endedConflicts;
  }

  private async persistAndBroadcast(
    matchId: string,
    state: LiveMatchState,
    expectedVersion?: number,
  ): Promise<LiveMatchState> {
    const publishableState =
      expectedVersion !== undefined
        ? { ...state, version: expectedVersion + 1 }
        : state;
    const saved = await this.liveStateMirror.publish(publishableState, {
      writer: 'match-control',
    });
    const orgId =
      ((state as unknown as { tournament?: { organizationId?: string | null } })
        ?.tournament?.organizationId as string | undefined) ?? null;
    this.gateway.emitMatchState(matchId, saved, orgId);
    void this.scoreboard.broadcast(matchId);
    return saved;
  }

  private async ensureFinishPendingForFinalization(
    match: MatchSummary,
    reason: string,
    expectedVersion?: number | null,
  ): Promise<number | null> {
    if (match.status === MatchStatus.FINISH_PENDING) {
      return null;
    }
    if (match.status === MatchStatus.FINISHED) {
      return null;
    }
    if (match.status !== MatchStatus.ENDED) {
      throw new BadRequestException(
        'Match must be ENDED or FINISH_PENDING before final confirmation',
      );
    }

    const now = new Date();
    const finalizationStartedAt = now.toISOString();
    const persistedPendingControlState =
      await this.resolvePersistedControlState('FINISH_PENDING');
    let nextVersion: number | null = null;
    await this.prisma.$transaction(async (tx) => {
      const promoted = await tx.match.updateMany({
        where: {
          id: match.id,
          deletedAt: null,
          status: MatchStatus.ENDED,
        },
        data: {
          status: MatchStatus.FINISH_PENDING,
          liveState: LiveState.ENDED,
          endedAt: match.endedAt ?? now,
          endedReason: match.endedReason ?? reason,
        },
      });

      if (promoted.count !== 1) {
        const current = await tx.match.findUnique({
          where: { id: match.id },
          select: { status: true },
        });
        if (
          current?.status === MatchStatus.FINISH_PENDING ||
          current?.status === MatchStatus.FINISHED
        ) {
          return;
        }
        throw new ConflictException('Match finalization state changed');
      }

      const writtenControl = await this.writeControlStateCas(tx, {
        matchId: match.id,
        organizationId: this.requireMatchOrganizationId(match),
        state: persistedPendingControlState,
        reason,
        metaJson: (currentMeta) => {
          const existingStartedAt = this.normalizeTimestamp(
            this.parseMeta(currentMeta)?.finalizationStartedAt ?? null,
          );
          return this.buildFinalizationEligibilityMeta(currentMeta, {
            finalizationStartedAt: existingStartedAt ?? finalizationStartedAt,
            source: reason,
          });
        },
        updatedAt: now,
        expectedVersion,
      });
      nextVersion = writtenControl.version;
    });
    return nextVersion;
  }

  async confirmFinished(
    actor: Actor,
    matchId: string,
    reason: string = 'CONFIRM_MATCH_FINISHED',
    opts: { expectedVersion?: number | null } = {},
  ): Promise<MatchLifecycleSnapshot> {
    const match = await this.loadMatch(matchId);
    this.ensurePermission(
      actor,
      match.tournament.ownerUserId,
      match.tournament.organizationId,
    );

    if (match.status === MatchStatus.FINISHED) {
      return this.getLifecycleState(matchId);
    }

    const promotedVersion = await this.ensureFinishPendingForFinalization(
      match,
      reason,
      opts.expectedVersion ?? null,
    );
    const expectedVersion =
      promotedVersion ??
      opts.expectedVersion ??
      (await this.resolveFinalizationVersion(matchId));
    const finalized = await this.finalizeMatch(
      matchId,
      expectedVersion,
      reason,
    );
    if (!finalized) {
      throw new ConflictException('Match finalization could not be completed');
    }
    this.logger.log(`[Match] Match confirmed FINISHED matchId=${matchId}`);
    return this.getLifecycleState(matchId);
  }

  private async finalizePendingMatch(
    matchId: string,
    reason: string = 'FINAL_RECALC',
  ): Promise<boolean> {
    const expectedVersion = await this.resolveFinalizationVersion(matchId);
    return this.finalizeMatch(matchId, expectedVersion, reason);
  }

  private async resolveFinalizationVersion(matchId: string): Promise<number> {
    const control = await this.prisma.matchControlState.findUnique({
      where: { matchId },
      select: { version: true },
    });
    if (!control) {
      throw new ConflictException('Control state is required for finalization');
    }
    return control.version;
  }

  async finalizeMatch(
    matchId: string,
    expectedVersion: number,
    reason: string = 'FINAL_RECALC',
  ): Promise<boolean> {
    this.logger.log(
      `[FINALIZATION][START] matchId=${matchId} expectedVersion=${expectedVersion}`,
    );

    const initial = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        id: true,
        status: true,
        controlState: { select: { metaJson: true } },
      },
    });
    if (!initial) {
      throw new NotFoundException('Match not found');
    }
    if (initial.status === MatchStatus.FINISHED) {
      this.logger.log(`[FINALIZATION][SUCCESS] matchId=${matchId} noop=true`);
      return true;
    }

    let computedResults: ComputedFinalResults | null = null;
    const finalizationOutcome: { plan: MatchConclusionPlan | null } = {
      plan: null,
    };
    let wroteResults = false;

    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.match.findFirst({
          where: { id: matchId, deletedAt: null },
          select: {
            id: true,
            status: true,
            endedAt: true,
            endedReason: true,
            organizationId: true,
            organization: {
              select: {
                slug: true,
              },
            },
            tournament: { select: { organizationId: true } },
            controlState: {
              select: {
                state: true,
                version: true,
                metaJson: true,
              },
            },
          },
        });
        if (!current) {
          throw new NotFoundException('Match not found');
        }
        if (current.status === MatchStatus.FINISHED) {
          throw new ConflictException('Match finalization state changed');
        }
        if (current.status !== MatchStatus.FINISH_PENDING) {
          throw new Error('Invalid state for finalization');
        }

        const control = await tx.matchControlState.findUnique({
          where: { matchId },
          select: {
            version: true,
            metaJson: true,
          },
        });
        if (!control || control.version !== expectedVersion) {
          throw new ConflictException('Control state version mismatch');
        }

        const currentMeta = this.parseMeta(current.controlState?.metaJson);
        const finalResultsAlreadyApplied =
          currentMeta?.resultFinalized === true ||
          (await this.hasFinalResultsApplied(tx, matchId));

        let finalizedAt = new Date();
        let endedAt = current.endedAt ?? finalizedAt;
        let endedReason = current.endedReason ?? reason;
        let nextMeta = this.parseMetaRecord(current.controlState?.metaJson);
        const postMatchWidgets = this.buildSavedPostMatchWidgets(
          current.organization?.slug ?? null,
          matchId,
        );

        if (!finalResultsAlreadyApplied) {
          const winnerTeamId = await this.resolveFinalizationWinnerTeamId(
            matchId,
            tx,
          );
          this.logger.log(`[FINALIZATION][COMPUTE] matchId=${matchId}`);
          computedResults = await this.conclusion.computeFinalResults(
            matchId,
            {
              source: reason,
              winnerTeamId,
            },
            tx,
          );
          finalizationOutcome.plan = computedResults.plan;
          finalizedAt = new Date(computedResults.plan.finalizedAt);
          endedAt = current.endedAt ?? computedResults.plan.endedAt;
          endedReason = current.endedReason ?? computedResults.plan.endedReason;
          this.logger.log(`[FINALIZATION][WRITE] matchId=${matchId}`);
          const slotResultIds = await this.writeFinalTeamResults(
            tx,
            matchId,
            computedResults.teamResults,
          );
          await this.writeFinalPlayerResults(
            tx,
            computedResults.playerResults,
            slotResultIds,
          );
          await this.writeFinalStandings(
            tx,
            matchId,
            computedResults.standings,
          );
          nextMeta = {
            ...nextMeta,
            ...computedResults.plan.nextMeta,
            postMatchWidgets,
          };
          wroteResults = true;
        } else {
          const finalizedAtValue =
            typeof nextMeta.finalizedAt === 'string'
              ? Date.parse(nextMeta.finalizedAt)
              : NaN;
          finalizedAt = Number.isFinite(finalizedAtValue)
            ? new Date(finalizedAtValue)
            : finalizedAt;
          nextMeta = {
            ...nextMeta,
            resultFinalized: true,
            finalizedAt: finalizedAt.toISOString(),
            postMatchWidgets,
          };
        }

        await tx.match.update({
          where: { id: matchId },
          data: {
            status: MatchStatus.FINISHED,
            liveState: LiveState.ENDED,
            endedAt,
            endedReason,
          },
        });

        await this.writeControlStateCas(tx, {
          matchId,
          organizationId:
            current.organizationId ??
            current.tournament?.organizationId ??
            computedResults?.plan.organizationId ??
            '',
          state: 'ENDED',
          reason,
          metaJson: nextMeta as Prisma.JsonObject,
          expectedVersion,
          updatedAt: finalizedAt,
        });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[FINALIZATION][ERROR] matchId=${matchId} error=${msg}`,
      );
      throw err;
    }

    await this.syncLiveHierarchyAfterFinalization(matchId);

    const plan = finalizationOutcome.plan;
    if (plan) {
      this.logger.log(
        JSON.stringify({
          action: 'match-finalization-applied',
          matchId,
          previousLifecycleStatus: 'FINISH_PENDING',
          nextLifecycleStatus: 'FINISHED',
          resultFinalized: true,
          resultNeedsConfirmation: plan.resultNeedsConfirmation,
          ambiguityCount: plan.resultAmbiguities.length,
          totalTeams: plan.totalTeams,
          placementsAssigned: plan.placementsAssigned,
        }),
      );
      if (plan.resultAmbiguities.length > 0) {
        this.logger.warn(
          JSON.stringify({
            action: 'match-conclusion-ambiguity',
            matchId,
            ambiguityCount: plan.resultAmbiguities.length,
            ambiguities: plan.resultAmbiguities,
          }),
        );
      }

      await this.publishFinalizationSideEffects(plan, reason);
      this.resultsEvents.emitMatchUpdate(matchId, { reason: 'final' });
    } else if (wroteResults === false) {
      await this.captureFinalizationSnapshots(matchId).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `[MATCH_CONCLUSION] Snapshot refresh skipped for already-finalized match=${matchId}: ${msg}`,
        );
      });
    }

    this.logger.log(`[FINALIZATION][SUCCESS] matchId=${matchId}`);
    this.resultsEvents.emitControlContractUpdated(
      matchId,
      'CONTROL_STATE_CHANGED',
    );
    return true;
  }

  private async syncLiveHierarchyAfterFinalization(
    matchId: string,
  ): Promise<void> {
    try {
      const match = await this.prisma.match.findFirst({
        where: { id: matchId, deletedAt: null },
        select: {
          id: true,
          groupId: true,
          stageId: true,
          tournamentId: true,
        },
      });

      if (!match?.tournamentId) {
        return;
      }

      const updates: LiveStateUpdatePayload[] = [
        { entity: 'MATCH', id: matchId, liveState: LiveState.ENDED },
      ];
      const hierarchy = await this.matchesService.syncLiveHierarchy({
        matchId,
        groupId: match.groupId ?? null,
        stageId: match.stageId ?? null,
        tournamentId: match.tournamentId,
      });
      updates.push(...hierarchy);
      this.gateway.emitLiveStateUpdates(updates);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `[FINALIZATION] Live hierarchy sync failed for match=${matchId}: ${message}`,
      );
    }
  }

  private async hasFinalResultsApplied(
    tx: Prisma.TransactionClient,
    matchId: string,
  ): Promise<boolean> {
    const finalizedSlot = await tx.matchSlotResult.findFirst({
      where: {
        matchId,
        finalizedAt: { not: null },
      },
      select: { id: true },
    });
    return Boolean(finalizedSlot);
  }

  private async writeFinalTeamResults(
    tx: Prisma.TransactionClient,
    matchId: string,
    teamResults: ComputedFinalTeamResult[],
  ): Promise<Map<number, string>> {
    const activeSlotNumbers = teamResults.map((result) => result.slotNumber);
    const staleSlotResults = await tx.matchSlotResult.findMany({
      where:
        activeSlotNumbers.length > 0
          ? { matchId, slotNumber: { notIn: activeSlotNumbers } }
          : { matchId },
      select: { id: true },
    });
    const staleIds = staleSlotResults.map((result) => result.id);
    if (staleIds.length > 0) {
      await tx.matchSlotPlayerResult.deleteMany({
        where: { slotResultId: { in: staleIds } },
      });
      await tx.matchSlotResult.deleteMany({
        where: { id: { in: staleIds } },
      });
    }

    const slotResultIds = new Map<number, string>();
    for (const result of teamResults) {
      const saved = await tx.matchSlotResult.upsert({
        where: {
          matchId_slotNumber: {
            matchId,
            slotNumber: result.slotNumber,
          },
        },
        create: {
          matchId,
          organizationId: result.organizationId,
          slotNumber: result.slotNumber,
          teamId: result.teamId,
          wasPresentInMatch: result.wasPresentInMatch,
          placement: result.placement,
          eliminatedOrder: result.eliminatedOrder,
          eliminatedAt: result.eliminatedAt,
          placementPoints: result.placementPoints,
          totalKills: result.totalKills,
          manualTotalKills: result.manualTotalKills,
          finalPlacement: result.finalPlacement,
          finalKills: result.finalKills,
          finalizedAt: result.finalizedAt,
          totalPoints: result.totalPoints,
          points: result.points,
          isLocked: result.isLocked,
        },
        update: {
          teamId: result.teamId,
          wasPresentInMatch: result.wasPresentInMatch,
          placement: result.placement,
          eliminatedOrder: result.eliminatedOrder,
          eliminatedAt: result.eliminatedAt,
          placementPoints: result.placementPoints,
          totalKills: result.totalKills,
          manualTotalKills: result.manualTotalKills,
          finalPlacement: result.finalPlacement,
          finalKills: result.finalKills,
          finalizedAt: result.finalizedAt,
          totalPoints: result.totalPoints,
          points: result.points,
          isLocked: result.isLocked,
        },
        select: { id: true, slotNumber: true },
      });
      slotResultIds.set(saved.slotNumber, saved.id);
    }
    return slotResultIds;
  }

  private async writeFinalPlayerResults(
    tx: Prisma.TransactionClient,
    playerResults: ComputedFinalPlayerResult[],
    slotResultIds: Map<number, string>,
  ): Promise<void> {
    const playersBySlot = new Map<number, ComputedFinalPlayerResult[]>();
    for (const player of playerResults) {
      const bucket = playersBySlot.get(player.slotNumber) ?? [];
      bucket.push(player);
      playersBySlot.set(player.slotNumber, bucket);
    }

    for (const [slotNumber, slotResultId] of slotResultIds.entries()) {
      const players = playersBySlot.get(slotNumber) ?? [];
      if (players.length === 0) {
        await tx.matchSlotPlayerResult.deleteMany({
          where: { slotResultId },
        });
        continue;
      }

      await tx.matchSlotPlayerResult.deleteMany({
        where: {
          slotResultId,
          playerName: { notIn: players.map((player) => player.playerName) },
        },
      });

      for (const player of players) {
        await tx.matchSlotPlayerResult.upsert({
          where: {
            slotResultId_playerName: {
              slotResultId,
              playerName: player.playerName,
            },
          },
          create: {
            slotResultId,
            organizationId: player.organizationId,
            playerId: player.playerId ?? undefined,
            pubgAccountId: player.pubgAccountId,
            externalPlayerId: player.externalPlayerId,
            playerName: player.playerName,
            kills: player.kills,
            knocks: player.knocks,
            assists: player.assists,
            isKnocked: player.isKnocked,
            isAlive: player.isAlive,
            alive: player.alive,
            isAutoFilled: player.isAutoFilled,
          },
          update: {
            playerId: player.playerId ?? null,
            pubgAccountId: player.pubgAccountId,
            externalPlayerId: player.externalPlayerId,
            kills: player.kills,
            knocks: player.knocks,
            assists: player.assists,
            isKnocked: player.isKnocked,
            isAlive: player.isAlive,
            alive: player.alive,
            isAutoFilled: player.isAutoFilled,
          },
        });
      }
    }
  }

  private async writeFinalStandings(
    tx: Prisma.TransactionClient,
    matchId: string,
    standings: ComputedFinalStanding[],
  ): Promise<void> {
    if (standings.length === 0) {
      await tx.matchStanding.deleteMany({ where: { matchId } });
      return;
    }

    const teamIds = standings.map((standing) => standing.teamId);
    await tx.matchStanding.deleteMany({
      where: {
        matchId,
        teamId: { notIn: teamIds },
      },
    });
    for (const standing of standings) {
      await tx.matchStanding.upsert({
        where: {
          matchId_teamId: {
            matchId,
            teamId: standing.teamId,
          },
        },
        create: {
          matchId,
          organizationId: standing.organizationId,
          tournamentId: standing.tournamentId,
          teamId: standing.teamId,
          rank: standing.rank,
          totalKills: standing.totalKills,
          placementPoints: standing.placementPoints,
          bonusPoints: standing.bonusPoints,
          penaltyPoints: standing.penaltyPoints,
          totalPoints: standing.totalPoints,
          isLocked: standing.isLocked,
          isFinal: standing.isFinal,
          computedAt: standing.computedAt,
        },
        update: {
          organizationId: standing.organizationId,
          tournamentId: standing.tournamentId,
          rank: standing.rank,
          totalKills: standing.totalKills,
          placementPoints: standing.placementPoints,
          bonusPoints: standing.bonusPoints,
          penaltyPoints: standing.penaltyPoints,
          totalPoints: standing.totalPoints,
          isLocked: standing.isLocked,
          isFinal: standing.isFinal,
          computedAt: standing.computedAt,
        },
      });
    }
  }

  private async resolveFinalizationWinnerTeamId(
    matchId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<string | null> {
    const cached = await this.store.get(matchId).catch(() => null);
    const cachedWinner =
      cached?.summary?.winnerTeamId ??
      (() => {
        const aliveTeams =
          cached?.teams?.filter((team) => {
            const alivePlayers =
              typeof team.alivePlayers === 'number'
                ? team.alivePlayers
                : (team.players ?? []).filter((player) => player.alive === true)
                    .length;
            return alivePlayers > 0;
          }) ?? [];
        return aliveTeams.length === 1 ? aliveTeams[0].teamId : null;
      })();
    if (cachedWinner) {
      return cachedWinner;
    }

    const existingWinner = await client.matchSlotResult.findFirst({
      where: {
        matchId,
        teamId: { not: null },
        placement: 1,
        wasPresentInMatch: { not: false },
      },
      select: { teamId: true },
      orderBy: { slotNumber: 'asc' },
    });
    return existingWinner?.teamId ?? null;
  }

  private async publishFinalizationSideEffects(
    plan: MatchConclusionPlan,
    reason: string,
  ): Promise<void> {
    const { matchId } = plan;

    if (!plan.isSessionMatch) {
      await this.scoring.recomputeMatchAndTournament(matchId).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `[MATCH_CONCLUSION] Scoring recompute skipped for ${matchId}: ${msg}`,
        );
      });
    }

    await this.captureFinalizationSnapshots(matchId, plan.finalState).catch(
      (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `[MATCH_CONCLUSION] Snapshot capture skipped for ${matchId}: ${msg}`,
        );
      },
    );

    this.resultsEvents.emitResultsUpdated(matchId, 0, {
      source: 'MATCH_CONCLUDED',
    });
    this.resultsEvents.emitLeaderboardUpdated(matchId, {
      source: 'MATCH_CONCLUDED',
    });

    await this.topFragger?.finalize(matchId).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Top fragger finalize skipped for ${matchId}: ${msg}`);
    });
    await this.mvp?.finalize(matchId).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`MVP finalize skipped for ${matchId}: ${msg}`);
    });

    try {
      const observerFinishedPayload =
        await this.conclusion.buildObserverMatchFinishedPayload(
          matchId,
          plan.winnerTeamId,
          plan.finalizedAt,
        );
      if (observerFinishedPayload) {
        this.realtime.emitObserverMatchFinished(observerFinishedPayload);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Observer match finished emit failed for ${matchId}: ${msg}`,
      );
    }

    try {
      this.pcobGateway?.emitLastTeamStanding(matchId, {
        matchId,
        winnerTeamId: plan.winnerTeamId,
        finalizedAt: plan.finalizedAt,
      });
      this.pcobGateway?.emitMatchConcluded(matchId, {
        matchId,
        winnerTeamId: plan.winnerTeamId,
        concludedAt: plan.finalizedAt,
        reason,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Match concluded broadcast failed for ${matchId}: ${msg}`,
      );
    }
  }

  private async captureFinalizationSnapshots(
    matchId: string,
    canonicalState: TelemetryMatchState | null = null,
  ): Promise<void> {
    const scoreboard = await buildWidgetScoreboardSnapshot(
      this.prisma,
      matchId,
      {
        includeLogos: true,
        brandMode: 'dark',
      },
    );

    const players = await this.prisma.matchSlotPlayerResult.findMany({
      where: { slotResult: { matchId } },
      select: {
        playerId: true,
        playerName: true,
        slotResult: { select: { teamId: true, slotNumber: true } },
        kills: true,
        knocks: true,
        assists: true,
        isAlive: true,
        organizationId: true,
      },
    });

    const payload = {
      matchId,
      players: players.map((p) => ({
        playerId: p.playerId ?? null,
        playerName: p.playerName ?? null,
        teamId: p.slotResult?.teamId ?? null,
        slot: p.slotResult?.slotNumber ?? null,
        kills: p.kills ?? 0,
        assists: p.assists ?? 0,
        survivalTime: null,
        damage: null,
        alive: p.isAlive ?? null,
      })),
    };

    const ctrl = await this.prisma.matchControlState.findUnique({
      where: { matchId },
      select: { metaJson: true, organizationId: true, state: true },
    });
    const orgLookup = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        organizationId: true,
        tournament: { select: { organizationId: true } },
      },
    });
    const base =
      (ctrl?.metaJson as Record<string, unknown> | null | undefined) ?? {};
    const telemetryPromotionDiagnostics =
      await this.conclusion.buildTelemetryPromotionDiagnostics(
        matchId,
        canonicalState,
      );
    const nextMeta: Record<string, unknown> = {
      ...base,
      lastScoreboardSnapshot: scoreboard,
      lastPlayerSnapshot: payload,
    };
    if (telemetryPromotionDiagnostics) {
      nextMeta.telemetryPromotionDiagnostics = telemetryPromotionDiagnostics;
    } else {
      delete nextMeta.telemetryPromotionDiagnostics;
    }
    const organizationId =
      ctrl?.organizationId ??
      orgLookup?.organizationId ??
      orgLookup?.tournament?.organizationId ??
      (() => {
        throw new BadRequestException(
          'organizationId is required for match snapshots',
        );
      })();
    await this.prisma.matchControlState.upsert({
      where: { matchId },
      update: {
        metaJson: nextMeta as Prisma.JsonObject,
      },
      create: {
        matchId,
        organizationId,
        state: ctrl?.state ?? 'ENDED',
        metaJson: nextMeta as Prisma.JsonObject,
      },
    });
  }

  async getState(actor: Actor, matchId: string): Promise<LiveMatchState> {
    const match = await this.loadMatch(matchId);
    this.ensurePermission(
      actor,
      match.tournament.ownerUserId,
      match.tournament.organizationId,
    );
    const liveControlStatus = this.isLiveControlStatus(
      match.status,
      match.controlState?.state ?? null,
    );
    let cached = await this.store.get(matchId);
    if (liveControlStatus) {
      const hydratedTelemetry =
        await this.hydrateMirrorFromPersistedTelemetry(matchId);
      if (
        hydratedTelemetry &&
        this.cachedStateHasTelemetrySignal(hydratedTelemetry)
      ) {
        cached = hydratedTelemetry;
      } else if (!this.cachedStateHasTelemetrySignal(cached)) {
        cached = hydratedTelemetry ?? cached;
      }
    }
    if (cached) {
      const controlStatus = this.toPublicControlStatus(match);
      if (cached.status !== controlStatus) {
        return this.buildState(match);
      }
      // Keep live stats but refresh slot/team metadata from DB so control reflects slot changes
      const freshTeams = await this.loadTeams(match.id);
      const freshTeamsById = new Map(
        freshTeams.map((team) => [team.teamId, team] as const),
      );
      const hasTelemetrySignal = this.cachedStateHasTelemetrySignal(cached);
      const mergedTeams: TeamScoreState[] = hasTelemetrySignal
        ? cached.teams.map((existing) =>
            this.mergeLiveTelemetryTeamMetadata(
              existing,
              freshTeamsById.get(existing.teamId) ?? null,
            ),
          )
        : freshTeams.map((fresh) => {
            const existing = cached.teams.find(
              (t) => t.teamId === fresh.teamId,
            );
            const alivePlayers =
              existing?.alivePlayers ?? fresh.alivePlayers ?? null;
            const eliminated =
              alivePlayers === null || alivePlayers === undefined
                ? undefined
                : alivePlayers <= 0;
            return {
              ...fresh,
              hasTelemetryPresence:
                existing?.hasTelemetryPresence ??
                fresh.hasTelemetryPresence ??
                false,
              wasPresentInMatch:
                existing?.wasPresentInMatch ?? fresh.wasPresentInMatch ?? null,
              presenceStatus:
                existing?.presenceStatus ?? fresh.presenceStatus ?? null,
              kills: existing?.kills ?? fresh.kills ?? 0,
              placement: existing?.placement ?? fresh.placement ?? null,
              points: existing?.points ?? fresh.points ?? null,
              alivePlayers,
              totalPlayers:
                existing?.totalPlayers ?? fresh.totalPlayers ?? null,
              alive:
                alivePlayers === null || alivePlayers === undefined
                  ? undefined
                  : alivePlayers > 0,
              eliminated,
              updatedAt: existing?.updatedAt ?? fresh.updatedAt ?? null,
              sourceMode: existing?.sourceMode ?? fresh.sourceMode,
              players: existing?.players ?? fresh.players ?? [],
            };
          });
      const changed =
        mergedTeams.length !== cached.teams.length ||
        mergedTeams.some((t) => {
          const existing = cached.teams.find((c) => c.teamId === t.teamId);
          if (!existing) {
            return true;
          }

          return (
            existing.slot !== t.slot ||
            existing.name !== t.name ||
            existing.tag !== t.tag ||
            existing.logoUrl !== t.logoUrl
          );
        });
      const summary = hasTelemetrySignal
        ? (cached.summary ??
          this.summarizeLiveTeams(mergedTeams, cached.summary))
        : this.summarizeAssignedTeams(mergedTeams);
      const summaryChanged =
        (cached.summary?.totalTeams ?? null) !== summary?.totalTeams ||
        (cached.summary?.aliveTeams ?? null) !== summary?.aliveTeams ||
        (cached.summary?.totalPlayers ?? null) !== summary?.totalPlayers ||
        (cached.summary?.alivePlayers ?? null) !== summary?.alivePlayers ||
        (cached.summary?.winnerTeamId ?? null) !== summary?.winnerTeamId ||
        (cached.summary?.winnerSlot ?? null) !== summary?.winnerSlot;
      if (!changed && !summaryChanged) return cached;
      const updated: LiveMatchState = {
        ...cached,
        teams: mergedTeams,
        summary,
      };
      return updated;
    }
    const fresh = await this.buildState(match);
    return fresh;
  }

  async refreshLiveContractState(
    matchId: string,
  ): Promise<LiveMatchState | null> {
    const match = await this.loadMatch(matchId);
    if (
      !this.isLiveControlStatus(match.status, match.controlState?.state ?? null)
    ) {
      return null;
    }

    const fresh = await this.buildState(match);
    const saved = await this.persistAndBroadcast(matchId, fresh);
    await this.matchStateBroadcaster?.broadcastUpdate(
      saved,
      match.organizationId ?? match.tournament.organizationId ?? null,
    );
    return saved;
  }

  async startMatch(
    actor: Actor | null,
    matchId: string,
    sessionId?: string | null,
    context: MatchStartContext = {},
  ): Promise<LiveMatchState> {
    return this.setMatchLive(actor, matchId, sessionId, undefined, context);
  }

  private async setMatchLive(
    actor: Actor | null,
    matchId: string,
    sessionId?: string | null,
    reason: string = 'NEW_MATCH_WENT_LIVE',
    context: MatchStartContext = {},
  ): Promise<LiveMatchState> {
    const match = await this.loadMatch(matchId);
    if (actor) {
      this.ensurePermission(
        actor,
        match.tournament.ownerUserId,
        match.tournament.organizationId,
      );
    }
    if (isMatchLiveStatus(match.status)) {
      return this.handleAlreadyLiveStart(matchId, match, sessionId, context);
    }
    if (!canStartMatchForLifecycle(match.status)) {
      throw new BadRequestException('Match has already finished');
    }
    await this.matchesService.validatePubgSlots(matchId);
    return this.setMatchLiveInternal(
      actor,
      matchId,
      match,
      sessionId,
      reason,
      context,
    );
  }

  private async handleAlreadyLiveStart(
    matchId: string,
    match: MatchSummary,
    sessionId?: string | null,
    context: MatchStartContext = {},
  ): Promise<LiveMatchState> {
    const requestedSessionId = this.normalizeSessionId(sessionId);
    const currentSessionId = this.normalizeSessionId(match.pcobSessionId);
    const startContext = this.normalizeStartContext(context);
    const forcedTelemetrySource =
      this.resolveForcedTelemetrySource(startContext);

    if (requestedSessionId && requestedSessionId !== currentSessionId) {
      const now = new Date();
      const organizationId = this.requireMatchOrganizationId(match);
      const bindingData = this.shouldUseApiSessionBinding(
        match,
        forcedTelemetrySource,
      )
        ? buildApiObserverBindingData(requestedSessionId, now)
        : buildPcobBindingData(requestedSessionId, now);
      await this.prisma.$transaction(async (tx) => {
        await tx.match.update({
          where: { id: matchId },
          data: {
            ...bindingData,
            pcobLastSeenAt: null,
            ...(forcedTelemetrySource
              ? {
                  telemetrySource: forcedTelemetrySource,
                  telemetrySourceLockedAt: now,
                }
              : {}),
          },
        });
        await this.writeControlStateCas(tx, {
          matchId,
          organizationId,
          state: 'LIVE',
          metaJson: (currentMeta) =>
            this.buildControlMetaJson(currentMeta, {
              clearTelemetryIngress: true,
              telemetrySource: forcedTelemetrySource,
            }),
          expectedVersion: startContext.expectedVersion ?? null,
          updatedAt: now,
        });
      });
      await this.store.evictMatches([matchId]);
      this.logger.log(
        JSON.stringify({
          stage: 'match-control',
          action: 'live-start-idempotent-session-rebound',
          matchId,
          previousSessionId: currentSessionId,
          nextSessionId: requestedSessionId,
          startSource: startContext.source,
          clientId: startContext.clientId,
          requestedMatchId: startContext.requestedMatchId,
        }),
      );
      const refreshed = await this.loadMatch(matchId);
      return this.buildState({
        ...refreshed,
        status: MatchStatus.LIVE,
        liveState: LiveState.LIVE,
        endedAt: null,
        controlState: {
          state: 'LIVE',
          metaJson: refreshed.controlState?.metaJson ?? null,
        },
      });
    }

    if (forcedTelemetrySource) {
      const now = new Date();
      const organizationId = this.requireMatchOrganizationId(match);
      await this.prisma.$transaction(async (tx) => {
        await tx.match.update({
          where: { id: matchId },
          data: {
            telemetrySource: forcedTelemetrySource,
            telemetrySourceLockedAt: now,
          },
        });
        await this.writeControlStateCas(tx, {
          matchId,
          organizationId,
          state: 'LIVE',
          reason: 'LIVE_TELEMETRY_SOURCE_LOCK',
          metaJson: (currentMeta) =>
            this.buildControlMetaJson(currentMeta, {
              telemetrySource: forcedTelemetrySource,
            }),
          expectedVersion: startContext.expectedVersion ?? null,
          updatedAt: now,
        });
      });
    }

    this.logger.log(
      JSON.stringify({
        stage: 'match-control',
        action: 'live-start-idempotent',
        matchId,
        sessionId: currentSessionId,
        startSource: startContext.source,
        clientId: startContext.clientId,
        requestedMatchId: startContext.requestedMatchId,
      }),
    );
    return this.buildState({
      ...match,
      status: MatchStatus.LIVE,
      liveState: LiveState.LIVE,
      endedAt: null,
      controlState: {
        state: 'LIVE',
        metaJson: match.controlState?.metaJson ?? null,
      },
    });
  }

  private async setMatchLiveInternal(
    actor: Actor | null,
    matchId: string,
    preloaded?: MatchSummary,
    sessionId?: string | null,
    reason: string = 'NEW_MATCH_WENT_LIVE',
    context: MatchStartContext = {},
  ): Promise<LiveMatchState> {
    const match = preloaded ?? (await this.loadMatch(matchId));
    let autoEndedConflicts: Array<{ id: string; aliveTeams: number | null }> =
      [];
    const startContext = this.normalizeStartContext(context);
    const previousLifecycleStatus = deriveCanonicalMatchLifecycleStatus(
      this.toLifecycleContext(match),
    );
    const now = new Date();
    const hasPriorRun = this.hasPriorRun(match);
    const sessionBinding = this.resolveStartSessionBinding(match, sessionId);
    const forcedTelemetrySource =
      this.resolveForcedTelemetrySource(startContext);
    const useApiSessionBinding = this.shouldUseApiSessionBinding(
      match,
      forcedTelemetrySource,
    );
    const preserveTelemetryTransitionState =
      this.shouldPreserveTelemetryOnLiveTransition(
        match,
        startContext,
        sessionBinding.sessionId,
        previousLifecycleStatus,
      );
    if (
      sessionBinding.action === 'GENERATE' ||
      sessionBinding.action === 'ROTATE'
    ) {
      this.logger.log(
        JSON.stringify({
          stage: 'match-control',
          action: 'pcob-session-rotated',
          matchId,
          reason:
            sessionBinding.action === 'ROTATE'
              ? 'PRIOR_RUN_ROTATION'
              : 'MISSING_SESSION_BINDING',
          previousSessionId: sessionBinding.previousSessionId,
          nextSessionId: sessionBinding.sessionId,
        }),
      );
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const liveInTournament = match.tournamentId
          ? ((await tx.match.findMany({
              where: {
                tournamentId: match.tournamentId,
                deletedAt: null,
                OR: [
                  { status: MatchStatus.LIVE },
                  { controlState: { state: 'LIVE' } },
                ],
                id: { not: matchId },
              },
              select: { id: true },
            })) ?? [])
          : [];

        const liveInOrg =
          match.tournament.organizationId !== null &&
          match.tournament.organizationId !== undefined
            ? ((await tx.match.findMany({
                where: {
                  organizationId: match.tournament.organizationId,
                  deletedAt: null,
                  OR: [
                    { status: MatchStatus.LIVE },
                    { controlState: { state: 'LIVE' } },
                  ],
                  id: {
                    notIn: [matchId, ...liveInTournament.map((m) => m.id)],
                  },
                },
                select: { id: true },
              })) ?? [])
            : [];

        const conflictCandidates = Array.from(
          new Map(
            [...liveInTournament, ...liveInOrg].map((candidate) => [
              candidate.id,
              { id: candidate.id },
            ]),
          ).values(),
        );
        if (conflictCandidates.length) {
          autoEndedConflicts = await this.autoEndOtherLiveMatchesInScope(
            tx,
            match,
            conflictCandidates,
            now,
          );
        }
        await tx.match.update({
          where: { id: matchId },
          data: {
            status: MatchStatus.LIVE,
            liveState: LiveState.LIVE,
            liveAt: hasPriorRun
              ? now
              : (match.liveAt ?? match.startedAt ?? now),
            startedAt: hasPriorRun ? now : (match.startedAt ?? now),
            endedAt: null,
            endedReason: null,
            pcobLastSeenAt: null,
            ...(forcedTelemetrySource
              ? {
                  telemetrySource: forcedTelemetrySource,
                  telemetrySourceLockedAt: now,
                }
              : {}),
            ...(sessionBinding.sessionId
              ? useApiSessionBinding
                ? buildApiObserverBindingData(sessionBinding.sessionId, now)
                : buildPcobBindingData(sessionBinding.sessionId, now)
              : {}),
          },
        });
        const organizationId = this.requireMatchOrganizationId(match);
        await this.writeControlStateCas(tx, {
          matchId,
          organizationId,
          state: 'LIVE',
          reason,
          metaJson: (currentMeta) =>
            this.buildControlMetaJson(currentMeta, {
              clearFinalization: true,
              preserveTelemetryRuntime: preserveTelemetryTransitionState,
              telemetrySource: forcedTelemetrySource,
            }),
          expectedVersion: startContext.expectedVersion ?? null,
          updatedAt: now,
        });
        const remainingLive =
          (await tx.match.findMany({
            where: {
              ...(match.tournament.organizationId
                ? { organizationId: match.tournament.organizationId }
                : { tournamentId: match.tournamentId }),
              id: { not: matchId },
              deletedAt: null,
              OR: [
                { status: MatchStatus.LIVE },
                { controlState: { state: 'LIVE' } },
              ],
            },
            select: { id: true },
          })) ?? [];
        const { blocking: remainingBlocking, ignored: remainingIgnored } =
          await this.partitionLiveScopeConflicts(tx, remainingLive);
        if (remainingIgnored.length) {
          this.logger.warn(
            JSON.stringify({
              stage: 'match-control',
              action: 'live-start-post-update-stale-conflict-ignored',
              matchId,
              ignored: remainingIgnored,
              reason: 'ZERO_ALIVE_TEAMS_STALE_LIVE_MATCH',
            }),
          );
        }
        if (remainingBlocking.length) {
          throw new ConflictException(
            'Another match is already LIVE for this organization',
          );
        }
        void this.resultsEvents.emitResultsLockState(matchId);
        // Starting a match is lifecycle-only. Slot seeding remains an explicit
        // action elsewhere so intentionally empty/unassigned slots stay untouched.
        if (preserveTelemetryTransitionState) {
          this.logger.warn(
            JSON.stringify({
              tag: '[PHASE TRANSITION][RESET]',
              stage: 'match-control',
              action: 'live-start-telemetry-reset-blocked',
              matchId,
              previousLifecycleStatus,
              startSource: startContext.source,
              sessionId: sessionBinding.sessionId,
              reason: 'ACTIVE_TELEMETRY_TRANSITION',
            }),
          );
        } else {
          await this.resultsService.resetLiveProjection(matchId, { tx });
          await tx.matchStateSnapshot.deleteMany({
            where: { matchId },
          });
          await tx.matchTelemetry.deleteMany({
            where: { matchId },
          });
          await tx.telemetryEventLog.deleteMany({
            where: { matchId },
          });
        }
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'Another match is already LIVE for this organization',
        );
      }
      throw err;
    }

    await this.store.evictMatches([
      matchId,
      ...autoEndedConflicts.map((conflict) => conflict.id),
    ]);

    for (const conflict of autoEndedConflicts) {
      const endedId = conflict.id;
      const endedMatch = await this.loadMatch(endedId);
      const endedState = await this.buildState({
        ...endedMatch,
        status: MatchStatus.ENDED,
        liveState: LiveState.ENDED,
        endedAt: endedMatch.endedAt ?? now,
        endedReason: 'AUTO_ENDED_BY_NEW_LIVE_MATCH',
        controlState: {
          state: 'ENDED',
          metaJson: endedMatch.controlState?.metaJson ?? null,
        },
      });
      const savedEnded = await this.persistAndBroadcast(endedId, endedState);
      this.gateway.emitMatchAutoEnd(
        endedId,
        savedEnded,
        endedMatch.tournament.organizationId,
      );
      this.gateway.emitMatchStateChanged(
        endedId,
        'LIVE',
        'ENDED',
        'AUTO_ENDED_BY_NEW_LIVE_MATCH',
        endedMatch.tournament.organizationId,
      );
      this.emitStatus(
        endedId,
        'ENDED',
        endedMatch.tournament.organizationId ?? null,
      );
      this.logLifecycleTransition(
        endedId,
        'LIVE',
        'ENDED',
        'AUTO_ENDED_BY_NEW_LIVE_MATCH',
        {
          dbStatus: MatchStatus.ENDED,
          triggeredByMatchId: matchId,
          aliveTeams: conflict.aliveTeams,
        },
      );
      await this.audit.log({
        action: AuditAction.AUTO_END,
        entityType: 'MATCH',
        entityId: endedId,
        userId: actor?.actorId ?? actor?.id ?? 'system',
        organizationId: endedMatch.tournament.organizationId,
        before: {
          status: MatchStatus.LIVE,
          aliveTeams: conflict.aliveTeams,
        },
        after: {
          status: MatchStatus.ENDED,
          reason: 'AUTO_ENDED_BY_NEW_LIVE_MATCH',
          triggeredByMatchId: matchId,
        },
        source: 'SYSTEM',
        reason: 'AUTO_ENDED_BY_NEW_LIVE_MATCH',
      });
      void this.resultsEvents.emitResultsLockState(endedId);
      try {
        await this.confirmFinished(
          SYSTEM_ACTOR,
          endedId,
          'AUTO_ENDED_BY_NEW_LIVE_MATCH',
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `[MATCH_CONCLUSION] Auto-end finalization skipped for ${endedId}: ${msg}`,
        );
      }
      void this.broadcast.emitForMatch(endedId, 'match-status');
    }

    // Broadcast current match live state
    const liveMatch = await this.loadMatch(matchId);
    const liveState = await this.buildState({
      ...liveMatch,
      status: MatchStatus.LIVE,
      startedAt: liveMatch.startedAt ?? now,
      endedAt: null,
      controlState: { state: 'LIVE' },
    });
    const existingTelemetryLiveState = preserveTelemetryTransitionState
      ? await this.store.get(matchId)
      : null;
    const savedLive = existingTelemetryLiveState
      ? ({
          ...existingTelemetryLiveState,
          status: 'LIVE',
        } as LiveMatchState)
      : await (async () => {
          this.liveStateMirror.lockCanonicalRoster(matchId, liveState);
          return this.persistAndBroadcast(matchId, liveState);
        })();
    if (existingTelemetryLiveState) {
      this.logger.warn(
        JSON.stringify({
          tag: '[PHASE TRANSITION][RESET]',
          stage: 'match-control',
          action: 'control-live-state-republish-blocked',
          matchId,
          previousLifecycleStatus,
          startSource: startContext.source,
          sessionId: sessionBinding.sessionId,
          teams: existingTelemetryLiveState.teams.length,
          players: existingTelemetryLiveState.teams.reduce(
            (sum, team) => sum + (team.players?.length ?? 0),
            0,
          ),
          reason: 'ACTIVE_TELEMETRY_TRANSITION',
        }),
      );
    }
    this.gateway.emitMatchState(
      matchId,
      savedLive,
      match.tournament.organizationId,
    );
    this.gateway.emitMatchStateChanged(
      matchId,
      match.controlState?.state ?? this.toControlStateFromMatch(match.status),
      'LIVE',
      reason,
      match.tournament.organizationId,
    );
    this.emitStatus(matchId, 'LIVE', match.tournament.organizationId ?? null);
    this.logLifecycleTransition(
      matchId,
      previousLifecycleStatus,
      'LIVE',
      reason,
      {
        dbStatus: MatchStatus.LIVE,
        sessionId: sessionBinding.sessionId,
        startSource: startContext.source,
        clientId: startContext.clientId,
        requestedMatchId: startContext.requestedMatchId,
      },
    );
    await this.audit.log({
      action: AuditAction.MATCH_STATUS_CHANGE,
      entityType: 'MATCH',
      entityId: matchId,
      userId: actor?.actorId ?? actor?.id ?? 'system',
      organizationId: match.tournament.organizationId,
      before: {
        status: match.status,
        lifecycleStatus: previousLifecycleStatus,
        controlState:
          match.controlState?.state ??
          this.toControlStateFromMatch(match.status),
      },
      after: {
        status: MatchStatus.LIVE,
        lifecycleStatus: 'LIVE',
        reason,
        sessionId: sessionBinding.sessionId,
        startSource: startContext.source,
        clientId: startContext.clientId,
        requestedMatchId: startContext.requestedMatchId,
      },
      source: 'SYSTEM',
      reason,
    });
    void this.rankingEmitter.emitLiveRanking(matchId, { force: true });
    void this.rankingEmitter.emitOverallRanking(match.tournamentId, {
      force: true,
    });
    const liveStateUpdates: LiveStateUpdatePayload[] = [
      ...autoEndedConflicts.map((conflict) => ({
        entity: 'MATCH' as const,
        id: conflict.id,
        liveState: LiveState.ENDED,
      })),
      { entity: 'MATCH', id: matchId, liveState: LiveState.LIVE },
    ];
    const hierarchy = await this.matchesService.syncLiveHierarchy({
      matchId,
      groupId: match.groupId,
      stageId: match.stageId,
      tournamentId: match.tournamentId,
    });
    liveStateUpdates.push(...hierarchy);
    this.gateway.emitLiveStateUpdates(liveStateUpdates);
    void this.broadcast.emitForMatch(matchId, 'match-status');
    return savedLive;
  }

  async applyAuthoritativeMatchStart(
    matchId: string,
    signal: AuthoritativeLifecycleSignal = {},
  ): Promise<MatchLifecycleSnapshot> {
    const match = await this.loadMatch(matchId);
    this.assertTelemetrySession(match, signal.sessionId ?? null);

    if (isMatchLiveStatus(match.status)) {
      return this.getLifecycleState(matchId);
    }
    if (
      isMatchFinalizingStatus(match.status) ||
      isMatchFinishedStatus(match.status)
    ) {
      return this.getLifecycleState(matchId);
    }

    await this.setMatchLiveInternal(
      null,
      matchId,
      match,
      signal.sessionId ?? null,
      signal.source?.trim() || 'PCOB_MATCH_STARTED',
      {
        source: signal.source?.trim() || 'PCOB_MATCH_STARTED',
      },
    );
    return this.getLifecycleState(matchId);
  }

  async applyAuthoritativeMatchEnd(
    matchId: string,
    signal: AuthoritativeLifecycleSignal = {},
  ): Promise<MatchLifecycleSnapshot> {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        id: true,
        status: true,
        pcobSessionId: true,
      },
    });
    if (!match) {
      throw new NotFoundException('Match not found');
    }

    this.assertTelemetrySession(match, signal.sessionId ?? null);

    if (
      isMatchFinalizingStatus(match.status) ||
      isMatchFinishedStatus(match.status)
    ) {
      return this.getLifecycleState(matchId);
    }
    if (!isMatchLiveStatus(match.status)) {
      return this.getLifecycleState(matchId);
    }

    return this.detectMatchFinish(matchId, signal.sessionId ?? null);
  }

  async health(actor: Actor, matchId?: string): Promise<ControlHealth> {
    const matchIdSafe = typeof matchId === 'string' ? matchId : null;
    let matchStatus: ControlState | undefined;
    let version: number | null | undefined;
    if (matchIdSafe) {
      const match = await this.authorize(actor, matchIdSafe);
      matchStatus = this.toPublicControlStatus(match);
      const cached = await this.store.get(matchIdSafe);
      version = cached?.version ?? null;
    }
    return {
      status: 'ok',
      serverTime: Date.now(),
      uptimeMs: Math.round(process.uptime() * 1000),
      matchId: matchIdSafe,
      matchStatus,
      version,
    };
  }

  async endMatch(
    actor: Actor,
    matchId: string,
    reason: string = 'MANUAL_END',
    opts: { expectedVersion?: number | null } = {},
  ): Promise<LiveMatchState> {
    const match = await this.loadMatch(matchId);
    this.ensurePermission(
      actor,
      match.tournament.ownerUserId,
      match.tournament.organizationId,
    );
    if (isMatchFinishedStatus(match.status)) {
      return this.getState(actor, matchId);
    }
    const previousLifecycleStatus = deriveCanonicalMatchLifecycleStatus(
      this.toLifecycleContext(match),
    );
    const previousControlState =
      match.controlState?.state ?? this.toControlStateFromMatch(match.status);
    const endedAt = new Date();
    const finalizationStartedAt = endedAt.toISOString();
    const persistedPendingControlState =
      await this.resolvePersistedControlState('FINISH_PENDING');

    await this.prisma.$transaction(async (tx) => {
      await tx.match.update({
        where: { id: matchId },
        data: {
          status: MatchStatus.FINISH_PENDING,
          liveState: LiveState.ENDED,
          endedAt,
          endedReason: match.endedReason ?? reason,
        },
      });
      await this.writeControlStateCas(tx, {
        matchId,
        organizationId: this.requireMatchOrganizationId(match),
        state: persistedPendingControlState,
        reason,
        metaJson: (currentMeta) =>
          this.buildFinalizationEligibilityMeta(currentMeta, {
            finalizationStartedAt,
            source: reason,
          }),
        updatedAt: endedAt,
        expectedVersion: opts.expectedVersion ?? null,
      });
    });

    const baseState = await this.buildState({
      ...match,
      status: MatchStatus.FINISH_PENDING,
      liveState: LiveState.ENDED,
      endedAt,
      endedReason: match.endedReason ?? reason,
      controlState: { state: persistedPendingControlState },
    });
    const saved = await this.persistAndBroadcast(matchId, baseState);
    this.gateway.emitMatchEnd(matchId, saved);
    this.gateway.emitMatchStateChanged(
      matchId,
      previousControlState,
      persistedPendingControlState,
      reason,
      match.tournament.organizationId,
    );
    this.emitStatus(matchId, 'ENDED', match.tournament.organizationId ?? null);
    this.logLifecycleTransition(
      matchId,
      previousLifecycleStatus,
      'FINISH_PENDING',
      reason,
      {
        dbStatus: MatchStatus.FINISH_PENDING,
        finalizationStartedAt,
      },
    );
    void this.rankingEmitter.emitLiveRanking(matchId, { force: true });
    void this.rankingEmitter.emitOverallRanking(match.tournamentId, {
      force: true,
    });
    const liveStateUpdates: LiveStateUpdatePayload[] = [
      { entity: 'MATCH', id: matchId, liveState: LiveState.ENDED },
    ];
    const hierarchy = await this.matchesService.syncLiveHierarchy({
      matchId,
      groupId: match.groupId,
      stageId: match.stageId,
      tournamentId: match.tournamentId,
    });
    liveStateUpdates.push(...hierarchy);
    this.gateway.emitLiveStateUpdates(liveStateUpdates);
    void this.broadcast.emitForMatch(matchId, 'match-status');

    const expectedVersion =
      opts.expectedVersion ?? (await this.resolveFinalizationVersion(matchId));
    await this.finalizeMatch(matchId, expectedVersion, reason);
    return this.getState(actor, matchId);
  }

  async setStatus(
    actor: Actor,
    matchId: string,
    dto: SetStatusDto,
  ): Promise<LiveMatchState> {
    const match = await this.loadMatch(matchId);
    this.ensurePermission(
      actor,
      match.tournament.ownerUserId,
      match.tournament.organizationId,
    );
    if (!CONTROL_STATES.includes(dto.status)) {
      throw new BadRequestException('Invalid status');
    }
    if (dto.status === 'FINISHED') {
      await this.confirmFinished(actor, matchId, dto.reason ?? 'FINISHED', {
        expectedVersion: dto.version ?? null,
      });
      return this.getState(actor, matchId);
    }
    const previousControlState =
      match.controlState?.state ?? this.toControlStateFromMatch(match.status);
    const newControlState = dto.status;
    const nextStatus = this.mapControlToBusinessStatus(
      dto.status,
      match.status,
    );
    if (nextStatus === MatchStatus.LIVE) {
      return this.setMatchLive(actor, matchId, null, dto.status, {
        source: 'match-control-status',
        expectedVersion: dto.version ?? null,
      });
    }
    const data: Prisma.MatchUpdateInput = {};
    let liveStateChange: LiveState | undefined;
    const now = new Date();
    const reason = dto.reason ?? dto.status;
    const persistedControlState =
      nextStatus === MatchStatus.FINISH_PENDING
        ? await this.resolvePersistedControlState(newControlState)
        : newControlState;
    if (nextStatus !== match.status) {
      data.status = nextStatus;
      if (nextStatus === MatchStatus.FINISH_PENDING) {
        data.endedAt = now;
        liveStateChange = LiveState.ENDED;
        data.liveState = liveStateChange;
        data.liveAt = match.liveAt ?? match.startedAt ?? now;
      }
      if (nextStatus === MatchStatus.DRAFT) {
        Object.assign(data, this.buildRunResetMatchData(match));
        liveStateChange = LiveState.UPCOMING;
      }
    }
    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        await tx.match.update({
          where: { id: matchId },
          data,
        });
      }
      await this.writeControlStateCas(tx, {
        matchId,
        organizationId: this.requireMatchOrganizationId(match),
        state: persistedControlState,
        reason,
        metaJson:
          dto.meta !== undefined
            ? (dto.meta as Prisma.JsonObject)
            : nextStatus === MatchStatus.DRAFT
              ? (currentMeta) => this.clearFinalizationMeta(currentMeta)
              : undefined,
        expectedVersion: dto.version ?? null,
        updatedAt: now,
      });
    });
    if (nextStatus === MatchStatus.DRAFT) {
      await this.store.evictMatches([matchId]);
      this.logRunBoundaryReset(matchId, dto.status, match);
    }
    const baseState = await this.buildState({
      ...match,
      status: data.status ? (data.status as MatchStatus) : match.status,
      liveState: liveStateChange ?? match.liveState,
      liveAt:
        nextStatus === MatchStatus.DRAFT
          ? null
          : nextStatus === MatchStatus.FINISH_PENDING
            ? ((data.liveAt as Date | undefined) ??
              match.liveAt ??
              match.startedAt ??
              now)
            : match.liveAt,
      startedAt: nextStatus === MatchStatus.DRAFT ? null : match.startedAt,
      endedAt:
        nextStatus === MatchStatus.DRAFT
          ? null
          : nextStatus === MatchStatus.FINISH_PENDING
            ? ((data.endedAt as Date | undefined) ?? match.endedAt)
            : match.endedAt,
      endedReason: nextStatus === MatchStatus.DRAFT ? null : match.endedReason,
      pcobSessionId:
        nextStatus === MatchStatus.DRAFT ? null : match.pcobSessionId,
      pcobBoundAt: nextStatus === MatchStatus.DRAFT ? null : match.pcobBoundAt,
      pcobLastSeenAt:
        nextStatus === MatchStatus.DRAFT ? null : match.pcobLastSeenAt,
      controlState: {
        state: newControlState,
        metaJson: (dto.meta !== undefined
          ? (dto.meta as unknown as Prisma.JsonValue)
          : nextStatus === MatchStatus.DRAFT
            ? this.clearFinalizationMeta(match.controlState?.metaJson)
            : match.controlState?.metaJson) as
          | Prisma.JsonValue
          | null
          | undefined,
      },
    });
    const saved = await this.persistAndBroadcast(matchId, baseState);
    if (newControlState !== previousControlState) {
      this.gateway.emitMatchStateChanged(
        matchId,
        previousControlState,
        newControlState,
        dto.status,
        match.tournament.organizationId,
      );
    }
    if (liveStateChange) {
      const updates: LiveStateUpdatePayload[] = [
        {
          entity: 'MATCH',
          id: matchId,
          liveState: liveStateChange,
        },
      ];
      const hierarchy = await this.matchesService.syncLiveHierarchy({
        matchId,
        groupId: match.groupId,
        stageId: match.stageId,
        tournamentId: match.tournamentId,
      });
      updates.push(...hierarchy);
      this.gateway.emitLiveStateUpdates(updates);
    }

    const publicStatus = this.toPublicStatus(
      nextStatus,
      newControlState,
      match.controlState?.metaJson ?? null,
    );
    this.emitStatus(matchId, publicStatus, match.tournament.organizationId);
    void this.rankingEmitter.emitLiveRanking(matchId, { force: true });
    void this.rankingEmitter.emitOverallRanking(match.tournamentId, {
      force: true,
    });
    void this.broadcast.emitForMatch(matchId, 'match-status');
    return saved;
  }

  async updateScore(
    actor: Actor,
    matchId: string,
    dto: UpdateScoreDto,
  ): Promise<LiveMatchState> {
    const match = await this.loadMatch(matchId);
    this.ensurePermission(
      actor,
      match.tournament.ownerUserId,
      match.tournament.organizationId,
    );
    if (dto.placement === undefined && dto.kills === undefined) {
      throw new BadRequestException('Provide placement and/or kills');
    }

    const slot = await this.prisma.matchSlot.findFirst({
      where: { matchId, teamId: dto.teamId, deletedAt: null },
      select: { slotNumber: true },
    });
    if (!slot?.slotNumber) {
      throw new NotFoundException('Team is not part of this match');
    }

    const authActor: AuthUser = {
      ...actor,
      actingRole: (actor as { actingRole?: Role | null }).actingRole ?? null,
      actingOrgName: null,
      actingAsUserId: null,
      realRole: actor.actorRole ?? actor.role ?? null,
      email: null,
    };
    await this.resultsService.updateSlotResult(
      authActor,
      matchId,
      slot.slotNumber,
      {
        placement: dto.placement,
        totalKills: dto.kills,
        manualTotalKills: dto.kills !== undefined,
      },
    );

    await this.scoring.recomputeMatchAndTournament(matchId);
    const baseState = await this.buildState(match);
    const saved = await this.persistAndBroadcast(
      matchId,
      baseState,
      dto.version,
    );
    const team = saved.teams.find((t) => t.teamId === dto.teamId);
    if (team) {
      this.gateway.emitTeamUpdate(matchId, team, saved.version);
    }
    return saved;
  }
}
