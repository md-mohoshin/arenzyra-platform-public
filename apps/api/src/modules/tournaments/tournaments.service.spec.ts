import { Role } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth.types';
import { TournamentsService } from './tournaments.service';
import type { PrismaService } from '../../db/prisma.service';
import type { LiveService } from '../live/live.service';
import type { RealtimeGateway } from '../../realtime/realtime.gateway';
import type { PcobNamespaceGateway } from '../../realtime/pcob-namespace.gateway';
import type { MatchControlStateStore } from '../match-control/state.store';
import type { OverlayBroadcaster } from '../realtime/overlay-broadcaster.service';
import type { MatchStateCache } from '../pcob/match-state-cache.service';

type TournamentRow = {
  id: string;
  organizationId: string;
  ownerUserId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
};

class PrismaMock {
  tournaments: TournamentRow[] = [
    {
      id: 't-1',
      organizationId: 'org-a',
      ownerUserId: 'owner-a',
      name: 'Tournament A',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 't-2',
      organizationId: 'org-a',
      ownerUserId: 'owner-b',
      name: 'Tournament B',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
  stages = [
    { id: 's-1', tournamentId: 't-1' },
    { id: 's-2', tournamentId: 't-2' },
  ];
  groups = [
    { id: 'g-1', stageId: 's-1' },
    { id: 'g-2', stageId: 's-2' },
  ];
  matches = [
    { id: 'm-1', tournamentId: 't-1', stageId: 's-1', groupId: 'g-1' },
    { id: 'm-2', tournamentId: 't-2', stageId: 's-2', groupId: 'g-2' },
  ];
  matchSlotResults = [
    { id: 'r-1', matchId: 'm-1' },
    { id: 'r-2', matchId: 'm-2' },
  ];
  standingsSnapshots = [
    { id: 'ss-1', scope: 'TOURNAMENT', scopeId: 't-1' },
    { id: 'ss-2', scope: 'TOURNAMENT', scopeId: 't-2' },
    { id: 'ss-3', scope: 'STAGE', scopeId: 's-1' },
    { id: 'ss-4', scope: 'GROUP', scopeId: 'g-1' },
  ];
  widgets = [{ id: 'widget-1', organizationId: 'org-a' }];
  auditLogs: unknown[] = [];

  tournament = {
    findFirst: (args: { where: { id: string } }) =>
      Promise.resolve(
        this.tournaments.find((t) => t.id === args.where.id) ?? null,
      ),
    update: (args: { where: { id: string }; data: { deletedAt?: Date } }) => {
      const idx = this.tournaments.findIndex((t) => t.id === args.where.id);
      if (idx === -1) throw new Error('tournament not found');
      const updated = {
        ...this.tournaments[idx],
        ...args.data,
      } as TournamentRow & { deletedAt?: Date };
      this.tournaments[idx] = updated;
      return Promise.resolve(updated);
    },
    delete: (args: { where: { id: string } }) => {
      const id = args.where.id;
      const idx = this.tournaments.findIndex((t) => t.id === id);
      if (idx === -1) throw new Error('tournament not found');
      const [deleted] = this.tournaments.splice(idx, 1);

      const stageIds = this.stages
        .filter((s) => s.tournamentId === id)
        .map((s) => s.id);
      const matchIds = this.matches
        .filter((m) => m.tournamentId === id)
        .map((m) => m.id);

      this.stages = this.stages.filter((s) => s.tournamentId !== id);
      this.groups = this.groups.filter((g) => !stageIds.includes(g.stageId));
      this.matches = this.matches.filter((m) => m.tournamentId !== id);
      this.matchSlotResults = this.matchSlotResults.filter(
        (r) => !matchIds.includes(r.matchId),
      );

      return Promise.resolve(deleted);
    },
  };

  stage = {
    findMany: (args: {
      where: { tournamentId: string };
      select?: { groups?: boolean };
    }) => {
      const filtered = this.stages.filter(
        (s) => s.tournamentId === args.where.tournamentId,
      );
      if (args.select?.groups) {
        return Promise.resolve(
          filtered.map((s) => ({
            id: s.id,
            groups: this.groups
              .filter((g) => g.stageId === s.id)
              .map((g) => ({ id: g.id })),
          })),
        );
      }
      return Promise.resolve(filtered);
    },
  };

  match = {
    findMany: (args: {
      where: { tournamentId: string };
      select?: { id?: boolean };
    }) => {
      const filtered = this.matches.filter(
        (m) => m.tournamentId === args.where.tournamentId,
      );
      if (args.select?.id)
        return Promise.resolve(filtered.map((m) => ({ id: m.id })));
      return Promise.resolve(filtered);
    },
  };

  standingsSnapshot = {
    deleteMany: (args: {
      where: { scope: string; scopeId: string | { in: string[] } };
    }) => {
      const before = this.standingsSnapshots.length;
      this.standingsSnapshots = this.standingsSnapshots.filter((row) => {
        if (row.scope !== args.where.scope) return true;
        const scopeId = args.where.scopeId as
          | string
          | { in: string[] }
          | undefined;
        if (typeof scopeId === 'string') return row.scopeId !== scopeId;
        if (scopeId?.in) return !scopeId.in.includes(row.scopeId);
        return true;
      });
      return Promise.resolve({
        count: before - this.standingsSnapshots.length,
      });
    },
  };

  auditLog = {
    create: (args: { data: unknown }) => {
      this.auditLogs.push(args.data);
      return Promise.resolve(args.data);
    },
    deleteMany: (args: {
      where: { entityId: { in: string[] }; entityType?: { in?: string[] } };
    }) => {
      const before = this.auditLogs.length;
      this.auditLogs = this.auditLogs.filter((row) => {
        const entityId = (row as { entityId?: string | null })?.entityId;
        if (!entityId) return true;
        const ids = args.where.entityId?.in ?? [];
        if (ids.includes(entityId)) {
          if (args.where.entityType?.in) {
            const etype = (row as { entityType?: string })?.entityType;
            return !args.where.entityType.in.includes(etype ?? '');
          }
          return false;
        }
        return true;
      });
      return Promise.resolve({ count: before - this.auditLogs.length });
    },
  };

  $transaction = (ops: Array<Promise<unknown>>) => Promise.all(ops);
}

class LiveMock {
  cleared: string[] = [];
  clearTournament = (tournamentId: string) => {
    this.cleared.push(tournamentId);
    return Promise.resolve();
  };
}

class RealtimeMock implements Partial<RealtimeGateway> {
  events: Array<{
    organizationId: string | null | undefined;
    tournamentId: string;
  }> = [];
  emitTournamentDeleted(
    organizationId: string | null | undefined,
    tournamentId: string,
  ) {
    this.events.push({ organizationId, tournamentId });
  }
}

class PcobGatewayMock implements Partial<PcobNamespaceGateway> {
  disconnects: Array<{ matchIds: string[]; organizationId?: string | null }> =
    [];
  disconnectTournamentMatches(
    matchIds: string[],
    organizationId?: string | null,
  ) {
    this.disconnects.push({ matchIds, organizationId });
  }
}

class MatchControlStateStoreMock {
  evicted: string[][] = [];
  evictMatches = (matchIds: string[]) => {
    this.evicted.push(matchIds);
    return Promise.resolve();
  };
}

class OverlayBroadcasterMock implements Partial<OverlayBroadcaster> {
  evicted: Array<{ ids: string[]; organizationId?: string | null }> = [];
  evictMatches(ids: string[], organizationId?: string | null) {
    this.evicted.push({ ids, organizationId });
  }
}

class MatchStateCacheMock implements Partial<MatchStateCache> {
  evicted: string[][] = [];
  evict(ids: string[]) {
    this.evicted.push(ids);
  }
}

const actor: AuthUser = {
  id: 'owner-a',
  actorId: 'owner-a',
  role: Role.ADMIN,
  actorRole: null,
  organizationId: 'org-a',
  actingOrgId: 'org-a',
  actingRole: null,
  actingOrgName: null,
  actingAsUserId: null,
  realRole: Role.ADMIN,
};

describe('TournamentsService.deleteTournament', () => {
  const makeService = () => {
    const prisma = new PrismaMock();
    const live = new LiveMock();
    const realtime = new RealtimeMock();
    const pcobGateway = new PcobGatewayMock();
    const matchControlStore = new MatchControlStateStoreMock();
    const overlay = new OverlayBroadcasterMock();
    const matchStateCache = new MatchStateCacheMock();
    const svc = new TournamentsService(
      prisma as unknown as PrismaService,
      live as unknown as LiveService,
      realtime as unknown as RealtimeGateway,
      pcobGateway as unknown as PcobNamespaceGateway,
      matchControlStore as unknown as MatchControlStateStore,
      overlay as unknown as OverlayBroadcaster,
      matchStateCache as unknown as MatchStateCache,
    );
    return {
      prisma,
      live,
      realtime,
      pcobGateway,
      matchControlStore,
      overlay,
      matchStateCache,
      svc,
    };
  };

  it('deletes tournament and cascades matches and results', async () => {
    const { svc, prisma } = makeService();
    await svc.deleteTournament(
      't-1',
      actor,
      { confirm: 'DELETE TOURNAMENT' },
      'org-a',
    );
    const deleted = prisma.tournaments.find((t) => t.id === 't-1');
    expect(deleted?.deletedAt).toBeInstanceOf(Date);
    // Soft delete only; records remain but downstream caches cleared.
    expect(prisma.matches.some((m) => m.tournamentId === 't-1')).toBe(true);
    expect(prisma.matchSlotResults.some((r) => r.matchId === 'm-1')).toBe(true);
  });

  it('keeps other tournaments and org assets untouched', async () => {
    const { svc, prisma } = makeService();
    await svc.deleteTournament(
      't-1',
      actor,
      { confirm: 'DELETE TOURNAMENT' },
      'org-a',
    );
    expect(prisma.tournaments.some((t) => t.id === 't-2')).toBe(true);
    expect(prisma.matches.some((m) => m.id === 'm-2')).toBe(true);
    expect(prisma.matchSlotResults.some((r) => r.id === 'r-2')).toBe(true);
    expect(prisma.widgets.length).toBe(1);
  });

  it('clears caches and emits deletion events', async () => {
    const {
      svc,
      live,
      realtime,
      pcobGateway,
      matchControlStore,
      overlay,
      matchStateCache,
    } = makeService();

    await svc.deleteTournament(
      't-1',
      actor,
      { confirm: 'DELETE TOURNAMENT' },
      'org-a',
    );

    expect(live.cleared).toContain('t-1');
    expect(realtime.events).toContainEqual({
      organizationId: 'org-a',
      tournamentId: 't-1',
    });
    expect(pcobGateway.disconnects[0]).toMatchObject({
      organizationId: 'org-a',
    });
    expect(matchControlStore.evicted[0]).toContain('m-1');
    expect(overlay.evicted[0]).toMatchObject({ organizationId: 'org-a' });
    expect(matchStateCache.evicted[0]).toContain('m-1');
  });
});
