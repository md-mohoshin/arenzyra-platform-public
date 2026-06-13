import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { MatchStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { MatchControlService } from '../match-control/match-control.service';
import type { Actor } from '../matches/matches.service';
import { buildMatchPlayerKey } from '../../common/match-player-key.util';
import {
  hasManualOverride,
  readLiveSyncContract,
  type LiveSyncPlayerOwnership,
  type LiveSyncTeamOwnership,
} from '../../common/live-sync-contract.util';
import { derivePubgMatchState } from '../../common/pubg-match-rules.util';
import { deriveCanonicalMatchLifecycleStatus } from '../../common/match-status.util';
import { canonicalizeTelemetryRuntimeSource } from '../../common/telemetry-source.util';
import {
  type ControlCommand,
  type EngineEvent,
  type MatchEngineStatus,
  type TelemetryControlMode,
  type TelemetryMatchState,
  type TelemetryPlayerState,
  type TelemetryRosterState,
  type TelemetryTeamState,
} from './telemetry.types';
import { TelemetryValidatorService } from './telemetry-validator.service';
import { TelemetryPersistenceService } from './telemetry-persistence.service';
import { TelemetryBroadcastService } from './telemetry-broadcast.service';
import {
  TelemetryMappingService,
  type TelemetryPlayerMapping,
} from './telemetry-mapping.service';
import {
  MatchControlStateStore,
  type MatchStateObservedPlayer,
} from '../match-control/state.store';
import type {
  AdapterTelemetryEnvelope,
  AdapterTelemetryEvent,
  AdapterTelemetryPlayer,
  AdapterTelemetryTeam,
  AdapterTelemetryZone,
} from '../game-adapters/game-adapter.types';

const SYSTEM_ACTOR: Actor = {
  id: 'system',
  actorId: 'system',
  role: 'SUPER_ADMIN',
  actorRole: 'SUPER_ADMIN',
  organizationId: null,
  actingOrgId: null,
};

const asSnapshotState = (value: unknown): TelemetryMatchState | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as TelemetryMatchState;
};

const toIdentifier = (value: unknown): string => {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  return '';
};

const normalizeLookup = (value: unknown): string =>
  toIdentifier(value).trim().toLowerCase();

const toOptionalText = (value: unknown): string | null => {
  const normalized = toIdentifier(value);
  return normalized.length > 0 ? normalized : null;
};

const OPEN_ID_LIKE_MIN_LENGTH = 14;
const DEFAULT_PLAYER_PHOTO_MARKERS = [
  '/assets/default-player',
  '/assets/defaults/default-player',
  '/assets/players/default-player',
];

const isNumericText = (value: string): boolean => /^\d+$/.test(value);

const isRealPubgUidCandidate = (
  value: string | null | undefined,
  playerOpenId: string | null | undefined,
): value is string => {
  const trimmed = value?.trim() ?? '';
  if (!trimmed || !isNumericText(trimmed)) {
    return false;
  }
  const openId = playerOpenId?.trim() ?? '';
  if (openId && trimmed === openId) {
    return false;
  }
  return trimmed.length < OPEN_ID_LIKE_MIN_LENGTH;
};

const isUsefulPlayerPhotoUrl = (value: string | null | undefined): boolean => {
  const normalized = value?.trim();
  if (!normalized) {
    return false;
  }
  const lower = normalized.toLowerCase();
  return !DEFAULT_PLAYER_PHOTO_MARKERS.some((marker) => lower.includes(marker));
};

const normalizeNonNegativeInteger = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : null;
  }
  return null;
};

const normalizePositiveInteger = (value: unknown): number | null => {
  const normalized = normalizeNonNegativeInteger(value);
  return normalized !== null && normalized > 0 ? normalized : null;
};

const normalizeHealthValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(100, value));
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : null;
  }
  return null;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const extractRawPlayerHealth = (
  record: Record<string, unknown>,
  depth = 0,
): number | null => {
  const directHealth = normalizeHealthValue(
    record.health ??
      record.Health ??
      record.hp ??
      record.HP ??
      record.currentHealth ??
      record.CurrentHealth,
  );
  if (directHealth !== null) {
    return directHealth;
  }
  if (depth >= 3) {
    return null;
  }

  const nestedRaw = asRecord(record.raw);
  return nestedRaw && nestedRaw !== record
    ? extractRawPlayerHealth(nestedRaw, depth + 1)
    : null;
};

const normalizeAdapterPlayerHealth = (
  player: AdapterTelemetryPlayer,
): number | null => {
  const directHealth = normalizeHealthValue(player.health);
  if (directHealth !== null) {
    return directHealth;
  }

  const raw = asRecord(player.raw);
  return raw ? extractRawPlayerHealth(raw) : null;
};

const PARACHUTE_TRANSITION_STABILITY_TICKS = 8;
const PARACHUTE_PARTIAL_PLAYER_RATIO = 0.75;
const EARLY_AIR_ELIMINATION_GUARD_MS = 3 * 60_000;

const toTelemetryControlMode = (value: unknown): TelemetryControlMode => {
  const normalized =
    typeof value === 'string' ? value.trim().toUpperCase() : '';
  return normalized === 'MANUAL' ? 'MANUAL' : 'API';
};

type MutationResult = {
  state: TelemetryMatchState;
  ignored?: boolean;
  reason?: string | null;
};

type AdapterSnapshotApplyResult = {
  incomingPlayers: number;
  mappedPlayers: number;
  expectedPlayers: number;
  mappingConfidence: number;
  lockedMappings: number;
  mappingStability: number;
  aggregateUpdatesAllowed: boolean;
  runtimeUpdatesApplied: boolean;
  eliminationUpdatesBlocked: boolean;
  blockedPlayerEliminations: number;
  blockedPlayerKillUpdates: number;
  incomingAlivePlayers: number;
  incomingDeadPlayers: number;
  positionlessPlayers: number;
  teamTelemetryUpdated: boolean;
};

type AdapterTickContext = {
  matchId: string;
  source: string;
  sessionId: string | null;
  sequence: number | null;
  timestamp: number;
  phase: number | null;
  players: number;
  teams: number;
  events: number;
};

type IncomingAdapterPlayer = {
  player: AdapterTelemetryPlayer;
  parentTeam: AdapterTelemetryTeam | null;
  playerIndex: number | null;
};

type ResolvedAdapterPlayer = {
  playerKey: string;
  teamId: string;
  mapping: TelemetryPlayerMapping | null;
};

type ResolvedAdapterEventPlayer = {
  player: TelemetryPlayerState;
  teamId: string;
  mapping: TelemetryPlayerMapping | null;
};

type DerivedStateOptions = {
  updateTeamAggregates?: boolean;
};

type PendingManualOverrides = {
  players: Record<string, Array<keyof LiveSyncPlayerOwnership>>;
  teams: Record<string, Array<keyof LiveSyncTeamOwnership>>;
};

type PersistedOverridePlayerState = {
  playerId: string;
  teamId: string;
  alive: boolean;
  knocked: boolean;
  health?: number | null;
  kills: number;
  assists: number;
  metadata?: TelemetryPlayerState['metadata'];
  ownership?: LiveSyncPlayerOwnership;
};

type PersistedOverrideTeamState = {
  teamId: string;
  alivePlayers: number;
  eliminated: boolean;
  placement: number | null;
  totalKills: number;
  totalPlayers: number;
  eliminatedAt: number | null;
  metadata?: TelemetryTeamState['metadata'];
  ownership?: LiveSyncTeamOwnership;
};

type PersistedOverrideSnapshot = {
  mode: TelemetryControlMode;
  version: number;
  players: Map<string, PersistedOverridePlayerState>;
  teams: Map<string, PersistedOverrideTeamState>;
};

type AcceptedTelemetryRun = {
  sessionId: string | null;
  lastAcceptedSequence: number | null;
  hasAcceptedLiveTelemetry: boolean;
  lastAcceptedAt: number | null;
  lastAcceptedSource: string | null;
};

type ParachuteFieldShapeSample = {
  index: number;
  source: 'root' | 'team';
  playerId: boolean;
  playerOpenId: boolean;
  externalPlayerId: boolean;
  playerName: boolean;
  teamId: boolean;
  teamNo: boolean;
  teamSlot: boolean;
};

type ParachuteFieldShapeSummary = {
  total: number;
  playerId: number;
  playerOpenId: number;
  externalPlayerId: number;
  playerName: number;
  teamId: number;
  teamNo: number;
  teamSlot: number;
  samples: ParachuteFieldShapeSample[];
};

type ParachuteTransitionWindow = {
  remainingTicks: number;
  stablePlayers: number;
  stableTeams: number;
  lastSequence: number | null;
  lastPhase: number | null;
  lastState: string | null;
};

type PhaseTransitionTrace = {
  matchId: string;
  source: string;
  sessionId: string | null;
  sequence: number | null;
  timestamp: number;
  previousStatus: MatchEngineStatus;
  previousPhase: number | null;
  nextPhase: number | null;
  phaseChanged: boolean;
  currentPlayers: number;
  incomingPlayers: number;
  currentTeams: number;
  incomingTeams: number;
  overlapPlayers: number;
  overlapRatio: number;
  sharpPlayerDrop: boolean;
  sessionChanged: boolean;
  liveSignalWhilePending: boolean;
  transitionLike: boolean;
  currentPlayerIds: string[];
  incomingPlayerIds: string[];
  currentTeamIds: string[];
  incomingTeamIds: string[];
  packetState: string | null;
  parachuteSignal: boolean;
  parachuteWindowActive: boolean;
  parachuteWindowRemaining: number;
  parachuteStablePlayers: number;
  parachuteStableTeams: number;
  partialTransitionSnapshot: boolean;
  fieldShape: ParachuteFieldShapeSummary;
};

type EliminationSafetyContext = {
  phase: number | null;
  preCombatPhase: boolean;
  airPhase: boolean;
  unstableTransitionPacket: boolean;
  sharpAliveDrop: boolean;
  zeroAliveCollapse: boolean;
  idChurn: boolean;
  missingPositions: boolean;
  blockPlayerKillUpdates: boolean;
  blockPlayerLifeUpdates: boolean;
  blockTeamAggregateUpdates: boolean;
  resetPreCombatCriticalState: boolean;
  previousAlivePlayers: number;
  incomingAlivePlayers: number;
  incomingDeadPlayers: number;
  positionlessPlayers: number;
  hasExplicitKillEvents: boolean;
  hasCombatEvidence: boolean;
  reason: string | null;
};

type FreshTeamTelemetry = {
  alivePlayers: number | null;
  totalPlayers: number | null;
  kills: number | null;
  placement: number | null;
};

@Injectable()
export class TelemetryEngineService {
  private readonly logger = new Logger(TelemetryEngineService.name);
  private readonly runtimes = new Map<string, TelemetryMatchState>();
  private readonly acceptedRuns = new Map<string, AcceptedTelemetryRun>();
  private readonly playerIdentitySyncCache = new Set<string>();
  private readonly parachuteWindows = new Map<
    string,
    ParachuteTransitionWindow
  >();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => MatchControlService))
    private readonly matchControl: MatchControlService,
    private readonly validator: TelemetryValidatorService,
    private readonly persistence: TelemetryPersistenceService,
    private readonly broadcast: TelemetryBroadcastService,
    @Optional()
    private readonly stateStore: MatchControlStateStore = null as never,
    @Optional()
    private readonly mapping: TelemetryMappingService = null as never,
  ) {}

  async getState(matchId: string): Promise<TelemetryMatchState> {
    const runtime = this.runtimes.get(matchId);
    if (runtime) {
      const refreshed =
        (await this.refreshRuntimeForMatchBoundary(matchId, runtime)) ??
        runtime;
      const current = this.cloneState(refreshed);
      this.sanitizeTelemetryState(current, {
        reason: 'GET_STATE',
        timestamp: current.updatedAt,
        recomputeDerivedState: true,
      });
      await this.reconcileWithPersistedSync(current);
      await this.syncStateVersionWithMirror(current);
      this.runtimes.set(matchId, this.cloneState(current));
      if (refreshed !== runtime) {
        this.resetAcceptedRun(matchId, current);
      } else if (!this.acceptedRuns.has(matchId)) {
        this.getAcceptedRun(matchId, current);
      }
      return current;
    }

    const loaded = await this.loadState(matchId, { preferSnapshot: true });
    this.runtimes.set(matchId, loaded);
    this.resetAcceptedRun(matchId, loaded);
    return this.cloneState(loaded);
  }

  private async refreshRuntimeForMatchBoundary(
    matchId: string,
    runtime: TelemetryMatchState,
  ): Promise<TelemetryMatchState | null> {
    if (!this.prisma.match?.findUnique) {
      return null;
    }

    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        status: true,
        startedAt: true,
        endedAt: true,
        controlState: {
          select: {
            state: true,
          },
        },
      },
    });
    if (!match) {
      throw new NotFoundException('Match not found');
    }

    const expectedStatus = this.toEngineStatus(
      match.status,
      match.controlState?.state ?? null,
    );
    const startedAt = match.startedAt?.getTime() ?? null;
    const endedAt = match.endedAt?.getTime() ?? null;
    if (
      runtime.status === expectedStatus &&
      (runtime.startedAt ?? null) === startedAt &&
      (runtime.endedAt ?? null) === endedAt
    ) {
      return null;
    }

    this.logger.warn(
      JSON.stringify({
        stage: 'telemetry-engine',
        action: 'runtime-reset-after-match-boundary',
        matchId,
        runtimeStatus: runtime.status,
        expectedStatus,
        runtimeStartedAt: runtime.startedAt ?? null,
        persistedStartedAt: startedAt,
        runtimeEndedAt: runtime.endedAt ?? null,
        persistedEndedAt: endedAt,
      }),
    );
    // Preserve the last persisted telemetry snapshot when crossing into LIVE /
    // ENDED / LOCKED boundaries. Rebuilding from slot results at this point
    // drops observed presence, kills, and placements because slot rows are only
    // a compatibility mirror during live ingest.
    return this.loadState(matchId, {
      refresh: true,
      preferSnapshot: expectedStatus !== 'PENDING',
    });
  }

  async setMode(
    matchId: string,
    mode: TelemetryControlMode,
  ): Promise<TelemetryMatchState> {
    const current = await this.getState(matchId);
    const next = this.cloneState(current);
    next.mode = toTelemetryControlMode(mode);
    next.version = current.version + 1;
    next.updatedAt = Date.now();
    await this.reconcileWithPersistedSync(next);
    await this.persistence.persistState(next);
    this.runtimes.set(matchId, this.cloneState(next));
    await this.broadcast.broadcastState(next);
    return next;
  }

  async republishMirror(matchId: string): Promise<TelemetryMatchState> {
    const current = await this.loadState(matchId, {
      refresh: true,
      preferSnapshot: false,
    });
    this.resetAcceptedRun(matchId, current);
    const mirrored = await this.stateStore?.get(matchId);
    const mirroredVersion =
      typeof mirrored?.version === 'number' ? mirrored.version : null;
    const next = this.cloneState(current);
    next.version =
      mirroredVersion === null
        ? current.version + 1
        : current.version > mirroredVersion
          ? current.version
          : mirroredVersion + 1;
    next.updatedAt = Date.now();
    await this.reconcileWithPersistedSync(next);
    await this.persistence.persistState(next);
    this.runtimes.set(matchId, this.cloneState(next));
    await this.broadcast.broadcastState(next);
    return next;
  }

  async applyAdapterTelemetryEnvelope(
    envelope: AdapterTelemetryEnvelope,
    source?: string | null,
  ): Promise<MutationResult> {
    let current = await this.getState(envelope.matchId);
    let acceptedRun = this.getAcceptedRun(envelope.matchId, current);
    const orderedEvents = [...(envelope.events ?? [])].sort(
      (left, right) => left.timestamp - right.timestamp,
    );
    const resolvedSource =
      canonicalizeTelemetryRuntimeSource(
        source ?? envelope.source ?? 'ADAPTER',
      ) ?? 'ADAPTER';
    const sessionId = this.toAdapterSessionId(envelope.sessionId);
    const adapterSequence = this.toAdapterSequence(envelope.sequence);
    const tickContext = this.buildAdapterTickContext(
      envelope,
      resolvedSource,
      sessionId,
      adapterSequence,
    );
    const hasLiveSignal = this.hasLiveTelemetrySignal(envelope, orderedEvents);
    let phaseTrace = this.recordParachuteTransitionTick(
      this.buildPhaseTransitionTrace(current, envelope, {
        source: resolvedSource,
        sessionId,
        sequence: adapterSequence,
        timestamp: envelope.timestamp,
        acceptedRun,
        hasLiveSignal,
      }),
    );
    this.logPhaseTransitionBefore(phaseTrace);
    this.logParachuteTransitionTick(phaseTrace);

    if (
      sessionId &&
      acceptedRun.sessionId &&
      acceptedRun.sessionId !== sessionId
    ) {
      if (
        this.shouldPreserveRuntimeAcrossPhaseTransition(current, phaseTrace)
      ) {
        this.logPhaseTransitionReset(phaseTrace, {
          action: 'session-change-runtime-reset-blocked',
          reason: 'PHASE_TRANSITION_STABLE_RUNTIME',
        });
      } else {
        this.logPhaseTransitionReset(phaseTrace, {
          action: 'session-change-runtime-reset',
          reason: 'SESSION_CHANGED',
        });
        current = await this.resetRuntimeForAcceptedRun(envelope.matchId, {
          reason: 'SESSION_CHANGED',
          trace: phaseTrace,
        });
        acceptedRun = this.resetAcceptedRun(envelope.matchId, current);
        phaseTrace = this.buildPhaseTransitionTrace(current, envelope, {
          source: resolvedSource,
          sessionId,
          sequence: adapterSequence,
          timestamp: envelope.timestamp,
          acceptedRun,
          hasLiveSignal,
        });
      }
    } else if (current.status !== 'LIVE' && hasLiveSignal) {
      if (
        this.shouldPreserveRuntimeAcrossPhaseTransition(current, phaseTrace)
      ) {
        this.logPhaseTransitionReset(phaseTrace, {
          action: 'pending-live-signal-runtime-reset-blocked',
          reason: 'PHASE_TRANSITION_STABLE_RUNTIME',
        });
      } else {
        this.logPhaseTransitionReset(phaseTrace, {
          action: 'pending-live-signal-runtime-reset',
          reason: 'LIVE_SIGNAL_WHILE_PENDING',
        });
        this.mapping?.reset(envelope.matchId);
        current = await this.resetRuntimeForAcceptedRun(envelope.matchId, {
          reason: 'LIVE_SIGNAL_WHILE_PENDING',
          trace: phaseTrace,
        });
        acceptedRun = this.resetAcceptedRun(envelope.matchId, current);
        phaseTrace = this.buildPhaseTransitionTrace(current, envelope, {
          source: resolvedSource,
          sessionId,
          sequence: adapterSequence,
          timestamp: envelope.timestamp,
          acceptedRun,
          hasLiveSignal,
        });
      }
    }

    if (
      sessionId &&
      adapterSequence !== null &&
      acceptedRun.sessionId === sessionId &&
      acceptedRun.lastAcceptedSequence !== null &&
      adapterSequence <= acceptedRun.lastAcceptedSequence
    ) {
      this.setAcceptedRun(
        envelope.matchId,
        this.advanceAcceptedRun(acceptedRun, {
          sessionId,
          sequence: adapterSequence,
          hasLiveTelemetry: false,
          timestamp: envelope.timestamp,
          source: resolvedSource,
        }),
      );
      return this.finalizeIgnoredAdapterTick(
        current,
        tickContext,
        'STALE_ACCEPTED_SEQUENCE',
      );
    }

    const next = this.cloneState(current);
    const snapshotApplyResult = await this.applyAdapterSnapshot(
      next,
      envelope,
      resolvedSource,
      phaseTrace,
    );
    if (hasLiveSignal && snapshotApplyResult.runtimeUpdatesApplied) {
      next.telemetryAcceptedAt = envelope.timestamp;
      next.telemetryAcceptedSource = resolvedSource;
    }
    if (phaseTrace.liveSignalWhilePending && next.status === 'PENDING') {
      next.status = 'LIVE';
      next.startedAt = next.startedAt ?? envelope.timestamp;
      next.endedAt = null;
    }
    const holdAggregateUpdatesForPhaseTransition =
      this.shouldHoldAggregateUpdatesForPhaseTransition(phaseTrace);
    const updateTeamAggregates =
      snapshotApplyResult.aggregateUpdatesAllowed &&
      !snapshotApplyResult.eliminationUpdatesBlocked &&
      !holdAggregateUpdatesForPhaseTransition;
    this.logParachutePartialSnapshotBlocked(phaseTrace, snapshotApplyResult);
    if (snapshotApplyResult.aggregateUpdatesAllowed && !updateTeamAggregates) {
      this.logger.warn(
        JSON.stringify({
          tag: '[PHASE TRANSITION][RESET]',
          stage: 'telemetry-engine',
          action: 'partial-transition-aggregate-update-blocked',
          matchId: envelope.matchId,
          source: resolvedSource,
          sequence: adapterSequence,
          previousPhase: phaseTrace.previousPhase,
          nextPhase: phaseTrace.nextPhase,
          currentPlayers: phaseTrace.currentPlayers,
          incomingPlayers: phaseTrace.incomingPlayers,
          overlapPlayers: phaseTrace.overlapPlayers,
          eliminationUpdatesBlocked:
            snapshotApplyResult.eliminationUpdatesBlocked,
          blockedPlayerEliminations:
            snapshotApplyResult.blockedPlayerEliminations,
          blockedPlayerKillUpdates:
            snapshotApplyResult.blockedPlayerKillUpdates,
          incomingAlivePlayers: snapshotApplyResult.incomingAlivePlayers,
          incomingDeadPlayers: snapshotApplyResult.incomingDeadPlayers,
          reason: phaseTrace.partialTransitionSnapshot
            ? 'PARACHUTE_PARTIAL_TRANSITION_SNAPSHOT'
            : snapshotApplyResult.eliminationUpdatesBlocked
              ? 'EARLY_AIR_ELIMINATION_UPDATES_BLOCKED'
              : 'SHARP_PLAYER_DROP_DURING_PHASE_TRANSITION',
        }),
      );
    }
    this.recomputeDerivedState(next, envelope.timestamp, {
      updateTeamAggregates,
    });
    const unsafeFreshTeamTelemetry =
      snapshotApplyResult.eliminationUpdatesBlocked ||
      holdAggregateUpdatesForPhaseTransition;
    if (snapshotApplyResult.teamTelemetryUpdated && !unsafeFreshTeamTelemetry) {
      this.applyFreshTeamTelemetryState(next, envelope.timestamp);
    } else if (
      (!updateTeamAggregates || snapshotApplyResult.incomingPlayers === 0) &&
      !unsafeFreshTeamTelemetry
    ) {
      this.applyFreshTeamTelemetryState(next, envelope.timestamp);
    } else if (
      snapshotApplyResult.teamTelemetryUpdated &&
      unsafeFreshTeamTelemetry
    ) {
      const discardedFreshTeamAggregates =
        this.discardFreshTeamTelemetryAggregates(next, envelope.timestamp);
      this.logger.warn(
        JSON.stringify({
          tag: '[PHASE TRANSITION][RESET]',
          stage: 'telemetry-engine',
          action: 'fresh-team-telemetry-aggregate-blocked',
          matchId: envelope.matchId,
          source: resolvedSource,
          sequence: adapterSequence,
          previousPhase: phaseTrace.previousPhase,
          nextPhase: phaseTrace.nextPhase,
          incomingPlayers: snapshotApplyResult.incomingPlayers,
          eliminationUpdatesBlocked:
            snapshotApplyResult.eliminationUpdatesBlocked,
          blockedPlayerEliminations:
            snapshotApplyResult.blockedPlayerEliminations,
          blockedPlayerKillUpdates:
            snapshotApplyResult.blockedPlayerKillUpdates,
          discardedFreshTeamAggregates,
          holdAggregateUpdatesForPhaseTransition,
          reason: snapshotApplyResult.eliminationUpdatesBlocked
            ? 'EARLY_AIR_ELIMINATION_UPDATES_BLOCKED'
            : 'PHASE_TRANSITION_TEAM_TELEMETRY_HELD',
        }),
      );
    }
    try {
      await this.reconcileWithPersistedSync(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        JSON.stringify({
          tag: '[TELEMETRY][BLOCKED]',
          stage: 'telemetry-engine',
          action: 'persisted-sync-reconcile-failed',
          matchId: envelope.matchId,
          source: resolvedSource,
          sessionId,
          sequence: adapterSequence,
          timestamp: envelope.timestamp,
          message,
        }),
      );
    }
    this.logPhaseTransitionAfter(phaseTrace, next);

    const requestedEndTransition = this.isEndTransition(current, next);
    const hasExplicitEndSignal = orderedEvents.some(
      (event) => event.type === 'MATCH_END',
    );
    const nextAcceptedRun = this.advanceAcceptedRun(acceptedRun, {
      sessionId,
      sequence: adapterSequence,
      hasLiveTelemetry: hasLiveSignal,
      timestamp: envelope.timestamp,
      source: resolvedSource,
    });
    const endSignalTimestamp = this.getEndSignalTimestamp(
      orderedEvents,
      envelope.timestamp,
    );
    let blockedEndTransition = false;
    if (requestedEndTransition && !hasExplicitEndSignal) {
      this.setAcceptedRun(envelope.matchId, nextAcceptedRun);
      this.logAdapterMatchEndRejected({
        reason: 'MISSING_EXPLICIT_END_EVENT',
        matchId: envelope.matchId,
        source: resolvedSource,
        currentStatus: current.status,
        currentSequence: current.sequence,
        envelopeTimestamp: envelope.timestamp,
        eventTypes: orderedEvents.map((event) => event.type),
        telemetryAcceptedAt: nextAcceptedRun.lastAcceptedAt,
        telemetryAcceptedSource: nextAcceptedRun.lastAcceptedSource,
        endSignalTimestamp,
      });
      blockedEndTransition = true;
    } else if (
      requestedEndTransition &&
      !this.hasAcceptedLiveTelemetry(acceptedRun)
    ) {
      this.setAcceptedRun(envelope.matchId, nextAcceptedRun);
      this.logAdapterMatchEndRejected({
        reason: 'NO_PRIOR_LIVE_TELEMETRY',
        matchId: envelope.matchId,
        source: resolvedSource,
        currentStatus: current.status,
        currentSequence: current.sequence,
        envelopeTimestamp: envelope.timestamp,
        eventTypes: orderedEvents.map((event) => event.type),
        telemetryAcceptedAt: acceptedRun.lastAcceptedAt,
        telemetryAcceptedSource: acceptedRun.lastAcceptedSource,
        endSignalTimestamp,
      });
      blockedEndTransition = true;
    } else if (
      requestedEndTransition &&
      normalizeLookup(resolvedSource) === 'pcob_api' &&
      !this.hasSessionScopedLiveTelemetry(acceptedRun)
    ) {
      this.setAcceptedRun(envelope.matchId, nextAcceptedRun);
      this.logAdapterMatchEndRejected({
        reason: 'SESSION_SCOPED_LIVE_TELEMETRY_REQUIRED',
        matchId: envelope.matchId,
        source: resolvedSource,
        currentStatus: current.status,
        currentSequence: current.sequence,
        envelopeTimestamp: envelope.timestamp,
        eventTypes: orderedEvents.map((event) => event.type),
        telemetryAcceptedAt: acceptedRun.lastAcceptedAt,
        telemetryAcceptedSource: acceptedRun.lastAcceptedSource,
        endSignalTimestamp,
      });
      blockedEndTransition = true;
    } else if (
      requestedEndTransition &&
      endSignalTimestamp !== null &&
      acceptedRun.lastAcceptedAt !== null &&
      endSignalTimestamp < acceptedRun.lastAcceptedAt
    ) {
      this.setAcceptedRun(envelope.matchId, nextAcceptedRun);
      this.logAdapterMatchEndRejected({
        reason: 'STALE_END_TRIGGER',
        matchId: envelope.matchId,
        source: resolvedSource,
        currentStatus: current.status,
        currentSequence: current.sequence,
        envelopeTimestamp: envelope.timestamp,
        eventTypes: orderedEvents.map((event) => event.type),
        telemetryAcceptedAt: acceptedRun.lastAcceptedAt,
        telemetryAcceptedSource: acceptedRun.lastAcceptedSource,
        endSignalTimestamp,
      });
      blockedEndTransition = true;
    }
    if (blockedEndTransition) {
      this.restoreRejectedEndTransition(current, next);
    }

    if (this.stateSignature(current) === this.stateSignature(next)) {
      this.setAcceptedRun(envelope.matchId, nextAcceptedRun);
      return this.finalizeIgnoredAdapterTick(
        current,
        tickContext,
        'NO_STATE_CHANGE',
        {
          runtimeUpdatesApplied: snapshotApplyResult.runtimeUpdatesApplied,
          aggregateUpdatesAllowed: snapshotApplyResult.aggregateUpdatesAllowed,
          mappedPlayers: snapshotApplyResult.mappedPlayers,
          expectedPlayers: snapshotApplyResult.expectedPlayers,
          lockedMappings: snapshotApplyResult.lockedMappings,
          mappingStability: snapshotApplyResult.mappingStability,
        },
      );
    }

    next.version = current.version + 1;
    next.sequence = current.sequence + Math.max(orderedEvents.length, 1);
    next.updatedAt = envelope.timestamp;
    const transitionedToEnded = this.isEndTransition(current, next);
    this.logAdapterTickProcessed(tickContext, next, {
      ignored: false,
      reason: blockedEndTransition ? 'MATCH_END_BLOCKED_PARTIAL_ACCEPT' : null,
      publishMode: 'transition',
    });
    this.logPipelineEngineStateBuilt(tickContext, next, {
      outcome: 'built',
      reason: blockedEndTransition ? 'MATCH_END_BLOCKED_PARTIAL_ACCEPT' : null,
      publishMode: 'transition',
      runtimeUpdatesApplied: snapshotApplyResult.runtimeUpdatesApplied,
      aggregateUpdatesAllowed: snapshotApplyResult.aggregateUpdatesAllowed,
      mappedPlayers: snapshotApplyResult.mappedPlayers,
      expectedPlayers: snapshotApplyResult.expectedPlayers,
      lockedMappings: snapshotApplyResult.lockedMappings,
      mappingStability: snapshotApplyResult.mappingStability,
    });
    if (transitionedToEnded) {
      this.logger.log(
        JSON.stringify({
          stage: 'telemetry-engine',
          action: 'telemetry-engine.match-end-triggered',
          trigger: 'ADAPTER_MATCH_END',
          reason: 'EXPLICIT_MATCH_END_EVENT',
          matchId: envelope.matchId,
          source: resolvedSource,
          envelopeTimestamp: envelope.timestamp,
          currentSequence: current.sequence,
          nextSequence: next.sequence,
          telemetryAcceptedAt: acceptedRun.lastAcceptedAt ?? null,
          eventTypes: orderedEvents.map((event) => event.type),
        }),
      );
    }
    this.setAcceptedRun(envelope.matchId, nextAcceptedRun);
    await this.commitTransition(current, next, null);
    return { state: next };
  }

  async applyTelemetryEvent(event: EngineEvent): Promise<MutationResult> {
    let current = await this.getState(event.matchId);
    if (event.type === 'MATCH_STARTED' && current.status !== 'LIVE') {
      await this.prepareMatchStart(event.matchId, null);
      current = await this.loadState(event.matchId, {
        refresh: true,
        preferSnapshot: false,
      });
    }

    this.validator.validateTelemetryEvent(current, event);
    const next = this.cloneState(current);
    this.applyEventMutation(next, event);
    const acceptedSource =
      canonicalizeTelemetryRuntimeSource(event.source) ?? event.source;
    if (event.type !== 'MATCH_STARTED' && event.type !== 'MATCH_ENDED') {
      next.telemetryAcceptedAt = event.timestamp;
      next.telemetryAcceptedSource = acceptedSource;
      const currentRun = this.getAcceptedRun(event.matchId, current);
      this.setAcceptedRun(
        event.matchId,
        this.advanceAcceptedRun(currentRun, {
          sessionId: currentRun.sessionId,
          sequence: event.sequence,
          hasLiveTelemetry: true,
          timestamp: event.timestamp,
          source: acceptedSource,
        }),
      );
    }
    this.recomputeDerivedState(next, event.timestamp);
    await this.reconcileWithPersistedSync(next);
    next.version = current.version + 1;
    next.sequence = Math.max(next.sequence, event.sequence);
    next.updatedAt = event.timestamp;
    if (event.type === 'MATCH_ENDED') {
      this.logger.log(
        JSON.stringify({
          stage: 'telemetry-engine',
          action: 'telemetry-engine.match-end-triggered',
          trigger: 'ENGINE_EVENT',
          reason: 'EXPLICIT_MATCH_ENDED_EVENT',
          matchId: event.matchId,
          source: event.source,
          sequence: event.sequence,
          timestamp: event.timestamp,
        }),
      );
    }
    await this.commitTransition(current, next, null);
    return { state: next };
  }

  async applyCommand(
    command: ControlCommand,
    actor?: Actor | null,
  ): Promise<MutationResult> {
    let current =
      command.type === 'START_MATCH'
        ? await this.loadState(command.matchId, {
            refresh: true,
            preferSnapshot: false,
          })
        : await this.getState(command.matchId);

    if (command.type === 'START_MATCH' && current.status !== 'LIVE') {
      await this.prepareMatchStart(command.matchId, actor ?? null);
      current = await this.loadState(command.matchId, {
        refresh: true,
        preferSnapshot: false,
      });
    }

    this.validator.validateControlCommand(current, command);
    const next = this.cloneState(current);
    const pendingManualOverrides = this.applyCommandMutation(next, command);
    this.recomputeDerivedState(next, command.timestamp ?? Date.now());
    await this.reconcileWithPersistedSync(next, pendingManualOverrides);
    next.version = current.version + 1;
    next.sequence = current.sequence + 1;
    next.updatedAt = command.timestamp ?? Date.now();
    if (command.type === 'END_MATCH') {
      this.logger.log(
        JSON.stringify({
          stage: 'telemetry-engine',
          action: 'telemetry-engine.match-end-triggered',
          trigger: 'CONTROL_COMMAND',
          reason: 'MANUAL_END_MATCH_COMMAND',
          matchId: command.matchId,
          source: command.source ?? 'MANUAL',
          sequence: next.sequence,
          timestamp: next.updatedAt,
        }),
      );
    }
    await this.commitTransition(current, next, actor ?? null);
    return { state: next };
  }

  private async commitTransition(
    previous: TelemetryMatchState,
    next: TelemetryMatchState,
    actor: Actor | null,
  ) {
    try {
      await this.persistence.persistState(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        JSON.stringify({
          tag: '[TELEMETRY][BLOCKED]',
          stage: 'telemetry-engine',
          action: 'persist-state-failed-runtime-continued',
          matchId: next.matchId,
          status: next.status,
          version: next.version,
          sequence: next.sequence,
          message,
        }),
      );
    }
    this.logTransitionSummary(previous, next);

    const transitionedToEnded =
      previous.status !== 'ENDED' &&
      previous.status !== 'LOCKED' &&
      (next.status === 'ENDED' || next.status === 'LOCKED');
    if (
      transitionedToEnded &&
      !this.hasExplicitLifecycleEvent(previous, next, 'MATCH_ENDED')
    ) {
      this.logger.warn(
        JSON.stringify({
          stage: 'telemetry-engine',
          action: 'guardrail-match-end-without-explicit-event',
          matchId: next.matchId,
          previousStatus: previous.status,
          nextStatus: next.status,
        }),
      );
    }
    if (transitionedToEnded) {
      try {
        await this.matchControl.endMatch(actor ?? SYSTEM_ACTOR, next.matchId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Failed to sync match end for match=${next.matchId}: ${message}`,
        );
      }
    }

    this.runtimes.set(next.matchId, this.cloneState(next));
    await this.broadcast.broadcastState(next);
  }

  private applyEventMutation(state: TelemetryMatchState, event: EngineEvent) {
    this.ensureStateDefaults(state);
    switch (event.type) {
      case 'MATCH_STARTED':
        state.status = 'LIVE';
        state.startedAt = state.startedAt ?? event.timestamp;
        state.endedAt = null;
        this.appendStateEvent(state, {
          id: `MATCH_STARTED:${event.timestamp}:${event.sequence}`,
          type: 'MATCH_STARTED',
          ts: event.timestamp,
          payload: event.payload,
        });
        return;
      case 'MATCH_ENDED':
        state.status = 'ENDED';
        state.endedAt = event.timestamp;
        this.appendStateEvent(state, {
          id: `MATCH_ENDED:${event.timestamp}:${event.sequence}`,
          type: 'MATCH_ENDED',
          ts: event.timestamp,
          payload: event.payload,
        });
        return;
      case 'PLAYER_ALIVE_CHANGED': {
        const player = this.requirePlayer(
          state,
          String(event.payload.playerId),
        );
        player.alive = event.payload.alive === true;
        if (!player.alive) {
          player.knocked = false;
        }
        this.appendStateEvent(state, {
          id: `PLAYER_ALIVE_CHANGED:${player.playerId}:${event.timestamp}:${event.sequence}`,
          type: 'PLAYER_ALIVE_CHANGED',
          ts: event.timestamp,
          teamId: player.teamId,
          playerId: player.playerId,
          payload: event.payload,
        });
        return;
      }
      case 'PLAYER_KNOCKED_CHANGED': {
        const player = this.requirePlayer(
          state,
          String(event.payload.playerId),
        );
        player.knocked = event.payload.knocked === true;
        if (player.knocked) {
          player.alive = true;
        }
        this.appendStateEvent(state, {
          id: `PLAYER_KNOCKED_CHANGED:${player.playerId}:${event.timestamp}:${event.sequence}`,
          type: 'PLAYER_KNOCKED_CHANGED',
          ts: event.timestamp,
          teamId: player.teamId,
          playerId: player.playerId,
          payload: event.payload,
        });
        return;
      }
      case 'PLAYER_KILL': {
        const killer = this.requirePlayer(
          state,
          String(event.payload.killerPlayerId),
        );
        killer.kills += 1;
        const victimPlayerId = toIdentifier(event.payload.victimPlayerId);
        if (victimPlayerId) {
          const victim = this.requirePlayer(state, victimPlayerId);
          victim.alive = false;
          victim.knocked = false;
        }
        this.appendKillFeedItem(state, {
          id: `kill:${killer.teamId}:${killer.playerId}:${event.timestamp}:${event.sequence}`,
          ts: event.timestamp,
          killerTeamId: killer.teamId,
          killerPlayerId: killer.playerId,
          killerName:
            toOptionalText(event.payload.killerPlayerName) ??
            killer.metadata?.playerName ??
            null,
          victimTeamId: toOptionalText(event.payload.victimTeamId),
          victimPlayerId: victimPlayerId || null,
          victimName: toOptionalText(event.payload.victimPlayerName),
          delta: 1,
          totalKills: killer.kills,
          weapon: toOptionalText(event.payload.weapon),
        });
        this.appendStateEvent(state, {
          id: `PLAYER_KILL:${killer.playerId}:${event.timestamp}:${event.sequence}`,
          type: 'PLAYER_KILL',
          ts: event.timestamp,
          teamId: killer.teamId,
          playerId: killer.playerId,
          payload: event.payload,
        });
        return;
      }
      case 'TEAM_ELIMINATED': {
        const teamId = toIdentifier(event.payload.teamId);
        for (const player of Object.values(state.players)) {
          if (player.teamId !== teamId) continue;
          player.alive = false;
          player.knocked = false;
        }
        this.appendStateEvent(state, {
          id: `TEAM_ELIMINATED:${teamId}:${event.timestamp}:${event.sequence}`,
          type: 'TEAM_ELIMINATED',
          ts: event.timestamp,
          teamId,
          payload: event.payload,
        });
        return;
      }
      default:
        throw new BadRequestException('Unsupported telemetry event');
    }
  }

  private applyCommandMutation(
    state: TelemetryMatchState,
    command: ControlCommand,
  ): PendingManualOverrides {
    const pending: PendingManualOverrides = {
      players: {},
      teams: {},
    };

    switch (command.type) {
      case 'START_MATCH':
        state.status = 'LIVE';
        state.startedAt = command.timestamp ?? Date.now();
        state.endedAt = null;
        this.appendStateEvent(state, {
          id: `MATCH_STARTED:${state.startedAt}:manual`,
          type: 'MATCH_STARTED',
          ts: state.startedAt,
          payload: {
            source: command.source ?? 'MANUAL',
            command: command.type,
          },
        });
        return pending;
      case 'END_MATCH':
        state.status = 'ENDED';
        state.endedAt = command.timestamp ?? Date.now();
        this.appendStateEvent(state, {
          id: `MATCH_ENDED:${state.endedAt}:manual`,
          type: 'MATCH_ENDED',
          ts: state.endedAt,
          payload: {
            source: command.source ?? 'MANUAL',
            command: command.type,
          },
        });
        return pending;
      default:
        throw new BadRequestException('Unsupported control command');
    }
  }

  private recomputeDerivedState(
    state: TelemetryMatchState,
    timestamp: number,
    options: DerivedStateOptions = {},
  ) {
    this.ensureStateDefaults(state);
    if (state.status === 'PENDING' && this.hasLiveSignals(state)) {
      state.status = 'LIVE';
      state.startedAt = state.startedAt ?? timestamp;
    }
    const updateTeamAggregates = options.updateTeamAggregates !== false;

    const playersByTeam = new Map<
      string,
      Array<{ key: string; state: TelemetryPlayerState }>
    >();
    for (const [playerKey, player] of Object.entries(state.players)) {
      const bucket = playersByTeam.get(player.teamId) ?? [];
      bucket.push({ key: playerKey, state: player });
      playersByTeam.set(player.teamId, bucket);
    }

    const teamInputs = Object.keys(state.teams).map((teamId) => {
      const team = state.teams[teamId];
      const teamPlayers = playersByTeam.get(teamId) ?? [];
      const freshTelemetry = this.readFreshTeamTelemetry(team, timestamp);
      return {
        teamId,
        team,
        teamPlayers,
        freshTelemetry,
      };
    });
    const previousTotalTeams = Math.max(teamInputs.length, 1);
    const phase =
      typeof state.circle?.phase === 'number' &&
      Number.isFinite(state.circle.phase)
        ? Math.trunc(state.circle.phase)
        : null;
    const earlyTelemetryPhase = phase !== null && phase < 2;
    const hasConfirmedPlacementPresence = teamInputs.some((entry) =>
      this.hasConfirmedTeamPresence(entry),
    );
    const placementTeamInputs = teamInputs.filter((entry) =>
      this.shouldIncludeTeamInPlacementDerivation(state, entry, {
        earlyTelemetryPhase,
        hasConfirmedPlacementPresence,
      }),
    );
    const placementTeamIds = new Set(
      placementTeamInputs.map((entry) => entry.teamId),
    );
    const totalTeams = Math.max(placementTeamInputs.length, 1);
    const derived = derivePubgMatchState<number>({
      eliminationMarker: timestamp,
      teams: placementTeamInputs.map(
        ({ teamId, team, teamPlayers, freshTelemetry }) => ({
          teamId,
          sortKey: this.teamSortKey(team),
          players: teamPlayers.map((entry) => ({
            id: entry.key,
            teamId,
            kills: entry.state.kills,
            alive: entry.state.alive,
            knocked: entry.state.knocked,
          })),
          totalPlayers: Math.max(
            team.totalPlayers,
            teamPlayers.length,
            freshTelemetry?.totalPlayers ?? 0,
          ),
          eliminatedAt: team.eliminatedAt ?? null,
          eliminatedOrder: this.toExistingEliminatedOrder(
            totalTeams,
            team,
            previousTotalTeams,
          ),
          manualTotalKills: false,
          totalKillsOverride: team.totalKills,
        }),
      ),
    });

    const derivedTeamsById = new Map(
      derived.teams.map((team) => [team.teamId, team] as const),
    );

    if (updateTeamAggregates) {
      for (const [teamId, team] of Object.entries(state.teams)) {
        const previousTeam = {
          alivePlayers: team.alivePlayers,
          eliminated: team.eliminated,
          placement: team.placement,
          eliminatedAt: team.eliminatedAt,
        };
        const nextTeam = derivedTeamsById.get(teamId);
        if (!nextTeam) {
          if (!placementTeamIds.has(teamId)) {
            team.alivePlayers = 0;
            team.eliminated = false;
            team.placement = null;
            team.eliminatedAt = null;
            this.logTeamEliminationDecision(state, teamId, previousTeam, team, {
              timestamp,
              aggregateUpdatesApplied: true,
            });
          }
          continue;
        }
        const hasKnownRoster = placementTeamIds.has(teamId);

        team.alivePlayers = nextTeam.aliveCount;
        team.totalPlayers = Math.max(nextTeam.totalPlayers, team.alivePlayers);
        team.totalKills = nextTeam.teamKills;
        team.eliminated = hasKnownRoster && team.alivePlayers <= 0;
        team.placement = team.eliminated
          ? nextTeam.placement
          : hasKnownRoster && nextTeam.placement === 1
            ? 1
            : null;
        team.eliminatedAt = team.eliminated
          ? (team.eliminatedAt ?? nextTeam.eliminatedAt ?? timestamp)
          : null;
        this.logTeamEliminationDecision(state, teamId, previousTeam, team, {
          timestamp,
          aggregateUpdatesApplied: true,
        });
      }
    } else {
      for (const [teamId, team] of Object.entries(state.teams)) {
        const nextTeam = derivedTeamsById.get(teamId);
        if (!nextTeam) {
          continue;
        }
        if (team.alivePlayers > 0 && nextTeam.aliveCount <= 0) {
          this.logger.warn(
            JSON.stringify({
              tag: '[ELIMINATION][BLOCKED]',
              stage: 'telemetry-engine',
              action: 'team-zero-alive-aggregate-blocked',
              matchId: state.matchId,
              teamId,
              phase: state.circle?.phase ?? null,
              previousAlivePlayers: team.alivePlayers,
              derivedAlivePlayers: nextTeam.aliveCount,
              previousEliminated: team.eliminated,
              inferredTeamElimination: true,
              reason: 'TEAM_AGGREGATE_UPDATES_HELD',
            }),
          );
        }
      }
    }

    for (const team of derived.teams) {
      for (const player of team.players) {
        const current = state.players[player.id];
        if (!current) {
          continue;
        }
        current.kills = player.kills;
        const allowDerivedPlayerLifeWrites = false;
        if (allowDerivedPlayerLifeWrites) {
          current.alive = player.alive;
          current.knocked = player.knocked;
          if (current.knocked && current.alive !== true) {
            this.logger.warn(
              JSON.stringify({
                stage: 'telemetry-engine',
                action: 'guardrail-knocked-player-marked-eliminated',
                matchId: state.matchId,
                playerId: current.playerId,
                teamId: current.teamId,
                timestamp,
              }),
            );
            current.alive = true;
          }
          continue;
        }
        if (current.alive !== player.alive) {
          this.logCriticalPlayerStateConflict({
            source: 'derived',
            matchId: state.matchId,
            playerId: current.playerId,
            teamId: current.teamId,
            phase: state.circle?.phase ?? null,
            timestamp,
            field: 'alive',
            previousValue: current.alive,
            incomingValue: player.alive,
            resolvedValue: current.alive,
            reason: 'DERIVED_PLAYER_LIFE_WRITE_BLOCKED',
          });
          this.logPlayerWrite({
            source: 'derived',
            action: 'derived-player-life-write-blocked',
            matchId: state.matchId,
            playerId: current.playerId,
            teamId: current.teamId,
            phase: state.circle?.phase ?? null,
            timestamp,
            alive: player.alive,
            eliminated: player.alive === false,
            blocked: true,
            reason: 'DERIVED_PLAYER_LIFE_WRITE_BLOCKED',
          });
        }
        if (current.knocked !== player.knocked) {
          this.logPlayerWrite({
            source: 'derived',
            action: 'derived-player-knock-write-blocked',
            matchId: state.matchId,
            playerId: current.playerId,
            teamId: current.teamId,
            phase: state.circle?.phase ?? null,
            timestamp,
            alive: current.alive,
            eliminated: current.alive === false,
            blocked: true,
            reason: 'DERIVED_PLAYER_LIFE_WRITE_BLOCKED',
            metadata: {
              incomingKnocked: player.knocked,
              previousKnocked: current.knocked,
            },
          });
        }
      }
    }

    const countableTeams = Object.values(state.teams);
    const alivePlayers = countableTeams.reduce(
      (sum, team) => sum + Math.max(0, Math.trunc(team.alivePlayers ?? 0)),
      0,
    );
    if (updateTeamAggregates) {
      state.teamsAlive = countableTeams.reduce(
        (count, team) => (team.alivePlayers > 0 ? count + 1 : count),
        0,
      );
    }
    if (state.status === 'ENDED') {
      state.endedAt = state.endedAt ?? timestamp;
    }

    if (state.status === 'LOCKED') {
      state.endedAt = state.endedAt ?? timestamp;
    }

    this.logger.debug(
      JSON.stringify({
        stage: 'telemetry-engine',
        action: 'telemetry-engine.computed-alive-state',
        matchId: state.matchId,
        timestamp,
        aliveTeams: state.teamsAlive,
        alivePlayers,
        teamAggregatesUpdated: updateTeamAggregates,
      }),
    );

    this.logTeamEliminationConsistencyWarnings(state, timestamp);
  }

  private async reconcileWithPersistedSync(
    state: TelemetryMatchState,
    pendingManualOverrides: PendingManualOverrides = {
      players: {},
      teams: {},
    },
  ): Promise<boolean> {
    const persisted = await this.loadPersistedOverrideSnapshot(state.matchId);
    let changed = false;
    state.version = Math.max(state.version, persisted.version);
    if (this.restoreMissingPersistedCanonicalRoster(state, persisted)) {
      changed = true;
      this.recomputeDerivedState(state, state.updatedAt);
    }
    const pendingPlayerValues = new Map<
      string,
      Pick<TelemetryPlayerState, 'alive' | 'knocked' | 'kills'>
    >();

    for (const playerId of Object.keys(pendingManualOverrides.players)) {
      const player = state.players[playerId];
      if (!player) {
        continue;
      }
      pendingPlayerValues.set(playerId, {
        alive: player.alive,
        knocked: player.knocked,
        kills: player.kills,
      });
    }

    const reapplyPendingPlayerField = (
      playerId: string,
      field: keyof LiveSyncPlayerOwnership,
    ) => {
      const player = state.players[playerId];
      const values = pendingPlayerValues.get(playerId);
      if (!player) {
        return;
      }
      if (values) {
        if (field === 'alive') {
          player.alive = values.alive;
        }
        if (field === 'knocked') {
          player.knocked = values.knocked;
        }
        if (field === 'kills') {
          player.kills = values.kills;
        }
      }
      player.ownership = {
        ...(player.ownership ?? {}),
        [field]: {
          owner: 'MANUAL',
          override: true,
          updatedAt: state.updatedAt,
          source: 'MANUAL',
        },
      };
    };

    if (persisted.mode === 'MANUAL') {
      for (const [playerId, player] of persisted.players) {
        this.applyPersistedPlayerState(state, playerId, player, [
          'alive',
          'knocked',
          'kills',
        ]);
      }

      for (const [playerId, fields] of Object.entries(
        pendingManualOverrides.players,
      )) {
        for (const field of fields) {
          reapplyPendingPlayerField(playerId, field);
        }
      }

      this.recomputeDerivedState(state, state.updatedAt);

      for (const [teamId, team] of persisted.teams) {
        this.applyPersistedTeamState(state, teamId, team, [
          'eliminated',
          'placement',
          'totalKills',
        ]);
      }
    } else {
      let playerStateChanged = false;

      for (const [playerId, player] of persisted.players) {
        const pendingFields = pendingManualOverrides.players[playerId] ?? [];
        const fields: Array<keyof LiveSyncPlayerOwnership> = [];
        for (const field of ['alive', 'knocked', 'kills'] as const) {
          if (pendingFields.includes(field)) {
            reapplyPendingPlayerField(playerId, field);
            continue;
          }
          if (hasManualOverride(player.ownership?.[field])) {
            fields.push(field);
          }
        }
        if (fields.length > 0) {
          this.applyPersistedPlayerState(state, playerId, player, fields);
          playerStateChanged = true;
        }
      }

      if (playerStateChanged) {
        changed = true;
        this.recomputeDerivedState(state, state.updatedAt);
      }

      for (const [teamId, team] of persisted.teams) {
        const pendingFields = pendingManualOverrides.teams[teamId] ?? [];
        const fields: Array<keyof LiveSyncTeamOwnership> = [];
        for (const field of [
          'eliminated',
          'placement',
          'totalKills',
        ] as const) {
          if (pendingFields.includes(field)) {
            continue;
          }
          if (hasManualOverride(team.ownership?.[field])) {
            fields.push(field);
          }
        }
        if (fields.length > 0) {
          this.applyPersistedTeamState(state, teamId, team, fields);
          changed = true;
        }
      }
    }

    this.decorateOwnership(state, persisted, pendingManualOverrides);
    return changed;
  }

  private applyPersistedPlayerState(
    state: TelemetryMatchState,
    playerId: string,
    persisted: PersistedOverridePlayerState,
    fields: Array<keyof LiveSyncPlayerOwnership>,
  ) {
    const current = state.players[playerId] ?? {
      playerId: persisted.playerId,
      teamId: persisted.teamId,
      alive: persisted.alive,
      knocked: persisted.knocked,
      kills: persisted.kills,
      assists: persisted.assists,
      metadata: persisted.metadata,
    };

    current.teamId = persisted.teamId;
    current.metadata = {
      ...(current.metadata ?? {}),
      ...(persisted.metadata ?? {}),
    };

    if (fields.includes('alive')) {
      current.alive = persisted.alive;
    }
    if (fields.includes('knocked')) {
      current.knocked = persisted.knocked;
    }
    if (fields.includes('kills')) {
      current.kills = persisted.kills;
    }

    state.players[playerId] = current;
  }

  private applyPersistedTeamState(
    state: TelemetryMatchState,
    teamId: string,
    persisted: PersistedOverrideTeamState,
    fields: Array<keyof LiveSyncTeamOwnership>,
  ) {
    const current = state.teams[teamId] ?? {
      teamId,
      alivePlayers: persisted.alivePlayers,
      eliminated: persisted.eliminated,
      placement: persisted.placement,
      totalKills: persisted.totalKills,
      totalPlayers: persisted.totalPlayers,
      eliminatedAt: persisted.eliminatedAt,
      metadata: persisted.metadata,
    };

    current.totalPlayers = persisted.totalPlayers;
    current.metadata = {
      ...(current.metadata ?? {}),
      ...(persisted.metadata ?? {}),
    };

    if (fields.includes('eliminated')) {
      current.eliminated = persisted.eliminated;
      current.alivePlayers = persisted.alivePlayers;
      current.eliminatedAt = persisted.eliminated
        ? persisted.eliminatedAt
        : null;
    }
    if (fields.includes('placement')) {
      current.placement = persisted.placement;
    }
    if (fields.includes('totalKills')) {
      current.totalKills = persisted.totalKills;
    }

    state.teams[teamId] = current;
  }

  private shouldResetPersistedCanonicalCriticalState(
    state: TelemetryMatchState,
  ): boolean {
    const phase =
      typeof state.circle?.phase === 'number' &&
      Number.isFinite(state.circle.phase)
        ? Math.trunc(state.circle.phase)
        : null;
    return phase !== null && this.isEarlyAirPhase(phase);
  }

  private toRuntimeTeamFromPersisted(
    persisted: PersistedOverrideTeamState,
    resetCriticalState: boolean,
  ): TelemetryTeamState {
    const hasManualTeamAggregates =
      hasManualOverride(persisted.ownership?.eliminated) ||
      hasManualOverride(persisted.ownership?.placement) ||
      hasManualOverride(persisted.ownership?.totalKills);
    const totalPlayers = Math.max(0, Math.trunc(persisted.totalPlayers ?? 0));
    const alivePlayers =
      resetCriticalState && !hasManualTeamAggregates && totalPlayers > 0
        ? totalPlayers
        : Math.max(0, Math.trunc(persisted.alivePlayers ?? 0));

    return {
      teamId: persisted.teamId,
      alivePlayers,
      eliminated:
        resetCriticalState && !hasManualTeamAggregates
          ? false
          : persisted.eliminated,
      placement:
        resetCriticalState && !hasManualTeamAggregates
          ? null
          : persisted.placement,
      totalKills:
        resetCriticalState && !hasManualTeamAggregates
          ? 0
          : Math.max(0, Math.trunc(persisted.totalKills ?? 0)),
      totalPlayers,
      eliminatedAt:
        resetCriticalState && !hasManualTeamAggregates
          ? null
          : persisted.eliminatedAt,
      ownership: persisted.ownership,
      metadata: {
        ...(persisted.metadata ?? {}),
        canonicalSeed: true,
        provisional: false,
      },
    };
  }

  private toRuntimePlayerFromPersisted(
    persisted: PersistedOverridePlayerState,
    resetCriticalState: boolean,
  ): TelemetryPlayerState {
    const hasManualLife =
      hasManualOverride(persisted.ownership?.alive) ||
      hasManualOverride(persisted.ownership?.knocked);
    const hasManualKills = hasManualOverride(persisted.ownership?.kills);

    return {
      playerId: persisted.playerId,
      teamId: persisted.teamId,
      alive: resetCriticalState && !hasManualLife ? true : persisted.alive,
      knocked: resetCriticalState && !hasManualLife ? false : persisted.knocked,
      health:
        resetCriticalState && !hasManualLife && persisted.health === 0
          ? null
          : (persisted.health ?? null),
      kills:
        resetCriticalState && !hasManualKills
          ? 0
          : Math.max(0, Math.trunc(persisted.kills ?? 0)),
      assists: Math.max(0, Math.trunc(persisted.assists ?? 0)),
      ownership: persisted.ownership,
      metadata: {
        ...(persisted.metadata ?? {}),
        canonicalSeed: true,
        provisional: false,
      },
    };
  }

  private mergePersistedCanonicalTeamMetadata(
    current: TelemetryTeamState,
    persisted: PersistedOverrideTeamState,
  ): boolean {
    const before = JSON.stringify(current.metadata ?? {});
    current.metadata = {
      ...(persisted.metadata ?? {}),
      ...(current.metadata ?? {}),
      teamName:
        current.metadata?.teamName ?? persisted.metadata?.teamName ?? null,
      teamTag: current.metadata?.teamTag ?? persisted.metadata?.teamTag ?? null,
      logoUrl: current.metadata?.logoUrl ?? persisted.metadata?.logoUrl ?? null,
      slot: current.metadata?.slot ?? persisted.metadata?.slot ?? null,
      slotResultId:
        current.metadata?.slotResultId ??
        persisted.metadata?.slotResultId ??
        null,
      wasPresentInMatch:
        current.metadata?.wasPresentInMatch ??
        persisted.metadata?.wasPresentInMatch ??
        null,
      canonicalSeed: true,
      provisional: false,
    };
    return before !== JSON.stringify(current.metadata ?? {});
  }

  private restoreMissingPersistedCanonicalRoster(
    state: TelemetryMatchState,
    persisted: PersistedOverrideSnapshot,
  ): boolean {
    if (persisted.teams.size === 0) {
      return false;
    }

    const resetCriticalState =
      this.shouldResetPersistedCanonicalCriticalState(state);
    let teamsRestored = 0;
    let teamsRepaired = 0;
    let playersRestored = 0;

    for (const [teamId, persistedTeam] of persisted.teams) {
      const existingTeam = state.teams[teamId];
      const existingTeamPlayers = Object.values(state.players).filter(
        (player) => player.teamId === teamId,
      );
      const shouldRestorePlayers =
        existingTeam === undefined || existingTeamPlayers.length === 0;

      if (!existingTeam) {
        state.teams[teamId] = this.toRuntimeTeamFromPersisted(
          persistedTeam,
          resetCriticalState,
        );
        teamsRestored += 1;
      } else {
        let repaired = this.mergePersistedCanonicalTeamMetadata(
          existingTeam,
          persistedTeam,
        );
        if (existingTeam.totalPlayers < persistedTeam.totalPlayers) {
          existingTeam.totalPlayers = Math.max(0, persistedTeam.totalPlayers);
          repaired = true;
        }
        if (repaired) {
          teamsRepaired += 1;
        }
      }

      if (!shouldRestorePlayers) {
        continue;
      }

      for (const [playerId, persistedPlayer] of persisted.players) {
        if (persistedPlayer.teamId !== teamId || state.players[playerId]) {
          continue;
        }
        state.players[playerId] = this.toRuntimePlayerFromPersisted(
          persistedPlayer,
          resetCriticalState,
        );
        playersRestored += 1;
      }
    }

    const changed =
      teamsRestored > 0 || teamsRepaired > 0 || playersRestored > 0;
    if (changed) {
      this.logger.warn(
        JSON.stringify({
          tag: '[TELEMETRY][ROSTER]',
          stage: 'telemetry-engine',
          action: 'persisted-canonical-roster-restored',
          matchId: state.matchId,
          teamsRestored,
          teamsRepaired,
          playersRestored,
          persistedTeams: persisted.teams.size,
          runtimeTeams: Object.keys(state.teams).length,
          resetCriticalState,
        }),
      );
    }

    return changed;
  }

  private decorateOwnership(
    state: TelemetryMatchState,
    persisted: PersistedOverrideSnapshot,
    pendingManualOverrides: PendingManualOverrides,
  ) {
    for (const [playerId, player] of Object.entries(state.players)) {
      const ownership = persisted.players.get(playerId)?.ownership;
      const currentOwnership = player.ownership;
      const pendingFields = new Set(
        pendingManualOverrides.players[playerId] ?? [],
      );
      const nextOwnership: LiveSyncPlayerOwnership = {};

      for (const field of ['alive', 'knocked', 'kills'] as const) {
        if (ownership?.[field]) {
          nextOwnership[field] = ownership[field];
          continue;
        }
        if (
          pendingFields.has(field) &&
          hasManualOverride(currentOwnership?.[field])
        ) {
          nextOwnership[field] = currentOwnership?.[field];
        }
      }

      if (Object.keys(nextOwnership).length > 0) {
        player.ownership = nextOwnership;
      } else {
        delete player.ownership;
      }
    }

    for (const [teamId, team] of Object.entries(state.teams)) {
      const ownership = persisted.teams.get(teamId)?.ownership;
      const currentOwnership = team.ownership;
      const pendingFields = new Set(pendingManualOverrides.teams[teamId] ?? []);
      const nextOwnership: LiveSyncTeamOwnership = {};

      for (const field of ['eliminated', 'placement', 'totalKills'] as const) {
        if (ownership?.[field]) {
          nextOwnership[field] = ownership[field];
          continue;
        }
        if (
          pendingFields.has(field) &&
          hasManualOverride(currentOwnership?.[field])
        ) {
          nextOwnership[field] = currentOwnership?.[field];
        }
      }

      if (Object.keys(nextOwnership).length > 0) {
        team.ownership = nextOwnership;
      } else {
        delete team.ownership;
      }
    }
  }

  private async loadPersistedOverrideSnapshot(
    matchId: string,
  ): Promise<PersistedOverrideSnapshot> {
    if (
      !this.prisma.matchControlState?.findUnique ||
      !this.prisma.matchSlotResult?.findMany
    ) {
      return {
        mode: 'API',
        version: 0,
        players: new Map(),
        teams: new Map(),
      };
    }

    const [controlState, slotResults] = await Promise.all([
      this.prisma.matchControlState.findUnique({
        where: { matchId },
        select: {
          authorityMode: true,
          metaJson: true,
        },
      }),
      this.prisma.matchSlotResult.findMany({
        where: { matchId, teamId: { not: null } },
        orderBy: { slotNumber: 'asc' },
        select: {
          id: true,
          slotNumber: true,
          teamId: true,
          wasPresentInMatch: true,
          totalKills: true,
          manualTotalKills: true,
          eliminatedOrder: true,
          eliminatedAt: true,
          team: {
            select: {
              id: true,
              name: true,
              tag: true,
              logoUrl: true,
            },
          },
          players: {
            orderBy: { playerName: 'asc' },
            select: {
              id: true,
              playerId: true,
              externalPlayerId: true,
              pubgAccountId: true,
              playerName: true,
              kills: true,
              assists: true,
              isAlive: true,
              alive: true,
              isKnocked: true,
              player: {
                select: {
                  externalPlayerId: true,
                  photoUrl: true,
                  inGameId: true,
                  pubgPlayerId: true,
                  ign: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const contract = readLiveSyncContract(controlState?.metaJson ?? null);
    const canonical = derivePubgMatchState<number>({
      eliminationMarker: Date.now(),
      teams: slotResults.map((slot) => ({
        teamId: slot.teamId as string,
        sortKey: `${String(slot.slotNumber).padStart(4, '0')}:${slot.id}`,
        players: slot.players.map((player) => ({
          id:
            buildMatchPlayerKey({
              playerId: player.playerId ?? null,
              playerResultId: player.id,
            }) ?? player.id,
          teamId: slot.teamId as string,
          kills: Math.max(0, player.kills ?? 0),
          alive:
            ((player as { isAlive?: boolean | null }).isAlive ??
              (player as { alive?: boolean | null }).alive ??
              true) === true,
          knocked:
            ((player as { isKnocked?: boolean | null }).isKnocked ?? false) ===
            true,
          health: null,
        })),
        totalPlayers: Math.max(slot.players.length, 0),
        eliminatedOrder: slot.eliminatedOrder ?? null,
        eliminatedAt: slot.eliminatedAt?.getTime() ?? null,
        manualTotalKills: slot.manualTotalKills ?? false,
        totalKillsOverride: slot.totalKills ?? null,
      })),
    });

    const canonicalByTeamId = new Map(
      canonical.teams.map((team) => [team.teamId, team] as const),
    );
    const players = new Map<string, PersistedOverridePlayerState>();
    const teams = new Map<string, PersistedOverrideTeamState>();

    for (const slot of slotResults) {
      const teamId = slot.teamId as string;
      const canonicalTeam = canonicalByTeamId.get(teamId);
      teams.set(teamId, {
        teamId,
        alivePlayers: canonicalTeam?.aliveCount ?? 0,
        eliminated: canonicalTeam?.eliminated ?? false,
        placement: canonicalTeam?.placement ?? null,
        totalKills:
          canonicalTeam?.teamKills ?? Math.max(0, slot.totalKills ?? 0),
        totalPlayers: canonicalTeam?.totalPlayers ?? slot.players.length,
        eliminatedAt:
          canonicalTeam?.eliminatedAt ?? slot.eliminatedAt?.getTime() ?? null,
        ownership: contract.overrides.teams[teamId],
        metadata: {
          teamName: slot.team?.name ?? null,
          teamTag: slot.team?.tag ?? null,
          logoUrl: slot.team?.logoUrl ?? null,
          slot: slot.slotNumber,
          totalPlayers: canonicalTeam?.totalPlayers ?? slot.players.length,
          slotResultId: slot.id,
          wasPresentInMatch: slot.wasPresentInMatch ?? null,
        },
      });

      for (const player of slot.players) {
        const playerKey =
          buildMatchPlayerKey({
            playerId: player.playerId ?? null,
            playerResultId: player.id,
          }) ?? player.id;
        players.set(playerKey, {
          playerId: playerKey,
          teamId,
          alive:
            ((player as { isAlive?: boolean | null }).isAlive ??
              (player as { alive?: boolean | null }).alive ??
              true) === true,
          knocked:
            ((player as { isKnocked?: boolean | null }).isKnocked ?? false) ===
            true,
          health: null,
          kills: Math.max(0, player.kills ?? 0),
          assists: Math.max(0, player.assists ?? 0),
          ownership: contract.overrides.players[playerKey],
          metadata: {
            playerName: player.playerName ?? player.player?.ign ?? playerKey,
            avatarUrl: player.player?.photoUrl ?? null,
            slotPlayerResultId: player.id,
            externalPlayerId:
              player.externalPlayerId ??
              player.player?.externalPlayerId ??
              player.pubgAccountId ??
              null,
            inGameId:
              player.player?.inGameId ??
              player.player?.pubgPlayerId ??
              player.externalPlayerId ??
              null,
          },
        });
      }
    }

    return {
      mode: toTelemetryControlMode(controlState?.authorityMode),
      version: contract.version,
      players,
      teams,
    };
  }

  private hasLiveSignals(state: TelemetryMatchState) {
    return Object.values(state.players).some(
      (player) => player.kills > 0 || !player.alive || player.knocked,
    );
  }

  private requirePlayer(state: TelemetryMatchState, playerId: string) {
    const player = state.players[playerId];
    if (!player) {
      throw new BadRequestException(`Unknown playerId: ${playerId}`);
    }
    return player;
  }

  private teamSortKey(team: TelemetryTeamState) {
    const slot = String(
      team.metadata?.slot ?? Number.MAX_SAFE_INTEGER,
    ).padStart(4, '0');
    return `${slot}:${team.teamId}`;
  }

  private markObservedTelemetryPlayer(
    state: TelemetryMatchState,
    teamId: string,
    player: TelemetryPlayerState,
  ) {
    player.metadata = {
      ...(player.metadata ?? {}),
      observedInTelemetry: true,
    };

    const team = state.teams[teamId];
    if (team) {
      team.metadata = {
        ...(team.metadata ?? {}),
        wasPresentInMatch: true,
        observedInTelemetry: true,
      };
    }
  }

  private applyAdapterTeamTelemetry(
    state: TelemetryMatchState,
    envelope: AdapterTelemetryEnvelope,
  ): boolean {
    let changed = false;

    for (const incomingTeam of envelope.teams ?? []) {
      const teamId = this.resolveAdapterTeamId(state, incomingTeam);
      if (!teamId) {
        continue;
      }

      const currentTeam = state.teams[teamId];
      if (!currentTeam) {
        continue;
      }

      const nextAlivePlayers = normalizeNonNegativeInteger(
        incomingTeam.alivePlayers ?? incomingTeam.aliveCount,
      );
      const nextTotalPlayers = normalizeNonNegativeInteger(
        incomingTeam.totalPlayers,
      );
      const nextKills = normalizeNonNegativeInteger(incomingTeam.kills);
      const nextPlacement = normalizePositiveInteger(incomingTeam.placement);
      const previousMeta = currentTeam.metadata ?? {};
      const nextBackpack = Object.prototype.hasOwnProperty.call(
        incomingTeam,
        'backpack',
      )
        ? (incomingTeam.backpack ?? null)
        : (previousMeta.telemetryBackpack ?? null);
      const nextEquipment = Object.prototype.hasOwnProperty.call(
        incomingTeam,
        'equipment',
      )
        ? (incomingTeam.equipment ?? incomingTeam.backpack ?? null)
        : (previousMeta.telemetryEquipment ??
          previousMeta.telemetryBackpack ??
          null);
      const nextMeta = {
        ...previousMeta,
        slot: previousMeta.slot ?? incomingTeam.slot ?? null,
        teamName: previousMeta.teamName ?? incomingTeam.name ?? null,
        teamTag: previousMeta.teamTag ?? incomingTeam.tag ?? null,
        logoUrl: previousMeta.logoUrl ?? incomingTeam.logoUrl ?? null,
        wasPresentInMatch: true,
        observedInTelemetry: true,
        telemetryAlivePlayers: nextAlivePlayers,
        telemetryTotalPlayers:
          nextTotalPlayers !== null
            ? Math.max(nextTotalPlayers, nextAlivePlayers ?? 0)
            : nextAlivePlayers,
        telemetryKills: nextKills,
        telemetryPlacement: nextPlacement,
        telemetryBackpack: nextBackpack,
        telemetryEquipment: nextEquipment,
        telemetryLastSeenAt: envelope.timestamp,
      };

      if (
        nextMeta.slot !== previousMeta.slot ||
        nextMeta.teamName !== previousMeta.teamName ||
        nextMeta.teamTag !== previousMeta.teamTag ||
        nextMeta.logoUrl !== previousMeta.logoUrl ||
        nextMeta.wasPresentInMatch !== previousMeta.wasPresentInMatch ||
        nextMeta.observedInTelemetry !== previousMeta.observedInTelemetry ||
        nextMeta.telemetryAlivePlayers !== previousMeta.telemetryAlivePlayers ||
        nextMeta.telemetryTotalPlayers !== previousMeta.telemetryTotalPlayers ||
        nextMeta.telemetryKills !== previousMeta.telemetryKills ||
        nextMeta.telemetryPlacement !== previousMeta.telemetryPlacement ||
        nextMeta.telemetryBackpack !== previousMeta.telemetryBackpack ||
        nextMeta.telemetryEquipment !== previousMeta.telemetryEquipment ||
        nextMeta.telemetryLastSeenAt !== previousMeta.telemetryLastSeenAt
      ) {
        currentTeam.metadata = nextMeta;
        changed = true;
      }
    }

    return changed;
  }

  private readFreshTeamTelemetry(
    team: TelemetryTeamState,
    timestamp: number,
  ): FreshTeamTelemetry | null {
    const lastSeenAt =
      typeof team.metadata?.telemetryLastSeenAt === 'number' &&
      Number.isFinite(team.metadata.telemetryLastSeenAt)
        ? Math.trunc(team.metadata.telemetryLastSeenAt)
        : null;
    if (lastSeenAt === null || lastSeenAt !== Math.trunc(timestamp)) {
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

    if (
      alivePlayers === null &&
      totalPlayers === null &&
      kills === null &&
      placement === null
    ) {
      return null;
    }

    return {
      alivePlayers,
      totalPlayers,
      kills,
      placement,
    };
  }

  private discardFreshTeamTelemetryAggregates(
    state: TelemetryMatchState,
    timestamp: number,
  ): number {
    let discarded = 0;
    const currentTimestamp = Math.trunc(timestamp);

    for (const team of Object.values(state.teams)) {
      const metadata = team.metadata;
      const lastSeenAt =
        typeof metadata?.telemetryLastSeenAt === 'number' &&
        Number.isFinite(metadata.telemetryLastSeenAt)
          ? Math.trunc(metadata.telemetryLastSeenAt)
          : null;
      if (lastSeenAt !== currentTimestamp) {
        continue;
      }

      const safeMetadata = { ...metadata };
      delete safeMetadata.telemetryAlivePlayers;
      delete safeMetadata.telemetryTotalPlayers;
      delete safeMetadata.telemetryKills;
      delete safeMetadata.telemetryPlacement;
      delete safeMetadata.telemetryLastSeenAt;
      team.metadata = safeMetadata;
      discarded += 1;
    }

    return discarded;
  }

  private applyFreshTeamTelemetryState(
    state: TelemetryMatchState,
    timestamp: number,
  ): void {
    let applied = false;

    for (const team of Object.values(state.teams)) {
      const freshTelemetry = this.readFreshTeamTelemetry(team, timestamp);
      if (!freshTelemetry) {
        continue;
      }

      if (freshTelemetry.alivePlayers !== null) {
        team.alivePlayers = freshTelemetry.alivePlayers;
      }
      if (freshTelemetry.totalPlayers !== null) {
        team.totalPlayers = Math.max(
          freshTelemetry.totalPlayers,
          freshTelemetry.alivePlayers ?? team.alivePlayers,
        );
      }
      team.totalKills = freshTelemetry.kills ?? team.totalKills;
      const hasKnownRoster =
        team.totalPlayers > 0 || (freshTelemetry.totalPlayers ?? 0) > 0;
      team.placement = hasKnownRoster
        ? (freshTelemetry.placement ?? team.placement)
        : null;
      team.eliminated = hasKnownRoster && team.alivePlayers <= 0;
      team.eliminatedAt = team.eliminated
        ? (team.eliminatedAt ?? timestamp)
        : null;
      applied = true;
    }

    if (!applied) {
      return;
    }

    state.teamsAlive = Object.values(state.teams).reduce(
      (count, team) => (team.alivePlayers > 0 ? count + 1 : count),
      0,
    );
  }

  private async restoreMissingAdapterTeamsFromPersistence(
    state: TelemetryMatchState,
    envelope: AdapterTelemetryEnvelope,
  ): Promise<boolean> {
    if (!envelope.teams || envelope.teams.length === 0) {
      return false;
    }

    let persisted: PersistedOverrideSnapshot | null = null;
    let changed = false;

    for (const incomingTeam of envelope.teams) {
      if (
        this.resolveAdapterTeamId(state, incomingTeam, { logUnmapped: false })
      ) {
        continue;
      }

      persisted ??= await this.loadPersistedOverrideSnapshot(state.matchId);
      const teamId = this.resolvePersistedAdapterTeamId(
        persisted,
        incomingTeam,
      );
      if (!teamId || state.teams[teamId]) {
        continue;
      }

      const persistedTeam = persisted.teams.get(teamId);
      if (!persistedTeam) {
        continue;
      }

      state.teams[teamId] = {
        teamId,
        alivePlayers: persistedTeam.alivePlayers,
        eliminated: persistedTeam.eliminated,
        placement: persistedTeam.placement,
        totalKills: persistedTeam.totalKills,
        totalPlayers: persistedTeam.totalPlayers,
        eliminatedAt: persistedTeam.eliminatedAt,
        ownership: persistedTeam.ownership,
        metadata: {
          ...(persistedTeam.metadata ?? {}),
          canonicalSeed: true,
          provisional: false,
        },
      };
      changed = true;
    }

    if (changed) {
      this.logger.log(
        JSON.stringify({
          tag: '[TELEMETRY][MAPPING]',
          stage: 'telemetry-engine',
          action: 'adapter-team-restored-from-persistence',
          matchId: state.matchId,
          teams: Object.keys(state.teams).length,
        }),
      );
    }

    return changed;
  }

  private resolvePersistedAdapterTeamId(
    persisted: PersistedOverrideSnapshot,
    team: Pick<AdapterTelemetryTeam, 'teamId' | 'slot' | 'name' | 'tag'>,
  ): string | null {
    const directId = toIdentifier(team.teamId);
    if (directId && persisted.teams.has(directId)) {
      return directId;
    }

    const teamIdAsSlot = normalizePositiveInteger(team.teamId);
    const explicitSlot =
      typeof team.slot === 'number' && Number.isFinite(team.slot)
        ? Math.trunc(team.slot)
        : null;
    const slotCandidate = explicitSlot ?? teamIdAsSlot;
    if (slotCandidate !== null) {
      const bySlot = [...persisted.teams.values()].find(
        (candidate) => candidate.metadata?.slot === slotCandidate,
      );
      if (bySlot) {
        return bySlot.teamId;
      }
    }

    const lookupKeys = [team.name, team.tag]
      .map((value) => normalizeLookup(value))
      .filter((value) => value.length > 0);
    for (const lookup of lookupKeys) {
      const byLabel = [...persisted.teams.values()].find((candidate) => {
        return (
          normalizeLookup(candidate.metadata?.teamName) === lookup ||
          normalizeLookup(candidate.metadata?.teamTag) === lookup
        );
      });
      if (byLabel) {
        return byLabel.teamId;
      }
    }

    return null;
  }

  private hasCanonicalPlayerBinding(player: TelemetryPlayerState): boolean {
    return normalizeLookup(player.metadata?.slotPlayerResultId).length > 0;
  }

  private isCanonicalSeedPlayer(player: TelemetryPlayerState): boolean {
    return (
      player.metadata?.canonicalSeed === true ||
      this.hasCanonicalPlayerBinding(player)
    );
  }

  private isCanonicalSeedTeam(team: TelemetryTeamState): boolean {
    return team.metadata?.canonicalSeed === true;
  }

  private isPersistedCanonicalMatchTeam(team: TelemetryTeamState): boolean {
    return (
      this.isCanonicalSeedTeam(team) &&
      normalizeLookup(team.metadata?.slotResultId).length > 0
    );
  }

  private hasManualPlayerOwnership(player: TelemetryPlayerState): boolean {
    return (
      hasManualOverride(player.ownership?.alive) ||
      hasManualOverride(player.ownership?.knocked) ||
      hasManualOverride(player.ownership?.kills)
    );
  }

  private isNeverObservedCanonicalPlaceholder(
    player: TelemetryPlayerState,
  ): boolean {
    return (
      this.isCanonicalSeedPlayer(player) &&
      player.metadata?.observedInTelemetry !== true &&
      !this.hasManualPlayerOwnership(player) &&
      player.kills <= 0 &&
      player.alive === true &&
      player.knocked === false &&
      player.metadata?.position == null
    );
  }

  private telemetryPlayerAliases(player: TelemetryPlayerState): string[] {
    const aliases = [
      normalizeLookup(player.metadata?.externalPlayerId),
      normalizeLookup(player.metadata?.inGameId),
      normalizeLookup(player.metadata?.playerName),
    ].filter((value) => value.length > 0);
    return Array.from(new Set(aliases));
  }

  private playersShareCanonicalAlias(
    left: TelemetryPlayerState,
    right: TelemetryPlayerState,
  ): boolean {
    if (left.teamId !== right.teamId) {
      return false;
    }

    const leftAliases = this.telemetryPlayerAliases(left);
    if (leftAliases.length === 0) {
      return false;
    }

    const rightAliases = new Set(this.telemetryPlayerAliases(right));
    return leftAliases.some((alias) => rightAliases.has(alias));
  }

  private mergeDuplicateTelemetryPlayer(
    primary: TelemetryPlayerState,
    duplicate: TelemetryPlayerState,
  ): TelemetryPlayerState {
    const preferredLifeSource =
      duplicate.metadata?.observedInTelemetry === true &&
      primary.metadata?.observedInTelemetry !== true
        ? duplicate
        : primary;

    return {
      ...primary,
      teamId: primary.teamId,
      alive: preferredLifeSource.alive,
      knocked: preferredLifeSource.knocked,
      health:
        preferredLifeSource.health ??
        primary.health ??
        duplicate.health ??
        null,
      kills: Math.max(primary.kills, duplicate.kills),
      assists: Math.max(primary.assists ?? 0, duplicate.assists ?? 0),
      metadata: {
        ...(duplicate.metadata ?? {}),
        ...(primary.metadata ?? {}),
        playerName:
          primary.metadata?.playerName ??
          duplicate.metadata?.playerName ??
          primary.playerId,
        slotPlayerResultId:
          primary.metadata?.slotPlayerResultId ??
          duplicate.metadata?.slotPlayerResultId ??
          null,
        externalPlayerId:
          primary.metadata?.externalPlayerId ??
          duplicate.metadata?.externalPlayerId ??
          null,
        inGameId:
          primary.metadata?.inGameId ?? duplicate.metadata?.inGameId ?? null,
        position:
          primary.metadata?.position ?? duplicate.metadata?.position ?? null,
        observedInTelemetry:
          primary.metadata?.observedInTelemetry === true ||
          duplicate.metadata?.observedInTelemetry === true,
        canonicalSeed:
          primary.metadata?.canonicalSeed === true ||
          duplicate.metadata?.canonicalSeed === true,
        provisional:
          primary.metadata?.provisional === true &&
          duplicate.metadata?.provisional === true,
      },
      ownership: primary.ownership ?? duplicate.ownership,
    };
  }

  private pruneCanonicalPlayerDuplicates(state: TelemetryMatchState): number {
    if (!this.mapping || state.mode === 'MANUAL') {
      return 0;
    }

    const entries = Object.entries(state.players);
    const keysToDelete = new Set<string>();
    let removed = 0;

    for (const [playerKey, player] of entries) {
      if (
        keysToDelete.has(playerKey) ||
        !this.hasCanonicalPlayerBinding(player)
      ) {
        continue;
      }

      for (const [otherKey, other] of entries) {
        if (
          otherKey === playerKey ||
          keysToDelete.has(otherKey) ||
          !this.playersShareCanonicalAlias(player, other)
        ) {
          continue;
        }

        state.players[playerKey] = this.mergeDuplicateTelemetryPlayer(
          state.players[playerKey] ?? player,
          other,
        );
        keysToDelete.add(otherKey);
        removed += 1;
      }
    }

    for (const key of keysToDelete) {
      delete state.players[key];
    }

    return removed;
  }

  private pruneOrphanedTelemetryPlayers(state: TelemetryMatchState): number {
    let removed = 0;
    for (const [playerKey, player] of Object.entries(state.players)) {
      if (state.teams[player.teamId]) {
        continue;
      }
      delete state.players[playerKey];
      removed += 1;
    }
    return removed;
  }

  private pruneEmptyProvisionalTeams(state: TelemetryMatchState): number {
    if (state.mode === 'MANUAL') {
      return 0;
    }

    const hasTelemetrySignal =
      (typeof state.telemetryAcceptedAt === 'number' &&
        Number.isFinite(state.telemetryAcceptedAt)) ||
      Object.values(state.players).some(
        (player) => player.metadata?.observedInTelemetry === true,
      ) ||
      Object.values(state.teams).some(
        (team) => team.metadata?.observedInTelemetry === true,
      );
    if (!hasTelemetrySignal) {
      return 0;
    }

    let removed = 0;
    for (const [teamId, team] of Object.entries(state.teams)) {
      const hasManualOwnership =
        hasManualOverride(team.ownership?.eliminated) ||
        hasManualOverride(team.ownership?.placement) ||
        hasManualOverride(team.ownership?.totalKills);
      if (hasManualOwnership) {
        continue;
      }

      const teamPlayers = Object.values(state.players).filter(
        (player) => player.teamId === teamId,
      );
      if (
        team.metadata?.provisional === true &&
        !this.isCanonicalSeedTeam(team) &&
        team.metadata?.observedInTelemetry !== true &&
        teamPlayers.length === 0
      ) {
        delete state.teams[teamId];
        removed += 1;
      }
    }
    return removed;
  }

  private sanitizeTelemetryState(
    state: TelemetryMatchState,
    params: {
      reason: string;
      timestamp: number;
      recomputeDerivedState?: boolean;
    },
  ): {
    duplicatePlayersRemoved: number;
    orphanPlayersRemoved: number;
    provisionalTeamsRemoved: number;
  } {
    const duplicatePlayersRemoved = this.pruneCanonicalPlayerDuplicates(state);
    const orphanPlayersRemoved = this.pruneOrphanedTelemetryPlayers(state);
    const provisionalTeamsRemoved = this.pruneEmptyProvisionalTeams(state);
    const changed =
      duplicatePlayersRemoved > 0 ||
      orphanPlayersRemoved > 0 ||
      provisionalTeamsRemoved > 0;

    if (changed && params.recomputeDerivedState) {
      this.recomputeDerivedState(state, params.timestamp);
    }

    if (changed) {
      this.logger.log(
        JSON.stringify({
          tag: '[TELEMETRY][CLEANUP]',
          stage: 'telemetry-engine',
          action: 'sanitized-runtime-state',
          matchId: state.matchId,
          reason: params.reason,
          duplicatePlayersRemoved,
          orphanPlayersRemoved,
          provisionalTeamsRemoved,
          remainingPlayers: Object.keys(state.players).length,
          remainingTeams: Object.keys(state.teams).length,
        }),
      );
    }

    return {
      duplicatePlayersRemoved,
      orphanPlayersRemoved,
      provisionalTeamsRemoved,
    };
  }

  private resetUnobservedFallbackTeamPlayers(
    state: TelemetryMatchState,
    teamId: string,
  ): void {
    const teamPlayers = Object.entries(state.players).filter(
      ([, player]) => player.teamId === teamId,
    );
    if (teamPlayers.length === 0) {
      return;
    }

    const shouldReset = teamPlayers.every(([, player]) => {
      const slotPlayerResultId = normalizeLookup(
        player.metadata?.slotPlayerResultId,
      );
      return (
        player.metadata?.observedInTelemetry !== true &&
        slotPlayerResultId.length === 0
      );
    });
    if (!shouldReset) {
      return;
    }

    for (const [playerId] of teamPlayers) {
      delete state.players[playerId];
    }

    const team = state.teams[teamId];
    if (team) {
      team.alivePlayers = 0;
      team.totalPlayers = 0;
      team.eliminated = false;
      team.placement = null;
      team.eliminatedAt = null;
      team.metadata = {
        ...(team.metadata ?? {}),
        provisional: true,
      };
    }

    this.logger.warn(
      JSON.stringify({
        tag: '[TELEMETRY][MAPPING]',
        stage: 'telemetry-engine',
        action: 'fallback-team-roster-reset',
        matchId: state.matchId,
        teamId,
        removedPlayers: teamPlayers.length,
      }),
    );
  }

  private canMaterializeTelemetryPlayers(
    state: TelemetryMatchState,
    teamId: string,
  ): boolean {
    const team = state.teams[teamId];
    if (!team) {
      return false;
    }
    if (
      team.metadata?.provisional === true &&
      !this.isCanonicalSeedTeam(team)
    ) {
      return true;
    }

    const teamPlayers = Object.values(state.players).filter(
      (player) => player.teamId === teamId,
    );
    if (teamPlayers.length < 4) {
      // Slot-seeded API matches may begin with an incomplete canonical roster.
      // Allow the live telemetry feed to materialize the missing players for
      // those teams instead of freezing the match at a partial mapped subset.
      return Boolean(this.mapping) && this.isCanonicalSeedTeam(team);
    }

    return teamPlayers.every((player) => {
      const slotPlayerResultId = normalizeLookup(
        player.metadata?.slotPlayerResultId,
      );
      return (
        player.metadata?.observedInTelemetry !== true &&
        slotPlayerResultId.length === 0
      );
    });
  }

  private pruneNeverObservedSyntheticState(
    state: TelemetryMatchState,
    input: {
      hasIncomingTelemetry: boolean;
      packetTeamIds: Set<string>;
      touchedTeamIds: Set<string>;
    },
  ): { removedPlayers: number; removedTeams: number } {
    if (state.mode === 'MANUAL' || !input.hasIncomingTelemetry) {
      return { removedPlayers: 0, removedTeams: 0 };
    }

    const strongTeamTelemetryPacket =
      input.packetTeamIds.size >= 2 &&
      input.packetTeamIds.size >=
        Math.ceil(Math.max(Object.keys(state.teams).length, 1) / 2);

    let removedPlayers = 0;
    const prunedTeamIds = new Set<string>();
    for (const [playerId, player] of Object.entries(state.players)) {
      const team = state.teams[player.teamId];
      const pruneAbsentNeverObservedCanonicalPlaceholder =
        strongTeamTelemetryPacket &&
        team !== undefined &&
        !input.packetTeamIds.has(player.teamId) &&
        this.isCanonicalSeedTeam(team) &&
        !this.isPersistedCanonicalMatchTeam(team) &&
        team.metadata?.observedInTelemetry !== true &&
        team.metadata?.wasPresentInMatch !== true;
      if (
        (!input.touchedTeamIds.has(player.teamId) &&
          !pruneAbsentNeverObservedCanonicalPlaceholder) ||
        !this.isNeverObservedCanonicalPlaceholder(player)
      ) {
        continue;
      }
      delete state.players[playerId];
      prunedTeamIds.add(player.teamId);
      removedPlayers += 1;
    }

    const syntheticTeamIds = new Set<string>();
    for (const [teamId, team] of Object.entries(state.teams)) {
      if (
        team.metadata?.provisional === true &&
        !this.isCanonicalSeedTeam(team)
      ) {
        syntheticTeamIds.add(teamId);
        continue;
      }

      const teamPlayers = Object.values(state.players).filter(
        (player) => player.teamId === teamId,
      );
      if (teamPlayers.length < 4) {
        continue;
      }

      const allPlayersFallbackOnly = teamPlayers.every((player) => {
        const slotPlayerResultId = normalizeLookup(
          player.metadata?.slotPlayerResultId,
        );
        const hasManualOwnership =
          hasManualOverride(player.ownership?.alive) ||
          hasManualOverride(player.ownership?.knocked) ||
          hasManualOverride(player.ownership?.kills);
        return (
          !hasManualOwnership &&
          player.metadata?.observedInTelemetry !== true &&
          !this.isCanonicalSeedPlayer(player) &&
          slotPlayerResultId.length === 0
        );
      });
      if (allPlayersFallbackOnly) {
        syntheticTeamIds.add(teamId);
      }
    }
    for (const [playerId, player] of Object.entries(state.players)) {
      if (
        !syntheticTeamIds.has(player.teamId) ||
        player.metadata?.observedInTelemetry === true
      ) {
        continue;
      }
      delete state.players[playerId];
      prunedTeamIds.add(player.teamId);
      removedPlayers += 1;
    }

    const teamsWithObservedPlayers = new Set(
      Object.values(state.players)
        .filter((player) => player.metadata?.observedInTelemetry === true)
        .map((player) => player.teamId),
    );

    let removedTeams = 0;
    for (const [teamId, team] of Object.entries(state.teams)) {
      const hasManualOwnership =
        hasManualOverride(team.ownership?.eliminated) ||
        hasManualOverride(team.ownership?.placement) ||
        hasManualOverride(team.ownership?.totalKills);
      if (hasManualOwnership) {
        continue;
      }
      const teamHasPlayers = Object.values(state.players).some(
        (player) => player.teamId === teamId,
      );
      const pruneNeverObservedCanonicalTeam =
        strongTeamTelemetryPacket &&
        !input.packetTeamIds.has(teamId) &&
        this.isCanonicalSeedTeam(team) &&
        !this.isPersistedCanonicalMatchTeam(team) &&
        team.metadata?.observedInTelemetry !== true &&
        team.metadata?.wasPresentInMatch !== true &&
        !teamHasPlayers;
      if (pruneNeverObservedCanonicalTeam) {
        delete state.teams[teamId];
        removedTeams += 1;
        continue;
      }
      if (
        this.isCanonicalSeedTeam(team) ||
        (!prunedTeamIds.has(teamId) && team.metadata?.provisional !== true) ||
        teamHasPlayers ||
        input.packetTeamIds.has(teamId) ||
        teamsWithObservedPlayers.has(teamId) ||
        team.metadata?.observedInTelemetry === true
      ) {
        continue;
      }
      delete state.teams[teamId];
      removedTeams += 1;
    }

    if (removedPlayers > 0 || removedTeams > 0) {
      this.logger.log(
        JSON.stringify({
          tag: '[TELEMETRY][CLEANUP]',
          stage: 'telemetry-engine',
          action: 'never-observed-synthetic-state-pruned',
          matchId: state.matchId,
          removedPlayers,
          removedTeams,
          remainingPlayers: Object.keys(state.players).length,
          remainingTeams: Object.keys(state.teams).length,
        }),
      );
    }

    return { removedPlayers, removedTeams };
  }

  private adapterPlayerExternalId(
    player: AdapterTelemetryPlayer,
  ): string | null {
    return (
      toOptionalText(player.externalPlayerId) ??
      toOptionalText(player.pubgPlayerId) ??
      toOptionalText(player.playerId) ??
      toOptionalText(player.pubgAccountId) ??
      null
    );
  }

  private adapterPlayerInGameId(player: AdapterTelemetryPlayer): string | null {
    return (
      toOptionalText(player.pubgPlayerId) ??
      toOptionalText(player.externalPlayerId) ??
      toOptionalText(player.playerId) ??
      null
    );
  }

  private async syncSavedPlayerIdentityFromTelemetry(
    matchId: string,
    player: AdapterTelemetryPlayer,
    teamId: string | null,
  ): Promise<void> {
    if (
      !this.prisma.player?.findUnique ||
      !this.prisma.player?.findMany ||
      !this.prisma.player?.update
    ) {
      return;
    }

    const playerId = toOptionalText(player.playerId);
    const playerOpenId = toOptionalText(player.pubgAccountId);
    const candidatePubgUid =
      this.adapterPlayerInGameId(player) ??
      this.adapterPlayerExternalId(player);
    const pubgUid = isRealPubgUidCandidate(candidatePubgUid, playerOpenId)
      ? candidatePubgUid.trim()
      : null;
    if (!playerId || !pubgUid) {
      return;
    }

    const incomingName = toOptionalText(player.ign);
    const cacheKey = [
      playerId,
      pubgUid,
      playerOpenId ?? '',
      normalizeLookup(incomingName),
    ].join(':');
    if (this.playerIdentitySyncCache.has(cacheKey)) {
      return;
    }

    try {
      const target = await this.prisma.player.findUnique({
        where: { id: playerId },
        select: {
          id: true,
          organizationId: true,
          teamId: true,
          ign: true,
          source: true,
          photoUrl: true,
          deletedAt: true,
          externalSource: true,
          externalId: true,
          externalPlayerId: true,
          playerOpenId: true,
          inGameId: true,
          pubgPlayerId: true,
          pubgIdSource: true,
        },
      });
      if (!target || target.deletedAt) {
        this.playerIdentitySyncCache.add(cacheKey);
        return;
      }

      const conflicts = await this.prisma.player.findMany({
        where: {
          organizationId: target.organizationId,
          id: { not: target.id },
          deletedAt: null,
          OR: [
            { externalPlayerId: pubgUid },
            { externalId: pubgUid },
            { playerOpenId: pubgUid },
            { inGameId: pubgUid },
            { pubgPlayerId: pubgUid },
            ...(playerOpenId ? [{ playerOpenId }] : []),
          ],
        },
        select: {
          id: true,
          ign: true,
          teamId: true,
          source: true,
          photoUrl: true,
          externalId: true,
          externalPlayerId: true,
          playerOpenId: true,
          inGameId: true,
          pubgPlayerId: true,
        },
      });

      let mergedDuplicateCount = 0;
      let clearedConflictCount = 0;
      let mergedPhotoUrl: string | null = null;
      const targetHasUsefulPhoto = isUsefulPlayerPhotoUrl(target.photoUrl);
      const incomingNameLookup = normalizeLookup(incomingName ?? target.ign);

      for (const conflict of conflicts) {
        const data: Prisma.PlayerUncheckedUpdateInput = {};
        if (conflict.externalPlayerId === pubgUid) {
          data.externalPlayerId = null;
        }
        if (conflict.externalId === pubgUid) {
          data.externalId = null;
        }
        if (conflict.playerOpenId === pubgUid) {
          data.playerOpenId = null;
        }
        if (playerOpenId && conflict.playerOpenId === playerOpenId) {
          data.playerOpenId = null;
        }
        if (conflict.inGameId === pubgUid) {
          data.inGameId = null;
        }
        if (conflict.pubgPlayerId === pubgUid) {
          data.pubgPlayerId = null;
        }

        const sameTeam =
          (teamId !== null && conflict.teamId === teamId) ||
          (target.teamId !== null && conflict.teamId === target.teamId);
        const sameName =
          incomingNameLookup.length > 0 &&
          normalizeLookup(conflict.ign) === incomingNameLookup;
        const autoCreated = String(conflict.source) === 'API';
        if (
          autoCreated &&
          (sameTeam || sameName) &&
          !isUsefulPlayerPhotoUrl(conflict.photoUrl)
        ) {
          data.deletedAt = new Date();
          data.deletedBy = 'telemetry-identity-merge';
          data.isActive = false;
          mergedDuplicateCount += 1;
        } else {
          clearedConflictCount += Object.keys(data).length > 0 ? 1 : 0;
        }

        if (
          !targetHasUsefulPhoto &&
          !mergedPhotoUrl &&
          isUsefulPlayerPhotoUrl(conflict.photoUrl)
        ) {
          mergedPhotoUrl = conflict.photoUrl;
        }

        if (Object.keys(data).length > 0) {
          await this.prisma.player.update({
            where: { id: conflict.id },
            data,
            select: { id: true },
          });
        }
      }

      const data: Prisma.PlayerUncheckedUpdateInput = {};
      if (target.externalSource !== 'PUBG_TELEMETRY') {
        data.externalSource = 'PUBG_TELEMETRY';
      }
      if (target.externalId !== pubgUid) {
        data.externalId = pubgUid;
      }
      if (target.externalPlayerId !== pubgUid) {
        data.externalPlayerId = pubgUid;
      }
      if (target.inGameId !== pubgUid) {
        data.inGameId = pubgUid;
      }
      if (target.pubgPlayerId !== pubgUid) {
        data.pubgPlayerId = pubgUid;
      }
      if (playerOpenId && target.playerOpenId !== playerOpenId) {
        data.playerOpenId = playerOpenId;
      }
      if (incomingName && target.ign !== incomingName) {
        data.ign = incomingName;
      }
      if (String(target.pubgIdSource) !== 'PCOB') {
        data.pubgIdSource = 'PCOB';
      }
      if (mergedPhotoUrl) {
        data.photoUrl = mergedPhotoUrl;
      }

      if (Object.keys(data).length > 0) {
        await this.prisma.player.update({
          where: { id: target.id },
          data,
          select: { id: true },
        });
      }

      if (
        Object.keys(data).length > 0 ||
        clearedConflictCount > 0 ||
        mergedDuplicateCount > 0
      ) {
        this.logger.log(
          JSON.stringify({
            tag: '[TELEMETRY][PLAYER IDENTITY SYNC]',
            stage: 'telemetry-engine',
            matchId,
            playerId,
            pubgUid,
            playerOpenId,
            ign: incomingName ?? target.ign,
            mergedDuplicateCount,
            clearedConflictCount,
          }),
        );
      }

      this.playerIdentitySyncCache.add(cacheKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        JSON.stringify({
          tag: '[TELEMETRY][PLAYER IDENTITY SYNC]',
          stage: 'telemetry-engine',
          action: 'player-identity-sync-failed',
          matchId,
          playerId,
          pubgUid,
          playerOpenId,
          reason: message,
        }),
      );
    }
  }

  private materializeMappedStatePlayer(
    state: TelemetryMatchState,
    incoming: IncomingAdapterPlayer,
    teamId: string,
    mapping: TelemetryPlayerMapping,
  ): TelemetryPlayerState | null {
    this.resetUnobservedFallbackTeamPlayers(state, teamId);

    const existing =
      this.findStatePlayerByMapping(state, mapping) ??
      state.players[mapping.playerKey];
    if (existing) {
      return existing;
    }

    const next: TelemetryPlayerState = {
      playerId: mapping.playerKey,
      teamId,
      alive:
        typeof incoming.player.alive === 'boolean'
          ? incoming.player.alive
          : true,
      knocked:
        typeof incoming.player.knocked === 'boolean'
          ? incoming.player.knocked
          : false,
      health: normalizeAdapterPlayerHealth(incoming.player),
      kills: normalizeNonNegativeInteger(incoming.player.kills) ?? 0,
      assists: normalizeNonNegativeInteger(incoming.player.assists) ?? 0,
      metadata: {
        playerName:
          incoming.player.ign ??
          incoming.player.playerId ??
          incoming.player.externalPlayerId ??
          mapping.playerKey,
        slotPlayerResultId: mapping.slotPlayerResultId,
        externalPlayerId: this.adapterPlayerExternalId(incoming.player),
        playerOpenId: toOptionalText(incoming.player.pubgAccountId),
        inGameId: this.adapterPlayerInGameId(incoming.player),
        position: null,
      },
    };

    state.players[mapping.playerKey] = next;
    const team = state.teams[teamId];
    if (team) {
      const teamPlayerCount = Object.values(state.players).filter(
        (player) => player.teamId === teamId,
      ).length;
      team.totalPlayers = Math.max(team.totalPlayers, teamPlayerCount);
    }

    return next;
  }

  private materializeTelemetryPlayer(
    state: TelemetryMatchState,
    incoming: IncomingAdapterPlayer,
    teamId: string,
  ): ResolvedAdapterPlayer | null {
    const playerKey =
      toOptionalText(incoming.player.externalPlayerId) ??
      toOptionalText(incoming.player.pubgAccountId) ??
      toOptionalText(incoming.player.playerId) ??
      toOptionalText(this.adapterIncomingPlayerId(incoming)) ??
      this.toTeamNamePlayerIdentity(teamId, incoming.player.ign);
    if (!playerKey) {
      return null;
    }

    const existing = state.players[playerKey];
    if (existing) {
      if (existing.teamId !== teamId) {
        this.logTelemetryStructuralMutation(state.matchId, {
          reason: 'PLAYER_TEAM_REASSIGNMENT',
          playerId: existing.playerId,
          currentTeamId: existing.teamId,
          incomingTeamId: teamId,
          externalPlayerId: incoming.player.externalPlayerId ?? null,
          pubgAccountId: incoming.player.pubgAccountId ?? null,
        });
        return null;
      }
      return {
        playerKey,
        teamId,
        mapping: null,
      };
    }

    this.resetUnobservedFallbackTeamPlayers(state, teamId);

    state.players[playerKey] = {
      playerId: playerKey,
      teamId,
      alive:
        typeof incoming.player.alive === 'boolean'
          ? incoming.player.alive
          : true,
      knocked:
        typeof incoming.player.knocked === 'boolean'
          ? incoming.player.knocked
          : false,
      health: normalizeAdapterPlayerHealth(incoming.player),
      kills: normalizeNonNegativeInteger(incoming.player.kills) ?? 0,
      assists: normalizeNonNegativeInteger(incoming.player.assists) ?? 0,
      metadata: {
        playerName:
          incoming.player.ign ??
          incoming.player.playerId ??
          incoming.player.externalPlayerId ??
          playerKey,
        slotPlayerResultId: null,
        externalPlayerId: this.adapterPlayerExternalId(incoming.player),
        playerOpenId: toOptionalText(incoming.player.pubgAccountId),
        inGameId: this.adapterPlayerInGameId(incoming.player),
        position: null,
        provisional: true,
      },
    };

    const team = state.teams[teamId];
    if (team) {
      const teamPlayerCount = Object.values(state.players).filter(
        (player) => player.teamId === teamId,
      ).length;
      team.totalPlayers = Math.max(team.totalPlayers, teamPlayerCount);
      team.metadata = {
        ...(team.metadata ?? {}),
        provisional: true,
      };
    }

    this.logger.warn(
      JSON.stringify({
        tag: '[TELEMETRY][MAPPING]',
        stage: 'telemetry-engine',
        action: 'adapter-player-materialized',
        matchId: state.matchId,
        teamId,
        playerKey,
        externalPlayerId: incoming.player.externalPlayerId ?? null,
        pubgAccountId: incoming.player.pubgAccountId ?? null,
        ign: incoming.player.ign ?? null,
        provisional: true,
      }),
    );

    return {
      playerKey,
      teamId,
      mapping: null,
    };
  }

  private logTelemetryStructuralMutation(
    matchId: string,
    details: Record<string, unknown>,
  ): void {
    this.logger.warn(
      JSON.stringify({
        tag: '[TELEMETRY][BLOCKED]',
        stage: 'telemetry-engine',
        action: 'structural-mutation-attempt',
        message: '[TELEMETRY BLOCKED] Structural mutation attempt',
        matchId,
        ...details,
      }),
    );
  }

  private buildAdapterTickContext(
    envelope: AdapterTelemetryEnvelope,
    source: string,
    sessionId: string | null,
    sequence: number | null,
  ): AdapterTickContext {
    const phase =
      typeof envelope.zone?.phase === 'number' &&
      Number.isFinite(envelope.zone.phase)
        ? Math.trunc(envelope.zone.phase)
        : null;
    return {
      matchId: envelope.matchId,
      source,
      sessionId,
      sequence,
      timestamp: envelope.timestamp,
      phase,
      players: envelope.players?.length ?? 0,
      teams: envelope.teams?.length ?? 0,
      events: envelope.events?.length ?? 0,
    };
  }

  private logAdapterTickProcessed(
    context: AdapterTickContext,
    state: TelemetryMatchState,
    options: {
      ignored: boolean;
      reason: string | null;
      publishMode: 'best-known' | 'transition';
    },
  ): void {
    this.logger.log(
      JSON.stringify({
        tag: '[TICK PROCESSED]',
        stage: 'telemetry-engine',
        action: 'adapter-tick-processed',
        matchId: context.matchId,
        source: context.source,
        sessionId: context.sessionId,
        sequence: context.sequence,
        timestamp: context.timestamp,
        incomingPhase: context.phase,
        currentPhase:
          typeof state.circle?.phase === 'number' &&
          Number.isFinite(state.circle.phase)
            ? Math.trunc(state.circle.phase)
            : null,
        incomingPlayers: context.players,
        incomingTeams: context.teams,
        incomingEvents: context.events,
        statePlayers: Object.keys(state.players ?? {}).length,
        stateTeams: Object.keys(state.teams ?? {}).length,
        aliveTeams: state.teamsAlive ?? null,
        status: state.status,
        ignored: options.ignored,
        reason: options.reason,
        publishMode: options.publishMode,
      }),
    );
  }

  private logPipelineEngineStateBuilt(
    context: AdapterTickContext,
    state: TelemetryMatchState,
    params: {
      outcome: 'built' | 'ignored';
      reason?: string | null;
      publishMode?: string | null;
      runtimeUpdatesApplied?: boolean;
      aggregateUpdatesAllowed?: boolean;
      mappedPlayers?: number;
      expectedPlayers?: number;
      lockedMappings?: number;
      mappingStability?: number;
    },
  ): void {
    this.logger.log(
      JSON.stringify({
        tag: '[PIPELINE][ENGINE STATE BUILT]',
        stage: 'telemetry-engine',
        outcome: params.outcome,
        matchId: context.matchId,
        sessionId: context.sessionId,
        source: context.source,
        sequence: context.sequence,
        timestamp: context.timestamp,
        reason: params.reason ?? null,
        publishMode: params.publishMode ?? null,
        runtimeUpdatesApplied: params.runtimeUpdatesApplied ?? null,
        aggregateUpdatesAllowed: params.aggregateUpdatesAllowed ?? null,
        mappedPlayers: params.mappedPlayers ?? null,
        expectedPlayers: params.expectedPlayers ?? null,
        lockedMappings: params.lockedMappings ?? null,
        mappingStability:
          typeof params.mappingStability === 'number'
            ? Number(params.mappingStability.toFixed(4))
            : null,
        status: state.status,
        teamsAlive: state.teamsAlive ?? null,
        circlePhase: state.circle?.phase ?? null,
        playersTracked: Object.keys(state.players ?? {}).length,
        teamsTracked: Object.keys(state.teams ?? {}).length,
        killFeedCount: state.killFeed?.length ?? 0,
        eventCount: state.events?.length ?? 0,
      }),
    );
  }

  private async finalizeIgnoredAdapterTick(
    state: TelemetryMatchState,
    context: AdapterTickContext,
    reason: string,
    details: {
      runtimeUpdatesApplied?: boolean;
      aggregateUpdatesAllowed?: boolean;
      mappedPlayers?: number;
      expectedPlayers?: number;
      lockedMappings?: number;
      mappingStability?: number;
    } = {},
  ): Promise<MutationResult> {
    this.logAdapterTickProcessed(context, state, {
      ignored: true,
      reason,
      publishMode: 'best-known',
    });
    this.logPipelineEngineStateBuilt(context, state, {
      outcome: 'ignored',
      reason,
      publishMode: 'best-known',
      runtimeUpdatesApplied: details.runtimeUpdatesApplied,
      aggregateUpdatesAllowed: details.aggregateUpdatesAllowed,
      mappedPlayers: details.mappedPlayers,
      expectedPlayers: details.expectedPlayers,
      lockedMappings: details.lockedMappings,
      mappingStability: details.mappingStability,
    });
    try {
      await this.broadcast.broadcastState(state);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        JSON.stringify({
          tag: '[TELEMETRY][TICK DROPPED]',
          stage: 'telemetry-engine',
          action: 'best-known-publish-failed',
          matchId: context.matchId,
          source: context.source,
          sessionId: context.sessionId,
          sequence: context.sequence,
          timestamp: context.timestamp,
          reason,
          message,
        }),
      );
    }
    return {
      state,
      ignored: true,
      reason,
    };
  }

  private restoreRejectedEndTransition(
    current: TelemetryMatchState,
    next: TelemetryMatchState,
  ): void {
    next.status = current.status;
    next.endedAt = current.endedAt ?? null;
  }

  private toExistingEliminatedOrder(
    totalTeams: number,
    team: TelemetryTeamState,
    previousTotalTeams = totalTeams,
  ): number | null {
    if (team.eliminated !== true) {
      return null;
    }
    if (typeof team.placement !== 'number' || team.placement <= 1) {
      return totalTeams;
    }
    const placementTotal =
      team.placement > totalTeams && previousTotalTeams > totalTeams
        ? previousTotalTeams
        : totalTeams;
    return Math.max(placementTotal - team.placement + 1, 1);
  }

  private shouldIncludeTeamInPlacementDerivation(
    state: TelemetryMatchState,
    input: {
      team: TelemetryTeamState;
      teamPlayers: Array<{ key: string; state: TelemetryPlayerState }>;
      freshTelemetry: FreshTeamTelemetry | null;
    },
    context: {
      earlyTelemetryPhase: boolean;
      hasConfirmedPlacementPresence: boolean;
    },
  ): boolean {
    const { team, teamPlayers, freshTelemetry } = input;
    const metadataTotalPlayers =
      typeof team.metadata?.totalPlayers === 'number' &&
      Number.isFinite(team.metadata.totalPlayers)
        ? Math.max(0, Math.trunc(team.metadata.totalPlayers))
        : 0;
    const telemetryTotalPlayers = freshTelemetry?.totalPlayers ?? 0;
    const telemetryAlivePlayers = freshTelemetry?.alivePlayers ?? 0;
    const hasRuntimeRoster =
      teamPlayers.length > 0 ||
      team.totalPlayers > 0 ||
      metadataTotalPlayers > 0 ||
      telemetryTotalPlayers > 0 ||
      telemetryAlivePlayers > 0;
    const hasManualTeamOwnership =
      hasManualOverride(team.ownership?.eliminated) ||
      hasManualOverride(team.ownership?.placement) ||
      hasManualOverride(team.ownership?.totalKills);

    if (team.metadata?.wasPresentInMatch === true) {
      return true;
    }
    if (this.hasConfirmedTeamPresence(input)) {
      return true;
    }
    if (team.metadata?.observedInTelemetry === true && hasRuntimeRoster) {
      return true;
    }
    if (
      state.status === 'PENDING' ||
      state.mode === 'MANUAL' ||
      context.earlyTelemetryPhase ||
      !context.hasConfirmedPlacementPresence
    ) {
      return hasRuntimeRoster || hasManualTeamOwnership;
    }
    if (hasManualTeamOwnership && hasRuntimeRoster) {
      return true;
    }
    if (team.metadata?.wasPresentInMatch === false) {
      return false;
    }
    if (team.metadata?.canonicalSeed === true) {
      return false;
    }

    return hasRuntimeRoster;
  }

  private hasConfirmedTeamPresence(input: {
    team: TelemetryTeamState;
    teamPlayers: Array<{ key: string; state: TelemetryPlayerState }>;
    freshTelemetry: FreshTeamTelemetry | null;
  }): boolean {
    const { team, teamPlayers, freshTelemetry } = input;
    const telemetryTotalPlayers = freshTelemetry?.totalPlayers ?? 0;
    const telemetryAlivePlayers = freshTelemetry?.alivePlayers ?? 0;
    return (
      team.metadata?.wasPresentInMatch === true ||
      teamPlayers.some(
        (entry) => entry.state.metadata?.observedInTelemetry === true,
      ) ||
      (freshTelemetry !== null &&
        (telemetryTotalPlayers > 0 ||
          telemetryAlivePlayers > 0 ||
          freshTelemetry.placement !== null ||
          freshTelemetry.kills !== null))
    );
  }

  private cloneState(state: TelemetryMatchState): TelemetryMatchState {
    return this.ensureStateDefaults(
      JSON.parse(JSON.stringify(state)) as TelemetryMatchState,
    );
  }

  private createAcceptedRun(
    state?: TelemetryMatchState | null,
    opts: {
      trustAcceptedProof?: boolean;
      sessionId?: string | null;
      sequence?: number | null;
    } = {},
  ): AcceptedTelemetryRun {
    const trustAcceptedProof = opts.trustAcceptedProof === true;
    const acceptedAt =
      trustAcceptedProof &&
      typeof state?.telemetryAcceptedAt === 'number' &&
      Number.isFinite(state.telemetryAcceptedAt)
        ? state.telemetryAcceptedAt
        : null;
    const acceptedSource =
      trustAcceptedProof &&
      typeof state?.telemetryAcceptedSource === 'string' &&
      state.telemetryAcceptedSource.trim().length > 0
        ? canonicalizeTelemetryRuntimeSource(state.telemetryAcceptedSource)
        : null;

    return {
      sessionId: opts.sessionId ?? null,
      lastAcceptedSequence: opts.sequence ?? null,
      hasAcceptedLiveTelemetry: acceptedAt !== null,
      lastAcceptedAt: acceptedAt,
      lastAcceptedSource: acceptedSource,
    };
  }

  private getAcceptedRun(
    matchId: string,
    state?: TelemetryMatchState | null,
  ): AcceptedTelemetryRun {
    const existing = this.acceptedRuns.get(matchId);
    if (existing) {
      return { ...existing };
    }
    const bootstrapped = this.createAcceptedRun(state, {
      trustAcceptedProof: true,
    });
    this.acceptedRuns.set(matchId, bootstrapped);
    return { ...bootstrapped };
  }

  private setAcceptedRun(matchId: string, run: AcceptedTelemetryRun): void {
    this.acceptedRuns.set(matchId, { ...run });
  }

  private resetAcceptedRun(
    matchId: string,
    state?: TelemetryMatchState | null,
  ): AcceptedTelemetryRun {
    const next = this.createAcceptedRun(state, {
      trustAcceptedProof: false,
    });
    this.setAcceptedRun(matchId, next);
    return next;
  }

  private hasAcceptedLiveTelemetry(run: AcceptedTelemetryRun): boolean {
    return run.hasAcceptedLiveTelemetry === true;
  }

  private hasSessionScopedLiveTelemetry(run: AcceptedTelemetryRun): boolean {
    return (
      this.hasAcceptedLiveTelemetry(run) &&
      normalizeLookup(run.lastAcceptedSource ?? null) !== 'pcob_api'
    );
  }

  private toAdapterSessionId(value: unknown): string | null {
    const normalized = toIdentifier(value);
    return normalized.length > 0 ? normalized : null;
  }

  private toAdapterSequence(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    }
    return null;
  }

  private advanceAcceptedRun(
    current: AcceptedTelemetryRun,
    params: {
      sessionId: string | null;
      sequence: number | null;
      hasLiveTelemetry: boolean;
      timestamp: number;
      source: string;
    },
  ): AcceptedTelemetryRun {
    return {
      sessionId: params.sessionId ?? current.sessionId ?? null,
      lastAcceptedSequence:
        params.sequence ?? current.lastAcceptedSequence ?? null,
      hasAcceptedLiveTelemetry:
        current.hasAcceptedLiveTelemetry || params.hasLiveTelemetry,
      lastAcceptedAt: params.hasLiveTelemetry
        ? params.timestamp
        : current.lastAcceptedAt,
      lastAcceptedSource: params.hasLiveTelemetry
        ? canonicalizeTelemetryRuntimeSource(params.source)
        : current.lastAcceptedSource,
    };
  }

  private getEndSignalTimestamp(
    orderedEvents: AdapterTelemetryEvent[],
    fallbackTimestamp: number,
  ): number | null {
    const matchEndEvents = orderedEvents
      .filter((event) => event.type === 'MATCH_END')
      .map((event) =>
        typeof event.timestamp === 'number' && Number.isFinite(event.timestamp)
          ? event.timestamp
          : fallbackTimestamp,
      );
    if (matchEndEvents.length === 0) {
      return null;
    }
    return Math.max(...matchEndEvents);
  }

  private logAdapterMatchEndRejected(params: {
    reason: string;
    matchId: string;
    source: string;
    currentStatus: MatchEngineStatus;
    currentSequence: number;
    envelopeTimestamp: number;
    eventTypes: AdapterTelemetryEvent['type'][];
    telemetryAcceptedAt?: number | null;
    telemetryAcceptedSource?: string | null;
    endSignalTimestamp?: number | null;
  }) {
    this.logger.warn(
      JSON.stringify({
        stage: 'telemetry-engine',
        action: 'telemetry-engine.adapter-match-end-rejected',
        reason: params.reason,
        matchId: params.matchId,
        source: params.source,
        currentStatus: params.currentStatus,
        currentSequence: params.currentSequence,
        envelopeTimestamp: params.envelopeTimestamp,
        eventTypes: params.eventTypes,
        telemetryAcceptedAt: params.telemetryAcceptedAt ?? null,
        telemetryAcceptedSource: params.telemetryAcceptedSource ?? null,
        endSignalTimestamp: params.endSignalTimestamp ?? null,
      }),
    );
  }

  private hasLiveTelemetrySignal(
    envelope: AdapterTelemetryEnvelope,
    orderedEvents: AdapterTelemetryEvent[],
  ): boolean {
    return (
      (envelope.players?.length ?? 0) > 0 ||
      (envelope.teams?.length ?? 0) > 0 ||
      envelope.zone !== null ||
      orderedEvents.some(
        (event) => event.type !== 'MATCH_START' && event.type !== 'MATCH_END',
      )
    );
  }

  private buildPhaseTransitionTrace(
    state: TelemetryMatchState,
    envelope: AdapterTelemetryEnvelope,
    params: {
      source: string;
      sessionId: string | null;
      sequence: number | null;
      timestamp: number;
      acceptedRun: AcceptedTelemetryRun;
      hasLiveSignal: boolean;
    },
  ): PhaseTransitionTrace {
    const previousPhase =
      typeof state.circle?.phase === 'number' &&
      Number.isFinite(state.circle.phase)
        ? Math.trunc(state.circle.phase)
        : null;
    const nextPhase =
      envelope.zone &&
      typeof envelope.zone.phase === 'number' &&
      Number.isFinite(envelope.zone.phase)
        ? Math.trunc(envelope.zone.phase)
        : previousPhase;
    const currentPlayerIds = this.collectStatePlayerIds(state);
    const incomingPlayerIds = this.collectEnvelopePlayerIds(envelope);
    const currentTeamIds = this.collectStateTeamIds(state);
    const incomingTeamIds = this.collectEnvelopeTeamIds(envelope);
    const currentIdSet = new Set(
      currentPlayerIds.map((id) => normalizeLookup(id)),
    );
    const overlapPlayers = incomingPlayerIds.reduce((count, id) => {
      return currentIdSet.has(normalizeLookup(id)) ? count + 1 : count;
    }, 0);
    const currentPlayers = Object.keys(state.players).length;
    const incomingPlayers = incomingPlayerIds.length;
    const overlapRatio =
      incomingPlayers > 0 ? overlapPlayers / incomingPlayers : 1;
    const phaseChanged = previousPhase !== nextPhase;
    const sessionChanged = Boolean(
      params.sessionId &&
      params.acceptedRun.sessionId &&
      params.acceptedRun.sessionId !== params.sessionId,
    );
    const sharpPlayerDrop =
      currentPlayers >= 8 &&
      incomingPlayers > 0 &&
      incomingPlayers <
        Math.ceil(currentPlayers * PARACHUTE_PARTIAL_PLAYER_RATIO);
    const liveSignalWhilePending =
      state.status !== 'LIVE' && params.hasLiveSignal;
    const packetState = this.extractEnvelopePacketState(envelope);
    const earlyAirPhaseBoundary =
      phaseChanged &&
      currentPlayers >= 8 &&
      previousPhase !== null &&
      nextPhase !== null &&
      previousPhase <= 1 &&
      nextPhase <= 2 &&
      nextPhase >= previousPhase;
    const parachuteSignal =
      this.isParachutePacketState(packetState) || earlyAirPhaseBoundary;
    const existingParachuteWindow = this.parachuteWindows.get(state.matchId);
    const parachuteStablePlayers = Math.max(
      currentPlayers,
      existingParachuteWindow?.stablePlayers ?? 0,
    );
    const parachuteStableTeams = Math.max(
      Object.keys(state.teams).length,
      existingParachuteWindow?.stableTeams ?? 0,
    );
    const parachuteWindowActive =
      parachuteSignal || (existingParachuteWindow?.remainingTicks ?? 0) > 0;
    const partialTransitionSnapshot =
      parachuteWindowActive &&
      parachuteStablePlayers >= 8 &&
      incomingPlayers > 0 &&
      incomingPlayers <
        Math.ceil(parachuteStablePlayers * PARACHUTE_PARTIAL_PLAYER_RATIO);
    const transitionLike =
      phaseChanged ||
      sharpPlayerDrop ||
      sessionChanged ||
      parachuteSignal ||
      partialTransitionSnapshot ||
      (liveSignalWhilePending &&
        (typeof state.telemetryAcceptedAt === 'number' ||
          previousPhase !== null));

    return {
      matchId: state.matchId,
      source: params.source,
      sessionId: params.sessionId,
      sequence: params.sequence,
      timestamp: params.timestamp,
      previousStatus: state.status,
      previousPhase,
      nextPhase,
      phaseChanged,
      currentPlayers,
      incomingPlayers,
      currentTeams: Object.keys(state.teams).length,
      incomingTeams: envelope.teams?.length ?? 0,
      overlapPlayers,
      overlapRatio,
      sharpPlayerDrop,
      sessionChanged,
      liveSignalWhilePending,
      transitionLike,
      currentPlayerIds,
      incomingPlayerIds,
      currentTeamIds,
      incomingTeamIds,
      packetState,
      parachuteSignal,
      parachuteWindowActive,
      parachuteWindowRemaining: existingParachuteWindow?.remainingTicks ?? 0,
      parachuteStablePlayers,
      parachuteStableTeams,
      partialTransitionSnapshot,
      fieldShape: this.summarizeParachuteFieldShape(envelope),
    };
  }

  private collectStatePlayerIds(state: TelemetryMatchState): string[] {
    const ids = new Set<string>();
    for (const [playerKey, player] of Object.entries(state.players)) {
      for (const candidate of [
        playerKey,
        player.playerId,
        player.metadata?.externalPlayerId,
        player.metadata?.inGameId,
        player.metadata?.slotPlayerResultId,
      ]) {
        const normalized = toOptionalText(candidate);
        if (normalized) {
          ids.add(normalized);
        }
      }
      const teamNameIdentity = this.toTeamNamePlayerIdentity(
        player.teamId,
        player.metadata?.playerName,
      );
      if (teamNameIdentity) {
        ids.add(teamNameIdentity);
      }
      const teamSlotNameIdentity = this.toTeamNamePlayerIdentity(
        state.teams[player.teamId]?.metadata?.slot,
        player.metadata?.playerName,
      );
      if (teamSlotNameIdentity) {
        ids.add(teamSlotNameIdentity);
      }
    }
    return [...ids].sort();
  }

  private collectEnvelopePlayerIds(
    envelope: AdapterTelemetryEnvelope,
  ): string[] {
    const ids = new Set<string>();
    const append = (
      player: AdapterTelemetryPlayer,
      parentTeam: AdapterTelemetryTeam | null,
      playerIndex: number | null,
    ) => {
      const identity = this.adapterPlayerIdentity(
        player,
        parentTeam,
        playerIndex,
      );
      if (identity) {
        ids.add(identity);
      }
    };
    for (const player of envelope.players ?? []) {
      append(player, null, null);
    }
    for (const team of envelope.teams ?? []) {
      for (const [index, player] of (team.players ?? []).entries()) {
        append(player, team, index);
      }
    }
    return [...ids].sort();
  }

  private collectStateTeamIds(state: TelemetryMatchState): string[] {
    const ids = new Set<string>();
    for (const [teamKey, team] of Object.entries(state.teams)) {
      for (const candidate of [
        teamKey,
        team.teamId,
        team.metadata?.slot,
        team.metadata?.teamName,
        team.metadata?.teamTag,
      ]) {
        const normalized = toOptionalText(candidate);
        if (normalized) {
          ids.add(normalized);
        }
      }
    }
    return [...ids].sort();
  }

  private collectEnvelopeTeamIds(envelope: AdapterTelemetryEnvelope): string[] {
    const ids = new Set<string>();
    const appendTeam = (team: AdapterTelemetryTeam | null | undefined) => {
      if (!team) {
        return;
      }
      for (const candidate of [
        team.teamId,
        team.slot,
        this.readRawField(team.raw, [
          'teamNo',
          'TeamNo',
          'teamNO',
          'teamSlot',
          'TeamSlot',
          'slot',
          'slotNumber',
          'teamNumber',
        ]),
        team.name,
        team.tag,
      ]) {
        const normalized = toOptionalText(candidate);
        if (normalized) {
          ids.add(normalized);
        }
      }
    };
    for (const team of envelope.teams ?? []) {
      appendTeam(team);
    }
    for (const player of envelope.players ?? []) {
      const teamIdentity =
        player.teamId ??
        this.readRawField(player.raw, [
          'teamId',
          'teamID',
          'TeamId',
          'TeamID',
          'team_id',
          'teamNo',
          'TeamNo',
          'teamNO',
          'teamSlot',
          'TeamSlot',
          'slot',
          'slotNumber',
          'teamNumber',
        ]);
      const normalized = toOptionalText(teamIdentity);
      if (normalized) {
        ids.add(normalized);
      }
    }
    return [...ids].sort();
  }

  private readRawField(raw: unknown, keys: string[]): string | null {
    const record = asRecord(raw);
    if (!record) {
      return null;
    }
    for (const key of keys) {
      const normalized = toOptionalText(record[key]);
      if (normalized) {
        return normalized;
      }
    }
    return null;
  }

  private readPlayerField(
    player: AdapterTelemetryPlayer,
    keys: string[],
    directValues: unknown[] = [],
  ): string | null {
    for (const value of directValues) {
      const normalized = toOptionalText(value);
      if (normalized) {
        return normalized;
      }
    }
    return this.readRawField(player.raw, keys);
  }

  private toTeamNamePlayerIdentity(
    teamId: unknown,
    name: unknown,
  ): string | null {
    const normalizedTeamId = normalizeLookup(teamId);
    const normalizedName = normalizeLookup(name);
    if (!normalizedTeamId || !normalizedName) {
      return null;
    }
    return `team:${normalizedTeamId}:name:${normalizedName}`;
  }

  private adapterPlayerIdentity(
    player: AdapterTelemetryPlayer,
    parentTeam: AdapterTelemetryTeam | null,
    playerIndex: number | null,
  ): string | null {
    const directId = this.readPlayerField(
      player,
      [
        'playerId',
        'playerID',
        'PlayerId',
        'PlayerID',
        'pubgPlayerId',
        'inGameId',
        'uId',
        'UId',
        'id',
        'uid',
        'Uid',
        'UID',
        'externalPlayerId',
        'externalId',
        'playerOpenId',
        'playerOpenID',
        'PlayerOpenId',
        'PlayerOpenID',
        'openId',
        'OpenId',
      ],
      [
        player.pubgPlayerId,
        player.externalPlayerId,
        player.playerId,
        player.pubgAccountId,
      ],
    );
    if (directId) {
      return directId;
    }

    const teamIdentity =
      toOptionalText(player.teamId) ??
      toOptionalText(parentTeam?.teamId) ??
      toOptionalText(parentTeam?.slot) ??
      this.readPlayerField(player, [
        'teamId',
        'teamID',
        'TeamId',
        'TeamID',
        'team_id',
        'teamNo',
        'TeamNo',
        'teamNO',
        'teamSlot',
        'TeamSlot',
        'slot',
        'slotNumber',
        'teamNumber',
      ]);
    const name = this.readPlayerField(
      player,
      ['playerName', 'PlayerName', 'player_name', 'ign', 'name', 'Name'],
      [player.ign],
    );
    const teamNameIdentity = this.toTeamNamePlayerIdentity(teamIdentity, name);
    if (teamNameIdentity) {
      return teamNameIdentity;
    }
    if (teamIdentity && playerIndex !== null) {
      return `team:${normalizeLookup(teamIdentity)}:index:${playerIndex}`;
    }
    return name ? `name:${normalizeLookup(name)}` : null;
  }

  private extractEnvelopePacketState(
    envelope: AdapterTelemetryEnvelope,
  ): string | null {
    const values = new Set<string>();
    this.collectPacketStateFields(envelope.raw, values);
    this.collectPacketStateFields(envelope.zone?.raw, values);
    this.collectPacketStateFields(envelope.zone, values);
    for (const team of (envelope.teams ?? []).slice(0, 8)) {
      this.collectPacketStateFields(team.raw, values);
      for (const player of (team.players ?? []).slice(0, 4)) {
        this.collectPacketStateFields(player.raw, values);
      }
    }
    for (const player of (envelope.players ?? []).slice(0, 16)) {
      this.collectPacketStateFields(player.raw, values);
    }
    return values.size > 0 ? [...values].slice(0, 24).join('|') : null;
  }

  private collectPacketStateFields(
    value: unknown,
    values: Set<string>,
    depth = 0,
  ): void {
    if (value === null || value === undefined || depth > 2) {
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 6)) {
        this.collectPacketStateFields(item, values, depth + 1);
      }
      return;
    }
    const record = asRecord(value);
    if (!record) {
      return;
    }
    const stateKeyPattern =
      /(phase|state|status|stage|mode|zone|circle|flight|plane|parachute|jump)/i;
    for (const [key, rawValue] of Object.entries(record)) {
      const keyLooksRelevant = stateKeyPattern.test(key);
      const textValue = toOptionalText(rawValue);
      if (keyLooksRelevant && textValue) {
        values.add(`${key}:${textValue}`);
        continue;
      }
      if (
        depth < 2 &&
        rawValue &&
        typeof rawValue === 'object' &&
        (keyLooksRelevant ||
          /^(data|match|game|payload|zone|circle|players?|teams?)$/i.test(key))
      ) {
        this.collectPacketStateFields(rawValue, values, depth + 1);
      }
    }
  }

  private isParachutePacketState(packetState: string | null): boolean {
    return Boolean(
      packetState &&
      /(parachut|airborne|airdrop|jump|in[_\s-]?air|plane|flight)/i.test(
        packetState,
      ),
    );
  }

  private isCombatPacketState(packetState: string | null): boolean {
    return Boolean(
      packetState &&
      /(combat|fighting|battle|gunfight|engaged|in[_\s-]?match)/i.test(
        packetState,
      ),
    );
  }

  private summarizeParachuteFieldShape(
    envelope: AdapterTelemetryEnvelope,
  ): ParachuteFieldShapeSummary {
    const summary: ParachuteFieldShapeSummary = {
      total: 0,
      playerId: 0,
      playerOpenId: 0,
      externalPlayerId: 0,
      playerName: 0,
      teamId: 0,
      teamNo: 0,
      teamSlot: 0,
      samples: [],
    };
    const append = (
      player: AdapterTelemetryPlayer,
      source: 'root' | 'team',
      index: number,
    ) => {
      const sample: ParachuteFieldShapeSample = {
        index,
        source,
        playerId: Boolean(
          this.readPlayerField(
            player,
            ['playerId', 'playerID', 'PlayerId', 'PlayerID', 'id'],
            [player.playerId],
          ),
        ),
        playerOpenId: Boolean(
          this.readPlayerField(player, [
            'playerOpenId',
            'playerOpenID',
            'PlayerOpenId',
            'PlayerOpenID',
            'openId',
            'OpenId',
            'openid',
          ]),
        ),
        externalPlayerId: Boolean(
          this.readPlayerField(
            player,
            [
              'externalPlayerId',
              'externalId',
              'uid',
              'Uid',
              'UID',
              'userId',
              'UserId',
              'accountId',
              'AccountId',
            ],
            [player.externalPlayerId],
          ),
        ),
        playerName: Boolean(
          this.readPlayerField(
            player,
            ['playerName', 'PlayerName', 'player_name', 'ign', 'name', 'Name'],
            [player.ign],
          ),
        ),
        teamId: Boolean(
          this.readPlayerField(
            player,
            ['teamId', 'teamID', 'TeamId', 'TeamID', 'team_id'],
            [player.teamId],
          ),
        ),
        teamNo: Boolean(
          this.readPlayerField(player, ['teamNo', 'TeamNo', 'teamNO']),
        ),
        teamSlot: Boolean(
          this.readPlayerField(player, [
            'teamSlot',
            'TeamSlot',
            'slot',
            'slotNumber',
            'teamNumber',
          ]),
        ),
      };
      summary.total += 1;
      summary.playerId += sample.playerId ? 1 : 0;
      summary.playerOpenId += sample.playerOpenId ? 1 : 0;
      summary.externalPlayerId += sample.externalPlayerId ? 1 : 0;
      summary.playerName += sample.playerName ? 1 : 0;
      summary.teamId += sample.teamId ? 1 : 0;
      summary.teamNo += sample.teamNo ? 1 : 0;
      summary.teamSlot += sample.teamSlot ? 1 : 0;
      if (summary.samples.length < 32) {
        summary.samples.push(sample);
      }
    };

    for (const [index, player] of (envelope.players ?? []).entries()) {
      append(player, 'root', index);
    }
    for (const team of envelope.teams ?? []) {
      for (const [index, player] of (team.players ?? []).entries()) {
        append(player, 'team', index);
      }
    }

    return summary;
  }

  private recordParachuteTransitionTick(
    trace: PhaseTransitionTrace,
  ): PhaseTransitionTrace {
    const startWindow =
      trace.parachuteSignal ||
      trace.partialTransitionSnapshot ||
      (trace.sharpPlayerDrop &&
        (trace.phaseChanged ||
          trace.liveSignalWhilePending ||
          trace.parachuteWindowActive));
    let window = this.parachuteWindows.get(trace.matchId) ?? null;
    if (startWindow) {
      window = {
        remainingTicks: Math.max(
          window?.remainingTicks ?? 0,
          PARACHUTE_TRANSITION_STABILITY_TICKS,
        ),
        stablePlayers: Math.max(
          window?.stablePlayers ?? 0,
          trace.currentPlayers,
          trace.incomingPlayers,
        ),
        stableTeams: Math.max(
          window?.stableTeams ?? 0,
          trace.currentTeams,
          trace.incomingTeams,
        ),
        lastSequence: window?.lastSequence ?? null,
        lastPhase: trace.nextPhase,
        lastState: trace.packetState,
      };
    }
    if (!window) {
      return trace;
    }

    const sameSequence =
      trace.sequence !== null && window.lastSequence === trace.sequence;
    if (!sameSequence) {
      window.remainingTicks = Math.max(0, window.remainingTicks - 1);
    }
    window.stablePlayers = Math.max(
      window.stablePlayers,
      trace.currentPlayers,
      trace.incomingPlayers >=
        Math.ceil(window.stablePlayers * PARACHUTE_PARTIAL_PLAYER_RATIO)
        ? trace.incomingPlayers
        : 0,
    );
    window.stableTeams = Math.max(
      window.stableTeams,
      trace.currentTeams,
      trace.incomingTeams,
    );
    window.lastSequence = trace.sequence;
    window.lastPhase = trace.nextPhase;
    window.lastState = trace.packetState;

    const windowActive = window.remainingTicks > 0 || startWindow;
    if (windowActive) {
      this.parachuteWindows.set(trace.matchId, window);
    } else {
      this.parachuteWindows.delete(trace.matchId);
    }

    const partialTransitionSnapshot =
      windowActive &&
      window.stablePlayers >= 8 &&
      trace.incomingPlayers > 0 &&
      trace.incomingPlayers <
        Math.ceil(window.stablePlayers * PARACHUTE_PARTIAL_PLAYER_RATIO);

    return {
      ...trace,
      transitionLike:
        trace.transitionLike || windowActive || partialTransitionSnapshot,
      parachuteWindowActive: windowActive,
      parachuteWindowRemaining: windowActive ? window.remainingTicks : 0,
      parachuteStablePlayers: window.stablePlayers,
      parachuteStableTeams: window.stableTeams,
      partialTransitionSnapshot,
    };
  }

  private shouldLogParachuteTrace(trace: PhaseTransitionTrace): boolean {
    return (
      trace.parachuteSignal ||
      trace.parachuteWindowActive ||
      trace.partialTransitionSnapshot ||
      this.isParachutePacketState(trace.packetState)
    );
  }

  private logParachuteTransitionTick(trace: PhaseTransitionTrace): void {
    if (!this.shouldLogParachuteTrace(trace)) {
      return;
    }
    this.logger.log(
      JSON.stringify({
        tag: '[PARACHUTE][TICK]',
        stage: 'telemetry-engine',
        action: 'parachute-transition-tick',
        matchId: trace.matchId,
        source: trace.source,
        sessionId: trace.sessionId,
        sequence: trace.sequence,
        timestamp: trace.timestamp,
        previousStatus: trace.previousStatus,
        previousPhase: trace.previousPhase,
        nextPhase: trace.nextPhase,
        packetState: trace.packetState,
        parachuteSignal: trace.parachuteSignal,
        parachuteWindowActive: trace.parachuteWindowActive,
        parachuteWindowRemaining: trace.parachuteWindowRemaining,
        partialTransitionSnapshot: trace.partialTransitionSnapshot,
      }),
    );
    this.logger.debug(
      JSON.stringify({
        tag: '[PARACHUTE][IDS]',
        stage: 'telemetry-engine',
        action: 'parachute-transition-ids',
        matchId: trace.matchId,
        source: trace.source,
        sequence: trace.sequence,
        currentPlayerIds: trace.currentPlayerIds.slice(0, 160),
        incomingPlayerIds: trace.incomingPlayerIds.slice(0, 160),
        currentPlayerIdsTotal: trace.currentPlayerIds.length,
        incomingPlayerIdsTotal: trace.incomingPlayerIds.length,
        currentTeamIds: trace.currentTeamIds.slice(0, 80),
        incomingTeamIds: trace.incomingTeamIds.slice(0, 80),
        currentTeamIdsTotal: trace.currentTeamIds.length,
        incomingTeamIdsTotal: trace.incomingTeamIds.length,
      }),
    );
    this.logger.log(
      JSON.stringify({
        tag: '[PARACHUTE][COUNT CHANGE]',
        stage: 'telemetry-engine',
        action: 'parachute-transition-count-change',
        matchId: trace.matchId,
        source: trace.source,
        sequence: trace.sequence,
        currentPlayers: trace.currentPlayers,
        incomingPlayers: trace.incomingPlayers,
        playerDelta: trace.incomingPlayers - trace.currentPlayers,
        currentTeams: trace.currentTeams,
        incomingTeams: trace.incomingTeams,
        teamDelta: trace.incomingTeams - trace.currentTeams,
        overlapPlayers: trace.overlapPlayers,
        overlapRatio: Number(trace.overlapRatio.toFixed(4)),
        sharpPlayerDrop: trace.sharpPlayerDrop,
        stablePlayers: trace.parachuteStablePlayers,
        stableTeams: trace.parachuteStableTeams,
        partialTransitionSnapshot: trace.partialTransitionSnapshot,
      }),
    );
    this.logger.debug(
      JSON.stringify({
        tag: '[PARACHUTE][FIELD SHAPE]',
        stage: 'telemetry-engine',
        action: 'parachute-transition-field-shape',
        matchId: trace.matchId,
        source: trace.source,
        sequence: trace.sequence,
        fieldShape: trace.fieldShape,
      }),
    );
  }

  private logParachutePartialSnapshotBlocked(
    trace: PhaseTransitionTrace,
    snapshot: AdapterSnapshotApplyResult,
  ): void {
    if (!trace.partialTransitionSnapshot) {
      return;
    }
    this.logger.warn(
      JSON.stringify({
        tag: '[PARACHUTE][PARTIAL SNAPSHOT BLOCKED]',
        stage: 'telemetry-engine',
        action: 'parachute-partial-snapshot-blocked',
        matchId: trace.matchId,
        source: trace.source,
        sessionId: trace.sessionId,
        sequence: trace.sequence,
        previousPhase: trace.previousPhase,
        nextPhase: trace.nextPhase,
        packetState: trace.packetState,
        currentPlayers: trace.currentPlayers,
        incomingPlayers: trace.incomingPlayers,
        stablePlayers: trace.parachuteStablePlayers,
        currentTeams: trace.currentTeams,
        incomingTeams: trace.incomingTeams,
        stableTeams: trace.parachuteStableTeams,
        mappedPlayers: snapshot.mappedPlayers,
        expectedPlayers: snapshot.expectedPlayers,
        mappingConfidence: Number(snapshot.mappingConfidence.toFixed(4)),
        aggregateUpdatesAllowedBeforeGuard: snapshot.aggregateUpdatesAllowed,
        eliminationUpdatesBlocked: snapshot.eliminationUpdatesBlocked,
        blockedPlayerEliminations: snapshot.blockedPlayerEliminations,
        blockedPlayerKillUpdates: snapshot.blockedPlayerKillUpdates,
        incomingAlivePlayers: snapshot.incomingAlivePlayers,
        incomingDeadPlayers: snapshot.incomingDeadPlayers,
        positionlessPlayers: snapshot.positionlessPlayers,
        reason: 'PARACHUTE_TRANSITION_PARTIAL_PLAYER_SNAPSHOT',
      }),
    );
  }

  private shouldPreserveRuntimeAcrossPhaseTransition(
    state: TelemetryMatchState,
    trace: PhaseTransitionTrace,
  ): boolean {
    if (!trace.transitionLike) {
      return false;
    }
    if (state.endedAt !== null || state.status === 'ENDED') {
      return false;
    }
    const hasStableTelemetryRuntime =
      typeof state.telemetryAcceptedAt === 'number' ||
      typeof state.circle?.phase === 'number' ||
      Object.keys(state.players).length > 0 ||
      Object.values(state.players).some(
        (player) => player.metadata?.observedInTelemetry === true,
      );
    if (!hasStableTelemetryRuntime) {
      return false;
    }
    if (trace.parachuteWindowActive || trace.partialTransitionSnapshot) {
      return true;
    }
    if (trace.incomingPlayers === 0) {
      return true;
    }
    if (trace.sharpPlayerDrop) {
      return true;
    }
    return trace.overlapPlayers > 0 || trace.overlapRatio >= 0.5;
  }

  private shouldHoldAggregateUpdatesForPhaseTransition(
    trace: PhaseTransitionTrace,
  ): boolean {
    return (
      trace.partialTransitionSnapshot ||
      (trace.parachuteWindowActive && trace.sharpPlayerDrop) ||
      (trace.transitionLike && trace.sharpPlayerDrop)
    );
  }

  private isExplicitCombatPhase(
    phase: number | null,
    packetState: string | null,
    startedAt: number | null = null,
    timestamp: number | null = null,
    hasCombatEvidence = false,
  ): boolean {
    if (this.isParachutePacketState(packetState)) {
      return false;
    }
    const elapsedSinceStart =
      startedAt !== null &&
      timestamp !== null &&
      Number.isFinite(startedAt) &&
      Number.isFinite(timestamp)
        ? Math.max(0, timestamp - startedAt)
        : null;
    return (
      this.isCombatPacketState(packetState) ||
      (phase !== null && phase >= 2) ||
      (phase === 1 &&
        hasCombatEvidence &&
        elapsedSinceStart !== null &&
        elapsedSinceStart >= EARLY_AIR_ELIMINATION_GUARD_MS)
    );
  }

  private adapterEnvelopeHasCombatEvidence(
    envelope: AdapterTelemetryEnvelope,
    players: IncomingAdapterPlayer[],
  ): boolean {
    if ((envelope.events ?? []).some((event) => event.type === 'KILL')) {
      return true;
    }

    if (
      players.some(({ player }) => {
        const kills = normalizeNonNegativeInteger(player.kills);
        return kills !== null && kills > 0;
      })
    ) {
      return true;
    }

    return (envelope.teams ?? []).some((team) => {
      const kills = normalizeNonNegativeInteger(team.kills);
      return kills !== null && kills > 0;
    });
  }

  private stateHasCombatStats(state: TelemetryMatchState): boolean {
    return (
      Object.values(state.players).some((player) => player.kills > 0) ||
      Object.values(state.teams).some((team) => team.totalKills > 0)
    );
  }

  private buildEliminationSafetyContext(
    state: TelemetryMatchState,
    envelope: AdapterTelemetryEnvelope,
    players: IncomingAdapterPlayer[],
    trace: PhaseTransitionTrace | null,
  ): EliminationSafetyContext {
    const phase =
      trace?.nextPhase ??
      (typeof state.circle?.phase === 'number' &&
      Number.isFinite(state.circle.phase)
        ? Math.trunc(state.circle.phase)
        : null);
    const previousAlivePlayers = Object.values(state.players).filter(
      (player) => player.alive === true,
    ).length;
    const incomingAlivePlayers = players.filter(
      ({ player }) => player.alive === true,
    ).length;
    const incomingDeadPlayers = players.filter(
      ({ player }) => player.alive === false,
    ).length;
    const positionlessPlayers = players.filter(
      ({ player }) => !player.position,
    ).length;
    const expectedPlayers = Object.keys(state.players).length;
    const packetState =
      trace?.packetState ?? this.extractEnvelopePacketState(envelope);
    const hasExplicitKillEvents = (envelope.events ?? []).some(
      (event) => event.type === 'KILL',
    );
    const hasCombatEvidence = this.adapterEnvelopeHasCombatEvidence(
      envelope,
      players,
    );
    const explicitCombatPhase = this.isExplicitCombatPhase(
      phase,
      packetState,
      state.startedAt ?? null,
      envelope.timestamp,
      hasCombatEvidence,
    );
    const phaseOnePreCombat =
      phase !== null &&
      (this.isEarlyAirPhase(phase) ||
        this.isParachutePacketState(packetState) ||
        trace?.parachuteSignal === true);
    const unknownPhaseRosterSnapshot =
      players.length >= 8 ||
      expectedPlayers >= 8 ||
      (envelope.teams?.length ?? 0) >= 4 ||
      (trace?.incomingPlayers ?? 0) >= 8 ||
      (trace?.currentPlayers ?? 0) >= 8;
    const unknownPhasePreCombat =
      phase === null &&
      (((trace?.liveSignalWhilePending === true ||
        trace?.previousStatus === 'PENDING') &&
        unknownPhaseRosterSnapshot) ||
        this.isParachutePacketState(packetState) ||
        trace?.parachuteSignal === true);
    const preCombatPhase =
      !explicitCombatPhase &&
      !hasExplicitKillEvents &&
      (phaseOnePreCombat || unknownPhasePreCombat);
    const airPhase =
      preCombatPhase ||
      (!explicitCombatPhase &&
        (this.isEarlyAirPhase(phase) ||
          this.isParachutePacketState(packetState) ||
          trace?.parachuteSignal === true));
    const idChurn =
      (trace?.incomingPlayers ?? players.length) > 0 &&
      (trace?.currentPlayers ?? expectedPlayers) >= 8 &&
      (trace?.overlapRatio ?? 1) < 0.5;
    const missingPositions =
      players.length >= 8 &&
      positionlessPlayers > Math.floor(players.length * 0.5);
    const fullRosterSnapshot =
      expectedPlayers >= 8 &&
      players.length >= Math.max(8, Math.floor(expectedPlayers * 0.9));
    const explicitCombatFullRosterSnapshot =
      explicitCombatPhase &&
      fullRosterSnapshot &&
      !missingPositions &&
      trace?.partialTransitionSnapshot !== true &&
      trace?.sharpPlayerDrop !== true;
    const idChurnTransitionRisk = idChurn && !explicitCombatFullRosterSnapshot;
    const sharpAliveDrop =
      previousAlivePlayers >= 8 &&
      players.length > 0 &&
      incomingAlivePlayers <
        Math.ceil(previousAlivePlayers * PARACHUTE_PARTIAL_PLAYER_RATIO);
    const zeroAliveCollapse =
      previousAlivePlayers >= 8 &&
      players.length > 0 &&
      incomingAlivePlayers === 0 &&
      incomingDeadPlayers > 0;
    const unstableTransitionPacket = Boolean(
      trace?.partialTransitionSnapshot ||
      trace?.sharpPlayerDrop ||
      idChurnTransitionRisk ||
      missingPositions ||
      (airPhase && trace?.transitionLike) ||
      (airPhase && players.length === 0 && (envelope.teams?.length ?? 0) > 0),
    );
    const unstableEliminationTick =
      unstableTransitionPacket || sharpAliveDrop || zeroAliveCollapse;
    const blockPreCombatCriticalUpdates = preCombatPhase;
    const blockPlayerLifeUpdates =
      blockPreCombatCriticalUpdates ||
      (airPhase && (incomingDeadPlayers > 0 || unstableEliminationTick)) ||
      (!explicitCombatPhase &&
        incomingDeadPlayers > 0 &&
        unstableEliminationTick) ||
      (explicitCombatPhase &&
        incomingDeadPlayers > 0 &&
        unstableTransitionPacket);
    const blockPlayerKillUpdates =
      blockPreCombatCriticalUpdates || blockPlayerLifeUpdates;
    const blockTeamAggregateUpdates =
      blockPlayerLifeUpdates ||
      blockPlayerKillUpdates ||
      zeroAliveCollapse ||
      blockPreCombatCriticalUpdates;
    const reason = blockPreCombatCriticalUpdates
      ? phase === null
        ? 'PRECOMBAT_UNKNOWN_PHASE_CRITICAL_UPDATES_BLOCKED'
        : 'PRECOMBAT_PHASE_CRITICAL_UPDATES_BLOCKED'
      : zeroAliveCollapse
        ? airPhase
          ? 'ZERO_ALIVE_COLLAPSE_DURING_AIR_PHASE'
          : 'ZERO_ALIVE_COLLAPSE_DURING_TRANSITION'
        : sharpAliveDrop
          ? airPhase
            ? 'SHARP_ALIVE_DROP_DURING_AIR_PHASE'
            : 'SHARP_ALIVE_DROP_DURING_TRANSITION'
          : trace?.partialTransitionSnapshot
            ? 'PARTIAL_TRANSITION_PACKET'
            : missingPositions
              ? airPhase
                ? 'MISSING_POSITIONS_DURING_AIR_PHASE'
                : 'MISSING_POSITIONS_DURING_TRANSITION'
              : idChurnTransitionRisk
                ? airPhase
                  ? 'ID_CHURN_DURING_AIR_PHASE'
                  : 'ID_CHURN_DURING_TRANSITION'
                : blockPlayerLifeUpdates
                  ? airPhase
                    ? 'EARLY_AIR_TRANSITION_LIFE_UPDATE_BLOCKED'
                    : 'UNSTABLE_TRANSITION_LIFE_UPDATE_BLOCKED'
                  : null;

    return {
      phase,
      preCombatPhase,
      airPhase,
      unstableTransitionPacket,
      sharpAliveDrop,
      zeroAliveCollapse,
      idChurn,
      missingPositions,
      blockPlayerKillUpdates,
      blockPlayerLifeUpdates,
      blockTeamAggregateUpdates,
      resetPreCombatCriticalState: blockPreCombatCriticalUpdates,
      previousAlivePlayers,
      incomingAlivePlayers,
      incomingDeadPlayers,
      positionlessPlayers,
      hasExplicitKillEvents,
      hasCombatEvidence,
      reason,
    };
  }

  private isEarlyAirPhase(phase: number | null): boolean {
    return phase !== null && phase <= 1;
  }

  private shouldBlockAdapterEliminationEvent(
    state: TelemetryMatchState,
    trace: PhaseTransitionTrace | null,
    options: { hasCombatEvidence?: boolean } = {},
  ): boolean {
    const phase =
      trace?.nextPhase ??
      trace?.previousPhase ??
      (typeof state.circle?.phase === 'number' &&
      Number.isFinite(state.circle.phase)
        ? Math.trunc(state.circle.phase)
        : null);
    const packetState = trace?.packetState ?? null;
    if (
      this.isExplicitCombatPhase(
        phase,
        packetState,
        state.startedAt ?? null,
        trace?.timestamp ?? null,
        options.hasCombatEvidence === true,
      )
    ) {
      return (
        trace?.partialTransitionSnapshot === true ||
        trace?.sharpPlayerDrop === true
      );
    }
    return (
      phase === null ||
      this.isEarlyAirPhase(phase) ||
      trace?.parachuteSignal === true ||
      trace?.parachuteWindowActive === true ||
      trace?.partialTransitionSnapshot === true ||
      this.isParachutePacketState(packetState)
    );
  }

  private logEliminationPhase(
    matchId: string,
    source: string,
    timestamp: number,
    params: {
      trace: PhaseTransitionTrace | null;
      safety: EliminationSafetyContext;
      incomingPlayers: number;
      incomingTeams: number;
    },
  ): void {
    if (!params.safety.airPhase && !params.safety.unstableTransitionPacket) {
      return;
    }

    this.logger.log(
      JSON.stringify({
        tag: '[ELIMINATION][PHASE]',
        stage: 'telemetry-engine',
        action: 'elimination-phase-safety-check',
        matchId,
        source,
        timestamp,
        phase: params.safety.phase,
        preCombatPhase: params.safety.preCombatPhase,
        airPhase: params.safety.airPhase,
        hasExplicitKillEvents: params.safety.hasExplicitKillEvents,
        incomingPlayers: params.incomingPlayers,
        incomingTeams: params.incomingTeams,
        currentPlayers: params.trace?.currentPlayers ?? null,
        currentTeams: params.trace?.currentTeams ?? null,
        previousAlivePlayers: params.safety.previousAlivePlayers,
        incomingAlivePlayers: params.safety.incomingAlivePlayers,
        incomingDeadPlayers: params.safety.incomingDeadPlayers,
        positionlessPlayers: params.safety.positionlessPlayers,
        hasCombatEvidence: params.safety.hasCombatEvidence,
        idChurn: params.safety.idChurn,
        missingPositions: params.safety.missingPositions,
        sharpAliveDrop: params.safety.sharpAliveDrop,
        zeroAliveCollapse: params.safety.zeroAliveCollapse,
        partialTransitionSnapshot:
          params.trace?.partialTransitionSnapshot ?? false,
        blockPlayerKillUpdates: params.safety.blockPlayerKillUpdates,
        blockPlayerLifeUpdates: params.safety.blockPlayerLifeUpdates,
        blockTeamAggregateUpdates: params.safety.blockTeamAggregateUpdates,
        resetPreCombatCriticalState: params.safety.resetPreCombatCriticalState,
        reason: params.safety.reason,
      }),
    );
  }

  private resetPreCombatCriticalRuntimeState(
    state: TelemetryMatchState,
    timestamp: number,
  ): boolean {
    if (this.stateHasCombatStats(state)) {
      this.logger.warn(
        JSON.stringify({
          tag: '[ELIMINATION][BLOCKED]',
          stage: 'telemetry-engine',
          action: 'precombat-critical-runtime-state-reset-skipped',
          matchId: state.matchId,
          timestamp,
          reason: 'COMBAT_STATS_PRESENT',
        }),
      );
      return false;
    }

    let changed = false;
    let playersReset = 0;
    let teamsReset = 0;

    for (const player of Object.values(state.players)) {
      const hasManualLife =
        hasManualOverride(player.ownership?.alive) ||
        hasManualOverride(player.ownership?.knocked);
      const hasManualKills = hasManualOverride(player.ownership?.kills);
      let playerChanged = false;

      if (!hasManualKills && player.kills !== 0) {
        player.kills = 0;
        playerChanged = true;
      }
      if (!hasManualLife) {
        if (player.alive !== true) {
          player.alive = true;
          playerChanged = true;
        }
        if (player.knocked !== false) {
          player.knocked = false;
          playerChanged = true;
        }
        if (player.health === 0) {
          player.health = null;
          playerChanged = true;
        }
      }

      if (playerChanged) {
        playersReset += 1;
        changed = true;
      }
    }

    for (const [teamId, team] of Object.entries(state.teams)) {
      const hasManualTeamAggregates =
        hasManualOverride(team.ownership?.eliminated) ||
        hasManualOverride(team.ownership?.placement) ||
        hasManualOverride(team.ownership?.totalKills);
      if (hasManualTeamAggregates) {
        continue;
      }

      const teamPlayers = Object.values(state.players).filter(
        (player) => player.teamId === teamId,
      );
      const alivePlayers = teamPlayers.filter((player) => player.alive).length;
      let teamChanged = false;

      if (team.totalKills !== 0) {
        team.totalKills = 0;
        teamChanged = true;
      }
      if (team.eliminated !== false) {
        team.eliminated = false;
        teamChanged = true;
      }
      if (team.placement !== null) {
        team.placement = null;
        teamChanged = true;
      }
      if (team.eliminatedAt !== null) {
        team.eliminatedAt = null;
        teamChanged = true;
      }
      if (teamPlayers.length > 0 && team.alivePlayers !== alivePlayers) {
        team.alivePlayers = alivePlayers;
        teamChanged = true;
      }
      if (
        teamPlayers.length > 0 &&
        team.totalPlayers < Math.max(teamPlayers.length, alivePlayers)
      ) {
        team.totalPlayers = Math.max(teamPlayers.length, alivePlayers);
        teamChanged = true;
      }

      if (teamChanged) {
        teamsReset += 1;
        changed = true;
      }
    }

    if (!changed) {
      return false;
    }

    state.teamsAlive = Object.values(state.teams).reduce(
      (count, team) =>
        team.eliminated !== true && team.alivePlayers > 0 ? count + 1 : count,
      0,
    );

    this.logger.warn(
      JSON.stringify({
        tag: '[ELIMINATION][BLOCKED]',
        stage: 'telemetry-engine',
        action: 'precombat-critical-runtime-state-reset',
        matchId: state.matchId,
        timestamp,
        playersReset,
        teamsReset,
        teamsAlive: state.teamsAlive,
        reason: 'PRECOMBAT_CRITICAL_STATE_RESET',
      }),
    );

    return true;
  }

  private summarizePlayerLifeFields(
    player: AdapterTelemetryPlayer,
  ): Record<string, unknown> {
    const raw = asRecord(player.raw) ?? {};
    const keys = [
      'isAlive',
      'IsAlive',
      'alive',
      'Alive',
      'bAlive',
      'hasDied',
      'HasDied',
      'bHasDied',
      'dead',
      'isDead',
      'eliminated',
      'liveState',
      'LiveState',
      'live_state',
      'state',
      'State',
      'status',
      'Status',
      'health',
      'Health',
      'hp',
      'HP',
    ];
    const values: Record<string, unknown> = {
      normalizedAlive: player.alive ?? null,
      normalizedKnocked: player.knocked ?? null,
      normalizedEliminated: player.eliminated ?? null,
      normalizedHealth: player.health ?? null,
    };
    for (const key of keys) {
      if (raw[key] !== undefined) {
        values[key] = raw[key];
      }
    }
    return values;
  }

  private summarizePlayerPositionFields(
    player: AdapterTelemetryPlayer,
  ): Record<string, unknown> {
    const raw = asRecord(player.raw) ?? {};
    return {
      normalizedPosition: player.position ?? null,
      position: raw.position ?? null,
      pos: raw.pos ?? null,
      location: raw.location ?? null,
      x: raw.x ?? raw.X ?? raw.lon ?? null,
      y: raw.y ?? raw.Y ?? raw.lat ?? null,
    };
  }

  private logPlayerWrite(params: {
    source: 'adapter' | 'derived' | 'mirror' | 'results';
    action: string;
    matchId: string;
    playerId: string | null;
    teamId: string | null;
    phase: number | null;
    timestamp: number | null;
    alive: boolean | null;
    eliminated: boolean | null;
    blocked?: boolean;
    reason?: string | null;
    metadata?: Record<string, unknown>;
  }): void {
    this.logger.debug(
      JSON.stringify({
        tag: '[PLAYER WRITE]',
        stage: 'telemetry-engine',
        source: params.source,
        action: params.action,
        matchId: params.matchId,
        playerId: params.playerId,
        teamId: params.teamId,
        phase: params.phase,
        timestamp: params.timestamp,
        alive: params.alive,
        eliminated: params.eliminated,
        blocked: params.blocked ?? false,
        reason: params.reason ?? null,
        ...(params.metadata ?? {}),
      }),
    );
  }

  private logCriticalPlayerStateConflict(params: {
    source: 'adapter' | 'derived' | 'mirror' | 'results';
    matchId: string;
    playerId: string | null;
    teamId: string | null;
    phase: number | null;
    timestamp: number | null;
    field: 'alive' | 'eliminated';
    previousValue: boolean | null;
    incomingValue: boolean | null;
    resolvedValue: boolean | null;
    reason: string;
    metadata?: Record<string, unknown>;
  }): void {
    this.logger.error(
      JSON.stringify({
        tag: '[CRITICAL][PLAYER STATE CONFLICT]',
        stage: 'telemetry-engine',
        source: params.source,
        action: 'player-state-conflict',
        matchId: params.matchId,
        playerId: params.playerId,
        teamId: params.teamId,
        phase: params.phase,
        timestamp: params.timestamp,
        field: params.field,
        previousValue: params.previousValue,
        incomingValue: params.incomingValue,
        resolvedValue: params.resolvedValue,
        reason: params.reason,
        ...(params.metadata ?? {}),
      }),
    );
  }

  private logPlayerEliminationDecision(params: {
    matchId: string;
    source: string;
    timestamp: number;
    phase: number | null;
    playerKey: string;
    teamId: string;
    previousAlive: boolean;
    incomingAlive: boolean;
    rawAliveFields: Record<string, unknown>;
    rawPositionFields: Record<string, unknown>;
    existedInPreviousStableTick: boolean;
  }): void {
    if (params.previousAlive === params.incomingAlive) {
      return;
    }
    this.logger.log(
      JSON.stringify({
        tag: '[ELIMINATION][PLAYER]',
        stage: 'telemetry-engine',
        action: 'player-life-state-derived',
        matchId: params.matchId,
        source: params.source,
        timestamp: params.timestamp,
        phase: params.phase,
        playerId: params.playerKey,
        teamId: params.teamId,
        previousAlive: params.previousAlive,
        incomingAlive: params.incomingAlive,
        rawAliveFields: params.rawAliveFields,
        rawPositionFields: params.rawPositionFields,
        existedInPreviousStableTick: params.existedInPreviousStableTick,
      }),
    );
  }

  private logPlayerEliminationBlocked(params: {
    matchId: string;
    source: string;
    timestamp: number;
    phase: number | null;
    playerKey: string;
    teamId: string;
    rawAliveFields: Record<string, unknown>;
    rawPositionFields: Record<string, unknown>;
    existedInPreviousStableTick: boolean;
    reason: string;
  }): void {
    this.logger.warn(
      JSON.stringify({
        tag: '[ELIMINATION][BLOCKED]',
        stage: 'telemetry-engine',
        action: 'player-elimination-blocked-during-air-transition',
        matchId: params.matchId,
        source: params.source,
        timestamp: params.timestamp,
        phase: params.phase,
        playerId: params.playerKey,
        teamId: params.teamId,
        rawAliveFields: params.rawAliveFields,
        rawPositionFields: params.rawPositionFields,
        existedInPreviousStableTick: params.existedInPreviousStableTick,
        inferredEliminationBlocked: true,
        reason: params.reason,
      }),
    );
  }

  private logTeamEliminationDecision(
    state: TelemetryMatchState,
    teamId: string,
    previous: {
      alivePlayers: number;
      eliminated: boolean;
      placement: number | null;
      eliminatedAt: number | null;
    },
    next: TelemetryTeamState,
    params: {
      timestamp: number;
      aggregateUpdatesApplied: boolean;
    },
  ): void {
    const eliminatedChanged = previous.eliminated !== next.eliminated;
    const aliveChanged = previous.alivePlayers !== next.alivePlayers;
    const placementChanged = previous.placement !== next.placement;
    if (!eliminatedChanged && !aliveChanged && !placementChanged) {
      return;
    }

    this.logger.log(
      JSON.stringify({
        tag: '[ELIMINATION][TEAM]',
        stage: 'telemetry-engine',
        action: 'team-elimination-derived',
        matchId: state.matchId,
        teamId,
        phase: state.circle?.phase ?? null,
        timestamp: params.timestamp,
        aggregateUpdatesApplied: params.aggregateUpdatesApplied,
        previous: {
          alivePlayers: previous.alivePlayers,
          eliminated: previous.eliminated,
          placement: previous.placement,
          eliminatedAt: previous.eliminatedAt,
        },
        next: {
          alivePlayers: next.alivePlayers,
          eliminated: next.eliminated,
          placement: next.placement,
          eliminatedAt: next.eliminatedAt,
        },
        inferredTeamElimination:
          previous.eliminated !== true && next.eliminated === true,
      }),
    );
  }

  private logPhaseTransitionBefore(trace: PhaseTransitionTrace): void {
    if (!trace.transitionLike) {
      return;
    }
    this.logger.log(
      JSON.stringify({
        tag: '[PHASE TRANSITION][BEFORE]',
        stage: 'telemetry-engine',
        action: 'adapter-phase-transition-before',
        matchId: trace.matchId,
        source: trace.source,
        sessionId: trace.sessionId,
        sequence: trace.sequence,
        timestamp: trace.timestamp,
        previousStatus: trace.previousStatus,
        previousPhase: trace.previousPhase,
        nextPhase: trace.nextPhase,
        phaseChanged: trace.phaseChanged,
        currentPlayers: trace.currentPlayers,
        incomingPlayers: trace.incomingPlayers,
        currentTeams: trace.currentTeams,
        incomingTeams: trace.incomingTeams,
        overlapPlayers: trace.overlapPlayers,
        overlapRatio: Number(trace.overlapRatio.toFixed(4)),
        sharpPlayerDrop: trace.sharpPlayerDrop,
        sessionChanged: trace.sessionChanged,
        liveSignalWhilePending: trace.liveSignalWhilePending,
        packetState: trace.packetState,
        parachuteSignal: trace.parachuteSignal,
        parachuteWindowActive: trace.parachuteWindowActive,
        parachuteWindowRemaining: trace.parachuteWindowRemaining,
        partialTransitionSnapshot: trace.partialTransitionSnapshot,
      }),
    );
    this.logger.debug(
      JSON.stringify({
        tag: '[PHASE TRANSITION][PLAYER IDS]',
        stage: 'telemetry-engine',
        action: 'adapter-phase-transition-player-ids',
        matchId: trace.matchId,
        source: trace.source,
        sequence: trace.sequence,
        currentPlayerIds: trace.currentPlayerIds.slice(0, 160),
        incomingPlayerIds: trace.incomingPlayerIds.slice(0, 160),
        currentPlayerIdsTotal: trace.currentPlayerIds.length,
        incomingPlayerIdsTotal: trace.incomingPlayerIds.length,
        currentTeamIds: trace.currentTeamIds.slice(0, 80),
        incomingTeamIds: trace.incomingTeamIds.slice(0, 80),
        currentTeamIdsTotal: trace.currentTeamIds.length,
        incomingTeamIdsTotal: trace.incomingTeamIds.length,
      }),
    );
  }

  private logPhaseTransitionAfter(
    trace: PhaseTransitionTrace,
    state: TelemetryMatchState,
  ): void {
    if (!trace.transitionLike) {
      return;
    }
    this.logger.log(
      JSON.stringify({
        tag: '[PHASE TRANSITION][AFTER]',
        stage: 'telemetry-engine',
        action: 'adapter-phase-transition-after',
        matchId: trace.matchId,
        source: trace.source,
        sequence: trace.sequence,
        previousStatus: trace.previousStatus,
        nextStatus: state.status,
        previousPhase: trace.previousPhase,
        nextPhase: state.circle?.phase ?? null,
        currentPlayersBefore: trace.currentPlayers,
        currentPlayersAfter: Object.keys(state.players).length,
        currentTeamsBefore: trace.currentTeams,
        currentTeamsAfter: Object.keys(state.teams).length,
        teamsAlive: state.teamsAlive,
        telemetryAcceptedAt: state.telemetryAcceptedAt ?? null,
        parachuteWindowActive: trace.parachuteWindowActive,
        partialTransitionSnapshot: trace.partialTransitionSnapshot,
      }),
    );
  }

  private logPhaseTransitionReset(
    trace: PhaseTransitionTrace,
    details: { action: string; reason: string },
  ): void {
    this.logger.warn(
      JSON.stringify({
        tag: '[PHASE TRANSITION][RESET]',
        stage: 'telemetry-engine',
        action: details.action,
        reason: details.reason,
        matchId: trace.matchId,
        source: trace.source,
        sessionId: trace.sessionId,
        sequence: trace.sequence,
        previousStatus: trace.previousStatus,
        previousPhase: trace.previousPhase,
        nextPhase: trace.nextPhase,
        currentPlayers: trace.currentPlayers,
        incomingPlayers: trace.incomingPlayers,
        currentTeams: trace.currentTeams,
        incomingTeams: trace.incomingTeams,
        overlapPlayers: trace.overlapPlayers,
        sharpPlayerDrop: trace.sharpPlayerDrop,
        sessionChanged: trace.sessionChanged,
        parachuteWindowActive: trace.parachuteWindowActive,
        partialTransitionSnapshot: trace.partialTransitionSnapshot,
      }),
    );
  }

  private isEndTransition(
    previous: TelemetryMatchState,
    next: TelemetryMatchState,
  ): boolean {
    return (
      previous.status !== 'ENDED' &&
      previous.status !== 'LOCKED' &&
      (next.status === 'ENDED' || next.status === 'LOCKED')
    );
  }

  private async applyAdapterSnapshot(
    state: TelemetryMatchState,
    envelope: AdapterTelemetryEnvelope,
    source: string,
    trace?: PhaseTransitionTrace | null,
  ): Promise<AdapterSnapshotApplyResult> {
    this.ensureStateDefaults(state);

    this.logger.debug(
      JSON.stringify({
        tag: '[TELEMETRY][INGEST]',
        stage: 'telemetry-engine',
        action: 'adapter-snapshot-ingest',
        matchId: state.matchId,
        source,
        timestamp: envelope.timestamp,
        players: envelope.players?.length ?? 0,
        teams: envelope.teams?.length ?? 0,
        events: envelope.events?.length ?? 0,
      }),
    );

    const restoredAdapterTeams =
      await this.restoreMissingAdapterTeamsFromPersistence(state, envelope);

    const packetTeamIds = new Set<string>();
    for (const team of envelope.teams ?? []) {
      const teamId = this.resolveAdapterTeamId(state, team);
      if (!teamId) {
        this.logTelemetryStructuralMutation(state.matchId, {
          reason: 'UNKNOWN_TEAM',
          teamId: team.teamId ?? null,
          slot: team.slot ?? null,
          name: team.name ?? null,
          tag: team.tag ?? null,
        });
        continue;
      }
      packetTeamIds.add(teamId);
    }

    const teamTelemetryUpdated = this.applyAdapterTeamTelemetry(
      state,
      envelope,
    );

    const players = this.collectAdapterPlayers(envelope);
    const allowTeamNameFallback = Boolean(
      trace?.parachuteSignal ||
      trace?.parachuteWindowActive ||
      trace?.partialTransitionSnapshot,
    );
    const eliminationSafety = this.buildEliminationSafetyContext(
      state,
      envelope,
      players,
      trace ?? null,
    );
    this.logEliminationPhase(state.matchId, source, envelope.timestamp, {
      trace: trace ?? null,
      safety: eliminationSafety,
      incomingPlayers: players.length,
      incomingTeams: envelope.teams?.length ?? 0,
    });
    let mappedPlayers = 0;
    let lockedMappings = 0;
    let runtimeUpdatesApplied = teamTelemetryUpdated || restoredAdapterTeams;
    let blockedPlayerEliminations = 0;
    let blockedPlayerKillUpdates = 0;
    if (eliminationSafety.resetPreCombatCriticalState) {
      runtimeUpdatesApplied =
        this.resetPreCombatCriticalRuntimeState(state, envelope.timestamp) ||
        runtimeUpdatesApplied;
    }
    const touchedTeamIds = new Set<string>(packetTeamIds);
    for (const incoming of players) {
      const { player } = incoming;
      const incomingTeamId = this.resolveIncomingPlayerTeamId(state, incoming);
      if (incomingTeamId) {
        touchedTeamIds.add(incomingTeamId);
      }
      await this.syncSavedPlayerIdentityFromTelemetry(
        state.matchId,
        player,
        incomingTeamId,
      );
      const resolved = await this.resolveAdapterPlayer(state, incoming, {
        allowTeamNameFallback,
      });
      if (!resolved) {
        continue;
      }
      const currentPlayer = state.players[resolved.playerKey];
      if (incomingTeamId && incomingTeamId !== currentPlayer.teamId) {
        this.logTelemetryStructuralMutation(state.matchId, {
          reason: 'PLAYER_TEAM_REASSIGNMENT',
          playerId: currentPlayer.playerId,
          currentTeamId: currentPlayer.teamId,
          incomingTeamId,
          externalPlayerId: player.externalPlayerId ?? null,
          pubgAccountId: player.pubgAccountId ?? null,
        });
        continue;
      }
      mappedPlayers += 1;
      const mappingLocked =
        this.isMappingLocked(resolved.mapping) ||
        (resolved.mapping !== null &&
          currentPlayer.metadata?.observedInTelemetry === true);
      if (mappingLocked) {
        lockedMappings += 1;
      }
      if (mappingLocked || player.position) {
        currentPlayer.metadata = {
          ...(currentPlayer.metadata ?? {}),
          position: player.position ?? currentPlayer.metadata?.position ?? null,
        };
        if (mappingLocked) {
          currentPlayer.metadata.observedInTelemetry = true;
        }
      }
      if (player.position) {
        runtimeUpdatesApplied = true;
      }

      if (!mappingLocked) {
        if (this.hasCriticalPlayerTelemetry(player)) {
          this.logUnstableCriticalUpdateBlocked(state.matchId, {
            action: 'unstable-player-critical-update-blocked',
            externalPlayerId:
              resolved.mapping?.externalPlayerId ??
              player.externalPlayerId ??
              player.playerId ??
              null,
            slotPlayerId: resolved.mapping?.slotPlayerId ?? null,
            playerId: currentPlayer.playerId,
            teamId: currentPlayer.teamId,
          });
        }
        continue;
      }

      if (typeof player.kills === 'number' && Number.isFinite(player.kills)) {
        const incomingKills = Math.max(0, Math.trunc(player.kills));
        if (eliminationSafety.blockPlayerKillUpdates) {
          if (incomingKills > 0 || currentPlayer.kills > 0) {
            const previousKills = currentPlayer.kills;
            blockedPlayerKillUpdates += 1;
            this.logger.warn(
              JSON.stringify({
                tag: '[ELIMINATION][BLOCKED]',
                stage: 'telemetry-engine',
                action: 'precombat-player-kill-update-blocked',
                matchId: state.matchId,
                source,
                phase: eliminationSafety.phase,
                playerId: currentPlayer.playerId,
                teamId: currentPlayer.teamId,
                incomingKills,
                previousKills,
                preservedKills: currentPlayer.kills,
                reason:
                  eliminationSafety.reason ??
                  'PRECOMBAT_PHASE_CRITICAL_UPDATES_BLOCKED',
              }),
            );
          }
        } else if (currentPlayer.kills !== incomingKills) {
          currentPlayer.kills = incomingKills;
          runtimeUpdatesApplied = true;
        }
      }
      if (
        typeof player.assists === 'number' &&
        Number.isFinite(player.assists)
      ) {
        currentPlayer.assists = Math.max(0, Math.trunc(player.assists));
        runtimeUpdatesApplied = true;
      }
      const nextHealth = normalizeAdapterPlayerHealth(player);
      const blockCriticalHealthUpdate =
        eliminationSafety.blockPlayerLifeUpdates &&
        nextHealth !== null &&
        nextHealth <= 0;
      if (
        nextHealth !== null &&
        !blockCriticalHealthUpdate &&
        currentPlayer.health !== nextHealth
      ) {
        currentPlayer.health = nextHealth;
        runtimeUpdatesApplied = true;
      }
      if (typeof player.alive === 'boolean') {
        const wouldEliminatePlayer =
          player.alive === false && currentPlayer.alive !== false;
        if (wouldEliminatePlayer && eliminationSafety.blockPlayerLifeUpdates) {
          blockedPlayerEliminations += 1;
          this.logPlayerWrite({
            source: 'adapter',
            action: 'adapter-player-life-write-blocked',
            matchId: state.matchId,
            playerId: resolved.playerKey,
            teamId: currentPlayer.teamId,
            phase: eliminationSafety.phase,
            timestamp: envelope.timestamp,
            alive: player.alive,
            eliminated: player.alive === false,
            blocked: true,
            reason:
              eliminationSafety.reason ??
              'EARLY_AIR_TRANSITION_LIFE_UPDATE_BLOCKED',
          });
          this.logPlayerEliminationBlocked({
            matchId: state.matchId,
            source,
            timestamp: envelope.timestamp,
            phase: eliminationSafety.phase,
            playerKey: resolved.playerKey,
            teamId: currentPlayer.teamId,
            rawAliveFields: this.summarizePlayerLifeFields(player),
            rawPositionFields: this.summarizePlayerPositionFields(player),
            existedInPreviousStableTick:
              currentPlayer.metadata?.observedInTelemetry === true ||
              currentPlayer.alive === true,
            reason:
              eliminationSafety.reason ??
              'EARLY_AIR_TRANSITION_LIFE_UPDATE_BLOCKED',
          });
        } else {
          this.logPlayerEliminationDecision({
            matchId: state.matchId,
            source,
            timestamp: envelope.timestamp,
            phase: eliminationSafety.phase,
            playerKey: resolved.playerKey,
            teamId: currentPlayer.teamId,
            previousAlive: currentPlayer.alive,
            incomingAlive: player.alive,
            rawAliveFields: this.summarizePlayerLifeFields(player),
            rawPositionFields: this.summarizePlayerPositionFields(player),
            existedInPreviousStableTick:
              currentPlayer.metadata?.observedInTelemetry === true ||
              currentPlayer.alive === true,
          });
          this.logPlayerWrite({
            source: 'adapter',
            action: 'adapter-player-life-write-applied',
            matchId: state.matchId,
            playerId: resolved.playerKey,
            teamId: currentPlayer.teamId,
            phase: eliminationSafety.phase,
            timestamp: envelope.timestamp,
            alive: player.alive,
            eliminated: player.alive === false,
          });
          currentPlayer.alive = player.alive;
          if (!player.alive) {
            currentPlayer.knocked = false;
          }
          runtimeUpdatesApplied = true;
        }
      }
      if (typeof player.knocked === 'boolean') {
        if (
          eliminationSafety.blockPlayerLifeUpdates &&
          player.knocked !== currentPlayer.knocked
        ) {
          this.logPlayerWrite({
            source: 'adapter',
            action: 'adapter-player-knock-write-blocked',
            matchId: state.matchId,
            playerId: resolved.playerKey,
            teamId: currentPlayer.teamId,
            phase: eliminationSafety.phase,
            timestamp: envelope.timestamp,
            alive: currentPlayer.alive,
            eliminated: currentPlayer.alive === false,
            blocked: true,
            reason:
              eliminationSafety.reason ??
              'EARLY_AIR_TRANSITION_LIFE_UPDATE_BLOCKED',
            metadata: {
              incomingKnocked: player.knocked,
              previousKnocked: currentPlayer.knocked,
            },
          });
          this.logger.warn(
            JSON.stringify({
              tag: '[ELIMINATION][BLOCKED]',
              stage: 'telemetry-engine',
              action: 'player-knock-update-blocked-during-air-transition',
              matchId: state.matchId,
              source,
              phase: eliminationSafety.phase,
              playerId: currentPlayer.playerId,
              teamId: currentPlayer.teamId,
              incomingKnocked: player.knocked,
              previousKnocked: currentPlayer.knocked,
              reason:
                eliminationSafety.reason ??
                'EARLY_AIR_TRANSITION_LIFE_UPDATE_BLOCKED',
            }),
          );
          continue;
        }
        this.logPlayerWrite({
          source: 'adapter',
          action: 'adapter-player-knock-write-applied',
          matchId: state.matchId,
          playerId: resolved.playerKey,
          teamId: currentPlayer.teamId,
          phase: eliminationSafety.phase,
          timestamp: envelope.timestamp,
          alive: player.knocked ? true : currentPlayer.alive,
          eliminated: (player.knocked ? true : currentPlayer.alive) === false,
          metadata: {
            incomingKnocked: player.knocked,
            previousKnocked: currentPlayer.knocked,
          },
        });
        currentPlayer.knocked = player.knocked;
        if (player.knocked) {
          currentPlayer.alive = true;
        }
        runtimeUpdatesApplied = true;
      }
      this.markObservedTelemetryPlayer(state, resolved.teamId, currentPlayer);
    }

    const syntheticPruneResult = this.pruneNeverObservedSyntheticState(state, {
      hasIncomingTelemetry: players.length > 0 || packetTeamIds.size > 0,
      packetTeamIds,
      touchedTeamIds,
    });
    const sanitizeResult = this.sanitizeTelemetryState(state, {
      reason: 'APPLY_ADAPTER_SNAPSHOT',
      timestamp: envelope.timestamp,
      recomputeDerivedState: false,
    });
    if (
      syntheticPruneResult.removedPlayers > 0 ||
      syntheticPruneResult.removedTeams > 0 ||
      sanitizeResult.duplicatePlayersRemoved > 0 ||
      sanitizeResult.orphanPlayersRemoved > 0 ||
      sanitizeResult.provisionalTeamsRemoved > 0
    ) {
      runtimeUpdatesApplied = true;
    }

    const expectedPlayers = Object.keys(state.players).length;
    const mappingConfidence =
      expectedPlayers > 0
        ? mappedPlayers / expectedPlayers
        : players.length > 0
          ? 0
          : 1;
    const hasMappingService = Boolean(this.mapping);
    const mappingStabilityResult = this.mapping
      ? this.mapping.getStability(state.matchId, expectedPlayers)
      : {
          stability: mappingConfidence,
          locked: lockedMappings,
          expected: expectedPlayers,
        };
    lockedMappings = Math.max(lockedMappings, mappingStabilityResult.locked);
    const mappingStability =
      expectedPlayers > 0
        ? Math.min(1, lockedMappings / expectedPlayers)
        : mappingStabilityResult.stability;
    const aggregateUpdatesAllowed =
      expectedPlayers > 0
        ? hasMappingService
          ? mappingStability >= 0.95
          : mappingConfidence >= 0.95
        : players.length === 0;
    this.logger.log(
      JSON.stringify({
        tag: '[TELEMETRY][MAPPING]',
        stage: 'telemetry-engine',
        action: 'mapping-confidence',
        message: `[TELEMETRY] mappingConfidence=${mappingConfidence.toFixed(2)} mapped=${mappedPlayers} expected=${expectedPlayers}`,
        matchId: state.matchId,
        mappingConfidence: Number(mappingConfidence.toFixed(4)),
        mappingStability: Number(mappingStability.toFixed(4)),
        mapped: mappedPlayers,
        locked: lockedMappings,
        expected: expectedPlayers,
        incomingPlayers: players.length,
        removedSyntheticPlayers: syntheticPruneResult.removedPlayers,
        removedSyntheticTeams: syntheticPruneResult.removedTeams,
        duplicatePlayersRemoved: sanitizeResult.duplicatePlayersRemoved,
        orphanPlayersRemoved: sanitizeResult.orphanPlayersRemoved,
        provisionalTeamsRemoved: sanitizeResult.provisionalTeamsRemoved,
      }),
    );
    this.mapping?.logStability(state.matchId, expectedPlayers);
    if (
      !aggregateUpdatesAllowed &&
      (players.length > 0 || expectedPlayers > 0)
    ) {
      this.logger.warn(
        JSON.stringify({
          tag: '[TELEMETRY][BLOCKED]',
          stage: 'telemetry-engine',
          action: 'team-aggregate-update-blocked',
          matchId: state.matchId,
          reason: hasMappingService
            ? 'LOW_MAPPING_STABILITY'
            : 'LOW_MAPPING_CONFIDENCE',
          mappingConfidence: Number(mappingConfidence.toFixed(4)),
          mappingStability: Number(mappingStability.toFixed(4)),
          mapped: mappedPlayers,
          locked: lockedMappings,
          expected: expectedPlayers,
          removedSyntheticPlayers: syntheticPruneResult.removedPlayers,
          removedSyntheticTeams: syntheticPruneResult.removedTeams,
          duplicatePlayersRemoved: sanitizeResult.duplicatePlayersRemoved,
          orphanPlayersRemoved: sanitizeResult.orphanPlayersRemoved,
          provisionalTeamsRemoved: sanitizeResult.provisionalTeamsRemoved,
        }),
      );
    }

    const nextCircle = this.toCircleState(envelope.zone, state.circle ?? null);
    if (
      this.providerPacketContainsZoneData(envelope) &&
      !this.hasMeaningfulCircle(nextCircle)
    ) {
      this.logger.warn(
        JSON.stringify({
          stage: 'telemetry-engine',
          action: 'guardrail-empty-circle-after-provider-zone-packet',
          matchId: state.matchId,
          source,
          timestamp: envelope.timestamp,
        }),
      );
    }
    if (
      JSON.stringify(nextCircle ?? null) !==
      JSON.stringify(state.circle ?? null)
    ) {
      state.circle = nextCircle;
      runtimeUpdatesApplied = true;
      this.appendStateEvent(state, {
        id: `CIRCLE_UPDATED:${envelope.timestamp}`,
        type: 'CIRCLE_UPDATED',
        ts: envelope.timestamp,
        payload: {
          source,
          phase: nextCircle?.phase ?? null,
          nextShrinkAt: nextCircle?.nextShrinkAt ?? null,
        },
      });
    }

    if (Object.prototype.hasOwnProperty.call(envelope, 'observedPlayer')) {
      const nextObservedPlayer = this.toObservedPlayerState(
        state,
        envelope.observedPlayer,
        envelope.timestamp,
      );
      if (
        this.observedPlayerSignature(state.observedPlayer) !==
        this.observedPlayerSignature(nextObservedPlayer)
      ) {
        state.observedPlayer = nextObservedPlayer;
        runtimeUpdatesApplied = true;
      }
    }

    for (const event of [...(envelope.events ?? [])].sort(
      (left, right) => left.timestamp - right.timestamp,
    )) {
      const eventApplied = await this.applyAdapterEvent(
        state,
        event,
        envelope.timestamp,
        trace ?? null,
      );
      runtimeUpdatesApplied = runtimeUpdatesApplied || eventApplied;
    }

    return {
      incomingPlayers: players.length,
      mappedPlayers,
      expectedPlayers,
      mappingConfidence,
      lockedMappings,
      mappingStability,
      aggregateUpdatesAllowed,
      runtimeUpdatesApplied,
      eliminationUpdatesBlocked:
        eliminationSafety.blockTeamAggregateUpdates ||
        blockedPlayerEliminations > 0 ||
        blockedPlayerKillUpdates > 0,
      blockedPlayerEliminations,
      blockedPlayerKillUpdates,
      incomingAlivePlayers: eliminationSafety.incomingAlivePlayers,
      incomingDeadPlayers: eliminationSafety.incomingDeadPlayers,
      positionlessPlayers: eliminationSafety.positionlessPlayers,
      teamTelemetryUpdated,
    };
  }

  private async applyAdapterEvent(
    state: TelemetryMatchState,
    event: AdapterTelemetryEvent,
    fallbackTimestamp: number,
    trace: PhaseTransitionTrace | null = null,
  ): Promise<boolean> {
    const timestamp =
      typeof event.timestamp === 'number' && Number.isFinite(event.timestamp)
        ? event.timestamp
        : fallbackTimestamp;

    switch (event.type) {
      case 'MATCH_START':
      case 'MATCH_END':
        this.logger.warn(
          JSON.stringify({
            stage: 'telemetry-engine',
            action: 'adapter-lifecycle-event-ignored',
            matchId: state.matchId,
            eventType: event.type,
            timestamp,
          }),
        );
        return false;
      case 'KILL': {
        if (
          this.shouldBlockAdapterEliminationEvent(state, trace, {
            hasCombatEvidence: true,
          })
        ) {
          this.logger.warn(
            JSON.stringify({
              tag: '[ELIMINATION][BLOCKED]',
              stage: 'telemetry-engine',
              action: 'kill-event-blocked-during-air-transition',
              matchId: state.matchId,
              phase:
                trace?.nextPhase ??
                trace?.previousPhase ??
                state.circle?.phase ??
                null,
              timestamp,
              killerId: event.killerId ?? null,
              killerTeamId: event.killerTeamId ?? event.teamId ?? null,
              victimId: event.victimId ?? null,
              victimTeamId: event.victimTeamId ?? null,
              reason: 'EARLY_AIR_PHASE_KILL_EVENT_BLOCKED',
            }),
          );
          return false;
        }
        let killer = await this.resolveAdapterPlayerByEvent(state, {
          playerId: event.killerId ?? null,
          teamId: event.killerTeamId ?? event.teamId ?? null,
          name:
            toIdentifier(event.payload?.killerName) ||
            toIdentifier(event.payload?.killerPlayerName) ||
            null,
        });
        let victim = await this.resolveAdapterPlayerByEvent(state, {
          playerId: event.victimId ?? null,
          teamId: event.victimTeamId ?? null,
          name:
            toIdentifier(event.payload?.victimName) ||
            toIdentifier(event.payload?.victimPlayerName) ||
            null,
        });
        if (killer && !this.isMappingLocked(killer.mapping)) {
          this.logUnstableCriticalUpdateBlocked(state.matchId, {
            action: 'unstable-kill-event-blocked',
            externalPlayerId:
              killer.mapping?.externalPlayerId ?? event.killerId ?? null,
            slotPlayerId: killer.mapping?.slotPlayerId ?? null,
            playerId: killer.player.playerId,
            teamId: killer.teamId,
          });
          killer = null;
        }
        if (victim && !this.isMappingLocked(victim.mapping)) {
          this.logUnstableCriticalUpdateBlocked(state.matchId, {
            action: 'unstable-kill-event-blocked',
            externalPlayerId:
              victim.mapping?.externalPlayerId ?? event.victimId ?? null,
            slotPlayerId: victim.mapping?.slotPlayerId ?? null,
            playerId: victim.player.playerId,
            teamId: victim.teamId,
          });
          victim = null;
        }
        if (!killer || !victim) {
          this.logger.warn(
            JSON.stringify({
              stage: 'telemetry-engine',
              action: 'guardrail-kill-event-unmapped-participant',
              matchId: state.matchId,
              timestamp,
              killerMapped: Boolean(killer),
              victimMapped: Boolean(victim),
              killerId: event.killerId ?? null,
              killerTeamId: event.killerTeamId ?? event.teamId ?? null,
              victimId: event.victimId ?? null,
              victimTeamId: event.victimTeamId ?? null,
            }),
          );
          return false;
        }
        this.logPlayerWrite({
          source: 'adapter',
          action: 'adapter-kill-event-life-write-applied',
          matchId: state.matchId,
          playerId: victim.player.playerId,
          teamId: victim.teamId,
          phase:
            trace?.nextPhase ??
            trace?.previousPhase ??
            state.circle?.phase ??
            null,
          timestamp,
          alive: false,
          eliminated: true,
        });
        victim.player.alive = false;
        victim.player.knocked = false;
        this.markObservedTelemetryPlayer(state, victim.teamId, victim.player);
        this.markObservedTelemetryPlayer(state, killer.teamId, killer.player);
        this.appendKillFeedItem(state, {
          id:
            event.dedupeKey ??
            `kill:${killer.player.playerId}:${victim.player.playerId}:${timestamp}`,
          ts: timestamp,
          killerTeamId:
            killer.teamId ?? event.killerTeamId ?? event.teamId ?? null,
          killerPlayerId: killer.player.playerId,
          killerName:
            toIdentifier(event.payload?.killerName) ||
            toIdentifier(event.payload?.killerPlayerName) ||
            killer.player.metadata?.playerName ||
            null,
          victimTeamId: victim.teamId ?? event.victimTeamId ?? null,
          victimPlayerId: victim.player.playerId,
          victimName:
            toIdentifier(event.payload?.victimName) ||
            toIdentifier(event.payload?.victimPlayerName) ||
            victim.player.metadata?.playerName ||
            null,
          delta: 1,
          totalKills: killer.player.kills,
          weapon: toIdentifier(event.payload?.weapon) || null,
        });
        this.appendStateEvent(state, {
          id:
            event.dedupeKey ??
            `PLAYER_KILL:${killer.player.playerId}:${timestamp}`,
          type: 'PLAYER_KILL',
          ts: timestamp,
          teamId: killer.teamId ?? event.killerTeamId ?? event.teamId ?? null,
          playerId: killer.player.playerId,
          payload: event.payload ?? null,
        });
        return true;
      }
      case 'TEAM_ELIMINATED':
        this.logger.warn(
          JSON.stringify({
            tag: '[TELEMETRY][BLOCKED]',
            stage: 'telemetry-engine',
            action: 'team-eliminated-event-blocked',
            matchId: state.matchId,
            teamId: event.teamId ?? null,
            reason: 'STRUCTURAL_TEAM_AGGREGATE_EVENT',
          }),
        );
        return false;
      case 'PLAYER_STATE':
        return false;
      default:
        return false;
    }
  }

  private resolveAdapterTeamId(
    state: TelemetryMatchState,
    team: Pick<AdapterTelemetryTeam, 'teamId' | 'slot' | 'name' | 'tag'>,
    options: { logUnmapped?: boolean } = {},
  ): string | null {
    const directId = toIdentifier(team.teamId);
    if (directId && state.teams[directId]) {
      return directId;
    }

    const teamIdAsSlot = normalizePositiveInteger(team.teamId);
    const explicitSlot =
      typeof team.slot === 'number' && Number.isFinite(team.slot)
        ? Math.trunc(team.slot)
        : null;
    const slotCandidate = explicitSlot ?? teamIdAsSlot;
    if (slotCandidate !== null) {
      const bySlot = Object.values(state.teams).find(
        (candidate) => candidate.metadata?.slot === slotCandidate,
      );
      if (bySlot) {
        return bySlot.teamId;
      }
    }

    const lookupKeys = [team.name, team.tag]
      .map((value) => normalizeLookup(value))
      .filter((value) => value.length > 0);
    for (const lookup of lookupKeys) {
      const byLabel = Object.values(state.teams).find((candidate) => {
        return (
          normalizeLookup(candidate.metadata?.teamName) === lookup ||
          normalizeLookup(candidate.metadata?.teamTag) === lookup
        );
      });
      if (byLabel) {
        return byLabel.teamId;
      }
    }

    const hasIdentifiers =
      toIdentifier(team.teamId).length > 0 ||
      (typeof team.slot === 'number' && Number.isFinite(team.slot)) ||
      normalizeLookup(team.name).length > 0 ||
      normalizeLookup(team.tag).length > 0;
    if (options.logUnmapped !== false) {
      this.logger.warn(
        JSON.stringify({
          stage: 'telemetry-engine',
          action: 'adapter-team-unmapped',
          matchId: state.matchId,
          input: {
            teamId: team.teamId ?? null,
            slot: team.slot ?? null,
            name: team.name ?? null,
            tag: team.tag ?? null,
          },
          reason: hasIdentifiers
            ? 'NO_CANONICAL_TEAM_MATCH'
            : 'MISSING_TEAM_IDENTIFIERS',
        }),
      );
    }

    return null;
  }

  private findAdapterPlayerByMetadata(
    state: TelemetryMatchState,
    params: {
      teamId: string | null;
      identifiers?: Array<string | null | undefined>;
      includePlayerName?: boolean;
    },
  ): { playerKey: string; player: TelemetryPlayerState } | null {
    const normalizedIdentifiers = (params.identifiers ?? [])
      .map((value) => normalizeLookup(value))
      .filter((value) => value.length > 0);
    if (normalizedIdentifiers.length === 0) {
      return null;
    }
    const matches = Object.entries(state.players)
      .flatMap(([playerKey, current]) => {
        if (params.teamId && current.teamId !== params.teamId) {
          return [];
        }

        const matchesIdentifier = normalizedIdentifiers.some((identifier) => {
          return (
            normalizeLookup(current.playerId) === identifier ||
            normalizeLookup(current.metadata?.externalPlayerId) ===
              identifier ||
            normalizeLookup(current.metadata?.inGameId) === identifier ||
            normalizeLookup(current.metadata?.slotPlayerResultId) ===
              identifier ||
            (params.includePlayerName === true &&
              normalizeLookup(current.metadata?.playerName) === identifier)
          );
        });
        if (matchesIdentifier) {
          return [{ playerKey, player: current }];
        }

        return [];
      })
      .sort((left, right) => {
        const leftScore =
          (left.player.metadata?.provisional ? 5 : 0) +
          (left.player.metadata?.slotPlayerResultId ? 0 : 1);
        const rightScore =
          (right.player.metadata?.provisional ? 5 : 0) +
          (right.player.metadata?.slotPlayerResultId ? 0 : 1);
        if (leftScore !== rightScore) {
          return leftScore - rightScore;
        }
        return left.playerKey.localeCompare(right.playerKey);
      });

    return matches[0]
      ? { playerKey: matches[0].playerKey, player: matches[0].player }
      : null;
  }

  private collectAdapterPlayers(
    envelope: AdapterTelemetryEnvelope,
  ): IncomingAdapterPlayer[] {
    const rootPlayers = (envelope.players ?? []).map((player) => ({
      player,
      parentTeam: null,
      playerIndex: null,
    }));
    const teamPlayers = (envelope.teams ?? []).flatMap((team) =>
      (team.players ?? []).map((player, index) => ({
        player: {
          ...player,
          teamId: player.teamId ?? team.teamId ?? null,
        },
        parentTeam: team,
        playerIndex: index,
      })),
    );
    const dedupedPlayers: IncomingAdapterPlayer[] = [];
    const seen = new Map<
      string,
      { players: IncomingAdapterPlayer[]; index: number }
    >();
    let droppedPlayers = 0;

    const appendUniquePlayer = (incoming: IncomingAdapterPlayer) => {
      const canonicalPlayerIds = this.adapterIncomingPlayerIds(incoming);
      if (canonicalPlayerIds.length === 0) {
        dedupedPlayers.push(incoming);
        return;
      }

      const existingEntry = canonicalPlayerIds
        .map((id) => seen.get(id))
        .find(
          (
            entry,
          ): entry is { players: IncomingAdapterPlayer[]; index: number } =>
            Boolean(entry),
        );

      if (existingEntry) {
        droppedPlayers += 1;
        existingEntry.players[existingEntry.index] =
          this.mergeIncomingAdapterPlayer(
            existingEntry.players[existingEntry.index],
            incoming,
            envelope,
          );
        for (const identifier of this.adapterIncomingPlayerIds(
          existingEntry.players[existingEntry.index],
        )) {
          seen.set(identifier, existingEntry);
        }
        return;
      }

      const index = dedupedPlayers.push(incoming) - 1;
      const entry = { players: dedupedPlayers, index };
      for (const canonicalPlayerId of canonicalPlayerIds) {
        seen.set(canonicalPlayerId, entry);
      }
    };

    for (const player of rootPlayers) {
      appendUniquePlayer(player);
    }
    for (const player of teamPlayers) {
      appendUniquePlayer(player);
    }

    if (droppedPlayers > 0) {
      this.logger.debug(
        JSON.stringify({
          tag: '[TELEMETRY][SOURCE]',
          stage: 'telemetry-engine',
          action: 'adapter-player-sources-deduped',
          matchId: envelope.matchId,
          source: envelope.source ?? null,
          rootPlayers: rootPlayers.length,
          teamPlayers: teamPlayers.length,
          uniquePlayers: dedupedPlayers.length,
          droppedPlayers,
        }),
      );
    }

    return dedupedPlayers;
  }

  private mergeIncomingAdapterPlayer(
    existing: IncomingAdapterPlayer,
    incoming: IncomingAdapterPlayer,
    envelope: AdapterTelemetryEnvelope,
  ): IncomingAdapterPlayer {
    const phase =
      typeof envelope.zone?.phase === 'number' &&
      Number.isFinite(envelope.zone.phase)
        ? Math.trunc(envelope.zone.phase)
        : null;
    const playerId =
      this.adapterIncomingPlayerId(existing) ??
      this.adapterIncomingPlayerId(incoming) ??
      existing.player.playerId ??
      incoming.player.playerId ??
      existing.player.pubgPlayerId ??
      incoming.player.pubgPlayerId ??
      existing.player.externalPlayerId ??
      incoming.player.externalPlayerId ??
      existing.player.pubgAccountId ??
      incoming.player.pubgAccountId ??
      null;
    const teamId =
      incoming.player.teamId ??
      existing.player.teamId ??
      incoming.parentTeam?.teamId ??
      existing.parentTeam?.teamId ??
      null;
    const alive = this.mergeAdapterPlayerLifeFlag(
      existing.player.alive,
      incoming.player.alive,
      {
        matchId: envelope.matchId,
        playerId,
        teamId,
        phase,
        timestamp: envelope.timestamp,
        field: 'alive',
        locations: [
          existing.parentTeam === null
            ? 'root'
            : `team:${existing.parentTeam.teamId ?? 'unknown'}`,
          incoming.parentTeam === null
            ? 'root'
            : `team:${incoming.parentTeam.teamId ?? 'unknown'}`,
        ],
      },
    );
    const eliminated = this.mergeAdapterPlayerLifeFlag(
      existing.player.eliminated,
      incoming.player.eliminated,
      {
        matchId: envelope.matchId,
        playerId,
        teamId,
        phase,
        timestamp: envelope.timestamp,
        field: 'eliminated',
        locations: [
          existing.parentTeam === null
            ? 'root'
            : `team:${existing.parentTeam.teamId ?? 'unknown'}`,
          incoming.parentTeam === null
            ? 'root'
            : `team:${incoming.parentTeam.teamId ?? 'unknown'}`,
        ],
      },
    );
    const mergedAlive =
      typeof alive === 'boolean'
        ? alive
        : eliminated === true
          ? false
          : undefined;
    const mergedKnocked =
      mergedAlive === false
        ? false
        : existing.player.knocked === true || incoming.player.knocked === true;

    this.logPlayerWrite({
      source: 'adapter',
      action: 'duplicate-adapter-player-merged',
      matchId: envelope.matchId,
      playerId,
      teamId,
      phase,
      timestamp: envelope.timestamp,
      alive: mergedAlive ?? null,
      eliminated:
        mergedAlive === true
          ? false
          : typeof eliminated === 'boolean'
            ? eliminated
            : null,
      metadata: {
        locations: [
          existing.parentTeam === null
            ? 'root'
            : `team:${existing.parentTeam.teamId ?? 'unknown'}`,
          incoming.parentTeam === null
            ? 'root'
            : `team:${incoming.parentTeam.teamId ?? 'unknown'}`,
        ],
      },
    });

    return {
      player: {
        ...existing.player,
        ...incoming.player,
        playerId: incoming.player.playerId ?? existing.player.playerId ?? null,
        externalPlayerId:
          incoming.player.externalPlayerId ??
          existing.player.externalPlayerId ??
          null,
        pubgPlayerId:
          incoming.player.pubgPlayerId ?? existing.player.pubgPlayerId ?? null,
        pubgAccountId:
          incoming.player.pubgAccountId ??
          existing.player.pubgAccountId ??
          null,
        ign: incoming.player.ign ?? existing.player.ign ?? null,
        teamId,
        alive: mergedAlive,
        knocked: mergedKnocked,
        eliminated:
          mergedAlive === true
            ? false
            : typeof eliminated === 'boolean'
              ? eliminated
              : (existing.player.eliminated ?? incoming.player.eliminated),
        kills:
          typeof incoming.player.kills === 'number' &&
          Number.isFinite(incoming.player.kills)
            ? incoming.player.kills
            : existing.player.kills,
        assists:
          typeof incoming.player.assists === 'number' &&
          Number.isFinite(incoming.player.assists)
            ? incoming.player.assists
            : existing.player.assists,
        health:
          normalizeAdapterPlayerHealth(incoming.player) ??
          normalizeAdapterPlayerHealth(existing.player),
        position: incoming.player.position ?? existing.player.position ?? null,
        raw: this.mergeAdapterPlayerRaw(
          existing.player.raw,
          incoming.player.raw,
        ),
      },
      parentTeam: existing.parentTeam ?? incoming.parentTeam,
      playerIndex: existing.playerIndex ?? incoming.playerIndex,
    };
  }

  private mergeAdapterPlayerLifeFlag(
    existing: boolean | undefined,
    incoming: boolean | undefined,
    params: {
      matchId: string;
      playerId: string | null;
      teamId: string | null;
      phase: number | null;
      timestamp: number | null;
      field: 'alive' | 'eliminated';
      locations: string[];
    },
  ): boolean | undefined {
    if (typeof existing !== 'boolean') {
      return incoming;
    }
    if (typeof incoming !== 'boolean') {
      return existing;
    }
    if (existing === incoming) {
      return existing;
    }

    const resolved = params.field === 'alive' ? true : false;
    this.logCriticalPlayerStateConflict({
      source: 'adapter',
      matchId: params.matchId,
      playerId: params.playerId,
      teamId: params.teamId,
      phase: params.phase,
      timestamp: params.timestamp,
      field: params.field,
      previousValue: existing,
      incomingValue: incoming,
      resolvedValue: resolved,
      reason: 'DUPLICATE_ADAPTER_PLAYER_CONFLICTING_LIFE_FIELDS',
      metadata: {
        locations: params.locations,
      },
    });
    return resolved;
  }

  private mergeAdapterPlayerRaw(
    existing: unknown,
    incoming: unknown,
  ): AdapterTelemetryPlayer['raw'] {
    const existingRecord = asRecord(existing);
    const incomingRecord = asRecord(incoming);
    if (existingRecord && incomingRecord) {
      return {
        ...existingRecord,
        ...incomingRecord,
      };
    }
    return incoming ?? existing ?? null;
  }

  private adapterIncomingPlayerIds(incoming: IncomingAdapterPlayer): string[] {
    const identifiers = new Set<string>();
    for (const value of [
      incoming.player.pubgPlayerId,
      incoming.player.playerId,
      incoming.player.externalPlayerId,
      incoming.player.pubgAccountId,
      this.readPlayerField(incoming.player, [
        'playerId',
        'playerID',
        'PlayerId',
        'PlayerID',
        'pubgPlayerId',
        'inGameId',
        'uId',
        'UId',
        'id',
        'uid',
        'Uid',
        'UID',
        'externalPlayerId',
        'externalId',
        'playerOpenId',
        'playerOpenID',
        'PlayerOpenId',
        'PlayerOpenID',
        'openId',
        'OpenId',
      ]),
      this.adapterIncomingPlayerId(incoming),
    ]) {
      const normalized = toOptionalText(value);
      if (normalized) {
        identifiers.add(normalized);
      }
    }
    const teamIdentity =
      toOptionalText(incoming.player.teamId) ??
      toOptionalText(incoming.parentTeam?.teamId) ??
      toOptionalText(incoming.parentTeam?.slot);
    const name = this.readPlayerField(
      incoming.player,
      ['playerName', 'PlayerName', 'player_name', 'ign', 'name', 'Name'],
      [incoming.player.ign],
    );
    const teamNameIdentity = this.toTeamNamePlayerIdentity(teamIdentity, name);
    if (teamNameIdentity) {
      identifiers.add(teamNameIdentity);
    }
    return [...identifiers];
  }

  private adapterIncomingPlayerId(
    incoming: IncomingAdapterPlayer,
  ): string | null {
    return this.adapterPlayerIdentity(
      incoming.player,
      incoming.parentTeam,
      incoming.playerIndex,
    );
  }

  private resolveIncomingPlayerTeamId(
    state: TelemetryMatchState,
    incoming: IncomingAdapterPlayer,
  ): string | null {
    return this.resolveAdapterTeamId(state, {
      teamId: incoming.player.teamId ?? incoming.parentTeam?.teamId ?? null,
      slot: incoming.parentTeam?.slot ?? null,
      name: incoming.parentTeam?.name ?? null,
      tag: incoming.parentTeam?.tag ?? null,
    });
  }

  private async resolveAdapterPlayer(
    state: TelemetryMatchState,
    incoming: IncomingAdapterPlayer,
    options: { allowTeamNameFallback?: boolean } = {},
  ): Promise<ResolvedAdapterPlayer | null> {
    const player = incoming.player;
    const teamId = this.resolveIncomingPlayerTeamId(state, incoming);
    const enforceCanonicalMapping = Boolean(this.mapping);
    const canMaterializeTeamRoster = teamId
      ? this.canMaterializeTelemetryPlayers(state, teamId)
      : false;
    if (!teamId && (player.teamId || incoming.parentTeam)) {
      this.logger.warn(
        JSON.stringify({
          tag: '[TELEMETRY][MAPPING]',
          stage: 'telemetry-engine',
          action: 'adapter-player-unmapped',
          matchId: state.matchId,
          input: {
            playerId: player.playerId ?? null,
            externalPlayerId: player.externalPlayerId ?? null,
            pubgPlayerId: player.pubgPlayerId ?? null,
            pubgAccountId: player.pubgAccountId ?? null,
            ign: player.ign ?? null,
            teamId: player.teamId ?? null,
          },
          reason: 'TEAM_MAPPING_FAILED',
        }),
      );
      return null;
    }

    const mapped = await this.resolveAdapterPlayerMapping(
      state,
      incoming,
      teamId,
    );
    if (mapped) {
      const statePlayer =
        this.findStatePlayerByMapping(state, mapped) ??
        state.players[mapped.playerKey] ??
        (teamId
          ? this.materializeMappedStatePlayer(state, incoming, teamId, mapped)
          : null);
      if (statePlayer) {
        statePlayer.metadata = {
          ...(statePlayer.metadata ?? {}),
          slotPlayerResultId: mapped.slotPlayerResultId,
          externalPlayerId:
            this.adapterPlayerExternalId(incoming.player) ??
            statePlayer.metadata?.externalPlayerId ??
            null,
          playerOpenId:
            toOptionalText(incoming.player.pubgAccountId) ??
            statePlayer.metadata?.playerOpenId ??
            null,
          inGameId:
            this.adapterPlayerInGameId(incoming.player) ??
            statePlayer.metadata?.inGameId ??
            null,
        };
        return {
          playerKey: statePlayer.playerId,
          teamId: statePlayer.teamId,
          mapping: mapped,
        };
      }
    }

    if (teamId && canMaterializeTeamRoster) {
      const materialized = this.materializeTelemetryPlayer(
        state,
        incoming,
        teamId,
      );
      if (materialized) {
        return materialized;
      }
    }

    if (enforceCanonicalMapping) {
      this.logger.warn(
        JSON.stringify({
          tag: '[TELEMETRY][MAPPING]',
          stage: 'telemetry-engine',
          action: 'adapter-player-unmapped',
          matchId: state.matchId,
          input: {
            playerId: player.playerId ?? null,
            externalPlayerId: player.externalPlayerId ?? null,
            pubgAccountId: player.pubgAccountId ?? null,
            ign: player.ign ?? null,
            teamId: teamId ?? null,
            parentTeamId: incoming.parentTeam?.teamId ?? null,
            slot: incoming.parentTeam?.slot ?? null,
            playerIndex: incoming.playerIndex,
          },
          reason: [
            player.playerId,
            player.pubgPlayerId,
            player.externalPlayerId,
            player.pubgAccountId,
            player.ign,
          ].some((value) => toIdentifier(value).length > 0)
            ? 'NO_CANONICAL_PLAYER_MATCH'
            : 'MISSING_CANONICAL_PLAYER_ID',
        }),
      );
      return null;
    }

    const candidates = [
      player.playerId,
      player.pubgPlayerId,
      player.externalPlayerId,
      player.pubgAccountId,
    ]
      .map((value) => toIdentifier(value))
      .filter((value) => value.length > 0);
    for (const candidate of candidates) {
      const direct = state.players[candidate];
      if (direct) {
        if (teamId && direct.teamId !== teamId) {
          this.logTelemetryStructuralMutation(state.matchId, {
            reason: 'PLAYER_TEAM_REASSIGNMENT',
            playerId: direct.playerId,
            currentTeamId: direct.teamId,
            incomingTeamId: teamId,
            externalPlayerId: player.externalPlayerId ?? null,
            pubgAccountId: player.pubgAccountId ?? null,
          });
          continue;
        }
        if (!teamId || direct.teamId === teamId) {
          return {
            playerKey: candidate,
            teamId: direct.teamId,
            mapping: null,
          };
        }
        continue;
      }
      const byMeta = this.findAdapterPlayerByMetadata(state, {
        teamId,
        identifiers: [candidate],
      });
      if (byMeta) {
        return {
          playerKey: byMeta.playerKey,
          teamId: byMeta.player.teamId,
          mapping: null,
        };
      }
    }

    const nameCandidate = normalizeLookup(player.ign);
    if (options.allowTeamNameFallback && nameCandidate && teamId) {
      const byTeamName = this.findAdapterPlayerByMetadata(state, {
        teamId,
        identifiers: [nameCandidate],
        includePlayerName: true,
      });
      if (byTeamName) {
        this.logger.debug(
          JSON.stringify({
            tag: '[TELEMETRY][MAPPING]',
            stage: 'telemetry-engine',
            action: 'adapter-player-team-name-mapped',
            matchId: state.matchId,
            playerKey: byTeamName.playerKey,
            teamId: byTeamName.player.teamId,
            ign: player.ign ?? null,
          }),
        );
        return {
          playerKey: byTeamName.playerKey,
          teamId: byTeamName.player.teamId,
          mapping: null,
        };
      }
    }

    const byIndex = this.findAdapterPlayerByTeamIndex(state, {
      teamId,
      playerIndex: incoming.playerIndex,
    });
    if (byIndex) {
      this.logger.debug(
        JSON.stringify({
          tag: '[TELEMETRY][MAPPING]',
          stage: 'telemetry-engine',
          action: 'adapter-player-index-mapped',
          matchId: state.matchId,
          playerKey: byIndex.playerKey,
          teamId: byIndex.player.teamId,
          playerIndex: incoming.playerIndex,
          externalPlayerId: player.externalPlayerId ?? null,
          pubgAccountId: player.pubgAccountId ?? null,
        }),
      );
      return {
        playerKey: byIndex.playerKey,
        teamId: byIndex.player.teamId,
        mapping: null,
      };
    }

    this.logger.warn(
      JSON.stringify({
        tag: '[TELEMETRY][MAPPING]',
        stage: 'telemetry-engine',
        action: 'adapter-player-unmapped',
        matchId: state.matchId,
        input: {
          playerId: player.playerId ?? null,
          externalPlayerId: player.externalPlayerId ?? null,
          pubgAccountId: player.pubgAccountId ?? null,
          ign: player.ign ?? null,
          teamId: teamId ?? null,
          parentTeamId: incoming.parentTeam?.teamId ?? null,
          slot: incoming.parentTeam?.slot ?? null,
          playerIndex: incoming.playerIndex,
        },
        reason:
          candidates.length > 0 || normalizeLookup(player.ign).length > 0
            ? 'NO_CANONICAL_PLAYER_MATCH'
            : 'MISSING_CANONICAL_PLAYER_ID',
      }),
    );

    return null;
  }

  private findAdapterPlayerByTeamIndex(
    state: TelemetryMatchState,
    input: {
      teamId: string | null;
      playerIndex: number | null;
    },
  ): { playerKey: string; player: TelemetryPlayerState } | null {
    if (!input.teamId || input.playerIndex === null || input.playerIndex < 0) {
      return null;
    }

    const teamPlayers = Object.entries(state.players)
      .filter(([, player]) => player.teamId === input.teamId)
      .sort((left, right) => {
        const leftName = normalizeLookup(left[1].metadata?.playerName);
        const rightName = normalizeLookup(right[1].metadata?.playerName);
        if (leftName !== rightName) {
          return leftName.localeCompare(rightName);
        }
        return left[0].localeCompare(right[0]);
      });
    const mapped = teamPlayers[input.playerIndex] ?? null;
    return mapped ? { playerKey: mapped[0], player: mapped[1] } : null;
  }

  private async resolveAdapterPlayerByEvent(
    state: TelemetryMatchState,
    input: {
      playerId?: string | null;
      teamId?: string | null;
      name?: string | null;
    },
  ): Promise<ResolvedAdapterEventPlayer | null> {
    const teamId = input.teamId
      ? this.resolveAdapterTeamId(state, {
          teamId: input.teamId,
          slot: null,
          name: null,
          tag: null,
        })
      : null;
    const candidate = toIdentifier(input.playerId);

    const mapped = await this.resolveAdapterPlayerMapping(
      state,
      {
        player: {
          playerId: input.playerId ?? null,
          externalPlayerId: input.playerId ?? null,
          teamId: input.teamId ?? null,
          ign: input.name ?? null,
        },
        parentTeam: null,
        playerIndex: null,
      },
      teamId,
    );
    if (mapped) {
      const player = this.findStatePlayerByMapping(state, mapped);
      if (player) {
        return { player, teamId: player.teamId, mapping: mapped };
      }
    }

    if (this.mapping) {
      this.logger.warn(
        JSON.stringify({
          tag: '[TELEMETRY][MAPPING]',
          stage: 'telemetry-engine',
          action: 'adapter-event-player-unmapped',
          matchId: state.matchId,
          input,
          reason: 'NO_LOCKABLE_MAPPING',
        }),
      );
      return null;
    }

    if (candidate) {
      const direct = state.players[candidate];
      if (direct) {
        if (!teamId || direct.teamId === teamId) {
          return { player: direct, teamId: direct.teamId, mapping: null };
        }
      }
      const byMeta = this.findAdapterPlayerByMetadata(state, {
        teamId,
        identifiers: [candidate],
      });
      if (byMeta) {
        return {
          player: byMeta.player,
          teamId: byMeta.player.teamId,
          mapping: null,
        };
      }
    }

    const nameCandidate = normalizeLookup(input.name);
    if (
      teamId &&
      nameCandidate &&
      (this.parachuteWindows.get(state.matchId)?.remainingTicks ?? 0) > 0
    ) {
      const byName = this.findAdapterPlayerByMetadata(state, {
        teamId,
        identifiers: [nameCandidate],
        includePlayerName: true,
      });
      if (byName) {
        return {
          player: byName.player,
          teamId: byName.player.teamId,
          mapping: null,
        };
      }
    }

    this.logger.warn(
      JSON.stringify({
        tag: '[TELEMETRY][MAPPING]',
        stage: 'telemetry-engine',
        action: 'adapter-event-player-unmapped',
        matchId: state.matchId,
        input,
        reason:
          candidate || normalizeLookup(input.name).length > 0
            ? 'NO_CANONICAL_PLAYER_MATCH'
            : 'MISSING_CANONICAL_PLAYER_ID',
      }),
    );
    return null;
  }

  private async resolveAdapterPlayerMapping(
    state: TelemetryMatchState,
    incoming: IncomingAdapterPlayer,
    resolvedTeamId: string | null,
  ): Promise<TelemetryPlayerMapping | null> {
    if (!this.mapping) {
      return null;
    }

    const resolvedTeam = resolvedTeamId ? state.teams[resolvedTeamId] : null;
    try {
      const resolved = await this.mapping.resolve(state.matchId, {
        externalPlayerId:
          this.adapterPlayerExternalId(incoming.player) ??
          incoming.player.playerId ??
          null,
        playerId: incoming.player.playerId ?? null,
        pubgAccountId: incoming.player.pubgAccountId ?? null,
        ign: incoming.player.ign ?? null,
        teamId: resolvedTeamId,
        slot: incoming.parentTeam?.slot ?? resolvedTeam?.metadata?.slot ?? null,
        playerIndex: incoming.playerIndex,
      });
      if (!resolved) {
        return null;
      }
      return (
        this.mapping.confirmMapping(
          state.matchId,
          resolved.externalPlayerId,
          resolved.slotPlayerId,
        ) ?? resolved
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        JSON.stringify({
          tag: '[TELEMETRY][MAPPING]',
          stage: 'telemetry-engine',
          action: 'mapping-resolver-failed',
          matchId: state.matchId,
          reason: message,
        }),
      );
      return null;
    }
  }

  private findStatePlayerByMapping(
    state: TelemetryMatchState,
    mapping: TelemetryPlayerMapping,
  ): TelemetryPlayerState | null {
    const direct = state.players[mapping.playerKey];
    if (direct) {
      return direct;
    }

    return (
      Object.values(state.players).find(
        (player) =>
          player.metadata?.slotPlayerResultId === mapping.slotPlayerResultId,
      ) ?? null
    );
  }

  private isMappingLocked(mapping: TelemetryPlayerMapping | null): boolean {
    return mapping ? mapping.locked === true : true;
  }

  private hasCriticalPlayerTelemetry(player: AdapterTelemetryPlayer): boolean {
    return (
      (typeof player.kills === 'number' && Number.isFinite(player.kills)) ||
      (typeof player.assists === 'number' && Number.isFinite(player.assists)) ||
      typeof player.alive === 'boolean' ||
      typeof player.knocked === 'boolean'
    );
  }

  private logUnstableCriticalUpdateBlocked(
    matchId: string,
    details: {
      action:
        | 'unstable-player-critical-update-blocked'
        | 'unstable-kill-event-blocked';
      externalPlayerId?: string | null;
      slotPlayerId?: string | null;
      playerId?: string | null;
      teamId?: string | null;
    },
  ): void {
    this.logger.debug(
      JSON.stringify({
        tag: '[TELEMETRY][MAPPING][BLOCKED]',
        stage: 'telemetry-engine',
        action: details.action,
        matchId,
        externalPlayerId: details.externalPlayerId ?? null,
        slotPlayerId: details.slotPlayerId ?? null,
        playerId: details.playerId ?? null,
        teamId: details.teamId ?? null,
        reason: 'UNLOCKED_MAPPING',
      }),
    );
  }

  private toCircleState(
    zone: AdapterTelemetryZone | null | undefined,
    current: TelemetryMatchState['circle'],
  ): TelemetryMatchState['circle'] {
    if (!zone) {
      return current ?? null;
    }
    return {
      phase:
        typeof zone.phase === 'number' && Number.isFinite(zone.phase)
          ? Math.trunc(zone.phase)
          : (current?.phase ?? null),
      nextShrinkAt:
        typeof zone.nextShrinkAt === 'number' &&
        Number.isFinite(zone.nextShrinkAt)
          ? zone.nextShrinkAt
          : (current?.nextShrinkAt ?? null),
      safeZone:
        zone.center &&
        typeof zone.center.x === 'number' &&
        typeof zone.center.y === 'number' &&
        typeof zone.radius === 'number'
          ? {
              x: zone.center.x,
              y: zone.center.y,
              r: zone.radius,
            }
          : (current?.safeZone ?? null),
      nextZone: current?.nextZone ?? null,
    };
  }

  private hasMeaningfulCircle(circle: TelemetryMatchState['circle']): boolean {
    return Boolean(
      circle?.safeZone ||
      circle?.nextZone ||
      circle?.phase !== null ||
      circle?.nextShrinkAt !== null,
    );
  }

  private providerPacketContainsZoneData(
    envelope: AdapterTelemetryEnvelope,
  ): boolean {
    if (envelope.zone !== null) {
      return true;
    }
    const raw = envelope.raw;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return false;
    }
    const candidate = raw as Record<string, unknown>;
    return (
      candidate.zone !== undefined ||
      candidate.circle !== undefined ||
      candidate.circleInfo !== undefined ||
      candidate.safeZone !== undefined ||
      candidate.zoneCenter !== undefined ||
      candidate.zoneRadius !== undefined ||
      candidate.CircleIndex !== undefined
    );
  }

  private hasExplicitLifecycleEvent(
    previous: TelemetryMatchState,
    next: TelemetryMatchState,
    type: 'MATCH_STARTED' | 'MATCH_ENDED',
  ): boolean {
    const previousEventIds = new Set(
      (previous.events ?? []).map((event) => event.id),
    );
    return (next.events ?? []).some(
      (event) => event.type === type && !previousEventIds.has(event.id),
    );
  }

  private logTransitionSummary(
    previous: TelemetryMatchState,
    next: TelemetryMatchState,
  ): void {
    if (
      previous.status !== next.status ||
      previous.startedAt !== next.startedAt ||
      previous.endedAt !== next.endedAt
    ) {
      this.logger.debug(
        JSON.stringify({
          stage: 'telemetry-engine',
          action: 'lifecycle-transition',
          matchId: next.matchId,
          from: {
            status: previous.status,
            startedAt: previous.startedAt,
            endedAt: previous.endedAt,
          },
          to: {
            status: next.status,
            startedAt: next.startedAt,
            endedAt: next.endedAt,
          },
        }),
      );
    }

    const playerTransitions = Object.entries(next.players)
      .flatMap(([playerId, player]) => {
        const previousPlayer = previous.players[playerId];
        if (!previousPlayer) {
          return [];
        }
        const changes: Record<string, unknown> = {};
        if (previousPlayer.alive !== player.alive) {
          changes.alive = { from: previousPlayer.alive, to: player.alive };
        }
        if (previousPlayer.knocked !== player.knocked) {
          changes.knocked = {
            from: previousPlayer.knocked,
            to: player.knocked,
          };
        }
        if (previousPlayer.kills !== player.kills) {
          changes.kills = { from: previousPlayer.kills, to: player.kills };
        }
        if (previousPlayer.assists !== player.assists) {
          changes.assists = {
            from: previousPlayer.assists,
            to: player.assists,
          };
        }
        return Object.keys(changes).length > 0
          ? [
              {
                playerId,
                teamId: player.teamId,
                changes,
              },
            ]
          : [];
      })
      .slice(0, 8);
    if (playerTransitions.length > 0) {
      this.logger.debug(
        JSON.stringify({
          stage: 'telemetry-engine',
          action: 'player-state-transitions',
          matchId: next.matchId,
          count: playerTransitions.length,
          sample: playerTransitions,
        }),
      );
    }

    const teamTransitions = Object.entries(next.teams)
      .flatMap(([teamId, team]) => {
        const previousTeam = previous.teams[teamId];
        if (!previousTeam) {
          return [];
        }
        if (
          previousTeam.eliminated === team.eliminated &&
          previousTeam.placement === team.placement &&
          previousTeam.alivePlayers === team.alivePlayers &&
          previousTeam.totalKills === team.totalKills
        ) {
          return [];
        }
        return [
          {
            teamId,
            eliminated: {
              from: previousTeam.eliminated,
              to: team.eliminated,
            },
            alivePlayers: {
              from: previousTeam.alivePlayers,
              to: team.alivePlayers,
            },
            placement: {
              from: previousTeam.placement,
              to: team.placement,
            },
            kills: {
              from: previousTeam.totalKills,
              to: team.totalKills,
            },
          },
        ];
      })
      .slice(0, 8);
    if (teamTransitions.length > 0) {
      this.logger.debug(
        JSON.stringify({
          stage: 'telemetry-engine',
          action: 'team-state-transitions',
          matchId: next.matchId,
          count: teamTransitions.length,
          sample: teamTransitions,
        }),
      );
    }

    const killFeedDeltaCount = Math.max(
      0,
      (next.killFeed ?? []).length - (previous.killFeed ?? []).length,
    );
    if (killFeedDeltaCount > 0) {
      const latest = (next.killFeed ?? [])
        .slice(-killFeedDeltaCount)
        .slice(-5)
        .map((item) => ({
          id: item.id,
          killerTeamId: item.killerTeamId ?? null,
          killerPlayerId: item.killerPlayerId ?? null,
          victimTeamId: item.victimTeamId ?? null,
          victimPlayerId: item.victimPlayerId ?? null,
          weapon: item.weapon ?? null,
        }));
      this.logger.debug(
        JSON.stringify({
          stage: 'telemetry-engine',
          action: 'kill-feed-emitted',
          matchId: next.matchId,
          count: killFeedDeltaCount,
          latest,
        }),
      );
    }

    if (
      JSON.stringify(previous.circle ?? null) !==
      JSON.stringify(next.circle ?? null)
    ) {
      this.logger.debug(
        JSON.stringify({
          stage: 'telemetry-engine',
          action: 'circle-updated',
          matchId: next.matchId,
          circle: next.circle ?? null,
        }),
      );
    }
  }

  private logTeamEliminationConsistencyWarnings(
    state: TelemetryMatchState,
    timestamp: number,
  ): void {
    const playersByTeam = new Map<string, string[]>();
    for (const player of Object.values(state.players)) {
      if (player.alive === true) {
        const bucket = playersByTeam.get(player.teamId) ?? [];
        bucket.push(player.playerId);
        playersByTeam.set(player.teamId, bucket);
      }
    }

    for (const [teamId, team] of Object.entries(state.teams)) {
      const alivePlayers = playersByTeam.get(teamId) ?? [];
      if (team.eliminated && alivePlayers.length > 0) {
        this.logger.warn(
          JSON.stringify({
            stage: 'telemetry-engine',
            action: 'guardrail-team-eliminated-with-alive-players',
            matchId: state.matchId,
            teamId,
            alivePlayers: alivePlayers.slice(0, 8),
            timestamp,
          }),
        );
      }
    }
  }

  private appendStateEvent(
    state: TelemetryMatchState,
    event: NonNullable<TelemetryMatchState['events']>[number],
  ) {
    this.ensureStateDefaults(state);
    state.events = [...(state.events ?? []), event].slice(-200);
  }

  private appendKillFeedItem(
    state: TelemetryMatchState,
    item: NonNullable<TelemetryMatchState['killFeed']>[number],
  ) {
    this.ensureStateDefaults(state);
    state.killFeed = [...(state.killFeed ?? []), item].slice(-50);
  }

  private toObservedPlayerState(
    state: TelemetryMatchState,
    observedPlayer: MatchStateObservedPlayer | null | undefined,
    timestamp: number,
  ): MatchStateObservedPlayer | null {
    if (!observedPlayer) {
      return null;
    }

    const normalizedIds = new Set(
      [
        observedPlayer.playerId,
        observedPlayer.externalPlayerId,
        observedPlayer.pubgPlayerId,
      ]
        .map((value) => normalizeLookup(value))
        .filter((value) => value.length > 0),
    );
    const normalizedNames = new Set(
      [observedPlayer.playerIgn, observedPlayer.playerName]
        .map((value) => normalizeLookup(value))
        .filter((value) => value.length > 0),
    );

    const matchedPlayer =
      Object.values(state.players).find((player) => {
        const candidateIds = [
          player.playerId,
          player.metadata?.externalPlayerId,
          player.metadata?.inGameId,
        ]
          .map((value) => normalizeLookup(value))
          .filter((value) => value.length > 0);
        if (candidateIds.some((value) => normalizedIds.has(value))) {
          return true;
        }
        if (
          observedPlayer.teamId &&
          player.teamId !== observedPlayer.teamId &&
          normalizeLookup(player.teamId) !==
            normalizeLookup(observedPlayer.teamId)
        ) {
          return false;
        }
        const candidateNames = [player.metadata?.playerName]
          .map((value) => normalizeLookup(value))
          .filter((value) => value.length > 0);
        return candidateNames.some((value) => normalizedNames.has(value));
      }) ?? null;

    const matchedTeamId =
      observedPlayer.teamId ?? matchedPlayer?.teamId ?? null;
    const matchedTeam = matchedTeamId
      ? (state.teams[matchedTeamId] ?? null)
      : null;

    return {
      playerId: observedPlayer.playerId ?? matchedPlayer?.playerId ?? null,
      externalPlayerId:
        observedPlayer.externalPlayerId ??
        matchedPlayer?.metadata?.externalPlayerId ??
        null,
      pubgPlayerId:
        observedPlayer.pubgPlayerId ??
        matchedPlayer?.metadata?.inGameId ??
        null,
      playerName:
        observedPlayer.playerName ??
        matchedPlayer?.metadata?.playerName ??
        null,
      playerIgn:
        observedPlayer.playerIgn ??
        observedPlayer.playerName ??
        matchedPlayer?.metadata?.playerName ??
        null,
      teamId: matchedTeamId,
      teamName:
        observedPlayer.teamName ?? matchedTeam?.metadata?.teamName ?? null,
      teamTag: observedPlayer.teamTag ?? matchedTeam?.metadata?.teamTag ?? null,
      teamLogoUrl:
        observedPlayer.teamLogoUrl ?? matchedTeam?.metadata?.logoUrl ?? null,
      updatedAt: observedPlayer.updatedAt ?? new Date(timestamp).toISOString(),
    };
  }

  private observedPlayerSignature(
    observedPlayer: MatchStateObservedPlayer | null | undefined,
  ): string {
    if (!observedPlayer) {
      return 'null';
    }
    return JSON.stringify({
      playerId: observedPlayer.playerId ?? null,
      externalPlayerId: observedPlayer.externalPlayerId ?? null,
      pubgPlayerId: observedPlayer.pubgPlayerId ?? null,
      playerName: observedPlayer.playerName ?? null,
      playerIgn: observedPlayer.playerIgn ?? null,
      teamId: observedPlayer.teamId ?? null,
      teamName: observedPlayer.teamName ?? null,
      teamTag: observedPlayer.teamTag ?? null,
      teamLogoUrl: observedPlayer.teamLogoUrl ?? null,
    });
  }

  private ensureStateDefaults(state: TelemetryMatchState): TelemetryMatchState {
    state.telemetryAcceptedAt =
      typeof state.telemetryAcceptedAt === 'number' &&
      Number.isFinite(state.telemetryAcceptedAt)
        ? state.telemetryAcceptedAt
        : null;
    state.telemetryAcceptedSource =
      typeof state.telemetryAcceptedSource === 'string' &&
      state.telemetryAcceptedSource.trim().length > 0
        ? canonicalizeTelemetryRuntimeSource(state.telemetryAcceptedSource)
        : null;
    state.circle = state.circle ?? null;
    state.observedPlayer = state.observedPlayer ?? null;
    state.killFeed = Array.isArray(state.killFeed) ? state.killFeed : [];
    state.events = Array.isArray(state.events) ? state.events : [];
    for (const player of Object.values(state.players ?? {})) {
      player.assists = normalizeNonNegativeInteger(player.assists) ?? 0;
      player.health = normalizeHealthValue(player.health);
    }
    return state;
  }

  private stateSignature(state: TelemetryMatchState): string {
    const normalized = this.cloneState(state);
    return JSON.stringify({
      matchId: normalized.matchId,
      status: normalized.status,
      mode: normalized.mode,
      startedAt: normalized.startedAt,
      endedAt: normalized.endedAt,
      telemetryAcceptedAt: normalized.telemetryAcceptedAt ?? null,
      telemetryAcceptedSource: normalized.telemetryAcceptedSource ?? null,
      teamsAlive: normalized.teamsAlive,
      circle: normalized.circle ?? null,
      observedPlayer: normalized.observedPlayer ?? null,
      players: normalized.players,
      teams: normalized.teams,
      killFeed: normalized.killFeed ?? [],
      events: normalized.events ?? [],
    });
  }

  private async prepareMatchStart(matchId: string, actor: Actor | null) {
    this.logger.debug(
      JSON.stringify({
        stage: 'telemetry-engine',
        action: 'prepare-match-start',
        matchId,
        source: actor?.actorId ?? actor?.id ?? 'SYSTEM',
      }),
    );
    this.mapping?.reset(matchId);
    await this.matchControl.startMatch(actor ?? null, matchId, null, {
      source: 'telemetry-engine',
      requestedMatchId: matchId,
    });
    this.runtimes.delete(matchId);
    this.acceptedRuns.delete(matchId);
  }

  private async resetRuntimeForAcceptedRun(
    matchId: string,
    context: {
      reason?: string | null;
      trace?: PhaseTransitionTrace | null;
    } = {},
  ): Promise<TelemetryMatchState> {
    this.logger.warn(
      JSON.stringify({
        tag: '[PHASE TRANSITION][RESET]',
        stage: 'telemetry-engine',
        action: 'runtime-rebuild-from-roster',
        matchId,
        reason: context.reason ?? null,
        previousPhase: context.trace?.previousPhase ?? null,
        nextPhase: context.trace?.nextPhase ?? null,
        currentPlayers: context.trace?.currentPlayers ?? null,
        incomingPlayers: context.trace?.incomingPlayers ?? null,
        overlapPlayers: context.trace?.overlapPlayers ?? null,
      }),
    );
    const reset = await this.loadState(matchId, {
      refresh: true,
      preferSnapshot: false,
    });
    this.runtimes.set(matchId, this.cloneState(reset));
    return reset;
  }

  private getLiveSnapshotIgnoreReason(params: {
    snapshot: TelemetryMatchState;
    expectedStatus: MatchEngineStatus;
    persistedStartedAt: number | null;
  }): string | null {
    if (params.expectedStatus !== 'LIVE') {
      return null;
    }
    if (params.snapshot.status !== 'LIVE') {
      return 'SNAPSHOT_STATUS_NOT_LIVE';
    }
    if (params.snapshot.endedAt !== null) {
      return 'SNAPSHOT_ENDED_AT_PRESENT';
    }
    if (
      Object.keys(params.snapshot.teams ?? {}).length === 0 &&
      Object.keys(params.snapshot.players ?? {}).length === 0
    ) {
      return 'SNAPSHOT_EMPTY_LIVE_STATE';
    }
    if (
      params.persistedStartedAt !== null &&
      params.snapshot.startedAt !== params.persistedStartedAt
    ) {
      return 'SNAPSHOT_STARTED_AT_MISMATCH';
    }
    return null;
  }

  private async loadState(
    matchId: string,
    opts: { refresh?: boolean; preferSnapshot?: boolean } = {},
  ): Promise<TelemetryMatchState> {
    if (!opts.refresh) {
      const runtime = this.runtimes.get(matchId);
      if (runtime) {
        return this.cloneState(runtime);
      }
    }

    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        organizationId: true,
        tournamentId: true,
        status: true,
        startedAt: true,
        endedAt: true,
        controlState: {
          select: {
            state: true,
            authorityMode: true,
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
    if (!match) {
      throw new NotFoundException('Match not found');
    }

    if (opts.preferSnapshot !== false) {
      const snapshot = asSnapshotState(match.stateSnapshot?.stateJson);
      if (snapshot) {
        const expectedStatus = this.toEngineStatus(
          match.status,
          match.controlState?.state ?? null,
        );
        const ignoreReason =
          expectedStatus === 'LIVE'
            ? this.getLiveSnapshotIgnoreReason({
                snapshot,
                expectedStatus,
                persistedStartedAt: match.startedAt?.getTime() ?? null,
              })
            : null;
        if (ignoreReason) {
          this.logger.warn(
            JSON.stringify({
              stage: 'telemetry-engine',
              action: 'telemetry-engine.stale-snapshot-ignored',
              matchId,
              reason: ignoreReason,
              snapshotStatus: snapshot.status,
              expectedStatus,
              snapshotStartedAt: snapshot.startedAt ?? null,
              persistedStartedAt: match.startedAt?.getTime() ?? null,
              snapshotEndedAt: snapshot.endedAt ?? null,
            }),
          );
        } else {
          this.ensureStateDefaults(snapshot);
          snapshot.mode = toTelemetryControlMode(
            match.controlState?.authorityMode ?? snapshot.mode,
          );
          snapshot.version = Math.max(
            snapshot.version ?? 0,
            readLiveSyncContract(match.controlState?.metaJson ?? null).version,
          );
          this.sanitizeTelemetryState(snapshot, {
            reason: 'LOAD_SNAPSHOT',
            timestamp: snapshot.updatedAt,
            recomputeDerivedState: true,
          });
          await this.reconcileWithPersistedSync(snapshot);
          await this.syncStateVersionWithMirror(snapshot);
          return snapshot;
        }
      }
    }

    const built = await this.buildRosterState(matchId, {
      matchId: match.id,
      organizationId: match.organizationId,
      tournamentId: match.tournamentId,
      status: this.toEngineStatus(
        match.status,
        match.controlState?.state ?? null,
      ),
      mode: toTelemetryControlMode(match.controlState?.authorityMode),
      startedAt: match.startedAt?.getTime() ?? null,
      endedAt: match.endedAt?.getTime() ?? null,
    });
    this.sanitizeTelemetryState(built, {
      reason: 'BUILD_ROSTER_STATE',
      timestamp: built.updatedAt,
      recomputeDerivedState: true,
    });
    await this.reconcileWithPersistedSync(built);
    await this.syncStateVersionWithMirror(built);
    return built;
  }

  private async syncStateVersionWithMirror(state: TelemetryMatchState) {
    const mirrored = await this.stateStore?.get(state.matchId);
    const mirroredVersion =
      typeof mirrored?.version === 'number' ? mirrored.version : null;
    if (
      mirroredVersion !== null &&
      Number.isFinite(mirroredVersion) &&
      mirroredVersion > state.version
    ) {
      state.version = mirroredVersion;
    }
  }

  private async buildRosterState(
    matchId: string,
    base: Omit<TelemetryRosterState, 'players' | 'teams'> & {
      startedAt: number | null;
      endedAt: number | null;
    },
  ): Promise<TelemetryMatchState> {
    const [slotResults, slots] = await Promise.all([
      this.prisma.matchSlotResult.findMany({
        where: { matchId },
        include: {
          team: {
            select: {
              id: true,
              name: true,
              tag: true,
              logoUrl: true,
            },
          },
          players: {
            include: {
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
        orderBy: { slotNumber: 'asc' },
      }),
      this.prisma.matchSlot.findMany({
        where: { matchId, deletedAt: null },
        include: {
          team: {
            select: {
              id: true,
              name: true,
              tag: true,
              logoUrl: true,
              players: {
                where: { deletedAt: null },
                select: {
                  id: true,
                  ign: true,
                  realName: true,
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
        orderBy: { slotNumber: 'asc' },
      }),
    ]);

    const slotByNumber = new Map(
      slots.map((slot) => [slot.slotNumber, slot] as const),
    );
    const teams: Record<string, TelemetryTeamState> = {};
    const players: Record<string, TelemetryPlayerState> = {};
    const defaultTeamName = 'Arenzyra';

    const buildFallbackRosterPlayers = (
      slotTeam:
        | {
            players?: Array<{
              id: string;
              ign?: string | null;
              realName?: string | null;
              photoUrl?: string | null;
              externalPlayerId?: string | null;
              playerOpenId?: string | null;
              inGameId?: string | null;
              pubgPlayerId?: string | null;
            }>;
          }
        | null
        | undefined,
    ) => {
      const rosterSize = slotTeam?.players?.length ?? 0;
      if (rosterSize === 0 || rosterSize > 8) {
        return [];
      }

      return (slotTeam?.players ?? []).slice(0, 4).map((player) => {
        const playerKey =
          buildMatchPlayerKey({
            playerId: player.id,
            playerResultId: null,
          }) ?? player.id;
        return {
          key: playerKey,
          playerId: playerKey,
          playerName: player.ign ?? player.realName ?? player.id,
          avatarUrl: player.photoUrl ?? null,
          externalPlayerId:
            player.externalPlayerId ?? player.playerOpenId ?? null,
          inGameId: player.inGameId ?? player.pubgPlayerId ?? null,
          slotPlayerResultId: playerKey,
          alive: true,
          knocked: false,
          kills: 0,
          assists: 0,
          canonicalSeed: true,
          provisional: false,
        };
      });
    };

    for (const slotResult of slotResults) {
      if (!slotResult.teamId) {
        continue;
      }
      const slot = slotByNumber.get(slotResult.slotNumber) ?? null;
      const teamName =
        slotResult.team?.name ?? slot?.team?.name ?? defaultTeamName;
      const teamTag = slotResult.team?.tag ?? slot?.team?.tag ?? null;
      const logoUrl = slotResult.team?.logoUrl ?? slot?.team?.logoUrl ?? null;
      const rosterPlayers =
        slotResult.players.length > 0
          ? slotResult.players.map((player) => ({
              key:
                buildMatchPlayerKey({
                  playerId: player.playerId ?? null,
                  playerResultId: player.id,
                }) ?? player.id,
              playerId:
                buildMatchPlayerKey({
                  playerId: player.playerId ?? null,
                  playerResultId: player.id,
                }) ?? player.id,
              playerName:
                player.playerName ??
                player.player?.ign ??
                player.playerId ??
                'Player',
              avatarUrl: player.player?.photoUrl ?? null,
              externalPlayerId:
                player.externalPlayerId ??
                player.player?.externalPlayerId ??
                player.pubgAccountId ??
                null,
              inGameId:
                player.player?.inGameId ??
                player.player?.pubgPlayerId ??
                player.externalPlayerId ??
                null,
              slotPlayerResultId: player.id,
              alive:
                ((player as { isAlive?: boolean | null }).isAlive ??
                  (player as { alive?: boolean | null }).alive ??
                  true) === true,
              knocked:
                ((player as { isKnocked?: boolean | null }).isKnocked ??
                  false) === true,
              health: null,
              kills: Math.max(0, player.kills ?? 0),
              assists: Math.max(0, player.assists ?? 0),
              canonicalSeed: false,
              provisional: false,
            }))
          : buildFallbackRosterPlayers(slot?.team);

      teams[slotResult.teamId] = {
        teamId: slotResult.teamId,
        alivePlayers: 0,
        eliminated: false,
        placement: null,
        totalKills: 0,
        totalPlayers: Math.max(rosterPlayers.length, 0),
        eliminatedAt: null,
        metadata: {
          teamName,
          teamTag,
          logoUrl,
          slot: slotResult.slotNumber,
          totalPlayers: Math.max(rosterPlayers.length, 0),
          slotResultId: slotResult.id,
          wasPresentInMatch: slotResult.wasPresentInMatch ?? null,
          canonicalSeed: true,
          provisional: false,
        },
      };

      for (const player of rosterPlayers) {
        players[player.key] = {
          playerId: player.playerId,
          teamId: slotResult.teamId,
          alive: player.alive,
          knocked: player.knocked,
          kills: player.kills,
          assists: player.assists,
          metadata: {
            playerName: player.playerName,
            avatarUrl: player.avatarUrl,
            slotPlayerResultId: player.slotPlayerResultId,
            externalPlayerId: player.externalPlayerId,
            inGameId: player.inGameId,
            position: null,
            canonicalSeed: player.canonicalSeed ?? false,
            provisional: player.provisional,
          },
        };
      }
    }

    for (const slot of slots) {
      if (!slot.team?.id || teams[slot.team.id]) {
        continue;
      }

      const rosterPlayers = buildFallbackRosterPlayers(slot.team);
      teams[slot.team.id] = {
        teamId: slot.team.id,
        alivePlayers: 0,
        eliminated: false,
        placement: null,
        totalKills: 0,
        totalPlayers: Math.max(rosterPlayers.length, 0),
        eliminatedAt: null,
        metadata: {
          teamName: slot.team.name ?? defaultTeamName,
          teamTag: slot.team.tag ?? null,
          logoUrl: slot.team.logoUrl ?? null,
          slot: slot.slotNumber,
          totalPlayers: Math.max(rosterPlayers.length, 0),
          slotResultId: null,
          wasPresentInMatch: null,
          canonicalSeed: true,
          provisional: false,
        },
      };

      for (const player of rosterPlayers) {
        players[player.key] = {
          playerId: player.playerId,
          teamId: slot.team.id,
          alive: player.alive,
          knocked: player.knocked,
          kills: player.kills,
          assists: player.assists,
          metadata: {
            playerName: player.playerName,
            avatarUrl: player.avatarUrl,
            slotPlayerResultId: player.slotPlayerResultId,
            externalPlayerId: player.externalPlayerId,
            inGameId: player.inGameId,
            position: null,
            canonicalSeed: player.canonicalSeed ?? false,
            provisional: player.provisional,
          },
        };
      }
    }

    const state: TelemetryMatchState = {
      matchId: base.matchId,
      status: base.status,
      mode: base.mode,
      version: 0,
      sequence: 0,
      updatedAt: Date.now(),
      telemetryAcceptedAt: null,
      telemetryAcceptedSource: null,
      startedAt: base.startedAt,
      endedAt: base.endedAt,
      teamsAlive: 0,
      circle: null,
      observedPlayer: null,
      killFeed: [],
      events: [],
      players,
      teams,
    };
    this.recomputeDerivedState(state, Date.now());
    return state;
  }

  private toEngineStatus(
    matchStatus: MatchStatus,
    controlState: string | null,
  ): MatchEngineStatus {
    const lifecycleStatus = deriveCanonicalMatchLifecycleStatus({
      status: matchStatus,
      controlState,
    });
    if (lifecycleStatus === 'FINISHED') {
      return 'LOCKED';
    }
    if (lifecycleStatus === 'FINISH_PENDING') {
      return 'ENDED';
    }
    if (lifecycleStatus === 'LIVE') {
      return 'LIVE';
    }
    return 'PENDING';
  }
}
