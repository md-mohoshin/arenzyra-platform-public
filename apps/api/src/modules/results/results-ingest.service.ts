import { Injectable, Logger } from '@nestjs/common';
import { GameKey, MatchDataSource } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import type { MatchStateSnapshot } from '../live-sync/match-state.client';
import { AuditService } from '../audit/audit.service';
import { ResultsEventsService } from './results-events.service';
import { ResultsService } from './results.service';
import type { MatchSummary } from './results.types';
import { deriveResultLockState, type ResultLockContext } from './results.lock';
import { resolveMatchDataSource } from '../matches/match-datasource.util';
import { isSessionMatch } from '../../common/match-context.util';
import { resolvePlacementPointsForGame } from '../../common/game-rules.util';

@Injectable()
export class ResultsIngestService {
  private readonly logger = new Logger('ResultsIngest');

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: ResultsEventsService,
    private readonly audit: AuditService,
    private readonly resultsService: ResultsService,
  ) {}

  private async loadMatch(matchId: string): Promise<MatchSummary | null> {
    return this.prisma.match
      .findFirst({
        where: { id: matchId, deletedAt: null },
        select: {
          id: true,
          organizationId: true,
          sessionId: true,
          map: true,
          game: { select: { key: true } },
          status: true,
          liveState: true,
          dataSource: true,
          dataMode: true,
          pcobSessionId: true,
          controlState: { select: { state: true } },
          tournamentId: true,
          tournament: { select: { ownerUserId: true, organizationId: true } },
        },
      })
      .then((m): MatchSummary | null => {
        if (!m) {
          return null;
        }
        if (!isSessionMatch(m) && (!m.tournamentId || !m.tournament)) {
          return null;
        }
        return {
          ...m,
          organizationId: m.organizationId ?? null,
          sessionId: m.sessionId ?? null,
          tournamentId: m.tournamentId ?? null,
          tournament: m.tournament ?? null,
          gameKey: (m.game as { key?: string } | null)?.key ?? null,
          liveState:
            (m as { liveState?: string | null }).liveState ??
            m.controlState?.state ??
            null,
          resultLockState: deriveResultLockState({
            liveState:
              (m as { liveState?: string | null }).liveState ??
              m.controlState?.state ??
              null,
          } as ResultLockContext),
        };
      });
  }

  private toStringValue(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }

  private normalizePlayerName(value: unknown): string {
    return (this.toStringValue(value) ?? '').toLowerCase();
  }

  private normalizeTeamLookup(value: unknown): string {
    return (this.toStringValue(value) ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  private toFiniteInteger(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed.length) {
        return null;
      }
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) {
        return Math.trunc(parsed);
      }
    }
    return null;
  }

  private registerUniqueTeamLookup(
    map: Map<string, string | null>,
    value: unknown,
    teamId: string,
  ): void {
    const key = this.normalizeTeamLookup(value);
    if (!key) {
      return;
    }
    const existing = map.get(key);
    if (existing === undefined) {
      map.set(key, teamId);
      return;
    }
    if (existing !== teamId) {
      map.set(key, null);
    }
  }

  private resolveManagedTeamId(
    team: Pick<
      MatchStateSnapshot['teams'][number],
      'id' | 'slot' | 'name' | 'tag'
    >,
    lookups: {
      mapByLiveId: Map<string, string>;
      slotByTeamId: Map<
        string,
        { teamId: string | null; team?: { id: string } | null }
      >;
      slotByNumber: Map<
        number,
        { teamId: string | null; team?: { id: string } | null }
      >;
      teamIdByName: Map<string, string | null>;
      teamIdByTag: Map<string, string | null>;
    },
  ): string | null {
    const directId = this.toStringValue(team.id);
    if (directId) {
      const slotDirect = lookups.slotByTeamId.get(directId);
      if (slotDirect?.teamId) {
        return slotDirect.teamId;
      }
      if (slotDirect?.team?.id) {
        return slotDirect.team.id;
      }
      const mapped = lookups.mapByLiveId.get(directId);
      if (mapped) {
        return mapped;
      }
    }

    const slotNumber =
      this.toFiniteInteger(team.slot) ?? this.toFiniteInteger(team.id);
    if (slotNumber !== null) {
      const slotMatch = lookups.slotByNumber.get(slotNumber);
      if (slotMatch?.teamId) {
        return slotMatch.teamId;
      }
      if (slotMatch?.team?.id) {
        return slotMatch.team.id;
      }
    }

    const byName = lookups.teamIdByName.get(
      this.normalizeTeamLookup(team.name),
    );
    if (byName) {
      return byName;
    }

    const byTag = lookups.teamIdByTag.get(this.normalizeTeamLookup(team.tag));
    if (byTag) {
      return byTag;
    }

    return null;
  }

  private payloadExternalPlayerId(player: {
    playerOpenId?: string | null;
    playerOpenID?: string | null;
    playerId?: string | null;
    inGameId?: string | null;
    externalPlayerId?: string | null;
  }) {
    return (
      this.toStringValue(player.playerOpenId) ??
      this.toStringValue(player.playerOpenID) ??
      this.toStringValue(player.externalPlayerId) ??
      this.toStringValue(player.playerId) ??
      this.toStringValue(player.inGameId) ??
      null
    );
  }

  async ingest(matchId: string, snapshot: MatchStateSnapshot | null) {
    if (!snapshot?.teams?.length) return;
    try {
      const match = await this.loadMatch(matchId);
      if (!match) return;

      const liveIds = snapshot.teams
        .map((t) => t.id)
        .filter((id): id is string => Boolean(id));
      const mappings = await this.prisma.teamMapping.findMany({
        where: {
          matchId,
          liveTeam: { liveId: { in: liveIds } },
          managedTeamId: { not: null },
        },
        select: { managedTeamId: true, liveTeam: { select: { liveId: true } } },
      });
      const mapByLiveId = new Map<string, string>();
      mappings.forEach((m) => {
        if (m.liveTeam?.liveId && m.managedTeamId) {
          mapByLiveId.set(m.liveTeam.liveId, m.managedTeamId);
        }
      });

      const slotResults = await this.prisma.matchSlotResult.findMany({
        where: { matchId },
        include: {
          players: true,
          team: {
            select: {
              id: true,
              name: true,
              tag: true,
            },
          },
        },
      });
      const slotByTeam = new Map(
        slotResults
          .filter((sr) => sr.teamId)
          .map((sr) => [sr.teamId as string, sr]),
      );
      const slotByNumber = new Map(
        slotResults
          .filter(
            (sr): sr is (typeof slotResults)[number] & { slotNumber: number } =>
              Number.isFinite(sr.slotNumber),
          )
          .map((sr) => [Math.trunc(sr.slotNumber), sr] as const),
      );
      const teamIdByName = new Map<string, string | null>();
      const teamIdByTag = new Map<string, string | null>();
      for (const slot of slotResults) {
        const managedTeamId = slot.teamId ?? slot.team?.id ?? null;
        if (!managedTeamId) {
          continue;
        }
        this.registerUniqueTeamLookup(
          teamIdByName,
          slot.team?.name ?? null,
          managedTeamId,
        );
        this.registerUniqueTeamLookup(
          teamIdByTag,
          slot.team?.tag ?? null,
          managedTeamId,
        );
      }

      let killChanged = false;
      let placementPointsChanged = false;
      const overlayResults: Array<{
        teamId: string;
        placement: number | null;
        kills: number | null;
        points: number | null;
      }> = [];

      await this.prisma.$transaction(async (tx) => {
        for (const team of snapshot.teams ?? []) {
          const managedTeamId = this.resolveManagedTeamId(team, {
            mapByLiveId,
            slotByTeamId: slotByTeam,
            slotByNumber,
            teamIdByName,
            teamIdByTag,
          });
          if (!managedTeamId) continue;
          const slot = slotByTeam.get(managedTeamId);
          if (!slot) continue;

          const kills = Number.isFinite(team.kills)
            ? Math.max(0, Math.trunc(team.kills ?? 0))
            : 0;
          const placementRaw =
            team.placement !== undefined && team.placement !== null
              ? Number(team.placement)
              : null;
          const placement =
            placementRaw && Number.isFinite(placementRaw)
              ? Math.trunc(placementRaw)
              : null;

          if (kills !== (slot.totalKills ?? 0)) killChanged = true;
          const placementPoints = this.placementPoints(
            placement,
            match.gameKey,
          );
          if (placementPoints !== (slot.placementPoints ?? 0)) {
            placementPointsChanged = true;
          }

          const points = placementPoints + kills;

          await tx.matchSlotResult.update({
            where: { id: slot.id },
            data: {
              wasPresentInMatch: true,
              placement,
              totalKills: kills,
              placementPoints,
              points,
            },
          });

          overlayResults.push({
            teamId: managedTeamId,
            placement,
            kills,
            points,
          });
        }
      });

      await this.resultsService.recalculateMatchResults(match.id);
      this.events.emitResultsUpdated(match.id, 0, { source: 'API' });
      this.events.emitLeaderboardUpdated(match.id);
      this.events.emitOverlayPayload(match.id, 1, {
        results: overlayResults,
        status: snapshot.status ?? 'API',
      });

      try {
        await this.audit.log({
          organizationId:
            match.organizationId ?? match.tournament?.organizationId ?? null,
          userId: 'system',
          action: 'MATCH_RESULT_EDIT',
          entityType: 'MATCH_SLOT_RESULT',
          entityId: matchId,
          before: null,
          after: {
            source: snapshot.status ?? 'API',
            teams: overlayResults.length,
          },
          source: 'SYSTEM',
          reason: snapshot.status ?? 'API ingest',
        });
      } catch {
        // ignore audit failures
      }

      if (killChanged || placementPointsChanged) {
        this.events.emitMatchUpdate(match.id, { reason: 'auto-results' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Auto results ingest skipped: ${message}`);
    }
  }

  private computePubgPoints(
    placement: number | null | undefined,
    kills: number | null | undefined,
  ): number {
    // Default to PUBG-style scoring when game key is unavailable; caller guards non-PUBG elsewhere.
    const placementPoints =
      placement === 1
        ? 10
        : placement === 2
          ? 6
          : placement === 3
            ? 5
            : placement === 4
              ? 4
              : placement === 5
                ? 3
                : placement === 6
                  ? 2
                  : placement === 7 || placement === 8
                    ? 1
                    : 0;
    const killPoints = Math.max(0, kills ?? 0);
    return placementPoints + killPoints;
  }

  /**
   * Ingest slot-based API results (e.g., Shadow Tracker / PCOB).
   * Allows writes even when manual lock is on; manual edits can override afterward.
   */
  async ingestApiMatchResults(
    matchId: string,
    payload: {
      slots?: Array<{
        slotNumber?: number | null;
        placement?: number | null;
        teamKills?: number | null;
        players?: Array<{
          playerId?: string | null;
          inGameId?: string | null;
          name?: string | null;
          kills?: number | null;
        }> | null;
      }>;
      meta?: { source?: string | null; status?: string | null };
    },
  ) {
    if (!payload?.slots?.length) return;
    const match = await this.loadMatch(matchId);
    if (!match) return;
    await this.resultsService.ensureResultsFromSlots(matchId);
    const resolvedSource = resolveMatchDataSource(match);
    const isApi = resolvedSource === MatchDataSource.API;

    const slotNumbers = payload.slots
      .map((s) => s.slotNumber)
      .filter((n): n is number => Number.isFinite(n));
    if (!slotNumbers.length) return;

    let killChanged = false;
    let placementPointsChanged = false;

    await this.prisma.$transaction(async (tx) => {
      const slotResults = await tx.matchSlotResult.findMany({
        where: { matchId, slotNumber: { in: slotNumbers } },
        include: {
          players: {
            include: {
              player: {
                select: {
                  externalId: true,
                  externalPlayerId: true,
                },
              },
            },
          },
        },
      });
      const slotMap = new Map(slotResults.map((sr) => [sr.slotNumber, sr]));

      for (const slotPayload of payload.slots ?? []) {
        const slotNumber = slotPayload.slotNumber;
        if (!Number.isFinite(slotNumber)) continue;
        const slotResult = slotMap.get(slotNumber as number);
        if (!slotResult) continue;

        const placement =
          slotPayload.placement && Number.isFinite(slotPayload.placement)
            ? Math.min(25, Math.max(1, Math.trunc(slotPayload.placement)))
            : (slotResult.placement ?? null);

        let totalKills: number;
        if (Number.isFinite(slotPayload.teamKills)) {
          totalKills = Math.max(0, Math.trunc(slotPayload.teamKills ?? 0));
        } else if (slotPayload.players?.length) {
          totalKills = slotPayload.players.reduce(
            (sum, p) => sum + Math.max(0, Math.trunc(p.kills ?? 0)),
            0,
          );
        } else {
          totalKills = slotResult.totalKills ?? 0;
        }
        if (totalKills !== (slotResult.totalKills ?? 0)) killChanged = true;

        // Reconcile player kills
        if (slotPayload.players?.length) {
          const byExternalPlayerId = new Map(
            slotResult.players
              .map((p) => [
                p.player?.externalPlayerId ?? p.player?.externalId ?? null,
                p,
              ])
              .filter(
                (
                  entry,
                ): entry is [string, (typeof slotResult.players)[number]] =>
                  Boolean(entry[0]),
              ),
          );
          const byName = new Map(
            slotResult.players
              .filter((p) => p.playerName)
              .map((p) => [this.normalizePlayerName(p.playerName), p]),
          );

          for (const apiPlayer of slotPayload.players) {
            const kills = Math.max(0, Math.trunc(apiPlayer.kills ?? 0));
            const externalPlayerId = this.payloadExternalPlayerId(apiPlayer);
            const matchById = externalPlayerId
              ? byExternalPlayerId.get(externalPlayerId)
              : undefined;
            const matchByName =
              !matchById && apiPlayer.name
                ? byName.get(this.normalizePlayerName(apiPlayer.name))
                : undefined;
            const target = matchById ?? matchByName;
            if (!target) continue;
            await tx.matchSlotPlayerResult.update({
              where: { id: target.id },
              data: { kills },
            });
          }
        }

        const placementPoints = this.placementPoints(placement, match.gameKey);
        if (placementPoints > 0) {
          const prevPlacementPoints = slotResult.placementPoints ?? 0;
          if (placementPoints !== prevPlacementPoints) {
            placementPointsChanged = true;
          }
        }

        const points = placementPoints + totalKills;

        await tx.matchSlotResult.update({
          where: { id: slotResult.id },
          data: {
            wasPresentInMatch: true,
            placement,
            totalKills,
            placementPoints,
            points,
          },
        });
      }

      await this.resultsService.syncMatchPlayers(matchId, { tx });
    });

    try {
      await this.audit.log({
        organizationId:
          match.organizationId ?? match.tournament?.organizationId ?? null,
        userId: 'system',
        action: 'MATCH_RESULT_EDIT',
        entityType: 'MATCH_SLOT_RESULT',
        entityId: matchId,
        before: null,
        after: { source: payload.meta?.source ?? 'API', slots: slotNumbers },
        source: 'SYSTEM',
        reason: payload.meta?.source ?? 'API ingest',
      });
    } catch {
      // ignore audit failures
    }

    // Recalculate totals/ranking immediately for API-driven matches
    if (isApi) {
      await this.resultsService.recalculateMatchResults(match.id);
      if (killChanged || placementPointsChanged) {
        this.events.emitMatchUpdate(match.id, { reason: 'api-results' });
      }
    } else {
      this.events.emitResultsUpdated(match.id, 0, {
        source: payload.meta?.source ?? 'API',
      });
    }
  }

  private placementPoints(
    placement: number | null | undefined,
    gameKey: string | null | undefined,
  ): number {
    const normalized = Object.values(GameKey).includes(gameKey as GameKey)
      ? (gameKey as GameKey)
      : GameKey.PUBG_MOBILE;
    return resolvePlacementPointsForGame(placement, normalized);
  }
}
