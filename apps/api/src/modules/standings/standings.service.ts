import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DataMode,
  MatchDataSource,
  GameKey,
  LiveState,
  MatchStatus,
  Prisma,
  Role,
} from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth.types';
import { requireOrgMatch } from '../../common/org/org.util';
import { isPresentInMatch } from '../../common/results-presence.util';
import { PrismaService } from '../../db/prisma.service';
import { resolveMatchDataSource } from '../matches/match-datasource.util';

type RuleConfig = {
  placementPoints?: Record<number, number>;
  killPoints?: number;
};

type StandingRow = {
  rank: number;
  teamId: string;
  placement: number | null;
  placementPoints: number;
  totalKills: number;
  totalPoints: number;
  bonusPoints: number;
  penaltyPoints: number;
  team?: {
    id: string;
    name: string | null;
    tag: string | null;
    logoUrl: string | null;
    logoLightUrl: string | null;
    logoDarkUrl: string | null;
  } | null;
};

type SlotTotals = {
  placement: number | null;
  placementPoints: number;
  kills: number;
  totalPoints: number;
};

type MatchLite = {
  id: string;
  organizationId: string | null;
  tournamentId: string;
  status: MatchStatus | null;
  liveState: LiveState | null;
  dataSource: string | null;
  dataMode: string | null;
  pcobSessionId?: string | null;
  controlState?: {
    metaJson?: Prisma.JsonValue | null;
    state?: string | null;
    resultsManualLock?: boolean | null;
    resultsForceUnlock?: boolean | null;
  } | null;
  tournament: {
    organizationId: string | null;
    ownerUserId: string | null;
    rulesetId: string | null;
    ruleset: Prisma.JsonValue | null;
    game: GameKey;
  };
  ruleset: {
    id: string;
    config: Prisma.JsonValue | null;
    gameKey: GameKey;
  } | null;
};

const asJsonRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const toTimestampMs = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.getTime() : null;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

@Injectable()
export class StandingsService {
  constructor(private readonly prisma: PrismaService) {}

  private upper(value?: string | null) {
    return (value ?? '').toString().toUpperCase();
  }

  private defaultRuleset(game?: GameKey | null): RuleConfig {
    void game; // keep hook for future game-specific defaults
    return {
      placementPoints: {
        1: 10,
        2: 6,
        3: 5,
        4: 4,
        5: 3,
        6: 2,
        7: 1,
        8: 1,
      },
      killPoints: 1,
    };
  }

  private placementPoints(
    placement: number | null | undefined,
    table: Record<number, number>,
  ): number {
    if (!placement || placement <= 0) return 0;
    return table[placement] ?? 0;
  }

  private isManualSource(match: {
    dataSource?: string | null;
    dataMode?: string | null;
    pcobSessionId?: string | null;
  }) {
    const src = resolveMatchDataSource({
      dataSource: match.dataSource as MatchDataSource,
      dataMode: match.dataMode as DataMode,
      pcobSessionId: match.pcobSessionId ?? null,
    });
    return src === MatchDataSource.MANUAL;
  }

  private isEnded(match: {
    status?: MatchStatus | null;
    liveState?: LiveState | null;
  }) {
    const status = this.upper(match.status as string);
    const live = this.upper(match.liveState as string);
    const endedStates = ['ENDED', 'COMPLETED', 'CONFIRMED'];
    return endedStates.includes(status) || endedStates.includes(live);
  }

  private canUseSnapshotAliveState(
    match: MatchLite,
    state: Record<string, unknown> | null,
  ): boolean {
    if (!state) {
      return false;
    }

    const matchEnded = this.isEnded(match);
    const snapshotStatus = this.upper(
      (state.status as string | null | undefined) ?? null,
    );
    if (!matchEnded && ['ENDED', 'LOCKED'].includes(snapshotStatus)) {
      return false;
    }

    if (matchEnded) {
      return true;
    }

    const meta = asJsonRecord(match.controlState?.metaJson);
    const runtime = asJsonRecord(meta?.telemetryRuntime);
    const freshnessMs =
      toTimestampMs(meta?.telemetryUpdatedAt) ??
      toTimestampMs(runtime?.lastAcceptedAt);
    if (freshnessMs === null) {
      return false;
    }

    const snapshotAcceptedAtMs = toTimestampMs(state.telemetryAcceptedAt);
    const snapshotUpdatedAtMs = toTimestampMs(state.updatedAt);
    return (snapshotAcceptedAtMs ?? snapshotUpdatedAtMs ?? -1) >= freshnessMs;
  }

  private async resolveRuleset(match: MatchLite): Promise<RuleConfig> {
    if (match.ruleset?.config) {
      return (
        (match.ruleset.config as RuleConfig) ??
        this.defaultRuleset(match.tournament.game)
      );
    }
    if (match.tournament.rulesetId) {
      const rs = await this.prisma.ruleset.findUnique({
        where: { id: match.tournament.rulesetId },
        select: { config: true, gameKey: true },
      });
      if (rs?.config) {
        return (rs.config as RuleConfig) ?? this.defaultRuleset(rs.gameKey);
      }
    }
    if (match.tournament.ruleset) {
      return (
        (match.tournament.ruleset as RuleConfig) ??
        this.defaultRuleset(match.tournament.game)
      );
    }
    return this.defaultRuleset(match.tournament.game);
  }

  private ensureEditable(
    actor: AuthUser | null | undefined,
    ownerUserId: string | null,
  ) {
    if (!actor) return false;
    if (actor.role === Role.SUPER_ADMIN || actor.actorRole === Role.SUPER_ADMIN)
      return true;
    const actorId = actor.actorId ?? actor.id;
    return ownerUserId ? actorId === ownerUserId : false;
  }

  private async ensureMatch(
    matchId: string,
    actor?: AuthUser | null,
  ): Promise<MatchLite & { ownerUserId: string | null }> {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        id: true,
        organizationId: true,
        tournamentId: true,
        status: true,
        liveState: true,
        dataSource: true,
        dataMode: true,
        tournament: {
          select: {
            organizationId: true,
            ownerUserId: true,
            rulesetId: true,
            ruleset: true,
            game: true,
          },
        },
        ruleset: { select: { id: true, config: true, gameKey: true } },
        controlState: {
          select: {
            metaJson: true,
            state: true,
            resultsManualLock: true,
            resultsForceUnlock: true,
          },
        },
      },
    });

    if (!match) {
      throw new NotFoundException('Match not found');
    }
    if (!match.tournamentId || !match.tournament) {
      throw new BadRequestException(
        'Session matches are not supported by standings',
      );
    }
    const orgId =
      match.tournament.organizationId ?? match.organizationId ?? null;
    if (orgId && actor) {
      requireOrgMatch(actor ?? null, orgId);
    }
    const ownerUserId = match.tournament.ownerUserId ?? null;
    if (actor && !this.ensureEditable(actor, ownerUserId)) {
      throw new BadRequestException(
        'Not allowed to access standings for this match',
      );
    }
    return { ...(match as MatchLite), ownerUserId };
  }

  async deriveAliveTeams(match: MatchLite): Promise<number | null> {
    const snapshot = await this.prisma.matchStateSnapshot.findUnique({
      where: { matchId: match.id },
      select: { stateJson: true },
    });
    const state =
      snapshot?.stateJson &&
      typeof snapshot.stateJson === 'object' &&
      !Array.isArray(snapshot.stateJson)
        ? (snapshot.stateJson as Record<string, unknown>)
        : null;
    if (this.canUseSnapshotAliveState(match, state)) {
      if (
        typeof state?.teamsAlive === 'number' &&
        Number.isFinite(state.teamsAlive)
      ) {
        return state.teamsAlive;
      }
      const teamsRecord =
        state?.teams &&
        typeof state.teams === 'object' &&
        !Array.isArray(state.teams)
          ? (state.teams as Record<string, unknown>)
          : null;
      if (teamsRecord) {
        const count = Object.values(teamsRecord).filter((team) => {
          if (!team || typeof team !== 'object' || Array.isArray(team)) {
            return false;
          }
          const alivePlayers = (team as { alivePlayers?: unknown })
            .alivePlayers;
          return typeof alivePlayers === 'number' && alivePlayers > 0;
        }).length;
        if (count > 0) {
          return count;
        }
      }
    }

    const players = await this.prisma.matchSlotPlayerResult.findMany({
      where: { slotResult: { matchId: match.id } },
      select: {
        isAlive: true,
        slotResult: { select: { teamId: true, wasPresentInMatch: true } },
      },
    });
    if (!players.length) return null;

    const aliveTeams = new Set<string>();
    for (const p of players) {
      const alive = p.isAlive === true;
      if (!alive) continue;
      if (!isPresentInMatch(p.slotResult?.wasPresentInMatch)) continue;
      const teamId = p.slotResult?.teamId ?? null;
      if (teamId) aliveTeams.add(teamId);
    }
    return aliveTeams.size || null;
  }

  private async syncApiLock(
    match: MatchLite,
    aliveTeams: number | null,
    isManual: boolean,
  ) {
    // Manual/referee-entered matches stay editable; clear lingering locks.
    if (isManual) {
      const current = await this.prisma.matchSlotResult.findFirst({
        where: { matchId: match.id, isLocked: true },
        select: { id: true },
      });
      if (current) {
        await this.prisma.matchSlotResult.updateMany({
          where: { matchId: match.id },
          data: { isLocked: false },
        });
      }
      return false;
    }

    const lockedBecauseEnded = this.isEnded(match);

    let shouldLock = lockedBecauseEnded;
    if (!lockedBecauseEnded && aliveTeams !== null) {
      shouldLock = aliveTeams <= 1;
    }

    const current = await this.prisma.matchSlotResult.findFirst({
      where: { matchId: match.id, isLocked: true },
      select: { id: true },
    });

    if (!!current === shouldLock) return shouldLock;

    await this.prisma.matchSlotResult.updateMany({
      where: { matchId: match.id },
      data: { isLocked: shouldLock },
    });
    return shouldLock;
  }

  async canEditResults(matchId: string) {
    const match = await this.ensureMatch(matchId, null);
    const aliveTeams = await this.deriveAliveTeams(match);
    const isManual = this.isManualSource(match);

    const controlMeta =
      (match.controlState?.metaJson as {
        resultFinalized?: boolean;
        finalizedAt?: string | null;
      } | null) ?? null;

    const slotsLocked = await this.prisma.matchSlotResult.findFirst({
      where: { matchId, isLocked: true },
      select: { id: true },
    });

    let locked = false;
    const isFinal = controlMeta?.resultFinalized === true;

    if (match.controlState?.resultsManualLock) locked = true;
    if (match.controlState?.resultsForceUnlock) locked = false;
    if (isFinal) locked = true;

    const enforced = await this.syncApiLock(match, aliveTeams, isManual);
    if (enforced !== null) locked = enforced || locked;

    // If slots are still marked locked but more than one team is alive, treat as unlocked.
    if (slotsLocked && aliveTeams !== null && aliveTeams > 1) {
      locked = locked || false;
    }

    if (!isManual && this.isEnded(match)) locked = true;

    return {
      isLocked: locked,
      canEdit: !locked,
      source: isManual ? 'MANUAL' : 'API',
      aliveTeams,
      isFinal,
    };
  }

  private slotTotals(
    slot: {
      finalPlacement?: number | null;
      finalKills?: number | null;
      placement: number | null;
      placementPoints: number | null;
      totalKills: number | null;
      totalPoints: number | null;
    },
    ruleConfig: RuleConfig,
  ): SlotTotals {
    const killPoints =
      typeof ruleConfig.killPoints === 'number' ? ruleConfig.killPoints : 1;
    const placementTable = ruleConfig.placementPoints ?? {};
    const placement = slot.finalPlacement ?? slot.placement ?? null;
    const placementPoints = this.placementPoints(placement, placementTable);
    const kills = slot.finalKills ?? slot.totalKills ?? 0;
    const totalPoints =
      slot.totalPoints ?? placementPoints + kills * killPoints;
    return { placement, placementPoints, kills, totalPoints };
  }

  private async upsertResultMeta(
    matchId: string,
    patch: Record<string, unknown>,
  ) {
    const now = new Date();
    const current = await this.prisma.matchControlState.findUnique({
      where: { matchId },
      select: { metaJson: true, organizationId: true },
    });
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        organizationId: true,
        tournament: { select: { organizationId: true } },
      },
    });
    const base =
      (current?.metaJson as Record<string, unknown> | null | undefined) ?? {};
    const next = { ...base, ...patch };
    const organizationId =
      current?.organizationId ??
      match?.organizationId ??
      match?.tournament?.organizationId ??
      (() => {
        throw new BadRequestException(
          'organizationId is required for standings metadata',
        );
      })();
    await this.prisma.matchControlState.upsert({
      where: { matchId },
      update: {
        metaJson: next as Prisma.JsonObject,
        updatedAt: now,
      },
      create: {
        matchId,
        organizationId,
        metaJson: next as Prisma.JsonObject,
      },
    });
  }

  async computeMatchStandings(matchId: string) {
    const match = await this.ensureMatch(matchId, null);
    const ruleConfig = await this.resolveRuleset(match);
    const organizationId =
      match.organizationId ?? match.tournament.organizationId ?? null;
    if (!organizationId) {
      throw new BadRequestException(
        'organizationId is required for standings computation',
      );
    }

    const slotResults = await this.prisma.matchSlotResult.findMany({
      where: { matchId, wasPresentInMatch: true },
      include: {
        team: {
          select: {
            id: true,
            name: true,
            tag: true,
            logoUrl: true,
            logoLightUrl: true,
            logoDarkUrl: true,
          },
        },
      },
      orderBy: [
        { placement: 'asc' },
        { totalPoints: 'desc' },
        { totalKills: 'desc' },
      ],
    });

    const rows: StandingRow[] = slotResults
      .filter((sr) => Boolean(sr.teamId))
      .map((sr) => {
        const totals = this.slotTotals(sr, ruleConfig);
        return {
          rank: 0,
          teamId: sr.teamId as string,
          placement: totals.placement,
          placementPoints: totals.placementPoints,
          totalKills: totals.kills,
          totalPoints: totals.totalPoints,
          bonusPoints: 0,
          penaltyPoints: 0,
          team: sr.team ?? null,
        };
      });

    rows.sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
      if (b.totalKills !== a.totalKills) return b.totalKills - a.totalKills;
      if (a.placement && b.placement) return a.placement - b.placement;
      return 0;
    });
    rows.forEach((row, idx) => {
      row.rank = idx + 1;
    });

    const aliveTeams = await this.deriveAliveTeams(match);
    const isManual =
      (match.dataSource ?? match.dataMode ?? '').toString().toUpperCase() ===
      'MANUAL';
    await this.syncApiLock(match, aliveTeams, isManual);
    const locks = await this.canEditResults(matchId);

    return {
      standings: rows,
      organizationId,
      matchId,
      computedAt: new Date().toISOString(),
      ...locks,
    };
  }

  async getStandings(matchId: string, actor?: AuthUser | null) {
    await this.ensureMatch(matchId, actor ?? null);
    return this.computeMatchStandings(matchId);
  }

  async lockStandings(matchId: string, locked: boolean) {
    await this.ensureMatch(matchId, null);
    await this.prisma.matchSlotResult.updateMany({
      where: { matchId },
      data: { isLocked: locked },
    });
    return this.getStandings(matchId, null);
  }

  async finalizeStandings(matchId: string) {
    await this.ensureMatch(matchId, null);
    await this.prisma.matchSlotResult.updateMany({
      where: { matchId },
      data: { isLocked: true },
    });
    return this.getStandings(matchId, null);
  }
}
