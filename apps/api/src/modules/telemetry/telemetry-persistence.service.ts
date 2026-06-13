import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, TelemetryAuthorityMode } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import {
  hasManualOverride,
  readLiveSyncContract,
  writeLiveSyncContract,
} from '../../common/live-sync-contract.util';
import type { TelemetryMatchState } from './telemetry.types';
import {
  deriveControlStateFromMatchStatus,
  isMatchFinalizingStatus,
  isMatchFinishedStatus,
} from '../../common/match-status.util';
import {
  TELEMETRY_RUNTIME_ACCEPTED_WINDOW_MS,
  writeTelemetryRuntimeMeta,
} from '../../common/telemetry-runtime-contract.util';
import { canonicalizeTelemetryRuntimeSource } from '../../common/telemetry-source.util';

const asJsonRecord = (
  value: Prisma.JsonValue | null | undefined,
): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const toJsonValue = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;

const toPersistedAuthorityMode = (
  mode: TelemetryMatchState['mode'],
): TelemetryAuthorityMode =>
  mode === 'MANUAL'
    ? TelemetryAuthorityMode.MANUAL
    : TelemetryAuthorityMode.AUTO;

@Injectable()
export class TelemetryPersistenceService {
  private readonly logger = new Logger(TelemetryPersistenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async persistState(state: TelemetryMatchState) {
    await this.prisma.$transaction(async (tx) => {
      const match = await tx.match.findUnique({
        where: { id: state.matchId },
        select: {
          id: true,
          organizationId: true,
          status: true,
          controlState: {
            select: {
              state: true,
              metaJson: true,
            },
          },
        },
      });
      if (!match) {
        throw new NotFoundException('Match not found');
      }

      const winnerTeamId = this.resolveWinnerTeamId(state);
      const currentMeta = asJsonRecord(match.controlState?.metaJson) ?? {};
      const currentSync = readLiveSyncContract(currentMeta);
      const nextSync = {
        ...currentSync,
        version: Math.max(currentSync.version, state.version ?? 0),
        updatedAt: state.updatedAt,
        overrides: {
          players: { ...currentSync.overrides.players },
          teams: { ...currentSync.overrides.teams },
        },
        auditTrail: [...currentSync.auditTrail],
      };

      for (const [playerId, player] of Object.entries(state.players)) {
        if (hasManualOverride(player.ownership?.alive)) {
          nextSync.overrides.players[playerId] = {
            ...(nextSync.overrides.players[playerId] ?? {}),
            alive: player.ownership?.alive,
          };
        }
        if (hasManualOverride(player.ownership?.knocked)) {
          nextSync.overrides.players[playerId] = {
            ...(nextSync.overrides.players[playerId] ?? {}),
            knocked: player.ownership?.knocked,
          };
        }
        if (hasManualOverride(player.ownership?.kills)) {
          nextSync.overrides.players[playerId] = {
            ...(nextSync.overrides.players[playerId] ?? {}),
            kills: player.ownership?.kills,
          };
        }
      }

      for (const [teamId, team] of Object.entries(state.teams)) {
        if (hasManualOverride(team.ownership?.eliminated)) {
          nextSync.overrides.teams[teamId] = {
            ...(nextSync.overrides.teams[teamId] ?? {}),
            eliminated: team.ownership?.eliminated,
          };
        }
        if (hasManualOverride(team.ownership?.placement)) {
          nextSync.overrides.teams[teamId] = {
            ...(nextSync.overrides.teams[teamId] ?? {}),
            placement: team.ownership?.placement,
          };
        }
        if (hasManualOverride(team.ownership?.totalKills)) {
          nextSync.overrides.teams[teamId] = {
            ...(nextSync.overrides.teams[teamId] ?? {}),
            totalKills: team.ownership?.totalKills,
          };
        }
      }

      const nextMeta: Record<string, unknown> = {
        ...currentMeta,
        winnerTeamId,
        telemetrySequence: state.sequence,
        telemetryUpdatedAt: state.updatedAt,
      };
      nextMeta.liveSync = writeLiveSyncContract(currentMeta, nextSync).liveSync;
      const nextControlState =
        match.controlState?.state &&
        !isMatchFinalizingStatus(match.status) &&
        !isMatchFinishedStatus(match.status)
          ? match.controlState.state
          : deriveControlStateFromMatchStatus(match.status);

      await tx.matchControlState.upsert({
        where: { matchId: state.matchId },
        update: {
          state: nextControlState as never,
          authorityMode: toPersistedAuthorityMode(state.mode),
          reason: 'TELEMETRY_ENGINE_SYNC',
          metaJson: toJsonValue(nextMeta),
        },
        create: {
          matchId: state.matchId,
          organizationId: match.organizationId,
          state: nextControlState as never,
          authorityMode: toPersistedAuthorityMode(state.mode),
          reason: 'TELEMETRY_ENGINE_SYNC',
          metaJson: toJsonValue(nextMeta),
        },
      });

      // Passive compatibility mirror for standings/widgets readers.
      // Engine memory + control state remain authoritative for live telemetry.
      await this.persistCompatibilitySnapshot(tx, state);
    });
  }

  async markTelemetryAccepted(
    matchId: string,
    params: {
      source?: string | null;
      sequence?: number | null;
      acceptedAt?: Date | number | string | null;
    } = {},
  ) {
    const acceptedAt = this.normalizeTimestamp(params.acceptedAt ?? new Date());
    const acceptedSource = canonicalizeTelemetryRuntimeSource(params.source);
    if (!acceptedAt) {
      return;
    }

    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        organizationId: true,
        status: true,
        controlState: {
          select: {
            state: true,
            metaJson: true,
            organizationId: true,
          },
        },
      },
    });
    if (!match) {
      throw new NotFoundException('Match not found');
    }

    const currentMeta = match.controlState?.metaJson ?? null;
    const telemetryRuntime = asJsonRecord(
      asJsonRecord(currentMeta)?.telemetryRuntime as
        | Prisma.JsonValue
        | undefined,
    );
    const previousAcceptedAt = this.normalizeTimestamp(
      telemetryRuntime?.lastAcceptedAt as
        | string
        | number
        | Date
        | null
        | undefined,
    );
    const previousAcceptedFresh =
      previousAcceptedAt !== null &&
      Date.parse(acceptedAt) - Date.parse(previousAcceptedAt) <=
        TELEMETRY_RUNTIME_ACCEPTED_WINDOW_MS;

    const nextMeta = writeTelemetryRuntimeMeta(currentMeta, {
      lastTransportAt: acceptedAt,
      lastPacketAt: acceptedAt,
      lastTransportSource: acceptedSource,
      lastAcceptedAt: acceptedAt,
      lastAcceptedSource: acceptedSource,
      lastAcceptedSequence: params.sequence ?? null,
      lastIgnoredAt: null,
      lastIgnoredReason: null,
    });
    const organizationId =
      match.organizationId ?? match.controlState?.organizationId ?? null;
    if (!organizationId) {
      throw new NotFoundException('Match organization not found');
    }

    await this.prisma.matchControlState.upsert({
      where: { matchId },
      update: {
        metaJson: toJsonValue(nextMeta),
      },
      create: {
        matchId,
        organizationId,
        state: (match.controlState?.state ??
          deriveControlStateFromMatchStatus(match.status)) as never,
        reason: 'TELEMETRY_RUNTIME_ACCEPTED',
        metaJson: toJsonValue(nextMeta),
      },
    });

    if (!previousAcceptedFresh) {
      this.logger.log(
        JSON.stringify({
          stage: 'telemetry-runtime-contract',
          action: 'telemetry-accepted-transition',
          matchId,
          acceptedAt,
          source: acceptedSource,
          sequence: params.sequence ?? null,
        }),
      );
    }
  }

  private normalizeTimestamp(
    value: Date | number | string | null | undefined,
  ): string | null {
    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? value.toISOString() : null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return new Date(value).toISOString();
    }
    if (typeof value !== 'string' || !value.trim()) {
      return null;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }

  private resolveWinnerTeamId(state: TelemetryMatchState): string | null {
    return (
      Object.values(state.teams).find(
        (team) => team.placement === 1 || team.alivePlayers > 0,
      )?.teamId ?? null
    );
  }

  private async persistCompatibilitySnapshot(
    tx: Prisma.TransactionClient,
    state: TelemetryMatchState,
  ) {
    await tx.matchStateSnapshot.upsert({
      where: { matchId: state.matchId },
      update: {
        stateJson: toJsonValue(state),
      },
      create: {
        matchId: state.matchId,
        stateJson: toJsonValue(state),
      },
    });
  }
}
