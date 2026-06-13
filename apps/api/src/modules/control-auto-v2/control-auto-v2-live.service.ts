import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth.types';
import { requireMatchOrganization } from '../../common/org/org.util';
import { PrismaService } from '../../db/prisma.service';
import {
  MatchControlStateStore,
  type LiveMatchState,
  type MatchStatePlayer,
  type TeamScoreState,
} from '../match-control/state.store';
import type { ControlAutoV2LiveResponseDto } from './control-auto-v2.dto';

const normalizeCount = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.floor(value));
};

const hasPlayerTelemetry = (player: MatchStatePlayer): boolean =>
  player.lifeTelemetryFresh === true || Boolean(player.position);

const hasTeamTelemetry = (team: TeamScoreState): boolean => {
  if (team.hasTelemetryPresence === true) {
    return true;
  }
  return (team.players ?? []).some((player) => hasPlayerTelemetry(player));
};

const hasLiveTelemetry = (state: LiveMatchState | null): boolean => {
  if (!state) {
    return false;
  }

  if (state.circle || state.observedPlayer) {
    return true;
  }

  if ((state.killFeed?.length ?? 0) > 0 || (state.events?.length ?? 0) > 0) {
    return true;
  }

  return state.teams.some((team) => hasTeamTelemetry(team));
};

@Injectable()
export class ControlAutoV2LiveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stateStore: MatchControlStateStore,
  ) {}

  async getLive(
    actor: AuthUser,
    matchId: string,
  ): Promise<ControlAutoV2LiveResponseDto> {
    await requireMatchOrganization(this.prisma, matchId, { actor });

    const state = await this.stateStore.get(matchId);
    if (!hasLiveTelemetry(state)) {
      return {
        telemetryStatus: 'waiting',
        phase: null,
        aliveTeams: null,
        alivePlayers: null,
        teams: [],
        players: [],
      };
    }

    const teams =
      state?.teams.map((team) => ({
        teamId: team.teamId,
        name: team.name,
        tag: team.tag,
        slot: team.slot ?? null,
        alivePlayers: normalizeCount(team.alivePlayers),
        totalPlayers: normalizeCount(team.totalPlayers),
        kills: Math.max(0, team.kills ?? 0),
        placement: team.placement ?? null,
        players: (team.players ?? []).map((player) => ({
          id: player.id ?? null,
          playerId: player.playerId ?? null,
          teamId: player.teamId ?? team.teamId,
          name: player.name ?? null,
          ign: player.ign ?? null,
          alive: player.alive === true,
          knocked: player.knocked === true,
          kills: Math.max(0, player.kills ?? 0),
        })),
      })) ?? [];

    const players = teams.flatMap((team) => team.players);
    const phase =
      typeof state?.circle?.phase === 'number' &&
      Number.isFinite(state.circle.phase)
        ? Math.trunc(state.circle.phase)
        : null;
    const aliveTeams =
      normalizeCount(state?.summary?.aliveTeams) ??
      teams.reduce(
        (count, team) => ((team.alivePlayers ?? 0) > 0 ? count + 1 : count),
        0,
      );
    const alivePlayers =
      normalizeCount(state?.summary?.alivePlayers) ??
      teams.reduce((count, team) => count + (team.alivePlayers ?? 0), 0);

    return {
      telemetryStatus: 'live',
      phase,
      aliveTeams,
      alivePlayers,
      teams,
      players,
    };
  }
}
