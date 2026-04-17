export type MvpPlayer = {
  playerId: string | null;
  ign: string;
  photoUrl: string | null;
  teamId: string | null;
  teamName: string | null;
  teamLogo: string | null;
  kills: number;
  assists: number;
  placement: number | null;
  survivalTime: number | null;
  mvpScore: number;
};

export type MvpState = {
  matchId: string;
  finalized: boolean;
  player: MvpPlayer | null;
  overridePlayerId: string | null;
  version: number;
  show: boolean;
};
