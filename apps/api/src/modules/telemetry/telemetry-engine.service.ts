import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { MatchStatus } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { MatchControlService } from '../match-control/match-control.service';
import { ResultsService } from '../results/results.service';
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
import { MatchControlStateStore } from '../match-control/state.store';
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

type MutationResult = {
  state: TelemetryMatchState;
  ignored?: boolean;
  reason?: string | null;
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
  kills: number;
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

@Injectable()
export class TelemetryEngineService {
  private readonly logger = new Logger(TelemetryEngineService.name);
  private readonly runtimes = new Map<string, TelemetryMatchState>();
  private readonly acceptedRuns = new Map<string, AcceptedTelemetryRun>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ResultsService))
    private readonly results: ResultsService,
    @Inject(forwardRef(() => MatchControlService))
    private readonly matchControl: MatchControlService,
    private readonly validator: TelemetryValidatorService,
    private readonly persistence: TelemetryPersistenceService,
    private readonly broadcast: TelemetryBroadcastService,
    private readonly stateStore: MatchControlStateStore = null as never,
  ) {}

  async getState(matchId: string): Promise<TelemetryMatchState> {
    const runtime = this.runtimes.get(matchId);
    if (runtime) {
      const refreshed =
        (await this.refreshRuntimeForMatchBoundary(matchId, runtime)) ??
        runtime;
      const current = this.cloneState(refreshed);
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
    next.mode = mode;
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
    const resolvedSource = source ?? envelope.source ?? 'ADAPTER';
    const sessionId = this.toAdapterSessionId(envelope.sessionId);
    const adapterSequence = this.toAdapterSequence(envelope.sequence);
    const hasLiveSignal = this.hasLiveTelemetrySignal(envelope, orderedEvents);

    if (
      sessionId &&
      acceptedRun.sessionId &&
      acceptedRun.sessionId !== sessionId
    ) {
      current = await this.resetRuntimeForAcceptedRun(envelope.matchId);
      acceptedRun = this.resetAcceptedRun(envelope.matchId, current);
    } else if (current.status !== 'LIVE' && hasLiveSignal) {
      current = await this.resetRuntimeForAcceptedRun(envelope.matchId);
      acceptedRun = this.resetAcceptedRun(envelope.matchId, current);
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
      return {
        state: current,
        ignored: true,
        reason: 'STALE_ACCEPTED_SEQUENCE',
      };
    }

    const next = this.cloneState(current);
    this.applyAdapterSnapshot(next, envelope, resolvedSource);
    if (hasLiveSignal) {
      next.telemetryAcceptedAt = envelope.timestamp;
      next.telemetryAcceptedSource = resolvedSource;
    }
    this.recomputeDerivedState(next, envelope.timestamp);
    await this.reconcileWithPersistedSync(next);

    const transitionedToEnded = this.isEndTransition(current, next);
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
    if (transitionedToEnded && !hasExplicitEndSignal) {
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
      return {
        state: current,
        ignored: true,
        reason: 'MATCH_END_REQUIRES_EXPLICIT_EVENT',
      };
    }
    if (transitionedToEnded && !this.hasAcceptedLiveTelemetry(acceptedRun)) {
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
      return {
        state: current,
        ignored: true,
        reason: 'MATCH_END_REQUIRES_PRIOR_LIVE_TELEMETRY',
      };
    }
    if (
      transitionedToEnded &&
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
      return {
        state: current,
        ignored: true,
        reason: 'MATCH_END_REQUIRES_SESSION_SCOPED_LIVE_TELEMETRY',
      };
    }
    if (
      transitionedToEnded &&
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
      return {
        state: current,
        ignored: true,
        reason: 'MATCH_END_STALE_TRIGGER',
      };
    }

    if (this.stateSignature(current) === this.stateSignature(next)) {
      this.setAcceptedRun(envelope.matchId, nextAcceptedRun);
      return {
        state: current,
        ignored: true,
        reason: 'NO_STATE_CHANGE',
      };
    }

    next.version = current.version + 1;
    next.sequence = current.sequence + Math.max(orderedEvents.length, 1);
    next.updatedAt = envelope.timestamp;
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
    if (event.type !== 'MATCH_STARTED' && event.type !== 'MATCH_ENDED') {
      next.telemetryAcceptedAt = event.timestamp;
      next.telemetryAcceptedSource = event.source;
      const currentRun = this.getAcceptedRun(event.matchId, current);
      this.setAcceptedRun(
        event.matchId,
        this.advanceAcceptedRun(currentRun, {
          sessionId: currentRun.sessionId,
          sequence: event.sequence,
          hasLiveTelemetry: true,
          timestamp: event.timestamp,
          source: event.source,
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
    await this.persistence.persistState(next);
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
    const timestamp = command.timestamp ?? Date.now();
    const pending: PendingManualOverrides = {
      players: {},
      teams: {},
    };
    const markPlayerOverride = (
      playerId: string,
      field: keyof LiveSyncPlayerOwnership,
    ) => {
      if (!pending.players[playerId]) {
        pending.players[playerId] = [];
      }
      pending.players[playerId]?.push(field);
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
      case 'LOCK_RESULTS':
        state.status = 'LOCKED';
        state.endedAt = state.endedAt ?? command.timestamp ?? Date.now();
        return pending;
      case 'SET_PLAYER_ALIVE': {
        const player = this.requirePlayer(state, command.playerId);
        player.alive = command.alive;
        if (!player.alive) {
          player.knocked = false;
        }
        player.ownership = {
          ...(player.ownership ?? {}),
          alive: {
            owner: 'MANUAL',
            override: true,
            updatedAt: timestamp,
            source: command.source ?? 'MANUAL',
          },
        };
        markPlayerOverride(command.playerId, 'alive');
        return pending;
      }
      case 'SET_PLAYER_KNOCKED': {
        const player = this.requirePlayer(state, command.playerId);
        player.knocked = command.knocked;
        if (player.knocked) {
          player.alive = true;
        }
        player.ownership = {
          ...(player.ownership ?? {}),
          knocked: {
            owner: 'MANUAL',
            override: true,
            updatedAt: timestamp,
            source: command.source ?? 'MANUAL',
          },
        };
        markPlayerOverride(command.playerId, 'knocked');
        return pending;
      }
      case 'SET_PLAYER_KILLS': {
        const player = this.requirePlayer(state, command.playerId);
        player.kills = command.kills;
        player.ownership = {
          ...(player.ownership ?? {}),
          kills: {
            owner: 'MANUAL',
            override: true,
            updatedAt: timestamp,
            source: command.source ?? 'MANUAL',
          },
        };
        markPlayerOverride(command.playerId, 'kills');
        return pending;
      }
      default:
        throw new BadRequestException('Unsupported control command');
    }
  }

  private recomputeDerivedState(state: TelemetryMatchState, timestamp: number) {
    this.ensureStateDefaults(state);
    if (state.status === 'PENDING' && this.hasLiveSignals(state)) {
      state.status = 'LIVE';
      state.startedAt = state.startedAt ?? timestamp;
    }

    const playersByTeam = new Map<
      string,
      Array<{ key: string; state: TelemetryPlayerState }>
    >();
    for (const [playerKey, player] of Object.entries(state.players)) {
      const bucket = playersByTeam.get(player.teamId) ?? [];
      bucket.push({ key: playerKey, state: player });
      playersByTeam.set(player.teamId, bucket);
    }

    const totalTeams = Math.max(Object.keys(state.teams).length, 1);
    const derived = derivePubgMatchState<number>({
      eliminationMarker: timestamp,
      teams: Object.keys(state.teams).map((teamId) => {
        const team = state.teams[teamId];
        const teamPlayers = playersByTeam.get(teamId) ?? [];
        return {
          teamId,
          sortKey: this.teamSortKey(team),
          players: teamPlayers.map((entry) => ({
            id: entry.key,
            teamId,
            kills: entry.state.kills,
            alive: entry.state.alive,
            knocked: entry.state.knocked,
          })),
          totalPlayers: Math.max(team.totalPlayers, teamPlayers.length),
          eliminatedAt: team.eliminatedAt ?? null,
          eliminatedOrder: this.toExistingEliminatedOrder(totalTeams, team),
          manualTotalKills: false,
          totalKillsOverride: team.totalKills,
        };
      }),
    });

    const derivedTeamsById = new Map(
      derived.teams.map((team) => [team.teamId, team] as const),
    );

    for (const [teamId, team] of Object.entries(state.teams)) {
      const nextTeam = derivedTeamsById.get(teamId);
      if (!nextTeam) {
        continue;
      }

      team.alivePlayers = nextTeam.aliveCount;
      team.totalPlayers = nextTeam.totalPlayers;
      team.totalKills = nextTeam.teamKills;
      team.eliminated = nextTeam.eliminated;
      team.placement = nextTeam.placement;
      team.eliminatedAt = nextTeam.eliminated ? nextTeam.eliminatedAt : null;
    }

    for (const team of derived.teams) {
      for (const player of team.players) {
        const current = state.players[player.id];
        if (!current) {
          continue;
        }
        current.kills = player.kills;
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
      }
    }

    const alivePlayers = derived.teams.reduce(
      (sum, team) => sum + team.aliveCount,
      0,
    );
    state.teamsAlive = derived.aliveTeams;
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
        aliveTeams: derived.aliveTeams,
        alivePlayers,
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
  ) {
    const persisted = await this.loadPersistedOverrideSnapshot(state.matchId);
    state.version = Math.max(state.version, persisted.version);
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
        }
      }
    }

    this.decorateOwnership(state, persisted, pendingManualOverrides);
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
        mode: 'AUTO',
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
              isAlive: true,
              alive: true,
              isKnocked: true,
              player: {
                select: {
                  externalPlayerId: true,
                  photoUrl: true,
                  inGameId: true,
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
          kills: Math.max(0, player.kills ?? 0),
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
            inGameId: player.pubgAccountId ?? player.player?.inGameId ?? null,
          },
        });
      }
    }

    return {
      mode:
        (controlState?.authorityMode as TelemetryControlMode | undefined) ??
        'AUTO',
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
      };
    }
  }

  private toExistingEliminatedOrder(
    totalTeams: number,
    team: TelemetryTeamState,
  ): number | null {
    if (team.eliminated !== true) {
      return null;
    }
    if (typeof team.placement !== 'number' || team.placement <= 1) {
      return totalTeams;
    }
    return Math.max(totalTeams - team.placement + 1, 1);
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
        ? state.telemetryAcceptedSource.trim()
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
        ? params.source
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

  private applyAdapterSnapshot(
    state: TelemetryMatchState,
    envelope: AdapterTelemetryEnvelope,
    source: string,
  ) {
    this.ensureStateDefaults(state);

    for (const team of envelope.teams ?? []) {
      const teamId = this.resolveAdapterTeamId(state, team);
      if (!teamId) {
        continue;
      }
      const currentTeam = state.teams[teamId];
      const teamTotalPlayers =
        typeof team.totalPlayers === 'number' &&
        Number.isFinite(team.totalPlayers)
          ? Math.max(0, Math.trunc(team.totalPlayers))
          : null;
      currentTeam.metadata = {
        ...(currentTeam.metadata ?? {}),
        teamName: team.name ?? currentTeam.metadata?.teamName ?? null,
        teamTag: team.tag ?? currentTeam.metadata?.teamTag ?? null,
        logoUrl: team.logoUrl ?? currentTeam.metadata?.logoUrl ?? null,
        slot: team.slot ?? currentTeam.metadata?.slot ?? null,
        totalPlayers:
          teamTotalPlayers ??
          currentTeam.metadata?.totalPlayers ??
          currentTeam.totalPlayers ??
          null,
      };
      if (teamTotalPlayers !== null) {
        currentTeam.totalPlayers = Math.max(
          currentTeam.totalPlayers,
          teamTotalPlayers,
        );
      }
    }

    const players = [
      ...(envelope.players ?? []),
      ...(envelope.teams ?? []).flatMap((team) => team.players ?? []),
    ];
    for (const player of players) {
      const resolved = this.resolveAdapterPlayer(state, player);
      if (!resolved) {
        continue;
      }
      const currentPlayer = state.players[resolved.playerKey];
      currentPlayer.teamId = resolved.teamId;
      currentPlayer.metadata = {
        ...(currentPlayer.metadata ?? {}),
        playerName:
          player.ign ??
          currentPlayer.metadata?.playerName ??
          currentPlayer.playerId,
        externalPlayerId:
          player.externalPlayerId ??
          player.playerId ??
          currentPlayer.metadata?.externalPlayerId ??
          null,
        inGameId:
          player.pubgAccountId ?? currentPlayer.metadata?.inGameId ?? null,
        position: player.position ?? currentPlayer.metadata?.position ?? null,
      };
      if (typeof player.kills === 'number' && Number.isFinite(player.kills)) {
        currentPlayer.kills = Math.max(0, Math.trunc(player.kills));
      }
      if (typeof player.alive === 'boolean') {
        currentPlayer.alive = player.alive;
        if (!player.alive) {
          currentPlayer.knocked = false;
        }
      }
      if (typeof player.knocked === 'boolean') {
        currentPlayer.knocked = player.knocked;
        if (player.knocked) {
          currentPlayer.alive = true;
        }
      }
      this.markObservedTelemetryPlayer(state, resolved.teamId, currentPlayer);
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

    for (const event of [...(envelope.events ?? [])].sort(
      (left, right) => left.timestamp - right.timestamp,
    )) {
      this.applyAdapterEvent(state, event, envelope.timestamp);
    }
  }

  private applyAdapterEvent(
    state: TelemetryMatchState,
    event: AdapterTelemetryEvent,
    fallbackTimestamp: number,
  ) {
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
        return;
      case 'KILL': {
        const killer = this.resolveAdapterPlayerByEvent(state, {
          playerId: event.killerId ?? null,
          teamId: event.killerTeamId ?? event.teamId ?? null,
          name:
            toIdentifier(event.payload?.killerName) ||
            toIdentifier(event.payload?.killerPlayerName) ||
            null,
        });
        const victim = this.resolveAdapterPlayerByEvent(state, {
          playerId: event.victimId ?? null,
          teamId: event.victimTeamId ?? null,
          name:
            toIdentifier(event.payload?.victimName) ||
            toIdentifier(event.payload?.victimPlayerName) ||
            null,
        });
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
        }
        if (victim) {
          victim.player.alive = false;
          victim.player.knocked = false;
          this.markObservedTelemetryPlayer(state, victim.teamId, victim.player);
        }
        if (killer) {
          this.markObservedTelemetryPlayer(state, killer.teamId, killer.player);
        }
        this.appendKillFeedItem(state, {
          id:
            event.dedupeKey ??
            `kill:${killer?.player.playerId ?? 'unknown'}:${victim?.player.playerId ?? 'unknown'}:${timestamp}`,
          ts: timestamp,
          killerTeamId:
            killer?.teamId ?? event.killerTeamId ?? event.teamId ?? null,
          killerPlayerId: killer?.player.playerId ?? event.killerId ?? null,
          killerName:
            toIdentifier(event.payload?.killerName) ||
            toIdentifier(event.payload?.killerPlayerName) ||
            killer?.player.metadata?.playerName ||
            null,
          victimTeamId: victim?.teamId ?? event.victimTeamId ?? null,
          victimPlayerId: victim?.player.playerId ?? event.victimId ?? null,
          victimName:
            toIdentifier(event.payload?.victimName) ||
            toIdentifier(event.payload?.victimPlayerName) ||
            victim?.player.metadata?.playerName ||
            null,
          delta: 1,
          totalKills: killer?.player.kills ?? null,
          weapon: toIdentifier(event.payload?.weapon) || null,
        });
        this.appendStateEvent(state, {
          id:
            event.dedupeKey ??
            `PLAYER_KILL:${killer?.player.playerId ?? 'unknown'}:${timestamp}`,
          type: 'PLAYER_KILL',
          ts: timestamp,
          teamId: killer?.teamId ?? event.killerTeamId ?? event.teamId ?? null,
          playerId: killer?.player.playerId ?? event.killerId ?? null,
          payload: event.payload ?? null,
        });
        return;
      }
      case 'TEAM_ELIMINATED':
        this.appendStateEvent(state, {
          id:
            event.dedupeKey ??
            `TEAM_ELIMINATED:${event.teamId ?? 'unknown'}:${timestamp}`,
          type: 'TEAM_ELIMINATED',
          ts: timestamp,
          teamId: event.teamId ?? null,
          payload: event.payload ?? null,
        });
        return;
      case 'PLAYER_STATE':
        return;
      default:
        return;
    }
  }

  private resolveAdapterTeamId(
    state: TelemetryMatchState,
    team: Pick<AdapterTelemetryTeam, 'teamId' | 'slot' | 'name' | 'tag'>,
  ): string | null {
    const directId = toIdentifier(team.teamId);
    if (directId && state.teams[directId]) {
      return directId;
    }

    if (typeof team.slot === 'number' && Number.isFinite(team.slot)) {
      const normalizedSlot = Math.trunc(team.slot);
      const bySlot = Object.values(state.teams).find(
        (candidate) => candidate.metadata?.slot === normalizedSlot,
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

    return null;
  }

  private findAdapterPlayerByMetadata(
    state: TelemetryMatchState,
    params: {
      teamId: string | null;
      identifiers?: Array<string | null | undefined>;
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
            normalizeLookup(current.metadata?.externalPlayerId) ===
              identifier ||
            normalizeLookup(current.metadata?.inGameId) === identifier
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

  private provisionAdapterPlayer(
    state: TelemetryMatchState,
    params: {
      teamId: string | null;
      playerId?: string | null;
      externalPlayerId?: string | null;
      inGameId?: string | null;
      name?: string | null;
      alive?: boolean | null;
      knocked?: boolean | null;
      kills?: number | null;
      position?: AdapterTelemetryPlayer['position'];
      source: 'snapshot' | 'event';
    },
  ): { playerKey: string; player: TelemetryPlayerState } | null {
    if (!params.teamId) {
      return null;
    }

    const teamId = params.teamId;
    const stableExternalId = toOptionalText(
      params.externalPlayerId ?? params.playerId,
    );
    const inGameId = toOptionalText(params.inGameId);
    const playerKey = stableExternalId
      ? `provisional:${teamId}:external:${normalizeLookup(stableExternalId)}`
      : inGameId
        ? `provisional:${teamId}:ingame:${normalizeLookup(inGameId)}`
        : null;

    if (!playerKey) {
      return null;
    }

    const alive = params.knocked === true ? true : params.alive !== false;
    const knocked = params.knocked === true;
    const kills =
      typeof params.kills === 'number' && Number.isFinite(params.kills)
        ? Math.max(0, Math.trunc(params.kills))
        : 0;

    const player =
      state.players[playerKey] ??
      (state.players[playerKey] = {
        playerId: playerKey,
        teamId,
        alive,
        knocked,
        kills,
        metadata: {
          playerName: params.name ?? playerKey,
          externalPlayerId: stableExternalId,
          inGameId,
          position: params.position ?? null,
          provisional: true,
        },
      });

    player.teamId = teamId;
    player.metadata = {
      ...(player.metadata ?? {}),
      playerName: params.name ?? player.metadata?.playerName ?? playerKey,
      externalPlayerId:
        stableExternalId ?? player.metadata?.externalPlayerId ?? null,
      inGameId: inGameId ?? player.metadata?.inGameId ?? null,
      position: params.position ?? player.metadata?.position ?? null,
      provisional: true,
    };
    if (typeof params.kills === 'number' && Number.isFinite(params.kills)) {
      player.kills = kills;
    }
    if (params.knocked === true) {
      player.knocked = true;
      player.alive = true;
    } else if (typeof params.alive === 'boolean') {
      player.alive = params.alive;
      if (!params.alive) {
        player.knocked = false;
      }
    }

    this.logger.debug(
      JSON.stringify({
        stage: 'telemetry-engine',
        action: 'adapter-player-provisioned',
        matchId: state.matchId,
        source: params.source,
        playerKey,
        teamId,
        externalPlayerId: stableExternalId,
        inGameId,
        name: params.name ?? null,
      }),
    );

    return { playerKey, player };
  }

  private resolveAdapterPlayer(
    state: TelemetryMatchState,
    player: AdapterTelemetryPlayer,
  ): { playerKey: string; teamId: string } | null {
    const teamId = this.resolveAdapterTeamId(state, {
      teamId: player.teamId ?? null,
      slot: null,
      name: null,
      tag: null,
    });
    if (!teamId) {
      this.logger.warn(
        JSON.stringify({
          stage: 'telemetry-engine',
          action: 'adapter-player-unmapped',
          matchId: state.matchId,
          input: {
            playerId: player.playerId ?? null,
            externalPlayerId: player.externalPlayerId ?? null,
            pubgAccountId: player.pubgAccountId ?? null,
            ign: player.ign ?? null,
            teamId: player.teamId ?? null,
          },
          reason: 'TEAM_MAPPING_FAILED',
        }),
      );
      return null;
    }

    const candidates = [
      player.playerId,
      player.externalPlayerId,
      player.pubgAccountId,
    ]
      .map((value) => toIdentifier(value))
      .filter((value) => value.length > 0);
    for (const candidate of candidates) {
      const direct = state.players[candidate];
      if (direct) {
        if (direct.teamId === teamId) {
          return { playerKey: candidate, teamId };
        }
        continue;
      }
      const byMeta = this.findAdapterPlayerByMetadata(state, {
        teamId,
        identifiers: [candidate],
      });
      if (byMeta) {
        return { playerKey: byMeta.playerKey, teamId };
      }
    }

    const provisional = this.provisionAdapterPlayer(state, {
      teamId,
      playerId: toOptionalText(player.playerId),
      externalPlayerId: toOptionalText(player.externalPlayerId),
      inGameId: toOptionalText(player.pubgAccountId),
      name: toOptionalText(player.ign),
      alive:
        typeof player.alive === 'boolean'
          ? player.alive
          : typeof player.knocked === 'boolean'
            ? true
            : null,
      knocked: typeof player.knocked === 'boolean' ? player.knocked : null,
      kills:
        typeof player.kills === 'number' && Number.isFinite(player.kills)
          ? player.kills
          : null,
      position: player.position ?? null,
      source: 'snapshot',
    });
    if (provisional) {
      return { playerKey: provisional.playerKey, teamId };
    }

    this.logger.warn(
      JSON.stringify({
        stage: 'telemetry-engine',
        action: 'adapter-player-unmapped',
        matchId: state.matchId,
        input: {
          playerId: player.playerId ?? null,
          externalPlayerId: player.externalPlayerId ?? null,
          pubgAccountId: player.pubgAccountId ?? null,
          ign: player.ign ?? null,
          teamId,
        },
        reason:
          candidates.length > 0 || normalizeLookup(player.ign).length > 0
            ? 'NO_CANONICAL_PLAYER_MATCH'
            : 'MISSING_CANONICAL_PLAYER_ID',
      }),
    );

    return null;
  }

  private resolveAdapterPlayerByEvent(
    state: TelemetryMatchState,
    input: {
      playerId?: string | null;
      teamId?: string | null;
      name?: string | null;
    },
  ): { player: TelemetryPlayerState; teamId: string } | null {
    const teamId = input.teamId
      ? this.resolveAdapterTeamId(state, {
          teamId: input.teamId,
          slot: null,
          name: null,
          tag: null,
        })
      : null;
    const candidate = toIdentifier(input.playerId);
    if (candidate) {
      const direct = state.players[candidate];
      if (direct) {
        if (!teamId || direct.teamId === teamId) {
          return { player: direct, teamId: direct.teamId };
        }
      }
      const byMeta = this.findAdapterPlayerByMetadata(state, {
        teamId,
        identifiers: [candidate],
      });
      if (byMeta) {
        return { player: byMeta.player, teamId: byMeta.player.teamId };
      }
    }

    const provisional = this.provisionAdapterPlayer(state, {
      teamId,
      playerId: toOptionalText(input.playerId),
      externalPlayerId: toOptionalText(input.playerId),
      inGameId: null,
      name: toOptionalText(input.name),
      alive: true,
      knocked: false,
      kills: 0,
      position: null,
      source: 'event',
    });
    if (provisional) {
      return {
        player: provisional.player,
        teamId: provisional.player.teamId,
      };
    }

    this.logger.warn(
      JSON.stringify({
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

  private ensureStateDefaults(state: TelemetryMatchState): TelemetryMatchState {
    state.telemetryAcceptedAt =
      typeof state.telemetryAcceptedAt === 'number' &&
      Number.isFinite(state.telemetryAcceptedAt)
        ? state.telemetryAcceptedAt
        : null;
    state.telemetryAcceptedSource =
      typeof state.telemetryAcceptedSource === 'string' &&
      state.telemetryAcceptedSource.trim().length > 0
        ? state.telemetryAcceptedSource.trim()
        : null;
    state.circle = state.circle ?? null;
    state.killFeed = Array.isArray(state.killFeed) ? state.killFeed : [];
    state.events = Array.isArray(state.events) ? state.events : [];
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
    await this.matchControl.startMatch(actor ?? null, matchId);
    this.runtimes.delete(matchId);
    this.acceptedRuns.delete(matchId);
  }

  private async resetRuntimeForAcceptedRun(
    matchId: string,
  ): Promise<TelemetryMatchState> {
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
          snapshot.mode =
            (match.controlState?.authorityMode as
              | TelemetryControlMode
              | undefined) ??
            snapshot.mode ??
            'AUTO';
          snapshot.version = Math.max(
            snapshot.version ?? 0,
            readLiveSyncContract(match.controlState?.metaJson ?? null).version,
          );
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
      mode:
        (match.controlState?.authorityMode as
          | TelemetryControlMode
          | undefined) ?? 'AUTO',
      startedAt: match.startedAt?.getTime() ?? null,
      endedAt: match.endedAt?.getTime() ?? null,
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
    await this.results.ensureResultsFromSlots(matchId);

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

    for (const slotResult of slotResults) {
      if (!slotResult.teamId) {
        continue;
      }
      const slot = slotByNumber.get(slotResult.slotNumber) ?? null;
      const teamName =
        slotResult.team?.name ??
        slot?.team?.name ??
        defaultTeamName;
      const teamTag = slotResult.team?.tag ?? slot?.team?.tag ?? null;
      const logoUrl = slotResult.team?.logoUrl ?? slot?.team?.logoUrl ?? null;

      teams[slotResult.teamId] = {
        teamId: slotResult.teamId,
        alivePlayers: 0,
        eliminated: false,
        placement: null,
        totalKills: 0,
        totalPlayers: Math.max(slotResult.players.length, 0),
        eliminatedAt: null,
        metadata: {
          teamName,
          teamTag,
          logoUrl,
          slot: slotResult.slotNumber,
          totalPlayers: Math.max(slotResult.players.length, 0),
          slotResultId: slotResult.id,
          wasPresentInMatch: slotResult.wasPresentInMatch ?? null,
        },
      };

      const rosterPlayers = slotResult.players.map((player) => ({
        key: buildMatchPlayerKey({
          playerId: player.playerId ?? null,
          playerResultId: player.id,
        }) as string,
        playerId: buildMatchPlayerKey({
          playerId: player.playerId ?? null,
          playerResultId: player.id,
        }) as string,
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
        inGameId: player.pubgAccountId ?? player.player?.inGameId ?? null,
        slotPlayerResultId: player.id,
        alive:
          ((player as { isAlive?: boolean | null }).isAlive ??
            (player as { alive?: boolean | null }).alive ??
            true) === true,
        knocked:
          ((player as { isKnocked?: boolean | null }).isKnocked ?? false) ===
          true,
        kills: Math.max(0, player.kills ?? 0),
      }));

      for (const player of rosterPlayers) {
        players[player.key] = {
          playerId: player.playerId,
          teamId: slotResult.teamId,
          alive: player.alive,
          knocked: player.knocked,
          kills: player.kills,
          metadata: {
            playerName: player.playerName,
            avatarUrl: player.avatarUrl,
            slotPlayerResultId: player.slotPlayerResultId,
            externalPlayerId: player.externalPlayerId,
            inGameId: player.inGameId,
            position: null,
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
    if (lifecycleStatus === 'ENDED') {
      return 'ENDED';
    }
    if (lifecycleStatus === 'LIVE' || lifecycleStatus === 'PAUSED') {
      return 'LIVE';
    }
    return 'PENDING';
  }
}
