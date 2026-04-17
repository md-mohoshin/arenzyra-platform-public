import type {
  LiveMatchStateDto,
  LiveMatchTeamDto,
} from '../../../realtime/live-match-state.dto';

export type OverlayTeamDto = {
  teamId: string;
  name: string | null;
  tag: string | null;
  slot: number | null;
  kills: number;
  placement: number | null;
  points: number | null;
  logoUrl: string | null;
  alivePlayers?: number | null;
  totalPlayers?: number | null;
  alive?: boolean;
};

export type OverlayFocusDto = {
  teamId?: string | null;
  playerId?: string | null;
  teamName?: string | null;
  teamTag?: string | null;
  teamLogoUrl?: string | null;
  playerName?: string | null;
  playerIgn?: string | null;
};

export type OverlayKillFeedDto = {
  matchId: string;
  teamId: string;
  delta: number;
  totalKills: number;
  ts: number;
};

export type OverlayMatchStateDto = {
  matchId: string;
  status: LiveMatchStateDto['status'];
  startedAt: string | null;
  endedAt: string | null;
  version: number;
  updatedAt: string;
  teams: OverlayTeamDto[];
  focus?: OverlayFocusDto | null;
};

export function mapOverlayTeam(team: LiveMatchTeamDto): OverlayTeamDto {
  const alivePlayers = team.alivePlayers;
  const alive =
    alivePlayers === null || alivePlayers === undefined
      ? undefined
      : alivePlayers > 0;
  return {
    teamId: team.teamId,
    name: team.name,
    tag: team.tag,
    slot: team.slot,
    kills: team.kills,
    placement: team.placement,
    points: team.points,
    logoUrl: team.logoUrl,
    alivePlayers,
    totalPlayers: team.totalPlayers,
    alive,
  };
}

export function mapOverlayState(
  state: LiveMatchStateDto,
  focus?: OverlayFocusDto | null,
): OverlayMatchStateDto {
  return {
    matchId: state.matchId,
    status: state.status,
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    version: state.version,
    updatedAt: state.updatedAt,
    teams: state.teams.map(mapOverlayTeam),
    focus: focus ?? null,
  };
}
