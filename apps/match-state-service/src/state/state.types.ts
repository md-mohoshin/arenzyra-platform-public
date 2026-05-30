export interface RawState {
  allInfo: any;
  teamInfoList: any;
  totalPlayerList: any;
  killInfo: any;
  circleInfo: any;
  teamBackpackInfo: any;
  observingPlayer: any;
}

export interface NormalizedTeam {
  id: string;
  name: string | null;
  tag: string | null;
  slot: number | null;
  kills: number | null;
  alivePlayers: number | null;
  totalPlayers: number | null;
  placement: number | null;
  color: string | null;
  raw: any;
}

export interface NormalizedPlayer {
  id: string;
  ign: string | null;
  teamId: string | null;
  status: string | null;
  hp: number | null;
  raw: any;
}

export interface NormalizedKill {
  ts: number;
  killerTeamId: string | null;
  victimTeamId: string | null;
  killerName: string | null;
  victimName: string | null;
  weapon: string | null;
  raw: any;
}

export interface CircleInfo {
  phase: number | null;
  radius: number | null;
  shrinking: boolean | null;
  raw: any;
}

export interface ObserverInfo {
  playerName: string | null;
  playerId: string | null;
  teamId: string | null;
  raw: any;
}

export interface NormalizedBackpack {
  teamId: string | null;
  items: any;
  raw: any;
}

export interface MatchStateSnapshot {
  ts: number;
  status: "ok" | "degraded";
  teams: NormalizedTeam[];
  players: NormalizedPlayer[];
  kills: NormalizedKill[];
  circle: CircleInfo | null;
  observer: ObserverInfo | null;
  backpacks: NormalizedBackpack[];
  raw: RawState;
}
