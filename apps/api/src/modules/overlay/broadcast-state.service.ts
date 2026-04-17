import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import {
  NormalizedMatchState,
  NormalizedTeamState,
} from '../../types/normalized-match-state';
import { MatchStateCache } from '../pcob/match-state-cache.service';
import { MAP_CONFIGS } from '../maps/map.config';
type MetaTeam = {
  teamId: string;
  slot: number;
  name?: string | null;
  tag?: string | null;
  logoUrl?: string | null;
};

type MatchMeta = {
  matchId: string;
  name?: string | null;
  map?: string | null;
  tournamentId?: string | null;
  tournamentName?: string | null;
  teams: MetaTeam[];
  stats: Record<
    string,
    {
      kills?: number | null;
      placement?: number | null;
      totalPoints?: number | null;
    }
  >;
  sessionId?: string | null;
};

@Injectable()
export class BroadcastStateService {
  private readonly logger = new Logger('BroadcastStateService');
  private metaCache = new Map<string, { meta: MatchMeta; cachedAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: MatchStateCache,
  ) {}

  async ingest(
    matchId: string,
    payload: unknown,
  ): Promise<NormalizedMatchState | null> {
    if (!isRecord(payload)) return null;
    const normalized = this.cache.updateFromTelemetry({ ...payload, matchId });
    const focusValue = payload.focus;
    const focusArg =
      focusValue && typeof focusValue === 'object'
        ? (focusValue as Record<string, unknown>)
        : focusValue === null
          ? null
          : undefined;
    const withFocus =
      focusArg !== undefined
        ? this.cache.setFocus(matchId, focusArg)
        : normalized;
    return this.build(matchId, withFocus ?? normalized ?? undefined);
  }

  async latest(matchId: string): Promise<NormalizedMatchState | null> {
    const normalized = this.cache.get(matchId);
    return this.build(matchId, normalized ?? undefined);
  }

  private async build(
    matchId: string,
    normalized?: NormalizedMatchState,
  ): Promise<NormalizedMatchState | null> {
    const meta = await this.loadMeta(matchId);
    if (!normalized && !meta) return null;

    const baseState: NormalizedMatchState =
      normalized ??
      ({
        matchId,
        serverTime: Date.now(),
        map: { name: meta?.map ?? 'UNKNOWN' },
        zones: {},
        teams: [],
      } as NormalizedMatchState);

    return this.mergeWithMeta(baseState, meta);
  }

  private async loadMeta(matchId: string): Promise<MatchMeta | null> {
    const cached = this.metaCache.get(matchId);
    if (cached && Date.now() - cached.cachedAt < 10_000) return cached.meta;

    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        id: true,
        name: true,
        map: true,
        pcobSessionId: true,
        tournament: { select: { id: true, name: true } },
        matchSlots: {
          orderBy: { slotNumber: 'asc' },
          include: {
            team: {
              select: { id: true, name: true, tag: true, logoUrl: true },
            },
          },
        },
        slotResults: {
          select: {
            teamId: true,
            slotNumber: true,
            wasPresentInMatch: true,
            totalKills: true,
            placement: true,
            totalPoints: true,
          },
        },
      },
    });

    if (!match) return null;

    const stats: Record<
      string,
      {
        kills?: number | null;
        placement?: number | null;
        totalPoints?: number | null;
      }
    > = {};
    const presentTeamIds = new Set(
      (match.slotResults ?? [])
        .filter((stat) => stat.teamId && stat.wasPresentInMatch === true)
        .map((stat) => stat.teamId as string),
    );

    (match.slotResults ?? [])
      .filter((stat) => stat.teamId)
      .filter((stat) => stat.wasPresentInMatch === true)
      .forEach((stat) => {
        stats[stat.teamId as string] = {
          kills: stat.totalKills,
          placement: stat.placement,
          totalPoints: stat.totalPoints,
        };
      });

    const meta: MatchMeta = {
      matchId,
      name: match.name ?? null,
      map: match.map ?? null,
      tournamentId: match.tournament?.id ?? null,
      tournamentName: match.tournament?.name ?? null,
      sessionId: match.pcobSessionId ?? null,
      teams: (match.matchSlots ?? [])
        .filter((slot) => !!slot.teamId && presentTeamIds.has(slot.teamId))
        .map((slot) => ({
          teamId: slot.teamId as string,
          slot: slot.slotNumber,
          name: slot.team?.name ?? null,
          tag: slot.team?.tag ?? null,
          logoUrl: slot.team?.logoUrl ?? null,
        })),
      stats,
    };

    this.metaCache.set(matchId, { meta, cachedAt: Date.now() });
    return meta;
  }

  private mergeWithMeta(
    state: NormalizedMatchState,
    meta: MatchMeta | null,
  ): NormalizedMatchState {
    const mapName = state.map?.name ?? meta?.map ?? 'UNKNOWN';
    const mapConfig = mapName ? MAP_CONFIGS[mapName.toUpperCase()] : null;
    const teams = this.mergeTeams(state, meta);
    const summary = this.computeSummary(teams, state.summary);

    const existingMeta =
      (state.meta as Record<string, unknown> | undefined) ?? {};
    const mergedMeta: NormalizedMatchState['meta'] = {
      ...existingMeta,
      matchName:
        meta?.name ??
        (existingMeta as { matchName?: string | null })?.matchName ??
        null,
      tournamentId:
        meta?.tournamentId ??
        (existingMeta as { tournamentId?: string | null })?.tournamentId ??
        null,
      tournamentName:
        meta?.tournamentName ??
        (existingMeta as { tournamentName?: string | null })?.tournamentName ??
        null,
      mapAsset: {
        imageUrl: state.map.imageUrl ?? mapConfig?.imageUrl,
        worldSize: state.map.worldSize ?? mapConfig?.worldSize,
      },
    };
    mergedMeta.sessionId = meta?.sessionId ?? mergedMeta.sessionId ?? null;

    const baseState: NormalizedMatchState = {
      ...state,
      map: {
        ...state.map,
        name: mapName ?? 'UNKNOWN',
        worldSize: state.map.worldSize ?? mapConfig?.worldSize,
        imageUrl: state.map.imageUrl ?? mapConfig?.imageUrl,
      },
      teams: teams.map((t) => ({
        ...t,
        logoUrl: this.resolveTeamLogo(t.logoUrl),
      })),
      summary,
      meta: mergedMeta,
      focus: this.mergeFocus(state.focus, teams) ?? undefined,
    };
    return baseState;
  }

  private mergeFocus(
    focus: NormalizedMatchState['focus'] | Record<string, unknown> | undefined,
    teams: NormalizedTeamState[],
  ) {
    if (!focus || typeof focus !== 'object') return undefined;
    const focusObj = focus as Record<string, unknown> & {
      teamId?: string;
      teamLogoUrl?: string | null;
      photoUrl?: string | null;
    };
    const teamId =
      typeof focusObj.teamId === 'string' ? focusObj.teamId : undefined;
    const team = teamId ? teams.find((t) => t.teamId === teamId) : null;
    return {
      ...focusObj,
      teamId,
      teamLogoUrl: this.resolveTeamLogo(
        focusObj.teamLogoUrl ?? team?.logoUrl ?? null,
      ),
      photoUrl: this.resolvePlayerPhoto(
        typeof focusObj.photoUrl === 'string' ? focusObj.photoUrl : null,
      ),
    };
  }

  private resolveTeamLogo(url?: string | null) {
    return url || '/assets/logos/default-logo.svg';
  }

  private resolvePlayerPhoto(url?: string | null) {
    return url || '/assets/players/default-player.svg';
  }

  private mergeTeams(
    state: NormalizedMatchState,
    meta: MatchMeta | null,
  ): NormalizedTeamState[] {
    const incoming = state.teams ?? [];
    const metaByTeam = new Map<string, MetaTeam>();
    const metaBySlot = new Map<number, MetaTeam>();
    (meta?.teams ?? []).forEach((team) => {
      metaByTeam.set(team.teamId, team);
      metaBySlot.set(team.slot, team);
    });

    const merged: NormalizedTeamState[] = [];
    const seen = new Set<string>();

    incoming.forEach((team, idx) => {
      const metaTeam = team.teamId ? metaByTeam.get(team.teamId) : undefined;
      const slotMeta = metaBySlot.get(team.slot);
      const attachedMeta = metaTeam ?? slotMeta;
      const stat = team.teamId ? meta?.stats?.[team.teamId] : undefined;
      const aliveCount = this.resolveAliveCount(team);
      merged.push({
        ...team,
        teamId: team.teamId ?? attachedMeta?.teamId,
        slot: team.slot ?? attachedMeta?.slot ?? idx + 1,
        name: team.name ?? attachedMeta?.name ?? undefined,
        tag: team.tag ?? attachedMeta?.tag ?? undefined,
        logoUrl: team.logoUrl ?? attachedMeta?.logoUrl ?? undefined,
        kills: team.kills ?? stat?.kills ?? undefined,
        placement: team.placement ?? stat?.placement ?? undefined,
        points: team.points ?? stat?.totalPoints ?? undefined,
        aliveCount,
        eliminated: team.eliminated ?? aliveCount === 0,
        players: team.players ?? [],
      });
      if (team.teamId) seen.add(team.teamId);
    });

    (meta?.teams ?? []).forEach((team) => {
      if (seen.has(team.teamId)) return;
      const stat = meta?.stats?.[team.teamId];
      merged.push({
        slot: team.slot,
        teamId: team.teamId,
        name: team.name ?? undefined,
        tag: team.tag ?? undefined,
        logoUrl: team.logoUrl ?? undefined,
        aliveCount: 0,
        eliminated: false,
        kills: stat?.kills ?? undefined,
        placement: stat?.placement ?? undefined,
        points: stat?.totalPoints ?? undefined,
        players: [],
      });
    });

    merged.sort((a, b) => {
      const aSlot = a.slot ?? 999;
      const bSlot = b.slot ?? 999;
      return aSlot - bSlot;
    });

    return merged;
  }

  private resolveAliveCount(team: NormalizedTeamState) {
    if (
      team.aliveCount !== undefined &&
      team.aliveCount !== null &&
      Number.isFinite(team.aliveCount)
    ) {
      return team.aliveCount;
    }
    const alivePlayers = (team.players ?? []).filter(
      (p) => p.alive && !p.eliminated,
    ).length;
    return alivePlayers;
  }

  private computeSummary(
    teams: NormalizedTeamState[],
    fallback?: NormalizedMatchState['summary'],
  ): NormalizedMatchState['summary'] {
    const totalTeams = teams.length || fallback?.totalTeams || 0;
    const aliveTeams = teams.filter(
      (t) => !t.eliminated && (t.aliveCount ?? 0) > 0,
    ).length;
    const totalPlayers =
      teams.reduce((sum, team) => sum + (team.players?.length ?? 0), 0) ||
      fallback?.totalPlayers ||
      0;
    const alivePlayers =
      teams.reduce(
        (sum, team) =>
          sum +
          (team.players?.filter((p) => p.alive && !p.eliminated).length ?? 0),
        0,
      ) ||
      fallback?.alivePlayers ||
      0;

    return {
      totalTeams,
      aliveTeams,
      totalPlayers,
      alivePlayers,
      updatedAt: Date.now(),
    };
  }
}

const isRecord = (val: unknown): val is Record<string, unknown> =>
  !!val && typeof val === 'object';
