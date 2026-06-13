import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  deriveCanonicalMatchLifecycleStatus,
  deriveControlStateFromMatchStatus,
} from '../../common/match-status.util';
import { PrismaService } from '../../db/prisma.service';
import { mapStateToDto } from '../../realtime/live-match-state.dto';
import { TelemetryEngineService } from './telemetry-engine.service';
import { TelemetryPersistenceService } from './telemetry-persistence.service';
import { TelemetryBroadcastService } from './telemetry-broadcast.service';
import type {
  AdapterTelemetryEnvelope,
  AdapterTelemetryPlayer,
} from '../game-adapters/game-adapter.types';
import {
  enforceTelemetrySourceAllowed,
  type TelemetrySourceGuardMatch,
} from '../../common/telemetry-source.util';
import { MatchControlService } from '../match-control/match-control.service';

type IngressContext = {
  boundMatchId?: string | null;
  source?: string | null;
};

type TelemetryIngressCursor = {
  sessionId: string | null;
  lastAdapterSequence: number | null;
  updatedAt: number | null;
};

type SanitizedEnvelopeStats = {
  rootPlayersBefore: number;
  rootPlayersAfter: number;
  teamPlayersBefore: number;
  teamPlayersAfter: number;
  droppedPlayers: number;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const normalizeFieldName = (value: string): string =>
  value.replace(/[^a-z0-9]/gi, '').toLowerCase();

const normalizeLookup = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
};

const FORBIDDEN_ENVELOPE_ROOT_FIELDS = new Set([
  'matchstatus',
  'isfinished',
  'finished',
  'isended',
  'ended',
  'winnerteamid',
  'winnerteam',
  'winner',
  'finalplacements',
  'finalplacement',
  'placements',
  'placement',
  'ranks',
  'rank',
  'matchendedat',
  'aliveteams',
  'aliveplayers',
]);

const toJsonInput = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;

const TELEMETRY_INGRESS_SEQUENCE_RESET_DELTA = 25;

@Injectable()
export class TelemetryIngressService {
  private readonly logger = new Logger(TelemetryIngressService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: TelemetryEngineService,
    private readonly persistence: TelemetryPersistenceService,
    private readonly broadcast: TelemetryBroadcastService,
    @Inject(forwardRef(() => MatchControlService))
    private readonly matchControl: MatchControlService,
  ) {}

  async ingestAdapterTelemetryEnvelope(
    payload: AdapterTelemetryEnvelope,
    context: IngressContext = {},
  ) {
    const matchId = this.stringValue(context.boundMatchId) ?? payload.matchId;
    const sessionId = this.stringValue(payload.sessionId);
    const sequence = this.numberValue(payload.sequence);
    const source = context.source ?? payload.source ?? null;
    const forbiddenRootFields = this.readForbiddenRootFields(payload);

    this.logger.log(
      JSON.stringify({
        tag: '[TICK RECEIVED]',
        stage: 'telemetry-ingress',
        action: 'adapter-tick-received',
        matchId,
        sessionId,
        sequence,
        source,
        timestamp: payload.timestamp,
        players: payload.players.length,
        teams: payload.teams.length,
        events: payload.events.length,
        hasZone: payload.zone !== null,
        phase:
          typeof payload.zone?.phase === 'number' &&
          Number.isFinite(payload.zone.phase)
            ? Math.trunc(payload.zone.phase)
            : null,
      }),
    );
    this.logger.debug(
      JSON.stringify({
        tag: '[TELEMETRY][INGEST]',
        stage: 'telemetry-ingress',
        matchId,
        sessionId,
        sequence,
        source,
        players: payload.players.length,
        teams: payload.teams.length,
        events: payload.events.length,
        hasZone: payload.zone !== null,
        phase:
          typeof payload.zone?.phase === 'number' &&
          Number.isFinite(payload.zone.phase)
            ? Math.trunc(payload.zone.phase)
            : null,
      }),
    );

    if (forbiddenRootFields.length > 0) {
      this.logger.warn(
        JSON.stringify({
          tag: '[TELEMETRY][BLOCKED]',
          stage: 'telemetry-ingress',
          action: 'telemetry-ingress.forbidden-envelope',
          matchId,
          sessionId,
          sequence,
          source,
          forbiddenFields: forbiddenRootFields,
        }),
      );
      return {
        ok: true,
        ignored: true,
        reason: 'FORBIDDEN_FIELDS',
        matchId,
      };
    }

    if (!sessionId) {
      this.logRejected({
        reason: 'SESSION_ID_REQUIRED',
        matchId,
        sessionId: null,
        sequence,
        source,
      });
      return {
        ok: true,
        ignored: true,
        reason: 'SESSION_ID_REQUIRED',
        matchId,
      };
    }

    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        deletedAt: true,
        status: true,
        liveState: true,
        telemetrySource: true,
        telemetrySourceLockedAt: true,
        pcobSessionId: true,
        organizationId: true,
        controlState: {
          select: {
            state: true,
            organizationId: true,
            metaJson: true,
          },
        },
        tournament: {
          select: {
            organizationId: true,
          },
        },
      },
    });
    if (!match) {
      this.logRejected({
        reason: 'MATCH_NOT_FOUND',
        matchId,
        sessionId,
        sequence,
        source,
      });
      return {
        ok: true,
        ignored: true,
        reason: 'MATCH_NOT_FOUND',
        matchId,
      };
    }

    const expectedSessionId = this.stringValue(match.pcobSessionId);
    if (!expectedSessionId || sessionId !== expectedSessionId) {
      this.logRejected({
        reason: 'SESSION_MISMATCH',
        matchId,
        sessionId,
        sequence,
        source,
      });
      return {
        ok: true,
        ignored: true,
        reason: 'SESSION_MISMATCH',
        matchId,
      };
    }

    if (sequence === null) {
      this.logRejected({
        reason: 'SEQUENCE_MISMATCH',
        matchId,
        sessionId,
        sequence,
        source,
      });
      return {
        ok: true,
        ignored: true,
        reason: 'SEQUENCE_MISMATCH',
        matchId,
      };
    }

    const lifecycle = deriveCanonicalMatchLifecycleStatus({
      status: match.status,
      controlState: match.controlState?.state ?? null,
      metaJson: match.controlState?.metaJson ?? null,
    });
    if (lifecycle !== 'LIVE') {
      this.logRejected({
        reason: 'MATCH_NOT_LIVE',
        matchId,
        sessionId,
        sequence,
        source,
      });
      return {
        ok: true,
        ignored: true,
        reason: 'MATCH_NOT_LIVE',
        matchId,
      };
    }

    const ingressCursor = this.readIngressCursor(
      match.controlState?.metaJson ?? null,
    );
    if (
      ingressCursor.sessionId === sessionId &&
      ingressCursor.lastAdapterSequence !== null &&
      sequence <= ingressCursor.lastAdapterSequence
    ) {
      if (
        this.shouldResetIngressCursor({
          cursor: ingressCursor,
          sessionId,
          sequence,
          timestamp: payload.timestamp,
        })
      ) {
        this.logger.warn(
          JSON.stringify({
            stage: 'telemetry-ingress',
            action: 'telemetry-ingress.sequence-rewind-reset',
            message:
              '[Telemetry] Reset stale ingress cursor after adapter sequence rewind',
            matchId,
            sessionId,
            source,
            incoming: sequence,
            current: ingressCursor.lastAdapterSequence,
            cursorUpdatedAt: ingressCursor.updatedAt,
            timestamp: payload.timestamp,
          }),
        );
      } else {
        this.logger.debug(
          JSON.stringify({
            stage: 'telemetry-ingress',
            action: 'telemetry-ingress.out-of-order-packet',
            message: '[Telemetry] Dropped out-of-order packet',
            matchId,
            sessionId,
            source,
            incoming: sequence,
            current: ingressCursor.lastAdapterSequence,
          }),
        );
        return {
          ok: true,
          ignored: true,
          reason: 'SEQUENCE_MISMATCH',
          matchId,
        };
      }
    }

    await enforceTelemetrySourceAllowed({
      prisma: this.prisma,
      logger: this.logger,
      match: match as TelemetrySourceGuardMatch,
      incomingSource: source,
    });

    const canonicalEnvelope =
      matchId === payload.matchId ? payload : { ...payload, matchId };
    const { envelope, stats } = this.sanitizeTelemetryEnvelopePlayers(
      canonicalEnvelope,
      {
        matchId,
        sessionId,
        sequence,
        source,
        timestamp: canonicalEnvelope.timestamp,
        phase:
          typeof canonicalEnvelope.zone?.phase === 'number' &&
          Number.isFinite(canonicalEnvelope.zone.phase)
            ? Math.trunc(canonicalEnvelope.zone.phase)
            : null,
      },
    );

    this.logger.debug(
      JSON.stringify({
        tag: '[TELEMETRY][SOURCE]',
        stage: 'telemetry-ingress',
        action: 'player-source-counts',
        matchId,
        sessionId,
        sequence,
        source,
        rootPlayersBefore: stats.rootPlayersBefore,
        rootPlayersAfter: stats.rootPlayersAfter,
        teamPlayersBefore: stats.teamPlayersBefore,
        teamPlayersAfter: stats.teamPlayersAfter,
        droppedPlayers: stats.droppedPlayers,
      }),
    );

    let result: Awaited<
      ReturnType<TelemetryEngineService['applyAdapterTelemetryEnvelope']>
    >;
    try {
      result = await this.engine.applyAdapterTelemetryEnvelope(
        envelope,
        source,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        JSON.stringify({
          tag: '[TELEMETRY][TICK DROPPED]',
          stage: 'telemetry-ingress',
          action: 'engine-apply-failed',
          matchId,
          sessionId,
          sequence,
          source,
          timestamp: envelope.timestamp,
          message,
        }),
      );
      throw error;
    }

    await this.persistIngressCursor(matchId, {
      organizationId:
        match.controlState?.organizationId ??
        match.organizationId ??
        match.tournament?.organizationId ??
        null,
      state: match.controlState?.state ?? null,
      sessionId,
      sequence,
    });
    await this.persistence.markTelemetryAccepted(matchId, {
      source,
      sequence: result.state.sequence,
    });
    await this.maybeAutoConfirmFinishedMatch(
      matchId,
      sessionId,
      source,
      result,
    );

    this.logger.log(
      JSON.stringify({
        stage: 'telemetry-ingress',
        action: 'telemetry-ingress.accepted',
        matchId,
        sessionId,
        sequence,
        source,
        ignored: result.ignored ?? false,
        reason: result.reason ?? null,
        players: envelope.players.length,
        teams: envelope.teams.length,
        events: envelope.events.length,
        hasZone: envelope.zone !== null,
      }),
    );
    this.logger.log(
      JSON.stringify({
        tag: '[PIPELINE][INGRESS ACCEPT]',
        stage: 'telemetry-ingress',
        outcome: 'accepted',
        matchId,
        sessionId,
        sequence,
        source,
        ignored: result.ignored ?? false,
        reason: result.reason ?? null,
        players: envelope.players.length,
        teams: envelope.teams.length,
        events: envelope.events.length,
        hasZone: envelope.zone !== null,
        stateSequence: result.state.sequence,
      }),
    );
    return {
      ok: true,
      ignored: result.ignored ?? false,
      reason: result.reason ?? null,
      matchId,
      state: mapStateToDto(this.broadcast.toLiveMatchState(result.state)),
    };
  }

  private stringValue(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private async maybeAutoConfirmFinishedMatch(
    matchId: string,
    sessionId: string,
    source: string | null,
    result: {
      state?: {
        status?: string | null;
        teamsAlive?: number | null;
        circle?: {
          phase?: number | null;
        } | null;
      } | null;
      ignored?: boolean;
    },
  ): Promise<void> {
    if (result.ignored === true) {
      return;
    }

    const state = result.state ?? null;
    const teamsAlive =
      typeof state?.teamsAlive === 'number' && Number.isFinite(state.teamsAlive)
        ? Math.trunc(state.teamsAlive)
        : null;
    if (state?.status !== 'LIVE' || teamsAlive !== 1) {
      return;
    }
    const phase =
      typeof state.circle?.phase === 'number' &&
      Number.isFinite(state.circle.phase)
        ? Math.trunc(state.circle.phase)
        : null;
    if (phase !== null && phase < 2) {
      this.logger.warn(
        JSON.stringify({
          tag: '[ELIMINATION][BLOCKED]',
          stage: 'telemetry-ingress',
          action: 'auto-finish-blocked-during-air-phase',
          matchId,
          sessionId,
          source,
          phase,
          teamsAlive,
          reason: 'EARLY_PHASE_NOT_CONCLUSION_ELIGIBLE',
        }),
      );
      return;
    }

    try {
      await this.matchControl.applyAuthoritativeMatchEnd(matchId, {
        sessionId,
        source: source ?? 'AUTO_TELEMETRY_FINISH_DETECTED',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        JSON.stringify({
          stage: 'telemetry-ingress',
          action: 'telemetry-ingress.auto-finish-deferred',
          matchId,
          sessionId,
          source,
          teamsAlive,
          reason: message,
        }),
      );
    }
  }

  private numberValue(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    }
    return null;
  }

  private healthValue(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(0, Math.min(100, value));
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed)
        ? Math.max(0, Math.min(100, parsed))
        : null;
    }
    return null;
  }

  private rawHealthValue(raw: unknown, depth = 0): number | null {
    const record = asRecord(raw);
    if (!record) {
      return null;
    }
    const direct =
      this.healthValue(record.health) ??
      this.healthValue(record.Health) ??
      this.healthValue(record.hp) ??
      this.healthValue(record.HP) ??
      this.healthValue(record.currentHealth) ??
      this.healthValue(record.CurrentHealth);
    if (direct !== null || depth >= 3) {
      return direct;
    }
    return this.rawHealthValue(record.raw, depth + 1);
  }

  private telemetryPlayerHealthValue(
    player: AdapterTelemetryPlayer,
  ): number | null {
    return this.healthValue(player.health) ?? this.rawHealthValue(player.raw);
  }

  private timestampValue(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? value.getTime() : null;
    }
    return null;
  }

  private readForbiddenRootFields(payload: unknown): string[] {
    const record = asRecord(payload);
    if (!record) {
      return [];
    }

    return Object.keys(record)
      .filter((key) =>
        FORBIDDEN_ENVELOPE_ROOT_FIELDS.has(normalizeFieldName(key)),
      )
      .sort((left, right) => left.localeCompare(right));
  }

  private readIngressCursor(
    metaJson: Prisma.JsonValue | null | undefined,
  ): TelemetryIngressCursor {
    const meta = asRecord(metaJson);
    const ingress = asRecord(meta?.telemetryIngress);
    return {
      sessionId: this.stringValue(ingress?.sessionId),
      lastAdapterSequence: this.numberValue(ingress?.lastAdapterSequence),
      updatedAt: this.timestampValue(ingress?.updatedAt),
    };
  }

  private shouldResetIngressCursor(params: {
    cursor: TelemetryIngressCursor;
    sessionId: string;
    sequence: number;
    timestamp: number;
  }): boolean {
    if (
      params.cursor.sessionId !== params.sessionId ||
      params.cursor.lastAdapterSequence === null ||
      params.sequence > params.cursor.lastAdapterSequence
    ) {
      return false;
    }

    const rewind = params.cursor.lastAdapterSequence - params.sequence;
    if (rewind < TELEMETRY_INGRESS_SEQUENCE_RESET_DELTA) {
      return false;
    }

    if (params.cursor.updatedAt === null) {
      return true;
    }

    return params.timestamp > params.cursor.updatedAt;
  }

  private async persistIngressCursor(
    matchId: string,
    params: {
      organizationId: string | null;
      state: string | null;
      sessionId: string;
      sequence: number;
    },
  ) {
    const current = await this.prisma.matchControlState.findUnique({
      where: { matchId },
      select: {
        state: true,
        organizationId: true,
        metaJson: true,
      },
    });
    const currentMeta = asRecord(current?.metaJson) ?? {};
    const organizationId =
      current?.organizationId ?? params.organizationId ?? null;
    if (!organizationId) {
      return;
    }

    const nextMeta = {
      ...currentMeta,
      telemetryIngress: {
        sessionId: params.sessionId,
        lastAdapterSequence: params.sequence,
        updatedAt: new Date().toISOString(),
      },
    };

    await this.prisma.matchControlState.upsert({
      where: { matchId },
      update: {
        metaJson: toJsonInput(nextMeta),
      },
      create: {
        matchId,
        organizationId,
        state: (current?.state ??
          params.state ??
          deriveControlStateFromMatchStatus(
            'LIVE',
          )) as Prisma.MatchControlStateUncheckedCreateInput['state'],
        reason: 'TELEMETRY_INGRESS_CURSOR',
        metaJson: toJsonInput(nextMeta),
      },
    });
  }

  private logRejected(params: {
    reason: string;
    matchId: string;
    sessionId: string | null;
    sequence: number | null;
    source: string | null;
  }) {
    this.logger.warn(
      JSON.stringify({
        tag: '[TELEMETRY][BLOCKED]',
        stage: 'telemetry-ingress',
        action: 'telemetry-ingress.rejected',
        matchId: params.matchId,
        sessionId: params.sessionId,
        sequence: params.sequence,
        source: params.source,
        reason: params.reason,
      }),
    );
    this.logger.log(
      JSON.stringify({
        tag: '[PIPELINE][INGRESS ACCEPT]',
        stage: 'telemetry-ingress',
        outcome: 'rejected',
        matchId: params.matchId,
        sessionId: params.sessionId,
        sequence: params.sequence,
        source: params.source,
        reason: params.reason,
      }),
    );
  }

  private sanitizeTelemetryEnvelopePlayers(
    envelope: AdapterTelemetryEnvelope,
    context: {
      matchId: string;
      sessionId: string | null;
      sequence: number | null;
      source: string | null;
      timestamp: number;
      phase: number | null;
    },
  ): {
    envelope: AdapterTelemetryEnvelope;
    stats: SanitizedEnvelopeStats;
  } {
    const rootPlayers = Array.isArray(envelope.players) ? envelope.players : [];
    const teams = Array.isArray(envelope.teams) ? envelope.teams : [];
    const rootPlayersBefore = rootPlayers.length;
    const teamPlayersBefore = teams.reduce(
      (count, team) => count + (team.players?.length ?? 0),
      0,
    );
    const seen = new Map<
      string,
      { players: AdapterTelemetryPlayer[]; index: number }
    >();
    let droppedPlayers = 0;

    const nextRootPlayers = this.dedupeTelemetryPlayers(
      rootPlayers,
      {
        ...context,
        location: 'root',
      },
      seen,
      () => {
        droppedPlayers += 1;
      },
    );

    const nextTeams = teams.map((team) => {
      const players = Array.isArray(team.players) ? team.players : [];
      const nextPlayers = this.dedupeTelemetryPlayers(
        players,
        {
          ...context,
          location: `team:${team.teamId ?? 'unknown'}`,
          teamId: team.teamId ?? null,
        },
        seen,
        () => {
          droppedPlayers += 1;
        },
      );
      return nextPlayers.length === players.length
        ? team
        : {
            ...team,
            players: nextPlayers,
          };
    });

    const rootPlayersAfter = nextRootPlayers.length;
    const teamPlayersAfter = nextTeams.reduce(
      (count, team) => count + (team.players?.length ?? 0),
      0,
    );

    const sanitizedEnvelope =
      rootPlayersAfter === rootPlayersBefore &&
      teamPlayersAfter === teamPlayersBefore
        ? envelope
        : {
            ...envelope,
            players: nextRootPlayers,
            teams: nextTeams,
          };

    return {
      envelope: sanitizedEnvelope,
      stats: {
        rootPlayersBefore,
        rootPlayersAfter,
        teamPlayersBefore,
        teamPlayersAfter,
        droppedPlayers,
      },
    };
  }

  private dedupeTelemetryPlayers(
    players: AdapterTelemetryPlayer[],
    context: {
      matchId: string;
      sessionId: string | null;
      sequence: number | null;
      source: string | null;
      location: string;
      teamId?: string | null;
      timestamp: number;
      phase: number | null;
    },
    seen: Map<string, { players: AdapterTelemetryPlayer[]; index: number }>,
    onDrop: () => void,
  ): AdapterTelemetryPlayer[] {
    const uniquePlayers: AdapterTelemetryPlayer[] = [];

    for (const player of players) {
      const canonicalPlayerIds = this.canonicalTelemetryPlayerIds(
        player,
        context.teamId ?? player.teamId ?? null,
      );
      if (canonicalPlayerIds.length === 0) {
        uniquePlayers.push(player);
        continue;
      }

      const existingEntry = canonicalPlayerIds
        .map((id) => seen.get(id))
        .find(
          (
            entry,
          ): entry is { players: AdapterTelemetryPlayer[]; index: number } =>
            Boolean(entry),
        );

      if (existingEntry) {
        onDrop();
        existingEntry.players[existingEntry.index] = this.mergeTelemetryPlayer(
          existingEntry.players[existingEntry.index],
          player,
          {
            ...context,
            canonicalPlayerId: canonicalPlayerIds[0] ?? null,
          },
        );
        for (const identifier of this.canonicalTelemetryPlayerIds(
          existingEntry.players[existingEntry.index],
          context.teamId ?? player.teamId ?? null,
        )) {
          seen.set(identifier, existingEntry);
        }
        continue;
      }

      const index = uniquePlayers.push(player) - 1;
      const entry = { players: uniquePlayers, index };
      for (const canonicalPlayerId of canonicalPlayerIds) {
        seen.set(canonicalPlayerId, entry);
      }
    }

    return uniquePlayers;
  }

  private mergeTelemetryPlayer(
    existing: AdapterTelemetryPlayer,
    incoming: AdapterTelemetryPlayer,
    context: {
      matchId: string;
      sessionId: string | null;
      sequence: number | null;
      source: string | null;
      location: string;
      teamId?: string | null;
      canonicalPlayerId: string | null;
      timestamp: number;
      phase: number | null;
    },
  ): AdapterTelemetryPlayer {
    const alive = this.mergeTelemetryLifeFlag(existing.alive, incoming.alive, {
      ...context,
      field: 'alive',
    });
    const eliminated = this.mergeTelemetryLifeFlag(
      existing.eliminated,
      incoming.eliminated,
      {
        ...context,
        field: 'eliminated',
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
        : existing.knocked === true || incoming.knocked === true;

    this.logger.debug(
      JSON.stringify({
        tag: '[PLAYER WRITE]',
        stage: 'telemetry-ingress',
        action: 'duplicate-adapter-player-merged',
        source: 'adapter',
        matchId: context.matchId,
        sessionId: context.sessionId,
        sequence: context.sequence,
        adapterSource: context.source,
        canonicalPlayerId: context.canonicalPlayerId,
        location: context.location,
        teamId: context.teamId ?? incoming.teamId ?? existing.teamId ?? null,
        timestamp: context.timestamp,
        phase: context.phase,
        alive: mergedAlive ?? null,
        eliminated:
          mergedAlive === true
            ? false
            : typeof eliminated === 'boolean'
              ? eliminated
              : null,
      }),
    );

    return {
      ...existing,
      ...incoming,
      playerId: incoming.playerId ?? existing.playerId ?? null,
      externalPlayerId:
        incoming.externalPlayerId ?? existing.externalPlayerId ?? null,
      pubgAccountId: incoming.pubgAccountId ?? existing.pubgAccountId ?? null,
      ign: incoming.ign ?? existing.ign ?? null,
      teamId: incoming.teamId ?? existing.teamId ?? context.teamId ?? null,
      alive: mergedAlive,
      knocked: mergedKnocked,
      eliminated:
        mergedAlive === true
          ? false
          : typeof eliminated === 'boolean'
            ? eliminated
            : (existing.eliminated ?? incoming.eliminated),
      kills:
        typeof incoming.kills === 'number' && Number.isFinite(incoming.kills)
          ? incoming.kills
          : existing.kills,
      assists:
        typeof incoming.assists === 'number' &&
        Number.isFinite(incoming.assists)
          ? incoming.assists
          : existing.assists,
      health:
        this.telemetryPlayerHealthValue(incoming) ??
        this.telemetryPlayerHealthValue(existing),
      position: incoming.position ?? existing.position ?? null,
      raw: this.mergeTelemetryRaw(existing.raw, incoming.raw),
    };
  }

  private mergeTelemetryLifeFlag(
    existing: boolean | undefined,
    incoming: boolean | undefined,
    context: {
      matchId: string;
      sessionId: string | null;
      sequence: number | null;
      source: string | null;
      location: string;
      teamId?: string | null;
      canonicalPlayerId: string | null;
      field: 'alive' | 'eliminated';
      timestamp: number;
      phase: number | null;
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

    const resolved = context.field === 'alive' ? true : false;
    this.logger.error(
      JSON.stringify({
        tag: '[CRITICAL][PLAYER STATE CONFLICT]',
        stage: 'telemetry-ingress',
        action: 'duplicate-adapter-player-conflict',
        source: 'adapter',
        matchId: context.matchId,
        sessionId: context.sessionId,
        sequence: context.sequence,
        adapterSource: context.source,
        canonicalPlayerId: context.canonicalPlayerId,
        location: context.location,
        teamId: context.teamId ?? null,
        phase: context.phase,
        timestamp: context.timestamp,
        field: context.field,
        previousValue: existing,
        incomingValue: incoming,
        resolvedValue: resolved,
        reason: 'DUPLICATE_ADAPTER_PLAYER_CONFLICTING_LIFE_FIELDS',
      }),
    );
    return resolved;
  }

  private mergeTelemetryRaw(
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

  private canonicalTelemetryPlayerIds(
    player: Pick<
      AdapterTelemetryPlayer,
      | 'playerId'
      | 'externalPlayerId'
      | 'pubgPlayerId'
      | 'pubgAccountId'
      | 'ign'
      | 'teamId'
    >,
    teamId: string | null,
  ): string[] {
    const identifiers = new Set<string>();
    for (const value of [
      this.stringValue(player.playerId),
      this.stringValue(player.externalPlayerId),
      this.stringValue(player.pubgPlayerId),
      this.stringValue(player.pubgAccountId),
    ]) {
      if (value) {
        identifiers.add(value);
      }
    }
    const normalizedTeamId = this.stringValue(teamId ?? player.teamId);
    const normalizedName = normalizeLookup(player.ign);
    if (normalizedTeamId && normalizedName) {
      identifiers.add(`team:${normalizedTeamId}:name:${normalizedName}`);
    }
    return [...identifiers];
  }
}
