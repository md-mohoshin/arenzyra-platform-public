import { createHash } from 'crypto';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { GameKey, MatchStatus, Prisma } from '@prisma/client';
import axios, { type AxiosInstance } from 'axios';
import WebSocket from 'ws';
import { buildMatchPlayerKey } from '../../../common/match-player-key.util';
import { PrismaService } from '../../../db/prisma.service';
import type { GameAdapter } from '../game-adapter.interface';
import type {
  AdapterContext,
  AdapterSnapshot,
  AdapterTelemetryEnvelope,
  AdapterTelemetryEvent,
  AdapterTelemetryPlayer,
  AdapterTelemetryPosition,
  AdapterTelemetryTeam,
  AdapterTelemetryZone,
} from '../game-adapter.types';

const SHADOW_PLAYER_WRAPPER_KEYS = [
  'totalmessage',
  'setteaminfo',
  'setteaminfolist',
  'payload',
  'data',
] as const;

const SHADOW_PLAYER_LIST_KEYS = [
  'TotalPlayerList',
  'totalPlayerList',
  'PlayerList',
  'playerList',
  'PlayerInfoList',
  'playerInfoList',
  'players',
] as const;

const SHADOW_TEAM_LIST_KEYS = [
  'TeamInfoList',
  'teamInfoList',
  'teams',
  'TeamList',
  'teamList',
] as const;

const SHADOW_KILL_LIST_KEYS = [
  'KillList',
  'killList',
  'kills',
  'data',
] as const;

type MatchSeed = {
  id: string;
  name: string | null;
  map: string | null;
  status: MatchStatus;
  controlState: { state: string } | null;
  startedAt: Date | null;
  endedAt: Date | null;
  dataSource: string | null;
  adapterKey: string | null;
  pcobSessionId: string | null;
};

type BufferedWsEnvelope = {
  at: number;
  payload: unknown;
};

type PollSequenceState = {
  sessionId: string | null;
  lastSequence: number;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const stringValue = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
};

const numberValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const timestampValue = (value: unknown): number | null => {
  if (value instanceof Date) return value.getTime();
  const numeric = numberValue(value);
  if (numeric !== null) {
    if (numeric > 10_000_000_000) return numeric;
    if (numeric > 1_000_000) return numeric * 1000;
    if (numeric >= 0) return Date.now() + numeric * 1000;
    return numeric;
  }
  const text = stringValue(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
};

const rawWsMessageToString = (data: WebSocket.RawData): string => {
  if (typeof data === 'string') {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return data.toString('utf8');
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8');
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8');
  }
  return '';
};

const hashKey = (parts: Array<string | number | null | undefined>) =>
  createHash('sha1')
    .update(
      parts
        .map((part) =>
          part === null || part === undefined ? '' : String(part),
        )
        .join('|'),
    )
    .digest('hex');

const normalizeTeamLookup = (value: unknown): string =>
  (stringValue(value) ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const normalizePlayerLookup = (value: unknown): string =>
  (stringValue(value) ?? '').normalize('NFKC').toLowerCase();

const compactPlayerLookup = (value: unknown): string =>
  normalizePlayerLookup(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');

const uniqueStrings = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = stringValue(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
};

const collectPlayerLookupNames = (values: Array<string | null | undefined>) => {
  const normalizedNames = new Set<string>();
  const compactNormalizedNames = new Set<string>();
  for (const value of uniqueStrings(values)) {
    const normalized = normalizePlayerLookup(value);
    if (normalized.length > 0) {
      normalizedNames.add(normalized);
    }
    const compact = compactPlayerLookup(value);
    if (compact.length > 0) {
      compactNormalizedNames.add(compact);
    }
  }
  return {
    normalizedNames: Array.from(normalizedNames),
    compactNormalizedNames: Array.from(compactNormalizedNames),
  };
};

const valueKind = (value: unknown): string => {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  if (value instanceof Date) return 'date';
  return typeof value;
};

const summarizeSelectShape = (value: unknown): unknown => {
  const record = asRecord(value);
  if (!record) {
    return value === true ? true : valueKind(value);
  }

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (entry === true) {
      result[key] = true;
      continue;
    }

    const nested = asRecord(entry);
    if (nested?.select) {
      result[key] = summarizeSelectShape(nested.select);
      continue;
    }

    result[key] = summarizeSelectShape(entry);
  }
  return result;
};

type CanonicalTeamBinding = {
  teamId: string;
  slot: number | null;
  name: string | null;
  tag: string | null;
  logoUrl: string | null;
};

type CanonicalPlayerBinding = {
  playerKey: string;
  playerId: string | null;
  teamId: string;
  slotPlayerResultId: string | null;
  playerName: string | null;
  pubgAccountIds: string[];
  externalPlayerIds: string[];
  normalizedNames: string[];
  compactNormalizedNames: string[];
};

type CanonicalPlayerResolutionInput = {
  matchId: string;
  source:
    | 'snapshot-player'
    | 'team-player'
    | 'event-player'
    | 'event-killer'
    | 'event-victim';
  teamId: string | null;
  playerId: string | null;
  externalPlayerId: string | null;
  pubgAccountId: string | null;
  name: string | null;
};

type CanonicalPlayerResolution = {
  binding: CanonicalPlayerBinding;
  strategy:
    | 'PUBG_ACCOUNT_ID'
    | 'EXTERNAL_PLAYER_ID'
    | 'NORMALIZED_NAME'
    | 'TEAM_NAME';
};

type TelemetryBindCacheParams = {
  teamId: string | null;
  externalPlayerId: string | null;
  normalizedName: string | null;
};

@Injectable()
export class PcobAdapter implements GameAdapter, OnModuleDestroy {
  readonly key = 'pubgm-pcob';
  readonly gameKey: GameKey = GameKey.PUBG_MOBILE;

  private readonly logger = new Logger(PcobAdapter.name);
  private readonly api: AxiosInstance;
  private readonly baseUrl: string;
  private readonly wsUrl: string | null;
  private readonly telemetryBindCache = new Map<
    string,
    Map<string, CanonicalPlayerResolution>
  >();
  private readonly sequenceByMatch = new Map<string, PollSequenceState>();
  private readonly wsBufferByMatch = new Map<string, BufferedWsEnvelope>();
  private readonly wsBufferBySession = new Map<string, BufferedWsEnvelope>();
  private ws: WebSocket | null = null;
  private wsReconnectTimer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {
    this.baseUrl = this.resolveBaseUrl();
    this.wsUrl = this.resolveWsUrl();
    this.api = axios.create({
      baseURL: this.baseUrl,
      timeout: Number(process.env.PCOB_API_TIMEOUT_MS ?? 5000),
    });
  }

  onModuleDestroy() {
    this.telemetryBindCache.clear();
    this.sequenceByMatch.clear();
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore shutdown errors
      }
      this.ws = null;
    }
  }

  private getFirstMapKey<TKey, TValue>(
    map: ReadonlyMap<TKey, TValue>,
  ): TKey | undefined {
    for (const key of map.keys()) {
      return key;
    }
    return undefined;
  }

  async getSnapshot(
    matchId: string,
    ctx: AdapterContext,
  ): Promise<AdapterSnapshot> {
    void ctx;
    try {
      const snapshotSelect = {
        id: true,
        name: true,
        map: true,
        status: true,
        startedAt: true,
        endedAt: true,
        dataSource: true,
        matchSlots: {
          select: {
            team: {
              select: {
                id: true,
                name: true,
                tag: true,
                logoUrl: true,
                players: {
                  where: { deletedAt: null },
                  select: {
                    id: true,
                    ign: true,
                    realName: true,
                    photoUrl: true,
                  },
                },
              },
            },
          },
        },
      };
      this.logger.debug(
        JSON.stringify({
          stage: 'pcob-adapter',
          action: 'prisma-match-lookup-fields',
          query: 'getSnapshot',
          matchId,
          fields: summarizeSelectShape(snapshotSelect),
        }),
      );
      const match = await this.prisma.match.findUnique({
        where: { id: matchId },
        select: snapshotSelect,
      });

      if (!match) {
        return {
          match: { matchId, snapshotAt: new Date() },
          teams: [],
          players: [],
        };
      }

      const teams = match.matchSlots
        .filter((slot) => slot.team?.id)
        .map((slot) => ({
          teamId: slot.team!.id,
          name: slot.team?.name ?? null,
          tag: slot.team?.tag ?? null,
          logoUrl: slot.team?.logoUrl ?? null,
        }));

      const players = match.matchSlots.flatMap((slot) =>
        (slot.team?.players ?? []).map((player) => ({
          playerId: player.id,
          name: player.realName ?? player.ign ?? null,
          teamId: slot.team?.id ?? null,
          photoUrl: player.photoUrl ?? null,
        })),
      );

      return {
        match: {
          matchId: match.id,
          name: match.name ?? null,
          map: match.map ?? null,
          status: match.status ?? null,
          startedAt: match.startedAt,
          endedAt: match.endedAt,
          dataSource: match.dataSource ?? 'PCOB',
          snapshotAt: new Date(),
        },
        teams,
        players,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to build snapshot for match=${matchId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        match: { matchId, snapshotAt: new Date() },
        teams: [],
        players: [],
      };
    }
  }

  async pullTelemetry(
    matchId: string,
    ctx: AdapterContext,
  ): Promise<AdapterTelemetryEnvelope | null> {
    void ctx;
    const match = await this.loadMatchSeed(matchId);
    const isLive =
      match?.status === MatchStatus.LIVE ||
      match?.controlState?.state === MatchStatus.LIVE;
    if (!match || match.adapterKey !== this.key || !isLive) {
      return null;
    }

    const wsTelemetry = this.consumeBufferedWsTelemetry(match);
    if (wsTelemetry) {
      const normalized = await this.normalizeTelemetryEnvelope(
        matchId,
        wsTelemetry.payload,
        ctx,
      );
      if (normalized) {
        return normalized;
      }
    }

    void this.ensureWebSocketConnected();

    const [playerPayload, teamPayload, killPayload, circlePayload] =
      await Promise.all([
        this.get('/gettotalplayerlist'),
        this.get('/getteaminfolist').then(
          (value) => value ?? this.get('/getteaminfo'),
        ),
        this.get('/getkillinfo'),
        this.get('/getcircleinfo'),
      ]);

    if (!playerPayload && !teamPayload && !killPayload && !circlePayload) {
      return null;
    }

    this.logger.debug(
      JSON.stringify({
        stage: 'pcob-adapter',
        action: 'packet-received',
        mode: 'poll',
        matchId,
        resolvedMatchId: match.id,
        payloadType: 'SNAPSHOT',
        eventType: 'SNAPSHOT',
        payloadKinds: {
          players: valueKind(playerPayload),
          teams: valueKind(teamPayload),
          kills: valueKind(killPayload),
          circle: valueKind(circlePayload),
        },
      }),
    );

    const timestamp = Date.now();
    const players = this.normalizePlayers(playerPayload);
    const teams = this.normalizeTeams(teamPayload, players, []);
    const zone = this.normalizeZone(circlePayload);
    const events = this.deriveSnapshotEvents({
      timestamp,
      players,
      teams,
      killPayload,
    });
    const extractedSessionId = this.extractEnvelopeSessionId(
      asRecord(playerPayload),
      asRecord(teamPayload),
      asRecord(killPayload),
      asRecord(circlePayload),
    );
    const sessionId = match.pcobSessionId ?? extractedSessionId;
    const sequence = this.resolveMonotonicSequence(
      match.id,
      sessionId,
      this.extractEnvelopeSequence(
        asRecord(playerPayload),
        asRecord(teamPayload),
        asRecord(killPayload),
        asRecord(circlePayload),
      ),
      'PCOB_API',
    );

    return this.bindCanonicalIdentifiers(
      matchId,
      this.buildCanonicalEnvelope({
        matchId,
        sessionId,
        sequence,
        timestamp,
        players,
        teams,
        zone,
        events,
        source: 'PCOB_API',
        raw: {
          players: playerPayload ?? null,
          teams: teamPayload ?? null,
          zone: circlePayload ?? null,
          kills: killPayload ?? null,
        },
      }),
    );
  }

  async normalizeTelemetryEnvelope(
    matchId: string,
    envelope: unknown,
    ctx: AdapterContext,
  ): Promise<AdapterTelemetryEnvelope | null> {
    void ctx;
    const root = asRecord(envelope) ?? {};
    const payloadRecord = asRecord(root.payload) ?? root;
    const wrapperMatchId = stringValue(
      root.matchId ?? root.match_id ?? payloadRecord.matchId,
    );
    const sessionId = this.extractEnvelopeSessionId(root, payloadRecord);
    const sequence = this.extractEnvelopeSequence(root, payloadRecord);
    const eventType =
      stringValue(root.type ?? root.eventType ?? payloadRecord.eventType) ??
      'UNKNOWN';
    this.logger.debug(
      JSON.stringify({
        stage: 'pcob-adapter',
        action: 'packet-received',
        mode: 'push',
        matchId,
        resolvedMatchId: matchId,
        wrapperMatchId: wrapperMatchId ?? null,
        sessionId: sessionId ?? null,
        sequence,
        payloadType: valueKind(envelope),
        eventType,
      }),
    );
    if (wrapperMatchId && wrapperMatchId !== matchId) {
      this.logger.warn(
        JSON.stringify({
          stage: 'pcob-adapter',
          action: 'wrapper-match-mismatch',
          matchId,
          resolvedMatchId: matchId,
          wrapperMatchId,
          sessionId: sessionId ?? null,
        }),
      );
    }
    const normalized = this.normalizePushedEnvelope(
      matchId,
      envelope,
      Date.now(),
    );
    if (!normalized) {
      this.logger.debug(
        JSON.stringify({
          stage: 'pcob-adapter',
          action: 'packet-ignored',
          mode: 'push',
          matchId,
          resolvedMatchId: matchId,
          eventType,
          reason: 'UNSUPPORTED_OR_EMPTY_PAYLOAD',
        }),
      );
      return null;
    }
    return this.bindCanonicalIdentifiers(matchId, normalized);
  }

  private buildCanonicalEnvelope(params: {
    matchId: string;
    sessionId?: string | null;
    sequence?: number | null;
    timestamp: number;
    players: AdapterTelemetryPlayer[];
    teams: AdapterTelemetryTeam[];
    zone: AdapterTelemetryZone | null;
    events: AdapterTelemetryEvent[];
    source: string;
    raw?: unknown;
  }): AdapterTelemetryEnvelope {
    return {
      matchId: params.matchId,
      sessionId: params.sessionId ?? null,
      sequence: params.sequence ?? null,
      timestamp: params.timestamp,
      players: params.players,
      teams: params.teams,
      zone: params.zone,
      events: params.events,
      source: params.source,
      raw: params.raw ?? null,
    };
  }

  private extractEnvelopeSessionId(
    ...records: Array<Record<string, unknown> | null | undefined>
  ): string | null {
    for (const record of records) {
      const sessionId = stringValue(
        record?.sessionId ?? record?.matchSessionId ?? record?.session_id,
      );
      if (sessionId) {
        return sessionId;
      }
    }
    return null;
  }

  private extractEnvelopeSequence(
    ...records: Array<Record<string, unknown> | null | undefined>
  ): number | null {
    for (const record of records) {
      const sequence = numberValue(
        record?.sequence ??
          record?.seq ??
          record?.counter ??
          record?.packetSequence ??
          record?.eventSequence,
      );
      if (sequence !== null) {
        return sequence;
      }
    }
    return null;
  }

  private resolveMonotonicSequence(
    matchId: string,
    sessionId: string | null,
    explicitSequence: number | null,
    source: 'PCOB_API' | 'PCOB_PUSH',
  ): number | null {
    if (!sessionId) {
      return explicitSequence;
    }

    const current = this.sequenceByMatch.get(matchId);
    const normalizedExplicit =
      explicitSequence !== null ? Math.trunc(explicitSequence) : null;

    if (!current || current.sessionId !== sessionId) {
      const initialSequence = normalizedExplicit ?? 1;
      this.sequenceByMatch.set(matchId, {
        sessionId,
        lastSequence: initialSequence,
      });
      while (this.sequenceByMatch.size > 128) {
        const oldestMatchId = this.getFirstMapKey(this.sequenceByMatch);
        if (oldestMatchId === undefined) {
          break;
        }
        this.sequenceByMatch.delete(oldestMatchId);
      }
      if (normalizedExplicit === null) {
        this.logger.debug(
          JSON.stringify({
            stage: 'pcob-adapter',
            action: 'telemetry-sequence-synthesized',
            message: '[TelemetrySequence] synthesized',
            matchId,
            sessionId,
            sequence: initialSequence,
            reason: 'SESSION_START',
            source,
          }),
        );
      }
      return initialSequence;
    }

    if (normalizedExplicit === null) {
      current.lastSequence += 1;
      return current.lastSequence;
    }

    if (normalizedExplicit > current.lastSequence) {
      current.lastSequence = normalizedExplicit;
      return normalizedExplicit;
    }

    current.lastSequence += 1;
    this.logger.debug(
      JSON.stringify({
        stage: 'pcob-adapter',
        action: 'telemetry-sequence-normalized',
        message: '[TelemetrySequence] normalized',
        matchId,
        sessionId,
        explicitSequence: normalizedExplicit,
        normalizedSequence: current.lastSequence,
        reason: 'NON_MONOTONIC_SOURCE_SEQUENCE',
        source,
      }),
    );
    return current.lastSequence;
  }

  private resolveBaseUrl(): string {
    const raw = (
      process.env.PCOB_BASE_URL ||
      process.env.SHADOW_API_BASE ||
      process.env.SHADOW_API_URL ||
      process.env.SHADOW_URL ||
      process.env.TELEMETRY_URL ||
      'http://127.0.0.1:5000'
    ).trim();
    return raw.replace(/\/$/, '') || 'http://127.0.0.1:5000';
  }

  private resolveWsUrl(): string | null {
    const raw = (
      process.env.PCOB_WS_URL ||
      process.env.SHADOW_WS_URL ||
      process.env.TELEMETRY_WS_URL ||
      ''
    ).trim();
    if (!raw) return null;
    return raw.replace(/\/$/, '');
  }

  private async get(path: string): Promise<unknown> {
    try {
      const response = await this.api.get(path);
      return response?.data ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.debug(`PCOB API ${path} failed: ${message}`);
      return null;
    }
  }

  private async loadMatchSeed(matchId: string): Promise<MatchSeed | null> {
    const matchSeedSelect = {
      id: true,
      name: true,
      map: true,
      status: true,
      controlState: { select: { state: true } },
      startedAt: true,
      endedAt: true,
      dataSource: true,
      adapterKey: true,
      pcobSessionId: true,
    };
    this.logger.debug(
      JSON.stringify({
        stage: 'pcob-adapter',
        action: 'prisma-match-lookup-fields',
        query: 'loadMatchSeed',
        matchId,
        fields: summarizeSelectShape(matchSeedSelect),
      }),
    );
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: matchSeedSelect,
    });

    if (!match) return null;
    return {
      id: match.id,
      name: match.name ?? null,
      map: match.map ?? null,
      status: match.status,
      controlState: match.controlState
        ? { state: match.controlState.state }
        : null,
      startedAt: match.startedAt,
      endedAt: match.endedAt,
      dataSource: match.dataSource ?? null,
      adapterKey: match.adapterKey ?? null,
      pcobSessionId: match.pcobSessionId ?? null,
    };
  }

  private normalizePlayers(payload: unknown): AdapterTelemetryPlayer[] {
    const list = this.extractPlayerRecords(payload);
    const players = new Map<string, AdapterTelemetryPlayer>();

    for (const item of list) {
      const teamId =
        stringValue(
          item.teamId ??
            item.teamID ??
            item.TeamId ??
            item.TeamID ??
            item.team_id,
        ) ?? null;
      const pubgAccountId = this.resolveTelemetryPubgAccountId(item);
      const externalPlayerId = this.resolveTelemetryExternalPlayerId(item);
      const playerId =
        stringValue(
          item.playerId ??
            item.id ??
            item.playerID ??
            item.uid ??
            item.Uid ??
            item.UID ??
            item.externalPlayerId ??
            item.externalId,
        ) ??
        externalPlayerId ??
        pubgAccountId;
      const ign =
        stringValue(
          item.playerName ??
            item.PlayerName ??
            item.ign ??
            item.name ??
            item.Name,
        ) ?? null;
      const key =
        externalPlayerId ?? pubgAccountId ?? playerId ?? JSON.stringify(item);
      const alive = this.isAlive(item);
      const knocked = alive ? this.isKnocked(item) : false;
      const kills =
        numberValue(
          item.kills ??
            item.killNum ??
            item.killCount ??
            item.killnum ??
            item.kill_count,
        ) ?? 0;
      players.set(key, {
        playerId,
        externalPlayerId,
        pubgAccountId,
        ign,
        teamId,
        alive,
        knocked,
        eliminated: !alive,
        kills,
        position: this.extractPosition(item),
        raw: item,
      });
    }

    return this.normalizeRemainingPlayers(Array.from(players.values()));
  }

  private normalizeTeams(
    payload: unknown,
    players: AdapterTelemetryPlayer[],
    previousTeams: AdapterTelemetryTeam[],
  ): AdapterTelemetryTeam[] {
    const previousByTeamId = new Map(
      previousTeams
        .filter((team) => team.teamId)
        .map((team) => [team.teamId as string, team] as const),
    );
    const teamRecords = this.extractTeamRecords(payload);
    const teams = new Map<string, AdapterTelemetryTeam>();

    for (const item of teamRecords) {
      const teamId =
        stringValue(
          item.teamId ??
            item.teamID ??
            item.TeamId ??
            item.TeamID ??
            item.team ??
            item.id,
        ) ?? null;
      if (!teamId) continue;

      const previous = previousByTeamId.get(teamId) ?? null;
      const slot =
        numberValue(
          item.slot ??
            item.slotNumber ??
            item.teamNumber ??
            item.teamNo ??
            item.order ??
            item.rank,
        ) ??
        previous?.slot ??
        null;
      const teamPlayers = players.filter((player) => player.teamId === teamId);
      const aliveCount =
        teamPlayers.length > 0
          ? teamPlayers.filter((player) => player.eliminated !== true).length
          : (numberValue(
              item.alive ??
                item.aliveCount ??
                item.alivePlayers ??
                item.remainingPlayers ??
                item.remainPlayers ??
                item.remainPlayerNum ??
                item.liveMemberNum,
            ) ?? 0);
      const totalPlayers =
        numberValue(
          item.totalPlayers ??
            item.totalPlayerCount ??
            item.playerCount ??
            item.memberNum ??
            item.playerNum,
        ) ?? Math.max(teamPlayers.length, 0);
      const kills =
        numberValue(
          item.kills ??
            item.kill ??
            item.killNum ??
            item.killnum ??
            item.kill_count ??
            item.killCount,
        ) ?? teamPlayers.reduce((sum, player) => sum + (player.kills ?? 0), 0);

      teams.set(teamId, {
        teamId,
        slot,
        name:
          stringValue(item.name ?? item.teamName ?? item.TeamName) ??
          previous?.name ??
          null,
        tag:
          stringValue(item.tag ?? item.teamTag ?? item.shortName) ??
          previous?.tag ??
          null,
        logoUrl:
          stringValue(item.logoUrl ?? item.logo ?? item.image) ??
          previous?.logoUrl ??
          null,
        aliveCount,
        alivePlayers: aliveCount,
        totalPlayers,
        eliminated: aliveCount <= 0,
        kills,
        placement:
          numberValue(item.placement ?? item.position ?? item.rank) ??
          previous?.placement ??
          null,
        players: teamPlayers,
        raw: item,
      });
    }

    if (teams.size === 0) {
      const grouped = new Map<string, AdapterTelemetryPlayer[]>();
      for (const player of players) {
        const teamId = player.teamId;
        if (!teamId) continue;
        const bucket = grouped.get(teamId) ?? [];
        bucket.push(player);
        grouped.set(teamId, bucket);
      }

      for (const [teamId, teamPlayers] of grouped.entries()) {
        const previous = previousByTeamId.get(teamId) ?? null;
        const aliveCount = teamPlayers.filter(
          (player) => player.eliminated !== true,
        ).length;
        teams.set(teamId, {
          teamId,
          slot: previous?.slot ?? null,
          name: previous?.name ?? null,
          tag: previous?.tag ?? null,
          logoUrl: previous?.logoUrl ?? null,
          aliveCount,
          alivePlayers: aliveCount,
          totalPlayers: teamPlayers.length,
          eliminated: aliveCount <= 0,
          kills: teamPlayers.reduce(
            (sum, player) => sum + (player.kills ?? 0),
            0,
          ),
          placement: previous?.placement ?? null,
          players: teamPlayers,
          raw: teamPlayers.map((player) => player.raw ?? null),
        });
      }
    }

    return Array.from(teams.values()).sort((left, right) => {
      const leftSlot = left.slot ?? Number.MAX_SAFE_INTEGER;
      const rightSlot = right.slot ?? Number.MAX_SAFE_INTEGER;
      if (leftSlot !== rightSlot) return leftSlot - rightSlot;
      return (left.teamId ?? '').localeCompare(right.teamId ?? '');
    });
  }

  private async bindCanonicalIdentifiers(
    matchId: string,
    envelope: AdapterTelemetryEnvelope,
  ): Promise<AdapterTelemetryEnvelope> {
    if (
      (envelope.teams?.length ?? 0) === 0 &&
      (envelope.players?.length ?? 0) === 0 &&
      (envelope.events?.length ?? 0) === 0
    ) {
      return envelope;
    }

    const canonicalBindSelect = {
      matchSlots: {
        select: {
          slotNumber: true,
          team: {
            select: {
              id: true,
              name: true,
              tag: true,
              logoUrl: true,
              players: {
                where: { deletedAt: null },
                orderBy: { ign: 'asc' as const },
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
      slotResults: {
        select: {
          slotNumber: true,
          teamId: true,
          team: {
            select: {
              id: true,
              name: true,
              tag: true,
              logoUrl: true,
            },
          },
          players: {
            orderBy: { playerName: 'asc' as const },
            select: {
              id: true,
              playerId: true,
              externalPlayerId: true,
              pubgAccountId: true,
              playerName: true,
              player: {
                select: {
                  externalPlayerId: true,
                  playerOpenId: true,
                  inGameId: true,
                  pubgPlayerId: true,
                  ign: true,
                },
              },
            },
          },
        },
      },
    } satisfies Prisma.MatchSelect;
    this.logger.debug(
      JSON.stringify({
        stage: 'pcob-adapter',
        action: 'prisma-match-lookup-fields',
        query: 'bindCanonicalIdentifiers',
        matchId,
        fields: summarizeSelectShape(canonicalBindSelect),
      }),
    );
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: canonicalBindSelect,
    });

    const canonicalTeamById = new Map<string, CanonicalTeamBinding>();
    for (const slot of match?.matchSlots ?? []) {
      if (!slot.team?.id) {
        continue;
      }
      canonicalTeamById.set(slot.team.id, {
        teamId: slot.team.id,
        slot: slot.slotNumber ?? null,
        name: slot.team.name ?? null,
        tag: slot.team.tag ?? null,
        logoUrl: slot.team.logoUrl ?? null,
      });
    }
    for (const slotResult of match?.slotResults ?? []) {
      const teamId = slotResult.teamId ?? slotResult.team?.id ?? null;
      if (!teamId) {
        continue;
      }
      const current = canonicalTeamById.get(teamId);
      canonicalTeamById.set(teamId, {
        teamId,
        slot: current?.slot ?? slotResult.slotNumber ?? null,
        name: current?.name ?? slotResult.team?.name ?? null,
        tag: current?.tag ?? slotResult.team?.tag ?? null,
        logoUrl: current?.logoUrl ?? slotResult.team?.logoUrl ?? null,
      });
    }
    const canonicalTeams = Array.from(canonicalTeamById.values());
    if (canonicalTeams.length === 0) {
      return envelope;
    }

    const bySlot = new Map<number, (typeof canonicalTeams)[number]>();
    const byName = new Map<string, (typeof canonicalTeams)[number]>();
    const byTag = new Map<string, (typeof canonicalTeams)[number]>();
    for (const team of canonicalTeams) {
      if (typeof team.slot === 'number' && Number.isFinite(team.slot)) {
        bySlot.set(team.slot, team);
      }
      const normalizedName = normalizeTeamLookup(team.name);
      if (normalizedName) {
        byName.set(normalizedName, team);
      }
      const normalizedTag = normalizeTeamLookup(team.tag);
      if (normalizedTag) {
        byTag.set(normalizedTag, team);
      }
    }

    const resolveCanonicalTeam = (
      team: Pick<AdapterTelemetryTeam, 'teamId' | 'slot' | 'name' | 'tag'>,
    ) => {
      const direct = team.teamId ? canonicalTeamById.get(team.teamId) : null;
      if (direct) {
        return direct;
      }
      const numericTeamId = numberValue(team.teamId);
      return (
        (typeof team.slot === 'number' && Number.isFinite(team.slot)
          ? bySlot.get(team.slot)
          : null) ??
        (numericTeamId !== null ? bySlot.get(numericTeamId) : null) ??
        byName.get(normalizeTeamLookup(team.name)) ??
        byTag.get(normalizeTeamLookup(team.tag)) ??
        null
      );
    };

    const canonicalPlayerByKey = new Map<string, CanonicalPlayerBinding>();
    const upsertCanonicalPlayer = (binding: CanonicalPlayerBinding) => {
      const existing = canonicalPlayerByKey.get(binding.playerKey);
      if (!existing) {
        canonicalPlayerByKey.set(binding.playerKey, binding);
        return;
      }

      canonicalPlayerByKey.set(binding.playerKey, {
        ...existing,
        playerId: existing.playerId ?? binding.playerId,
        teamId: existing.teamId ?? binding.teamId,
        slotPlayerResultId:
          existing.slotPlayerResultId ?? binding.slotPlayerResultId,
        playerName: existing.playerName ?? binding.playerName,
        pubgAccountIds: uniqueStrings([
          ...existing.pubgAccountIds,
          ...binding.pubgAccountIds,
        ]),
        externalPlayerIds: uniqueStrings([
          ...existing.externalPlayerIds,
          ...binding.externalPlayerIds,
        ]),
        normalizedNames: Array.from(
          new Set([...existing.normalizedNames, ...binding.normalizedNames]),
        ),
        compactNormalizedNames: Array.from(
          new Set([
            ...existing.compactNormalizedNames,
            ...binding.compactNormalizedNames,
          ]),
        ),
      });
    };

    for (const slotResult of match?.slotResults ?? []) {
      if (!slotResult.teamId) {
        continue;
      }

      for (const player of slotResult.players) {
        const playerKey =
          buildMatchPlayerKey({
            playerId: player.playerId ?? null,
            playerResultId: player.id,
          }) ?? player.id;

        upsertCanonicalPlayer({
          ...collectPlayerLookupNames([
            player.playerName ?? null,
            player.player?.ign ?? null,
          ]),
          playerKey,
          playerId: player.playerId ?? null,
          teamId: slotResult.teamId,
          slotPlayerResultId: player.id,
          playerName: player.playerName ?? player.player?.ign ?? null,
          pubgAccountIds: uniqueStrings([
            player.pubgAccountId ?? null,
            player.player?.playerOpenId ?? null,
          ]),
          externalPlayerIds: uniqueStrings([
            player.externalPlayerId ?? null,
            player.player?.externalPlayerId ?? null,
            player.player?.playerOpenId ?? null,
            player.player?.inGameId ?? null,
            player.player?.pubgPlayerId ?? null,
            playerKey,
          ]),
        });
      }
    }

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

        upsertCanonicalPlayer({
          ...collectPlayerLookupNames([
            player.ign ?? null,
            player.realName ?? null,
          ]),
          playerKey,
          playerId: player.id,
          teamId: slot.team.id,
          slotPlayerResultId: null,
          playerName: player.ign ?? player.realName ?? null,
          pubgAccountIds: uniqueStrings([player.playerOpenId ?? null]),
          externalPlayerIds: uniqueStrings([
            player.externalPlayerId ?? null,
            player.playerOpenId ?? null,
            player.inGameId ?? null,
            player.pubgPlayerId ?? null,
            playerKey,
          ]),
        });
      }
    }
    const canonicalPlayers = Array.from(canonicalPlayerByKey.values());

    const teamIdMap = new Map<string, string>();
    const resolveCanonicalTeamId = (input: {
      teamId?: string | null;
      slot?: number | null;
      name?: string | null;
      tag?: string | null;
    }) => {
      const mapped = input.teamId
        ? (teamIdMap.get(input.teamId) ?? null)
        : null;
      if (mapped) {
        return mapped;
      }
      return (
        resolveCanonicalTeam({
          teamId: input.teamId ?? null,
          slot: input.slot ?? null,
          name: input.name ?? null,
          tag: input.tag ?? null,
        })?.teamId ?? null
      );
    };
    const boundTeams = envelope.teams.map((team) => {
      const canonical = resolveCanonicalTeam(team);
      if (!canonical) {
        return {
          ...team,
          slot:
            team.slot ??
            (numberValue(team.teamId) !== null
              ? numberValue(team.teamId)
              : null),
        };
      }

      if (team.teamId) {
        teamIdMap.set(team.teamId, canonical.teamId);
      }

      return {
        ...team,
        teamId: canonical.teamId,
        slot: canonical.slot ?? team.slot ?? numberValue(team.teamId),
        name: canonical.name ?? team.name ?? null,
        tag: canonical.tag ?? team.tag ?? null,
        logoUrl: canonical.logoUrl ?? team.logoUrl ?? null,
        players: (team.players ?? []).map((player) => {
          const raw = asRecord(player.raw);
          const resolved = this.resolveCanonicalPlayerBinding(
            canonicalPlayers,
            {
              matchId,
              source: 'team-player',
              teamId: canonical.teamId,
              playerId: player.playerId ?? null,
              externalPlayerId: player.externalPlayerId ?? null,
              pubgAccountId: player.pubgAccountId ?? null,
              name:
                player.ign ??
                stringValue(
                  raw?.playerName ??
                    raw?.PlayerName ??
                    raw?.ign ??
                    raw?.name ??
                    raw?.Name,
                ) ??
                null,
            },
          );

          return {
            ...player,
            teamId: canonical.teamId,
            externalPlayerId:
              player.externalPlayerId ?? player.pubgAccountId ?? null,
            playerId: resolved?.binding.playerKey ?? player.playerId ?? null,
          };
        }),
      };
    });

    const boundPlayers = envelope.players.map((player) => {
      const raw = asRecord(player.raw);
      const canonicalTeamId =
        resolveCanonicalTeamId({
          teamId: player.teamId ?? null,
          slot: null,
          name: stringValue(raw?.teamName ?? raw?.TeamName),
          tag: stringValue(raw?.teamTag ?? raw?.shortName),
        }) ??
        player.teamId ??
        null;
      const resolved = this.resolveCanonicalPlayerBinding(canonicalPlayers, {
        matchId,
        source: 'snapshot-player',
        teamId: canonicalTeamId,
        playerId: player.playerId ?? null,
        externalPlayerId: player.externalPlayerId ?? null,
        pubgAccountId: player.pubgAccountId ?? null,
        name: player.ign ?? null,
      });

      return {
        ...player,
        teamId: canonicalTeamId,
        externalPlayerId:
          player.externalPlayerId ?? player.pubgAccountId ?? null,
        playerId: resolved?.binding.playerKey ?? player.playerId ?? null,
      };
    });

    const boundEvents = envelope.events.map((event) => {
      const raw = asRecord(event.raw);
      const payload = asRecord(event.payload);
      const killerRaw = asRecord(raw?.killer) ?? asRecord(payload?.killer);
      const victimRaw = asRecord(raw?.victim) ?? asRecord(payload?.victim);
      const eventTeamId =
        resolveCanonicalTeamId({
          teamId: event.teamId ?? null,
          slot: numberValue(event.teamId),
          name: stringValue(raw?.teamName ?? payload?.teamName),
          tag: stringValue(raw?.teamTag ?? payload?.teamTag),
        }) ??
        event.teamId ??
        null;
      const killerTeamId =
        resolveCanonicalTeamId({
          teamId: event.killerTeamId ?? event.teamId ?? null,
          slot: numberValue(event.killerTeamId ?? event.teamId),
          name: stringValue(
            killerRaw?.teamName ??
              killerRaw?.TeamName ??
              raw?.killerTeamName ??
              payload?.killerTeamName,
          ),
          tag: stringValue(killerRaw?.teamTag ?? killerRaw?.shortName),
        }) ??
        event.killerTeamId ??
        eventTeamId;
      const victimTeamId =
        resolveCanonicalTeamId({
          teamId: event.victimTeamId ?? null,
          slot: numberValue(event.victimTeamId),
          name: stringValue(
            victimRaw?.teamName ??
              victimRaw?.TeamName ??
              raw?.victimTeamName ??
              payload?.victimTeamName,
          ),
          tag: stringValue(victimRaw?.teamTag ?? victimRaw?.shortName),
        }) ??
        event.victimTeamId ??
        null;

      if (event.type === 'KILL') {
        const killer = this.resolveCanonicalPlayerBinding(canonicalPlayers, {
          matchId,
          source: 'event-killer',
          teamId: killerTeamId,
          playerId: event.killerId ?? null,
          externalPlayerId:
            stringValue(payload?.killerExternalPlayerId) ??
            this.resolveTelemetryExternalPlayerId(killerRaw) ??
            this.resolveTelemetryExternalPlayerId(payload),
          pubgAccountId: this.resolveTelemetryPubgAccountId(killerRaw),
          name:
            stringValue(
              payload?.killerName ??
                payload?.killerPlayerName ??
                killerRaw?.playerName ??
                killerRaw?.ign ??
                killerRaw?.name,
            ) ?? null,
        });
        const victim = this.resolveCanonicalPlayerBinding(canonicalPlayers, {
          matchId,
          source: 'event-victim',
          teamId: victimTeamId,
          playerId: event.victimId ?? null,
          externalPlayerId:
            stringValue(payload?.victimExternalPlayerId) ??
            this.resolveTelemetryExternalPlayerId(victimRaw) ??
            this.resolveTelemetryExternalPlayerId(payload),
          pubgAccountId: this.resolveTelemetryPubgAccountId(victimRaw),
          name:
            stringValue(
              payload?.victimName ??
                payload?.victimPlayerName ??
                victimRaw?.playerName ??
                victimRaw?.ign ??
                victimRaw?.name,
            ) ?? null,
        });

        return {
          ...event,
          teamId: eventTeamId,
          killerTeamId,
          victimTeamId,
          killerId: killer?.binding.playerKey ?? event.killerId ?? null,
          victimId: victim?.binding.playerKey ?? event.victimId ?? null,
          payload: {
            ...(event.payload ?? {}),
            killerTeamId,
            victimTeamId,
            killerId: killer?.binding.playerKey ?? event.killerId ?? null,
            victimId: victim?.binding.playerKey ?? event.victimId ?? null,
          },
        };
      }

      if (event.type === 'PLAYER_STATE') {
        const resolved = this.resolveCanonicalPlayerBinding(canonicalPlayers, {
          matchId,
          source: 'event-player',
          teamId: eventTeamId,
          playerId: event.playerId ?? null,
          externalPlayerId:
            stringValue(payload?.externalPlayerId) ??
            this.resolveTelemetryExternalPlayerId(payload) ??
            this.resolveTelemetryExternalPlayerId(raw),
          pubgAccountId:
            this.resolveTelemetryPubgAccountId(payload) ??
            this.resolveTelemetryPubgAccountId(raw),
          name:
            stringValue(
              payload?.playerName ?? raw?.playerName ?? raw?.ign ?? raw?.name,
            ) ?? null,
        });

        return {
          ...event,
          teamId: eventTeamId,
          playerId: resolved?.binding.playerKey ?? event.playerId ?? null,
          payload: {
            ...(event.payload ?? {}),
            teamId: eventTeamId,
            playerId: resolved?.binding.playerKey ?? event.playerId ?? null,
          },
        };
      }

      return {
        ...event,
        teamId: eventTeamId,
        killerTeamId,
        victimTeamId,
      };
    });

    const unresolvedTeams = boundTeams.filter((team) => {
      return !canonicalTeams.some(
        (candidate) => candidate.teamId === team.teamId,
      );
    });
    if (unresolvedTeams.length > 0) {
      this.logger.warn(
        JSON.stringify({
          stage: 'pcob-adapter',
          action: 'canonical-team-binding-partial',
          matchId,
          totalTeams: envelope.teams.length,
          unresolvedTeams: unresolvedTeams.map((team) => ({
            teamId: team.teamId ?? null,
            slot: team.slot ?? null,
            name: team.name ?? null,
            tag: team.tag ?? null,
          })),
        }),
      );
    }

    return {
      ...envelope,
      teams: boundTeams,
      players: boundPlayers,
      events: boundEvents,
    };
  }

  private resolveCanonicalPlayerBinding(
    canonicalPlayers: CanonicalPlayerBinding[],
    input: CanonicalPlayerResolutionInput,
  ): CanonicalPlayerResolution | null {
    const normalizedName = normalizePlayerLookup(input.name);
    const compactNormalizedName = compactPlayerLookup(input.name);
    const teamScopedPlayers = input.teamId
      ? canonicalPlayers.filter((player) => player.teamId === input.teamId)
      : [];
    const stableExternalPlayerId =
      input.externalPlayerId ?? input.pubgAccountId ?? input.playerId ?? null;
    const attempted = {
      teamId: input.teamId ?? null,
      playerId: input.playerId ?? null,
      externalPlayerId: stableExternalPlayerId,
      pubgAccountId: input.pubgAccountId ?? null,
      name: input.name ?? null,
      normalizedName: normalizedName || null,
    };
    const cacheParams: TelemetryBindCacheParams = {
      teamId: input.teamId ?? null,
      externalPlayerId: stableExternalPlayerId,
      normalizedName: normalizedName || null,
    };

    if (canonicalPlayers.length === 0) {
      this.logTelemetryBindFailed(input, attempted, 'NO_MATCH_SLOT_PLAYERS');
      this.logCanonicalPlayerBindMiss(
        input,
        attempted,
        {},
        'NO_MATCH_SLOT_PLAYERS',
      );
      return null;
    }

    const cached = this.readTelemetryBindCache(
      input.matchId,
      cacheParams,
      canonicalPlayers,
    );
    if (cached) {
      return cached;
    }

    let finalReason = 'NO_MATCHING_SLOT_PLAYER';
    const matchCounts: Record<string, number> = {};

    if (input.pubgAccountId) {
      const scopedMatches = teamScopedPlayers.filter((player) =>
        player.pubgAccountIds.includes(input.pubgAccountId as string),
      );
      const matches = canonicalPlayers.filter((player) =>
        player.pubgAccountIds.includes(input.pubgAccountId as string),
      );
      matchCounts.pubgAccountId = matches.length;
      if (teamScopedPlayers.length > 0) {
        matchCounts.teamPubgAccountId = scopedMatches.length;
      }
      if (scopedMatches.length === 1) {
        return this.completeTelemetryBind(
          input,
          attempted,
          cacheParams,
          scopedMatches[0],
          'PUBG_ACCOUNT_ID',
          matchCounts,
        );
      }
      if (matches.length === 1) {
        return this.completeTelemetryBind(
          input,
          attempted,
          cacheParams,
          matches[0],
          'PUBG_ACCOUNT_ID',
          matchCounts,
          'GLOBAL_PUBG_ACCOUNT_ID',
        );
      }
      if (scopedMatches.length > 1 || matches.length > 1) {
        finalReason = 'AMBIGUOUS_PUBG_ACCOUNT_ID_MATCH';
      }
    }

    const externalCandidate = stableExternalPlayerId;
    if (externalCandidate) {
      const scopedMatches = teamScopedPlayers.filter((player) =>
        player.externalPlayerIds.includes(externalCandidate),
      );
      const matches = canonicalPlayers.filter((player) =>
        player.externalPlayerIds.includes(externalCandidate),
      );
      matchCounts.externalPlayerId = matches.length;
      if (teamScopedPlayers.length > 0) {
        matchCounts.teamExternalPlayerId = scopedMatches.length;
      }
      if (scopedMatches.length === 1) {
        return this.completeTelemetryBind(
          input,
          attempted,
          cacheParams,
          scopedMatches[0],
          'EXTERNAL_PLAYER_ID',
          matchCounts,
        );
      }
      if (matches.length === 1) {
        return this.completeTelemetryBind(
          input,
          attempted,
          cacheParams,
          matches[0],
          'EXTERNAL_PLAYER_ID',
          matchCounts,
          'GLOBAL_EXTERNAL_PLAYER_ID',
        );
      }
      if (scopedMatches.length > 1 || matches.length > 1) {
        finalReason = 'AMBIGUOUS_EXTERNAL_PLAYER_ID_MATCH';
      }
    }

    if (normalizedName) {
      const matches = canonicalPlayers.filter((player) =>
        player.normalizedNames.includes(normalizedName),
      );
      matchCounts.normalizedName = matches.length;
      if (matches.length === 1) {
        return this.completeTelemetryBind(
          input,
          attempted,
          cacheParams,
          matches[0],
          'NORMALIZED_NAME',
          matchCounts,
          'NORMALIZED_NAME',
        );
      }

      const teamMatches = teamScopedPlayers.filter((player) =>
        player.normalizedNames.includes(normalizedName),
      );
      if (teamScopedPlayers.length > 0) {
        matchCounts.teamNormalizedName = teamMatches.length;
      }
      if (teamMatches.length === 1) {
        return this.completeTelemetryBind(
          input,
          attempted,
          cacheParams,
          teamMatches[0],
          'TEAM_NAME',
          matchCounts,
          'TEAM_NAME',
        );
      }
      if (teamMatches.length > 1) {
        finalReason = 'AMBIGUOUS_TEAM_NAME_MATCH';
      } else if (matches.length > 1) {
        finalReason = 'AMBIGUOUS_NORMALIZED_NAME_MATCH';
      }
    }

    if (
      compactNormalizedName &&
      compactNormalizedName.length > 0 &&
      compactNormalizedName !== normalizedName
    ) {
      const matches = canonicalPlayers.filter((player) =>
        player.compactNormalizedNames.includes(compactNormalizedName),
      );
      matchCounts.compactNormalizedName = matches.length;
      if (matches.length === 1) {
        return this.completeTelemetryBind(
          input,
          attempted,
          cacheParams,
          matches[0],
          'NORMALIZED_NAME',
          matchCounts,
          'COMPACT_NORMALIZED_NAME',
        );
      }

      const teamMatches = teamScopedPlayers.filter((player) =>
        player.compactNormalizedNames.includes(compactNormalizedName),
      );
      if (teamScopedPlayers.length > 0) {
        matchCounts.teamCompactNormalizedName = teamMatches.length;
      }
      if (teamMatches.length === 1) {
        return this.completeTelemetryBind(
          input,
          attempted,
          cacheParams,
          teamMatches[0],
          'TEAM_NAME',
          matchCounts,
          'TEAM_COMPACT_NAME',
        );
      }
      if (teamMatches.length > 1) {
        finalReason = 'AMBIGUOUS_TEAM_COMPACT_NAME_MATCH';
      } else if (matches.length > 1) {
        finalReason = 'AMBIGUOUS_COMPACT_NORMALIZED_NAME_MATCH';
      }
    }

    if (!input.pubgAccountId && !externalCandidate && !normalizedName) {
      finalReason = 'MISSING_PLAYER_IDENTIFIERS';
    }

    this.logTelemetryBindFailed(input, attempted, finalReason);
    this.logCanonicalPlayerBindMiss(input, attempted, matchCounts, finalReason);
    return null;
  }

  private completeTelemetryBind(
    input: CanonicalPlayerResolutionInput,
    attempted: Record<string, unknown>,
    cacheParams: TelemetryBindCacheParams,
    binding: CanonicalPlayerBinding,
    strategy: CanonicalPlayerResolution['strategy'],
    matchCounts: Record<string, number>,
    fallback: string | null = null,
  ): CanonicalPlayerResolution {
    const resolution: CanonicalPlayerResolution = { binding, strategy };
    this.writeTelemetryBindCache(input.matchId, cacheParams, resolution);
    this.logger.debug(
      JSON.stringify({
        stage: 'pcob-adapter',
        action: fallback ? 'telemetry-bind-fallback' : 'telemetry-bind-success',
        message: fallback
          ? '[TelemetryBind] fallback used'
          : '[TelemetryBind] success',
        matchId: input.matchId,
        source: input.source,
        strategy,
        fallback,
        attempted,
        matchCounts,
        canonical: {
          playerKey: binding.playerKey,
          teamId: binding.teamId,
          playerId: binding.playerId,
          slotPlayerResultId: binding.slotPlayerResultId,
          playerName: binding.playerName,
        },
      }),
    );
    this.logger.debug(
      JSON.stringify({
        stage: 'pcob-adapter',
        action: 'canonical-player-bound',
        matchId: input.matchId,
        source: input.source,
        strategy,
        attempted,
        canonical: {
          playerKey: binding.playerKey,
          teamId: binding.teamId,
          playerId: binding.playerId,
          slotPlayerResultId: binding.slotPlayerResultId,
          playerName: binding.playerName,
        },
      }),
    );
    return resolution;
  }

  private logTelemetryBindFailed(
    input: CanonicalPlayerResolutionInput,
    attempted: Record<string, unknown>,
    reason: string,
  ) {
    this.logger.debug(
      JSON.stringify({
        stage: 'pcob-adapter',
        action: 'telemetry-bind-failed',
        message: '[TelemetryBind] failed',
        matchId: input.matchId,
        source: input.source,
        reason,
        externalPlayerId: attempted.externalPlayerId ?? null,
        normalizedName: attempted.normalizedName ?? null,
        teamId: attempted.teamId ?? null,
      }),
    );
  }

  private logCanonicalPlayerBindMiss(
    input: CanonicalPlayerResolutionInput,
    attempted: Record<string, unknown>,
    matchCounts: Record<string, number>,
    reason: string,
  ) {
    const payload = JSON.stringify({
      stage: 'pcob-adapter',
      action: 'canonical-player-bind-miss',
      matchId: input.matchId,
      source: input.source,
      attempted,
      matchCounts,
      reason,
    });
    if (input.source === 'snapshot-player') {
      this.logger.debug(payload);
      return;
    }
    this.logger.warn(payload);
  }

  private readTelemetryBindCache(
    matchId: string,
    params: TelemetryBindCacheParams,
    canonicalPlayers: CanonicalPlayerBinding[],
  ): CanonicalPlayerResolution | null {
    const cache = this.telemetryBindCache.get(matchId);
    if (!cache) {
      return null;
    }

    const validPlayerKeys = new Set(
      canonicalPlayers.map((player) => player.playerKey),
    );
    for (const cacheKey of this.buildTelemetryBindCacheKeys(params)) {
      const cached = cache.get(cacheKey);
      if (!cached) {
        continue;
      }
      if (!validPlayerKeys.has(cached.binding.playerKey)) {
        cache.delete(cacheKey);
        continue;
      }
      return cached;
    }

    return null;
  }

  private writeTelemetryBindCache(
    matchId: string,
    params: TelemetryBindCacheParams,
    resolution: CanonicalPlayerResolution,
  ) {
    const cache =
      this.telemetryBindCache.get(matchId) ??
      new Map<string, CanonicalPlayerResolution>();
    this.telemetryBindCache.set(matchId, cache);

    for (const cacheKey of this.buildTelemetryBindCacheKeys(
      params,
      resolution.strategy,
    )) {
      cache.set(cacheKey, resolution);
    }

    while (cache.size > 512) {
      const oldestKey = this.getFirstMapKey(cache);
      if (oldestKey === undefined) {
        break;
      }
      cache.delete(oldestKey);
    }
    while (this.telemetryBindCache.size > 128) {
      const oldestMatchId = this.getFirstMapKey(this.telemetryBindCache);
      if (oldestMatchId === undefined) {
        break;
      }
      this.telemetryBindCache.delete(oldestMatchId);
    }
  }

  private buildTelemetryBindCacheKeys(
    params: TelemetryBindCacheParams,
    strategy?: CanonicalPlayerResolution['strategy'],
  ): string[] {
    const keys: string[] = [];
    const externalPlayerId = normalizePlayerLookup(params.externalPlayerId);
    const normalizedName = normalizePlayerLookup(params.normalizedName);

    const includeExternalKeys =
      !strategy ||
      strategy === 'PUBG_ACCOUNT_ID' ||
      strategy === 'EXTERNAL_PLAYER_ID';
    const includeGlobalNameKey = !strategy || strategy === 'NORMALIZED_NAME';
    const includeTeamNameKey = !strategy || strategy === 'TEAM_NAME';

    if (includeExternalKeys && externalPlayerId) {
      if (params.teamId) {
        keys.push(`team:${params.teamId}:external:${externalPlayerId}`);
      }
      keys.push(`external:${externalPlayerId}`);
    }

    if (includeGlobalNameKey && normalizedName) {
      keys.push(`name:${normalizedName}`);
    }
    if (includeTeamNameKey && normalizedName && params.teamId) {
      keys.push(`team:${params.teamId}:name:${normalizedName}`);
    }

    return keys;
  }

  private resolveTelemetryPubgAccountId(
    record: Record<string, unknown> | null | undefined,
  ): string | null {
    if (!record) {
      return null;
    }
    return (
      stringValue(
        record.playerOpenId ??
          record.playerOpenID ??
          record.PlayerOpenId ??
          record.PlayerOpenID ??
          record.openId ??
          record.OpenId ??
          record.openid,
      ) ?? null
    );
  }

  private resolveTelemetryExternalPlayerId(
    record: Record<string, unknown> | null | undefined,
  ): string | null {
    if (!record) {
      return null;
    }
    return (
      stringValue(
        record.externalPlayerId ??
          record.externalId ??
          record.uid ??
          record.Uid ??
          record.UID ??
          record.userId ??
          record.UserId ??
          record.accountId ??
          record.AccountId,
      ) ?? null
    );
  }

  private normalizeZone(payload: unknown): AdapterTelemetryZone | null {
    const zone = this.extractZoneRecord(payload);
    if (!zone) return null;
    const centerCandidate =
      asRecord(zone.center) ??
      asRecord(zone.zoneCenter) ??
      asRecord(zone.safeCenter) ??
      null;
    const center =
      centerCandidate !== null
        ? {
            x:
              numberValue(
                centerCandidate.x ??
                  centerCandidate.X ??
                  centerCandidate.lon ??
                  centerCandidate.longitude,
              ) ?? 0,
            y:
              numberValue(
                centerCandidate.y ??
                  centerCandidate.Y ??
                  centerCandidate.lat ??
                  centerCandidate.latitude,
              ) ?? 0,
          }
        : null;
    const radius =
      numberValue(
        zone.radius ?? zone.zoneRadius ?? zone.r ?? zone.safeRadius,
      ) ?? null;
    const phase =
      numberValue(
        zone.phase ??
          zone.phaseIndex ??
          zone.CircleIndex ??
          zone.circleIndex ??
          zone.zonePhaseIndex,
      ) ?? null;
    const nextShrinkAt =
      timestampValue(
        zone.nextShrinkAt ??
          zone.nextShrinkTime ??
          zone.zoneNextShrinkAt ??
          zone.nextPhaseAt ??
          zone.remainingTime ??
          zone.countdown ??
          zone.MaxTime,
      ) ?? null;

    if (!center && radius === null && phase === null && nextShrinkAt === null) {
      return null;
    }

    return {
      center,
      radius,
      phase,
      nextShrinkAt,
      raw: zone,
    };
  }

  private deriveSnapshotEvents(input: {
    timestamp: number;
    players: AdapterTelemetryPlayer[];
    teams: AdapterTelemetryTeam[];
    killPayload: unknown;
  }): AdapterTelemetryEvent[] {
    const events = this.buildKillEvents(input.killPayload, input.timestamp);

    for (const team of input.teams) {
      if (!team.teamId || team.eliminated !== true) continue;
      events.push({
        type: 'TEAM_ELIMINATED',
        timestamp: input.timestamp,
        teamId: team.teamId,
        dedupeKey: hashKey(['TEAM_ELIMINATED', team.teamId]),
        payload: {
          eventType: 'TEAM_ELIMINATED',
          teamId: team.teamId,
          aliveCount: team.aliveCount ?? 0,
        },
        raw: team.raw ?? null,
      });
    }

    return events;
  }

  private buildKillEvents(
    payload: unknown,
    fallbackTimestamp: number,
  ): AdapterTelemetryEvent[] {
    const kills = this.extractKillRecords(payload);
    return kills.map((kill) => {
      const explicitTimestamp = timestampValue(
        kill.time ??
          kill.Time ??
          kill.timestamp ??
          kill.ts ??
          kill.killTime ??
          kill.KillTime ??
          kill.gameTime ??
          kill.GameTime ??
          kill.counter ??
          kill.Counter,
      );
      const timestamp = explicitTimestamp ?? fallbackTimestamp;
      const killerId =
        stringValue(
          kill.killerId ??
            kill.killerExternalPlayerId ??
            kill.KillerId ??
            kill.killerPlayerId ??
            kill.killerPlayerOpenId ??
            kill.killerOpenId ??
            kill.killer ??
            kill.Killer,
        ) ?? null;
      const victimId =
        stringValue(
          kill.victimId ??
            kill.victimExternalPlayerId ??
            kill.VictimId ??
            kill.victimPlayerId ??
            kill.victimPlayerOpenId ??
            kill.victimOpenId ??
            kill.victim ??
            kill.Victim,
        ) ?? null;
      const killerTeamId =
        stringValue(
          kill.killerTeamId ??
            kill.KillerTeamId ??
            kill.killerTeamID ??
            kill.teamId ??
            kill.teamID,
        ) ?? null;
      const victimTeamId =
        stringValue(
          kill.victimTeamId ??
            kill.VictimTeamId ??
            kill.victimTeamID ??
          kill.targetTeamId,
        ) ?? null;
      const killerName = stringValue(kill.killerName ?? kill.KillerName);
      const victimName = stringValue(kill.victimName ?? kill.VictimName);
      const stableKillKey =
        explicitTimestamp ??
        stringValue(
          kill.id ??
            kill.Id ??
            kill.ID ??
            kill.killId ??
            kill.KillId ??
            kill.eventId ??
            kill.EventId,
        ) ??
        'snapshot';

      return {
        type: 'KILL',
        timestamp,
        teamId: killerTeamId,
        killerId,
        killerTeamId,
        victimId,
        victimTeamId,
        dedupeKey: hashKey([
          'KILL',
          killerId ?? killerName,
          victimId ?? victimName,
          stableKillKey,
          stringValue(kill.weapon),
        ]),
        payload: {
          eventType: 'KILL',
          killerId,
          killerTeamId,
          victimId,
          victimTeamId,
          killerName,
          victimName,
          weapon: stringValue(kill.weapon ?? kill.Weapon),
        },
        raw: kill,
      };
    });
  }

  private normalizePushedEnvelope(
    matchId: string,
    envelope: unknown,
    fallbackTimestamp: number,
  ): AdapterTelemetryEnvelope | null {
    const root = asRecord(envelope) ?? {};
    const payloadRecord = asRecord(root.payload) ?? root;
    const dataRecord =
      asRecord(payloadRecord.data) ??
      asRecord(payloadRecord.payload) ??
      payloadRecord;
    const eventType = (
      stringValue(root.type ?? root.eventType ?? payloadRecord.eventType) ??
      'UNKNOWN'
    ).toUpperCase();
    const sessionId = this.extractEnvelopeSessionId(
      root,
      payloadRecord,
      dataRecord,
    );
    const rawSequence = this.extractEnvelopeSequence(
      root,
      payloadRecord,
      dataRecord,
    );
    const sequence = this.resolveMonotonicSequence(
      matchId,
      sessionId,
      rawSequence,
      'PCOB_PUSH',
    );
    const timestamp =
      timestampValue(
        root.ts ??
          root.timestamp ??
          payloadRecord.ts ??
          payloadRecord.timestamp,
      ) ?? fallbackTimestamp;
    const players = this.normalizePlayers(payloadRecord.players ?? dataRecord);
    const teams = this.normalizeTeams(
      payloadRecord.teams ?? dataRecord,
      players,
      [],
    );
    const zone = this.normalizeZone(
      payloadRecord.zone ??
        payloadRecord.circle ??
        dataRecord.zone ??
        dataRecord.circle ??
        dataRecord,
    );
    const structuredEvents = Array.isArray(payloadRecord.events)
      ? this.normalizeStructuredEvents(payloadRecord.events, timestamp)
      : Array.isArray(dataRecord.events)
        ? this.normalizeStructuredEvents(dataRecord.events, timestamp)
        : [];
    const killPayload =
      payloadRecord.kills ??
      payloadRecord.killInfo ??
      payloadRecord.killInfoList ??
      dataRecord.kills ??
      dataRecord.killInfo ??
      dataRecord.killInfoList ??
      null;
    const events = [
      ...structuredEvents,
      ...this.buildKillEvents(killPayload, timestamp),
    ];

    if (
      players.length > 0 ||
      teams.length > 0 ||
      zone !== null ||
      events.length > 0
    ) {
      return this.buildCanonicalEnvelope({
        matchId,
        sessionId,
        sequence,
        timestamp,
        players,
        teams,
        zone,
        events,
        source: 'PCOB_PUSH',
        raw: root,
      });
    }

    switch (eventType) {
      case 'TOTAL_PLAYER_LIST_SNAPSHOT': {
        const snapshotPlayers = this.normalizePlayers(dataRecord);
        return this.buildCanonicalEnvelope({
          matchId,
          sessionId,
          sequence,
          timestamp,
          players: snapshotPlayers,
          teams: this.normalizeTeams([], snapshotPlayers, []),
          zone: null,
          events: [],
          source: 'PCOB_PUSH',
          raw: root,
        });
      }
      case 'TEAM_INFO_SNAPSHOT':
      case 'TEAM_INFO_LIST_SNAPSHOT': {
        return this.buildCanonicalEnvelope({
          matchId,
          sessionId,
          sequence,
          timestamp,
          players: [],
          teams: this.normalizeTeams(dataRecord, [], []),
          zone: null,
          events: [],
          source: 'PCOB_PUSH',
          raw: root,
        });
      }
      case 'CIRCLE_INFO_SNAPSHOT':
      case 'ZONE':
      case 'ZONE_UPDATE':
      case 'BLUEZONE':
      case 'ZONEUPDATE': {
        return this.buildCanonicalEnvelope({
          matchId,
          sessionId,
          sequence,
          timestamp,
          players: [],
          teams: [],
          zone: this.normalizeZone(dataRecord),
          events: [],
          source: 'PCOB_PUSH',
          raw: root,
        });
      }
      case 'KILL_INFO_SNAPSHOT': {
        return this.buildCanonicalEnvelope({
          matchId,
          sessionId,
          sequence,
          timestamp,
          players: [],
          teams: [],
          zone: null,
          events: this.buildKillEvents(dataRecord, timestamp),
          source: 'PCOB_PUSH',
          raw: root,
        });
      }
      case 'KILL':
      case 'PLAYER_KILL':
      case 'PLAYER_KILLED':
      case 'ELIMINATION': {
        const event = this.normalizeDirectKillEvent(dataRecord, timestamp);
        return this.buildCanonicalEnvelope({
          matchId,
          sessionId,
          sequence,
          timestamp,
          players: [],
          teams: [],
          zone: null,
          events: event ? [event] : [],
          source: 'PCOB_PUSH',
          raw: root,
        });
      }
      case 'TEAM_ELIMINATED': {
        const teamId = this.resolveTeamId(dataRecord);
        return this.buildCanonicalEnvelope({
          matchId,
          sessionId,
          sequence,
          timestamp,
          players: [],
          teams: [],
          zone: null,
          events: teamId
            ? [
                {
                  type: 'TEAM_ELIMINATED',
                  timestamp,
                  teamId,
                  dedupeKey: hashKey(['TEAM_ELIMINATED', teamId]),
                  payload: { eventType: 'TEAM_ELIMINATED', teamId },
                  raw: dataRecord,
                },
              ]
            : [],
          source: 'PCOB_PUSH',
          raw: root,
        });
      }
      case 'MATCH_STATE_UPDATE': {
        const state = (
          stringValue(
            dataRecord.state ?? dataRecord.matchState ?? dataRecord.status,
          ) ?? ''
        ).toUpperCase();
        const winnerTeamId = this.resolveTeamId(dataRecord);
        const events: AdapterTelemetryEvent[] = [];
        if (state === 'LIVE' || state === 'STARTED') {
          events.push({
            type: 'MATCH_START',
            timestamp,
            dedupeKey: hashKey(['MATCH_START', timestamp]),
            payload: { eventType: 'MATCH_START', state },
            raw: dataRecord,
          });
        }
        if (state === 'ENDED' || state === 'FINISHED') {
          events.push({
            type: 'MATCH_END',
            timestamp,
            teamId: winnerTeamId,
            dedupeKey: hashKey([
              'MATCH_END',
              winnerTeamId ?? 'none',
              timestamp,
            ]),
            payload: {
              eventType: 'MATCH_END',
              winnerTeamId,
              state,
            },
            raw: dataRecord,
          });
        }
        return this.buildCanonicalEnvelope({
          matchId,
          sessionId,
          sequence,
          timestamp,
          players: [],
          teams: [],
          zone: null,
          events,
          source: 'PCOB_PUSH',
          raw: root,
        });
      }
      default:
        return null;
    }
  }

  private normalizeStructuredEvents(
    events: unknown[],
    fallbackTimestamp: number,
  ): AdapterTelemetryEvent[] {
    return events.flatMap((item) => {
      const event = asRecord(item);
      if (!event) return [];
      const type = (
        stringValue(event.type ?? event.eventType) ?? 'PLAYER_STATE'
      ).toUpperCase();
      const timestamp =
        timestampValue(event.timestamp ?? event.ts ?? event.time) ??
        fallbackTimestamp;
      if (type === 'KILL' || type === 'PLAYER_KILL') {
        const normalized = this.normalizeDirectKillEvent(event, timestamp);
        return normalized ? [normalized] : [];
      }
      if (type === 'TEAM_ELIMINATED') {
        const teamId = this.resolveTeamId(event);
        return teamId
          ? [
              {
                type: 'TEAM_ELIMINATED',
                timestamp,
                teamId,
                dedupeKey: hashKey(['TEAM_ELIMINATED', teamId]),
                payload: { eventType: 'TEAM_ELIMINATED', teamId },
                raw: event,
              },
            ]
          : [];
      }
      if (type === 'MATCH_START' || type === 'MATCH_STARTED') {
        return [
          {
            type: 'MATCH_START',
            timestamp,
            dedupeKey: hashKey(['MATCH_START', timestamp]),
            payload: { eventType: 'MATCH_START' },
            raw: event,
          },
        ];
      }
      if (type === 'MATCH_END' || type === 'MATCH_ENDED') {
        return [
          {
            type: 'MATCH_END',
            timestamp,
            teamId: this.resolveTeamId(event),
            dedupeKey: hashKey([
              'MATCH_END',
              this.resolveTeamId(event) ?? 'none',
              timestamp,
            ]),
            payload: { eventType: 'MATCH_END' },
            raw: event,
          },
        ];
      }
      return [
        {
          type: 'PLAYER_STATE',
          timestamp,
          teamId: this.resolveTeamId(event),
          playerId:
            stringValue(
              event.playerId ??
                event.externalPlayerId ??
                event.id ??
                event.pubgAccountId,
            ) ?? null,
          dedupeKey: hashKey([
            'PLAYER_STATE',
            stringValue(
              event.playerId ??
                event.externalPlayerId ??
                event.id ??
                event.pubgAccountId,
            ),
            timestamp,
            stringValue(event.state ?? event.status),
          ]),
          payload: event,
          raw: event,
        },
      ];
    });
  }

  private normalizeDirectKillEvent(
    payload: Record<string, unknown>,
    timestamp: number,
  ): AdapterTelemetryEvent | null {
    const killer = asRecord(payload.killer) ?? payload;
    const victim = asRecord(payload.victim) ?? payload;
    const killerId =
      stringValue(
        killer.playerId ??
          killer.externalPlayerId ??
          killer.id ??
          killer.uid ??
          killer.Uid ??
          killer.UID ??
          killer.playerOpenId ??
          killer.playerOpenID ??
          killer.openId ??
          killer.openid ??
          payload.killerId ??
          payload.killerPlayerId,
      ) ?? null;
    const victimId =
      stringValue(
        victim.playerId ??
          victim.externalPlayerId ??
          victim.id ??
          victim.uid ??
          victim.Uid ??
          victim.UID ??
          victim.playerOpenId ??
          victim.playerOpenID ??
          victim.openId ??
          victim.openid ??
          payload.victimId ??
          payload.victimPlayerId,
      ) ?? null;
    const killerTeamId =
      stringValue(
        killer.teamId ??
          killer.teamID ??
          payload.killerTeamId ??
          payload.teamId,
      ) ?? null;
    const victimTeamId =
      stringValue(victim.teamId ?? victim.teamID ?? payload.victimTeamId) ??
      null;

    if (!killerId && !victimId && !killerTeamId) {
      this.logger.warn(
        JSON.stringify({
          stage: 'pcob-adapter',
          action: 'kill-packet-missing-identifiers',
          eventType: stringValue(payload.type ?? payload.eventType) ?? 'KILL',
          timestamp,
        }),
      );
      return null;
    }

    return {
      type: 'KILL',
      timestamp,
      teamId: killerTeamId,
      killerId,
      killerTeamId,
      victimId,
      victimTeamId,
      dedupeKey: hashKey([
        'KILL',
        killerId ?? stringValue(killer.ign ?? killer.name),
        victimId ?? stringValue(victim.ign ?? victim.name),
        timestamp,
        stringValue(payload.weapon),
      ]),
      payload: {
        eventType: 'KILL',
        killerId,
        killerTeamId,
        victimId,
        victimTeamId,
        killerName: stringValue(killer.ign ?? killer.name ?? killer.playerName),
        victimName: stringValue(victim.ign ?? victim.name ?? victim.playerName),
        weapon: stringValue(payload.weapon ?? payload.Weapon),
      },
      raw: payload,
    };
  }

  private extractPlayerRecords(payload: unknown): Record<string, unknown>[] {
    if (Array.isArray(payload)) {
      return payload.map((item) => asRecord(item)).filter(Boolean) as Record<
        string,
        unknown
      >[];
    }

    const root = asRecord(payload);
    if (root) {
      for (const key of SHADOW_PLAYER_WRAPPER_KEYS) {
        const value = root[key];
        if (Array.isArray(value)) {
          return value.map((item) => asRecord(item)).filter(Boolean) as Record<
            string,
            unknown
          >[];
        }
      }
    }

    for (const candidate of this.collectPayloadRecords(payload)) {
      for (const key of SHADOW_PLAYER_LIST_KEYS) {
        const value = candidate[key];
        if (Array.isArray(value)) {
          return value.map((item) => asRecord(item)).filter(Boolean) as Record<
            string,
            unknown
          >[];
        }
      }
    }

    return [];
  }

  private extractTeamRecords(payload: unknown): Record<string, unknown>[] {
    if (Array.isArray(payload)) {
      return payload.map((item) => asRecord(item)).filter(Boolean) as Record<
        string,
        unknown
      >[];
    }

    const root = asRecord(payload);
    if (root) {
      for (const key of SHADOW_PLAYER_WRAPPER_KEYS) {
        const value = root[key];
        if (Array.isArray(value)) {
          return value.map((item) => asRecord(item)).filter(Boolean) as Record<
            string,
            unknown
          >[];
        }
      }
    }

    for (const candidate of this.collectPayloadRecords(payload)) {
      for (const key of SHADOW_TEAM_LIST_KEYS) {
        const value = candidate[key];
        if (Array.isArray(value)) {
          return value.map((item) => asRecord(item)).filter(Boolean) as Record<
            string,
            unknown
          >[];
        }
      }
    }

    return [];
  }

  private extractKillRecords(payload: unknown): Record<string, unknown>[] {
    if (Array.isArray(payload)) {
      return payload.map((item) => asRecord(item)).filter(Boolean) as Record<
        string,
        unknown
      >[];
    }

    const root = asRecord(payload);
    if (root) {
      for (const key of SHADOW_PLAYER_WRAPPER_KEYS) {
        const value = root[key];
        if (Array.isArray(value)) {
          return value.map((item) => asRecord(item)).filter(Boolean) as Record<
            string,
            unknown
          >[];
        }
      }
    }

    for (const candidate of this.collectPayloadRecords(payload)) {
      for (const key of SHADOW_KILL_LIST_KEYS) {
        const value = candidate[key];
        if (Array.isArray(value)) {
          return value.map((item) => asRecord(item)).filter(Boolean) as Record<
            string,
            unknown
          >[];
        }
      }
    }

    return [];
  }

  private collectPayloadRecords(payload: unknown): Record<string, unknown>[] {
    const root = asRecord(payload);
    if (!root) return [];

    const queue: Record<string, unknown>[] = [root];
    const seen = new Set<Record<string, unknown>>();
    const records: Record<string, unknown>[] = [];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || seen.has(current)) continue;
      seen.add(current);
      records.push(current);

      for (const key of SHADOW_PLAYER_WRAPPER_KEYS) {
        const nested = asRecord(current[key]);
        if (nested) {
          queue.push(nested);
        }
      }
    }

    return records;
  }

  private extractZoneRecord(payload: unknown): Record<string, unknown> | null {
    const root = asRecord(payload);
    if (!root) return null;
    return asRecord(root.zone) ?? asRecord(root.circle) ?? root;
  }

  private normalizeRemainingPlayers(
    players: AdapterTelemetryPlayer[],
  ): AdapterTelemetryPlayer[] {
    return players;
  }

  private booleanValue(value: unknown): boolean | null {
    if (typeof value === 'boolean') {
      return value;
    }

    const numeric = numberValue(value);
    if (numeric !== null) {
      return numeric > 0;
    }

    const text = stringValue(value)?.toLowerCase();
    if (!text) {
      return null;
    }
    if (
      text === 'true' ||
      text === 'alive' ||
      text === 'live' ||
      text === 'running'
    ) {
      return true;
    }
    if (text === 'false' || text === 'dead' || text === 'eliminated') {
      return false;
    }
    return null;
  }

  private isAlive(record: Record<string, unknown>): boolean {
    const explicitAlive = this.booleanValue(
      record.isAlive ??
        record.IsAlive ??
        record.alive ??
        record.Alive ??
        record.bAlive,
    );
    const explicitDead = this.booleanValue(
      record.hasDied ??
        record.HasDied ??
        record.bHasDied ??
        record.dead ??
        record.isDead ??
        record.eliminated,
    );
    if (explicitAlive === false || explicitDead === true) {
      return false;
    }

    const raw =
      record.liveState ??
      record.LiveState ??
      record.live_state ??
      record.state ??
      record.State ??
      record.status ??
      record.Status;
    const numeric = numberValue(raw);
    if (numeric !== null) {
      if (numeric === 1 || numeric === 5) return false;
      if (numeric === 0 || numeric === 3 || numeric === 4) return true;
      return numeric > 0;
    }

    const text = stringValue(raw)?.toLowerCase();
    if (
      text === 'alive' ||
      text === 'live' ||
      text === 'running' ||
      text === 'down' ||
      text === 'knocked' ||
      text === 'dbno'
    ) {
      return true;
    }
    if (text === 'dead' || text === 'eliminated') return false;

    const health = numberValue(
      record.health ??
        record.Health ??
        record.hp ??
        record.HP ??
        record.currentHealth ??
        record.CurrentHealth,
    );
    if (health !== null) {
      return health > 0;
    }

    if (explicitAlive === true || explicitDead === false) {
      return true;
    }

    return true;
  }

  private isKnocked(record: Record<string, unknown>): boolean {
    const raw =
      record.knocked ??
      record.isKnocked ??
      record.IsKnocked ??
      record.down ??
      record.isDown ??
      record.isDowned;
    if (typeof raw === 'boolean') return raw;
    const numeric = numberValue(raw);
    if (numeric !== null) return numeric > 0;
    const state = numberValue(
      record.liveState ?? record.LiveState ?? record.state ?? record.State,
    );
    if (state === 4) return true;
    const text = stringValue(raw)?.toLowerCase();
    if (text === 'knocked' || text === 'down' || text === 'dbno') {
      return true;
    }
    const stateLabel = stringValue(
      record.liveState ??
        record.LiveState ??
        record.state ??
        record.State ??
        record.status ??
        record.Status,
    )?.toLowerCase();
    return (
      stateLabel === 'knocked' || stateLabel === 'down' || stateLabel === 'dbno'
    );
  }

  private extractPosition(
    record: Record<string, unknown>,
  ): AdapterTelemetryPosition | null {
    const candidate =
      asRecord(record.position) ??
      asRecord(record.pos) ??
      asRecord(record.location) ??
      record;
    const x = numberValue(candidate.x ?? candidate.X ?? candidate.lon);
    const y = numberValue(candidate.y ?? candidate.Y ?? candidate.lat);
    if (x === null || y === null) return null;
    return { x, y };
  }

  private resolveTeamId(record: Record<string, unknown>): string | null {
    return (
      stringValue(
        record.teamId ??
          record.teamID ??
          record.TeamId ??
          record.TeamID ??
          record.team ??
          record.team_id,
      ) ?? null
    );
  }

  private consumeBufferedWsTelemetry(
    match: MatchSeed,
  ): BufferedWsEnvelope | null {
    const byMatch = this.wsBufferByMatch.get(match.id) ?? null;
    if (byMatch) {
      this.wsBufferByMatch.delete(match.id);
      return byMatch;
    }
    const sessionId = match.pcobSessionId ?? null;
    if (sessionId) {
      const bySession = this.wsBufferBySession.get(sessionId) ?? null;
      if (bySession) {
        this.wsBufferBySession.delete(sessionId);
        return bySession;
      }
    }
    return null;
  }

  private ensureWebSocketConnected(): void {
    if (!this.wsUrl || this.ws || this.wsReconnectTimer) {
      return;
    }

    try {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;

      ws.on('message', (data) => {
        const raw = rawWsMessageToString(data);
        try {
          const parsed = JSON.parse(raw) as unknown;
          this.bufferWsEnvelope(parsed);
        } catch {
          // ignore non-json websocket frames
        }
      });

      ws.on('close', () => {
        this.ws = null;
        this.scheduleWsReconnect();
      });

      ws.on('error', () => {
        try {
          ws.close();
        } catch {
          // ignore close errors
        }
      });
    } catch {
      this.scheduleWsReconnect();
    }
  }

  private scheduleWsReconnect(): void {
    if (this.wsReconnectTimer || !this.wsUrl) return;
    this.wsReconnectTimer = setTimeout(() => {
      this.wsReconnectTimer = null;
      this.ensureWebSocketConnected();
    }, 5000);
  }

  private bufferWsEnvelope(payload: unknown): void {
    const record = asRecord(payload);
    if (!record) return;
    const matchId = stringValue(record.matchId ?? record.match_id);
    const sessionId = stringValue(
      record.sessionId ?? record.matchSessionId ?? record.session_id,
    );
    const buffered: BufferedWsEnvelope = {
      at: Date.now(),
      payload,
    };
    if (matchId) {
      this.wsBufferByMatch.set(matchId, buffered);
    }
    if (sessionId) {
      this.wsBufferBySession.set(sessionId, buffered);
    }
  }
}
