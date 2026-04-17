import { Inject, Injectable, Optional, forwardRef } from '@nestjs/common';
import type { LiveMatchState } from '../match-control/state.store';
import {
  MatchStateService,
  type MatchState,
  type MatchStateCircle,
  type MatchStateKillFeedEntry,
  type MatchStateLeaderboardPlayer,
  type MatchStateLeaderboardRow,
  type MatchStatePlayerCard,
  type MatchStateWinner,
} from './match-state.service';
import { CanonicalControlReadService } from '../realtime/canonical-control-read.service';
import { TelemetryBroadcastService } from '../telemetry/telemetry-broadcast.service';
import { TelemetryEngineService } from '../telemetry/telemetry-engine.service';
import { normalizePublicAssetUrl } from '../../common/public-asset-url.util';
import { resolveTeamLogoUrl } from '../../common/team-branding.util';

export type ObserverWidgetLeaderboardRow = MatchStateLeaderboardRow;
export type ObserverWidgetKillFeedEntry = MatchStateKillFeedEntry;
export type ObserverWidgetPlayerCard = MatchStatePlayerCard;
export type ObserverWidgetWinner = MatchStateWinner;
export type ObserverWidgetMatchUpdatePayload = MatchState;

type LiveMatchTeam = LiveMatchState['teams'][number];

const DEFAULT_WIDGET_TEAM_NAME = 'Arenzyra';
const DEFAULT_WIDGET_TEAM_TAG = 'AZ';
const LOCAL_API_BASE_URL = `http://127.0.0.1:${process.env.PORT || 3000}`;

const parseTime = (value: string | null | undefined): number => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toIso = (value: number | string | null | undefined): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return null;
};

const isPlaceholderTeamName = (value: string | null | undefined): boolean => {
  if (!value) return true;
  return /^\[live\]/i.test(value.trim());
};

const chooseTeamName = (
  preferred: string | null | undefined,
  fallback: string | null | undefined,
  slot: number | null | undefined,
): string => {
  const preferredTrimmed = preferred?.trim() ?? '';
  const fallbackTrimmed = fallback?.trim() ?? '';

  if (preferredTrimmed && !isPlaceholderTeamName(preferredTrimmed)) {
    return preferredTrimmed;
  }
  if (fallbackTrimmed && !isPlaceholderTeamName(fallbackTrimmed)) {
    return fallbackTrimmed;
  }
  if (preferredTrimmed) return preferredTrimmed;
  if (fallbackTrimmed) return fallbackTrimmed;
  return DEFAULT_WIDGET_TEAM_NAME;
};

const rowKey = (row: {
  teamId?: string | null;
  slot?: number | null;
  teamName?: string | null;
}): string =>
  row.teamId?.trim() ||
  (typeof row.slot === 'number' ? `slot:${row.slot}` : '') ||
  (row.teamName?.trim().toLowerCase() ?? '');

const playerKey = (player: {
  playerId?: string | null;
  playerName?: string | null;
}): string =>
  player.playerId?.trim() || player.playerName?.trim().toLowerCase() || '';

const hasMeaningfulKillFeed = (entries: MatchStateKillFeedEntry[]): boolean =>
  entries.some(
    (entry) =>
      !!entry.killerName ||
      !!entry.killerTeam ||
      !!entry.victimName ||
      !!entry.victimTeam ||
      !!entry.weapon,
  );

const hasMeaningfulPlayerCard = (
  playerCard: MatchStatePlayerCard | null,
): boolean =>
  !!(
    playerCard &&
    (playerCard.playerId ||
      playerCard.name ||
      playerCard.teamId ||
      playerCard.teamTag ||
      playerCard.logoUrl)
  );

const countAliveRows = (rows: MatchStateLeaderboardRow[]): number =>
  rows.filter((row) => !row.isEliminated && row.alivePlayers > 0).length;

const isPositiveFiniteNumber = (value: unknown): boolean =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const hasFinitePlacement = (value: unknown): boolean =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const hasExplicitNoShowPresence = (value: {
  wasPresentInMatch?: boolean | null;
  presenceStatus?: string | null;
}): boolean =>
  value.wasPresentInMatch === false || value.presenceStatus === 'NO_SHOW';

const hasExplicitPlayingPresence = (value: {
  wasPresentInMatch?: boolean | null;
  presenceStatus?: string | null;
  hasTelemetryPresence?: boolean | null;
}): boolean =>
  value.wasPresentInMatch === true ||
  value.presenceStatus === 'ACTIVE' ||
  value.hasTelemetryPresence === true;

function isPlayingLiveTeam(team: LiveMatchTeam): boolean {
  if (hasExplicitNoShowPresence(team)) {
    return false;
  }

  return (
    hasExplicitPlayingPresence(team) ||
    (Array.isArray(team.players) && team.players.length > 0) ||
    isPositiveFiniteNumber(team.totalPlayers) ||
    isPositiveFiniteNumber(team.alivePlayers) ||
    isPositiveFiniteNumber(team.kills) ||
    hasFinitePlacement(team.placement)
  );
}

function isPlayingLeaderboardRow(row: MatchStateLeaderboardRow): boolean {
  const presence = row as MatchStateLeaderboardRow & {
    wasPresentInMatch?: boolean | null;
    presenceStatus?: string | null;
    hasTelemetryPresence?: boolean | null;
  };
  if (hasExplicitNoShowPresence(presence)) {
    return false;
  }

  return (
    hasExplicitPlayingPresence(presence) ||
    (Array.isArray(row.players) && row.players.length > 0) ||
    isPositiveFiniteNumber(row.totalPlayers) ||
    isPositiveFiniteNumber(row.alivePlayers) ||
    isPositiveFiniteNumber(row.kills) ||
    hasFinitePlacement(row.placement)
  );
}

const rankPlayingLeaderboardRows = (
  rows: MatchStateLeaderboardRow[],
): MatchStateLeaderboardRow[] =>
  rows.filter(isPlayingLeaderboardRow).map((row, index) => ({
    ...row,
    rank: index + 1,
  }));

const countPlayingLiveTeams = (state: LiveMatchState | null): number =>
  state?.teams?.filter(isPlayingLiveTeam).length ?? 0;

const countAliveLiveTeams = (state: LiveMatchState | null): number =>
  state?.teams?.filter((team) => {
    const alivePlayers =
      typeof team.alivePlayers === 'number'
        ? team.alivePlayers
        : (team.players ?? []).filter((player) => player.alive === true).length;
    return alivePlayers > 0;
  }).length ?? 0;

function chooseLiveState(
  primary: LiveMatchState | null,
  fallback: LiveMatchState | null,
): LiveMatchState | null {
  if (!primary) return fallback;
  if (!fallback) return primary;

  const primaryAlive = countAliveLiveTeams(primary);
  const fallbackAlive = countAliveLiveTeams(fallback);
  if (fallbackAlive !== primaryAlive) {
    return fallbackAlive > primaryAlive ? fallback : primary;
  }

  return countPlayingLiveTeams(fallback) > countPlayingLiveTeams(primary)
    ? fallback
    : primary;
}

function needsTelemetryFallback(
  observer: MatchState,
  live: LiveMatchState | null,
): boolean {
  if (!live) {
    return true;
  }

  const expectedAliveTeams = Math.max(
    observer.teamsAlive ?? 0,
    live.summary?.aliveTeams ?? 0,
  );
  return expectedAliveTeams > countAliveLiveTeams(live);
}

const normalizeLogoUrl = (
  teamId: string | null | undefined,
  value: string | null | undefined,
): string | null => resolveTeamLogoUrl(teamId, value);

function mergePlayers(
  livePlayers: MatchStateLeaderboardPlayer[],
  observerPlayers: MatchStateLeaderboardPlayer[],
): MatchStateLeaderboardPlayer[] {
  if (livePlayers.length === 0) return observerPlayers;
  if (observerPlayers.length === 0) return livePlayers;

  const observerByKey = new Map(
    observerPlayers.map((player) => [playerKey(player), player] as const),
  );

  return livePlayers.map((player) => {
    const fallback = observerByKey.get(playerKey(player));
    return {
      playerId: player.playerId ?? fallback?.playerId ?? null,
      playerName: player.playerName || fallback?.playerName || 'Unknown Player',
      avatarUrl: normalizePublicAssetUrl(
        player.avatarUrl ?? fallback?.avatarUrl ?? null,
      ),
      kills: player.kills ?? fallback?.kills ?? 0,
      alive: player.alive ?? fallback?.alive ?? false,
      knocked: player.knocked ?? fallback?.knocked ?? false,
      health: player.health ?? fallback?.health ?? null,
      hasDied: player.hasDied ?? fallback?.hasDied ?? null,
      lifeTelemetryFresh:
        player.lifeTelemetryFresh ?? fallback?.lifeTelemetryFresh ?? false,
    };
  });
}

function mergeLeaderboardRows(
  liveRows: MatchStateLeaderboardRow[],
  observerRows: MatchStateLeaderboardRow[],
): MatchStateLeaderboardRow[] {
  const primaryRows = liveRows.filter(isPlayingLeaderboardRow);
  const fallbackRows = observerRows.filter(isPlayingLeaderboardRow);

  if (primaryRows.length === 0) return rankPlayingLeaderboardRows(fallbackRows);
  if (fallbackRows.length === 0) return rankPlayingLeaderboardRows(primaryRows);

  const observerByKey = new Map(
    fallbackRows.map((row) => [rowKey(row), row] as const),
  );
  const consumed = new Set<string>();
  const merged: MatchStateLeaderboardRow[] = [];

  for (const liveRow of primaryRows) {
    const key = rowKey(liveRow);
    const fallback = observerByKey.get(key);
    if (key) consumed.add(key);
    merged.push({
      rank: liveRow.rank ?? fallback?.rank ?? merged.length + 1,
      teamId: liveRow.teamId ?? fallback?.teamId ?? null,
      slot: liveRow.slot ?? fallback?.slot ?? null,
      teamName: chooseTeamName(
        liveRow.teamName,
        fallback?.teamName,
        liveRow.slot ?? fallback?.slot ?? null,
      ),
      teamTag: liveRow.teamTag ?? fallback?.teamTag ?? DEFAULT_WIDGET_TEAM_TAG,
      logoUrl: normalizeLogoUrl(
        liveRow.teamId ?? fallback?.teamId ?? null,
        liveRow.logoUrl ?? fallback?.logoUrl ?? null,
      ),
      color: liveRow.color ?? fallback?.color ?? null,
      kills: liveRow.kills ?? fallback?.kills ?? 0,
      alivePlayers: liveRow.alivePlayers ?? fallback?.alivePlayers ?? 0,
      totalPlayers: liveRow.totalPlayers ?? fallback?.totalPlayers ?? null,
      placement: liveRow.placement ?? fallback?.placement ?? null,
      isEliminated: liveRow.isEliminated ?? fallback?.isEliminated ?? false,
      players: mergePlayers(liveRow.players ?? [], fallback?.players ?? []),
    });
  }

  for (const observerRow of fallbackRows) {
    const key = rowKey(observerRow);
    if (key && consumed.has(key)) continue;
    merged.push(observerRow);
  }

  return rankPlayingLeaderboardRows(merged);
}

function buildLiveCircle(live: LiveMatchState): MatchStateCircle | null {
  if (!live.circle) return null;
  return {
    phase:
      typeof live.circle.phase === 'number' || live.circle.phase === null
        ? live.circle.phase
        : null,
    nextShrinkAt: toIso(live.circle.nextShrinkAt),
    safeZone: live.circle.safeZone ?? null,
    nextZone: live.circle.nextZone ?? null,
  };
}

function buildLiveState(live: LiveMatchState): MatchState {
  const teams = Array.isArray(live.teams)
    ? live.teams.filter(isPlayingLiveTeam)
    : [];
  const teamById = new Map(teams.map((team) => [team.teamId, team] as const));
  const allPlayers = teams.flatMap((team) =>
    (team.players ?? []).map((player) => ({
      team,
      player,
    })),
  );

  const leaderboard: MatchStateLeaderboardRow[] = teams.map((team, index) => {
    const teamPlayers = Array.isArray(team.players) ? team.players : [];
    const alivePlayers =
      typeof team.alivePlayers === 'number'
        ? team.alivePlayers
        : teamPlayers.filter((player) => player.alive === true).length;
    const totalPlayers =
      typeof team.totalPlayers === 'number'
        ? team.totalPlayers
        : teamPlayers.length;

    return {
      rank: index + 1,
      teamId: team.teamId ?? null,
      slot: team.slot ?? null,
      teamName: team.name?.trim() || DEFAULT_WIDGET_TEAM_NAME,
      teamTag: team.tag ?? DEFAULT_WIDGET_TEAM_TAG,
      logoUrl: normalizeLogoUrl(team.teamId, team.logoUrl),
      color: null,
      kills: team.kills ?? 0,
      alivePlayers,
      totalPlayers,
      placement: team.placement ?? null,
      isEliminated: team.eliminated === true || alivePlayers === 0,
      players: teamPlayers.map((player) => ({
        playerId: player.playerId ?? player.id ?? null,
        playerName:
          player.name?.trim() ||
          player.ign?.trim() ||
          player.externalPlayerId?.trim() ||
          player.pubgPlayerId?.trim() ||
          'Unknown Player',
        avatarUrl: normalizePublicAssetUrl(player.avatarUrl),
        kills: player.kills ?? 0,
        alive: player.alive === true,
        knocked: player.knocked === true,
        health: null,
        hasDied: player.eliminated ?? !player.alive,
        lifeTelemetryFresh: false,
      })),
    };
  });

  const killFeed: MatchStateKillFeedEntry[] = (live.killFeed ?? [])
    .map((item) => {
      const killerTeam = item.killerTeamId
        ? teamById.get(item.killerTeamId)
        : null;
      const victimTeam = item.victimTeamId
        ? teamById.get(item.victimTeamId)
        : null;
      return {
        id: item.id,
        killerName: item.killerName ?? null,
        killerTeam: killerTeam?.tag ?? killerTeam?.name ?? null,
        victimName: item.victimName ?? null,
        victimTeam: victimTeam?.tag ?? victimTeam?.name ?? null,
        weapon: item.weapon ?? null,
        tsIso: toIso(item.ts),
      };
    })
    .slice(-8)
    .reverse();

  const observed = live.observedPlayer ?? null;
  const observedPlayer =
    (observed
      ? allPlayers.find(({ team, player }) => {
          const livePlayerId = player.playerId ?? player.id ?? null;
          const livePlayerName = player.name ?? player.ign ?? null;
          return (
            (observed.playerId && livePlayerId === observed.playerId) ||
            (observed.pubgPlayerId &&
              player.pubgPlayerId === observed.pubgPlayerId) ||
            (observed.playerName &&
              livePlayerName === observed.playerName &&
              (!observed.teamId || observed.teamId === team.teamId))
          );
        })
      : null) ?? null;

  const latestKiller = (live.killFeed ?? []).find(
    (entry) => entry.killerPlayerId || entry.killerName,
  );
  const killFeedPlayer =
    (latestKiller
      ? allPlayers.find(({ player }) => {
          const livePlayerId = player.playerId ?? player.id ?? null;
          const livePlayerName = player.name ?? player.ign ?? null;
          return (
            (latestKiller.killerPlayerId &&
              livePlayerId === latestKiller.killerPlayerId) ||
            (latestKiller.killerName &&
              livePlayerName === latestKiller.killerName)
          );
        })
      : null) ?? null;

  const featuredPlayer =
    observedPlayer ??
    killFeedPlayer ??
    [...allPlayers].sort((left, right) => {
      if ((right.player.kills ?? 0) !== (left.player.kills ?? 0)) {
        return (right.player.kills ?? 0) - (left.player.kills ?? 0);
      }
      if (left.player.alive !== right.player.alive) {
        return Number(right.player.alive) - Number(left.player.alive);
      }
      return (left.player.name ?? left.player.ign ?? '').localeCompare(
        right.player.name ?? right.player.ign ?? '',
      );
    })[0] ??
    null;

  const playerCard: MatchStatePlayerCard | null = featuredPlayer
    ? {
        playerId:
          featuredPlayer.player.playerId ?? featuredPlayer.player.id ?? null,
        name: featuredPlayer.player.name ?? featuredPlayer.player.ign ?? null,
        avatarUrl: normalizePublicAssetUrl(featuredPlayer.player.avatarUrl),
        teamId: featuredPlayer.team.teamId ?? null,
        teamName: featuredPlayer.team.name ?? DEFAULT_WIDGET_TEAM_NAME,
        teamTag: featuredPlayer.team.tag ?? DEFAULT_WIDGET_TEAM_TAG,
        logoUrl: normalizeLogoUrl(
          featuredPlayer.team.teamId,
          featuredPlayer.team.logoUrl,
        ),
        color: null,
        kills: featuredPlayer.player.kills ?? 0,
        alive: featuredPlayer.player.alive === true,
        damage: null,
      }
    : null;

  const winnerTeam =
    (live.summary?.winnerTeamId
      ? (teams.find((team) => team.teamId === live.summary?.winnerTeamId) ??
        null)
      : null) ??
    teams.find((team) => team.placement === 1) ??
    (live.summary?.aliveTeams === 1
      ? (teams.find(
          (team) =>
            (team.alivePlayers ??
              team.players?.filter((p) => p.alive).length ??
              0) > 0,
        ) ?? null)
      : null);

  const winner: MatchStateWinner | null = winnerTeam
    ? {
        teamId: winnerTeam.teamId ?? null,
        slot: winnerTeam.slot ?? null,
        teamName: winnerTeam.name?.trim() || DEFAULT_WIDGET_TEAM_NAME,
        teamTag: winnerTeam.tag ?? DEFAULT_WIDGET_TEAM_TAG,
        logoUrl: normalizeLogoUrl(winnerTeam.teamId, winnerTeam.logoUrl),
        color: null,
        kills: winnerTeam.kills ?? 0,
        alivePlayers:
          winnerTeam.alivePlayers ??
          winnerTeam.players?.filter((player) => player.alive === true)
            .length ??
          0,
        placement: winnerTeam.placement ?? null,
      }
    : null;

  return {
    matchId: live.matchId,
    updatedAt: live.updatedAt,
    teamsAlive:
      live.summary?.aliveTeams ??
      leaderboard.filter((row) => !row.isEliminated && row.alivePlayers > 0)
        .length,
    leaderboard,
    killFeed,
    playerCard,
    circle: buildLiveCircle(live),
    winner,
  };
}

function mergeStates(
  observer: MatchState,
  live: MatchState | null,
): MatchState {
  if (!live) {
    return observer;
  }

  const liveLeaderboard = live.leaderboard ?? [];
  const observerLeaderboard = observer.leaderboard ?? [];
  // Keep observer stats authoritative for live widget digits, while using
  // canonical state only to backfill metadata like names, tags, and logos.
  const mergedLeaderboard = mergeLeaderboardRows(
    observerLeaderboard,
    liveLeaderboard,
  );
  const inferredTeamsAlive = countAliveRows(mergedLeaderboard);
  const observerHasPrimaryLeaderboardState =
    observerLeaderboard.length > 0 || observer.winner != null;
  const teamsAlive = observerHasPrimaryLeaderboardState
    ? observer.teamsAlive > 0
      ? observer.teamsAlive
      : inferredTeamsAlive > 0
        ? inferredTeamsAlive
        : live.teamsAlive
    : live.teamsAlive > 0
      ? live.teamsAlive
      : inferredTeamsAlive > 0
        ? inferredTeamsAlive
        : observer.teamsAlive;
  const killFeed = hasMeaningfulKillFeed(observer.killFeed ?? [])
    ? observer.killFeed
    : live.killFeed;
  const playerCard = hasMeaningfulPlayerCard(observer.playerCard)
    ? {
        playerId:
          observer.playerCard?.playerId ?? live.playerCard?.playerId ?? null,
        name: observer.playerCard?.name ?? live.playerCard?.name ?? null,
        avatarUrl: normalizePublicAssetUrl(
          observer.playerCard?.avatarUrl ?? live.playerCard?.avatarUrl ?? null,
        ),
        teamId: observer.playerCard?.teamId ?? live.playerCard?.teamId ?? null,
        teamName: chooseTeamName(
          observer.playerCard?.teamName,
          live.playerCard?.teamName,
          null,
        ),
        teamTag:
          observer.playerCard?.teamTag ??
          live.playerCard?.teamTag ??
          DEFAULT_WIDGET_TEAM_TAG,
        logoUrl: normalizeLogoUrl(
          observer.playerCard?.teamId ?? live.playerCard?.teamId ?? null,
          observer.playerCard?.logoUrl ?? live.playerCard?.logoUrl ?? null,
        ),
        color: observer.playerCard?.color ?? live.playerCard?.color ?? null,
        kills: observer.playerCard?.kills ?? live.playerCard?.kills ?? 0,
        alive: observer.playerCard?.alive ?? live.playerCard?.alive ?? false,
        damage: observer.playerCard?.damage ?? live.playerCard?.damage ?? null,
      }
    : normalizePlayerCard(live.playerCard);

  return {
    matchId: observer.matchId || live.matchId,
    updatedAt:
      parseTime(live.updatedAt) >= parseTime(observer.updatedAt)
        ? live.updatedAt
        : observer.updatedAt,
    teamsAlive,
    leaderboard: mergedLeaderboard.map((row) => ({
      ...row,
      logoUrl: normalizeLogoUrl(row.teamId, row.logoUrl),
    })),
    killFeed,
    playerCard: normalizePlayerCard(playerCard),
    circle: observer.circle ?? live.circle,
    winner: normalizeWinner(observer.winner ?? live.winner),
  };
}

function normalizeWinner(
  winner: MatchStateWinner | null,
): MatchStateWinner | null {
  return winner
    ? {
        ...winner,
        logoUrl: normalizeLogoUrl(winner.teamId, winner.logoUrl),
      }
    : null;
}

function normalizePlayerCard(
  playerCard: MatchStatePlayerCard | null,
): MatchStatePlayerCard | null {
  return playerCard
    ? {
        ...playerCard,
        avatarUrl: normalizePublicAssetUrl(playerCard.avatarUrl),
        logoUrl: normalizeLogoUrl(playerCard.teamId, playerCard.logoUrl),
      }
    : null;
}

@Injectable()
export class ObserverWidgetStateService {
  constructor(
    private readonly matchState: MatchStateService,
    @Inject(forwardRef(() => CanonicalControlReadService))
    private readonly canonicalRead: CanonicalControlReadService,
    @Optional()
    @Inject(forwardRef(() => TelemetryEngineService))
    private readonly telemetryEngine?: TelemetryEngineService,
    @Optional()
    @Inject(forwardRef(() => TelemetryBroadcastService))
    private readonly telemetryBroadcast?: TelemetryBroadcastService,
  ) {}

  private async getTelemetryLiveState(
    matchId: string,
  ): Promise<LiveMatchState | null> {
    if (!this.telemetryEngine || !this.telemetryBroadcast) {
      return null;
    }

    return this.telemetryEngine
      .getState(matchId)
      .then((state) => this.telemetryBroadcast!.toLiveMatchState(state))
      .catch(() => null);
  }

  private async getHttpLiveState(
    matchId: string,
  ): Promise<LiveMatchState | null> {
    return fetch(
      `${LOCAL_API_BASE_URL}/api/matches/${encodeURIComponent(matchId)}/state`,
      {
        cache: 'no-store',
        signal: AbortSignal.timeout(1_500),
      },
    )
      .then(async (response) => {
        if (!response.ok) {
          return null;
        }
        const payload = (await response.json()) as Partial<LiveMatchState>;
        return Array.isArray(payload.teams)
          ? (payload as LiveMatchState)
          : null;
      })
      .catch(() => null);
  }

  async getMatchUpdate(
    matchId: string,
  ): Promise<ObserverWidgetMatchUpdatePayload> {
    const observerState = this.matchState.get(matchId);
    let liveState = await this.canonicalRead
      .getStateSnapshot(matchId)
      .catch(() => null);
    if (needsTelemetryFallback(observerState, liveState)) {
      liveState = chooseLiveState(
        liveState,
        await this.getTelemetryLiveState(matchId),
      );
      if (needsTelemetryFallback(observerState, liveState)) {
        liveState = chooseLiveState(
          liveState,
          await this.getHttpLiveState(matchId),
        );
      }
    }
    const payload = mergeStates(
      observerState,
      liveState ? buildLiveState(liveState) : null,
    );
    if (payload.teamsAlive > 0 && countAliveRows(payload.leaderboard) === 0) {
      const httpState = await this.getHttpLiveState(matchId);
      const httpPayload = mergeStates(
        observerState,
        httpState ? buildLiveState(httpState) : null,
      );
      if (countAliveRows(httpPayload.leaderboard) > 0) {
        return httpPayload;
      }
    }
    return payload;
  }

  emitMatchUpdate(payload: ObserverWidgetMatchUpdatePayload) {
    this.matchState.emitMatchUpdate(payload);
  }
}
