import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { buildMatchPlayerKey } from '../../common/match-player-key.util';

export type TelemetryPlayerMappingInput = {
  externalPlayerId?: string | null;
  playerId?: string | null;
  pubgAccountId?: string | null;
  ign?: string | null;
  playerName?: string | null;
  teamId?: string | null;
  slot?: number | null;
  playerIndex?: number | null;
};

export type MappingEntry = {
  externalPlayerId: string;
  slotPlayerId: string;
  locked: boolean;
  confidence: number;
  lastSeenAt: number;
};

export type TelemetryPlayerMapping = MappingEntry & {
  slotPlayerResultId: string;
  playerKey: string;
  playerId: string | null;
  teamId: string | null;
  slotNumber: number;
};

type CachedRosterPlayer = Pick<
  TelemetryPlayerMapping,
  'slotPlayerResultId' | 'playerKey' | 'playerId' | 'teamId' | 'slotNumber'
> & {
  identifiers: string[];
  names: string[];
};

type StoredMappingEntry = MappingEntry & {
  playerKey: string;
  playerId: string | null;
  teamId: string | null;
  slotNumber: number;
};

type CachedRoster = {
  loadedAt: number;
  players: CachedRosterPlayer[];
};

const CACHE_TTL_MS = 10_000;
const INITIAL_CONFIDENCE = 0.5;
const CONFIDENCE_INCREMENT = 0.1;
const LOCK_CONFIDENCE = 1;

const normalizeLookup = (value: unknown): string => {
  if (typeof value === 'string') {
    return value.trim().toLowerCase();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim().toLowerCase();
  }
  return '';
};

const normalizeInteger = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
};

const uniqueStrings = (values: unknown[]): string[] =>
  Array.from(
    new Set(
      values
        .map((value) => normalizeLookup(value))
        .filter((value) => value.length > 0),
    ),
  );

const normalizeName = (value: unknown): string =>
  normalizeLookup(value).replace(/[^a-z0-9]/g, '');

const uniqueNames = (values: unknown[]): string[] =>
  Array.from(
    new Set(
      values
        .map((value) => normalizeName(value))
        .filter((value) => value.length > 0),
    ),
  );

@Injectable()
export class TelemetryMappingService {
  private readonly logger = new Logger(TelemetryMappingService.name);
  private readonly rosterCache = new Map<string, CachedRoster>();
  private readonly mappingStore = new Map<string, StoredMappingEntry>();

  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    matchId: string,
    input: TelemetryPlayerMappingInput | string,
  ): Promise<TelemetryPlayerMapping | null> {
    const normalizedInput =
      typeof input === 'string' ? { externalPlayerId: input } : input;
    const roster = await this.loadRoster(matchId);
    const externalPlayerId = this.toStableExternalPlayerId(normalizedInput);
    if (!externalPlayerId) {
      this.logResolve({
        action: 'resolve-miss',
        matchId,
        input: normalizedInput,
        reason: 'MISSING_EXTERNAL_PLAYER_ID',
      });
      return null;
    }

    const now = Date.now();
    const key = this.mappingKey(matchId, externalPlayerId);
    const existing = this.mappingStore.get(key);
    const candidate = this.findRosterMatch(roster, normalizedInput);

    if (existing) {
      existing.lastSeenAt = now;
      if (
        candidate &&
        candidate.slotPlayerResultId !== existing.slotPlayerId &&
        existing.locked
      ) {
        this.logger.warn(
          JSON.stringify({
            tag: '[TELEMETRY][MAPPING][BLOCKED]',
            stage: 'telemetry-mapping',
            action: 'remap-attempt-blocked',
            message: `[TELEMETRY][BLOCKED] remap attempt externalId=${existing.externalPlayerId} old=${existing.slotPlayerId} new=${candidate.slotPlayerResultId}`,
            matchId,
            externalPlayerId: existing.externalPlayerId,
            oldSlotPlayerId: existing.slotPlayerId,
            newSlotPlayerId: candidate.slotPlayerResultId,
          }),
        );
      }
      this.logResolve({
        action: 'resolve-existing',
        matchId,
        input: normalizedInput,
        entry: existing,
      });
      return this.toPublicMapping(existing);
    }

    if (!candidate) {
      this.logResolve({
        action: 'resolve-miss',
        matchId,
        input: normalizedInput,
        reason: 'NO_CANONICAL_PLAYER_MATCH',
      });
      return null;
    }

    const entry: StoredMappingEntry = {
      externalPlayerId,
      slotPlayerId: candidate.slotPlayerResultId,
      locked: false,
      confidence: INITIAL_CONFIDENCE,
      lastSeenAt: now,
      playerKey: candidate.playerKey,
      playerId: candidate.playerId,
      teamId: candidate.teamId,
      slotNumber: candidate.slotNumber,
    };
    this.mappingStore.set(key, entry);
    this.logResolve({
      action: 'resolve-new',
      matchId,
      input: normalizedInput,
      entry,
    });
    return this.toPublicMapping(entry);
  }

  confirmMapping(
    matchId: string,
    externalPlayerId: string,
    slotPlayerId?: string | null,
  ): TelemetryPlayerMapping | null {
    const normalizedExternalPlayerId = normalizeLookup(externalPlayerId);
    if (!normalizedExternalPlayerId) {
      return null;
    }
    const entry = this.mappingStore.get(
      this.mappingKey(matchId, normalizedExternalPlayerId),
    );
    if (!entry) {
      return null;
    }

    entry.lastSeenAt = Date.now();
    if (slotPlayerId && slotPlayerId !== entry.slotPlayerId && entry.locked) {
      this.logger.warn(
        JSON.stringify({
          tag: '[TELEMETRY][MAPPING][BLOCKED]',
          stage: 'telemetry-mapping',
          action: 'remap-attempt-blocked',
          message: `[TELEMETRY][BLOCKED] remap attempt externalId=${entry.externalPlayerId} old=${entry.slotPlayerId} new=${slotPlayerId}`,
          matchId,
          externalPlayerId: entry.externalPlayerId,
          oldSlotPlayerId: entry.slotPlayerId,
          newSlotPlayerId: slotPlayerId,
        }),
      );
      return this.toPublicMapping(entry);
    }

    if (!entry.locked) {
      entry.confidence = Math.min(
        LOCK_CONFIDENCE,
        Number((entry.confidence + CONFIDENCE_INCREMENT).toFixed(4)),
      );
      if (entry.confidence >= LOCK_CONFIDENCE) {
        entry.locked = true;
        this.logger.log(
          JSON.stringify({
            tag: '[TELEMETRY][MAPPING][LOCK]',
            stage: 'telemetry-mapping',
            action: 'mapping-locked',
            message: `[TELEMETRY][MAPPING] locked externalId=${entry.externalPlayerId} -> slotPlayerId=${entry.slotPlayerId}`,
            matchId,
            externalPlayerId: entry.externalPlayerId,
            slotPlayerId: entry.slotPlayerId,
            confidence: entry.confidence,
          }),
        );
      }
    }

    return this.toPublicMapping(entry);
  }

  getStability(
    matchId: string,
    expectedPlayers: number,
  ): { stability: number; locked: number; expected: number } {
    const expected = Math.max(0, Math.trunc(expectedPlayers));
    const entries = this.getMatchEntries(matchId);
    const locked = entries.filter((entry) => entry.locked).length;
    const stability =
      expected > 0
        ? Math.min(1, locked / expected)
        : entries.length === 0
          ? 1
          : 0;
    return {
      stability,
      locked,
      expected,
    };
  }

  logStability(matchId: string, expectedPlayers: number): void {
    const { stability, locked, expected } = this.getStability(
      matchId,
      expectedPlayers,
    );
    this.logger.log(
      JSON.stringify({
        tag: '[TELEMETRY][MAPPING][STABILITY]',
        stage: 'telemetry-mapping',
        action: 'mapping-stability',
        message: `[TELEMETRY][MAPPING] stability=${stability.toFixed(2)} locked=${locked} expected=${expected}`,
        matchId,
        stability: Number(stability.toFixed(4)),
        locked,
        expected,
      }),
    );
  }

  reset(matchId: string): void {
    const prefix = `${matchId}:`;
    for (const key of Array.from(this.mappingStore.keys())) {
      if (key.startsWith(prefix)) {
        this.mappingStore.delete(key);
      }
    }
    this.rosterCache.delete(matchId);
    this.logger.log(
      JSON.stringify({
        tag: '[TELEMETRY][MAPPING][RESET]',
        stage: 'telemetry-mapping',
        action: 'mapping-reset',
        message: `[TELEMETRY][MAPPING] reset for matchId=${matchId}`,
        matchId,
      }),
    );
  }

  invalidate(matchId: string): void {
    this.rosterCache.delete(matchId);
  }

  private async loadRoster(matchId: string): Promise<CachedRoster> {
    const cached = this.rosterCache.get(matchId);
    if (
      cached &&
      cached.players.length > 0 &&
      Date.now() - cached.loadedAt < CACHE_TTL_MS
    ) {
      return cached;
    }

    const playersByKey = new Map<string, CachedRosterPlayer>();
    const upsertPlayer = (player: CachedRosterPlayer) => {
      const existing = playersByKey.get(player.playerKey);
      if (!existing) {
        playersByKey.set(player.playerKey, player);
        return;
      }

      existing.slotPlayerResultId =
        existing.slotPlayerResultId || player.slotPlayerResultId;
      existing.playerId = existing.playerId ?? player.playerId;
      existing.teamId = existing.teamId ?? player.teamId;
      existing.slotNumber = existing.slotNumber ?? player.slotNumber;
      existing.identifiers = uniqueStrings([
        ...existing.identifiers,
        ...player.identifiers,
      ]);
      existing.names = uniqueNames([...existing.names, ...player.names]);
    };

    const slotResults = await this.prisma.matchSlotResult.findMany({
      where: { matchId },
      select: {
        teamId: true,
        slotNumber: true,
        players: {
          select: {
            id: true,
            playerId: true,
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
          orderBy: { playerName: 'asc' },
        },
      },
      orderBy: { slotNumber: 'asc' },
    });

    const players: CachedRosterPlayer[] = [];
    for (const slotResult of slotResults) {
      for (const player of slotResult.players ?? []) {
        const playerKey =
          buildMatchPlayerKey({
            playerId: player.playerId ?? null,
            playerResultId: player.id,
          }) ?? player.id;
        upsertPlayer({
          slotPlayerResultId: player.id,
          playerKey,
          playerId: player.playerId ?? null,
          teamId: slotResult.teamId ?? null,
          slotNumber: slotResult.slotNumber,
          identifiers: uniqueStrings([
            player.id,
            playerKey,
            player.playerId,
            player.externalPlayerId,
            player.pubgAccountId,
            player.player?.externalPlayerId,
            player.player?.playerOpenId,
            player.player?.inGameId,
            player.player?.pubgPlayerId,
          ]),
          names: uniqueNames([player.playerName, player.player?.ign]),
        });
      }
    }

    if (this.prisma.match?.findUnique) {
      const match = await this.prisma.match.findUnique({
        where: { id: matchId },
        select: {
          matchSlots: {
            where: { deletedAt: null },
            orderBy: { slotNumber: 'asc' },
            select: {
              slotNumber: true,
              team: {
                select: {
                  id: true,
                  players: {
                    where: { deletedAt: null },
                    orderBy: { ign: 'asc' },
                    select: {
                      id: true,
                      ign: true,
                      realName: true,
                      externalPlayerId: true,
                      playerOpenId: true,
                      inGameId: true,
                      pubgPlayerId: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      for (const slot of match?.matchSlots ?? []) {
        if (!slot.team?.id) {
          continue;
        }

        for (const player of slot.team.players ?? []) {
          const playerKey =
            buildMatchPlayerKey({
              playerId: player.id,
              playerResultId: null,
            }) ?? player.id;
          upsertPlayer({
            // Match slots do not have slot-result rows yet; use the canonical player key
            // as the stable identifier until slot results are materialized.
            slotPlayerResultId: playerKey,
            playerKey,
            playerId: player.id,
            teamId: slot.team.id,
            slotNumber: slot.slotNumber,
            identifiers: uniqueStrings([
              player.id,
              playerKey,
              player.externalPlayerId,
              player.playerOpenId,
              player.inGameId,
              player.pubgPlayerId,
            ]),
            names: uniqueNames([player.ign, player.realName]),
          });
        }
      }
    }

    players.push(
      ...Array.from(playersByKey.values()).sort((left, right) => {
        if (left.slotNumber !== right.slotNumber) {
          return left.slotNumber - right.slotNumber;
        }
        return left.slotPlayerResultId.localeCompare(right.slotPlayerResultId);
      }),
    );

    const next = { loadedAt: Date.now(), players };
    this.rosterCache.set(matchId, next);
    return next;
  }

  private uniqueBySlotPlayer(
    players: CachedRosterPlayer[],
  ): CachedRosterPlayer[] {
    return Array.from(
      new Map(
        players.map((player) => [player.slotPlayerResultId, player] as const),
      ).values(),
    );
  }

  private findRosterMatch(
    roster: CachedRoster,
    input: TelemetryPlayerMappingInput,
  ): CachedRosterPlayer | null {
    const identifiers = uniqueStrings([
      input.externalPlayerId,
      input.playerId,
      input.pubgAccountId,
    ]);
    const names = uniqueNames([input.ign, input.playerName]);
    const teamId = normalizeLookup(input.teamId);
    const slot = normalizeInteger(input.slot);
    const playerIndex = normalizeInteger(input.playerIndex);

    if (identifiers.length > 0) {
      const matches = roster.players.filter((player) =>
        identifiers.some((identifier) =>
          player.identifiers.includes(identifier),
        ),
      );
      const scoped = this.uniqueBySlotPlayer(
        this.filterScopedPlayers(matches, teamId, slot),
      );
      if (scoped.length === 1) {
        return scoped[0];
      }

      const uniqueMatches = this.uniqueBySlotPlayer(matches);
      if (uniqueMatches.length === 1) {
        return uniqueMatches[0];
      }
    }

    if (names.length > 0) {
      const matches = roster.players.filter((player) =>
        names.some((name) => player.names.includes(name)),
      );
      const scoped = this.uniqueBySlotPlayer(
        this.filterScopedPlayers(matches, teamId, slot),
      );
      if (scoped.length === 1) {
        return scoped[0];
      }

      const uniqueMatches = this.uniqueBySlotPlayer(matches);
      if (uniqueMatches.length === 1) {
        return uniqueMatches[0];
      }
    }

    if (
      playerIndex !== null &&
      playerIndex >= 0 &&
      (teamId.length > 0 || slot !== null)
    ) {
      const scopedPlayers = this.filterScopedPlayers(
        roster.players,
        teamId,
        slot,
      ).sort((left, right) =>
        left.slotPlayerResultId.localeCompare(right.slotPlayerResultId),
      );
      return scopedPlayers[playerIndex] ?? null;
    }

    return null;
  }

  private filterScopedPlayers(
    players: CachedRosterPlayer[],
    teamId: string,
    slot: number | null,
  ): CachedRosterPlayer[] {
    if (teamId.length === 0 && slot === null) {
      return players;
    }

    return players.filter((player) => {
      const teamMatches =
        teamId.length > 0 && normalizeLookup(player.teamId) === teamId;
      const slotMatches = slot !== null && player.slotNumber === slot;
      return teamMatches || slotMatches;
    });
  }

  private toStableExternalPlayerId(
    input: TelemetryPlayerMappingInput,
  ): string | null {
    const externalPlayerId = normalizeLookup(input.externalPlayerId);
    if (externalPlayerId) {
      return externalPlayerId;
    }
    const pubgAccountId = normalizeLookup(input.pubgAccountId);
    if (pubgAccountId) {
      return pubgAccountId;
    }
    const playerId = normalizeLookup(input.playerId);
    return playerId || null;
  }

  private mappingKey(matchId: string, externalPlayerId: string): string {
    return `${matchId}:${normalizeLookup(externalPlayerId)}`;
  }

  private getMatchEntries(matchId: string): StoredMappingEntry[] {
    const prefix = `${matchId}:`;
    return Array.from(this.mappingStore.entries())
      .filter(([key]) => key.startsWith(prefix))
      .map(([, entry]) => entry);
  }

  private logResolve(params: {
    action: 'resolve-existing' | 'resolve-miss' | 'resolve-new';
    matchId: string;
    input: TelemetryPlayerMappingInput;
    entry?: StoredMappingEntry;
    reason?: string;
  }): void {
    this.logger.debug(
      JSON.stringify({
        tag: '[TELEMETRY][MAPPING][RESOLVE]',
        stage: 'telemetry-mapping',
        action: params.action,
        matchId: params.matchId,
        reason: params.reason ?? null,
        externalPlayerId: params.input.externalPlayerId ?? null,
        playerId: params.input.playerId ?? null,
        pubgAccountId: params.input.pubgAccountId ?? null,
        ign: params.input.ign ?? params.input.playerName ?? null,
        teamId: params.input.teamId ?? null,
        slot: params.input.slot ?? null,
        playerIndex: params.input.playerIndex ?? null,
        slotPlayerId: params.entry?.slotPlayerId ?? null,
        locked: params.entry?.locked ?? null,
        confidence: params.entry?.confidence ?? null,
      }),
    );
  }

  private toPublicMapping(entry: StoredMappingEntry): TelemetryPlayerMapping {
    return {
      externalPlayerId: entry.externalPlayerId,
      slotPlayerId: entry.slotPlayerId,
      slotPlayerResultId: entry.slotPlayerId,
      playerKey: entry.playerKey,
      playerId: entry.playerId,
      teamId: entry.teamId,
      slotNumber: entry.slotNumber,
      locked: entry.locked,
      confidence: entry.confidence,
      lastSeenAt: entry.lastSeenAt,
    };
  }
}
