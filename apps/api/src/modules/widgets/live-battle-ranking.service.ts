import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MatchStatus } from '@prisma/client';
import { createHash } from 'crypto';
import type { NormalizedMatchState } from '../../types/normalized-match-state';
import { PrismaService } from '../../db/prisma.service';
import { BroadcastStateService } from '../overlay/broadcast-state.service';
import {
  MatchControlStateStore,
  type LiveMatchState,
} from '../match-control/state.store';
import type {
  LiveBattleRankingDto,
  LiveBattleRankingPlayerDto,
  LiveBattleRankingTeamDto,
} from './dto/live-battle-ranking.dto';
import { OrganizationBrandingService } from '../organization-branding/organization-branding.service';
import { resolveTeamBranding } from '../../common/team-branding.util';
import { normalizePublicAssetUrl } from '../../common/public-asset-url.util';

type TeamMeta = {
  teamId: string;
  slot?: number | null;
  name?: string | null;
  tag?: string | null;
  logoUrl?: string | null;
  players: Array<{ id: string; name: string | null }>;
};

type CachedSnapshot = {
  snapshot: LiveBattleRankingDto;
  signature: string;
  computedAt: number;
};

@Injectable()
export class LiveBattleRankingService {
  private readonly logger = new Logger('LiveBattleRankingService');
  private readonly debug = process.env.WIDGET_DEBUG === 'true';
  private readonly rosterTtlMs = 60_000;
  private readonly cache = new Map<string, CachedSnapshot>();
  private readonly rosterCache = new Map<
    string,
    { meta: Map<string, TeamMeta>; cachedAt: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly broadcastState: BroadcastStateService,
    private readonly matchStateStore: MatchControlStateStore,
    private readonly branding: OrganizationBrandingService,
  ) {}

  getCachedSnapshot(broadcastKey: string): LiveBattleRankingDto | null {
    return this.cache.get(broadcastKey)?.snapshot ?? null;
  }

  invalidateMatch(matchId: string): void {
    this.rosterCache.delete(matchId);
    for (const [broadcastKey, cached] of this.cache.entries()) {
      if (cached.snapshot.matchId === matchId) {
        this.cache.delete(broadcastKey);
      }
    }
  }

  async computeSnapshot(
    broadcastKey: string,
    opts: { strict?: boolean; force?: boolean } = {},
  ): Promise<{ snapshot: LiveBattleRankingDto | null; changed: boolean }> {
    const organization = await this.prisma.organization.findFirst({
      where: { broadcastKey, deletedAt: null },
      select: { id: true },
    });
    if (!organization) {
      if (opts.strict) throw new NotFoundException('Broadcast key not found');
      return { snapshot: null, changed: false };
    }
    const liveMatch = await this.prisma.match.findFirst({
      where: {
        organizationId: organization.id,
        deletedAt: null,
        status: MatchStatus.LIVE,
      },
      orderBy: [
        { liveAt: 'desc' },
        { startedAt: 'desc' },
        { updatedAt: 'desc' },
      ],
      select: {
        id: true,
        tournamentId: true,
        groupId: true,
        sessionId: true,
        updatedAt: true,
        status: true,
      },
    });

    if (!liveMatch) {
      const branding = await this.branding
        .getForOrganization(organization.id)
        .catch(() => null);
      const snapshot: LiveBattleRankingDto = {
        orgId: organization.id,
        matchId: null,
        tournamentId: null,
        groupId: null,
        updatedAt: new Date().toISOString(),
        teams: [],
        branding,
      };
      return this.upsertCache(broadcastKey, snapshot, opts.force ?? false);
    }

    const branding = await this.branding
      .getEffectiveBranding({
        organizationId: organization.id,
        matchId: liveMatch.id,
        sessionId: liveMatch.sessionId,
      })
      .catch(() => null);
    const snapshot = await this.buildSnapshotForMatch(
      organization.id,
      liveMatch,
      branding,
    );
    return this.upsertCache(broadcastKey, snapshot, opts.force ?? false);
  }

  private upsertCache(
    key: string,
    snapshot: LiveBattleRankingDto,
    force: boolean,
  ): { snapshot: LiveBattleRankingDto; changed: boolean } {
    const nextSignature = this.computeSignature(snapshot);
    const existing = this.cache.get(key);
    const changed = force || !existing || existing.signature !== nextSignature;
    this.cache.set(key, {
      snapshot,
      signature: nextSignature,
      computedAt: Date.now(),
    });
    return { snapshot, changed };
  }

  private computeSignature(snapshot: LiveBattleRankingDto): string {
    const payload = {
      matchId: snapshot.matchId,
      tournamentId: snapshot.tournamentId,
      groupId: snapshot.groupId,
      branding: snapshot.branding ?? null,
      teams: snapshot.teams.map((t) => ({
        teamId: t.teamId,
        slot: t.slot ?? null,
        liveKills: t.liveKills,
        alive: t.alive,
        knocked: t.knocked,
        totalPlayers: t.totalPlayers,
        eliminated: t.eliminated,
        players: (t.players ?? []).map((p) => ({
          playerId: p.playerId,
          state: p.state,
          hp: p.hp ?? null,
        })),
      })),
    };
    return createHash('sha1').update(JSON.stringify(payload)).digest('hex');
  }

  private async buildSnapshotForMatch(
    orgId: string,
    match: {
      id: string;
      tournamentId: string | null;
      groupId: string | null;
      updatedAt: Date | null;
      status: MatchStatus;
    },
    branding: Record<string, unknown> | null,
  ): Promise<LiveBattleRankingDto> {
    const [normalized, liveState] = await Promise.all([
      this.broadcastState.latest(match.id).catch(() => null),
      this.matchStateStore.get(match.id).catch(() => null),
    ]);

    const teamMeta =
      normalized && normalized.teams?.length
        ? null
        : await this.loadRoster(match.id);

    const teams =
      normalized && normalized.teams?.length
        ? this.mapNormalizedTeams(normalized, liveState)
        : this.mapLiveTeams(match.id, liveState, teamMeta);

    if (
      !teams.length ||
      teams.every(
        (t) =>
          (t.liveKills ?? 0) === 0 &&
          (t.alive ?? 0) === 0 &&
          (t.players?.length ?? 0) === 0,
      )
    ) {
      const resultTeams = await this.mapResultTeams(match.id);
      if (resultTeams.length) {
        teams.splice(0, teams.length, ...resultTeams);
      }
    }

    if (this.debug) {
      this.logger.debug(
        `[LiveBattleRanking] source=${
          normalized && normalized.teams?.length ? 'telemetry' : 'aggregate'
        } match=${match.id} teams=${teams.length}`,
      );
    }

    teams.sort((a, b) => {
      if (b.liveKills !== a.liveKills) return b.liveKills - a.liveKills;
      if (b.alive !== a.alive) return b.alive - a.alive;
      if (a.eliminated !== b.eliminated)
        return (a.eliminated ? 1 : 0) - (b.eliminated ? 1 : 0);
      const slotA = a.slot ?? Number.MAX_SAFE_INTEGER;
      const slotB = b.slot ?? Number.MAX_SAFE_INTEGER;
      return slotA - slotB;
    });

    const updatedAt =
      this.resolveTimestamp(
        normalized?.summary?.updatedAt,
        normalized?.serverTime,
        liveState?.updatedAt,
        match.updatedAt?.toISOString?.(),
      ) ?? new Date().toISOString();

    return {
      orgId,
      matchId: match.id,
      tournamentId: match.tournamentId ?? null,
      groupId: match.groupId ?? null,
      updatedAt,
      teams,
      branding,
    };
  }

  private resolveTimestamp(
    ...candidates: Array<number | string | null | undefined>
  ): string | null {
    for (const val of candidates) {
      if (typeof val === 'string' && val.trim().length) return val;
      if (typeof val === 'number' && Number.isFinite(val)) {
        const date = new Date(val);
        if (!Number.isNaN(date.getTime())) return date.toISOString();
      }
    }
    return null;
  }

  private mapNormalizedTeams(
    state: NormalizedMatchState,
    liveState: LiveMatchState | null,
  ): LiveBattleRankingTeamDto[] {
    const liveMap = new Map((liveState?.teams ?? []).map((t) => [t.teamId, t]));

    return (state.teams ?? []).map((team, idx) => {
      const slot = team.slot ?? idx + 1;
      const live = team.teamId ? liveMap.get(team.teamId) : null;
      const branding = resolveTeamBranding(team.teamId, [
        team,
        ...(live ? [live] : []),
      ]);
      const players = this.mapPlayers(team.players ?? []);

      const aliveFromPlayers = players?.filter(
        (p) => p.state === 'ALIVE',
      ).length;
      const knockedFromPlayers = players?.filter(
        (p) => p.state === 'KNOCKED',
      ).length;
      const totalPlayers =
        players?.length ??
        this.toNumber(live?.totalPlayers) ??
        this.toNumber(live?.alivePlayers) ??
        this.toNumber(team.aliveCount) ??
        0;
      const alive =
        aliveFromPlayers ??
        this.toNumber(team.aliveCount) ??
        this.toNumber(live?.alivePlayers) ??
        0;

      const liveKills =
        this.toNumber(team.kills) ?? this.toNumber(live?.kills) ?? 0;

      const eliminated =
        team.eliminated !== undefined && team.eliminated !== null
          ? team.eliminated
          : (alive ?? 0) <= 0;

      return {
        teamId: team.teamId ?? `slot-${slot}`,
        slot,
        teamName:
          team.name ?? team.tag ?? live?.name ?? live?.tag ?? branding.name,
        teamTag: team.tag ?? live?.tag ?? branding.tag,
        logoUrl: normalizePublicAssetUrl(
          team.logoUrl ?? live?.logoUrl ?? branding.logoUrl,
        ),
        liveKills,
        alive: Math.max(0, alive ?? 0),
        knocked: Math.max(0, knockedFromPlayers ?? 0),
        totalPlayers: Math.max(totalPlayers ?? 0, alive ?? 0),
        eliminated: Boolean(eliminated),
        players: players && players.length ? players : undefined,
      };
    });
  }

  private mapLiveTeams(
    _matchId: string,
    liveState: LiveMatchState | null,
    teamMeta: Map<string, TeamMeta> | null,
  ): LiveBattleRankingTeamDto[] {
    if (!liveState) return [];
    const byTeam: Map<string, TeamMeta> =
      teamMeta ?? new Map<string, TeamMeta>();

    return liveState.teams.map((team, idx) => {
      const meta: TeamMeta | undefined =
        team.teamId && byTeam.has(team.teamId)
          ? byTeam.get(team.teamId)
          : undefined;
      const branding = resolveTeamBranding(team.teamId, [
        team,
        ...(meta ? [meta] : []),
      ]);
      const normalizedPlayers: LiveBattleRankingPlayerDto[] | null =
        team.players && team.players.length > 0
          ? team.players.map((player, index) => {
              const state: LiveBattleRankingPlayerDto['state'] =
                player.alive === false
                  ? 'DEAD'
                  : player.knocked === true
                    ? 'KNOCKED'
                    : player.alive === true
                      ? 'ALIVE'
                      : 'UNKNOWN';
              return {
                playerId:
                  player.playerId ??
                  player.id ??
                  player.externalPlayerId ??
                  player.pubgPlayerId ??
                  `p-${index + 1}`,
                name:
                  player.name ??
                  player.ign ??
                  meta?.players.find(
                    (candidate) => candidate.id === player.playerId,
                  )?.name ??
                  `Player ${index + 1}`,
                hp: undefined,
                state,
              };
            })
          : null;
      const aliveFromPlayers = normalizedPlayers?.filter(
        (p) => p.state === 'ALIVE',
      ).length;
      const knockedFromPlayers = normalizedPlayers?.filter(
        (p) => p.state === 'KNOCKED',
      ).length;

      const totalPlayers =
        normalizedPlayers?.length ??
        this.toNumber(team.totalPlayers) ??
        this.toNumber(team.alivePlayers) ??
        0;
      const alive =
        aliveFromPlayers ?? this.toNumber(team.alivePlayers) ?? totalPlayers;

      const slot =
        team.slot ?? meta?.slot ?? (typeof idx === 'number' ? idx + 1 : null);

      return {
        teamId: team.teamId ?? `team-${idx + 1}`,
        slot,
        teamName: team.name ?? meta?.name ?? meta?.tag ?? branding.name,
        teamTag: team.tag ?? meta?.tag ?? branding.tag,
        logoUrl: normalizePublicAssetUrl(
          team.logoUrl ?? meta?.logoUrl ?? branding.logoUrl,
        ),
        liveKills: this.toNumber(team.kills) ?? 0,
        alive: Math.max(0, alive ?? 0),
        knocked: Math.max(0, knockedFromPlayers ?? 0),
        totalPlayers: Math.max(totalPlayers ?? 0, alive ?? 0),
        eliminated:
          (alive ?? 0) <= 0 ||
          (team.alivePlayers !== null && team.alivePlayers !== undefined
            ? team.alivePlayers <= 0
            : false),
        players: normalizedPlayers ?? undefined,
      };
    });
  }

  private mapPlayers(players: any[]): LiveBattleRankingPlayerDto[] | null {
    if (!Array.isArray(players) || players.length === 0) return null;
    return players.map((player, idx) => {
      const hp = this.toNumber(
        (player as Record<string, unknown>)?.hp ??
          (player as Record<string, unknown>)?.health,
      );
      const eliminated = Boolean(
        (player as Record<string, unknown>)?.eliminated ?? false,
      );
      const knocked = Boolean(
        (player as Record<string, unknown>)?.knocked ?? false,
      );
      const aliveFlag = (player as Record<string, unknown>)?.isAlive;
      const alive =
        typeof aliveFlag === 'boolean'
          ? aliveFlag
          : eliminated
            ? false
            : undefined;
      const state: LiveBattleRankingPlayerDto['state'] = eliminated
        ? 'DEAD'
        : knocked
          ? 'KNOCKED'
          : alive === true
            ? 'ALIVE'
            : alive === false
              ? 'DEAD'
              : 'UNKNOWN';
      return {
        playerId:
          (player as Record<string, unknown>)?.pubgAccountId?.toString?.() ??
          (player as Record<string, unknown>)?.id?.toString?.() ??
          `p-${idx + 1}`,
        name:
          (player as Record<string, unknown>)?.ign?.toString?.() ??
          (player as Record<string, unknown>)?.name?.toString?.() ??
          `Player ${idx + 1}`,
        hp: hp ?? undefined,
        state,
      };
    });
  }

  private async loadRoster(matchId: string): Promise<Map<string, TeamMeta>> {
    const cached = this.rosterCache.get(matchId);
    if (cached && Date.now() - cached.cachedAt < this.rosterTtlMs) {
      return cached.meta;
    }

    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        matchTeams: {
          where: { deletedAt: null },
          select: {
            slot: true,
            teamId: true,
            team: {
              select: {
                id: true,
                name: true,
                tag: true,
                logoUrl: true,
                players: {
                  where: { deletedAt: null, isActive: true },
                  select: { id: true, ign: true, realName: true },
                },
              },
            },
          },
        },
        matchSlots: {
          where: { deletedAt: null, teamId: { not: null } },
          select: {
            slotNumber: true,
            teamId: true,
            team: {
              select: {
                id: true,
                name: true,
                tag: true,
                logoUrl: true,
                players: {
                  where: { deletedAt: null, isActive: true },
                  select: { id: true, ign: true, realName: true },
                },
              },
            },
          },
        },
      },
    });

    const map = new Map<string, TeamMeta>();
    const mergeTeam = (
      teamId: string | null | undefined,
      slot: number | null | undefined,
      team?: {
        id: string;
        name: string | null;
        tag: string | null;
        logoUrl: string | null;
        players?: Array<{ id: string; ign: string; realName: string | null }>;
      } | null,
    ) => {
      if (!teamId) return;
      const existing = map.get(teamId) ?? { teamId, players: [] };
      const players =
        team?.players?.map((p) => ({
          id: p.id,
          name: p.realName ?? p.ign ?? null,
        })) ?? [];
      const mergedPlayers = new Map(existing.players.map((p) => [p.id, p]));
      players.forEach((p) => mergedPlayers.set(p.id, p));

      map.set(teamId, {
        teamId,
        slot: existing.slot ?? slot ?? null,
        name: existing.name ?? team?.name ?? null,
        tag: existing.tag ?? team?.tag ?? null,
        logoUrl: normalizePublicAssetUrl(
          existing.logoUrl ?? team?.logoUrl ?? null,
        ),
        players: Array.from(mergedPlayers.values()),
      });
    };

    (match?.matchSlots ?? []).forEach((ms) =>
      mergeTeam(ms.teamId, ms.slotNumber, ms.team),
    );
    (match?.matchTeams ?? []).forEach((mt) =>
      mergeTeam(mt.teamId, mt.slot, mt.team),
    );

    this.rosterCache.set(matchId, { meta: map, cachedAt: Date.now() });
    return map;
  }

  private toNumber(val: unknown): number | null {
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    if (typeof val === 'string') {
      const parsed = Number(val);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  private async mapResultTeams(
    matchId: string,
  ): Promise<LiveBattleRankingTeamDto[]> {
    const roster = await this.loadRoster(matchId).catch(
      () => new Map<string, TeamMeta>(),
    );
    const slotResults = await this.prisma.matchSlotResult.findMany({
      where: { matchId, wasPresentInMatch: true },
      include: {
        team: { select: { id: true, name: true, tag: true, logoUrl: true } },
      },
      orderBy: [{ placement: 'asc' }, { totalKills: 'desc' }],
    });

    if (!slotResults.length) return [];

    return slotResults.map((sr, idx) => {
      const slot = sr.slotNumber ?? idx + 1;
      const kills = this.toNumber(sr.totalKills) ?? 0;
      const teamId = sr.teamId ?? `slot-${slot}`;
      const branding = resolveTeamBranding(teamId, [
        { teamId: sr.teamId, team: sr.team ?? null, slot },
      ]);
      const meta = roster.get(teamId);
      const playersArr = meta?.players ?? [];
      const totalPlayers = playersArr.length || 0;
      const alive = totalPlayers > 0 ? totalPlayers : 0;
      const mappedPlayers =
        playersArr.length > 0
          ? playersArr.map((p, pidx) => ({
              playerId: p.id ?? `p-${pidx + 1}`,
              name: p.name ?? `Player ${pidx + 1}`,
              state: 'ALIVE' as const,
            }))
          : undefined;
      return {
        teamId,
        slot,
        teamName: sr.team?.name ?? sr.team?.tag ?? branding.name,
        teamTag: sr.team?.tag ?? branding.tag,
        logoUrl: normalizePublicAssetUrl(sr.team?.logoUrl ?? branding.logoUrl),
        liveKills: kills,
        alive,
        knocked: 0,
        totalPlayers,
        eliminated: alive <= 0,
        players: mappedPlayers,
      };
    });
  }
}
