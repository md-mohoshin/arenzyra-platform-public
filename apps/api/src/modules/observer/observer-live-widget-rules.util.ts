import type { LiveMatchState } from '../match-control/state.store';
import { normalizePublicAssetUrl } from '../../common/public-asset-url.util';
import { resolveTeamLogoUrl } from '../../common/team-branding.util';
import type {
  MatchState,
  MatchStateLeaderboardPlayer,
  MatchStateLeaderboardRow,
} from './match-state.service';

type LiveMatchTeam = LiveMatchState['teams'][number];

export const DEFAULT_OBSERVER_WIDGET_TEAM_NAME = 'Arenzyra';
export const DEFAULT_OBSERVER_WIDGET_TEAM_TAG = 'AZ';

export const countAliveRows = (rows: MatchStateLeaderboardRow[]): number =>
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

export function isPlayingLiveTeam(team: LiveMatchTeam): boolean {
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

export function isPlayingLeaderboardRow(
  row: MatchStateLeaderboardRow,
): boolean {
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

export const rankPlayingLeaderboardRows = (
  rows: MatchStateLeaderboardRow[],
): MatchStateLeaderboardRow[] =>
  rows.filter(isPlayingLeaderboardRow).map((row, index) => ({
    ...row,
    rank: index + 1,
  }));

const countPlayingLiveTeams = (state: LiveMatchState | null): number =>
  state?.teams?.filter(isPlayingLiveTeam).length ?? 0;

export const countAliveLiveTeams = (state: LiveMatchState | null): number =>
  state?.teams?.filter((team) => {
    const alivePlayers =
      typeof team.alivePlayers === 'number'
        ? team.alivePlayers
        : (team.players ?? []).filter((player) => player.alive === true).length;
    return alivePlayers > 0;
  }).length ?? 0;

export function chooseLiveState(
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

export function needsTelemetryFallback(
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

export const normalizeLogoUrl = (
  teamId: string | null | undefined,
  value: string | null | undefined,
): string | null => resolveTeamLogoUrl(teamId, value);

const isPlaceholderTeamName = (value: string | null | undefined): boolean => {
  if (!value) return true;
  return /^\[live\]/i.test(value.trim());
};

export const chooseTeamName = (
  preferred: string | null | undefined,
  fallback: string | null | undefined,
  slot: number | null | undefined,
): string => {
  void slot;
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
  return DEFAULT_OBSERVER_WIDGET_TEAM_NAME;
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

export function mergePlayers(
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
      externalPlayerId:
        player.externalPlayerId ?? fallback?.externalPlayerId ?? null,
      pubgPlayerId: player.pubgPlayerId ?? fallback?.pubgPlayerId ?? null,
      playerName: player.playerName || fallback?.playerName || 'Unknown Player',
      avatarUrl: normalizePublicAssetUrl(
        player.avatarUrl ?? fallback?.avatarUrl ?? null,
      ),
      kills: player.kills ?? fallback?.kills ?? 0,
      assists: player.assists ?? fallback?.assists ?? 0,
      alive: player.alive ?? fallback?.alive ?? false,
      knocked: player.knocked ?? fallback?.knocked ?? false,
      health: player.health ?? fallback?.health ?? null,
      hasDied: player.hasDied ?? fallback?.hasDied ?? null,
      lifeTelemetryFresh:
        player.lifeTelemetryFresh ?? fallback?.lifeTelemetryFresh ?? false,
    };
  });
}

export function deriveAlivePlayersFromRows(
  players: MatchStateLeaderboardPlayer[] | undefined,
): number | null {
  if (!Array.isArray(players) || players.length === 0) {
    return null;
  }
  const hasAliveSignal = players.some(
    (player) =>
      player.lifeTelemetryFresh === true && typeof player.alive === 'boolean',
  );
  if (!hasAliveSignal) {
    return null;
  }
  return players.filter(
    (player) => player.lifeTelemetryFresh === true && player.alive === true,
  ).length;
}

export function mergeLeaderboardRows(
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
    const players = mergePlayers(
      liveRow.players ?? [],
      fallback?.players ?? [],
    );
    const derivedAlivePlayers = deriveAlivePlayersFromRows(players);
    const alivePlayers =
      derivedAlivePlayers ??
      liveRow.alivePlayers ??
      fallback?.alivePlayers ??
      0;
    merged.push({
      rank: liveRow.rank ?? fallback?.rank ?? merged.length + 1,
      teamId: liveRow.teamId ?? fallback?.teamId ?? null,
      slot: liveRow.slot ?? fallback?.slot ?? null,
      teamName: chooseTeamName(
        liveRow.teamName,
        fallback?.teamName,
        liveRow.slot ?? fallback?.slot ?? null,
      ),
      teamTag:
        liveRow.teamTag ??
        fallback?.teamTag ??
        DEFAULT_OBSERVER_WIDGET_TEAM_TAG,
      logoUrl: normalizeLogoUrl(
        liveRow.teamId ?? fallback?.teamId ?? null,
        liveRow.logoUrl ?? fallback?.logoUrl ?? null,
      ),
      color: liveRow.color ?? fallback?.color ?? null,
      kills: liveRow.kills ?? fallback?.kills ?? 0,
      alivePlayers,
      totalPlayers: liveRow.totalPlayers ?? fallback?.totalPlayers ?? null,
      placement: liveRow.placement ?? fallback?.placement ?? null,
      isEliminated:
        derivedAlivePlayers !== null
          ? alivePlayers <= 0
          : (liveRow.isEliminated ?? fallback?.isEliminated ?? false),
      backpack: liveRow.backpack ?? fallback?.backpack ?? null,
      equipment:
        liveRow.equipment ??
        liveRow.backpack ??
        fallback?.equipment ??
        fallback?.backpack ??
        null,
      players,
    });
  }

  for (const observerRow of fallbackRows) {
    const key = rowKey(observerRow);
    if (key && consumed.has(key)) continue;
    merged.push(observerRow);
  }

  return rankPlayingLeaderboardRows(merged);
}
