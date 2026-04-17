import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { resolvePlayerPhoto } from '../../common/media-resolver';
import { PrismaService } from '../../db/prisma.service';
import { MatchStateClient, MatchStateSnapshot } from './match-state.client';
import { MappingStatus, PlayerSource, Prisma } from '@prisma/client';
import { OverlayGateway } from './overlay.gateway';
import { ResultsIngestService } from '../results/results-ingest.service';
import {
  TelemetrySourceRejectedException,
  enforceTelemetrySourceAllowed,
} from '../../common/telemetry-source.util';

type OverlaySnapshot = {
  matchId: string;
  ts: number;
  organizationId: string | null;
  teams: Array<{
    liveId: string | null;
    slot: number | null;
    name: string | null;
    tag: string | null;
    logoUrl: string | null;
    managedTeamId: string | null;
  }>;
  players: Array<{
    liveId: string | null;
    ign: string | null;
    teamLiveId: string | null;
    managedPlayerId: string | null;
    photoUrl: string | null;
  }>;
  circle: MatchStateSnapshot['circle'];
  raw: Record<string, unknown>;
};

const envFlagEnabled = (value: string | null | undefined): boolean => {
  const normalized = (value ?? '').trim().toLowerCase();
  return (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'on'
  );
};

@Injectable()
export class LiveSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('LiveSync');
  private timer: NodeJS.Timeout | null = null;
  private snapshot: OverlaySnapshot | null = null;
  private readonly client = new MatchStateClient();
  private resolvedMatchId: string | null = null;
  private resolvedOrgId: string | null = null;
  private warnedNoMatch = false;
  private prismaCooldownUntil = 0;
  private prismaWarned = false;
  private prismaAvailable = true;
  private readonly orgId: string | null =
    process.env.PCOB_ORG_ID ?? process.env.ORG_ID ?? null;
  private readonly legacyResultsWriteEnabled = envFlagEnabled(
    process.env.LIVE_SYNC_RESULTS_WRITE_ENABLED,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly overlay: OverlayGateway,
    private readonly results: ResultsIngestService,
  ) {}

  onModuleInit() {
    const interval = Math.max(
      500,
      Number(process.env.MATCH_STATE_POLL_INTERVAL_MS ?? 1000),
    );
    this.timer = setInterval(() => void this.tick(), interval);
    void this.tick();
    this.logger.log(`Live sync polling started @ ${interval}ms`);
    this.logger.log(
      this.legacyResultsWriteEnabled
        ? 'Live sync legacy official result writes ENABLED'
        : 'Live sync overlay-only mode active; official result writes disabled',
    );
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getSnapshot(matchId: string) {
    if (!this.snapshot || this.snapshot.matchId !== matchId) return null;
    return this.snapshot;
  }

  private async prismaReady(): Promise<boolean> {
    if (Date.now() < this.prismaCooldownUntil) {
      return this.prismaAvailable;
    }
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      this.prismaAvailable = true;
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (this.prismaAvailable || !this.prismaWarned) {
        this.logger.warn(`Prisma unavailable, backing off: ${msg}`);
      }
      this.prismaAvailable = false;
      this.prismaCooldownUntil = Date.now() + 30_000;
      this.prismaWarned = true;
      return false;
    }
  }

  private async tick() {
    const matchId = await this.resolveMatchId();
    if (!matchId) return;
    const state = await this.client.getState();
    if (!state) return;
    try {
      await enforceTelemetrySourceAllowed({
        prisma: this.prisma,
        logger: this.logger,
        matchId,
        incomingSource: 'API',
      });
    } catch (err) {
      if (err instanceof TelemetrySourceRejectedException) {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Live sync source enforcement failed: ${message}`);
      return;
    }
    try {
      await this.persist(matchId, state);
      if (this.legacyResultsWriteEnabled) {
        await this.results.ingest(matchId, state);
      }
      const snapshot = await this.buildSnapshot(matchId, state);
      this.snapshot = snapshot;
      this.overlay.broadcast(snapshot);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Live sync persistence failed: ${message}`);
      // Fallback: broadcast raw state without mappings
      const snapshot = this.buildSnapshotFromStateOnly(matchId, state);
      this.snapshot = snapshot;
      this.overlay.broadcast(snapshot);
    }
  }

  private async resolveMatchId(): Promise<string | null> {
    const envMatch = process.env.ACTIVE_MATCH_ID;
    if (envMatch) {
      this.resolvedMatchId = envMatch;
      if (!this.resolvedOrgId) {
        this.resolvedOrgId = await this.lookupOrg(envMatch);
      }
      return envMatch;
    }

    if (!(await this.prismaReady())) {
      return null;
    }
    if (Date.now() < this.prismaCooldownUntil) {
      return null;
    }

    if (this.resolvedMatchId) return this.resolvedMatchId;
    try {
      const live = await this.prisma.match.findFirst({
        where: {
          status: 'LIVE',
          deletedAt: null,
          ...(this.orgId ? { organizationId: this.orgId } : {}),
        },
        orderBy: { startedAt: 'desc' },
        select: {
          id: true,
          organizationId: true,
          tournament: { select: { organizationId: true } },
        },
      });
      if (live?.id) {
        this.resolvedMatchId = live.id;
        this.resolvedOrgId =
          this.orgId ??
          live.organizationId ??
          live.tournament?.organizationId ??
          null;
        this.logger.log(
          `LiveSync auto-selected match ${live.id} org=${this.resolvedOrgId ?? 'unknown'}`,
        );
        return live.id;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`LiveSync could not auto-select match: ${msg}`);
      this.prismaCooldownUntil = Date.now() + 30_000;
      if (!this.prismaWarned) {
        this.logger.warn('LiveSync pausing Prisma auto-select for 30s');
        this.prismaWarned = true;
      }
      return null;
    }

    this.prismaWarned = false;
    if (!this.warnedNoMatch) {
      this.logger.warn(
        'ACTIVE_MATCH_ID not set and no live match found; live sync idle',
      );
      this.warnedNoMatch = true;
    }
    return null;
  }

  private normalize(str?: string | null): string {
    return (str ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  }

  private async lookupOrg(matchId: string): Promise<string | null> {
    try {
      const match = await this.prisma.match.findFirst({
        where: { id: matchId, deletedAt: null },
        select: {
          organizationId: true,
          tournament: { select: { organizationId: true } },
        },
      });
      return match?.organizationId ?? match?.tournament?.organizationId ?? null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`LiveSync org lookup failed for ${matchId}: ${msg}`);
      return null;
    }
  }

  private async persist(matchId: string, state: MatchStateSnapshot) {
    // Upsert live teams
    for (const t of state.teams ?? []) {
      const liveId = t.id ?? null;
      await this.prisma.liveTeam.upsert({
        where: {
          matchId_liveId: {
            matchId,
            liveId,
          },
        },
        update: {
          name: t.name ?? null,
          tag: t.tag ?? null,
          slot: t.slot ?? null,
          logoUrl: t.logoUrl ?? null,
          raw: t as unknown as Prisma.JsonObject,
        },
        create: {
          matchId,
          liveId,
          name: t.name ?? null,
          tag: t.tag ?? null,
          slot: t.slot ?? null,
          logoUrl: t.logoUrl ?? null,
          raw: t as unknown as Prisma.JsonObject,
        },
      });
    }

    // Upsert live players
    for (const p of state.players ?? []) {
      const liveId = p.id ?? null;
      await this.prisma.livePlayer.upsert({
        where: {
          matchId_liveId: { matchId, liveId },
        },
        update: {
          ign: p.ign ?? p.name ?? null,
          name: p.name ?? p.ign ?? null,
          teamLiveId: p.teamId ?? null,
          photoUrl: p.photoUrl ?? null,
          raw: p as unknown as Prisma.JsonObject,
        },
        create: {
          matchId,
          liveId,
          ign: p.ign ?? p.name ?? null,
          name: p.name ?? p.ign ?? null,
          teamLiveId: p.teamId ?? null,
          photoUrl: p.photoUrl ?? null,
          raw: p as unknown as Prisma.JsonObject,
        },
      });
    }

    await this.autoMapTeams(matchId);
    await this.autoMapPlayers(matchId);
  }

  private async autoMapTeams(matchId: string) {
    const [liveTeams, teams] = await Promise.all([
      this.prisma.liveTeam.findMany({ where: { matchId } }),
      this.prisma.team.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, tag: true },
      }),
    ]);
    for (const lt of liveTeams) {
      const existing = await this.prisma.teamMapping.findUnique({
        where: { matchId_liveTeamId: { matchId, liveTeamId: lt.id } },
      });
      if (existing?.status === MappingStatus.LINKED) continue;

      const normTag = this.normalize(lt.tag);
      const normName = this.normalize(lt.name);
      const candidate = teams.find(
        (t) =>
          (normTag && this.normalize(t.tag) === normTag) ||
          (normName && this.normalize(t.name) === normName),
      );
      await this.prisma.teamMapping.upsert({
        where: { matchId_liveTeamId: { matchId, liveTeamId: lt.id } },
        create: {
          matchId,
          liveTeamId: lt.id,
          managedTeamId: candidate?.id ?? null,
          status: candidate ? MappingStatus.LINKED : MappingStatus.PENDING,
          confidence: candidate ? 0.9 : 0,
        },
        update: {
          managedTeamId: candidate?.id ?? null,
          status: candidate ? MappingStatus.LINKED : MappingStatus.PENDING,
          confidence: candidate ? 0.9 : 0,
        },
      });
    }
  }

  private async autoMapPlayers(matchId: string) {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        organizationId: true,
        tournament: { select: { organizationId: true } },
      },
    });
    const organizationId =
      match?.organizationId ?? match?.tournament?.organizationId ?? null;

    const [livePlayers, mappings, players] = await Promise.all([
      this.prisma.livePlayer.findMany({ where: { matchId } }),
      this.prisma.teamMapping.findMany({
        where: { matchId, status: MappingStatus.LINKED },
        select: { liveTeamId: true, managedTeamId: true },
      }),
      this.prisma.player.findMany({
        where: {
          deletedAt: null,
          ...(organizationId ? { organizationId } : {}),
        },
        select: {
          id: true,
          ign: true,
          teamId: true,
          photoUrl: true,
          externalId: true,
          externalPlayerId: true,
          playerOpenId: true,
        },
      }),
    ]);
    const teamMap = new Map(
      mappings.map((m) => [m.liveTeamId, m.managedTeamId]),
    );
    const playerByExternalId = new Map(
      players
        .filter((player) => player.playerOpenId ?? player.externalPlayerId)
        .map((player) => [
          (player.playerOpenId ?? player.externalPlayerId) as string,
          player,
        ]),
    );

    for (const lp of livePlayers) {
      const existing = await this.prisma.playerMapping.findUnique({
        where: { matchId_livePlayerId: { matchId, livePlayerId: lp.id } },
      });
      if (existing?.status === MappingStatus.LINKED) continue;

      const targetTeamId = lp.teamLiveId ? teamMap.get(lp.teamLiveId) : null;
      const externalPlayerId =
        typeof lp.liveId === 'string' && lp.liveId.trim().length > 0
          ? lp.liveId.trim()
          : null;
      let candidate = externalPlayerId
        ? playerByExternalId.get(externalPlayerId)
        : undefined;
      const resolvedIgn = lp.ign ?? lp.name ?? candidate?.ign ?? 'Player';

      if (!candidate && targetTeamId) {
        const normIgn = this.normalize(lp.ign ?? lp.name);
        candidate = players.find(
          (p) =>
            p.teamId === targetTeamId &&
            normIgn &&
            this.normalize(p.ign) === normIgn,
        );
      }

      if (candidate && externalPlayerId) {
        const needsUpdate =
          candidate.externalId !== externalPlayerId ||
          candidate.externalPlayerId !== externalPlayerId ||
          candidate.playerOpenId !== externalPlayerId ||
          candidate.ign !== resolvedIgn ||
          candidate.teamId !== (targetTeamId ?? null);
        if (needsUpdate) {
          candidate = await this.prisma.player.update({
            where: { id: candidate.id },
            data: {
              teamId: targetTeamId ?? undefined,
              ign: resolvedIgn,
              externalSource: 'PUBG_TELEMETRY',
              externalId: externalPlayerId,
              externalPlayerId,
              playerOpenId: externalPlayerId,
            },
            select: {
              id: true,
              ign: true,
              teamId: true,
              photoUrl: true,
              externalId: true,
              externalPlayerId: true,
              playerOpenId: true,
            },
          });
          playerByExternalId.set(externalPlayerId, candidate);
        }
      }

      if (
        organizationId &&
        externalPlayerId &&
        (!candidate || !(candidate.playerOpenId ?? candidate.externalPlayerId))
      ) {
        candidate = await this.prisma.player.upsert({
          where: { playerOpenId: externalPlayerId },
          create: {
            organizationId,
            teamId: targetTeamId ?? undefined,
            ign: resolvedIgn,
            photoUrl: resolvePlayerPhoto(null),
            source: PlayerSource.API,
            externalSource: 'PUBG_TELEMETRY',
            externalId: externalPlayerId,
            externalPlayerId,
            playerOpenId: externalPlayerId,
          },
          update: {
            teamId: targetTeamId ?? undefined,
            ign: resolvedIgn,
            externalSource: 'PUBG_TELEMETRY',
            externalId: externalPlayerId,
            externalPlayerId,
            playerOpenId: externalPlayerId,
          },
          select: {
            id: true,
            ign: true,
            teamId: true,
            photoUrl: true,
            externalId: true,
            externalPlayerId: true,
            playerOpenId: true,
          },
        });
        playerByExternalId.set(externalPlayerId, candidate);
      }

      await this.prisma.playerMapping.upsert({
        where: { matchId_livePlayerId: { matchId, livePlayerId: lp.id } },
        create: {
          matchId,
          livePlayerId: lp.id,
          managedPlayerId: candidate?.id ?? null,
          status: candidate ? MappingStatus.LINKED : MappingStatus.PENDING,
          confidence: candidate ? 0.9 : 0,
        },
        update: {
          managedPlayerId: candidate?.id ?? null,
          status: candidate ? MappingStatus.LINKED : MappingStatus.PENDING,
          confidence: candidate ? 0.9 : 0,
        },
      });
    }
  }

  private async buildSnapshot(
    matchId: string,
    state: MatchStateSnapshot,
  ): Promise<OverlaySnapshot> {
    const [liveTeams, mappings, livePlayers, playerMappings] =
      await Promise.all([
        this.prisma.liveTeam.findMany({ where: { matchId } }),
        this.prisma.teamMapping.findMany({ where: { matchId } }),
        this.prisma.livePlayer.findMany({ where: { matchId } }),
        this.prisma.playerMapping.findMany({ where: { matchId } }),
      ]);

    const teams = liveTeams.map((t) => {
      const mapping = mappings.find((m) => m.liveTeamId === t.id);
      return {
        liveId: t.liveId,
        slot: t.slot ?? null,
        name: t.name ?? null,
        tag: t.tag ?? null,
        logoUrl: t.logoUrl ?? null,
        managedTeamId: mapping?.managedTeamId ?? null,
      };
    });

    const players = livePlayers.map((p) => {
      const mapping = playerMappings.find((m) => m.livePlayerId === p.id);
      return {
        liveId: p.liveId,
        ign: p.ign ?? p.name ?? null,
        teamLiveId: p.teamLiveId ?? null,
        managedPlayerId: mapping?.managedPlayerId ?? null,
        photoUrl: p.photoUrl ?? null,
      };
    });

    return {
      matchId,
      ts: state.ts,
      organizationId: this.resolvedOrgId ?? this.orgId ?? null,
      teams,
      players,
      circle: state.circle,
      raw: state.raw ?? {},
    };
  }

  private buildSnapshotFromStateOnly(
    matchId: string,
    state: MatchStateSnapshot,
  ): OverlaySnapshot {
    const teams =
      (state.teams ?? []).map((t) => ({
        liveId: t.id ?? null,
        slot: t.slot ?? null,
        name: t.name ?? null,
        tag: t.tag ?? null,
        logoUrl: t.logoUrl ?? null,
        managedTeamId: null,
      })) ?? [];
    const players =
      (state.players ?? []).map((p) => ({
        liveId: p.id ?? null,
        ign: p.ign ?? p.name ?? null,
        teamLiveId: p.teamId ?? null,
        managedPlayerId: null,
        photoUrl: p.photoUrl ?? null,
      })) ?? [];
    return {
      matchId,
      ts: state.ts,
      organizationId: this.resolvedOrgId ?? this.orgId ?? null,
      teams,
      players,
      circle: state.circle,
      raw: state.raw ?? {},
    };
  }

  async mapTeam(matchId: string, liveTeamId: string, managedTeamId: string) {
    await this.prisma.teamMapping.upsert({
      where: { matchId_liveTeamId: { matchId, liveTeamId } },
      create: {
        matchId,
        liveTeamId,
        managedTeamId,
        status: MappingStatus.LINKED,
        confidence: 1,
      },
      update: {
        managedTeamId,
        status: MappingStatus.LINKED,
        confidence: 1,
      },
    });
    // refresh snapshot caches
    const state = this.snapshot;
    if (state && state.matchId === matchId) {
      this.snapshot = {
        ...state,
        teams: state.teams.map((t) =>
          t.liveId === liveTeamId ? { ...t, managedTeamId } : t,
        ),
      };
    }
  }

  async mapPlayer(
    matchId: string,
    livePlayerId: string,
    managedPlayerId: string,
  ) {
    await this.prisma.playerMapping.upsert({
      where: { matchId_livePlayerId: { matchId, livePlayerId } },
      create: {
        matchId,
        livePlayerId,
        managedPlayerId,
        status: MappingStatus.LINKED,
        confidence: 1,
      },
      update: {
        managedPlayerId,
        status: MappingStatus.LINKED,
        confidence: 1,
      },
    });
    // refresh snapshot caches
    const state = this.snapshot;
    if (state && state.matchId === matchId) {
      this.snapshot = {
        ...state,
        players: state.players.map((p) =>
          p.liveId === livePlayerId ? { ...p, managedPlayerId } : p,
        ),
      };
    }
  }
}
