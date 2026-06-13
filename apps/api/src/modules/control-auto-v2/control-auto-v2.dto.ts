export class ControlAutoV2SetupMatchDto {
  id!: string;
  name!: string | null;
  status!: string | null;
  matchNumber!: number | null;
  map!: string | null;
}

export class ControlAutoV2SetupPlayerDto {
  id!: string;
  ign!: string | null;
  realName!: string | null;
  externalPlayerId!: string | null;
  inGameId!: string | null;
}

export class ControlAutoV2SetupTeamDto {
  id!: string;
  name!: string | null;
  tag!: string | null;
  logoUrl!: string | null;
  players!: ControlAutoV2SetupPlayerDto[];
}

export class ControlAutoV2SetupSlotDto {
  slotNumber!: number;
  team!: ControlAutoV2SetupTeamDto | null;
}

export class ControlAutoV2SetupResponseDto {
  match!: ControlAutoV2SetupMatchDto;
  slots!: ControlAutoV2SetupSlotDto[];
  assignedTeams!: ControlAutoV2SetupTeamDto[];
  assignedPlayers!: ControlAutoV2SetupPlayerDto[];
}

export class ControlAutoV2LivePlayerDto {
  id!: string | null;
  playerId!: string | null;
  teamId!: string | null;
  name!: string | null;
  ign!: string | null;
  alive!: boolean;
  knocked!: boolean;
  kills!: number;
}

export class ControlAutoV2LiveTeamDto {
  teamId!: string;
  name!: string | null;
  tag!: string | null;
  slot!: number | null;
  alivePlayers!: number | null;
  totalPlayers!: number | null;
  kills!: number;
  placement!: number | null;
  players!: ControlAutoV2LivePlayerDto[];
}

export class ControlAutoV2LiveResponseDto {
  telemetryStatus!: 'waiting' | 'live';
  phase!: number | null;
  aliveTeams!: number | null;
  alivePlayers!: number | null;
  teams!: ControlAutoV2LiveTeamDto[];
  players!: ControlAutoV2LivePlayerDto[];
}

export class ControlAutoV2PlacementDto {
  teamId!: string;
  placement!: number | null;
}

export class ControlAutoV2KillPlayerDto {
  playerId!: string | null;
  playerName!: string | null;
  kills!: number;
}

export class ControlAutoV2KillTeamDto {
  teamId!: string;
  kills!: number;
  players!: ControlAutoV2KillPlayerDto[];
}

export class ControlAutoV2StandingDto {
  rank!: number;
  teamId!: string;
  placement!: number | null;
  kills!: number;
  points!: number;
}

export class ControlAutoV2ResultsResponseDto {
  placements!: ControlAutoV2PlacementDto[];
  kills!: ControlAutoV2KillTeamDto[];
  standings!: ControlAutoV2StandingDto[];
}
