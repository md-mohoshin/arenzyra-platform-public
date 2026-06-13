import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import type {
  MatchStateEvent,
  MatchStateSourceMode,
} from '../match-control/state.store';
import { isAutomaticMatchStateSourceMode } from '../match-control/state.store';
import { EventBusService } from '../event-bus/event-bus.service';
import {
  EVENT_BUS_TOPICS,
  type FightDetectedEventPayload,
  type MatchStateUpdatedEventPayload,
} from '../event-bus/event-bus.types';

export type FightEventType =
  | 'FIGHT_STARTED'
  | 'FIGHT_UPDATED'
  | 'FIGHT_ENDED'
  | 'TEAM_WIPED';

export type ActiveFight = {
  fightId: string;
  matchId: string;
  teamIds: string[];
  startedAt: number;
  lastEventAt: number;
  eventIds: string[];
  killsByTeam: Record<string, number>;
  knocksByTeam: Record<string, number>;
  ended: boolean;
};

export type FightEvent = {
  type: FightEventType;
  fightId: string;
  matchId: string;
  teamIds: string[];
  timestamp: number;
  startedAt: number;
  lastEventAt: number;
  durationMs: number;
  killsByTeam: Record<string, number>;
  knocksByTeam: Record<string, number>;
  eventType?: string | null;
  teamId?: string | null;
  opponentTeamIds?: string[];
};

export type FightDetectedTeam = {
  teamId: string | null;
  teamName: string;
  teamTag: string | null;
  logoUrl: string | null;
  slot: number | null;
};

const DEFAULT_WIDGET_TEAM_NAME = 'Arenzyra';
const DEFAULT_WIDGET_TEAM_TAG = 'AZ';

export type FightDetectedPayload = {
  matchId: string;
  fightId: string;
  teams: FightDetectedTeam[];
  eventCount: number;
  startedAt: string;
  lastEventAt: string;
};

type FightDetectionInput = {
  matchId: string;
  sourceMode?: MatchStateSourceMode | null;
  updatedAt?: number | string | null;
  events: MatchStateEvent[];
};

type TelemetryFightDetectionInput = {
  matchId: string;
  updatedAt?: number | string | null;
  kills: unknown[];
  teams: FightDetectedTeam[];
};

type ActiveDetectedFight = {
  fightId: string;
  matchId: string;
  pairKey: string;
  teams: FightDetectedTeam[];
  startedAt: number;
  lastEventAt: number;
  eventCount: number;
  eventKeys: string[];
};

type NormalizedCombatTelemetryEvent = {
  dedupeKey: string;
  pairKey: string;
  teams: FightDetectedTeam[];
  timestamp: number;
  type: 'KILL' | 'KNOCK';
};

@Injectable()
export class FightDetectionEngine implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FightDetectionEngine.name);
  private readonly activeFightsByMatch = new Map<
    string,
    Map<string, ActiveFight>
  >();
  private readonly detectedFightsByMatch = new Map<
    string,
    Map<string, ActiveDetectedFight>
  >();
  private readonly previousTelemetrySnapshotKeys = new Map<
    string,
    Set<string>
  >();
  private readonly processedTelemetryKeys = new Map<
    string,
    Map<string, number>
  >();
  private readonly maxTelemetrySnapshotKeys = 4096;
  private readonly maxTelemetryProcessedKeys = 4096;
  private readonly fightWindowMs = 15_000;
  private readonly publishedEvents = new Map<string, FightEvent[]>();
  private unsubscribeFromBus: (() => void) | null = null;

  constructor(
    @Optional() private readonly eventBus?: EventBusService,
    @Optional() private readonly realtime?: RealtimeGateway,
  ) {}

  onModuleInit(): void {
    if (!this.eventBus) {
      return;
    }

    this.unsubscribeFromBus = this.eventBus.subscribe(
      EVENT_BUS_TOPICS.MATCH,
      'fight-detection-engine',
      async (envelope) => {
        const payload = envelope.payload as MatchStateUpdatedEventPayload;
        const fightEvents = this.processMatchEvents({
          matchId: payload.projection.matchId,
          sourceMode: payload.projection.sourceMode,
          updatedAt: payload.projection.updatedAt,
          events: payload.projection.events,
        });
        if (fightEvents.length === 0) {
          return;
        }

        const queue = this.publishedEvents.get(payload.matchId) ?? [];
        queue.push(...fightEvents);
        this.publishedEvents.set(payload.matchId, queue);

        for (const fightEvent of fightEvents) {
          await this.eventBus?.publish<FightDetectedEventPayload>(
            EVENT_BUS_TOPICS.FIGHT,
            'fight.detected',
            {
              matchId: payload.matchId,
              organizationId: payload.organizationId ?? null,
              fightEvent,
            },
            { timestamp: fightEvent.timestamp },
          );
        }
      },
      { types: ['state.updated'] },
    );
  }

  onModuleDestroy(): void {
    this.unsubscribeFromBus?.();
    this.unsubscribeFromBus = null;
  }

  processMatchEvents(input: FightDetectionInput): FightEvent[] {
    if (!isAutomaticMatchStateSourceMode(input.sourceMode)) {
      this.activeFightsByMatch.delete(input.matchId);
      return [];
    }

    const fightMap =
      this.activeFightsByMatch.get(input.matchId) ??
      new Map<string, ActiveFight>();
    this.activeFightsByMatch.set(input.matchId, fightMap);

    const now = this.toTimestamp(input.updatedAt) ?? Date.now();
    const fightEvents: FightEvent[] = [];
    this.closeExpiredFights(input.matchId, fightMap, now, fightEvents);

    const orderedEvents = [...input.events].sort((left, right) => {
      if (left.ts !== right.ts) return left.ts - right.ts;
      return left.id.localeCompare(right.id);
    });

    for (const event of orderedEvents) {
      if (event.type === 'PLAYER_KILL' || event.type === 'PLAYER_KNOCKED') {
        this.processCombatEvent(input.matchId, fightMap, event, fightEvents);
        continue;
      }
      if (event.type === 'TEAM_ELIMINATED') {
        this.processTeamWipe(input.matchId, fightMap, event, fightEvents);
      }
    }

    this.closeExpiredFights(input.matchId, fightMap, now, fightEvents);
    if (fightMap.size === 0) {
      this.activeFightsByMatch.delete(input.matchId);
    }

    return fightEvents;
  }

  pruneMatches(activeMatchIds: string[]): void {
    const active = new Set(activeMatchIds);
    for (const matchId of this.activeFightsByMatch.keys()) {
      if (!active.has(matchId)) {
        this.activeFightsByMatch.delete(matchId);
      }
    }
    for (const matchId of this.detectedFightsByMatch.keys()) {
      if (!active.has(matchId)) {
        this.detectedFightsByMatch.delete(matchId);
      }
    }
    for (const matchId of this.publishedEvents.keys()) {
      if (!active.has(matchId)) {
        this.publishedEvents.delete(matchId);
      }
    }
    for (const matchId of this.previousTelemetrySnapshotKeys.keys()) {
      if (!active.has(matchId)) {
        this.previousTelemetrySnapshotKeys.delete(matchId);
      }
    }
    for (const matchId of this.processedTelemetryKeys.keys()) {
      if (!active.has(matchId)) {
        this.processedTelemetryKeys.delete(matchId);
      }
    }
  }

  drainPublishedEvents(matchId: string): FightEvent[] {
    const next = this.publishedEvents.get(matchId) ?? [];
    this.publishedEvents.delete(matchId);
    return next;
  }

  processTelemetryPacket(
    input: TelemetryFightDetectionInput,
  ): FightDetectedPayload[] {
    const matchId = String(input?.matchId || '').trim();
    if (!matchId) {
      return [];
    }

    const fightMap =
      this.detectedFightsByMatch.get(matchId) ??
      new Map<string, ActiveDetectedFight>();
    this.detectedFightsByMatch.set(matchId, fightMap);

    const previousSnapshot =
      this.previousTelemetrySnapshotKeys.get(matchId) ?? new Set<string>();
    const processed =
      this.processedTelemetryKeys.get(matchId) ?? new Map<string, number>();
    const currentSnapshot = new Set<string>();
    const detectedByPair = new Map<string, FightDetectedPayload>();
    const now = this.toTimestamp(input.updatedAt) ?? Date.now();
    const lookup = this.buildFightTeamLookup(input.teams);

    this.expireDetectedFights(matchId, fightMap, now);

    const combatEvents = this.normalizeCombatTelemetryEvents(
      matchId,
      input.kills,
      lookup,
    ).sort((left, right) => left.timestamp - right.timestamp);

    for (const event of combatEvents) {
      if (currentSnapshot.has(event.dedupeKey)) {
        continue;
      }
      currentSnapshot.add(event.dedupeKey);
      if (
        previousSnapshot.has(event.dedupeKey) ||
        processed.has(event.dedupeKey)
      ) {
        continue;
      }

      processed.set(event.dedupeKey, event.timestamp);
      this.expireDetectedFights(matchId, fightMap, event.timestamp);

      const fight =
        fightMap.get(event.pairKey) ??
        this.createDetectedFight(
          matchId,
          event.pairKey,
          event.teams,
          event.timestamp,
        );

      if (!fightMap.has(event.pairKey)) {
        fightMap.set(event.pairKey, fight);
      }

      if (!fight.eventKeys.includes(event.dedupeKey)) {
        fight.eventKeys.push(event.dedupeKey);
      }
      fight.eventCount += 1;
      fight.lastEventAt = Math.max(fight.lastEventAt, event.timestamp);

      if (fight.eventCount < 3) {
        continue;
      }

      detectedByPair.set(event.pairKey, this.toDetectedPayload(fight));
    }

    this.expireDetectedFights(matchId, fightMap, now);
    this.previousTelemetrySnapshotKeys.set(
      matchId,
      this.trimTelemetrySnapshotKeys(currentSnapshot),
    );
    this.processedTelemetryKeys.set(
      matchId,
      this.trimTelemetryProcessedKeys(processed),
    );

    if (fightMap.size === 0) {
      this.detectedFightsByMatch.delete(matchId);
    }

    const detected = [...detectedByPair.values()];
    for (const payload of detected) {
      this.realtime?.emitFightDetected(payload);
      this.logger.debug(
        `[FightEngine] fight detected match=${matchId} teams=${payload.teams
          .map((team) => team.teamName)
          .join(' vs ')} events=${payload.eventCount}`,
      );
    }

    return detected;
  }

  getActiveDetectedFights(matchId: string): FightDetectedPayload[] {
    const normalizedMatchId = String(matchId || '').trim();
    if (!normalizedMatchId) {
      return [];
    }

    const now = Date.now();
    const fightMap = this.detectedFightsByMatch.get(normalizedMatchId);
    if (!fightMap) {
      return [];
    }

    this.expireDetectedFights(normalizedMatchId, fightMap, now);

    return [...fightMap.values()]
      .filter((fight) => fight.eventCount >= 3)
      .sort((left, right) => right.lastEventAt - left.lastEventAt)
      .map((fight) => this.toDetectedPayload(fight));
  }

  private processCombatEvent(
    matchId: string,
    fightMap: Map<string, ActiveFight>,
    event: MatchStateEvent,
    fightEvents: FightEvent[],
  ): void {
    const teams = this.resolveCombatTeams(event);
    if (!teams) {
      return;
    }

    const { attackerTeamId, victimTeamId } = teams;
    const fight =
      this.findActiveFight(fightMap, attackerTeamId, victimTeamId, event.ts) ??
      this.createFight(matchId, attackerTeamId, victimTeamId, event.ts);
    const isNewFight = !fightMap.has(fight.fightId);
    if (isNewFight) {
      fightMap.set(fight.fightId, fight);
    }

    if (fight.eventIds.includes(event.id)) {
      return;
    }

    fight.eventIds.push(event.id);
    fight.lastEventAt = Math.max(fight.lastEventAt, event.ts);
    if (event.type === 'PLAYER_KILL') {
      fight.killsByTeam[attackerTeamId] =
        (fight.killsByTeam[attackerTeamId] ?? 0) + 1;
    } else {
      fight.knocksByTeam[attackerTeamId] =
        (fight.knocksByTeam[attackerTeamId] ?? 0) + 1;
    }

    if (isNewFight) {
      this.logger.debug(
        `[FightEngine] fight started match=${matchId} teams=${fight.teamIds.join(',')}`,
      );
      fightEvents.push(
        this.toFightEvent('FIGHT_STARTED', fight, event.ts, {
          eventType: event.type,
        }),
      );
      return;
    }

    this.logger.debug(
      `[FightEngine] fight updated fightId=${fight.fightId} event=${event.type}`,
    );
    fightEvents.push(
      this.toFightEvent('FIGHT_UPDATED', fight, event.ts, {
        eventType: event.type,
      }),
    );
  }

  private processTeamWipe(
    matchId: string,
    fightMap: Map<string, ActiveFight>,
    event: MatchStateEvent,
    fightEvents: FightEvent[],
  ): void {
    const teamId = event.teamId;
    if (!teamId) {
      return;
    }

    for (const fight of fightMap.values()) {
      if (fight.ended || !fight.teamIds.includes(teamId)) {
        continue;
      }

      const opponentTeamIds = fight.teamIds.filter(
        (candidate) => candidate !== teamId,
      );
      this.logger.debug(
        `[FightEngine] team wiped match=${matchId} teamId=${teamId}`,
      );
      fightEvents.push(
        this.toFightEvent('TEAM_WIPED', fight, event.ts, {
          teamId,
          opponentTeamIds,
        }),
      );
      this.endFight(matchId, fightMap, fight, event.ts, fightEvents);
    }
  }

  private closeExpiredFights(
    matchId: string,
    fightMap: Map<string, ActiveFight>,
    now: number,
    fightEvents: FightEvent[],
  ): void {
    for (const fight of [...fightMap.values()]) {
      if (fight.ended) {
        fightMap.delete(fight.fightId);
        continue;
      }
      if (now - fight.lastEventAt <= this.fightWindowMs) {
        continue;
      }
      this.endFight(matchId, fightMap, fight, now, fightEvents);
    }
  }

  private endFight(
    matchId: string,
    fightMap: Map<string, ActiveFight>,
    fight: ActiveFight,
    timestamp: number,
    fightEvents: FightEvent[],
  ): void {
    if (fight.ended) {
      fightMap.delete(fight.fightId);
      return;
    }
    fight.ended = true;
    fight.lastEventAt = Math.max(fight.lastEventAt, timestamp);
    this.logger.debug(
      `[FightEngine] fight ended fightId=${fight.fightId} duration=${fight.lastEventAt - fight.startedAt}`,
    );
    fightEvents.push(
      this.toFightEvent('FIGHT_ENDED', fight, fight.lastEventAt),
    );
    fightMap.delete(fight.fightId);
  }

  private findActiveFight(
    fightMap: Map<string, ActiveFight>,
    attackerTeamId: string,
    victimTeamId: string,
    timestamp: number,
  ): ActiveFight | null {
    const pairKey = this.pairKey(attackerTeamId, victimTeamId);
    for (const fight of fightMap.values()) {
      if (fight.ended) {
        continue;
      }
      if (
        this.pairKey(fight.teamIds[0] ?? '', fight.teamIds[1] ?? '') !== pairKey
      ) {
        continue;
      }
      if (
        timestamp >= fight.startedAt - this.fightWindowMs &&
        timestamp <= fight.lastEventAt + this.fightWindowMs
      ) {
        return fight;
      }
    }
    return null;
  }

  private createFight(
    matchId: string,
    attackerTeamId: string,
    victimTeamId: string,
    timestamp: number,
  ): ActiveFight {
    const teamIds = [...new Set([attackerTeamId, victimTeamId])].sort();
    return {
      fightId: `fight:${matchId}:${teamIds.join(':')}:${timestamp}`,
      matchId,
      teamIds,
      startedAt: timestamp,
      lastEventAt: timestamp,
      eventIds: [],
      killsByTeam: {},
      knocksByTeam: {},
      ended: false,
    };
  }

  private resolveCombatTeams(
    event: MatchStateEvent,
  ): { attackerTeamId: string; victimTeamId: string } | null {
    const payload = event.payload ?? {};
    if (event.type === 'PLAYER_KILL') {
      const attackerTeamId =
        this.stringValue(payload.killerTeamId) ?? event.teamId ?? null;
      const victimTeamId = this.stringValue(payload.victimTeamId);
      if (!attackerTeamId || !victimTeamId || attackerTeamId === victimTeamId) {
        return null;
      }
      return { attackerTeamId, victimTeamId };
    }

    if (event.type === 'PLAYER_KNOCKED') {
      const attackerTeamId =
        this.stringValue(payload.attackerTeamId) ??
        this.stringValue(payload.killerTeamId);
      const victimTeamId =
        this.stringValue(payload.victimTeamId) ?? event.teamId ?? null;
      if (!attackerTeamId || !victimTeamId || attackerTeamId === victimTeamId) {
        return null;
      }
      return { attackerTeamId, victimTeamId };
    }

    return null;
  }

  private toFightEvent(
    type: FightEventType,
    fight: ActiveFight,
    timestamp: number,
    extra: {
      eventType?: string | null;
      teamId?: string | null;
      opponentTeamIds?: string[];
    } = {},
  ): FightEvent {
    return {
      type,
      fightId: fight.fightId,
      matchId: fight.matchId,
      teamIds: [...fight.teamIds],
      timestamp,
      startedAt: fight.startedAt,
      lastEventAt: fight.lastEventAt,
      durationMs: Math.max(0, fight.lastEventAt - fight.startedAt),
      killsByTeam: { ...fight.killsByTeam },
      knocksByTeam: { ...fight.knocksByTeam },
      eventType: extra.eventType ?? null,
      teamId: extra.teamId ?? null,
      opponentTeamIds: extra.opponentTeamIds ?? [],
    };
  }

  private pairKey(left: string, right: string): string {
    return [left, right].sort().join('|');
  }

  private stringValue(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private toTimestamp(
    value: number | string | null | undefined,
  ): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const asNumber = Number(value);
      if (Number.isFinite(asNumber)) {
        return asNumber;
      }
      const asDate = Date.parse(value);
      return Number.isFinite(asDate) ? asDate : null;
    }
    return null;
  }

  private buildFightTeamLookup(teams: FightDetectedTeam[]) {
    const byId = new Map<string, FightDetectedTeam>();
    const bySlot = new Map<number, FightDetectedTeam>();

    for (const team of teams) {
      const normalizedTeamId = this.normalizeValue(team.teamId);
      if (normalizedTeamId) {
        byId.set(normalizedTeamId, team);
      }
      if (typeof team.slot === 'number' && Number.isFinite(team.slot)) {
        bySlot.set(team.slot, team);
      }
    }

    return { byId, bySlot };
  }

  private normalizeCombatTelemetryEvents(
    matchId: string,
    kills: unknown[],
    lookup: {
      byId: Map<string, FightDetectedTeam>;
      bySlot: Map<number, FightDetectedTeam>;
    },
  ): NormalizedCombatTelemetryEvent[] {
    return this.extractKillEntries(kills)
      .map((entry) =>
        this.normalizeCombatTelemetryEvent(matchId, entry, lookup),
      )
      .filter((event): event is NormalizedCombatTelemetryEvent =>
        Boolean(event),
      );
  }

  private normalizeCombatTelemetryEvent(
    matchId: string,
    entry: unknown,
    lookup: {
      byId: Map<string, FightDetectedTeam>;
      bySlot: Map<number, FightDetectedTeam>;
    },
  ): NormalizedCombatTelemetryEvent | null {
    const record = this.toRecord(entry);
    if (!record) {
      return null;
    }

    const eventType = this.resolveCombatTelemetryType(record);
    if (!eventType) {
      return null;
    }

    const attacker = this.resolveDetectedTeam(
      this.pickString(
        record.killerTeamId,
        record.killerTeamID,
        record.KillerTeamId,
        record.attackerTeamId,
        record.attackerTeamID,
        record.teamId,
        record.teamID,
      ),
      this.pickNumber(
        record.killerTeamNo,
        record.killerTeam,
        record.TeamNo,
        record.teamNo,
        record.slot,
        record.Slot,
      ),
      lookup,
    );
    const victim = this.resolveDetectedTeam(
      this.pickString(
        record.victimTeamId,
        record.victimTeamID,
        record.VictimTeamId,
        record.targetTeamId,
        record.targetTeamID,
        record.teamIdVictim,
      ),
      this.pickNumber(
        record.victimTeamNo,
        record.victimTeam,
        record.targetTeamNo,
        record.targetSlot,
      ),
      lookup,
    );

    if (!attacker || !victim) {
      return null;
    }

    const attackerKey = this.detectedTeamKey(attacker);
    const victimKey = this.detectedTeamKey(victim);
    if (attackerKey === victimKey) {
      return null;
    }

    const timestamp =
      this.pickTimestamp(
        record.timestamp,
        record.time,
        record.ts,
        record.eventTime,
        record.killTime,
        record.createdAt,
        record.occurredAt,
      ) ?? Date.now();

    const dedupeSeed =
      this.pickString(record.killId, record.eventId, record.id) ??
      [
        eventType,
        attackerKey,
        victimKey,
        this.pickString(
          record.killerName,
          record.killer,
          record.attackerName,
          record.killerPlayer,
        ) ?? 'unknown-killer',
        this.pickString(
          record.victimName,
          record.victim,
          record.targetName,
          record.victimPlayer,
        ) ?? 'unknown-victim',
        String(timestamp),
      ].join('|');

    return {
      dedupeKey: [matchId, dedupeSeed, eventType].join('|'),
      pairKey: this.pairKey(attackerKey, victimKey),
      teams: [attacker, victim].sort((left, right) =>
        this.detectedTeamKey(left).localeCompare(this.detectedTeamKey(right)),
      ),
      timestamp,
      type: eventType,
    };
  }

  private resolveCombatTelemetryType(
    record: Record<string, unknown>,
  ): 'KILL' | 'KNOCK' | null {
    const rawType = this.normalizeValue(
      this.pickString(
        record.eventType,
        record.EventType,
        record.type,
        record.Type,
        record.killType,
        record.KillType,
        record.result,
        record.Result,
        record.status,
        record.Status,
      ),
    );

    if (
      rawType &&
      ['knock', 'player_knocked', 'dbno', 'down', 'downed'].some((token) =>
        rawType.includes(token),
      )
    ) {
      return 'KNOCK';
    }

    if (
      this.pickBoolean(
        record.isKnock,
        record.isKnocked,
        record.knocked,
        record.dbno,
        record.downed,
      )
    ) {
      return 'KNOCK';
    }

    if (
      rawType &&
      ['kill', 'eliminated', 'elimination', 'dead', 'finish'].some((token) =>
        rawType.includes(token),
      )
    ) {
      return 'KILL';
    }

    return 'KILL';
  }

  private resolveDetectedTeam(
    rawTeamId: string | null,
    rawSlot: number | null,
    lookup: {
      byId: Map<string, FightDetectedTeam>;
      bySlot: Map<number, FightDetectedTeam>;
    },
  ): FightDetectedTeam | null {
    const normalizedTeamId = this.normalizeValue(rawTeamId);
    if (normalizedTeamId && lookup.byId.has(normalizedTeamId)) {
      return lookup.byId.get(normalizedTeamId) ?? null;
    }

    if (
      rawSlot === null &&
      normalizedTeamId &&
      Number.isFinite(Number(normalizedTeamId)) &&
      lookup.bySlot.has(Number(normalizedTeamId))
    ) {
      return lookup.bySlot.get(Number(normalizedTeamId)) ?? null;
    }

    if (
      rawSlot !== null &&
      rawSlot !== undefined &&
      lookup.bySlot.has(rawSlot)
    ) {
      return lookup.bySlot.get(rawSlot) ?? null;
    }

    if (!normalizedTeamId && rawSlot === null) {
      return null;
    }

    return {
      teamId: rawTeamId ?? null,
      teamName: DEFAULT_WIDGET_TEAM_NAME,
      teamTag: DEFAULT_WIDGET_TEAM_TAG,
      logoUrl: null,
      slot: rawSlot,
    };
  }

  private createDetectedFight(
    matchId: string,
    pairKey: string,
    teams: FightDetectedTeam[],
    timestamp: number,
  ): ActiveDetectedFight {
    return {
      fightId: `fight-alert:${matchId}:${pairKey}:${timestamp}`,
      matchId,
      pairKey,
      teams,
      startedAt: timestamp,
      lastEventAt: timestamp,
      eventCount: 0,
      eventKeys: [],
    };
  }

  private expireDetectedFights(
    matchId: string,
    fightMap: Map<string, ActiveDetectedFight>,
    now: number,
  ) {
    for (const [pairKey, fight] of [...fightMap.entries()]) {
      if (now - fight.lastEventAt <= this.fightWindowMs) {
        continue;
      }

      fightMap.delete(pairKey);
      this.logger.debug(
        `[FightEngine] fight expired match=${matchId} fightId=${fight.fightId}`,
      );
    }
  }

  private toDetectedPayload(fight: ActiveDetectedFight): FightDetectedPayload {
    return {
      matchId: fight.matchId,
      fightId: fight.fightId,
      teams: fight.teams.map((team) => ({ ...team })),
      eventCount: fight.eventCount,
      startedAt: new Date(fight.startedAt).toISOString(),
      lastEventAt: new Date(fight.lastEventAt).toISOString(),
    };
  }

  private detectedTeamKey(team: FightDetectedTeam): string {
    return (
      this.normalizeValue(team.teamId) ??
      (typeof team.slot === 'number' && Number.isFinite(team.slot)
        ? `slot:${team.slot}`
        : `name:${this.normalizeValue(team.teamName) ?? 'unknown'}`)
    );
  }

  private extractKillEntries(payload: unknown): unknown[] {
    if (!payload) {
      return [];
    }
    if (Array.isArray(payload)) {
      return payload;
    }
    const record = this.toRecord(payload);
    if (!record) {
      return [];
    }

    const candidates = [
      record.KillList,
      record.killList,
      record.kills,
      record.KillInfo,
      record.killInfo,
      record.events,
      record.data,
    ];

    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate;
      }
    }

    return [];
  }

  private trimTelemetrySnapshotKeys(keys: Set<string>): Set<string> {
    const values = Array.from(keys);
    if (values.length <= this.maxTelemetrySnapshotKeys) {
      return keys;
    }
    return new Set(values.slice(-this.maxTelemetrySnapshotKeys));
  }

  private trimTelemetryProcessedKeys(
    keys: Map<string, number>,
  ): Map<string, number> {
    while (keys.size > this.maxTelemetryProcessedKeys) {
      const first = keys.keys().next().value as string | undefined;
      if (!first) {
        break;
      }
      keys.delete(first);
    }
    return keys;
  }

  private pickTimestamp(...values: unknown[]): number | null {
    for (const value of values) {
      const timestamp = this.toTimestamp(
        typeof value === 'string' || typeof value === 'number' ? value : null,
      );
      if (timestamp !== null) {
        return timestamp;
      }
    }
    return null;
  }

  private pickString(...values: unknown[]): string | null {
    for (const value of values) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
      if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
      }
    }
    return null;
  }

  private pickNumber(...values: unknown[]): number | null {
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
    return null;
  }

  private pickBoolean(...values: unknown[]): boolean {
    for (const value of values) {
      if (typeof value === 'boolean') {
        return value;
      }
      if (typeof value === 'number') {
        return value !== 0;
      }
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes'].includes(normalized)) {
          return true;
        }
        if (['false', '0', 'no'].includes(normalized)) {
          return false;
        }
      }
    }
    return false;
  }

  private normalizeValue(value: string | null | undefined): string | null {
    if (!value) {
      return null;
    }
    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
  }

  private toRecord(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  }
}
