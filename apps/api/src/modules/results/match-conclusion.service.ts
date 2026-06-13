import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  forwardRef,
} from '@nestjs/common';
import { GameKey, LiveState, MatchStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { type TelemetryFinalPlacementProjection } from './results.service';
import { isMatchFinishedStatus } from '../../common/match-status.util';
import { isSessionMatch } from '../../common/match-context.util';
import { compareRankingRows } from '../../common/ranking-tiebreakers.util';
import { TelemetryEngineService } from '../telemetry/telemetry-engine.service';
import type {
  MatchStateLeaderboardRow,
  ObserverMatchFinishedPayload,
} from '../observer/match-state.service';
import type { TelemetryMatchState } from '../telemetry/telemetry.types';
import { uniqueSlotPlayerNames } from '../../common/slot-player-name.util';
import { isAnonymousSlotPlayerKey } from '../../common/match-player-key.util';
import { computeSlotTotals } from '../scoring/points-core';
import {
  defaultKillPointsForGame,
  defaultPlacementPointsForGame,
} from '../../common/game-rules.util';

type MatchConclusionDbClient = PrismaService | Prisma.TransactionClient;

type ControlMeta = {
  resultFinalized?: boolean;
  finalizedAt?: string | null;
  winnerTeamId?: string | null;
  aliveTeamsAtEnd?: number | null;
  resultNeedsConfirmation?: boolean;
  resultAmbiguities?: Array<{
    code: string;
    teamIds: string[];
    placementFrom: number;
    placementTo: number;
    detectedAt: string | null;
    message: string;
  }> | null;
} | null;

export type MatchConclusionOptions = {
  winnerTeamId?: string | null;
  aliveTeams?: number | null;
  source?: string;
};

export type MatchConclusionPlan = {
  matchId: string;
  organizationId: string;
  tournamentId: string | null;
  sessionId: string | null;
  isSessionMatch: boolean;
  status: MatchStatus;
  liveState: LiveState | null;
  endedAt: Date;
  endedReason: string;
  finalizedAt: string;
  source: string;
  winnerTeamId: string | null;
  aliveTeamsAtEnd: number | null;
  resultNeedsConfirmation: boolean;
  resultAmbiguities: NonNullable<
    TelemetryFinalPlacementProjection['ambiguities']
  >;
  totalTeams: number;
  placementsAssigned: number;
  previousMeta: ControlMeta;
  nextMeta: NonNullable<ControlMeta>;
  finalState: TelemetryMatchState;
  finalProjection: TelemetryFinalPlacementProjection;
};

export type MatchConclusionComputeResult =
  | { ok: true; plan: MatchConclusionPlan }
  | {
      ok: false;
      reason:
        | 'MATCH_NOT_FOUND'
        | 'SHADOW_TELEMETRY_SUPPRESSED'
        | 'ALREADY_FINALIZED';
      status?: MatchStatus;
      finalizedAt?: string | null;
      winnerTeamId?: string | null;
    };

export type ComputedFinalTeamResult = {
  matchId: string;
  organizationId: string;
  slotNumber: number;
  teamId: string | null;
  wasPresentInMatch: boolean | null;
  placement: number | null;
  eliminatedOrder: number | null;
  eliminatedAt: Date | null;
  totalKills: number;
  manualTotalKills: boolean;
  finalPlacement: number | null;
  finalKills: number;
  finalizedAt: Date;
  placementPoints: number;
  points: number;
  totalPoints: number;
  isLocked: boolean;
  aliveAtEnd: boolean;
};

export type ComputedFinalPlayerResult = {
  matchId: string;
  organizationId: string;
  slotNumber: number;
  teamId: string;
  playerId: string | null;
  pubgAccountId: string | null;
  externalPlayerId: string | null;
  playerName: string;
  kills: number;
  knocks: number;
  assists: number;
  isKnocked: boolean;
  isAlive: boolean;
  alive: boolean;
  isAutoFilled: boolean;
  aliveAtEnd: boolean;
  knockedAtEnd: boolean;
};

export type ComputedFinalStanding = {
  matchId: string;
  organizationId: string;
  tournamentId: string;
  teamId: string;
  rank: number;
  totalKills: number;
  placementPoints: number;
  bonusPoints: number;
  penaltyPoints: number;
  totalPoints: number;
  isLocked: boolean;
  isFinal: boolean;
  computedAt: Date;
};

export type ComputedFinalResults = {
  matchId: string;
  plan: MatchConclusionPlan;
  teamResults: ComputedFinalTeamResult[];
  playerResults: ComputedFinalPlayerResult[];
  standings: ComputedFinalStanding[];
};

export type TelemetryPromotionDiagnosticTeam = {
  rawTeamId: string | null;
  rawSlot: number | null;
  rawTeamName: string | null;
  rawTeamTag: string | null;
  rawKills: number | null;
  rawAlivePlayers: number | null;
  rawTotalPlayers: number | null;
  rawPlayerCount: number;
  rawPlayerNameCount: number;
  rawPlayerIdentifierCount: number;
  canonicalTeamId: string | null;
  canonicalTeamName: string | null;
  canonicalTeamTag: string | null;
  finalResultWasPresentInMatch: boolean | null;
  presentInCanonicalAcceptedState: boolean;
  rosterPlayerCount: number;
  rosterPlayerNameCount: number;
  rosterPlayerIdentifierCount: number;
  matchedRosterIdentityCount: number;
  matchedRosterNameCount: number;
  reasonCodes: string[];
};

export type TelemetryPromotionDiagnostics = {
  computedAt: string;
  source: 'MATCH_TELEMETRY_COMPATIBILITY_RAW';
  structuralMirrorDisabled: boolean;
  rawSnapshot: {
    sequence: number | null;
    timestamp: string | null;
    teamCount: number;
    playerCount: number;
  };
  canonicalSnapshot: {
    status: string | null;
    sequence: number | null;
    updatedAt: string | null;
    teamCount: number;
  };
  rawOnlyTeams: TelemetryPromotionDiagnosticTeam[];
};

type TelemetryPromotionRosterPlayer = {
  name: string | null;
  identifiers: string[];
  names: Set<string>;
};

type TelemetryPromotionSlotContext = {
  slotNumber: number;
  teamId: string | null;
  teamName: string | null;
  teamTag: string | null;
  wasPresentInMatch: boolean | null;
  rosterPlayers: TelemetryPromotionRosterPlayer[];
};

type TelemetryPromotionCanonicalTeam = {
  teamId: string;
  teamName: string | null;
  teamTag: string | null;
};

type TelemetryPromotionRawTeamGroup = {
  rawTeamId: string | null;
  rawSlot: number | null;
  rawTeamName: string | null;
  rawTeamTag: string | null;
  rawKills: number | null;
  rawAlivePlayers: number | null;
  rawTotalPlayers: number | null;
  players: TelemetryPromotionRosterPlayer[];
  rawPlayerNames: string[];
  rawPlayerIdentifiers: string[];
};

const DEFAULT_WIDGET_TEAM_NAME = 'Arenzyra';
const DEFAULT_WIDGET_TEAM_TAG = 'AZ';

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const parseTimestampMs = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
};

const toText = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
};

const toInt = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
};

const normalizeLookup = (value: unknown): string =>
  (toText(value) ?? '').trim().toLowerCase();

const compactLookup = (value: unknown): string =>
  normalizeLookup(value).replace(/[^a-z0-9]/g, '');

@Injectable()
export class MatchConclusionService {
  private readonly logger = new Logger('MatchConclusion');
  private readonly observerTelemetryWindowMs = Math.max(
    1_000,
    Number(process.env.OBSERVER_TELEMETRY_ACTIVE_WINDOW_MS ?? 5_000),
  );
  private readonly placementAmbiguityWindowMs = Math.max(
    0,
    Number(process.env.RESULT_PLACEMENT_AMBIGUITY_WINDOW_MS ?? 1_000),
  );

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => TelemetryEngineService))
    private readonly telemetryEngine: TelemetryEngineService,
  ) {}

  private requireOrganizationId(match: {
    organizationId?: string | null;
    tournament?: { organizationId?: string | null } | null;
  }): string {
    const organizationId =
      match.organizationId ?? match.tournament?.organizationId ?? null;
    if (!organizationId) {
      throw new BadRequestException(
        'organizationId is required for match conclusion',
      );
    }
    return organizationId;
  }

  async isConcluded(matchId: string): Promise<boolean> {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        status: true,
        controlState: { select: { metaJson: true } },
      },
    });
    if (!match) return false;
    const meta = (match.controlState?.metaJson as ControlMeta) ?? null;
    if (meta?.resultFinalized) return true;
    if (isMatchFinishedStatus(match.status)) return true;
    return false;
  }

  async conclude(
    matchId: string,
    opts: MatchConclusionOptions = {},
  ): Promise<boolean> {
    const result = await this.computeConclusion(matchId, opts);
    return result.ok || result.reason === 'ALREADY_FINALIZED';
  }

  async computeConclusion(
    matchId: string,
    opts: MatchConclusionOptions = {},
    client: MatchConclusionDbClient = this.prisma,
  ): Promise<MatchConclusionComputeResult> {
    const now = new Date();
    const match = await client.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        id: true,
        organizationId: true,
        tournamentId: true,
        sessionId: true,
        status: true,
        liveState: true,
        endedAt: true,
        endedReason: true,
        pcobSessionId: true,
        tournament: { select: { organizationId: true } },
        controlState: { select: { metaJson: true } },
      },
    });
    if (!match) {
      return { ok: false, reason: 'MATCH_NOT_FOUND' };
    }

    if (opts.source === 'SHADOW_TELEMETRY') {
      const hasBoundPcobSession =
        typeof match.pcobSessionId === 'string' &&
        match.pcobSessionId.trim().length > 0;
      if (
        hasBoundPcobSession ||
        (await this.hasRecentObserverTelemetry(matchId, client))
      ) {
        this.logger.warn(
          `Ignoring shadow telemetry conclusion for observer-managed match=${matchId}`,
        );
        return { ok: false, reason: 'SHADOW_TELEMETRY_SUPPRESSED' };
      }
    }

    const meta = (match.controlState?.metaJson as ControlMeta) ?? null;
    if (meta?.resultFinalized) {
      return {
        ok: false,
        reason: 'ALREADY_FINALIZED',
        status: match.status,
        finalizedAt: meta.finalizedAt ?? null,
        winnerTeamId: meta.winnerTeamId ?? null,
      };
    }

    const finalState = await this.telemetryEngine.getState(matchId);
    const finalProjection = this.applyWinnerOverride(
      this.buildCanonicalFinalProjection(finalState),
      opts.winnerTeamId ?? null,
    );
    const endedAt =
      match.endedAt ?? new Date(finalState.endedAt ?? now.getTime());
    const finalizedAt = meta?.finalizedAt ?? endedAt.toISOString();
    const winnerTeamId = opts.winnerTeamId ?? finalProjection.winnerTeamId;
    const aliveTeamsAtEnd =
      opts.aliveTeams ?? finalProjection.aliveTeamsAtEnd ?? null;
    const resultAmbiguities = finalProjection.ambiguities ?? [];
    const nextMeta: ControlMeta = {
      ...(meta ?? {}),
      resultFinalized: true,
      finalizedAt,
      winnerTeamId,
      aliveTeamsAtEnd,
      resultNeedsConfirmation: resultAmbiguities.length > 0,
      resultAmbiguities:
        resultAmbiguities.length > 0 ? resultAmbiguities : null,
    };

    return {
      ok: true,
      plan: {
        matchId,
        organizationId: this.requireOrganizationId(match),
        tournamentId: match.tournamentId ?? null,
        sessionId: match.sessionId ?? null,
        isSessionMatch: isSessionMatch(match),
        status: match.status,
        liveState: match.liveState ?? null,
        endedAt,
        endedReason: match.endedReason ?? opts.source ?? 'API_MATCH_CONCLUDED',
        finalizedAt,
        source: opts.source ?? 'API_MATCH_CONCLUDED',
        winnerTeamId,
        aliveTeamsAtEnd,
        resultNeedsConfirmation: resultAmbiguities.length > 0,
        resultAmbiguities,
        totalTeams: finalProjection.totalTeams,
        placementsAssigned: finalProjection.placementsAssigned,
        previousMeta: meta,
        nextMeta,
        finalState,
        finalProjection,
      },
    };
  }

  async computeFinalResults(
    matchId: string,
    opts: MatchConclusionOptions = {},
    client: MatchConclusionDbClient = this.prisma,
  ): Promise<ComputedFinalResults> {
    const computed = await this.computeConclusion(matchId, opts, client);
    if (!computed.ok) {
      if (computed.reason === 'MATCH_NOT_FOUND') {
        throw new BadRequestException('Match not found');
      }
      if (computed.reason === 'ALREADY_FINALIZED') {
        throw new ConflictException('Match is already finalized');
      }
      throw new BadRequestException(
        `Unable to compute final results: ${computed.reason}`,
      );
    }

    const plan = computed.plan;
    const finalizedAt = new Date(plan.finalizedAt);
    const ruleset = await this.resolveRulesetConfig(matchId, client);
    const slots = await client.matchSlot.findMany({
      where: { matchId, deletedAt: null },
      select: {
        slotNumber: true,
        teamId: true,
        team: {
          select: {
            players: {
              where: { deletedAt: null },
              select: {
                id: true,
                ign: true,
                realName: true,
                externalPlayerId: true,
                playerOpenId: true,
              },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
      orderBy: { slotNumber: 'asc' },
    });
    const existingSlotResults = await client.matchSlotResult.findMany({
      where: { matchId },
      select: {
        slotNumber: true,
        teamId: true,
        placement: true,
        manualTotalKills: true,
        totalKills: true,
        wasPresentInMatch: true,
        players: {
          select: {
            playerId: true,
            pubgAccountId: true,
            externalPlayerId: true,
            playerName: true,
            kills: true,
            knocks: true,
            assists: true,
            isKnocked: true,
            isAlive: true,
            alive: true,
            isAutoFilled: true,
          },
          orderBy: { playerName: 'asc' },
        },
      },
    });
    const existingBySlot = new Map(
      existingSlotResults.map((slot) => [slot.slotNumber, slot] as const),
    );
    const explicitPresence = this.hasExplicitTelemetryPresence(plan.finalState);
    const activeTeamIds = explicitPresence
      ? this.collectActiveTelemetryTeamIds(plan.finalState)
      : new Set(Object.keys(plan.finalProjection.teams));
    const playersByTeamId = this.collectTelemetryPlayersByTeam(
      plan.finalState,
      { observedOnly: explicitPresence },
    );

    const teamResults: ComputedFinalTeamResult[] = [];
    const playerResults: ComputedFinalPlayerResult[] = [];

    for (const slot of slots) {
      const teamId = slot.teamId ?? null;
      const existing = existingBySlot.get(slot.slotNumber) ?? null;
      const projectedTeam = teamId
        ? (plan.finalProjection.teams[teamId] ?? null)
        : null;
      const isActiveTeam = Boolean(
        teamId && projectedTeam && activeTeamIds.has(teamId),
      );
      const wasPresentInMatch = teamId ? (isActiveTeam ? true : false) : null;
      const existingPlacement =
        typeof existing?.placement === 'number' &&
        Number.isFinite(existing.placement)
          ? Math.trunc(existing.placement)
          : null;
      const placement = isActiveTeam
        ? (projectedTeam?.placement ?? existingPlacement ?? null)
        : null;
      const eliminatedOrder =
        isActiveTeam && placement && placement > 1
          ? (projectedTeam?.eliminatedOrder ??
            Math.max(plan.finalProjection.totalTeams - placement + 1, 1))
          : null;
      const eliminatedAt =
        isActiveTeam && projectedTeam?.eliminatedAt
          ? new Date(projectedTeam.eliminatedAt)
          : isActiveTeam && placement && placement > 1
            ? plan.endedAt
            : null;
      const telemetryPlayers =
        teamId && isActiveTeam
          ? (playersByTeamId.get(teamId) ?? []).sort((left, right) =>
              left.playerId.localeCompare(right.playerId),
            )
          : [];
      const slotPlayerResults = this.buildFinalPlayerResults({
        matchId,
        organizationId: plan.organizationId,
        slotNumber: slot.slotNumber,
        teamId,
        telemetryPlayers,
        existingPlayers: existing?.players ?? [],
        rosterPlayers: slot.team?.players ?? [],
      });
      playerResults.push(...slotPlayerResults);

      const projectedKills = isActiveTeam
        ? Math.max(0, Math.trunc(projectedTeam?.totalKills ?? 0))
        : 0;
      const playerKillTotal = slotPlayerResults.reduce(
        (sum, player) => sum + Math.max(0, player.kills ?? 0),
        0,
      );
      const manualTotalKills =
        isActiveTeam &&
        (slotPlayerResults.length === 0 || playerKillTotal !== projectedKills);
      const totalKills = manualTotalKills ? projectedKills : playerKillTotal;
      const aggregates = computeSlotTotals({
        placement,
        players: slotPlayerResults,
        manualTotalKills,
        slotTotalKills: totalKills,
        placementTable: ruleset.placementPoints,
        killPointsMultiplier: ruleset.killPoints,
      });

      teamResults.push({
        matchId,
        organizationId: plan.organizationId,
        slotNumber: slot.slotNumber,
        teamId,
        wasPresentInMatch,
        placement,
        eliminatedOrder,
        eliminatedAt,
        totalKills: isActiveTeam ? aggregates.totalKills : 0,
        manualTotalKills,
        finalPlacement: placement,
        finalKills: isActiveTeam ? aggregates.totalKills : 0,
        finalizedAt,
        placementPoints: isActiveTeam ? aggregates.placementPoints : 0,
        points: isActiveTeam ? aggregates.points : 0,
        totalPoints: isActiveTeam ? aggregates.totalPoints : 0,
        isLocked: true,
        aliveAtEnd: projectedTeam?.aliveAtEnd === true,
      });
    }

    const standings = this.buildComputedStandings({
      plan,
      teamResults,
      finalizedAt,
    });

    return {
      matchId,
      plan,
      teamResults,
      playerResults,
      standings,
    };
  }

  private async hasRecentObserverTelemetry(
    matchId: string,
    client: MatchConclusionDbClient = this.prisma,
  ): Promise<boolean> {
    const row = await client.matchTelemetry.findUnique({
      where: { matchId },
      select: { payload: true },
    });
    const payload = asRecord(row?.payload ?? null);
    const observerTelemetry = asRecord(payload?.observerTelemetry);
    if (!observerTelemetry) {
      return false;
    }

    const sessionId =
      typeof observerTelemetry.sessionId === 'string'
        ? observerTelemetry.sessionId.trim()
        : '';
    if (sessionId.length > 0) {
      return true;
    }

    const receivedAtMs = parseTimestampMs(observerTelemetry.receivedAt);
    return (
      receivedAtMs !== null &&
      Date.now() - receivedAtMs <= this.observerTelemetryWindowMs
    );
  }

  private toStringValue(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }

  private async resolveRulesetConfig(
    matchId: string,
    client: MatchConclusionDbClient,
  ): Promise<{ placementPoints: Record<number, number>; killPoints: number }> {
    const match = await client.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        ruleset: { select: { config: true } },
        game: { select: { key: true } },
        tournament: {
          select: {
            game: true,
            ruleset: true,
            rulesetRef: { select: { config: true } },
          },
        },
      },
    });
    const gameKey =
      match?.game?.key ?? match?.tournament?.game ?? GameKey.PUBG_MOBILE;
    const config =
      asRecord(match?.ruleset?.config) ??
      asRecord(match?.tournament?.rulesetRef?.config) ??
      asRecord(match?.tournament?.ruleset) ??
      {};
    const placementPoints = asRecord(config.placementPoints);
    return {
      placementPoints: placementPoints
        ? (placementPoints as Record<number, number>)
        : defaultPlacementPointsForGame(gameKey),
      killPoints:
        typeof config.killPoints === 'number' &&
        Number.isFinite(config.killPoints)
          ? config.killPoints
          : defaultKillPointsForGame(gameKey),
    };
  }

  private collectTelemetryPlayersByTeam(
    state: TelemetryMatchState,
    opts: { observedOnly: boolean },
  ): Map<string, Array<TelemetryMatchState['players'][string]>> {
    const playersByTeamId = new Map<
      string,
      Array<TelemetryMatchState['players'][string]>
    >();

    for (const player of Object.values(state.players ?? {})) {
      if (opts.observedOnly && player.metadata?.observedInTelemetry !== true) {
        continue;
      }

      const bucket = playersByTeamId.get(player.teamId) ?? [];
      bucket.push(player);
      playersByTeamId.set(player.teamId, bucket);
    }

    return playersByTeamId;
  }

  private stableTelemetryPlayerId(
    player: TelemetryMatchState['players'][string],
  ): string | null {
    const playerId = this.toStringValue(player.playerId);
    if (!playerId) return null;
    if (player.metadata?.provisional === true) return null;
    if (playerId.startsWith('provisional:')) return null;
    if (isAnonymousSlotPlayerKey(playerId)) return null;
    return playerId;
  }

  private telemetryPlayerExternalId(
    player: TelemetryMatchState['players'][string],
  ): string | null {
    return this.toStringValue(
      player.metadata?.externalPlayerId ?? player.metadata?.inGameId ?? null,
    );
  }

  private telemetryPlayerPubgAccountId(
    player: TelemetryMatchState['players'][string],
  ): string | null {
    return this.toStringValue(player.metadata?.inGameId ?? null);
  }

  private buildScopedPlayerLookupKey(
    slotNumber: number,
    value?: string | null,
  ): string | null {
    const normalized = (value ?? '').trim().toLowerCase();
    return normalized.length > 0 ? `${slotNumber}:${normalized}` : null;
  }

  private buildFinalPlayerResults(params: {
    matchId: string;
    organizationId: string;
    slotNumber: number;
    teamId: string | null;
    telemetryPlayers: Array<TelemetryMatchState['players'][string]>;
    existingPlayers: Array<{
      playerId: string | null;
      pubgAccountId: string | null;
      externalPlayerId: string | null;
      playerName: string;
      kills: number | null;
      knocks: number | null;
      assists: number | null;
      isKnocked: boolean | null;
      isAlive: boolean | null;
      alive: boolean | null;
      isAutoFilled: boolean | null;
    }>;
    rosterPlayers: Array<{
      id: string;
      ign: string | null;
      realName: string | null;
      externalPlayerId: string | null;
      playerOpenId: string | null;
    }>;
  }): ComputedFinalPlayerResult[] {
    if (!params.teamId) {
      return [];
    }

    const existingByPlayerId = new Map<
      string,
      (typeof params.existingPlayers)[number]
    >();
    const existingByExternalId = new Map<
      string,
      (typeof params.existingPlayers)[number]
    >();
    const existingByPubgId = new Map<
      string,
      (typeof params.existingPlayers)[number]
    >();
    const existingByName = new Map<
      string,
      (typeof params.existingPlayers)[number] | null
    >();

    for (const player of params.existingPlayers) {
      const playerIdKey = this.buildScopedPlayerLookupKey(
        params.slotNumber,
        player.playerId,
      );
      if (playerIdKey) existingByPlayerId.set(playerIdKey, player);
      const externalKey = this.buildScopedPlayerLookupKey(
        params.slotNumber,
        player.externalPlayerId,
      );
      if (externalKey) existingByExternalId.set(externalKey, player);
      const pubgKey = this.buildScopedPlayerLookupKey(
        params.slotNumber,
        player.pubgAccountId,
      );
      if (pubgKey) existingByPubgId.set(pubgKey, player);
      const nameKey = this.buildScopedPlayerLookupKey(
        params.slotNumber,
        player.playerName,
      );
      if (!nameKey) continue;
      const existingBySameName = existingByName.get(nameKey);
      if (
        existingBySameName &&
        existingBySameName.playerName !== player.playerName
      ) {
        existingByName.set(nameKey, null);
      } else if (!existingByName.has(nameKey)) {
        existingByName.set(nameKey, player);
      }
    }

    if (params.telemetryPlayers.length > 0) {
      const materialized = params.telemetryPlayers.map((player, index) => {
        const stablePlayerId = this.stableTelemetryPlayerId(player);
        const externalPlayerId = this.telemetryPlayerExternalId(player);
        const pubgAccountId = this.telemetryPlayerPubgAccountId(player);
        const playerNameSeed =
          player.metadata?.playerName?.trim() || player.playerId || 'Player';
        const nameStableId =
          stablePlayerId ??
          externalPlayerId ??
          pubgAccountId ??
          `telemetry:${index}`;
        return {
          player,
          stablePlayerId,
          externalPlayerId,
          pubgAccountId,
          playerNameSeed,
          nameStableId,
        };
      });
      const names = uniqueSlotPlayerNames(
        materialized.map((entry) => ({
          playerName: entry.playerNameSeed,
          stableId: entry.nameStableId,
        })),
      );

      return materialized.map((entry, index) => {
        const playerName = names[index];
        const existing =
          (entry.stablePlayerId
            ? existingByPlayerId.get(
                this.buildScopedPlayerLookupKey(
                  params.slotNumber,
                  entry.stablePlayerId,
                ) ?? '',
              )
            : null) ??
          (entry.externalPlayerId
            ? existingByExternalId.get(
                this.buildScopedPlayerLookupKey(
                  params.slotNumber,
                  entry.externalPlayerId,
                ) ?? '',
              )
            : null) ??
          (entry.pubgAccountId
            ? existingByPubgId.get(
                this.buildScopedPlayerLookupKey(
                  params.slotNumber,
                  entry.pubgAccountId,
                ) ?? '',
              )
            : null) ??
          existingByName.get(
            this.buildScopedPlayerLookupKey(params.slotNumber, playerName) ??
              '',
          ) ??
          null;

        return {
          matchId: params.matchId,
          organizationId: params.organizationId,
          slotNumber: params.slotNumber,
          teamId: params.teamId as string,
          playerId: existing?.playerId ?? null,
          pubgAccountId: existing?.pubgAccountId ?? entry.pubgAccountId ?? null,
          externalPlayerId:
            existing?.externalPlayerId ?? entry.externalPlayerId ?? null,
          playerName,
          kills: Math.max(0, Math.trunc(entry.player.kills ?? 0)),
          knocks: 0,
          assists: Math.max(0, Math.trunc(entry.player.assists ?? 0)),
          isKnocked: false,
          isAlive: false,
          alive: false,
          isAutoFilled: false,
          aliveAtEnd: entry.player.alive === true,
          knockedAtEnd: entry.player.knocked === true,
        };
      });
    }

    if (params.existingPlayers.length > 0) {
      return params.existingPlayers.map((player) => ({
        matchId: params.matchId,
        organizationId: params.organizationId,
        slotNumber: params.slotNumber,
        teamId: params.teamId as string,
        playerId: player.playerId ?? null,
        pubgAccountId: player.pubgAccountId ?? null,
        externalPlayerId: player.externalPlayerId ?? null,
        playerName: player.playerName,
        kills: Math.max(0, Math.trunc(player.kills ?? 0)),
        knocks: Math.max(0, Math.trunc(player.knocks ?? 0)),
        assists: Math.max(0, Math.trunc(player.assists ?? 0)),
        isKnocked: false,
        isAlive: false,
        alive: false,
        isAutoFilled: player.isAutoFilled === true,
        aliveAtEnd:
          player.isAlive === true ||
          (player as { alive?: boolean | null }).alive === true,
        knockedAtEnd: player.isKnocked === true,
      }));
    }

    const rosterPlayers = params.rosterPlayers.slice(0, 4);
    const names = uniqueSlotPlayerNames(
      rosterPlayers.map((player) => ({
        playerName: player.ign?.trim() || player.realName?.trim() || 'Player',
        stableId: player.id,
      })),
    );
    return rosterPlayers.map((player, index) => ({
      matchId: params.matchId,
      organizationId: params.organizationId,
      slotNumber: params.slotNumber,
      teamId: params.teamId as string,
      playerId: player.id,
      pubgAccountId: player.playerOpenId ?? null,
      externalPlayerId: player.externalPlayerId ?? player.playerOpenId ?? null,
      playerName: names[index],
      kills: 0,
      knocks: 0,
      assists: 0,
      isKnocked: false,
      isAlive: false,
      alive: false,
      isAutoFilled: false,
      aliveAtEnd: false,
      knockedAtEnd: false,
    }));
  }

  private buildComputedStandings(params: {
    plan: MatchConclusionPlan;
    teamResults: ComputedFinalTeamResult[];
    finalizedAt: Date;
  }): ComputedFinalStanding[] {
    if (!params.plan.tournamentId) {
      return [];
    }
    const rows = params.teamResults
      .filter(
        (team): team is ComputedFinalTeamResult & { teamId: string } =>
          Boolean(team.teamId) && team.wasPresentInMatch === true,
      )
      .map((team) => ({
        matchId: params.plan.matchId,
        organizationId: params.plan.organizationId,
        tournamentId: params.plan.tournamentId as string,
        teamId: team.teamId,
        rank: 0,
        totalKills: team.totalKills,
        placementPoints: team.placementPoints,
        bonusPoints: 0,
        penaltyPoints: 0,
        totalPoints: team.totalPoints,
        isLocked: true,
        isFinal: true,
        computedAt: params.finalizedAt,
        placement: team.placement,
        slotNumber: team.slotNumber,
      }));
    rows.sort((left, right) => {
      const rankingOrder = compareRankingRows(left, right);
      if (rankingOrder !== 0) return rankingOrder;
      const leftPlacement = left.placement ?? Number.MAX_SAFE_INTEGER;
      const rightPlacement = right.placement ?? Number.MAX_SAFE_INTEGER;
      if (leftPlacement !== rightPlacement) {
        return leftPlacement - rightPlacement;
      }
      return left.slotNumber - right.slotNumber;
    });
    return rows.map((row, index) => ({
      matchId: row.matchId,
      organizationId: row.organizationId,
      tournamentId: row.tournamentId,
      teamId: row.teamId,
      rank: index + 1,
      totalKills: row.totalKills,
      placementPoints: row.placementPoints,
      bonusPoints: row.bonusPoints,
      penaltyPoints: row.penaltyPoints,
      totalPoints: row.totalPoints,
      isLocked: row.isLocked,
      isFinal: row.isFinal,
      computedAt: row.computedAt,
    }));
  }

  async buildTelemetryPromotionDiagnostics(
    matchId: string,
    canonicalState?: TelemetryMatchState | null,
  ): Promise<TelemetryPromotionDiagnostics | null> {
    const [telemetryRow, slotResults, slots] = await Promise.all([
      this.prisma.matchTelemetry.findUnique({
        where: { matchId },
        select: {
          payload: true,
        },
      }),
      this.prisma.matchSlotResult.findMany({
        where: { matchId },
        select: {
          slotNumber: true,
          teamId: true,
          wasPresentInMatch: true,
          team: {
            select: {
              name: true,
              tag: true,
            },
          },
          players: {
            select: {
              playerName: true,
              externalPlayerId: true,
              pubgAccountId: true,
              player: {
                select: {
                  ign: true,
                  externalPlayerId: true,
                  playerOpenId: true,
                  inGameId: true,
                  pubgPlayerId: true,
                },
              },
            },
          },
        },
        orderBy: { slotNumber: 'asc' },
      }),
      this.prisma.matchSlot.findMany({
        where: { matchId, deletedAt: null },
        select: {
          slotNumber: true,
          teamId: true,
          team: {
            select: {
              name: true,
              tag: true,
              players: {
                where: { deletedAt: null },
                select: {
                  ign: true,
                  realName: true,
                  externalPlayerId: true,
                  playerOpenId: true,
                  inGameId: true,
                  pubgPlayerId: true,
                },
                orderBy: { ign: 'asc' },
              },
            },
          },
        },
        orderBy: { slotNumber: 'asc' },
      }),
    ]);

    const payload = asRecord(telemetryRow?.payload);
    if (!payload) {
      return null;
    }

    const rawPayload = asRecord(payload.raw) ?? payload;
    const rawTeams = this.extractRawTelemetryTeamRecords(rawPayload);
    const rawPlayers = this.extractRawTelemetryPlayerRecords(rawPayload);
    if (rawTeams.length === 0 && rawPlayers.length === 0) {
      return null;
    }

    const finalState =
      canonicalState ?? (await this.telemetryEngine.getState(matchId));
    const canonicalTeamIds = new Set(
      Object.values(finalState.teams ?? {}).map((team) => team.teamId),
    );
    const canonicalTeamsBySlot = new Map<
      number,
      TelemetryPromotionCanonicalTeam
    >();
    for (const team of Object.values(finalState.teams ?? {})) {
      const slot = toInt(team.metadata?.slot);
      if (slot === null) {
        continue;
      }
      canonicalTeamsBySlot.set(slot, {
        teamId: team.teamId,
        teamName: toText(team.metadata?.teamName),
        teamTag: toText(team.metadata?.teamTag),
      });
    }

    const slotLookup = this.buildTelemetryPromotionSlotLookup(
      slotResults,
      slots,
    );
    const slotLookupValues = Array.from(slotLookup.values());
    const rawTeamGroups = this.buildRawTelemetryTeamGroups(
      rawTeams,
      rawPlayers,
    );
    const rawSnapshotTimestampMs = parseTimestampMs(payload.timestamp);
    const rawOnlyTeams = rawTeamGroups
      .map((group): TelemetryPromotionDiagnosticTeam | null => {
        const slotContext =
          (group.rawSlot !== null
            ? (slotLookup.get(group.rawSlot) ?? null)
            : null) ??
          this.findTelemetryPromotionSlotContext(
            slotLookupValues,
            group.rawTeamName,
            group.rawTeamTag,
          );
        const canonicalTeam =
          (group.rawSlot !== null
            ? (canonicalTeamsBySlot.get(group.rawSlot) ?? null)
            : null) ??
          this.findCanonicalTelemetryPromotionTeam(
            canonicalTeamsBySlot,
            group.rawTeamName,
            group.rawTeamTag,
          );
        const presentInCanonicalAcceptedState =
          canonicalTeam !== null ||
          (slotContext?.teamId
            ? canonicalTeamIds.has(slotContext.teamId)
            : false);
        if (presentInCanonicalAcceptedState) {
          return null;
        }

        const rosterPlayers = slotContext?.rosterPlayers ?? [];
        const rosterPlayerNames = rosterPlayers
          .map((player) => player.name)
          .filter((name): name is string => Boolean(name));
        const rosterIdentitySet = new Set(
          rosterPlayers.flatMap((player) => player.identifiers),
        );
        const matchedRosterIdentityCount = group.players.filter((player) =>
          player.identifiers.some((identifier) =>
            rosterIdentitySet.has(identifier),
          ),
        ).length;
        const matchedRosterNameCount = group.players.filter((player) =>
          rosterPlayers.some((rosterPlayer) =>
            Array.from(player.names).some((name) =>
              rosterPlayer.names.has(name),
            ),
          ),
        ).length;

        const reasonCodes: string[] = [
          'RAW_TEAM_PRESENT_BUT_ABSENT_FROM_CANONICAL',
        ];
        if (slotContext?.wasPresentInMatch === false) {
          reasonCodes.push('FINAL_RESULT_MARKED_ABSENT');
        }
        if (
          group.rawPlayerIdentifiers.length > 0 &&
          rosterIdentitySet.size > 0 &&
          matchedRosterIdentityCount === 0
        ) {
          reasonCodes.push('RAW_PLAYER_IDENTITIES_DO_NOT_MATCH_SLOT_ROSTER');
        }
        if (
          group.rawPlayerNames.length > 0 &&
          rosterPlayerNames.length > 0 &&
          matchedRosterNameCount === 0
        ) {
          reasonCodes.push('RAW_PLAYER_NAMES_DO_NOT_MATCH_SLOT_ROSTER');
        }

        return {
          rawTeamId: group.rawTeamId,
          rawSlot: group.rawSlot,
          rawTeamName: group.rawTeamName,
          rawTeamTag: group.rawTeamTag,
          rawKills: group.rawKills,
          rawAlivePlayers: group.rawAlivePlayers,
          rawTotalPlayers: group.rawTotalPlayers,
          rawPlayerCount: group.players.length,
          rawPlayerNameCount: group.rawPlayerNames.length,
          rawPlayerIdentifierCount: group.rawPlayerIdentifiers.length,
          canonicalTeamId: slotContext?.teamId ?? null,
          canonicalTeamName: slotContext?.teamName ?? null,
          canonicalTeamTag: slotContext?.teamTag ?? null,
          finalResultWasPresentInMatch: slotContext?.wasPresentInMatch ?? null,
          presentInCanonicalAcceptedState: false,
          rosterPlayerCount: rosterPlayers.length,
          rosterPlayerNameCount: rosterPlayerNames.length,
          rosterPlayerIdentifierCount: rosterIdentitySet.size,
          matchedRosterIdentityCount,
          matchedRosterNameCount,
          reasonCodes,
        };
      })
      .filter((team): team is TelemetryPromotionDiagnosticTeam => team !== null)
      .sort((left, right) => {
        const leftSlot = left.rawSlot ?? Number.MAX_SAFE_INTEGER;
        const rightSlot = right.rawSlot ?? Number.MAX_SAFE_INTEGER;
        if (leftSlot !== rightSlot) {
          return leftSlot - rightSlot;
        }
        return (left.rawTeamName ?? '').localeCompare(right.rawTeamName ?? '');
      });

    const diagnostics: TelemetryPromotionDiagnostics = {
      computedAt: new Date().toISOString(),
      source: 'MATCH_TELEMETRY_COMPATIBILITY_RAW',
      structuralMirrorDisabled: payload.structuralMirrorDisabled === true,
      rawSnapshot: {
        sequence: toInt(payload.sequence),
        timestamp:
          rawSnapshotTimestampMs !== null
            ? new Date(rawSnapshotTimestampMs).toISOString()
            : null,
        teamCount: rawTeamGroups.length,
        playerCount: rawPlayers.length,
      },
      canonicalSnapshot: {
        status: finalState.status ?? null,
        sequence:
          typeof finalState.sequence === 'number' &&
          Number.isFinite(finalState.sequence)
            ? Math.trunc(finalState.sequence)
            : null,
        updatedAt:
          typeof finalState.updatedAt === 'number' &&
          Number.isFinite(finalState.updatedAt)
            ? new Date(finalState.updatedAt).toISOString()
            : null,
        teamCount: Object.keys(finalState.teams ?? {}).length,
      },
      rawOnlyTeams,
    };

    if (rawOnlyTeams.length > 0) {
      this.logger.warn(
        JSON.stringify({
          tag: '[TELEMETRY][PROMOTION]',
          stage: 'match-conclusion',
          action: 'raw-team-not-promoted-to-canonical-results',
          matchId,
          rawTeamCount: diagnostics.rawSnapshot.teamCount,
          canonicalTeamCount: diagnostics.canonicalSnapshot.teamCount,
          rawOnlyTeams: rawOnlyTeams.map((team) => ({
            rawSlot: team.rawSlot,
            rawTeamName: team.rawTeamName,
            canonicalTeamId: team.canonicalTeamId,
            finalResultWasPresentInMatch: team.finalResultWasPresentInMatch,
            matchedRosterIdentityCount: team.matchedRosterIdentityCount,
            matchedRosterNameCount: team.matchedRosterNameCount,
            reasonCodes: team.reasonCodes,
          })),
        }),
      );
    }

    return diagnostics;
  }

  private buildTelemetryPromotionSlotLookup(
    slotResults: Array<{
      slotNumber: number;
      teamId: string | null;
      wasPresentInMatch: boolean | null;
      team: {
        name: string | null;
        tag: string | null;
      } | null;
      players: Array<{
        playerName: string | null;
        externalPlayerId: string | null;
        pubgAccountId: string | null;
        player: {
          ign: string | null;
          externalPlayerId: string | null;
          playerOpenId: string | null;
          inGameId: string | null;
          pubgPlayerId: string | null;
        } | null;
      }>;
    }>,
    slots: Array<{
      slotNumber: number;
      teamId: string | null;
      team: {
        name: string | null;
        tag: string | null;
        players: Array<{
          ign: string | null;
          realName: string | null;
          externalPlayerId: string | null;
          playerOpenId: string | null;
          inGameId: string | null;
          pubgPlayerId: string | null;
        }>;
      } | null;
    }>,
  ) {
    const slotResultsByNumber = new Map(
      slotResults.map(
        (slotResult) => [slotResult.slotNumber, slotResult] as const,
      ),
    );
    const slotsByNumber = new Map(
      slots.map((slot) => [slot.slotNumber, slot] as const),
    );
    const slotNumbers = new Set<number>([
      ...slotResultsByNumber.keys(),
      ...slotsByNumber.keys(),
    ]);

    const lookup = new Map<number, TelemetryPromotionSlotContext>();

    for (const slotNumber of Array.from(slotNumbers).sort(
      (left, right) => left - right,
    )) {
      const slotResult = slotResultsByNumber.get(slotNumber) ?? null;
      const slot = slotsByNumber.get(slotNumber) ?? null;
      const rosterPlayers =
        slotResult && slotResult.players.length > 0
          ? slotResult.players.map<TelemetryPromotionRosterPlayer>(
              (player) => ({
                name: player.playerName ?? player.player?.ign ?? null,
                identifiers: this.uniqueTelemetryPromotionValues([
                  player.externalPlayerId,
                  player.pubgAccountId,
                  player.player?.externalPlayerId,
                  player.player?.playerOpenId,
                  player.player?.inGameId,
                  player.player?.pubgPlayerId,
                ]),
                names: this.toTelemetryPromotionNameSet([
                  player.playerName,
                  player.player?.ign,
                ]),
              }),
            )
          : (slot?.team?.players ?? [])
              .slice(0, 4)
              .map<TelemetryPromotionRosterPlayer>((player) => ({
                name: player.ign ?? player.realName ?? null,
                identifiers: this.uniqueTelemetryPromotionValues([
                  player.externalPlayerId,
                  player.playerOpenId,
                  player.inGameId,
                  player.pubgPlayerId,
                ]),
                names: this.toTelemetryPromotionNameSet([
                  player.ign,
                  player.realName,
                ]),
              }));

      lookup.set(slotNumber, {
        slotNumber,
        teamId: slotResult?.teamId ?? slot?.teamId ?? null,
        teamName: slotResult?.team?.name ?? slot?.team?.name ?? null,
        teamTag: slotResult?.team?.tag ?? slot?.team?.tag ?? null,
        wasPresentInMatch: slotResult?.wasPresentInMatch ?? null,
        rosterPlayers,
      });
    }

    return lookup;
  }

  private findTelemetryPromotionSlotContext(
    slotContexts: TelemetryPromotionSlotContext[],
    teamName: string | null,
    teamTag: string | null,
  ): TelemetryPromotionSlotContext | null {
    const normalizedName = normalizeLookup(teamName);
    const compactName = compactLookup(teamName);
    const normalizedTag = normalizeLookup(teamTag);
    const compactTag = compactLookup(teamTag);
    if (!normalizedName && !compactName && !normalizedTag && !compactTag) {
      return null;
    }

    return (
      slotContexts.find((slot) => {
        return (
          (normalizedName &&
            (normalizeLookup(slot.teamName) === normalizedName ||
              compactLookup(slot.teamName) === compactName)) ||
          (normalizedTag &&
            (normalizeLookup(slot.teamTag) === normalizedTag ||
              compactLookup(slot.teamTag) === compactTag))
        );
      }) ?? null
    );
  }

  private findCanonicalTelemetryPromotionTeam(
    canonicalTeamsBySlot: Map<number, TelemetryPromotionCanonicalTeam>,
    teamName: string | null,
    teamTag: string | null,
  ): TelemetryPromotionCanonicalTeam | null {
    const normalizedName = normalizeLookup(teamName);
    const compactName = compactLookup(teamName);
    const normalizedTag = normalizeLookup(teamTag);
    const compactTag = compactLookup(teamTag);
    if (!normalizedName && !compactName && !normalizedTag && !compactTag) {
      return null;
    }

    for (const team of canonicalTeamsBySlot.values()) {
      if (
        (normalizedName &&
          (normalizeLookup(team.teamName) === normalizedName ||
            compactLookup(team.teamName) === compactName)) ||
        (normalizedTag &&
          (normalizeLookup(team.teamTag) === normalizedTag ||
            compactLookup(team.teamTag) === compactTag))
      ) {
        return team;
      }
    }
    return null;
  }

  private buildRawTelemetryTeamGroups(
    rawTeams: Array<Record<string, unknown>>,
    rawPlayers: Array<Record<string, unknown>>,
  ): TelemetryPromotionRawTeamGroup[] {
    const groups = new Map<string, TelemetryPromotionRawTeamGroup>();

    for (const rawTeam of rawTeams) {
      const rawTeamId = this.readTelemetryPromotionRawTeamId(rawTeam);
      const rawSlot = this.readTelemetryPromotionRawSlot(rawTeam, rawTeamId);
      const rawTeamName = this.readTelemetryPromotionRawTeamName(rawTeam);
      const rawTeamTag = this.readTelemetryPromotionRawTeamTag(rawTeam);
      const key = this.buildTelemetryPromotionRawTeamKey({
        rawTeamId,
        rawSlot,
        rawTeamName,
        rawTeamTag,
      });
      const existing = groups.get(key);
      if (existing) {
        continue;
      }
      groups.set(key, {
        rawTeamId,
        rawSlot,
        rawTeamName,
        rawTeamTag,
        rawKills: toInt(
          rawTeam.kills ?? rawTeam.kill ?? rawTeam.killNum ?? rawTeam.killnum,
        ),
        rawAlivePlayers: toInt(
          rawTeam.alive ??
            rawTeam.aliveCount ??
            rawTeam.alivePlayers ??
            rawTeam.liveMemberNum,
        ),
        rawTotalPlayers: toInt(
          rawTeam.totalPlayers ??
            rawTeam.totalPlayerCount ??
            rawTeam.memberNum ??
            rawTeam.playerCount ??
            rawTeam.playerNum,
        ),
        players: [],
        rawPlayerNames: [],
        rawPlayerIdentifiers: [],
      });
    }

    for (const rawPlayer of rawPlayers) {
      const rawTeamId = this.readTelemetryPromotionRawTeamId(rawPlayer);
      const rawSlot = this.readTelemetryPromotionRawSlot(rawPlayer, rawTeamId);
      const rawTeamName = this.readTelemetryPromotionRawTeamName(rawPlayer);
      const rawTeamTag = this.readTelemetryPromotionRawTeamTag(rawPlayer);
      const key = this.buildTelemetryPromotionRawTeamKey({
        rawTeamId,
        rawSlot,
        rawTeamName,
        rawTeamTag,
      });
      const existing: TelemetryPromotionRawTeamGroup = groups.get(key) ?? {
        rawTeamId,
        rawSlot,
        rawTeamName,
        rawTeamTag,
        rawKills: null,
        rawAlivePlayers: null,
        rawTotalPlayers: null,
        players: [],
        rawPlayerNames: [],
        rawPlayerIdentifiers: [],
      };
      const playerName =
        toText(
          rawPlayer.playerName ??
            rawPlayer.PlayerName ??
            rawPlayer.ign ??
            rawPlayer.name,
        ) ?? null;
      const identifiers = this.uniqueTelemetryPromotionValues([
        rawPlayer.externalPlayerId,
        rawPlayer.playerOpenId,
        rawPlayer.pubgAccountId,
        rawPlayer.playerId,
        rawPlayer.playerKey,
        rawPlayer.uId,
        rawPlayer.uid,
        rawPlayer.id,
      ]);
      existing.players.push({
        name: playerName,
        identifiers,
        names: this.toTelemetryPromotionNameSet([playerName]),
      });
      if (playerName && !existing.rawPlayerNames.includes(playerName)) {
        existing.rawPlayerNames.push(playerName);
      }
      for (const identifier of identifiers) {
        if (!existing.rawPlayerIdentifiers.includes(identifier)) {
          existing.rawPlayerIdentifiers.push(identifier);
        }
      }
      groups.set(key, existing);
    }

    return Array.from(groups.values());
  }

  private readTelemetryPromotionRawTeamId(
    record: Record<string, unknown>,
  ): string | null {
    return (
      toText(
        record.teamId ??
          record.teamID ??
          record.TeamId ??
          record.TeamID ??
          record.team ??
          record.id ??
          record.teamNo ??
          record.TeamNo ??
          record.teamNumber,
      ) ?? null
    );
  }

  private readTelemetryPromotionRawSlot(
    record: Record<string, unknown>,
    rawTeamId: string | null,
  ): number | null {
    return (
      toInt(
        record.slot ??
          record.slotNumber ??
          record.teamSlot ??
          record.TeamSlot ??
          record.order ??
          record.rank,
      ) ??
      (() => {
        const teamIdAsNumber = toInt(rawTeamId);
        return teamIdAsNumber !== null && teamIdAsNumber > 0
          ? teamIdAsNumber
          : null;
      })()
    );
  }

  private readTelemetryPromotionRawTeamName(
    record: Record<string, unknown>,
  ): string | null {
    return (
      toText(
        record.teamName ?? record.TeamName ?? record.name ?? record.teamNameCn,
      ) ?? null
    );
  }

  private readTelemetryPromotionRawTeamTag(
    record: Record<string, unknown>,
  ): string | null {
    return toText(record.teamTag ?? record.tag ?? record.shortName) ?? null;
  }

  private buildTelemetryPromotionRawTeamKey(input: {
    rawTeamId: string | null;
    rawSlot: number | null;
    rawTeamName: string | null;
    rawTeamTag: string | null;
  }): string {
    if (input.rawSlot !== null) {
      return `slot:${input.rawSlot}`;
    }
    if (input.rawTeamId) {
      return `team:${input.rawTeamId}`;
    }
    if (normalizeLookup(input.rawTeamName)) {
      return `name:${normalizeLookup(input.rawTeamName)}`;
    }
    if (normalizeLookup(input.rawTeamTag)) {
      return `tag:${normalizeLookup(input.rawTeamTag)}`;
    }
    return `unknown:${input.rawTeamId ?? 'null'}:${input.rawSlot ?? 'null'}`;
  }

  private extractRawTelemetryTeamRecords(
    payload: Record<string, unknown>,
  ): Array<Record<string, unknown>> {
    for (const source of this.collectTelemetryPromotionPayloadRecords(
      payload,
    )) {
      for (const key of ['teams', 'teamInfoList', 'TeamInfoList', 'teamList']) {
        const records = this.toTelemetryPromotionRecordArray(source[key]);
        if (records.length > 0) {
          return records;
        }
      }
    }
    return [];
  }

  private extractRawTelemetryPlayerRecords(
    payload: Record<string, unknown>,
  ): Array<Record<string, unknown>> {
    for (const source of this.collectTelemetryPromotionPayloadRecords(
      payload,
    )) {
      for (const key of [
        'players',
        'TotalPlayerList',
        'totalPlayerList',
        'PlayerList',
        'playerList',
        'PlayerInfoList',
        'playerInfoList',
      ]) {
        const records = this.toTelemetryPromotionRecordArray(source[key]);
        if (records.length > 0) {
          return records;
        }
      }
    }
    return [];
  }

  private collectTelemetryPromotionPayloadRecords(
    payload: unknown,
  ): Array<Record<string, unknown>> {
    const root = asRecord(payload);
    if (!root) {
      return [];
    }

    const queue: Array<Record<string, unknown>> = [root];
    const records: Array<Record<string, unknown>> = [];
    const seen = new Set<Record<string, unknown>>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || seen.has(current)) {
        continue;
      }
      seen.add(current);
      records.push(current);
      for (const value of Object.values(current)) {
        const nested = asRecord(value);
        if (nested && !seen.has(nested)) {
          queue.push(nested);
          continue;
        }
        if (!Array.isArray(value)) {
          continue;
        }
        for (const item of value) {
          const nestedItem = asRecord(item);
          if (nestedItem && !seen.has(nestedItem)) {
            queue.push(nestedItem);
          }
        }
      }
    }

    return records;
  }

  private toTelemetryPromotionRecordArray(
    value: unknown,
  ): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== null);
  }

  private uniqueTelemetryPromotionValues(values: unknown[]): string[] {
    return Array.from(
      new Set(
        values
          .map((value) => normalizeLookup(value))
          .filter((value) => value.length > 0),
      ),
    );
  }

  private toTelemetryPromotionNameSet(values: unknown[]): Set<string> {
    return new Set(
      values
        .flatMap((value) => {
          const normalized = normalizeLookup(value);
          const compact = compactLookup(value);
          return [normalized, compact];
        })
        .filter((value) => value.length > 0),
    );
  }

  private hasExplicitTelemetryPresence(state: TelemetryMatchState): boolean {
    return (
      Object.values(state.teams ?? {}).some(
        (team) => team.metadata?.wasPresentInMatch === true,
      ) ||
      Object.values(state.players ?? {}).some(
        (player) => player.metadata?.observedInTelemetry === true,
      )
    );
  }

  private collectActiveTelemetryTeamIds(
    state: TelemetryMatchState,
  ): Set<string> {
    const activeTeamIds = new Set<string>();

    for (const [teamId, team] of Object.entries(state.teams ?? {})) {
      if (team.metadata?.wasPresentInMatch === true) {
        activeTeamIds.add(teamId);
      }
    }

    for (const player of Object.values(state.players ?? {})) {
      if (player.metadata?.observedInTelemetry === true) {
        activeTeamIds.add(player.teamId);
      }
    }

    return activeTeamIds;
  }

  private describeTeamIds(teamIds: string[]): string {
    if (teamIds.length <= 3) {
      return teamIds.join(', ');
    }
    return `${teamIds.slice(0, 3).join(', ')} +${teamIds.length - 3} more`;
  }

  private buildCompleteTelemetryPlacementProjection(
    teams: Array<{
      teamId: string;
      totalKills: number;
      eliminatedAt: number | null;
      telemetryPlacement: number | null;
    }>,
    endedAt: number,
  ): TelemetryFinalPlacementProjection | null {
    if (teams.length === 0) {
      return null;
    }

    const seenPlacements = new Set<number>();
    for (const team of teams) {
      const placement = team.telemetryPlacement;
      if (
        placement === null ||
        placement < 1 ||
        placement > teams.length ||
        seenPlacements.has(placement)
      ) {
        return null;
      }
      seenPlacements.add(placement);
    }

    for (let placement = 1; placement <= teams.length; placement += 1) {
      if (!seenPlacements.has(placement)) {
        return null;
      }
    }

    const projectionTeams: TelemetryFinalPlacementProjection['teams'] = {};
    for (const team of teams) {
      const placement = team.telemetryPlacement;
      if (placement === null) {
        return null;
      }

      projectionTeams[team.teamId] = {
        placement,
        eliminatedOrder:
          placement === 1 ? null : Math.max(teams.length - placement + 1, 1),
        eliminatedAt: placement === 1 ? null : (team.eliminatedAt ?? endedAt),
        totalKills: team.totalKills,
        aliveAtEnd: placement === 1,
      };
    }

    const winnerTeamId =
      Object.entries(projectionTeams).find(
        ([, team]) => team.placement === 1,
      )?.[0] ?? null;

    return {
      totalTeams: teams.length,
      aliveTeamsAtEnd: winnerTeamId ? 1 : 0,
      placementsAssigned: Object.keys(projectionTeams).length,
      winnerTeamId,
      needsConfirmation: false,
      ambiguities: [],
      teams: projectionTeams,
    };
  }

  private detectPlacementAmbiguities(params: {
    totalTeams: number;
    endedAt: number;
    aliveTeams: Array<{
      teamId: string;
      totalKills: number;
      slot: number;
    }>;
    eliminatedTeams: Array<{
      teamId: string;
      eliminatedAt: number | null;
    }>;
  }): NonNullable<TelemetryFinalPlacementProjection['ambiguities']> {
    const { totalTeams, endedAt, aliveTeams, eliminatedTeams } = params;
    const ambiguities: NonNullable<
      TelemetryFinalPlacementProjection['ambiguities']
    > = [];

    if (aliveTeams.length > 1) {
      ambiguities.push({
        code: 'MULTIPLE_TEAMS_ALIVE_AT_END',
        teamIds: aliveTeams.map((team) => team.teamId),
        placementFrom: 1,
        placementTo: aliveTeams.length,
        detectedAt: new Date(endedAt).toISOString(),
        message: `Telemetry ended with multiple teams still alive (${this.describeTeamIds(
          aliveTeams.map((team) => team.teamId),
        )}); placements were auto-ordered by kills, then slot.`,
      });
    }

    let groupStart = 0;
    while (groupStart < eliminatedTeams.length) {
      const firstTime = eliminatedTeams[groupStart].eliminatedAt ?? endedAt;
      let groupEnd = groupStart;
      while (groupEnd + 1 < eliminatedTeams.length) {
        const nextTime = eliminatedTeams[groupEnd + 1].eliminatedAt ?? endedAt;
        if (nextTime - firstTime > this.placementAmbiguityWindowMs) {
          break;
        }
        groupEnd += 1;
      }

      if (groupEnd > groupStart) {
        const group = eliminatedTeams.slice(groupStart, groupEnd + 1);
        ambiguities.push({
          code: 'SIMULTANEOUS_ELIMINATION',
          teamIds: group.map((team) => team.teamId),
          placementFrom: totalTeams - groupEnd,
          placementTo: totalTeams - groupStart,
          detectedAt: new Date(firstTime).toISOString(),
          message: `Teams ${this.describeTeamIds(
            group.map((team) => team.teamId),
          )} were eliminated within ${this.placementAmbiguityWindowMs}ms; placements were auto-ordered by slot fallback.`,
        });
      }

      groupStart = groupEnd + 1;
    }

    return ambiguities;
  }

  private buildCanonicalFinalProjection(
    state: TelemetryMatchState,
  ): TelemetryFinalPlacementProjection {
    const playersByTeam = new Map<
      string,
      Array<TelemetryMatchState['players'][string]>
    >();
    const activeTeamIds = this.hasExplicitTelemetryPresence(state)
      ? this.collectActiveTelemetryTeamIds(state)
      : null;

    for (const player of Object.values(state.players)) {
      if (activeTeamIds && player.metadata?.observedInTelemetry !== true) {
        continue;
      }
      const bucket = playersByTeam.get(player.teamId) ?? [];
      bucket.push(player);
      playersByTeam.set(player.teamId, bucket);
    }

    const teams = Object.entries(state.teams)
      .filter(([teamId]) => !activeTeamIds || activeTeamIds.has(teamId))
      .map(([teamId, team]) => {
        const players = playersByTeam.get(teamId) ?? [];
        const alivePlayers =
          players.length > 0
            ? players.filter((player) => player.alive === true).length
            : typeof team.alivePlayers === 'number' &&
                Number.isFinite(team.alivePlayers)
              ? Math.max(0, Math.trunc(team.alivePlayers))
              : 0;
        const totalKills =
          typeof team.totalKills === 'number' &&
          Number.isFinite(team.totalKills)
            ? team.totalKills
            : players.reduce(
                (sum, player) => sum + Math.max(0, player.kills ?? 0),
                0,
              );
        const slot =
          typeof team.metadata?.slot === 'number' &&
          Number.isFinite(team.metadata.slot)
            ? Math.trunc(team.metadata.slot)
            : Number.MAX_SAFE_INTEGER;
        const rawTelemetryPlacement = team.metadata?.telemetryPlacement;
        const telemetryPlacement =
          typeof rawTelemetryPlacement === 'number' &&
          Number.isFinite(rawTelemetryPlacement) &&
          rawTelemetryPlacement > 0
            ? Math.trunc(rawTelemetryPlacement)
            : null;
        return {
          teamId,
          slot,
          aliveAtEnd:
            alivePlayers > 0 ||
            (team.eliminated !== true && team.placement === 1),
          totalKills,
          eliminatedAt:
            typeof team.eliminatedAt === 'number' &&
            Number.isFinite(team.eliminatedAt)
              ? team.eliminatedAt
              : null,
          telemetryPlacement,
        };
      });

    const endedAt = state.endedAt ?? state.updatedAt;
    const completeTelemetryProjection =
      this.buildCompleteTelemetryPlacementProjection(teams, endedAt);
    if (completeTelemetryProjection) {
      return completeTelemetryProjection;
    }

    const aliveTeams = teams
      .filter((team) => team.aliveAtEnd)
      .sort((left, right) => {
        if (right.totalKills !== left.totalKills) {
          return right.totalKills - left.totalKills;
        }
        if (left.slot !== right.slot) {
          return left.slot - right.slot;
        }
        return left.teamId.localeCompare(right.teamId);
      });
    const eliminatedTeams = teams
      .filter((team) => !team.aliveAtEnd)
      .sort((left, right) => {
        const leftEndedAt = left.eliminatedAt ?? endedAt;
        const rightEndedAt = right.eliminatedAt ?? endedAt;
        if (leftEndedAt !== rightEndedAt) {
          return leftEndedAt - rightEndedAt;
        }
        if (left.slot !== right.slot) {
          return left.slot - right.slot;
        }
        return left.teamId.localeCompare(right.teamId);
      });
    const ambiguities = this.detectPlacementAmbiguities({
      totalTeams: teams.length,
      endedAt,
      aliveTeams,
      eliminatedTeams,
    });

    const placements = new Map<string, number>();
    let placementCursor = teams.length;
    for (const team of eliminatedTeams) {
      placements.set(team.teamId, placementCursor);
      placementCursor -= 1;
    }
    aliveTeams.forEach((team, index) => {
      placements.set(team.teamId, index + 1);
    });

    const projectionTeams: TelemetryFinalPlacementProjection['teams'] = {};
    for (const team of teams) {
      const placement = placements.get(team.teamId);
      if (!placement) {
        continue;
      }
      projectionTeams[team.teamId] = {
        placement,
        eliminatedOrder:
          placement === 1 ? null : Math.max(teams.length - placement + 1, 1),
        eliminatedAt:
          team.aliveAtEnd && placement === 1
            ? null
            : team.aliveAtEnd
              ? endedAt
              : (team.eliminatedAt ?? endedAt),
        totalKills: team.totalKills,
        aliveAtEnd: team.aliveAtEnd,
      };
    }

    const winnerTeamId =
      Object.entries(projectionTeams).find(
        ([, team]) => team.placement === 1,
      )?.[0] ?? null;

    return {
      totalTeams: teams.length,
      aliveTeamsAtEnd: aliveTeams.length,
      placementsAssigned: Object.keys(projectionTeams).length,
      winnerTeamId,
      needsConfirmation: ambiguities.length > 0,
      ambiguities,
      teams: projectionTeams,
    };
  }

  private applyWinnerOverride(
    projection: TelemetryFinalPlacementProjection,
    winnerTeamId: string | null,
  ): TelemetryFinalPlacementProjection {
    if (!winnerTeamId || !projection.teams[winnerTeamId]) {
      return projection;
    }

    const teams = Object.entries(projection.teams);
    const orderedRest = teams
      .filter(([teamId]) => teamId !== winnerTeamId)
      .sort(([, left], [, right]) => {
        if (left.placement !== right.placement) {
          return left.placement - right.placement;
        }
        return (right.totalKills ?? 0) - (left.totalKills ?? 0);
      });

    const nextTeams: TelemetryFinalPlacementProjection['teams'] = {
      [winnerTeamId]: {
        ...projection.teams[winnerTeamId],
        placement: 1,
        eliminatedOrder: null,
        aliveAtEnd: true,
      },
    };

    orderedRest.forEach(([teamId, team], index) => {
      const placement = index + 2;
      nextTeams[teamId] = {
        ...team,
        placement,
        eliminatedOrder: Math.max(projection.totalTeams - placement + 1, 1),
        aliveAtEnd: false,
      };
    });

    return {
      ...projection,
      winnerTeamId,
      aliveTeamsAtEnd: 1,
      placementsAssigned: Object.keys(nextTeams).length,
      teams: nextTeams,
    };
  }

  async buildObserverMatchFinishedPayload(
    matchId: string,
    winnerTeamId: string | null,
    finishedAt: string,
  ): Promise<ObserverMatchFinishedPayload | null> {
    const slotResults = await this.prisma.matchSlotResult.findMany({
      where: { matchId, teamId: { not: null }, wasPresentInMatch: true },
      select: {
        slotNumber: true,
        teamId: true,
        placement: true,
        totalKills: true,
        team: {
          select: {
            id: true,
            name: true,
            tag: true,
            logoUrl: true,
            accentLight: true,
            accentDark: true,
          },
        },
        players: {
          select: {
            playerId: true,
            playerName: true,
            kills: true,
            assists: true,
            isAlive: true,
            alive: true,
            isKnocked: true,
            player: {
              select: {
                photoUrl: true,
              },
            },
          },
        },
      },
    });

    if (!slotResults.length) {
      return null;
    }

    const finalLeaderboard = slotResults
      .map<MatchStateLeaderboardRow>((slotResult) => {
        const teamName =
          slotResult.team?.name?.trim() || DEFAULT_WIDGET_TEAM_NAME;
        const alivePlayers = (slotResult.players ?? []).reduce(
          (count, player) =>
            player.isAlive === true || player.alive === true
              ? count + 1
              : count,
          0,
        );

        return {
          rank: 0,
          teamId: slotResult.teamId ?? slotResult.team?.id ?? null,
          slot: slotResult.slotNumber,
          teamName,
          teamTag: slotResult.team?.tag ?? DEFAULT_WIDGET_TEAM_TAG,
          logoUrl: slotResult.team?.logoUrl ?? null,
          color:
            slotResult.team?.accentLight ?? slotResult.team?.accentDark ?? null,
          kills: Math.max(0, slotResult.totalKills ?? 0),
          alivePlayers,
          totalPlayers:
            slotResult.players.length > 0 ? slotResult.players.length : null,
          placement: slotResult.placement ?? null,
          isEliminated: slotResult.placement === 1 ? false : true,
          players: slotResult.players.map((player) => ({
            playerId: player.playerId ?? null,
            playerName: player.playerName,
            avatarUrl: player.player?.photoUrl ?? null,
            kills: Math.max(0, player.kills ?? 0),
            assists: Math.max(0, player.assists ?? 0),
            alive: player.isAlive === true || player.alive === true,
            knocked: player.isKnocked === true,
            health: null,
            hasDied:
              player.isAlive === true || player.alive === true ? false : true,
          })),
        };
      })
      .sort((left, right) => {
        const leftPlacement =
          typeof left.placement === 'number'
            ? left.placement
            : Number.MAX_SAFE_INTEGER;
        const rightPlacement =
          typeof right.placement === 'number'
            ? right.placement
            : Number.MAX_SAFE_INTEGER;
        if (leftPlacement !== rightPlacement) {
          return leftPlacement - rightPlacement;
        }
        if (right.kills !== left.kills) {
          return right.kills - left.kills;
        }
        return (
          (left.slot ?? Number.MAX_SAFE_INTEGER) -
          (right.slot ?? Number.MAX_SAFE_INTEGER)
        );
      })
      .map((row, index) => ({
        ...row,
        rank: index + 1,
        placement: row.placement ?? null,
      }));

    const winnerRow =
      finalLeaderboard.find((row) => row.teamId === winnerTeamId) ??
      finalLeaderboard.find((row) => row.placement === 1) ??
      finalLeaderboard[0] ??
      null;

    return {
      matchId,
      winnerTeamId: winnerRow?.teamId ?? winnerTeamId ?? null,
      winnerTeamName: winnerRow?.teamName ?? null,
      finalLeaderboard,
      finishedAt,
    };
  }
}
