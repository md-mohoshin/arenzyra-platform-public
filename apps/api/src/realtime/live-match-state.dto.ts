import type { ControlStatus } from '../modules/match-control/dto/control.dto';
import type {
  LiveMatchState,
  MatchStateCircle,
  MatchStateEvent,
  MatchStateKillFeedItem,
  MatchStateObservedPlayer,
  MatchStatePlayer,
  MatchStateSummary,
  TeamScoreState,
} from '../modules/match-control/state.store';

export type LiveMatchPlayerDto = MatchStatePlayer;

export type LiveMatchTeamDto = {
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
  eliminated?: boolean;
  players?: LiveMatchPlayerDto[];
};

export type LiveMatchStateDto = {
  matchId: string;
  status: ControlStatus;
  startedAt: string | null;
  endedAt: string | null;
  version: number;
  updatedAt: string;
  sourceMode?: LiveMatchState['sourceMode'];
  summary?: MatchStateSummary | null;
  circle?: MatchStateCircle | null;
  observedPlayer?: MatchStateObservedPlayer | null;
  killFeed?: MatchStateKillFeedItem[];
  events?: MatchStateEvent[];
  teams: LiveMatchTeamDto[];
};

export function mapTeamToDto(team: TeamScoreState): LiveMatchTeamDto {
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
    eliminated: team.eliminated,
    players: team.players,
  };
}

export function mapStateToDto(state: LiveMatchState): LiveMatchStateDto {
  return {
    matchId: state.matchId,
    status: state.status,
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    version: state.version,
    updatedAt: state.updatedAt,
    sourceMode: state.sourceMode,
    summary: state.summary ?? null,
    circle: state.circle ?? null,
    observedPlayer: state.observedPlayer ?? null,
    killFeed: state.killFeed ?? [],
    events: state.events ?? [],
    teams: state.teams.map(mapTeamToDto),
  };
}
