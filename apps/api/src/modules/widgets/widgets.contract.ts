import { comparePresenceStatus } from '../../common/results-presence.util';
import {
  compareRankingRows,
  type RankingTieBreakRow,
} from '../../common/ranking-tiebreakers.util';

export type WidgetContractVersion = 'v1';

export type WidgetState = {
  version: WidgetContractVersion;
  nowIso: string;
  matchId: string;
  tournamentId?: string | null;
  game?: string | null;
  dataSource?: string | null;
  controlState?: string | null;
  /**
   * True once the system detects only one team alive and freezes results.
   */
  resultFinalized?: boolean | null;
  /**
   * ISO timestamp of when resultFinalized was set.
   */
  finalizedAt?: string | null;
  /**
   * Team id detected as last team standing, when available.
   */
  winnerTeamId?: string | null;
  resultsLocked: boolean;
  phase?: string | null;
  hasSlots: boolean;
  hasSlotResults: boolean;
  hasPlayerResults: boolean;
  aliveTeams?: number | null;
  lastUpdateIso?: string | null;
  reasons: string[];
};

export type WidgetTeamBrandPreset = {
  logoUrl?: string | null;
  primaryColor?: string | null;
  accent?: string | null;
  text?: string | null;
};

export type WidgetTeamSlotRow = {
  slot: number;
  teamId?: string | null;
  teamName?: string | null;
  teamTag?: string | null;
  teamLogoUrl?: string | null;
  teamPrimaryColor?: string | null;
  brandLight?: WidgetTeamBrandPreset | null;
  brandDark?: WidgetTeamBrandPreset | null;
  wasPresentInMatch?: boolean | null;
  presenceStatus?: 'ACTIVE' | 'NO_SHOW' | 'UNRESOLVED' | null;
  totalKills: number;
  placement?: number | null;
  placementPoints?: number | null;
  totalPoints?: number | null;
};

export type WidgetScoreboardPayload = {
  version: WidgetContractVersion;
  state: WidgetState;
  rows: WidgetTeamSlotRow[];
};

export type WidgetMatchResultSummaryRow = {
  rank: number;
  teamId?: string | null;
  teamName?: string | null;
  teamTag?: string | null;
  teamLogoUrl?: string | null;
  teamPrimaryColor?: string | null;
  brandLight?: WidgetTeamBrandPreset | null;
  brandDark?: WidgetTeamBrandPreset | null;
  wasPresentInMatch?: boolean | null;
  presenceStatus?: 'ACTIVE' | 'NO_SHOW' | 'UNRESOLVED' | null;
  kills: number;
  totalPoints: number;
  wwcd?: boolean;
};

export type WidgetMatchResultSummaryPayload = {
  version: WidgetContractVersion;
  state: WidgetState;
  header: {
    tournament?: string | null;
    match?: string | null;
    map?: string | null;
  };
  rows: WidgetMatchResultSummaryRow[];
};

export type WidgetMatchResultSummaryMeta = {
  version: number | string;
  updatedAt?: string | null;
  matchId?: string | null;
  tournamentId?: string | null;
  dataSource?: string | null;
  controlState?: string | null;
  aliveTeams?: number | null;
};

export type WidgetTeamListRow = {
  slot: number;
  teamId?: string | null;
  teamName?: string | null;
  teamTag?: string | null;
  teamLogoUrl?: string | null;
  teamPrimaryColor?: string | null;
  brandLight?: WidgetTeamBrandPreset | null;
  brandDark?: WidgetTeamBrandPreset | null;
  wasPresentInMatch?: boolean | null;
  presenceStatus?: 'ACTIVE' | 'NO_SHOW' | 'UNRESOLVED' | null;
};

export type WidgetPlayerListRow = WidgetTeamListRow & {
  players: Array<{
    id?: string | null;
    playerId?: string | null;
    name?: string | null;
    ign?: string | null;
    photoUrl?: string | null;
    playerPhotoUrl?: string | null;
    alive?: boolean | null;
    knocked?: boolean | null;
    knocks?: number | null;
    assists?: number | null;
  }>;
};

export type WidgetTeamListPayload = {
  version: WidgetContractVersion;
  state: WidgetState;
  rows: WidgetTeamListRow[];
};

export type WidgetPlayerListPayload = {
  version: WidgetContractVersion;
  state: WidgetState;
  rows: WidgetPlayerListRow[];
};

export type WidgetWwcdPayload = {
  version: WidgetContractVersion;
  state: WidgetState;
  winner?: WidgetTeamListRow | null;
};

export type WidgetEliminationEntry = {
  killerName?: string | null;
  killerTeam?: string | null;
  victimName?: string | null;
  victimTeam?: string | null;
  weapon?: string | null;
  tsIso?: string | null;
};

export type WidgetEliminationPayload = {
  version: WidgetContractVersion;
  state: WidgetState;
  entries: WidgetEliminationEntry[];
};

export type WidgetStageWinnerRow = {
  rank: number;
  teamId?: string | null;
  teamName?: string | null;
  teamTag?: string | null;
  teamLogoUrl?: string | null;
  teamPrimaryColor?: string | null;
  brandLight?: WidgetTeamBrandPreset | null;
  brandDark?: WidgetTeamBrandPreset | null;
  wasPresentInMatch?: boolean | null;
  presenceStatus?: 'ACTIVE' | 'NO_SHOW' | 'UNRESOLVED' | null;
  totalPoints?: number | null;
};

export type WidgetStageWinnersPayload = {
  version: WidgetContractVersion;
  state: WidgetState;
  rows: WidgetStageWinnerRow[];
};

export function makeWidgetState(params: {
  matchId: string;
  tournamentId?: string | null;
  game?: string | null;
  dataSource?: string | null;
  controlState?: string | null;
  resultFinalized?: boolean | null;
  finalizedAt?: string | null;
  winnerTeamId?: string | null;
  resultsLocked?: boolean;
  phase?: string | null;
  hasSlots?: boolean;
  hasSlotResults?: boolean;
  hasPlayerResults?: boolean;
  aliveTeams?: number | null;
  lastUpdateIso?: string | null;
  reasons?: string[];
}): WidgetState {
  return {
    version: 'v1',
    nowIso: new Date().toISOString(),
    matchId: params.matchId,
    tournamentId: params.tournamentId ?? null,
    game: params.game ?? null,
    dataSource: params.dataSource ?? null,
    controlState: params.controlState ?? null,
    resultFinalized:
      params.resultFinalized === undefined
        ? null
        : (params.resultFinalized ?? null),
    finalizedAt: params.finalizedAt ?? null,
    winnerTeamId: params.winnerTeamId ?? null,
    resultsLocked: Boolean(params.resultsLocked),
    phase: params.phase ?? null,
    hasSlots: Boolean(params.hasSlots),
    hasSlotResults: Boolean(params.hasSlotResults),
    hasPlayerResults: Boolean(params.hasPlayerResults),
    aliveTeams:
      params.aliveTeams === undefined ? null : (params.aliveTeams ?? null),
    lastUpdateIso: params.lastUpdateIso ?? null,
    reasons: params.reasons ?? [],
  };
}

export function sortScoreboardRows(
  rows: WidgetTeamSlotRow[],
): WidgetTeamSlotRow[] {
  return [...rows].sort((a, b) => {
    const presenceOrder = comparePresenceStatus(
      a.wasPresentInMatch,
      b.wasPresentInMatch,
    );
    if (presenceOrder !== 0) return presenceOrder;

    const rankingOrder = compareRankingRows(
      a as RankingTieBreakRow,
      b as RankingTieBreakRow,
    );
    if (rankingOrder !== 0) return rankingOrder;

    const aPlace = Number.isFinite(a.placement)
      ? (a.placement as number)
      : Number.POSITIVE_INFINITY;
    const bPlace = Number.isFinite(b.placement)
      ? (b.placement as number)
      : Number.POSITIVE_INFINITY;
    if (aPlace !== bPlace) return aPlace - bPlace;

    return (
      (a.slot ?? Number.POSITIVE_INFINITY) -
      (b.slot ?? Number.POSITIVE_INFINITY)
    );
  });
}
