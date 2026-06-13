import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { PcobGateway } from './pcob.gateway';
import { RedisService } from '../../redis/redis.service';
import { PcobHealthService } from './pcob-health.service';
import { PcobTelemetryPayload } from './pcob.types';
import { requireOrgMatch } from '../../common/org/org.util';
import { deriveControlLiveState } from '../../common/live-state.util';
import { hasLegacyPcobControlSignal } from '../../common/pcob-binding.util';

const LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes

type MatchWithRelations = Prisma.MatchGetPayload<{
  include: {
    matchSlots: { include: { team: true } };
    group: true;
    tournament: true;
    controlState: { select: { state: true } };
  };
}>;

type FeedLock = Prisma.FeedLockGetPayload<{
  select: { id: true; matchId: true; clientId: true; expiresAt: true };
}>;

type PcobTeamPayload = {
  slot?: number | string | null;
  teamTag?: string | null;
  players?: PcobPlayerPayload[];
};

type PcobPlayerPayload = {
  pubgPlayerId?: string | null;
  ign?: string | null;
  [key: string]: unknown;
};

type PcobFeedPayload = {
  pcobMatchId?: string | null;
  teams?: PcobTeamPayload[];
  [key: string]: unknown;
};

const isRecord = (val: unknown): val is Record<string, unknown> =>
  !!val && typeof val === 'object';

@Injectable()
export class PcobService implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private gateway: PcobGateway,
    private redis: RedisService,
    private health: PcobHealthService,
  ) {}

  onModuleInit() {
    void this.redis.subscribe('pcob:telemetry', (msg: unknown) => {
      const parsed = isRecord(msg)
        ? {
            matchId: typeof msg.matchId === 'string' ? msg.matchId : null,
            payload: msg.payload as PcobTelemetryPayload | undefined,
          }
        : { matchId: null, payload: undefined };
      if (!parsed.matchId || !parsed.payload) return;
      this.gateway.broadcastTelemetry(parsed.matchId, parsed.payload);
    });
  }

  private async ensureMatch(
    orgId: string,
    matchId: string,
  ): Promise<MatchWithRelations> {
    const match = await this.prisma.match.findFirst({
      where: {
        id: matchId,
        tournament: { organizationId: orgId },
        deletedAt: null,
      },
      include: {
        matchSlots: {
          include: { team: true },
        },
        group: true,
        tournament: true,
        controlState: { select: { state: true } },
      },
    });
    if (!match) throw new BadRequestException('Match not found');
    if (!match.tournament) {
      throw new BadRequestException(
        'Session matches are not supported by PCOB telemetry',
      );
    }
    if (!match.groupId) {
      throw new BadRequestException(
        'Match must belong to a group for telemetry',
      );
    }
    requireOrgMatch(
      {
        organizationId: match.tournament.organizationId,
        actingOrgId: null,
        role: null,
        actorRole: null,
      },
      orgId,
    );
    return match;
  }

  private isLegacyPcobControlMatch(match: {
    dataSource?: string | null;
    dataMode?: string | null;
    pcobSessionId?: string | null;
    pcobMode?: boolean | null;
    adapterKey?: string | null;
  }): boolean {
    return hasLegacyPcobControlSignal(match);
  }

  private assertLegacyPcobControlMatch(match: {
    dataSource?: string | null;
    dataMode?: string | null;
    pcobSessionId?: string | null;
    pcobMode?: boolean | null;
    adapterKey?: string | null;
  }) {
    if (this.isLegacyPcobControlMatch(match)) {
      return;
    }
    throw new BadRequestException(
      'Legacy PCOB control is disabled for API and MANUAL matches',
    );
  }

  async bind(
    orgId: string,
    matchId: string,
    clientId: string,
    sessionId: string,
  ): Promise<{
    ok: true;
    matchId: string;
    pcobSessionId: string;
    boundAt: Date;
    expiresAt: Date | null;
  }> {
    requireOrgMatch(
      { organizationId: orgId, actingOrgId: null, role: null, actorRole: null },
      orgId,
    );
    if (!sessionId) throw new BadRequestException('pcobSessionId is required');
    const match = await this.ensureMatch(orgId, matchId);
    if (deriveControlLiveState(match.controlState?.state ?? null) !== 'LIVE') {
      throw new BadRequestException('Match must be LIVE to bind PCOB');
    }
    this.assertLegacyPcobControlMatch(match);
    if (!match.pcobSessionId || match.pcobSessionId !== sessionId) {
      throw new BadRequestException('Session ID mismatch');
    }
    const lock = await this.startFeed(orgId, matchId, clientId);
    const boundAt = new Date();
    await this.prisma.match.update({
      where: { id: matchId },
      data: { pcobBoundAt: boundAt },
    });
    this.health.setClient(matchId, clientId);
    return {
      ok: true,
      matchId,
      pcobSessionId: sessionId,
      boundAt,
      expiresAt: lock?.expiresAt ?? null,
    };
  }

  async startFeed(
    orgId: string,
    matchId: string,
    clientId: string,
  ): Promise<{ ok: true; expiresAt: Date }> {
    const match = await this.ensureMatch(orgId, matchId);
    this.assertLegacyPcobControlMatch(match);
    const existing = await this.prisma.feedLock.findUnique({
      where: { id: 'singleton' },
    });
    const now = new Date();
    if (
      existing &&
      existing.expiresAt > now &&
      existing.clientId !== clientId
    ) {
      throw new ForbiddenException('Feed is locked by another client');
    }
    const expiresAt = new Date(Date.now() + LOCK_TTL_MS);
    await this.prisma.feedLock.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', matchId, clientId, lockedAt: now, expiresAt },
      update: { matchId, clientId, lockedAt: now, expiresAt },
    });
    return { ok: true, expiresAt };
  }

  async stopFeed(clientId: string): Promise<{ ok: true }> {
    const existing = await this.prisma.feedLock.findUnique({
      where: { id: 'singleton' },
    });
    if (
      existing &&
      existing.clientId !== clientId &&
      existing.expiresAt > new Date()
    ) {
      throw new ForbiddenException('Cannot stop feed locked by another client');
    }
    await this.prisma.feedLock.deleteMany({ where: { id: 'singleton' } });
    return { ok: true };
  }

  async ensureLock(clientId: string, matchId: string): Promise<FeedLock> {
    const lock = await this.prisma.feedLock.findUnique({
      where: { id: 'singleton' },
    });
    if (!lock) throw new ForbiddenException('Feed is not locked');
    if (lock.expiresAt < new Date()) {
      throw new ForbiddenException('Feed lock expired');
    }
    if (lock.clientId !== clientId)
      throw new ForbiddenException('Feed locked by another client');
    if (lock.matchId !== matchId)
      throw new BadRequestException('Match mismatch for telemetry');
    return lock;
  }

  async telemetry(
    orgId: string,
    matchId: string,
    clientId: string,
    payload: PcobFeedPayload,
  ): Promise<{ ok: true; expiresAt: Date }> {
    await this.ensureLock(clientId, matchId);
    const match = await this.ensureMatch(orgId, matchId);
    this.assertLegacyPcobControlMatch(match);

    const slotMap = new Map<number, string>();
    match.matchSlots.forEach((s) => {
      if (s.slotNumber) slotMap.set(s.slotNumber, s.teamId ?? '');
    });

    // Upsert latest telemetry per match
    await this.prisma.matchTelemetry.upsert({
      where: { matchId },
      create: { matchId, payload: payload as Prisma.InputJsonValue },
      update: { payload: payload as Prisma.InputJsonValue },
    });

    await this.ingestPlayersFromPcob(orgId, match, payload, slotMap);
    await this.redis.publish('pcob:telemetry', { matchId, payload });

    // Auto-extend lock on telemetry
    const expiresAt = new Date(Date.now() + LOCK_TTL_MS);
    await this.prisma.feedLock.update({
      where: { id: 'singleton' },
      data: { expiresAt, lockedAt: new Date() },
    });

    return { ok: true, expiresAt };
  }

  async syncPlayers(orgId: string, matchId: string, _body: unknown) {
    void _body;
    const match = await this.ensureMatch(orgId, matchId);
    this.assertLegacyPcobControlMatch(match);
    if (deriveControlLiveState(match.controlState?.state ?? null) === 'LIVE') {
      throw new BadRequestException('Cannot sync during live match');
    }
    // Stub: perform name/IGN updates as needed
    return { ok: true };
  }

  async syncTeams(orgId: string, matchId: string, _body: unknown) {
    void _body;
    const match = await this.ensureMatch(orgId, matchId);
    this.assertLegacyPcobControlMatch(match);
    if (deriveControlLiveState(match.controlState?.state ?? null) === 'LIVE') {
      throw new BadRequestException('Cannot sync during live match');
    }
    // Stub: perform team name updates as needed
    return { ok: true };
  }

  async latest(
    orgId: string,
    matchId: string,
    eventCount = 0,
  ): Promise<{
    matchId: string;
    payload: Prisma.JsonValue | null;
    eventCount: number;
    lastSeenAt: Date | null;
  }> {
    const match = await this.ensureMatch(orgId, matchId);
    const row = await this.prisma.matchTelemetry.findUnique({
      where: { matchId },
    });
    const payload = row?.payload ?? null;
    const lastSeenAt = match.pcobLastSeenAt ?? null;
    return { matchId, payload, eventCount, lastSeenAt };
  }

  private async ingestPlayersFromPcob(
    orgId: string,
    match: MatchWithRelations,
    payload: PcobFeedPayload,
    slotMap: Map<number, string>,
  ) {
    if (!Array.isArray(payload?.teams)) return;
    const now = new Date();
    const isLive =
      deriveControlLiveState(match.controlState?.state ?? null) === 'LIVE';

    for (const team of payload.teams) {
      const slot = Number(team?.slot);
      const teamId = slotMap.get(slot);
      const teamTag = team?.teamTag ?? null;

      if (!Array.isArray(team?.players)) continue;

      for (const player of team.players) {
        const pubgPlayerId = player?.pubgPlayerId ?? null;
        const ign = player?.ign ?? null;

        const rosterPlayer = await this.findRosterPlayer(
          orgId,
          teamId,
          pubgPlayerId,
          ign,
        );

        if (rosterPlayer && !isLive) {
          if (
            !rosterPlayer.pubgPlayerId &&
            pubgPlayerId &&
            rosterPlayer.pubgIdSource !== 'MANUAL'
          ) {
            await this.prisma.player.update({
              where: { id: rosterPlayer.id },
              data: { pubgPlayerId, pubgIdSource: 'PCOB' },
            });
          }
          if (rosterPlayer.ignSource !== 'MANUAL') {
            await this.prisma.player.update({
              where: { id: rosterPlayer.id },
              data: { ignSource: 'PCOB' },
            });
          }
        } else if (!rosterPlayer && ign) {
          await this.prisma.pcobUnmatchedPlayer.upsert({
            where: {
              matchId_slot_ign: {
                matchId: match.id,
                slot: slot || 0,
                ign,
              },
            },
            create: {
              matchId: match.id,
              pcobMatchId: payload?.pcobMatchId ?? null,
              slot: slot || 0,
              pubgPlayerId,
              ign,
              teamTag,
              firstSeenAt: now,
              lastSeenAt: now,
              rawPayload: player as Prisma.InputJsonValue,
            },
            update: {
              lastSeenAt: now,
              rawPayload: player as Prisma.InputJsonValue,
            },
          });
        }
      }
    }
  }

  private async findRosterPlayer(
    orgId: string,
    teamId: string | undefined,
    pubgPlayerId: string | null,
    ign: string | null,
  ) {
    if (teamId && pubgPlayerId) {
      const player = await this.prisma.player.findFirst({
        where: {
          organizationId: orgId,
          teamId,
          pubgPlayerId,
          deletedAt: null,
        },
      });
      if (player) return player;
    }
    if (teamId && ign) {
      return this.prisma.player.findFirst({
        where: {
          organizationId: orgId,
          teamId,
          ign,
          deletedAt: null,
        },
      });
    }
    return null;
  }
}
