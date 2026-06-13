import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Public } from '../../common/auth/public.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import { requireMatchOrganization } from '../../common/org/org.util';
import { PrismaService } from '../../db/prisma.service';
import { MatchControlStateStore } from '../match-control/state.store';
import { mapStateToDto } from '../../realtime/live-match-state.dto';
import { readLiveSyncContract } from '../../common/live-sync-contract.util';
import { TelemetryEngineService } from './telemetry-engine.service';
import { TelemetryBroadcastService } from './telemetry-broadcast.service';
import { ControlCommandDto } from './dto/control-command.dto';
import { SetTelemetryModeDto } from './dto/set-telemetry-mode.dto';
import type { ControlCommand } from './telemetry.types';
import type { LiveMatchState } from '../match-control/state.store';
import { sanitizeTelemetryPromotionDiagnostics } from './telemetry-promotion-diagnostics.util';

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

@Controller('api')
export class TelemetryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stateStore: MatchControlStateStore,
    private readonly engine: TelemetryEngineService,
    private readonly broadcast: TelemetryBroadcastService,
  ) {}

  private hasFreshPlayerTelemetry(state: LiveMatchState | null | undefined) {
    return (
      state?.teams?.some((team) =>
        (team.players ?? []).some(
          (player) => player.lifeTelemetryFresh === true,
        ),
      ) ?? false
    );
  }

  private requiresConfirmedTelemetry(state: LiveMatchState | null | undefined) {
    return state?.status === 'LIVE' || state?.status === 'FINISH_PENDING';
  }

  @Get('matches/:matchId/state')
  @Public()
  async getMatchState(@Param('matchId') matchId: string) {
    const controlState = await this.prisma.matchControlState.findUnique({
      where: { matchId },
      select: { metaJson: true },
    });
    const expectedVersion = readLiveSyncContract(
      controlState?.metaJson ?? null,
    ).version;
    const stored = await this.stateStore.get(matchId);
    const storedIsCurrent =
      stored !== null &&
      stored !== undefined &&
      stored.version >= expectedVersion;
    if (
      storedIsCurrent &&
      (!this.requiresConfirmedTelemetry(stored) ||
        this.hasFreshPlayerTelemetry(stored))
    ) {
      return mapStateToDto(stored);
    }

    const state = await this.engine.getState(matchId);
    const liveState = this.broadcast.toLiveMatchState(state);
    if (
      stored &&
      stored.version > liveState.version &&
      (!this.requiresConfirmedTelemetry(stored) ||
        this.hasFreshPlayerTelemetry(stored))
    ) {
      return mapStateToDto(stored);
    }
    return mapStateToDto(liveState);
  }

  @Get('matches/:matchId/telemetry-diagnostics')
  @UseGuards(JwtAuthGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
  async getTelemetryDiagnostics(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await requireMatchOrganization(this.prisma, matchId, { actor: req.user });
    const controlState = await this.prisma.matchControlState.findUnique({
      where: { matchId },
      select: { metaJson: true },
    });
    const telemetryState = await this.engine.getState(matchId);
    const liveState = this.broadcast.toLiveMatchState(telemetryState);
    const controlMeta = asRecord(controlState?.metaJson);
    return this.buildCanonicalDiagnostics(
      telemetryState,
      liveState,
      sanitizeTelemetryPromotionDiagnostics(
        controlMeta?.telemetryPromotionDiagnostics ?? null,
      ),
    );
  }

  @Post('match/command')
  @UseGuards(JwtAuthGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
  async executeCommand(
    @Body() body: ControlCommandDto,
    @Req() req: AuthenticatedRequest,
  ) {
    await requireMatchOrganization(this.prisma, body.matchId, {
      actor: req.user,
    });
    const result = await this.engine.applyCommand(
      this.toControlCommand(body),
      req.user,
    );
    return {
      ok: true,
      matchId: body.matchId,
      state: mapStateToDto(this.broadcast.toLiveMatchState(result.state)),
    };
  }

  @Post('matches/:matchId/mode')
  @UseGuards(JwtAuthGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
  async setMode(
    @Param('matchId') matchId: string,
    @Body() body: SetTelemetryModeDto,
    @Req() req: AuthenticatedRequest,
  ) {
    await requireMatchOrganization(this.prisma, matchId, { actor: req.user });
    const state = await this.engine.setMode(matchId, body.mode);
    return {
      ok: true,
      matchId,
      mode: state.mode,
      state: mapStateToDto(this.broadcast.toLiveMatchState(state)),
    };
  }

  private toControlCommand(body: ControlCommandDto): ControlCommand {
    switch (body.type) {
      case 'START_MATCH':
        return {
          type: body.type,
          matchId: body.matchId,
          timestamp: body.timestamp,
          source: body.source ?? 'MANUAL',
        };
      case 'END_MATCH':
        return {
          type: body.type,
          matchId: body.matchId,
          timestamp: body.timestamp,
          source: body.source ?? 'MANUAL',
        };
      default:
        throw new Error('Unsupported command');
    }
  }

  private buildCanonicalDiagnostics(
    telemetryState: Awaited<ReturnType<TelemetryEngineService['getState']>>,
    liveState: LiveMatchState,
    promotionDiagnostics: unknown = null,
  ) {
    const ranking = [...(liveState.teams ?? [])].map((team, index) => {
      const eliminated = (team.alivePlayers ?? 0) === 0;
      return {
        rank: index + 1,
        teamId: team.teamId,
        slot: team.slot ?? null,
        teamName: team.name ?? team.tag ?? team.teamId,
        teamTag: team.tag ?? null,
        kills: team.kills ?? 0,
        alivePlayers: team.alivePlayers ?? 0,
        totalPlayers: team.totalPlayers ?? team.players?.length ?? 0,
        eliminated,
        placement: team.placement ?? null,
      };
    });

    const teamSummaries = (liveState.teams ?? []).map((team) => {
      const players = team.players ?? [];
      const eliminated = (team.alivePlayers ?? 0) === 0;
      return {
        teamId: team.teamId,
        slot: team.slot ?? null,
        teamName: team.name ?? team.tag ?? team.teamId,
        teamTag: team.tag ?? null,
        kills: team.kills ?? 0,
        placement: team.placement ?? null,
        alivePlayers: team.alivePlayers ?? 0,
        totalPlayers: team.totalPlayers ?? players.length,
        knockedPlayers: players.filter((player) => player.knocked === true)
          .length,
        eliminatedPlayers: players.filter((player) => player.alive === false)
          .length,
        eliminated,
        players: players.map((player) => ({
          playerId:
            player.playerId ??
            player.id ??
            player.externalPlayerId ??
            player.pubgPlayerId ??
            null,
          name: player.name ?? player.ign ?? null,
          alive: player.alive === true,
          knocked: player.knocked === true,
          eliminated: player.alive === false,
          kills: player.kills ?? 0,
        })),
      };
    });

    return {
      source: 'CANONICAL_TELEMETRY',
      matchId: telemetryState.matchId,
      lifecycle: {
        status: telemetryState.status,
        mode: telemetryState.mode,
        version: telemetryState.version,
        sequence: telemetryState.sequence,
        updatedAt: new Date(telemetryState.updatedAt).toISOString(),
        startedAt: telemetryState.startedAt
          ? new Date(telemetryState.startedAt).toISOString()
          : null,
        endedAt: telemetryState.endedAt
          ? new Date(telemetryState.endedAt).toISOString()
          : null,
        teamsAlive: telemetryState.teamsAlive,
      },
      promotionDiagnostics: promotionDiagnostics ?? null,
      liveSummary: liveState.summary ?? null,
      teams: teamSummaries,
      killFeed: {
        count: telemetryState.killFeed?.length ?? 0,
        latest: (telemetryState.killFeed ?? []).slice(-10).map((item) => ({
          id: item.id,
          ts: new Date(item.ts).toISOString(),
          killerTeamId: item.killerTeamId ?? null,
          killerPlayerId: item.killerPlayerId ?? null,
          killerName: item.killerName ?? null,
          victimTeamId: item.victimTeamId ?? null,
          victimPlayerId: item.victimPlayerId ?? null,
          victimName: item.victimName ?? null,
          weapon: item.weapon ?? null,
        })),
      },
      circle: telemetryState.circle ?? null,
      ranking,
      recentEvents: (telemetryState.events ?? []).slice(-20).map((event) => ({
        id: event.id,
        type: event.type,
        ts: new Date(event.ts).toISOString(),
        teamId: event.teamId ?? null,
        playerId: event.playerId ?? null,
      })),
    };
  }
}
