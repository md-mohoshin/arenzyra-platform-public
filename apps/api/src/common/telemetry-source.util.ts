import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TelemetrySource } from '@prisma/client';
import { PrismaService } from '../db/prisma.service';
import { deriveControlStateFromMatchStatus } from './match-status.util';

const asRecord = (
  value: Prisma.JsonValue | null | undefined,
): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const toJsonValue = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;

const normalizeUpper = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toUpperCase() : '';
};

export const telemetrySourceGuardMatchSelect = {
  id: true,
  deletedAt: true,
  organizationId: true,
  status: true,
  liveState: true,
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
    select: {
      organizationId: true,
    },
  },
} satisfies Prisma.MatchSelect;

export type TelemetrySourceGuardMatch = Prisma.MatchGetPayload<{
  select: typeof telemetrySourceGuardMatchSelect;
}>;

export type TelemetrySourceLogger = Pick<Logger, 'warn' | 'log' | 'debug'>;

export class TelemetrySourceRejectedException extends ConflictException {
  readonly matchId: string;
  readonly incomingSource: TelemetrySource;
  readonly activeSource: TelemetrySource;
  readonly reason: 'SOURCE_MISMATCH';

  constructor(params: {
    matchId: string;
    incomingSource: TelemetrySource;
    activeSource: TelemetrySource;
    reason?: 'SOURCE_MISMATCH';
  }) {
    const reason = params.reason ?? 'SOURCE_MISMATCH';
    super('Telemetry source mismatch');
    this.matchId = params.matchId;
    this.incomingSource = params.incomingSource;
    this.activeSource = params.activeSource;
    this.reason = reason;
  }
}

export const normalizeTelemetrySource = (
  value: unknown,
): TelemetrySource | null => {
  const normalized = normalizeUpper(value);
  switch (normalized) {
    case TelemetrySource.AUTO:
      return TelemetrySource.AUTO;
    case TelemetrySource.LAUNCHER:
    case 'OBSERVER':
      return TelemetrySource.LAUNCHER;
    case TelemetrySource.PCOB:
    case 'PCOB_PUSH':
    case 'PCOB_API':
    case 'PUBGM-PCOB':
    case 'PUBGM_PCOB':
      return TelemetrySource.PCOB;
    case TelemetrySource.API:
      return TelemetrySource.API;
    case TelemetrySource.SHADOW:
    case 'SIMULATOR':
      return TelemetrySource.SHADOW;
    default:
      return null;
  }
};

export const requireTelemetrySource = (value: unknown): TelemetrySource => {
  const source = normalizeTelemetrySource(value);
  if (!source || source === TelemetrySource.AUTO) {
    throw new BadRequestException('Invalid telemetry source');
  }
  return source;
};

export const writeTelemetrySourceMeta = (
  metaJson: Prisma.JsonValue | null | undefined,
  telemetrySource: TelemetrySource,
): Record<string, unknown> => {
  const current = asRecord(metaJson) ?? {};
  return {
    ...current,
    telemetrySource,
  };
};

export const assertTelemetrySourceAllowed = (
  match: Pick<TelemetrySourceGuardMatch, 'id' | 'telemetrySource'>,
  incomingSourceInput: unknown,
) => {
  const incomingSource = requireTelemetrySource(incomingSourceInput);
  const activeSource =
    normalizeTelemetrySource(match.telemetrySource) ?? TelemetrySource.AUTO;

  if (activeSource === TelemetrySource.AUTO) {
    return {
      incomingSource,
      activeSource,
      shouldLock: true,
    } as const;
  }

  if (activeSource !== incomingSource) {
    throw new TelemetrySourceRejectedException({
      matchId: match.id,
      incomingSource,
      activeSource,
    });
  }

  return {
    incomingSource,
    activeSource,
    shouldLock: false,
  } as const;
};

export const isTelemetrySourceLocked = (
  value: unknown,
): value is TelemetrySource =>
  normalizeTelemetrySource(value) !== null &&
  normalizeTelemetrySource(value) !== TelemetrySource.AUTO;

export const loadTelemetrySourceGuardMatch = async (
  prisma: PrismaService,
  matchId: string,
): Promise<TelemetrySourceGuardMatch | null> =>
  prisma.match.findUnique({
    where: { id: matchId },
    select: telemetrySourceGuardMatchSelect,
  });

const rejectionMessage = (params: {
  matchId: string;
  incomingSource: TelemetrySource;
  activeSource: TelemetrySource;
  reason: string;
}) =>
  `[Telemetry] Rejected packet matchId=${params.matchId} incomingSource=${params.incomingSource} activeSource=${params.activeSource} reason=${params.reason}`;

const logTelemetrySourceRejection = (
  logger: TelemetrySourceLogger,
  error: TelemetrySourceRejectedException,
) => {
  logger.warn(
    JSON.stringify({
      stage: 'telemetry-source',
      action: 'telemetry-source.rejected',
      message: rejectionMessage({
        matchId: error.matchId,
        incomingSource: error.incomingSource,
        activeSource: error.activeSource,
        reason: error.reason,
      }),
      matchId: error.matchId,
      incomingSource: error.incomingSource,
      activeSource: error.activeSource,
      reason: error.reason,
    }),
  );
};

const persistTelemetrySourceMeta = async (
  prisma: PrismaService,
  match: TelemetrySourceGuardMatch,
  telemetrySource: TelemetrySource,
): Promise<TelemetrySourceGuardMatch> => {
  const currentMeta = asRecord(match.controlState?.metaJson) ?? {};
  const nextMeta = writeTelemetrySourceMeta(
    match.controlState?.metaJson ?? null,
    telemetrySource,
  );
  const nextMetaInput = toJsonValue(nextMeta);
  const nextMetaJson = nextMetaInput as Prisma.JsonValue;
  if (currentMeta.telemetrySource === telemetrySource) {
    return {
      ...match,
      controlState: match.controlState
        ? {
            ...match.controlState,
            metaJson: nextMetaJson,
          }
        : match.controlState,
    } as TelemetrySourceGuardMatch;
  }

  const organizationId =
    match.controlState?.organizationId ??
    match.organizationId ??
    match.tournament?.organizationId ??
    null;
  if (!organizationId) {
    return {
      ...match,
      controlState: match.controlState
        ? {
            ...match.controlState,
            metaJson: nextMetaJson,
          }
        : match.controlState,
    } as TelemetrySourceGuardMatch;
  }

  await prisma.matchControlState.upsert({
    where: { matchId: match.id },
    update: {
      metaJson: nextMetaInput,
    },
    create: {
      matchId: match.id,
      organizationId,
      state:
        match.controlState?.state ??
        deriveControlStateFromMatchStatus(match.status),
      reason: 'TELEMETRY_SOURCE_LOCK',
      metaJson: nextMetaInput,
    },
  });

  return {
    ...match,
    controlState: {
      state:
        match.controlState?.state ??
        deriveControlStateFromMatchStatus(match.status),
      organizationId,
      metaJson: nextMetaJson,
    },
  } as TelemetrySourceGuardMatch;
};

export const enforceTelemetrySourceAllowed = async (params: {
  prisma: PrismaService;
  logger: TelemetrySourceLogger;
  match?: TelemetrySourceGuardMatch | null;
  matchId?: string | null;
  incomingSource: unknown;
}) => {
  const incomingSource = requireTelemetrySource(params.incomingSource);
  const loadedMatch =
    params.match ??
    (params.matchId
      ? await loadTelemetrySourceGuardMatch(params.prisma, params.matchId)
      : null);

  if (!loadedMatch || loadedMatch.deletedAt) {
    throw new NotFoundException('Match not found');
  }

  let match: TelemetrySourceGuardMatch = loadedMatch;
  let lockedNow = false;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const decision = assertTelemetrySourceAllowed(match, incomingSource);
      if (!decision.shouldLock) {
        match = await persistTelemetrySourceMeta(
          params.prisma,
          match,
          decision.incomingSource,
        );
        return {
          match,
          activeSource: decision.incomingSource,
          lockedNow,
        };
      }

      const lockedAt = new Date();
      const lockResult = await params.prisma.match.updateMany({
        where: {
          id: match.id,
          deletedAt: null,
          telemetrySource: TelemetrySource.AUTO,
        },
        data: {
          telemetrySource: decision.incomingSource,
          telemetrySourceLockedAt: lockedAt,
        },
      });

      if (lockResult.count === 0) {
        const reloaded = await loadTelemetrySourceGuardMatch(
          params.prisma,
          match.id,
        );
        if (!reloaded || reloaded.deletedAt) {
          throw new NotFoundException('Match not found');
        }
        match = reloaded;
        continue;
      }

      match = {
        ...match,
        telemetrySource: decision.incomingSource,
        telemetrySourceLockedAt: lockedAt,
      };
      lockedNow = true;
      match = await persistTelemetrySourceMeta(
        params.prisma,
        match,
        decision.incomingSource,
      );
      params.logger.log(
        JSON.stringify({
          stage: 'telemetry-source',
          action: 'telemetry-source.locked',
          matchId: match.id,
          activeSource: decision.incomingSource,
          lockedAt: lockedAt.toISOString(),
        }),
      );
      return {
        match,
        activeSource: decision.incomingSource,
        lockedNow,
      };
    } catch (error) {
      if (error instanceof TelemetrySourceRejectedException) {
        logTelemetrySourceRejection(params.logger, error);
      }
      throw error;
    }
  }

  const finalDecision = assertTelemetrySourceAllowed(match, incomingSource);
  if (finalDecision.shouldLock) {
    throw new ConflictException('Telemetry source lock race detected');
  }
  match = await persistTelemetrySourceMeta(
    params.prisma,
    match,
    finalDecision.incomingSource,
  );
  return {
    match,
    activeSource: finalDecision.incomingSource,
    lockedNow,
  };
};
