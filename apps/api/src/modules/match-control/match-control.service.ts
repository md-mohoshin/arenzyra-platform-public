import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  forwardRef,
} from '@nestjs/common';
import {
  MatchStatus,
  Prisma,
  AuditAction,
  LiveState,
  MatchDataSource,
  Role,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../db/prisma.service';
import type { Actor } from '../matches/matches.service';
import { ScoringService } from '../scoring/scoring.service';
import { MatchControlGateway } from './match-control.gateway';
import {
  CONTROL_STATES,
  ControlState,
  SetStatusDto,
  UpdateScoreDto,
} from './dto/control.dto';
import {
  computeAliveTeams,
  computeTotalTeams,
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
import type { AuthUser } from '../../common/auth/auth.types';
import { MatchConclusionService } from '../results/match-conclusion.service';
import { LiveStateMirrorService } from './live-state-mirror.service';
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
import { buildPcobBindingData } from '../../common/pcob-binding.util';
import { buildMatchPlayerKey } from '../../common/match-player-key.util';
import { derivePcobBindingFlags } from '../../common/match-telemetry-provider.util';
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
    state: ControlState;
    metaJson?: Prisma.JsonValue | null;
  } | null;
};

type MatchControlMeta = {
  resultFinalized?: boolean;
  finalizedAt?: string | null;
  winnerTeamId?: string | null;
  aliveTeamsAtEnd?: number | null;
  finalizationStartedAt?: string | null;
  resultNeedsConfirmation?: boolean;
  resultAmbiguities?: Array<{
    code: string;
    teamIds: string[];
    placementFrom: number;
    placementTo: number;
    detectedAt: string | null;
    message: string;
  }> | null;
} | null;

type LiveConflictCandidate = {
  id: string;
};

type AuthoritativeLifecycleSignal = {
  source?: string | null;
  sessionId?: string | null;
  winnerTeamId?: string | null;
};

const FINALIZATION_WARNING_THRESHOLD_MS = 60_000;
const MAX_INIT_WAIT_MS = 120_000;
const MIN_LIVE_DURATION_MS = 30_000;
const MIN_TELEMETRY_FINISH_ELIGIBLE_MS = 6 * 60_000;
const MIN_SINGLE_ALIVE_STABILITY_MS = 15_000;
const MIN_FINISH_CIRCLE_PHASE = 2;
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
  status: string | null;
  lifecycleStatus: string | null;
  controlStatus: PublicControlStatus;
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
  locks: MatchLockContract;
  finalizationStartedAt: string | null;
  finalizationDurationMs: number | null;
  telemetry: TelemetryRuntimeContract;
  binding: {
    sessionId: string | null;
    adapterKey: string | null;
    dataSource: string | null;
    dataMode: string | null;
    telemetryProvider: string;
    sourceMode: 'MANUAL' | 'AUTO';
    boundAt: string | null;
    lastSeenAt: string | null;
    isConfigured: boolean;
    isBound: boolean;
    isReady: boolean;
    pcobConfigured: boolean;
    pcobBound: boolean;
    pcobReady: boolean;
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
      throw new BadRequestException(
        'Session matches are not supported by match control',
      );
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

  private toControlStateFromMatch(status: MatchStatus): ControlState {
    return deriveControlStateFromMatchStatus(status);
  }

  private toLifecycleContext(match: {
    status: MatchStatus;
    liveState?: string | null;
    dataSource?: string | null;
    dataMode?: string | null;
    controlState?: {
      state?: ControlState | null;
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
      state?: ControlState | null;
      metaJson?: Prisma.JsonValue | null;
    } | null;
  }): PublicControlStatus {
    return derivePublicControlStatus(this.toLifecycleContext(match));
  }

  private toPublicStatus(
    status: MatchStatus,
    controlState?: ControlState | null,
    metaJson?: Prisma.JsonValue | null,
  ): 'UPCOMING' | 'LIVE' | 'ENDED' | 'PAUSED' | 'CANCELLED' {
    const publicControlStatus = derivePublicControlStatus({
      status,
      controlState,
      metaJson,
    });
    if (publicControlStatus === 'PAUSED') return 'PAUSED';
    if (publicControlStatus === 'LIVE') return 'LIVE';
    if (
      publicControlStatus === 'ENDED' ||
      publicControlStatus === 'CONFIRMED'
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
      state?: ControlState | null;
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
      adapterKey: binding.adapterKey,
      dataSource: match.dataSource ?? null,
      dataMode: match.dataMode ?? null,
      telemetryProvider: binding.telemetryProvider,
      sourceMode: binding.sourceMode,
      boundAt,
      lastSeenAt,
      isConfigured,
      isBound,
      isReady: binding.pcobReady,
      pcobConfigured: binding.pcobConfigured,
      pcobBound: binding.pcobBound,
      pcobReady: binding.pcobReady,
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
      derivePcobBindingFlags(match).telemetryProvider === MatchDataSource.PCOB
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
      return {
        finalizationStartedAt: null,
        finalizationDurationMs: null,
      };
    }

    const startedAtMs = Date.parse(finalizationStartedAt);
    if (!Number.isFinite(startedAtMs)) {
      this.delayedFinalizationWarnings.delete(match.id);
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
    } else {
      this.delayedFinalizationWarnings.delete(match.id);
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
        controlState: {
          select: {
            state: true,
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
    const telemetry = this.buildTelemetrySnapshot(match);
    const binding = this.buildBindingSnapshot(match);

    return {
      matchId: match.id,
      status: lifecycleStatus,
      lifecycleStatus,
      controlStatus: this.toPublicControlStatus(match),
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
        tournamentId: true,
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

    const candidates = await this.prisma.match.findMany({
      where: {
        tournamentId: currentMatch.tournamentId,
        deletedAt: null,
        id: { not: currentMatch.id },
      },
      select: {
        id: true,
        name: true,
        status: true,
        tournamentId: true,
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
    const jsonNull = Prisma.JsonNull as unknown as Prisma.InputJsonValue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return jsonNull;
    }

    const meta = { ...(value as Record<string, unknown>) };
    delete meta.resultFinalized;
    delete meta.finalizedAt;
    delete meta.winnerTeamId;
    delete meta.aliveTeamsAtEnd;
    delete meta.finalizationStartedAt;
    delete meta.resultNeedsConfirmation;
    delete meta.resultAmbiguities;
    delete meta.telemetryRuntime;
    delete meta.telemetrySequence;
    delete meta.telemetryUpdatedAt;
    delete meta.telemetryIngress;
    delete meta.liveSync;
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
        tournament: { select: { organizationId: true } },
        controlState: { select: { state: true, metaJson: true } },
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
    const nextMeta: Prisma.JsonObject = {
      ...(this.parseMeta(match.controlState?.metaJson) ?? {}),
      finalizationStartedAt,
    };
    const previousLifecycleStatus = lifecycleStatus;
    await this.prisma.$transaction([
      this.prisma.match.update({
        where: { id: matchId },
        data: { status: MatchStatus.FINISH_PENDING },
      }),
      this.prisma.matchControlState.upsert({
        where: { matchId },
        update: {
          state: 'ENDED',
          reason: 'OBSERVER_FINISH_DETECTED',
          metaJson: nextMeta,
          version: { increment: 1 },
          updatedAt: new Date(finalizationStartedAt),
        },
        create: {
          matchId,
          state: 'ENDED',
          reason: 'OBSERVER_FINISH_DETECTED',
          organizationId: this.requireMatchOrganizationId(match),
          metaJson: nextMeta,
          updatedAt: new Date(finalizationStartedAt),
        },
      }),
    ]);

    this.logger.log(`[Match] Finish detected matchId=${matchId}`);
    this.logger.log(`[Match] Entered FINISH_PENDING matchId=${matchId}`);
    this.logLifecycleTransition(
      matchId,
      previousLifecycleStatus,
      'ENDED',
      'OBSERVER_FINISH_DETECTED',
      {
        dbStatus: MatchStatus.FINISH_PENDING,
        finalizationStartedAt,
      },
    );

    try {
      await this.confirmFinishedIfEligible(matchId, 'OBSERVER_FINISH_DETECTED');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[Match] Finish confirmation deferred matchId=${matchId} reason=${message}`,
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
      select: { id: true, status: true },
    });
    if (!match) {
      throw new NotFoundException('Match not found');
    }
    if (isMatchFinishedStatus(match.status)) {
      return this.getLifecycleState(matchId);
    }
    if (
      !isMatchFinalizingStatus(match.status) &&
      !isMatchLiveStatus(match.status)
    ) {
      return this.getLifecycleState(matchId);
    }

    const slotResults = await this.prisma.matchSlotResult.findMany({
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

    if (!slotResults.length) {
      return this.getLifecycleState(matchId);
    }

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
    if (aliveTeams > 1) {
      return this.getLifecycleState(matchId);
    }

    await this.endMatch(SYSTEM_ACTOR, matchId, source);
    this.logger.log(`[Match] Match confirmed FINISHED matchId=${matchId}`);
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

    await this.prisma.match.update({
      where: { id: matchId },
      data: this.buildRunResetMatchData(match),
    });
    await this.prisma.matchControlState.upsert({
      where: { matchId },
      update: {
        state: 'READY',
        reason,
        metaJson: this.clearFinalizationMeta(controlState?.metaJson),
        version: { increment: 1 },
        updatedAt: now,
      },
      create: {
        matchId,
        state: 'READY',
        reason,
        organizationId: this.requireMatchOrganizationId(match),
        metaJson: this.clearFinalizationMeta(controlState?.metaJson),
        updatedAt: now,
      },
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
    status: 'UPCOMING' | 'LIVE' | 'ENDED' | 'PAUSED' | 'CANCELLED',
    organizationId: string | null | undefined,
  ) {
    this.realtime.emitMatchStatusUpdated(organizationId ?? null, {
      matchId,
      status,
      updatedAt: new Date().toISOString(),
    });
  }

  private async loadMatch(matchId: string): Promise<MatchSummary> {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        id: true,
        organizationId: true,
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
        controlState: { select: { state: true, metaJson: true } },
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
            { controlState: { state: 'PAUSED' } },
          ],
        },
        select: {
          id: true,
          organizationId: true,
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
          controlState: { select: { state: true, metaJson: true } },
        },
      });

      for (const match of liveMatches) {
        try {
          const summary: MatchSummary = {
            ...this.requireTournamentMatch(match),
            controlState: match.controlState ?? undefined,
          };
          const state = await this.buildState(summary);
          const saved = await this.liveStateMirror.publish(state);
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
        where: { matchId },
        select: {
          teamId: true,
          slotNumber: true,
          team: {
            select: {
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

    const slotMap = new Map(slots.map((s) => [s.teamId, s.slotNumber]));

    return teams.map((t) => {
      const stat = stats.find((entry) => entry.teamId === t.teamId) ?? null;
      const slot = slots.find((entry) => entry.teamId === t.teamId) ?? null;
      const slotPlayers = this.toLivePlayersFromSlotResult(
        t.teamId,
        stat?.slotNumber ?? slot?.slotNumber ?? null,
        stat?.players ?? [],
      );
      const fallbackPlayers =
        slotPlayers.length > 0
          ? slotPlayers
          : this.toLivePlayersFromSlotRoster(
              t.teamId,
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
        teamId: t.teamId,
        name: t.team?.name ?? null,
        tag: t.team?.tag ?? null,
        logoUrl: normalizePublicAssetUrl(t.team?.logoUrl),
        wasPresentInMatch: stat?.wasPresentInMatch ?? null,
        presenceStatus: derivePresenceStatus(stat?.wasPresentInMatch ?? null),
        slot: stat?.slotNumber ?? slotMap.get(t.teamId) ?? null,
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
    controlState?: ControlState | null,
  ): boolean {
    return (
      status === MatchStatus.LIVE ||
      controlState === 'LIVE' ||
      controlState === 'PAUSED'
    );
  }

  private cachedStateHasTelemetrySignal(state: LiveMatchState | null): boolean {
    if (!state) {
      return false;
    }

    const hasRosterSignal =
      (state.summary?.totalPlayers ?? 0) > 0 ||
      (state.summary?.alivePlayers ?? 0) > 0 ||
      state.teams.some((team) => {
        return (
          (team.totalPlayers ?? 0) > 0 ||
          (team.alivePlayers ?? 0) > 0 ||
          (team.players?.length ?? 0) > 0
        );
      });

    if (hasRosterSignal) {
      return true;
    }

    if ((state.killFeed?.length ?? 0) > 0 || (state.events?.length ?? 0) > 0) {
      return true;
    }

    return false;
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

  private playersForTelemetryTeam(
    snapshot: TelemetryMatchState,
    teamId: string,
  ) {
    return Object.values(snapshot.players ?? {})
      .filter((player) => player.teamId === teamId)
      .sort((left, right) => left.playerId.localeCompare(right.playerId));
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
    if (status === 'LOCKED') return 'ENDED';
    if (status === 'ENDED') return 'ENDED';
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
    const teams = Object.values(snapshot.teams ?? {})
      .sort((left, right) => this.sortTelemetryTeams(left, right))
      .map((team) => {
        const eliminated = team.alivePlayers === 0;
        return {
          teamId: team.teamId,
          name: team.metadata?.teamName ?? null,
          tag: team.metadata?.teamTag ?? null,
          slot: team.metadata?.slot ?? null,
          wasPresentInMatch: team.metadata?.wasPresentInMatch ?? null,
          presenceStatus: derivePresenceStatus(
            team.metadata?.wasPresentInMatch ?? null,
          ),
          kills: team.totalKills,
          placement: team.placement,
          points: null,
          logoUrl: normalizePublicAssetUrl(team.metadata?.logoUrl),
          alivePlayers: team.alivePlayers,
          totalPlayers: team.totalPlayers,
          alive: team.alivePlayers > 0,
          eliminated,
          sourceMode: snapshot.mode,
          updatedAt: new Date(snapshot.updatedAt).toISOString(),
          ownership: team.ownership,
          players: this.playersForTelemetryTeam(snapshot, team.teamId).map(
            (player) => ({
              id: player.playerId,
              playerId: player.playerId,
              externalPlayerId: player.metadata?.externalPlayerId ?? null,
              pubgPlayerId: player.metadata?.inGameId ?? null,
              name: player.metadata?.playerName ?? player.playerId,
              ign: player.metadata?.playerName ?? player.playerId,
              avatarUrl: normalizePublicAssetUrl(player.metadata?.avatarUrl),
              teamId: player.teamId,
              slot: team.metadata?.slot ?? null,
              alive: player.alive,
              knocked: player.knocked,
              eliminated: !player.alive,
              kills: player.kills,
              position: player.metadata?.position ?? null,
              updatedAt: new Date(snapshot.updatedAt).toISOString(),
              ownership: player.ownership,
            }),
          ),
        };
      });

    const winnerTeam = teams.find((team) => team.placement === 1) ?? null;
    const totalPlayers = teams.reduce(
      (sum, team) => sum + (team.totalPlayers ?? team.players?.length ?? 0),
      0,
    );
    const alivePlayers = teams.reduce(
      (sum, team) => sum + (team.alivePlayers ?? 0),
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
        totalTeams: teams.length,
        aliveTeams: snapshot.teamsAlive,
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

    return this.liveStateMirror.publish(
      this.toLiveStateFromTelemetrySnapshot(snapshot),
    );
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

  private async assertNoContestedLiveMatches(
    tx: Prisma.TransactionClient,
    startingMatchId: string,
    candidates: LiveConflictCandidate[],
  ): Promise<void> {
    for (const candidate of candidates) {
      const aliveTeams = await this.resolveLiveConflictAliveTeams(
        tx,
        candidate.id,
      );
      if (aliveTeams !== null && aliveTeams > 1) {
        throw new ConflictException(
          `Cannot start match ${startingMatchId} while match ${candidate.id} still has ${aliveTeams} teams alive. Resume or finish the existing match first.`,
        );
      }
    }
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
    const saved = await this.liveStateMirror.publish(publishableState);
    const orgId =
      ((state as unknown as { tournament?: { organizationId?: string | null } })
        ?.tournament?.organizationId as string | undefined) ?? null;
    this.gateway.emitMatchState(matchId, saved, orgId);
    void this.scoreboard.broadcast(matchId);
    return saved;
  }

  private async finalizeEndedMatch(
    matchId: string,
    reason: string = 'FINAL_RECALC',
  ): Promise<void> {
    try {
      const concluded = await this.conclusion.conclude(matchId, {
        source: reason,
      });
      if (!concluded) {
        this.logger.warn(
          `[MATCH_CONCLUSION] Skipped canonical finalization match=${matchId} reason=${reason}`,
        );
        return;
      }
      this.resultsEvents.emitMatchUpdate(matchId, { reason: 'final' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `[MATCH_CONCLUSION] Failed for match=${matchId} reason=${reason}: ${msg}`,
      );
    }
  }

  async getState(actor: Actor, matchId: string): Promise<LiveMatchState> {
    const match = await this.loadMatch(matchId);
    this.ensurePermission(
      actor,
      match.tournament.ownerUserId,
      match.tournament.organizationId,
    );
    let cached = await this.store.get(matchId);
    if (
      this.isLiveControlStatus(
        match.status,
        match.controlState?.state ?? null,
      ) &&
      !this.cachedStateHasTelemetrySignal(cached)
    ) {
      cached =
        (await this.hydrateMirrorFromPersistedTelemetry(matchId)) ?? cached;
    }
    if (cached) {
      const controlStatus = this.toPublicControlStatus(match);
      if (cached.status !== controlStatus) {
        // Sync cached state to DB status
        const base = await this.buildState(match);
        return this.persistAndBroadcast(matchId, base, cached.version);
      }
      // Keep live stats but refresh slot/team metadata from DB so control reflects slot changes
      const freshTeams = await this.loadTeams(match.id);
      const mergedTeams: TeamScoreState[] = freshTeams.map((fresh) => {
        const existing = cached.teams.find((t) => t.teamId === fresh.teamId);
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
          totalPlayers: existing?.totalPlayers ?? fresh.totalPlayers ?? null,
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
      const summary = this.summarizeAssignedTeams(mergedTeams);
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
      return this.persistAndBroadcast(matchId, updated, cached.version);
    }
    const fresh = await this.buildState(match);
    return this.persistAndBroadcast(matchId, fresh);
  }

  async startMatch(
    actor: Actor | null,
    matchId: string,
    sessionId?: string | null,
  ): Promise<LiveMatchState> {
    return this.setMatchLive(actor, matchId, sessionId);
  }

  private async setMatchLive(
    actor: Actor | null,
    matchId: string,
    sessionId?: string | null,
    reason: string = 'NEW_MATCH_WENT_LIVE',
  ): Promise<LiveMatchState> {
    const match = await this.loadMatch(matchId);
    if (actor) {
      this.ensurePermission(
        actor,
        match.tournament.ownerUserId,
        match.tournament.organizationId,
      );
    }
    const canReopenAutoEndedMatch =
      isMatchFinishedStatus(match.status) &&
      match.endedReason === 'AUTO_ENDED_BY_NEW_LIVE_MATCH';
    if (!canStartMatchForLifecycle(match.status) && !canReopenAutoEndedMatch) {
      throw new BadRequestException('Match has already finished');
    }
    await this.matchesService.validatePubgSlots(matchId);
    return this.setMatchLiveInternal(actor, matchId, match, sessionId, reason);
  }

  private async setMatchLiveInternal(
    actor: Actor | null,
    matchId: string,
    preloaded?: MatchSummary,
    sessionId?: string | null,
    reason: string = 'NEW_MATCH_WENT_LIVE',
  ): Promise<LiveMatchState> {
    const match = preloaded ?? (await this.loadMatch(matchId));
    const previousLifecycleStatus = deriveCanonicalMatchLifecycleStatus(
      this.toLifecycleContext(match),
    );
    const now = new Date();
    const hasPriorRun = this.hasPriorRun(match);
    const sessionBinding = this.resolveStartSessionBinding(match, sessionId);
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

    let endedIds: string[] = [];
    try {
      const txResult = await this.prisma.$transaction(async (tx) => {
        const liveInTournament =
          (await tx.match.findMany({
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
          })) ?? [];

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
        const ids = conflictCandidates.map((candidate) => candidate.id);
        if (ids.length) {
          await this.assertNoContestedLiveMatches(
            tx,
            matchId,
            conflictCandidates,
          );
          await tx.match.updateMany({
            where: { id: { in: ids } },
            data: {
              status: MatchStatus.ENDED,
              liveState: LiveState.ENDED,
              endedAt: now,
              endedReason: 'AUTO_ENDED_BY_NEW_LIVE_MATCH',
            },
          });
          await tx.matchControlState.updateMany({
            where: { matchId: { in: ids } },
            data: {
              state: 'ENDED',
              reason: 'AUTO_ENDED_BY_NEW_LIVE_MATCH',
              version: { increment: 1 },
              updatedAt: now,
            },
          });
          ids.forEach(
            (lockedId) =>
              void this.resultsEvents.emitResultsLockState(lockedId),
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
            ...(sessionBinding.sessionId
              ? buildPcobBindingData(sessionBinding.sessionId, now)
              : {}),
          },
        });
        const organizationId = this.requireMatchOrganizationId(match);
        const orgPatch = this.hasModelField(
          'MatchControlState',
          'organizationId',
        )
          ? { organizationId }
          : {};
        await tx.matchControlState.upsert({
          where: { matchId },
          update: {
            state: 'LIVE',
            reason,
            metaJson: this.clearFinalizationMeta(match.controlState?.metaJson),
            version: { increment: 1 },
            updatedAt: now,
            ...(orgPatch as Record<string, unknown>),
          },
          create: {
            matchId,
            state: 'LIVE',
            reason,
            organizationId,
            metaJson: this.clearFinalizationMeta(match.controlState?.metaJson),
          },
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
        if (remainingLive.length) {
          throw new ConflictException(
            'Another match is already LIVE for this organization',
          );
        }
        void this.resultsEvents.emitResultsLockState(matchId);
        // Starting a match is lifecycle-only. Slot seeding remains an explicit
        // action elsewhere so intentionally empty/unassigned slots stay untouched.
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
        return ids;
      });
      endedIds = txResult;
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

    await this.store.evictMatches([matchId]);

    // Broadcast ended matches
    for (const endedId of endedIds) {
      const endedMatch = await this.loadMatch(endedId);
      const endedState = await this.buildState({
        ...endedMatch,
        status: MatchStatus.ENDED,
        endedAt: new Date(),
        controlState: { state: 'ENDED' },
      });
      const saved = await this.persistAndBroadcast(endedId, endedState);
      this.gateway.emitMatchEnd(
        endedId,
        saved,
        endedMatch.tournament.organizationId,
      );
      this.gateway.emitMatchAutoEnd(
        endedId,
        saved,
        endedMatch.tournament.organizationId,
      );
      this.gateway.emitMatchStateChanged(
        endedId,
        'LIVE',
        'ENDED',
        reason,
        endedMatch.tournament.organizationId,
      );
      this.emitStatus(
        endedId,
        'ENDED',
        endedMatch.tournament.organizationId ?? null,
      );
      await this.audit.log({
        action: 'AUTO_END' as AuditAction,
        entityType: 'MATCH',
        entityId: endedId,
        userId: actor?.actorId ?? actor?.id ?? 'system',
        organizationId: endedMatch.tournament.organizationId,
        before: { status: match.status },
        after: {
          status: MatchStatus.ENDED,
          reason,
          triggeredByMatchId: matchId,
        },
        source: 'SYSTEM',
        reason,
      });
      await this.finalizeEndedMatch(endedId, 'AUTO_ENDED_BY_NEW_LIVE_MATCH');
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
    const savedLive = await this.persistAndBroadcast(matchId, liveState);
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
      },
    );
    void this.rankingEmitter.emitLiveRanking(matchId, { force: true });
    void this.rankingEmitter.emitOverallRanking(match.tournamentId, {
      force: true,
    });
    const liveStateUpdates: LiveStateUpdatePayload[] = [
      ...endedIds.map((id) => ({
        entity: 'MATCH' as const,
        id,
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
      matchStatus =
        match.controlState?.state ?? this.toControlStateFromMatch(match.status);
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
    await this.prisma.match.update({
      where: { id: matchId },
      data: {
        status: MatchStatus.ENDED,
        liveState: LiveState.ENDED,
        endedAt,
        endedReason: match.endedReason ?? reason,
      },
    });
    await this.prisma.matchControlState.upsert({
      where: { matchId },
      update: {
        state: 'ENDED',
        updatedAt: endedAt,
        version: { increment: 1 },
        reason,
      },
      create: {
        matchId,
        state: 'ENDED',
        reason,
        organizationId: this.requireMatchOrganizationId(match),
        updatedAt: endedAt,
      },
    });
    const baseState = await this.buildState({
      ...match,
      status: MatchStatus.ENDED,
      endedAt,
      controlState: { state: 'ENDED' },
    });
    const saved = await this.persistAndBroadcast(matchId, baseState);
    this.gateway.emitMatchEnd(matchId, saved);
    this.gateway.emitMatchStateChanged(
      matchId,
      previousControlState,
      'ENDED',
      reason,
      match.tournament.organizationId,
    );
    this.emitStatus(matchId, 'ENDED', match.tournament.organizationId ?? null);
    this.logLifecycleTransition(
      matchId,
      previousLifecycleStatus,
      'ENDED',
      reason,
      {
        dbStatus: MatchStatus.ENDED,
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
    await this.finalizeEndedMatch(matchId, reason);
    void this.broadcast.emitForMatch(matchId, 'match-status');
    return saved;
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
    const previousControlState =
      match.controlState?.state ?? this.toControlStateFromMatch(match.status);
    const newControlState = dto.status;
    const nextStatus = this.matchStateService.mapControlToBusinessStatus(
      dto.status,
      match.status,
    );
    if (nextStatus === MatchStatus.LIVE) {
      return this.setMatchLive(actor, matchId);
    }
    const data: Prisma.MatchUpdateInput = {};
    let liveStateChange: LiveState | undefined;
    if (nextStatus !== match.status) {
      data.status = nextStatus;
      if (nextStatus === MatchStatus.ENDED) {
        data.endedAt = new Date();
        liveStateChange = LiveState.ENDED;
        data.liveState = liveStateChange;
        data.liveAt = match.liveAt ?? match.startedAt ?? new Date();
      }
      if (nextStatus === MatchStatus.DRAFT) {
        Object.assign(data, this.buildRunResetMatchData(match));
        liveStateChange = LiveState.UPCOMING;
      }
    }
    if (Object.keys(data).length > 0) {
      await this.prisma.match.update({
        where: { id: matchId },
        data,
      });
    }
    await this.prisma.matchControlState.upsert({
      where: { matchId },
      update: {
        state: newControlState,
        ...(nextStatus === MatchStatus.DRAFT
          ? {
              metaJson: this.clearFinalizationMeta(
                match.controlState?.metaJson,
              ),
            }
          : {}),
        updatedAt: new Date(),
        version: { increment: 1 },
        reason: dto.status,
      },
      create: {
        matchId,
        state: newControlState,
        reason: dto.status,
        organizationId: this.requireMatchOrganizationId(match),
        ...(nextStatus === MatchStatus.DRAFT
          ? {
              metaJson: this.clearFinalizationMeta(
                match.controlState?.metaJson,
              ),
            }
          : {}),
        updatedAt: new Date(),
      },
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
          : nextStatus === MatchStatus.ENDED
            ? ((data.liveAt as Date | undefined) ??
              match.liveAt ??
              match.startedAt ??
              new Date())
            : match.liveAt,
      startedAt: nextStatus === MatchStatus.DRAFT ? null : match.startedAt,
      endedAt:
        nextStatus === MatchStatus.DRAFT
          ? null
          : nextStatus === MatchStatus.ENDED
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
        metaJson: (nextStatus === MatchStatus.DRAFT
          ? this.clearFinalizationMeta(match.controlState?.metaJson)
          : match.controlState?.metaJson) as
          | Prisma.JsonValue
          | null
          | undefined,
      },
    });
    const saved = await this.persistAndBroadcast(
      matchId,
      baseState,
      dto.version,
    );
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

    if (
      liveStateChange === LiveState.ENDED ||
      data.status === MatchStatus.ENDED
    ) {
      await this.finalizeEndedMatch(matchId, dto.status);
    }
    const publicStatus = this.toPublicStatus(
      (data.status as MatchStatus | undefined) ?? match.status,
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
