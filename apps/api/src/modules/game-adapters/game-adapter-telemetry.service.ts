import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  MatchEventType,
  MatchStatus,
  Prisma,
  TelemetrySource,
} from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { RedisService } from '../../redis/redis.service';
import type { GameAdapter } from './game-adapter.interface';
import { GameAdaptersResolver } from './game-adapters.resolver';
import type {
  AdapterTelemetryEnvelope,
  AdapterTelemetryEvent,
} from './game-adapter.types';
import { TelemetryIngressService } from '../telemetry/telemetry-ingress.service';
import { normalizeTelemetrySource } from '../../common/telemetry-source.util';

type IngestEnvelopeOptions = {
  sourceOverride?: string | null;
};

const DEDUPE_TTL_SECONDS = Math.max(
  60,
  Math.floor(
    Number(process.env.GAME_ADAPTER_EVENT_DEDUPE_MS ?? 300_000) / 1000,
  ),
);

const isEnabledFlag = (value: string | undefined): boolean => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  return normalized === '1' || normalized === 'true';
};

const isLegacyAdapterPollingEnabled = (): boolean =>
  isEnabledFlag(process.env.GAME_ADAPTER_TELEMETRY_POLL_ENABLED) ||
  isEnabledFlag(process.env.ALLOW_LEGACY_PCOB_INGEST);

const toJsonInput = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;

const resolvePollSource = (adapterKey: string): string | null => {
  if (adapterKey === 'pubgm-pcob') {
    return 'PCOB_API';
  }
  return null;
};

const isTelemetryPollingAdapter = (
  adapter: GameAdapter,
): adapter is GameAdapter & {
  pullTelemetry: NonNullable<GameAdapter['pullTelemetry']>;
} => typeof adapter.pullTelemetry === 'function';

const isEnvelopeAdapter = (
  adapter: GameAdapter,
): adapter is GameAdapter & {
  normalizeTelemetryEnvelope: NonNullable<
    GameAdapter['normalizeTelemetryEnvelope']
  >;
} => typeof adapter.normalizeTelemetryEnvelope === 'function';

@Injectable()
export class GameAdapterTelemetryService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(GameAdapterTelemetryService.name);
  private readonly inFlight = new Set<string>();
  private readonly memoryDedupe = new Map<string, Map<string, number>>();
  private readonly nullAdapterWarnings = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly resolver: GameAdaptersResolver,
    private readonly telemetryIngress: TelemetryIngressService,
  ) {}

  onModuleInit() {
    if (!isLegacyAdapterPollingEnabled()) {
      this.logger.log(
        'Legacy game-adapter telemetry polling disabled; API push telemetry remains enabled',
      );
      return;
    }

    const intervalMs = Math.max(
      500,
      Number(process.env.GAME_ADAPTER_TELEMETRY_POLL_MS ?? 1500),
    );
    this.timer = setInterval(() => {
      void this.tick().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Adapter telemetry tick failed: ${message}`);
      });
    }, intervalMs);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.nullAdapterWarnings.clear();
  }

  async ingestEnvelope(
    matchId: string,
    envelope: unknown,
    options: IngestEnvelopeOptions = {},
  ) {
    const adapter = await this.resolver.resolve(matchId);
    this.warnIfNullAdapter(matchId, adapter, 'push');
    if (!isEnvelopeAdapter(adapter)) {
      const match = await this.prisma.match.findUnique({
        where: { id: matchId },
        select: { adapterKey: true },
      });
      this.logger.warn(
        JSON.stringify({
          stage: 'game-adapter-telemetry',
          action: 'push-envelope-ignored',
          reason: 'ADAPTER_NOT_ENVELOPE_CAPABLE',
          matchId,
          adapterKey: match?.adapterKey ?? null,
          resolvedAdapterKey: adapter.key,
          resolvedAdapterName: adapter.constructor?.name ?? 'UnknownAdapter',
          envelopeCapable: false,
        }),
      );
      return { ok: true, handled: false };
    }

    const telemetry = await adapter.normalizeTelemetryEnvelope(
      matchId,
      envelope,
      {},
    );
    if (!telemetry) {
      this.logger.debug(
        JSON.stringify({
          stage: 'game-adapter-telemetry',
          action: 'normalized-envelope-ignored',
          mode: 'push',
          matchId,
          adapterKey: adapter.key,
          reason: 'ADAPTER_RETURNED_NULL',
        }),
      );
      return { ok: true, handled: true, ignored: true };
    }

    this.logger.debug(
      JSON.stringify({
        stage: 'game-adapter-telemetry',
        action: 'normalized-envelope-ready',
        mode: 'push',
        matchId,
        adapterKey: adapter.key,
        source: telemetry.source ?? adapter.key,
        players: telemetry.players.length,
        teams: telemetry.teams.length,
        events: telemetry.events.length,
        hasZone: telemetry.zone !== null,
      }),
    );
    const result = await this.persistTelemetry(
      matchId,
      adapter.key,
      telemetry,
      {
        sourceOverride: options.sourceOverride,
      },
    );
    return {
      ok: true,
      handled: true,
      ignored: result.ignored,
      ...(result.reason ? { reason: result.reason } : {}),
    };
  }

  private async tick() {
    const matches = await this.prisma.match.findMany({
      where: {
        status: MatchStatus.LIVE,
        deletedAt: null,
        adapterKey: { not: null },
      },
      select: { id: true },
    });

    for (const match of matches) {
      if (this.inFlight.has(match.id)) continue;
      this.inFlight.add(match.id);
      void this.pollMatch(match.id)
        .catch((error) => {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Adapter telemetry poll failed match=${match.id}: ${message}`,
          );
        })
        .finally(() => this.inFlight.delete(match.id));
    }
  }

  private async pollMatch(matchId: string) {
    const adapter = await this.resolver.resolve(matchId);
    this.warnIfNullAdapter(matchId, adapter, 'poll');
    if (!isTelemetryPollingAdapter(adapter)) {
      return;
    }
    const pollSource = resolvePollSource(adapter.key);
    if (
      pollSource &&
      (await this.shouldSuspendPollForActiveExternalSource(matchId, pollSource))
    ) {
      return;
    }
    const telemetry = await adapter.pullTelemetry(matchId, {});
    if (!telemetry) {
      this.logger.debug(
        JSON.stringify({
          stage: 'game-adapter-telemetry',
          action: 'normalized-envelope-ignored',
          mode: 'poll',
          matchId,
          adapterKey: adapter.key,
          reason: 'ADAPTER_RETURNED_NULL',
        }),
      );
      return;
    }
    this.logger.debug(
      JSON.stringify({
        stage: 'game-adapter-telemetry',
        action: 'normalized-envelope-ready',
        mode: 'poll',
        matchId,
        adapterKey: adapter.key,
        source: telemetry.source ?? adapter.key,
        players: telemetry.players.length,
        teams: telemetry.teams.length,
        events: telemetry.events.length,
        hasZone: telemetry.zone !== null,
      }),
    );
    await this.persistTelemetry(matchId, adapter.key, telemetry);
  }

  private async persistTelemetry(
    matchId: string,
    adapterKey: string,
    telemetry: AdapterTelemetryEnvelope,
    options: IngestEnvelopeOptions = {},
  ): Promise<{ ignored: boolean; reason?: string | null }> {
    const source = options.sourceOverride ?? telemetry.source ?? adapterKey;
    const ingressResult: Awaited<
      ReturnType<TelemetryIngressService['ingestAdapterTelemetryEnvelope']>
    > = await this.telemetryIngress.ingestAdapterTelemetryEnvelope(telemetry, {
      boundMatchId: matchId,
      source,
    });
    const shouldPersistAcceptedEnvelope =
      ingressResult.ignored !== true ||
      ingressResult.reason === 'NO_STATE_CHANGE';
    const compatibilityMirror = shouldPersistAcceptedEnvelope
      ? await this.persistCompatibilityMirror(matchId, adapterKey, telemetry, {
          source,
        })
      : { mirrored: false, freshEventCount: 0 };
    this.logger.debug(
      JSON.stringify({
        stage: 'game-adapter-telemetry',
        action: 'canonical-envelope-emitted',
        matchId,
        adapterKey,
        source,
        players: telemetry.players.length,
        teams: telemetry.teams.length,
        events: telemetry.events.length,
        freshEvents: compatibilityMirror.freshEventCount,
        hasZone: telemetry.zone !== null,
        compatibilityMirrorPersisted: compatibilityMirror.mirrored,
        ignored: ingressResult.ignored ?? false,
        reason: ingressResult.reason ?? null,
      }),
    );
    return {
      ignored: ingressResult.ignored ?? false,
      reason: ingressResult.reason ?? null,
    };
  }

  private async shouldSuspendPollForActiveExternalSource(
    matchId: string,
    pollSource: string,
  ): Promise<boolean> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        telemetrySource: true,
        controlState: {
          select: {
            metaJson: true,
          },
        },
      },
    });

    const acceptedSource = normalizeTelemetrySource(match?.telemetrySource);
    const normalizedPollSource = normalizeTelemetrySource(pollSource);
    const hasHealthyExternalTelemetry =
      acceptedSource !== null &&
      acceptedSource !== TelemetrySource.AUTO &&
      normalizedPollSource !== null &&
      acceptedSource !== normalizedPollSource;

    if (!hasHealthyExternalTelemetry) {
      return false;
    }

    this.logger.debug(
      JSON.stringify({
        stage: 'game-adapter-telemetry',
        action: 'poll-skipped-external-source-active',
        matchId,
        pollSource,
        activeSource: acceptedSource ?? null,
      }),
    );
    return true;
  }

  private async persistCompatibilityMirror(
    matchId: string,
    adapterKey: string,
    telemetry: AdapterTelemetryEnvelope,
    params: {
      source: string;
    },
  ): Promise<{ mirrored: boolean; freshEventCount: number }> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        organizationId: true,
        controlState: {
          select: {
            organizationId: true,
          },
        },
        tournament: { select: { organizationId: true } },
      },
    });
    if (!match) {
      return { mirrored: false, freshEventCount: 0 };
    }

    // Compatibility-only mirror for older map/results/scoring readers.
    // Authoritative live telemetry state is adapter -> ingress -> engine.
    // Keep structural player/team rosters out of this payload so legacy readers
    // cannot rebuild result rows from telemetry after canonical runtime fields
    // have already been merged.
    const safeEvents = this.filterUnsafeCompatibilityEvents(telemetry, {
      matchId,
      adapterKey,
      source: params.source,
    });
    const compatibilityPayload = toJsonInput({
      matchId: telemetry.matchId,
      sessionId: telemetry.sessionId ?? null,
      sequence: telemetry.sequence ?? null,
      timestamp: telemetry.timestamp,
      players: [],
      teams: [],
      zone: telemetry.zone,
      events: safeEvents,
      source: params.source,
      adapterKey,
      raw: telemetry.raw ?? {
        players: telemetry.players,
        teams: telemetry.teams,
      },
      structuralMirrorDisabled: true,
    });
    await this.prisma.matchTelemetry.upsert({
      where: { matchId },
      create: {
        matchId,
        payload: compatibilityPayload,
        zoneCenter: toJsonInput(telemetry.zone?.center ?? null),
        zoneRadius: telemetry.zone?.radius ?? null,
        zonePhaseIndex: telemetry.zone?.phase ?? null,
        zoneNextShrinkAt: telemetry.zone?.nextShrinkAt
          ? new Date(telemetry.zone.nextShrinkAt)
          : null,
      },
      update: {
        payload: compatibilityPayload,
        zoneCenter: toJsonInput(telemetry.zone?.center ?? null),
        zoneRadius: telemetry.zone?.radius ?? null,
        zonePhaseIndex: telemetry.zone?.phase ?? null,
        zoneNextShrinkAt: telemetry.zone?.nextShrinkAt
          ? new Date(telemetry.zone.nextShrinkAt)
          : null,
      },
    });

    await this.prisma.match.update({
      where: { id: matchId },
      data: { pcobLastSeenAt: new Date(telemetry.timestamp) },
    });

    const freshEvents: AdapterTelemetryEvent[] = [];
    for (const event of safeEvents) {
      const accepted = await this.rememberEvent(matchId, adapterKey, event);
      if (accepted) {
        freshEvents.push(event);
      }
    }

    const orgId =
      match.organizationId ??
      match.controlState?.organizationId ??
      match.tournament?.organizationId ??
      null;
    if (freshEvents.length > 0 && orgId) {
      await this.prisma.$transaction(async (tx) => {
        const currentSeq = await tx.matchEvent.aggregate({
          where: { matchId },
          _max: { seq: true },
        });
        let seq = currentSeq._max.seq ?? 0;

        await tx.matchEvent.createMany({
          data: freshEvents.map((event) => ({
            matchId,
            seq: ++seq,
            type: this.toMatchEventType(event.type),
            teamId:
              event.teamId ?? event.killerTeamId ?? event.victimTeamId ?? null,
            playerId:
              event.playerId ?? event.killerId ?? event.victimId ?? null,
            timestamp: new Date(event.timestamp),
            payload: toJsonInput({
              ...(event.payload ?? {}),
              source: params.source,
              adapterKey,
              eventType: event.type,
              dedupeKey: this.eventKey(matchId, adapterKey, event),
            }),
            rawPayload: toJsonInput(event.raw ?? event.payload ?? {}),
            organizationId: orgId,
          })),
        });
      });
    }

    return {
      mirrored: true,
      freshEventCount: freshEvents.length,
    };
  }

  private warnIfNullAdapter(
    matchId: string,
    adapter: GameAdapter,
    mode: 'push' | 'poll',
  ) {
    if (adapter.key !== 'null-adapter') {
      return;
    }
    const key = `${mode}:${matchId}`;
    if (this.nullAdapterWarnings.has(key)) {
      return;
    }
    this.nullAdapterWarnings.add(key);
    this.logger.warn(
      JSON.stringify({
        stage: 'game-adapter-telemetry',
        action: 'null-adapter-resolved',
        mode,
        boundMatchId: matchId,
        adapterKey: adapter.key,
        reason: 'NO_CANONICAL_PROVIDER_ADAPTER',
      }),
    );
  }

  private filterUnsafeCompatibilityEvents(
    telemetry: AdapterTelemetryEnvelope,
    context: {
      matchId: string;
      adapterKey: string;
      source: string;
    },
  ): AdapterTelemetryEvent[] {
    if (!this.isEarlyAirTelemetry(telemetry)) {
      return telemetry.events;
    }

    const safeEvents = telemetry.events.filter(
      (event) => event.type !== 'TEAM_ELIMINATED' && event.type !== 'KILL',
    );
    const blocked = telemetry.events.length - safeEvents.length;
    if (blocked > 0) {
      this.logger.warn(
        JSON.stringify({
          tag: '[ELIMINATION][BLOCKED]',
          stage: 'game-adapter-telemetry',
          action: 'compatibility-elimination-events-blocked',
          matchId: context.matchId,
          adapterKey: context.adapterKey,
          source: context.source,
          phase: telemetry.zone?.phase ?? null,
          blockedEvents: blocked,
          eventTypes: telemetry.events.map((event) => event.type),
          reason: 'EARLY_AIR_PHASE_COMPATIBILITY_EVENT_BLOCKED',
        }),
      );
    }
    return safeEvents;
  }

  private isEarlyAirTelemetry(telemetry: AdapterTelemetryEnvelope): boolean {
    const phase =
      typeof telemetry.zone?.phase === 'number' &&
      Number.isFinite(telemetry.zone.phase)
        ? Math.trunc(telemetry.zone.phase)
        : null;
    if (phase !== null && phase <= 1) {
      return true;
    }

    return this.rawContainsAirPhase(telemetry.raw);
  }

  private rawContainsAirPhase(value: unknown, depth = 0): boolean {
    if (value === null || value === undefined || depth > 3) {
      return false;
    }
    if (typeof value === 'string') {
      return /(plane|parachut|airborne|flight|jump)/i.test(value);
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return false;
    }
    if (Array.isArray(value)) {
      return value
        .slice(0, 12)
        .some((item) => this.rawContainsAirPhase(item, depth + 1));
    }
    if (typeof value !== 'object') {
      return false;
    }
    return Object.entries(value as Record<string, unknown>).some(
      ([key, entry]) =>
        (/(phase|state|status|stage|mode|flight|plane|parachut|jump)/i.test(
          key,
        ) ||
          /^(payload|data|raw|game|match|zone|circle|players?|teams?)$/i.test(
            key,
          )) &&
        this.rawContainsAirPhase(entry, depth + 1),
    );
  }

  private toMatchEventType(
    type: AdapterTelemetryEvent['type'],
  ): MatchEventType {
    switch (type) {
      case 'KILL':
        return MatchEventType.KILL;
      case 'TEAM_ELIMINATED':
        return MatchEventType.TEAM_PLACEMENT;
      case 'MATCH_START':
        return MatchEventType.MATCH_START;
      case 'MATCH_END':
        return MatchEventType.MATCH_END;
      default:
        return MatchEventType.PLAYER_STATE;
    }
  }

  private async rememberEvent(
    matchId: string,
    adapterKey: string,
    event: AdapterTelemetryEvent,
  ): Promise<boolean> {
    const dedupeKey = this.eventKey(matchId, adapterKey, event);
    const client = this.redis.getClient();
    if (client) {
      const result = await client.set(
        dedupeKey,
        '1',
        'EX',
        DEDUPE_TTL_SECONDS,
        'NX',
      );
      return result === 'OK';
    }

    const now = Date.now();
    const matchCache =
      this.memoryDedupe.get(matchId) ?? new Map<string, number>();
    this.memoryDedupe.set(matchId, matchCache);
    for (const [key, expiresAt] of matchCache.entries()) {
      if (expiresAt <= now) {
        matchCache.delete(key);
      }
    }
    if (matchCache.has(dedupeKey)) {
      return false;
    }
    matchCache.set(dedupeKey, now + DEDUPE_TTL_SECONDS * 1000);
    return true;
  }

  private eventKey(
    matchId: string,
    adapterKey: string,
    event: AdapterTelemetryEvent,
  ): string {
    if (event.dedupeKey && event.dedupeKey.trim().length > 0) {
      return `adapter:telemetry:${adapterKey}:${matchId}:${event.dedupeKey}`;
    }
    const payload = JSON.stringify({
      type: event.type,
      timestamp: event.timestamp,
      teamId: event.teamId ?? null,
      playerId: event.playerId ?? null,
      killerId: event.killerId ?? null,
      killerTeamId: event.killerTeamId ?? null,
      victimId: event.victimId ?? null,
      victimTeamId: event.victimTeamId ?? null,
      payload: event.payload ?? null,
    });
    return `adapter:telemetry:${adapterKey}:${matchId}:${payload}`;
  }
}
