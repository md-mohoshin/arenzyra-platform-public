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
import type { AdapterTelemetryEnvelope } from '../game-adapters/game-adapter.types';
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
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const normalizeFieldName = (value: string): string =>
  value.replace(/[^a-z0-9]/gi, '').toLowerCase();

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

    this.logger.debug(
      JSON.stringify({
        tag: '[telemetry][packet-received]',
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
          tag: '[telemetry][packet-rejected]',
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

    await enforceTelemetrySourceAllowed({
      prisma: this.prisma,
      logger: this.logger,
      match: match as TelemetrySourceGuardMatch,
      incomingSource: source,
    });

    const envelope =
      matchId === payload.matchId ? payload : { ...payload, matchId };
    const result = await this.engine.applyAdapterTelemetryEnvelope(
      envelope,
      source,
    );

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
    };
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
        tag: '[telemetry][packet-rejected]',
        stage: 'telemetry-ingress',
        action: 'telemetry-ingress.rejected',
        matchId: params.matchId,
        sessionId: params.sessionId,
        sequence: params.sequence,
        source: params.source,
        reason: params.reason,
      }),
    );
  }
}
