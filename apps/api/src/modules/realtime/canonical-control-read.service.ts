import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MatchStatus, Role } from '@prisma/client';
import { resolveTeamBranding } from '../../common/team-branding.util';
import { PrismaService } from '../../db/prisma.service';
import { MatchControlService } from '../match-control/match-control.service';
import {
  MatchControlStateStore,
  type LiveMatchState,
  type MatchStatePlayer,
  type TeamScoreState,
} from '../match-control/state.store';
import type { Actor } from '../matches/matches.service';
import type {
  LiveStatePlayer,
  LiveStateTeam,
  MatchLiveStatePayload,
  MatchPhaseSnapshot,
} from './match-live-state.types';

type MatchMeta = {
  id: string;
  tournamentId: string | null;
  groupId: string | null;
  status: MatchStatus | null;
  tournament: { status: string | null } | null;
};

export type PcobMirrorPayload = {
  teamAlive: Record<string, boolean>;
  playerAlive: Record<string, boolean>;
  playerKnocked: Record<string, boolean>;
};

type CanonicalReadOptions = {
  actor?: Actor | null;
  preferCached?: boolean;
};

const SYSTEM_ACTOR: Actor = {
  id: 'system',
  actorId: 'system',
  role: Role.SUPER_ADMIN,
  actorRole: Role.SUPER_ADMIN,
  organizationId: null,
  actingOrgId: null,
};

@Injectable()
export class CanonicalControlReadService {
  private readonly logger = new Logger(CanonicalControlReadService.name);
  private readonly loggedReads = new Set<string>();
  private readonly lastWinnerByMatch = new Map<string, LiveStateTeam | null>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly matchControl: MatchControlService,
    private readonly controlStateStore: MatchControlStateStore,
  ) {}

  async getStateSnapshot(
    matchId: string,
    opts: CanonicalReadOptions = {},
  ): Promise<LiveMatchState> {
    this.logRead('state', matchId);
    return (await this.loadCanonicalState(matchId, opts)).state;
  }

  async getMatchState(
    matchId: string,
    opts: CanonicalReadOptions = {},
  ): Promise<MatchLiveStatePayload> {
    this.logRead('live-state', matchId);
    const { match, state } = await this.loadCanonicalState(matchId, opts);
    return this.toPayload(match, state);
  }

  async getMatchPhase(
    matchId: string,
    opts: CanonicalReadOptions = {},
  ): Promise<MatchPhaseSnapshot> {
    this.logRead('phase', matchId);
    const payload = await this.getMatchState(matchId, opts);
    const aliveTeams = payload.teams.filter(
      (team) => this.resolveAlivePlayers(team) > 0,
    );
    const statusFinished =
      payload.matchStatus === MatchStatus.FINISHED ||
      payload.matchStatus === MatchStatus.ENDED;

    const winnerFromPlacement =
      payload.teams.find((team) => team.placement === 1) ?? null;
    const winnerFromAlive = aliveTeams.length === 1 ? aliveTeams[0] : null;
    const winner =
      winnerFromPlacement ??
      winnerFromAlive ??
      (aliveTeams.length === 0
        ? (this.lastWinnerByMatch.get(matchId) ?? null)
        : null);

    if (winner) {
      this.lastWinnerByMatch.set(matchId, this.normalizeWinner(winner));
    }

    const phase =
      statusFinished || aliveTeams.length <= 1 ? 'POST_MATCH' : 'LIVE';

    return {
      phase,
      aliveTeams: aliveTeams.length,
      isFinished: phase === 'POST_MATCH',
      winnerTeamId: winner?.teamId ?? null,
      winner: winner ? this.normalizeWinner(winner) : null,
    };
  }

  async resolveLiveMatchForOrg(organizationId: string) {
    this.logRead('resolve-live-match', null, organizationId);
    return this.prisma.match.findFirst({
      where: {
        organizationId,
        deletedAt: null,
        status: MatchStatus.LIVE,
      },
      orderBy: [
        { liveAt: 'desc' },
        { startedAt: 'desc' },
        { updatedAt: 'desc' },
      ],
      select: {
        id: true,
        tournamentId: true,
        groupId: true,
        status: true,
        organizationId: true,
        updatedAt: true,
      },
    });
  }

  async getPcobMirror(
    matchId: string,
    opts: CanonicalReadOptions = {},
  ): Promise<PcobMirrorPayload> {
    this.logRead('pcob-mirror', matchId);
    const state = await this.getStateSnapshot(matchId, opts);
    const mirror: PcobMirrorPayload = {
      teamAlive: {},
      playerAlive: {},
      playerKnocked: {},
    };

    for (const team of state.teams ?? []) {
      if (team.teamId) {
        mirror.teamAlive[team.teamId] =
          (team.alivePlayers ?? this.countAlivePlayers(team.players ?? [])) > 0;
      }

      for (const player of team.players ?? []) {
        this.setPlayerState(mirror.playerAlive, player, player.alive === true);
        this.setPlayerState(
          mirror.playerKnocked,
          player,
          player.knocked === true,
        );
      }
    }

    return mirror;
  }

  resolvePlayerAlive(
    state: LiveMatchState,
    identifiers: {
      playerId?: string | null;
      externalPlayerId?: string | null;
      pubgPlayerId?: string | null;
      playerOpenId?: string | null;
    },
  ): boolean | null {
    const candidates = new Set(
      [
        identifiers.playerId,
        identifiers.externalPlayerId,
        identifiers.pubgPlayerId,
        identifiers.playerOpenId,
      ]
        .map((value) => this.normalize(value))
        .filter((value): value is string => Boolean(value)),
    );
    if (candidates.size === 0) {
      return null;
    }

    for (const team of state.teams ?? []) {
      for (const player of team.players ?? []) {
        const playerKeys = new Set(
          [
            player.playerId,
            player.id,
            player.externalPlayerId,
            player.pubgPlayerId,
          ]
            .map((value) => this.normalize(value))
            .filter((value): value is string => Boolean(value)),
        );
        for (const candidate of candidates) {
          if (playerKeys.has(candidate)) {
            return player.alive === true;
          }
        }
      }
    }

    return null;
  }

  private async loadCanonicalState(
    matchId: string,
    opts: CanonicalReadOptions,
  ): Promise<{ match: MatchMeta; state: LiveMatchState }> {
    const match = await this.loadMatch(matchId);
    let state: LiveMatchState | null = null;
    if (!opts.actor && opts.preferCached !== false) {
      state = await this.controlStateStore.get(matchId);
    }
    if (!state || (state.teams?.length ?? 0) === 0) {
      state = await this.matchControl.getState(
        opts.actor ?? SYSTEM_ACTOR,
        matchId,
      );
    }
    return {
      match,
      state: this.stripUnconfirmedLiveRosterState(match, state),
    };
  }

  private stripUnconfirmedLiveRosterState(
    match: MatchMeta,
    state: LiveMatchState,
  ): LiveMatchState {
    const isLive =
      match.status === MatchStatus.LIVE ||
      state.status === 'LIVE' ||
      state.status === 'FINISH_PENDING';
    if (!isLive || !Array.isArray(state.teams) || state.teams.length === 0) {
      return state;
    }

    let changed = false;
    const teams = state.teams.map((team) => {
      if (!this.isUnconfirmedLiveRosterTeam(team)) {
        return team;
      }
      changed = true;
      return {
        ...team,
        alivePlayers: null,
        totalPlayers: null,
        alive: undefined,
        eliminated: undefined,
        presenceStatus: team.presenceStatus ?? 'UNRESOLVED',
        players: [],
      };
    });

    if (!changed) {
      return state;
    }

    return {
      ...state,
      teams,
      summary: this.summarizeSanitizedLiveState(teams, state.summary),
    };
  }

  private isUnconfirmedLiveRosterTeam(team: TeamScoreState): boolean {
    const explicitNoShow =
      team.wasPresentInMatch === false || team.presenceStatus === 'NO_SHOW';
    if (explicitNoShow) {
      return true;
    }

    if (
      team.wasPresentInMatch === true ||
      team.presenceStatus === 'ACTIVE' ||
      team.hasTelemetryPresence === true
    ) {
      return false;
    }

    const hasTeamScoreSignal =
      (typeof team.kills === 'number' && team.kills > 0) ||
      (typeof team.placement === 'number' && Number.isFinite(team.placement)) ||
      (typeof team.points === 'number' && team.points > 0);
    if (hasTeamScoreSignal) {
      return false;
    }

    const hasPlayerTelemetrySignal = (team.players ?? []).some(
      (player) =>
        player.lifeTelemetryFresh === true ||
        Boolean(player.position) ||
        (typeof player.kills === 'number' && player.kills > 0),
    );
    return !hasPlayerTelemetrySignal;
  }

  private summarizeSanitizedLiveState(
    teams: TeamScoreState[],
    fallback?: LiveMatchState['summary'] | null,
  ): LiveMatchState['summary'] {
    const totalTeams = Math.max(0, fallback?.totalTeams ?? teams.length);
    const totalPlayers = teams.reduce(
      (sum, team) => sum + Math.max(0, team.totalPlayers ?? 0),
      0,
    );
    const alivePlayers = teams.reduce(
      (sum, team) => sum + Math.max(0, team.alivePlayers ?? 0),
      0,
    );
    const aliveTeams = teams.reduce(
      (sum, team) => sum + ((team.alivePlayers ?? 0) > 0 ? 1 : 0),
      0,
    );
    const winnerTeam =
      teams.find((team) => team.placement === 1) ??
      (aliveTeams === 1
        ? (teams.find((team) => (team.alivePlayers ?? 0) > 0) ?? null)
        : null);

    return {
      totalTeams,
      aliveTeams,
      totalPlayers,
      alivePlayers,
      winnerTeamId: winnerTeam?.teamId ?? null,
      winnerSlot: winnerTeam?.slot ?? null,
    };
  }

  private async loadMatch(matchId: string): Promise<MatchMeta> {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        id: true,
        tournamentId: true,
        groupId: true,
        status: true,
        tournament: { select: { status: true } },
      },
    });
    if (!match) {
      throw new NotFoundException('Match not found');
    }
    if (match.tournament?.status === 'ARCHIVED') {
      throw new BadRequestException('Tournament is archived');
    }
    return match;
  }

  private toPayload(
    match: MatchMeta,
    state: LiveMatchState,
  ): MatchLiveStatePayload {
    return {
      matchId: match.id,
      tournamentId: match.tournamentId ?? null,
      groupId: match.groupId ?? null,
      matchStatus: this.toBusinessStatus(state.status, match.status ?? null),
      tournamentStatus: match.tournament?.status ?? null,
      teams: state.teams.map((team, index) =>
        this.toLiveStateTeam(match.id, team, index, state.teams),
      ),
    };
  }

  private toLiveStateTeam(
    matchId: string,
    team: TeamScoreState,
    index: number,
    teams: TeamScoreState[],
  ): LiveStateTeam {
    const branding = resolveTeamBranding(team.teamId, teams);
    const players = (team.players ?? []).map((player, playerIndex) =>
      this.toLiveStatePlayer(team.teamId, player, playerIndex),
    );

    return {
      slotResultId:
        team.slot !== null && team.slot !== undefined
          ? `live:${matchId}:${team.slot}`
          : `live:${matchId}:${team.teamId}:${index + 1}`,
      teamId: team.teamId,
      teamName: team.name ?? team.tag ?? branding.name,
      teamTag: team.tag ?? branding.tag,
      logoUrl: team.logoUrl ?? branding.logoUrl,
      slot: team.slot ?? null,
      placement: team.placement ?? null,
      totalKills: team.kills ?? null,
      points: team.points ?? null,
      alivePlayers:
        team.alivePlayers ?? this.countAlivePlayers(team.players ?? []),
      totalPlayers: team.totalPlayers ?? players.length,
      backpack: team.backpack ?? null,
      equipment: team.equipment ?? team.backpack ?? null,
      players,
    };
  }

  private toLiveStatePlayer(
    teamId: string,
    player: MatchStatePlayer,
    playerIndex: number,
  ): LiveStatePlayer {
    return {
      playerId:
        player.playerId ??
        player.id ??
        player.externalPlayerId ??
        player.pubgPlayerId ??
        `live:${teamId}:${playerIndex + 1}`,
      ign: player.name ?? player.ign ?? null,
      isAlive: player.alive === true,
      alive: player.alive === true,
      knocked: player.knocked === true,
      health: player.health ?? null,
      kills: Math.max(0, player.kills ?? 0),
      assists: Math.max(0, player.assists ?? 0),
      lifeTelemetryFresh: player.lifeTelemetryFresh === true,
    };
  }

  private countAlivePlayers(players: MatchStatePlayer[]): number {
    return players.reduce(
      (sum, player) => sum + (player.alive === true ? 1 : 0),
      0,
    );
  }

  private resolveAlivePlayers(team: LiveStateTeam): number {
    if (
      typeof team.alivePlayers === 'number' &&
      Number.isFinite(team.alivePlayers)
    ) {
      return Math.max(0, team.alivePlayers);
    }
    return (team.players ?? []).reduce(
      (sum, player) => sum + (player.isAlive === true ? 1 : 0),
      0,
    );
  }

  private normalizeWinner(team: LiveStateTeam): LiveStateTeam {
    return {
      ...team,
      placement: team.placement ?? 1,
      alivePlayers: Math.max(1, team.alivePlayers ?? 1),
      players: (team.players ?? []).map((player) => ({
        ...player,
        isAlive: true,
        alive: true,
        knocked: false,
        health: player.health ?? null,
      })),
    };
  }

  private setPlayerState(
    target: Record<string, boolean>,
    player: MatchStatePlayer,
    value: boolean,
  ) {
    for (const key of [
      player.playerId,
      player.id,
      player.externalPlayerId,
      player.pubgPlayerId,
    ]) {
      const normalized = this.normalize(key);
      if (normalized) {
        target[normalized] = value;
      }
    }
  }

  private toBusinessStatus(
    controlStatus: LiveMatchState['status'],
    fallback: MatchStatus | null,
  ): MatchStatus | null {
    if (controlStatus === 'LIVE') {
      return MatchStatus.LIVE;
    }
    if (controlStatus === 'FINISH_PENDING') {
      return MatchStatus.FINISH_PENDING;
    }
    if (controlStatus === 'FINISHED') {
      return MatchStatus.FINISHED;
    }
    return fallback;
  }

  private logRead(
    scope: string,
    matchId: string | null,
    organizationId?: string | null,
  ) {
    const key = `${scope}:${matchId ?? 'none'}:${organizationId ?? 'none'}`;
    if (this.loggedReads.has(key)) {
      return;
    }
    this.loggedReads.add(key);
    const details = [
      `scope=${scope}`,
      matchId ? `matchId=${matchId}` : null,
      organizationId ? `organizationId=${organizationId}` : null,
    ]
      .filter((value): value is string => Boolean(value))
      .join(' ');
    this.logger.log(`using-canonical-control-read ${details}`);
  }

  private normalize(value?: string | null): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
