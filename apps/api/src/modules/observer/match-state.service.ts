import { Injectable, NotFoundException } from '@nestjs/common';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { normalizePublicAssetUrl } from '../../common/public-asset-url.util';
import { resolveTeamLogoUrl } from '../../common/team-branding.util';

export type MatchStateLeaderboardRow = {
  rank: number;
  teamId: string | null;
  slot: number | null;
  teamName: string;
  teamTag: string | null;
  logoUrl: string | null;
  color: string | null;
  kills: number;
  alivePlayers: number;
  totalPlayers: number | null;
  placement: number | null;
  isEliminated: boolean;
  players?: MatchStateLeaderboardPlayer[];
};

export type MatchStateLeaderboardPlayer = {
  playerId: string | null;
  playerName: string;
  avatarUrl: string | null;
  kills: number;
  alive: boolean;
  knocked: boolean;
  health: number | null;
  hasDied: boolean | null;
  lifeTelemetryFresh?: boolean;
};

export type MatchStateKillFeedEntry = {
  id: string;
  killerPlayerId?: string | null;
  killerName: string | null;
  killerTeamId?: string | null;
  killerTeam: string | null;
  victimPlayerId?: string | null;
  victimName: string | null;
  victimTeamId?: string | null;
  victimTeam: string | null;
  weapon: string | null;
  tsIso: string | null;
  isKnock?: boolean;
  isThirst?: boolean;
  isSelf?: boolean;
  isZone?: boolean;
  isReviveRelated?: boolean;
};

export type MatchStatePlayerCard = {
  playerId: string | null;
  name: string | null;
  avatarUrl: string | null;
  teamId: string | null;
  teamName: string | null;
  teamTag: string | null;
  logoUrl: string | null;
  color: string | null;
  kills: number;
  alive: boolean;
  damage: number | null;
};

export type MatchStateCircle = {
  phase: number | null;
  nextShrinkAt: string | null;
  safeZone: { x: number; y: number; r: number } | null;
  nextZone: { x: number; y: number; r: number } | null;
};

export type MatchStateWinner = {
  teamId: string | null;
  slot: number | null;
  teamName: string;
  teamTag: string | null;
  logoUrl: string | null;
  color: string | null;
  kills: number;
  alivePlayers: number;
  placement: number | null;
};

export type MatchWinnerEventPayload = {
  matchId: string;
  teamId: string | null;
  teamName: string;
  teamTag: string | null;
  logoUrl: string | null;
};

export type ObserverStateUpdatePayload = {
  matchId: string;
  leaderboard: MatchStateLeaderboardRow[];
  teamsAlive: number;
  timestamp: string;
};

export type ObserverKillFeedUpdateEntry = {
  id: string;
  timestamp: string | null;
  killerPlayerId: string | null;
  killerName: string | null;
  killerTeamId: string | null;
  killerTeamName: string | null;
  victimPlayerId: string | null;
  victimName: string | null;
  victimTeamId: string | null;
  victimTeamName: string | null;
  weapon: string | null;
  isKnock: boolean;
  isThirst: boolean;
  isSelf: boolean;
  isZone: boolean;
  isReviveRelated: boolean;
};

export type ObserverKillFeedUpdatePayload = {
  matchId: string;
  entries: ObserverKillFeedUpdateEntry[];
  sequence: number;
  emittedAt: string;
};

export type ObserverMatchFinishedPayload = {
  matchId: string;
  winnerTeamId: string | null;
  winnerTeamName: string | null;
  finalLeaderboard: MatchStateLeaderboardRow[];
  finishedAt: string;
};

export interface MatchState {
  matchId: string;
  updatedAt: string;
  teamsAlive: number;
  leaderboard: MatchStateLeaderboardRow[];
  killFeed: MatchStateKillFeedEntry[];
  playerCard: MatchStatePlayerCard | null;
  circle: MatchStateCircle | null;
  winner: MatchStateWinner | null;
}

@Injectable()
export class MatchStateService {
  private readonly states = new Map<string, MatchState>();
  private readonly killFeedSequences = new Map<string, number>();
  private readonly killFeedSignatures = new Map<string, string>();

  constructor(private readonly realtime: RealtimeGateway) {}

  createEmptyState(matchId: string, updatedAt?: string | null): MatchState {
    const normalizedMatchId = String(matchId || '').trim();
    if (!normalizedMatchId) {
      throw new NotFoundException('Match state not found');
    }

    return {
      matchId: normalizedMatchId,
      updatedAt: updatedAt ?? new Date().toISOString(),
      teamsAlive: 0,
      leaderboard: [],
      killFeed: [],
      playerCard: null,
      circle: null,
      winner: null,
    };
  }

  get(matchId: string): MatchState {
    const normalizedMatchId = String(matchId || '').trim();
    if (!normalizedMatchId) {
      throw new NotFoundException('Match state not found');
    }

    return (
      this.states.get(normalizedMatchId) ??
      this.createEmptyState(normalizedMatchId)
    );
  }

  update(matchId: string, state: MatchState): MatchState {
    const normalizedMatchId = String(matchId || '').trim();
    if (!normalizedMatchId) {
      throw new NotFoundException('Match state not found');
    }

    const nextState: MatchState = {
      ...this.createEmptyState(normalizedMatchId, state?.updatedAt),
      ...state,
      matchId: normalizedMatchId,
      updatedAt: state?.updatedAt ?? new Date().toISOString(),
      teamsAlive:
        typeof state?.teamsAlive === 'number' &&
        Number.isFinite(state.teamsAlive)
          ? Math.max(0, state.teamsAlive)
          : 0,
      leaderboard: Array.isArray(state?.leaderboard) ? state.leaderboard : [],
      killFeed: Array.isArray(state?.killFeed) ? state.killFeed : [],
      playerCard: state?.playerCard ?? null,
      circle: state?.circle ?? null,
      winner: state?.winner ?? null,
    };
    nextState.leaderboard = nextState.leaderboard.map((row) =>
      this.normalizeLeaderboardRow(row),
    );
    nextState.playerCard = this.normalizePlayerCard(nextState.playerCard);
    nextState.winner = this.normalizeWinner(nextState.winner);

    this.states.set(normalizedMatchId, nextState);
    return nextState;
  }

  emitMatchUpdate(state: MatchState) {
    const normalizedMatchId = String(state?.matchId || '').trim();
    if (!normalizedMatchId || !this.realtime?.io) {
      return;
    }

    this.realtime.io
      .to(`match:${normalizedMatchId}`)
      .emit('match:update', state as never);
  }

  emitObserverStateUpdate(state: MatchState) {
    const normalizedMatchId = String(state?.matchId || '').trim();
    if (!normalizedMatchId || !this.realtime?.io) {
      return;
    }

    const payload: ObserverStateUpdatePayload = {
      matchId: normalizedMatchId,
      leaderboard: Array.isArray(state?.leaderboard) ? state.leaderboard : [],
      teamsAlive:
        typeof state?.teamsAlive === 'number' &&
        Number.isFinite(state.teamsAlive)
          ? Math.max(0, state.teamsAlive)
          : 0,
      timestamp: state?.updatedAt ?? new Date().toISOString(),
    };

    this.realtime.io
      .to(`match:${normalizedMatchId}`)
      .emit('observer:state:update', payload as never);
  }

  emitObserverKillFeedUpdate(state: MatchState) {
    const normalizedMatchId = String(state?.matchId || '').trim();
    if (!normalizedMatchId || !this.realtime?.io) {
      return;
    }

    const entries = (Array.isArray(state?.killFeed) ? state.killFeed : []).map(
      (entry) => this.toObserverKillFeedEntry(entry),
    );
    const signature = JSON.stringify(entries);
    if (this.killFeedSignatures.get(normalizedMatchId) === signature) {
      return;
    }

    const sequence = (this.killFeedSequences.get(normalizedMatchId) ?? 0) + 1;
    const payload: ObserverKillFeedUpdatePayload = {
      matchId: normalizedMatchId,
      entries,
      sequence,
      emittedAt: state?.updatedAt ?? new Date().toISOString(),
    };

    this.killFeedSignatures.set(normalizedMatchId, signature);
    this.killFeedSequences.set(normalizedMatchId, sequence);
    this.realtime.io
      .to(`match:${normalizedMatchId}`)
      .emit('observer:killfeed:update', payload as never);
  }

  private toObserverKillFeedEntry(
    entry: MatchStateKillFeedEntry,
  ): ObserverKillFeedUpdateEntry {
    return {
      id: entry.id,
      timestamp: entry.tsIso ?? null,
      killerPlayerId: entry.killerPlayerId ?? null,
      killerName: entry.killerName ?? null,
      killerTeamId: entry.killerTeamId ?? null,
      killerTeamName: entry.killerTeam ?? null,
      victimPlayerId: entry.victimPlayerId ?? null,
      victimName: entry.victimName ?? null,
      victimTeamId: entry.victimTeamId ?? null,
      victimTeamName: entry.victimTeam ?? null,
      weapon: entry.weapon ?? null,
      isKnock: entry.isKnock === true,
      isThirst: entry.isThirst === true,
      isSelf: entry.isSelf === true,
      isZone: entry.isZone === true,
      isReviveRelated: entry.isReviveRelated === true,
    };
  }

  emitMatchWinner(payload: MatchWinnerEventPayload) {
    const normalizedMatchId = String(payload?.matchId || '').trim();
    if (!normalizedMatchId) {
      return;
    }

    this.realtime.emitMatchWinner({
      matchId: normalizedMatchId,
      teamId: payload.teamId ?? null,
      teamName: payload.teamName,
      teamTag: payload.teamTag ?? null,
      logoUrl: resolveTeamLogoUrl(payload.teamId, payload.logoUrl),
    });
  }

  private normalizeLeaderboardRow(
    row: MatchStateLeaderboardRow,
  ): MatchStateLeaderboardRow {
    return {
      ...row,
      logoUrl: resolveTeamLogoUrl(row.teamId, row.logoUrl),
      players: row.players?.map((player) => ({
        ...player,
        avatarUrl: normalizePublicAssetUrl(player.avatarUrl),
      })),
    };
  }

  private normalizePlayerCard(
    playerCard: MatchStatePlayerCard | null,
  ): MatchStatePlayerCard | null {
    return playerCard
      ? {
          ...playerCard,
          logoUrl: resolveTeamLogoUrl(playerCard.teamId, playerCard.logoUrl),
          avatarUrl: normalizePublicAssetUrl(playerCard.avatarUrl),
        }
      : null;
  }

  private normalizeWinner(
    winner: MatchStateWinner | null,
  ): MatchStateWinner | null {
    return winner
      ? {
          ...winner,
          logoUrl: resolveTeamLogoUrl(winner.teamId, winner.logoUrl),
        }
      : null;
  }
}
