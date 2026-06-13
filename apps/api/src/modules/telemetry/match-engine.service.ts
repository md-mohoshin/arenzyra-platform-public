import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type {
  MatchSlotPlayerResult,
  MatchSlotResult,
  Prisma,
} from '@prisma/client';
import { LiveState, MatchStatus } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import {
  MatchStateService,
  type MatchState,
} from '../observer/match-state.service';
import { ObserverTeamEliminationService } from '../observer/observer-team-elimination.service';
import { resolveLiveMappingTeamTag } from '../teams/team-list-scope.util';
import { FightDetectionEngine } from './fight-detection.engine';
import { buildMatchPlayerKey } from '../../common/match-player-key.util';
import {
  hasManualOverride,
  readLiveSyncContract,
  type LiveSyncContract,
} from '../../common/live-sync-contract.util';

const DEFAULT_WIDGET_TEAM_NAME = 'Arenzyra';

type JsonRecord = Record<string, unknown>;

type MatchEngineTelemetryPayload = {
  matchId: string;
  players: unknown[];
  kills: unknown[];
  teams: unknown[];
  observer?: unknown;
  circle?: unknown;
  phase?: string | null;
  aliveTeams?: number | null;
  receivedAt?: string | null;
};

type MatchEnginePlayerState = {
  identityKey: string;
  playerId: string | null;
  playerName: string;
  avatarUrl: string | null;
  kills: number;
  alive: boolean;
  knocked: boolean;
  health: number | null;
  hasDied: boolean | null;
  lifeTelemetryFresh: boolean;
  damage: number | null;
};

type MatchEngineTeamState = {
  slotResultId: string;
  slotNumber: number;
  teamId: string | null;
  teamName: string;
  teamTag: string | null;
  logoUrl: string | null;
  color: string | null;
  placement: number | null;
  eliminatedAt: Date | null;
  totalKills: number;
  alivePlayers: number;
  totalPlayers: number | null;
  players: MatchEnginePlayerState[];
  hasTelemetryPlayers: boolean;
  alive: boolean;
  shouldEliminate: boolean;
  missed: boolean;
  eliminated: boolean;
};

export type MatchEngineResult = {
  matchId: string;
  updatedTeamCount: number;
  updatedPlayerCount: number;
  eliminatedTeamIds: string[];
  winnerTeamId: string | null;
};

type SlotResultWithPlayers = MatchSlotResult & {
  players: Array<
    MatchSlotPlayerResult & {
      player: {
        photoUrl: string | null;
      } | null;
    }
  >;
  team: {
    id: string;
    name: string;
    tag: string | null;
    logoUrl: string | null;
    accentLight: string | null;
    accentDark: string | null;
  } | null;
};

const asRecord = (value: unknown): JsonRecord | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const normalizeKey = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed.toLowerCase() : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return null;
};

const pickString = (value: unknown, keys: string[]): string | null => {
  const record = asRecord(value);
  if (!record) return null;

  for (const key of keys) {
    const candidate = record[key];
    if (candidate === null || candidate === undefined) continue;
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed.length > 0) return trimmed;
      continue;
    }
    if (typeof candidate === 'number' || typeof candidate === 'boolean') {
      return String(candidate);
    }
  }

  return null;
};

const pickNumber = (value: unknown, keys: string[]): number | null => {
  const record = asRecord(value);
  if (!record) return null;

  for (const key of keys) {
    const candidate = record[key];
    if (candidate === null || candidate === undefined || candidate === '') {
      continue;
    }
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
    if (typeof candidate === 'string') {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    if (typeof candidate === 'boolean') {
      return candidate ? 1 : 0;
    }
  }

  return null;
};

const pickBoolean = (value: unknown, keys: string[]): boolean | null => {
  const record = asRecord(value);
  if (!record) return null;

  for (const key of keys) {
    const candidate = record[key];
    if (candidate === null || candidate === undefined || candidate === '') {
      continue;
    }
    if (typeof candidate === 'boolean') {
      return candidate;
    }
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate !== 0;
    }
    if (typeof candidate === 'string') {
      const normalized = candidate.trim().toLowerCase();
      if (!normalized) {
        continue;
      }
      if (['true', '1', 'yes'].includes(normalized)) {
        return true;
      }
      if (['false', '0', 'no'].includes(normalized)) {
        return false;
      }
    }
  }

  return null;
};

const toIso = (value: unknown): string | null => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1_000_000_000_000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return null;
};

const toFutureIso = (
  value: unknown,
  referenceIso?: string | null,
): string | null => {
  const referenceMs = referenceIso ? Date.parse(referenceIso) : Date.now();
  const baseMs = Number.isNaN(referenceMs) ? Date.now() : referenceMs;

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 0 && value <= 86_400) {
      return new Date(baseMs + value * 1000).toISOString();
    }
    return toIso(value);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) {
      if (asNumber >= 0 && asNumber <= 86_400) {
        return new Date(baseMs + asNumber * 1000).toISOString();
      }
      return toIso(asNumber);
    }

    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return null;
};

const readMetaNumberSet = (value: unknown): Set<number> => {
  if (!Array.isArray(value)) {
    return new Set<number>();
  }

  return new Set<number>(
    value
      .map((entry) => {
        if (typeof entry === 'number' && Number.isFinite(entry)) {
          return Math.trunc(entry);
        }
        if (typeof entry === 'string' && entry.trim().length > 0) {
          const parsed = Number(entry);
          return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
        }
        return null;
      })
      .filter((entry): entry is number => entry !== null && entry > 0),
  );
};

@Injectable()
export class MatchEngineService {
  private readonly logger = new Logger(MatchEngineService.name);
  private readonly legacyAuthorityDisabled = true;

  constructor(
    private readonly prisma: PrismaService,
    private readonly matchState: MatchStateService,
    @Optional() private readonly fightDetection?: FightDetectionEngine,
    @Optional()
    private readonly teamElimination?: ObserverTeamEliminationService,
  ) {}

  async processTelemetryPacket(
    payload: MatchEngineTelemetryPayload,
  ): Promise<MatchEngineResult> {
    const matchId = String(payload?.matchId || '').trim();
    if (!matchId) {
      throw new BadRequestException('matchId is required');
    }
    if (this.legacyAuthorityDisabled) {
      return {
        matchId,
        updatedTeamCount: 0,
        updatedPlayerCount: 0,
        eliminatedTeamIds: [],
        winnerTeamId: null,
      };
    }

    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        id: true,
        organizationId: true,
        status: true,
        liveState: true,
        endedAt: true,
        controlState: {
          select: {
            state: true,
            resultsManualLock: true,
            resultsForceUnlock: true,
            metaJson: true,
          },
        },
      },
    });
    if (!match) {
      throw new NotFoundException('Match not found');
    }

    const updatedAt = toIso(payload.receivedAt) ?? new Date().toISOString();
    const receivedAt = new Date(updatedAt);
    const matchAlreadyFinished =
      match.status === MatchStatus.ENDED || match.liveState === LiveState.ENDED;
    const resultsManuallyLocked =
      match.controlState?.resultsManualLock === true &&
      match.controlState?.resultsForceUnlock !== true;
    const preserveStoredOutcome = matchAlreadyFinished || resultsManuallyLocked;

    const slotResults = (await this.prisma.matchSlotResult.findMany({
      where: { matchId: match.id, teamId: { not: null } },
      include: {
        players: {
          include: {
            player: {
              select: {
                photoUrl: true,
              },
            },
          },
        },
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
      },
      orderBy: { slotNumber: 'asc' },
    })) as SlotResultWithPlayers[];
    const slotLobbyRows = await this.prisma.matchSlot.findMany({
      where: { matchId: match.id, deletedAt: null },
      select: {
        slotNumber: true,
        lobbyStatus: true,
        playersInLobby: true,
      },
    });

    if (slotResults.length === 0) {
      this.logger.warn(
        `[MatchEngine] no slot results available after initialization match=${match.id}; telemetry cannot update results`,
      );
      const state = this.matchState.update(
        match.id,
        this.matchState.createEmptyState(match.id, updatedAt),
      );
      this.matchState.emitMatchUpdate(state);
      this.matchState.emitObserverStateUpdate(state);
      this.matchState.emitObserverKillFeedUpdate(state);
      return {
        matchId: match.id,
        updatedTeamCount: 0,
        updatedPlayerCount: 0,
        eliminatedTeamIds: [],
        winnerTeamId: null,
      };
    }

    const slotByNumber = new Map<number, SlotResultWithPlayers>();
    const slotByTeamId = new Map<string, SlotResultWithPlayers>();
    for (const slotResult of slotResults) {
      slotByNumber.set(slotResult.slotNumber, slotResult);
      const teamKey = normalizeKey(slotResult.teamId);
      if (teamKey) {
        slotByTeamId.set(teamKey, slotResult);
      }
    }

    const teamAliasToSlotNumber = this.buildTeamAliasLookup(payload.teams);
    const lobbyBySlotNumber = new Map(
      slotLobbyRows.map((slot) => [
        slot.slotNumber,
        {
          lobbyStatus: slot.lobbyStatus ?? null,
          playersInLobby: slot.playersInLobby ?? 0,
        },
      ]),
    );
    const resolveSlotResult = (
      rawTeamId: unknown,
    ): SlotResultWithPlayers | null => {
      const normalizedTeamId = normalizeKey(rawTeamId);
      if (normalizedTeamId && slotByTeamId.has(normalizedTeamId)) {
        return slotByTeamId.get(normalizedTeamId) ?? null;
      }

      const numericTeamId =
        typeof rawTeamId === 'number' && Number.isFinite(rawTeamId)
          ? rawTeamId
          : typeof rawTeamId === 'string' && rawTeamId.trim().length > 0
            ? Number(rawTeamId)
            : null;
      if (
        numericTeamId !== null &&
        Number.isFinite(numericTeamId) &&
        slotByNumber.has(numericTeamId)
      ) {
        return slotByNumber.get(numericTeamId) ?? null;
      }

      if (normalizedTeamId && teamAliasToSlotNumber.has(normalizedTeamId)) {
        return (
          slotByNumber.get(teamAliasToSlotNumber.get(normalizedTeamId) ?? -1) ??
          null
        );
      }

      return null;
    };
    const telemetryTeamPresence = new Set<string>();
    for (const team of Array.isArray(payload?.teams) ? payload.teams : []) {
      const slotResult = resolveSlotResult(
        pickString(team, [
          'teamId',
          'teamID',
          'TeamId',
          'TeamID',
          'id',
          'ID',
          'liveId',
          'LiveId',
          'teamName',
          'TeamName',
          'teamTag',
          'tag',
          'Tag',
        ]) ??
          pickNumber(team, [
            'teamNo',
            'TeamNo',
            'slot',
            'Slot',
            'teamId',
            'teamID',
            'TeamId',
            'TeamID',
            'id',
            'ID',
          ]),
      );
      if (slotResult) {
        telemetryTeamPresence.add(slotResult.id);
      }
    }

    const killCountsBySlot = new Map<string, number>();
    const killCountsByPlayer = new Map<string, number>();
    for (const kill of Array.isArray(payload?.kills) ? payload.kills : []) {
      const slotResult = resolveSlotResult(
        pickString(kill, [
          'killerTeamId',
          'killerTeamID',
          'KillerTeamId',
          'teamId',
          'teamID',
          'TeamId',
          'TeamID',
          'killerTeamName',
          'killerTeamTag',
        ]) ??
          pickNumber(kill, [
            'killerTeamId',
            'killerTeamID',
            'KillerTeamId',
            'teamId',
            'teamID',
            'TeamId',
            'TeamID',
            'teamNo',
            'TeamNo',
          ]),
      );
      if (slotResult) {
        killCountsBySlot.set(
          slotResult.id,
          (killCountsBySlot.get(slotResult.id) ?? 0) + 1,
        );
      }

      const killerIdentity = this.playerIdentityKey(
        pickString(kill, [
          'killerUid',
          'killerPlayerUid',
          'killerPlayerId',
          'killerId',
          'KillerId',
          'uid',
        ]),
        pickString(kill, [
          'killerName',
          'killerPlayer',
          'killer',
          'attackerName',
          'playerName',
        ]),
      );
      if (killerIdentity) {
        killCountsByPlayer.set(
          killerIdentity,
          (killCountsByPlayer.get(killerIdentity) ?? 0) + 1,
        );
      }
    }

    const groupedPlayers = new Map<string, MatchEnginePlayerState[]>();
    for (const [index, player] of (Array.isArray(payload?.players)
      ? payload.players
      : []
    ).entries()) {
      const slotResult = resolveSlotResult(
        pickString(player, [
          'teamId',
          'teamID',
          'TeamId',
          'TeamID',
          'team',
          'teamName',
          'TeamName',
          'teamTag',
          'tag',
        ]) ??
          pickNumber(player, [
            'teamId',
            'teamID',
            'TeamId',
            'TeamID',
            'teamNo',
            'TeamNo',
            'slot',
            'Slot',
          ]),
      );
      if (!slotResult) {
        continue;
      }

      const rawUid = pickString(player, [
        'uid',
        'playerUid',
        'playerId',
        'playerID',
        'PlayerId',
        'PlayerID',
        'id',
        'ID',
      ]);
      const playerName =
        pickString(player, [
          'playerName',
          'PlayerName',
          'name',
          'Name',
          'ign',
          'IGN',
        ]) ??
        rawUid ??
        `Telemetry Player ${index + 1}`;
      const identityKey =
        this.playerIdentityKey(rawUid, playerName) ??
        `player:${slotResult.id}:${index + 1}`;
      const lifeState = this.resolveTelemetryPlayerLifeState(player);
      const killsFromPlayer =
        pickNumber(player, ['killNum', 'KillNum', 'kills', 'Kills']) ?? 0;
      const kills = Math.max(
        0,
        killsFromPlayer,
        killCountsByPlayer.get(identityKey) ?? 0,
      );

      const existing = groupedPlayers.get(slotResult.id) ?? [];
      existing.push({
        identityKey,
        playerId: rawUid,
        playerName,
        avatarUrl: null,
        kills,
        alive: lifeState.alive,
        knocked: lifeState.knocked,
        health: lifeState.health,
        hasDied: lifeState.hasDied,
        lifeTelemetryFresh: lifeState.lifeTelemetryFresh,
        damage: pickNumber(player, [
          'damage',
          'Damage',
          'damageDealt',
          'DamageDealt',
          'totalDamage',
          'TotalDamage',
        ]),
      });
      groupedPlayers.set(slotResult.id, existing);
    }

    const mappedTelemetryPlayerCount = [...groupedPlayers.values()].reduce(
      (sum, players) => sum + players.length,
      0,
    );
    if (
      mappedTelemetryPlayerCount === 0 &&
      slotResults.every((slotResult) => slotResult.players.length === 0) &&
      !matchAlreadyFinished
    ) {
      this.logger.warn(
        `Ignoring telemetry packet without any mappable players match=${match.id} players=${Array.isArray(payload?.players) ? payload.players.length : 0} teams=${Array.isArray(payload?.teams) ? payload.teams.length : 0}`,
      );
      return {
        matchId: match.id,
        updatedTeamCount: slotResults.length,
        updatedPlayerCount: 0,
        eliminatedTeamIds: [],
        winnerTeamId: null,
      };
    }

    const hasFreshMappedTelemetry =
      mappedTelemetryPlayerCount > 0 && !matchAlreadyFinished;
    const gameTime = this.resolveGameTimeSeconds(payload);
    const explicitFinishedSignal = this.hasExplicitFinishedSignal(payload);
    const reportedAliveTeams = this.resolveReportedAliveTeams(payload);
    const terminalAliveTeamsSignal = reportedAliveTeams === 1;
    const terminalTelemetrySignal =
      explicitFinishedSignal || terminalAliveTeamsSignal;
    const gameplayConfirmed =
      matchAlreadyFinished ||
      terminalTelemetrySignal ||
      this.hasGameplayStarted(
        payload,
        gameTime,
        [...groupedPlayers.values()].flat(),
      );
    const joinedSlotNumbers = readMetaNumberSet(
      (match.controlState?.metaJson as JsonRecord | null)?.joinedSlotNumbers,
    );
    const previouslyMissedSlotNumbers = readMetaNumberSet(
      (match.controlState?.metaJson as JsonRecord | null)?.missedSlotNumbers,
    );
    const liveSyncContract = readLiveSyncContract(match.controlState?.metaJson);

    const teamStates = slotResults.map<MatchEngineTeamState>((slotResult) => {
      const telemetryPlayers = this.dedupePlayers(
        groupedPlayers.get(slotResult.id) ?? [],
      );
      const normalizedTelemetryPlayers = gameplayConfirmed
        ? telemetryPlayers
        : this.neutralizePlayersForPregame(telemetryPlayers);
      const hydratedPlayers = this.hydratePlayersFromSlotResult(
        slotResult.players,
      );
      const hasTelemetryPlayers = telemetryPlayers.length > 0;
      const nextPlayers = this.applyManualOwnershipToPlayers(
        slotResult,
        hasTelemetryPlayers
          ? normalizedTelemetryPlayers
          : gameplayConfirmed
            ? hydratedPlayers
            : this.neutralizePlayersForPregame(hydratedPlayers),
        liveSyncContract,
      );
      const lobbySnapshot =
        lobbyBySlotNumber.get(slotResult.slotNumber) ?? null;
      const lobbyPlayersInSlot = Math.max(
        0,
        lobbySnapshot?.playersInLobby ?? 0,
      );
      const knownPlayers = Math.max(nextPlayers.length, lobbyPlayersInSlot);
      const everJoined = joinedSlotNumbers.has(slotResult.slotNumber);
      const hasTelemetryTeamPresence = telemetryTeamPresence.has(slotResult.id);
      if (!matchAlreadyFinished && !gameplayConfirmed) {
        return {
          slotResultId: slotResult.id,
          slotNumber: slotResult.slotNumber,
          teamId: slotResult.teamId ?? null,
          teamName: slotResult.team?.name ?? DEFAULT_WIDGET_TEAM_NAME,
          teamTag: resolveLiveMappingTeamTag(
            slotResult.team?.name ?? null,
            slotResult.team?.tag ?? null,
          ),
          logoUrl: slotResult.team?.logoUrl ?? null,
          color:
            slotResult.team?.accentLight ?? slotResult.team?.accentDark ?? null,
          placement: null,
          eliminatedAt: null,
          totalKills: 0,
          alivePlayers: knownPlayers,
          totalPlayers:
            knownPlayers > 0
              ? knownPlayers
              : slotResult.players.length > 0
                ? slotResult.players.length
                : null,
          players: nextPlayers,
          hasTelemetryPlayers,
          alive: true,
          shouldEliminate: false,
          missed: false,
          eliminated: false,
        };
      }

      const usesFallbackRosterOnly =
        hasFreshMappedTelemetry && gameplayConfirmed && !hasTelemetryPlayers;
      const missedByNoJoin =
        !preserveStoredOutcome &&
        slotResult.teamId !== null &&
        !everJoined &&
        hasFreshMappedTelemetry &&
        gameplayConfirmed &&
        gameTime !== null &&
        gameTime >= 60 &&
        !hasTelemetryPlayers &&
        !hasTelemetryTeamPresence &&
        (lobbySnapshot?.playersInLobby ?? 0) <= 0;
      const missed =
        previouslyMissedSlotNumbers.has(slotResult.slotNumber) ||
        missedByNoJoin;
      const alivePlayers = usesFallbackRosterOnly
        ? 0
        : this.countAlivePlayers(nextPlayers);
      const alive = usesFallbackRosterOnly
        ? false
        : this.isTeamAlive(nextPlayers);
      const shouldEliminate = usesFallbackRosterOnly
        ? terminalTelemetrySignal
        : this.shouldEliminateTeam(nextPlayers);
      const revivedByTelemetry =
        !preserveStoredOutcome &&
        hasTelemetryPlayers &&
        alive &&
        slotResult.eliminatedAt !== null;
      const playerKillTotal = nextPlayers.reduce(
        (sum, player) => sum + Math.max(0, player.kills),
        0,
      );
      const totalKills = Math.max(
        playerKillTotal,
        killCountsBySlot.get(slotResult.id) ?? 0,
        slotResult.totalKills ?? 0,
      );
      const previouslyEliminated =
        !missed &&
        !revivedByTelemetry &&
        (slotResult.eliminatedAt !== null ||
          (slotResult.placement !== null && slotResult.placement > 1));

      return {
        slotResultId: slotResult.id,
        slotNumber: slotResult.slotNumber,
        teamId: slotResult.teamId ?? null,
        teamName: slotResult.team?.name ?? DEFAULT_WIDGET_TEAM_NAME,
        teamTag: resolveLiveMappingTeamTag(
          slotResult.team?.name ?? null,
          slotResult.team?.tag ?? null,
        ),
        logoUrl: slotResult.team?.logoUrl ?? null,
        color:
          slotResult.team?.accentLight ?? slotResult.team?.accentDark ?? null,
        placement: preserveStoredOutcome
          ? (slotResult.placement ?? null)
          : previouslyEliminated
            ? (slotResult.placement ?? null)
            : null,
        eliminatedAt: preserveStoredOutcome
          ? (slotResult.eliminatedAt ?? null)
          : previouslyEliminated
            ? (slotResult.eliminatedAt ?? receivedAt)
            : null,
        totalKills,
        alivePlayers,
        totalPlayers:
          nextPlayers.length > 0
            ? nextPlayers.length
            : slotResult.players.length > 0
              ? slotResult.players.length
              : null,
        players: nextPlayers,
        hasTelemetryPlayers,
        alive,
        shouldEliminate,
        missed,
        eliminated: missed || previouslyEliminated,
      };
    });

    const alivePlayers = teamStates.reduce(
      (sum, team) => sum + team.alivePlayers,
      0,
    );
    const missedTeams = teamStates
      .filter((team) => team.missed)
      .sort((left, right) => left.slotNumber - right.slotNumber);
    let remainingTeams = teamStates.filter(
      (team) => !team.missed && !team.eliminated,
    ).length;
    const aliveTeams = teamStates.filter(
      (team) => !team.eliminated && team.alive,
    );
    const allowLateWinnerFinalization =
      !matchAlreadyFinished &&
      (terminalTelemetrySignal || (gameTime !== null && gameTime > 120)) &&
      aliveTeams.length === 1;

    const newlyEliminated = matchAlreadyFinished
      ? []
      : [...teamStates]
          .filter((team) => {
            const staleLateGameElimination =
              allowLateWinnerFinalization &&
              !team.hasTelemetryPlayers &&
              !team.alive;
            return (
              !team.eliminated &&
              (team.shouldEliminate || staleLateGameElimination)
            );
          })
          .sort((left, right) => left.slotNumber - right.slotNumber);
    if (!matchAlreadyFinished) {
      for (const team of missedTeams) {
        team.eliminated = true;
        team.eliminatedAt = null;
        team.placement = null;
        team.totalKills = 0;
      }

      for (const team of newlyEliminated) {
        team.eliminated = true;
        team.eliminatedAt = receivedAt;
        team.placement = Math.max(1, remainingTeams);
        remainingTeams = Math.max(1, remainingTeams - 1);
      }

      for (const team of aliveTeams) {
        team.placement = null;
      }
    }

    const lastTeamStandingDetected =
      !matchAlreadyFinished &&
      aliveTeams.length === 1 &&
      teamStates.filter((team) => !team.eliminated).length === 1 &&
      aliveTeams[0] !== undefined;
    const winnerTeam = matchAlreadyFinished
      ? (teamStates.find((team) => team.placement === 1) ??
        aliveTeams[0] ??
        null)
      : lastTeamStandingDetected
        ? (aliveTeams[0] ?? null)
        : null;

    if (lastTeamStandingDetected && winnerTeam) {
      winnerTeam.placement = 1;
      winnerTeam.eliminated = false;
      winnerTeam.eliminatedAt = null;
    }

    const currentMeta = await this.prisma.matchControlState.findUnique({
      where: { matchId: match.id },
      select: { metaJson: true, organizationId: true },
    });
    const existingMeta = asRecord(currentMeta?.metaJson) ?? {};
    const nextMissedSlots = teamStates
      .filter((team) => team.missed)
      .map((team) => team.slotNumber)
      .sort((left, right) => left - right);
    const previousMissedSlots = readMetaNumberSet(
      existingMeta.missedSlotNumbers,
    );
    const missedSlotsChanged =
      nextMissedSlots.length !== previousMissedSlots.size ||
      nextMissedSlots.some(
        (slotNumber) => !previousMissedSlots.has(slotNumber),
      );

    if (missedSlotsChanged) {
      const nextMeta: Prisma.InputJsonObject = {
        ...(existingMeta as Prisma.InputJsonObject),
        missedSlotNumbers: nextMissedSlots,
      };
      await this.prisma.matchControlState.upsert({
        where: { matchId: match.id },
        update: {
          metaJson: nextMeta,
        },
        create: {
          matchId: match.id,
          organizationId: match.organizationId,
          state: match.controlState?.state ?? 'READY',
          metaJson: nextMeta,
        },
      });
    }

    const state = this.buildMatchState(
      match.id,
      updatedAt,
      teamStates,
      payload.kills,
      payload,
      lastTeamStandingDetected || matchAlreadyFinished,
    );
    const nextState = this.matchState.update(match.id, state);
    this.matchState.emitMatchUpdate(nextState);
    this.matchState.emitObserverStateUpdate(nextState);
    this.matchState.emitObserverKillFeedUpdate(nextState);
    for (const team of newlyEliminated) {
      const teamId = team.teamId ?? team.slotResultId;
      this.teamElimination?.publish({
        matchId: match.id,
        eventId: `team-eliminated:${match.id}:${team.slotResultId}`,
        teamId,
        teamName: team.teamName,
        placement: team.placement ?? null,
        kills: team.totalKills,
        eliminatedAt:
          team.eliminatedAt?.toISOString() ?? receivedAt.toISOString(),
      });
    }
    this.fightDetection?.processTelemetryPacket({
      matchId: match.id,
      updatedAt,
      kills: Array.isArray(payload.kills) ? payload.kills : [],
      teams: teamStates.map((team) => ({
        teamId: team.teamId,
        teamName: team.teamName,
        teamTag: team.teamTag,
        logoUrl: team.logoUrl,
        slot: team.slotNumber,
      })),
    });

    const winnerTeamId =
      lastTeamStandingDetected || matchAlreadyFinished
        ? (winnerTeam?.teamId ?? null)
        : null;
    const eliminatedTeamIds = newlyEliminated
      .map((team) => team.teamId)
      .filter((teamId): teamId is string => Boolean(teamId));

    this.logger.log(
      `[MatchEngine] updated live telemetry state match=${match.id} slotResults=${teamStates.length} players=${teamStates.reduce((sum, team) => sum + team.players.length, 0)} aliveTeams=${aliveTeams.length} alivePlayers=${alivePlayers} eliminated=${eliminatedTeamIds.length} winner=${winnerTeamId ?? 'none'}`,
    );

    return {
      matchId: match.id,
      updatedTeamCount: teamStates.length,
      updatedPlayerCount: teamStates.reduce(
        (sum, team) => sum + team.players.length,
        0,
      ),
      eliminatedTeamIds,
      winnerTeamId,
    };
  }

  private buildMatchState(
    matchId: string,
    updatedAt: string,
    teams: MatchEngineTeamState[],
    kills: unknown[],
    payload: MatchEngineTelemetryPayload,
    winnerEligible: boolean,
  ): MatchState {
    const leaderboard = this.sortTeamsForLeaderboard(teams).map(
      (team, index) => {
        const isEliminated = team.alivePlayers === 0;
        return {
          rank: index + 1,
          teamId: team.teamId,
          slot: team.slotNumber,
          teamName: team.teamName,
          teamTag: team.teamTag,
          logoUrl: team.logoUrl,
          color: team.color,
          kills: team.totalKills,
          alivePlayers: team.alivePlayers,
          totalPlayers: team.totalPlayers,
          placement: team.placement,
          isEliminated,
          players: team.players.map((player) => ({
            playerId: player.playerId,
            playerName: player.playerName,
            avatarUrl: player.avatarUrl,
            kills: player.kills,
            alive: player.alive,
            knocked: player.knocked,
            health: player.health,
            hasDied: player.hasDied,
            lifeTelemetryFresh: player.lifeTelemetryFresh,
          })),
        };
      },
    );

    const teamsAlive = teams.filter(
      (team) => !team.eliminated && team.alive,
    ).length;
    const killFeed = this.buildKillFeed(kills, teams);
    const playerCard = this.buildPlayerCard(teams, killFeed);
    const circle = this.buildCircleState(payload, updatedAt);
    const winner = this.buildWinner(leaderboard, teamsAlive, winnerEligible);

    return {
      matchId,
      updatedAt,
      teamsAlive,
      leaderboard,
      killFeed,
      playerCard,
      circle,
      winner,
    };
  }

  private buildKillFeed(
    source: unknown[],
    teams: MatchEngineTeamState[],
  ): MatchState['killFeed'] {
    const teamsById = new Map<string, MatchEngineTeamState>();
    const teamsBySlot = new Map<number, MatchEngineTeamState>();

    for (const team of teams) {
      const teamKey = normalizeKey(team.teamId);
      if (teamKey) {
        teamsById.set(teamKey, team);
      }
      teamsBySlot.set(team.slotNumber, team);
    }

    return (Array.isArray(source) ? source : [])
      .map((entry, index) => {
        const killerTeam = this.resolveTeamState(
          pickString(entry, [
            'killerTeamId',
            'killerTeamID',
            'KillerTeamId',
            'teamId',
            'teamID',
          ]),
          pickNumber(entry, ['killerTeamNo', 'killerSlot', 'killerTeam']),
          teamsById,
          teamsBySlot,
        );
        const victimTeam = this.resolveTeamState(
          pickString(entry, [
            'victimTeamId',
            'victimTeamID',
            'targetTeamId',
            'targetTeamID',
          ]),
          pickNumber(entry, ['victimTeamNo', 'victimSlot', 'victimTeam']),
          teamsById,
          teamsBySlot,
        );
        const tsIso =
          toIso(
            pickString(entry, ['timestamp', 'time', 'ts']) ??
              pickNumber(entry, ['timestamp', 'time', 'ts']),
          ) ?? null;
        const killerPlayerId = pickString(entry, [
          'killerUid',
          'killerPlayerUid',
          'killerPlayerId',
          'killerId',
          'attackerId',
          'attackerPlayerId',
        ]);
        const killerName = pickString(entry, [
          'killerName',
          'killer',
          'killerPlayer',
          'attackerName',
        ]);
        const victimPlayerId = pickString(entry, [
          'victimUid',
          'victimPlayerUid',
          'victimPlayerId',
          'victimId',
          'targetId',
          'targetPlayerId',
        ]);
        const victimName = pickString(entry, [
          'victimName',
          'victim',
          'victimPlayer',
          'targetName',
        ]);
        const weapon = pickString(entry, [
          'weapon',
          'weaponName',
          'damageCauserName',
        ]);
        const killerTeamId =
          killerTeam?.teamId ??
          pickString(entry, [
            'killerTeamId',
            'killerTeamID',
            'KillerTeamId',
            'teamId',
            'teamID',
          ]) ??
          pickNumber(entry, [
            'killerTeamNo',
            'killerSlot',
            'killerTeam',
            'teamNo',
            'slot',
          ])?.toString() ??
          null;
        const victimTeamId =
          victimTeam?.teamId ??
          pickString(entry, [
            'victimTeamId',
            'victimTeamID',
            'targetTeamId',
            'targetTeamID',
          ]) ??
          pickNumber(entry, [
            'victimTeamNo',
            'victimSlot',
            'victimTeam',
            'targetTeam',
          ])?.toString() ??
          null;
        const fallbackId = [
          tsIso ?? 'kill',
          killerPlayerId ??
            killerName ??
            killerTeamId ??
            killerTeam?.teamName ??
            `killer-${index}`,
          victimPlayerId ??
            victimName ??
            victimTeamId ??
            victimTeam?.teamName ??
            `victim-${index}`,
          weapon ?? 'weapon',
        ].join(':');
        const isSelf =
          (killerPlayerId !== null &&
            victimPlayerId !== null &&
            killerPlayerId === victimPlayerId) ||
          (killerName !== null &&
            victimName !== null &&
            killerName === victimName);
        const isZone =
          pickBoolean(entry, [
            'isZone',
            'zoneKill',
            'isBlueZone',
            'blueZone',
          ]) === true ||
          (weapon?.toLowerCase().includes('zone') ?? false);

        return {
          id: pickString(entry, ['killId', 'id', 'ID']) ?? fallbackId,
          killerPlayerId,
          killerName,
          killerTeamId,
          killerTeam:
            killerTeam?.teamTag ??
            killerTeam?.teamName ??
            pickString(entry, ['killerTeamName', 'killerTeamTag']) ??
            null,
          victimPlayerId,
          victimName,
          victimTeamId,
          victimTeam:
            victimTeam?.teamTag ??
            victimTeam?.teamName ??
            pickString(entry, ['victimTeamName', 'victimTeamTag']) ??
            null,
          weapon,
          tsIso,
          isKnock:
            pickBoolean(entry, [
              'isKnock',
              'isKnocked',
              'knock',
              'isDown',
              'isDBNO',
            ]) === true,
          isThirst:
            pickBoolean(entry, [
              'isThirst',
              'thirst',
              'isFlush',
              'isConfirmed',
            ]) === true,
          isSelf,
          isZone,
          isReviveRelated:
            pickBoolean(entry, [
              'isReviveRelated',
              'reviveRelated',
              'isReviveKill',
            ]) === true,
        };
      })
      .sort((left, right) => {
        const leftTs = left.tsIso ? Date.parse(left.tsIso) : 0;
        const rightTs = right.tsIso ? Date.parse(right.tsIso) : 0;
        return rightTs - leftTs;
      })
      .slice(0, 8);
  }

  private buildPlayerCard(
    teams: MatchEngineTeamState[],
    killFeed: MatchState['killFeed'],
  ): MatchState['playerCard'] {
    const latestKiller =
      killFeed.find((entry) => entry.killerName)?.killerName ?? null;
    const players = teams.flatMap((team) =>
      team.players.map((player) => ({
        team,
        player,
      })),
    );

    const featured =
      players.find(
        ({ player }) =>
          latestKiller !== null && player.playerName === latestKiller,
      ) ??
      [...players].sort((left, right) => {
        if (right.player.kills !== left.player.kills) {
          return right.player.kills - left.player.kills;
        }
        if (left.player.alive !== right.player.alive) {
          return Number(right.player.alive) - Number(left.player.alive);
        }
        return left.player.playerName.localeCompare(right.player.playerName);
      })[0] ??
      null;

    if (!featured) {
      return null;
    }

    return {
      playerId: featured.player.playerId,
      name: featured.player.playerName,
      avatarUrl: featured.player.avatarUrl,
      teamId: featured.team.teamId,
      teamName: featured.team.teamName,
      teamTag: featured.team.teamTag,
      logoUrl: featured.team.logoUrl,
      color: featured.team.color,
      kills: featured.player.kills,
      alive: featured.player.alive,
      damage: featured.player.damage,
    };
  }

  private buildCircleState(
    payload: MatchEngineTelemetryPayload,
    updatedAt: string,
  ): MatchState['circle'] {
    const observer = asRecord(payload.observer);
    const source =
      asRecord(payload.circle) ??
      asRecord(observer?.circle) ??
      asRecord(observer?.CircleInfo) ??
      asRecord(observer?.zone) ??
      observer ??
      asRecord(payload as unknown);

    if (!source) {
      return null;
    }

    const zoneSource =
      asRecord(source.zone) &&
      Object.keys(asRecord(source.zone) ?? {}).length > 0
        ? (asRecord(source.zone) as JsonRecord)
        : source;
    const safeZone = this.parseCircleZone(
      zoneSource.safeZone ??
        zoneSource.safezone ??
        zoneSource.blueZone ??
        zoneSource.safe ??
        zoneSource.current ??
        null,
    );
    const nextZone = this.parseCircleZone(
      zoneSource.nextZone ??
        zoneSource.nextzone ??
        zoneSource.whiteZone ??
        zoneSource.nextSafeZone ??
        zoneSource.next ??
        null,
    );
    const phase =
      pickNumber(zoneSource, [
        'phase',
        'Phase',
        'circlePhase',
        'phaseIndex',
        'zonePhaseIndex',
        'circleIndex',
        'CircleIndex',
      ]) ??
      pickNumber(source, [
        'phase',
        'Phase',
        'circlePhase',
        'phaseIndex',
        'zonePhaseIndex',
        'circleIndex',
        'CircleIndex',
      ]);
    const counter =
      pickNumber(zoneSource, ['Counter', 'counter']) ??
      pickNumber(source, ['Counter', 'counter']);
    const maxTime =
      pickNumber(zoneSource, ['MaxTime', 'maxTime']) ??
      pickNumber(source, ['MaxTime', 'maxTime']);
    const nextShrinkAt =
      toFutureIso(
        zoneSource.nextShrinkAt ??
          zoneSource.nextShrinkTs ??
          zoneSource.nextShrinkTime ??
          zoneSource.zoneNextShrinkAt ??
          zoneSource.nextPhaseAt ??
          zoneSource.remainingTime ??
          zoneSource.countdown ??
          source.nextShrinkAt ??
          source.nextPhaseAt ??
          null,
        updatedAt,
      ) ??
      (counter !== null && maxTime !== null && maxTime >= counter
        ? toFutureIso(maxTime - counter, updatedAt)
        : null);

    if (!safeZone && !nextZone && phase === null && nextShrinkAt === null) {
      return null;
    }

    return {
      phase,
      nextShrinkAt,
      safeZone,
      nextZone,
    };
  }

  private parseCircleZone(
    value: unknown,
  ): { x: number; y: number; r: number } | null {
    const source = asRecord(value);
    if (!source) {
      return null;
    }

    const center =
      asRecord(source.center) ?? asRecord(source.zoneCenter) ?? null;
    const x =
      pickNumber(source, ['x', 'X', 'centerX', 'cx']) ??
      pickNumber(center, ['x', 'X', 'lon']);
    const y =
      pickNumber(source, ['y', 'Y', 'centerY', 'cy']) ??
      pickNumber(center, ['y', 'Y', 'lat']);
    const r = pickNumber(source, [
      'r',
      'radius',
      'Radius',
      'size',
      'zoneRadius',
    ]);

    if (x === null || y === null || r === null) {
      return null;
    }

    return { x, y, r };
  }

  private buildWinner(
    leaderboard: MatchState['leaderboard'],
    teamsAlive: number,
    winnerEligible: boolean,
  ): MatchState['winner'] {
    if (!leaderboard.length) {
      return null;
    }

    const finalizedWinner = winnerEligible
      ? (leaderboard.find((team) => team.placement === 1) ?? null)
      : null;
    const aliveWinner =
      leaderboard.find((team) => team.alivePlayers > 0) ?? null;
    const topWinner = leaderboard[0] ?? null;
    const selected =
      finalizedWinner ??
      (winnerEligible && teamsAlive <= 1 ? (aliveWinner ?? topWinner) : null);
    if (!selected) {
      return null;
    }

    return {
      teamId: selected.teamId,
      slot: selected.slot,
      teamName: selected.teamName,
      teamTag: selected.teamTag,
      logoUrl: selected.logoUrl,
      color: selected.color,
      kills: selected.kills,
      alivePlayers: selected.alivePlayers,
      placement: selected.placement,
    };
  }

  private resolveTeamState(
    rawTeamId: string | null,
    rawSlot: number | null,
    teamsById: Map<string, MatchEngineTeamState>,
    teamsBySlot: Map<number, MatchEngineTeamState>,
  ): MatchEngineTeamState | null {
    const normalizedTeamId = normalizeKey(rawTeamId);
    if (normalizedTeamId && teamsById.has(normalizedTeamId)) {
      return teamsById.get(normalizedTeamId) ?? null;
    }
    if (rawSlot !== null && rawSlot !== undefined && teamsBySlot.has(rawSlot)) {
      return teamsBySlot.get(rawSlot) ?? null;
    }
    return null;
  }

  private sortTeamsForLeaderboard(
    teams: MatchEngineTeamState[],
  ): MatchEngineTeamState[] {
    return [...teams].sort((left, right) => {
      const leftAlive = left.alivePlayers > 0 ? 1 : 0;
      const rightAlive = right.alivePlayers > 0 ? 1 : 0;
      if (leftAlive !== rightAlive) {
        return rightAlive - leftAlive;
      }

      const leftPlacement = left.placement ?? Number.MAX_SAFE_INTEGER;
      const rightPlacement = right.placement ?? Number.MAX_SAFE_INTEGER;
      if (leftAlive === 0 && leftPlacement !== rightPlacement) {
        return leftPlacement - rightPlacement;
      }

      if (right.alivePlayers !== left.alivePlayers) {
        return right.alivePlayers - left.alivePlayers;
      }
      if (right.totalKills !== left.totalKills) {
        return right.totalKills - left.totalKills;
      }
      if (leftPlacement !== rightPlacement) {
        return leftPlacement - rightPlacement;
      }
      if (left.slotNumber !== right.slotNumber) {
        return left.slotNumber - right.slotNumber;
      }
      return left.teamName.localeCompare(right.teamName);
    });
  }

  private buildTeamAliasLookup(teams: unknown[]): Map<string, number> {
    const aliasLookup = new Map<string, number>();

    for (const team of Array.isArray(teams) ? teams : []) {
      const slotNumber =
        pickNumber(team, ['teamNo', 'TeamNo', 'slot', 'Slot', 'teamIndex']) ??
        pickNumber(team, ['teamId', 'teamID', 'TeamId', 'TeamID', 'id']);
      if (slotNumber === null) {
        continue;
      }

      const aliases = [
        pickString(team, ['teamId', 'teamID', 'TeamId', 'TeamID']),
        pickString(team, ['id', 'ID', 'liveId', 'LiveId']),
        pickString(team, ['teamNo', 'TeamNo', 'slot', 'Slot']),
        pickString(team, ['teamName', 'TeamName', 'name']),
        pickString(team, ['teamTag', 'tag', 'Tag']),
        String(slotNumber),
      ];

      for (const alias of aliases) {
        const normalizedAlias = normalizeKey(alias);
        if (!normalizedAlias) continue;
        aliasLookup.set(normalizedAlias, slotNumber);
      }
    }

    return aliasLookup;
  }

  private dedupePlayers(
    players: MatchEnginePlayerState[],
  ): MatchEnginePlayerState[] {
    const deduped = new Map<string, MatchEnginePlayerState>();

    for (const player of players) {
      const existing = deduped.get(player.identityKey);
      if (!existing) {
        deduped.set(player.identityKey, { ...player });
        continue;
      }

      existing.kills = Math.max(existing.kills, player.kills);
      const existingStandingAlive = existing.alive && !existing.knocked;
      const incomingStandingAlive = player.alive && !player.knocked;

      existing.alive = existing.alive || player.alive;
      if (existingStandingAlive || incomingStandingAlive) {
        existing.knocked = false;
      } else if (player.knocked) {
        existing.knocked = true;
      }
      if (existing.health === null) {
        existing.health = player.health;
      } else if (player.health !== null) {
        existing.health = Math.max(existing.health, player.health);
      }
      if (existing.hasDied === null) {
        existing.hasDied = player.hasDied;
      } else if (player.hasDied === false) {
        existing.hasDied = false;
      } else if (player.hasDied === true && existing.hasDied !== false) {
        existing.hasDied = true;
      }
      existing.lifeTelemetryFresh =
        existing.lifeTelemetryFresh || player.lifeTelemetryFresh;
      if (!existing.playerName && player.playerName) {
        existing.playerName = player.playerName;
      }
      if (!existing.playerId && player.playerId) {
        existing.playerId = player.playerId;
      }
      if (!existing.avatarUrl && player.avatarUrl) {
        existing.avatarUrl = player.avatarUrl;
      }
      if (existing.damage === null && player.damage !== null) {
        existing.damage = player.damage;
      }
    }

    return [...deduped.values()].sort((left, right) =>
      left.playerName.localeCompare(right.playerName),
    );
  }

  private applyManualOwnershipToPlayers(
    slotResult: SlotResultWithPlayers,
    players: MatchEnginePlayerState[],
    contract: LiveSyncContract,
  ): MatchEnginePlayerState[] {
    if (slotResult.players.length === 0) {
      return players;
    }

    const byPlayerId = new Map<
      string,
      SlotResultWithPlayers['players'][number]
    >();
    const byName = new Map<string, SlotResultWithPlayers['players'][number]>();

    for (const persisted of slotResult.players) {
      const playerIdKey = normalizeKey(persisted.playerId);
      if (playerIdKey) {
        byPlayerId.set(playerIdKey, persisted);
      }
      const nameKey = normalizeKey(persisted.playerName);
      if (nameKey) {
        byName.set(nameKey, persisted);
      }
    }

    const matchedPersistedIds = new Set<string>();
    const protectedPlayers = players.map((player) => {
      const persisted = this.resolvePersistedSlotPlayer(
        player,
        byPlayerId,
        byName,
      );
      if (!persisted) {
        return player;
      }

      matchedPersistedIds.add(persisted.id);
      return this.applyPersistedManualOwnership(player, persisted, contract);
    });

    for (const persisted of slotResult.players) {
      if (matchedPersistedIds.has(persisted.id)) {
        continue;
      }

      const ownership =
        contract.overrides.players[this.matchPlayerKeyForSlotPlayer(persisted)];
      if (
        !hasManualOverride(ownership?.alive) &&
        !hasManualOverride(ownership?.knocked) &&
        !hasManualOverride(ownership?.kills)
      ) {
        continue;
      }

      protectedPlayers.push(this.toProtectedPersistedPlayer(persisted));
    }

    return this.dedupePlayers(protectedPlayers);
  }

  private resolvePersistedSlotPlayer(
    player: MatchEnginePlayerState,
    byPlayerId: Map<string, SlotResultWithPlayers['players'][number]>,
    byName: Map<string, SlotResultWithPlayers['players'][number]>,
  ): SlotResultWithPlayers['players'][number] | null {
    const playerIdKey = normalizeKey(player.playerId);
    if (playerIdKey && byPlayerId.has(playerIdKey)) {
      return byPlayerId.get(playerIdKey) ?? null;
    }

    const nameKey = normalizeKey(player.playerName);
    if (nameKey && byName.has(nameKey)) {
      return byName.get(nameKey) ?? null;
    }

    return null;
  }

  private applyPersistedManualOwnership(
    player: MatchEnginePlayerState,
    persisted: SlotResultWithPlayers['players'][number],
    contract: LiveSyncContract,
  ): MatchEnginePlayerState {
    const ownership =
      contract.overrides.players[this.matchPlayerKeyForSlotPlayer(persisted)];
    if (!ownership) {
      return player;
    }

    const nextPlayer = { ...player };
    const persistedAlive = this.slotPlayerIsAlive(persisted);
    const persistedKnocked = this.slotPlayerIsKnocked(persisted);
    const persistedKills = Math.max(0, persisted.kills ?? 0);

    if (hasManualOverride(ownership.kills)) {
      nextPlayer.kills = persistedKills;
    }
    if (hasManualOverride(ownership.alive)) {
      nextPlayer.alive = persistedAlive;
    }
    if (hasManualOverride(ownership.knocked)) {
      nextPlayer.knocked = persistedKnocked;
    }

    // Keep player state internally coherent after per-field override overlays.
    if (!nextPlayer.alive) {
      nextPlayer.knocked = false;
    } else if (nextPlayer.knocked) {
      nextPlayer.alive = true;
    }

    if (!nextPlayer.avatarUrl && persisted.player?.photoUrl) {
      nextPlayer.avatarUrl = persisted.player.photoUrl;
    }

    return nextPlayer;
  }

  private toProtectedPersistedPlayer(
    player: SlotResultWithPlayers['players'][number],
  ): MatchEnginePlayerState {
    return {
      identityKey:
        this.playerIdentityKey(player.playerId ?? null, player.playerName) ??
        `player-result:${player.id}`,
      playerId: player.playerId ?? null,
      playerName: player.playerName,
      avatarUrl: player.player?.photoUrl ?? null,
      kills: Math.max(0, player.kills ?? 0),
      alive: this.slotPlayerIsAlive(player),
      knocked: this.slotPlayerIsKnocked(player),
      health: null,
      hasDied: null,
      lifeTelemetryFresh: false,
      damage: null,
    };
  }

  private matchPlayerKeyForSlotPlayer(
    player: SlotResultWithPlayers['players'][number],
  ): string {
    return (
      buildMatchPlayerKey({
        playerId: player.playerId ?? null,
        playerResultId: player.id,
      }) ?? player.id
    );
  }

  private slotPlayerIsAlive(
    player: SlotResultWithPlayers['players'][number],
  ): boolean {
    return (
      ((player as { isAlive?: boolean | null }).isAlive ??
        (player as { alive?: boolean | null }).alive ??
        true) === true
    );
  }

  private slotPlayerIsKnocked(
    player: SlotResultWithPlayers['players'][number],
  ): boolean {
    return (
      ((player as { isKnocked?: boolean | null }).isKnocked ?? false) === true
    );
  }

  private hydratePlayersFromSlotResult(
    players: SlotResultWithPlayers['players'],
  ): MatchEnginePlayerState[] {
    return (players ?? [])
      .map((player, index) => ({
        identityKey:
          this.playerIdentityKey(player.playerId ?? null, player.playerName) ??
          `player-result:${player.id}:${index + 1}`,
        playerId: player.playerId ?? null,
        playerName: player.playerName,
        avatarUrl: player.player?.photoUrl ?? null,
        kills: Math.max(0, player.kills ?? 0),
        alive:
          ((player as { isAlive?: boolean | null }).isAlive ??
            (player as { alive?: boolean | null }).alive ??
            true) === true,
        // Stored slot-player rows are fallback roster state, not fresh life telemetry.
        knocked: false,
        health: null,
        hasDied: null,
        lifeTelemetryFresh: false,
        damage: null,
      }))
      .sort((left, right) => left.playerName.localeCompare(right.playerName));
  }

  private resolveTelemetryPlayerLifeState(player: unknown): {
    alive: boolean;
    knocked: boolean;
    health: number | null;
    hasDied: boolean | null;
    lifeTelemetryFresh: boolean;
  } {
    const health = pickNumber(player, [
      'health',
      'Health',
      'hp',
      'HP',
      'currentHealth',
      'CurrentHealth',
    ]);
    const hasDied = pickBoolean(player, [
      'bHasDied',
      'BHasDied',
      'hasDied',
      'HasDied',
    ]);
    const knockedExplicit = pickBoolean(player, [
      'isKnocked',
      'IsKnocked',
      'knocked',
      'Knocked',
      'bIsKnocked',
      'BIsKnocked',
      'isDown',
      'IsDown',
      'down',
      'Down',
      'downed',
      'Downed',
    ]);
    const liveStateLabel = pickString(player, [
      'liveState',
      'LiveState',
      'state',
      'State',
      'status',
      'Status',
    ])?.toLowerCase();
    const liveState = pickNumber(player, ['liveState', 'LiveState', 'state']);
    const lifeTelemetryFresh =
      health !== null ||
      hasDied !== null ||
      knockedExplicit !== null ||
      liveStateLabel !== undefined ||
      liveState !== null;
    const knockedFromLabel = liveStateLabel
      ? ['down', 'knocked', 'dbno'].includes(liveStateLabel)
      : false;
    const knockedFromState = liveState === 4;
    const knocked = knockedExplicit ?? (knockedFromLabel || knockedFromState);
    const deadFromLabel =
      liveStateLabel !== undefined &&
      ['dead', 'eliminated'].includes(liveStateLabel);
    const aliveFromLabel =
      liveStateLabel !== undefined &&
      ['alive', 'live', 'running', 'down', 'knocked', 'dbno'].includes(
        liveStateLabel,
      );
    const deadFromState = liveState === 1 || liveState === 5;
    const aliveFromState =
      liveState === 0 || liveState === 3 || liveState === 4;

    if (health !== null || hasDied !== null) {
      let alive = true;
      if (health !== null) {
        alive = health > 0 && !deadFromState && !deadFromLabel;
      } else if (aliveFromState || aliveFromLabel) {
        alive = true;
      } else if (deadFromState || deadFromLabel) {
        alive = false;
      } else if (hasDied !== null) {
        alive = hasDied === false;
      }

      return {
        alive,
        knocked: alive && knocked,
        health,
        hasDied,
        lifeTelemetryFresh,
      };
    }

    let alive = true;
    if (liveState === 0) {
      alive = true;
    } else if (liveState === 1) {
      alive = false;
    } else if (deadFromLabel) {
      alive = false;
    } else if (aliveFromLabel) {
      alive = true;
    }

    return {
      alive,
      knocked,
      health: null,
      hasDied: null,
      lifeTelemetryFresh,
    };
  }

  private isTeamAlive(players: MatchEnginePlayerState[]): boolean {
    return players.some((player) => player.alive);
  }

  private countAlivePlayers(players: MatchEnginePlayerState[]): number {
    return players.filter((player) => player.alive).length;
  }

  private shouldEliminateTeam(players: MatchEnginePlayerState[]): boolean {
    if (!players.length) {
      return false;
    }

    const hasLifeTelemetry = players.some(
      (player) => player.health !== null || player.hasDied !== null,
    );
    if (!hasLifeTelemetry) {
      return players.every((player) => !player.alive);
    }

    if (players.some((player) => player.alive)) {
      return false;
    }

    const allHealthZero = players.every((player) => player.health === 0);
    const allPlayersDied = players.every(
      (player) => player.hasDied === true && !player.alive,
    );
    return (
      allHealthZero ||
      allPlayersDied ||
      players.every((player) => !player.alive)
    );
  }

  private resolveGameTimeSeconds(
    payload: MatchEngineTelemetryPayload,
  ): number | null {
    const observer = asRecord(payload.observer);
    const observerCircle = asRecord(observer?.circle);
    const observerGame = asRecord(observer?.game);

    return (
      pickNumber(payload, ['gameTime', 'GameTime']) ??
      pickNumber(payload.observer, [
        'gameTime',
        'GameTime',
        'elapsedTime',
        'ElapsedTime',
        'matchTime',
        'MatchTime',
      ]) ??
      pickNumber(observerCircle, ['gameTime', 'GameTime']) ??
      pickNumber(observerGame, [
        'gameTime',
        'GameTime',
        'elapsedTime',
        'ElapsedTime',
        'matchTime',
        'MatchTime',
      ])
    );
  }

  private resolveReportedAliveTeams(
    payload: MatchEngineTelemetryPayload,
  ): number | null {
    const aliveTeams = pickNumber(payload, ['aliveTeams', 'AliveTeams']);
    if (aliveTeams === null) {
      return null;
    }

    const floored = Math.floor(aliveTeams);
    return floored >= 0 ? floored : null;
  }

  private hasGameplayStarted(
    payload: MatchEngineTelemetryPayload,
    gameTime: number | null,
    players: MatchEnginePlayerState[],
  ): boolean {
    if (gameTime !== null && gameTime >= 10) {
      return true;
    }

    if ((Array.isArray(payload.kills) ? payload.kills.length : 0) > 0) {
      return true;
    }

    const hasCombatOrDeathSignal = players.some(
      (player) =>
        player.kills > 0 ||
        player.knocked ||
        !player.alive ||
        player.hasDied === true ||
        player.health === 0,
    );
    if (hasCombatOrDeathSignal) {
      return true;
    }

    return this.buildCircleState(payload, new Date().toISOString()) !== null;
  }

  private hasExplicitFinishedSignal(
    payload: MatchEngineTelemetryPayload,
  ): boolean {
    const phase =
      typeof payload.phase === 'string'
        ? payload.phase.trim().toLowerCase()
        : '';
    return ['finished', 'complete', 'completed', 'ended'].includes(phase);
  }

  private neutralizePlayersForPregame(
    players: MatchEnginePlayerState[],
  ): MatchEnginePlayerState[] {
    return players.map((player) => ({
      ...player,
      kills: 0,
      alive: true,
      knocked: false,
      health: null,
      hasDied: null,
      damage: null,
    }));
  }

  private playerIdentityKey(
    rawUid: string | null,
    playerName: string | null,
  ): string | null {
    const uidKey = normalizeKey(rawUid);
    if (uidKey) {
      return `uid:${uidKey}`;
    }

    const nameKey = normalizeKey(playerName);
    if (nameKey) {
      return `name:${nameKey}`;
    }

    return null;
  }
}
