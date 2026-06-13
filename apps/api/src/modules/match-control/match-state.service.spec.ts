import { BadRequestException } from '@nestjs/common';
import { MatchStatus, Role } from '@prisma/client';
import { MatchStateService } from './match-state.service';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../../db/prisma.service';
import type { ResultsService } from '../results/results.service';
import type { MatchControlService } from './match-control.service';

type ControlState = Parameters<MatchStateService['transition']>[1];

class MockAuditService {
  log = jest.fn().mockResolvedValue(undefined);
}

type MockMatchRow = {
  id: string;
  status: MatchStatus;
  endedAt: Date | null;
  tournament: { organizationId: string | null };
  dataSource?: string | null;
  pcobStatus?: string | null;
};

type MockControlStateRow = {
  id: string;
  matchId: string;
  state: ControlState;
  version: number;
  reason: string | null;
  metaJson: unknown;
  updatedAt: Date;
  updatedByUserId: string | null;
};

class MockPrisma {
  matches = new Map<string, MockMatchRow>();
  controlStates = new Map<string, MockControlStateRow>();

  match = {
    findUnique: ({
      where,
    }: {
      where: { id: string };
    }): Promise<MockMatchRow | null> =>
      Promise.resolve(this.matches.get(where.id) ?? null),
    findMany: (): Promise<MockMatchRow[]> =>
      Promise.resolve(Array.from(this.matches.values())),
    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<{ status: MatchStatus; endedAt: Date | null }>;
    }): Promise<MockMatchRow | null> => {
      const row = this.matches.get(where.id);
      if (!row) return Promise.resolve(null);
      const next: MockMatchRow = { ...row, ...data };
      this.matches.set(where.id, next);
      return Promise.resolve(next);
    },
  };

  matchControlState = {
    findUnique: ({
      where,
    }: {
      where: { matchId: string };
    }): Promise<MockControlStateRow | null> =>
      Promise.resolve(this.controlStates.get(where.matchId) ?? null),
    create: ({
      data,
    }: {
      data: { matchId: string; state: ControlState };
    }): Promise<MockControlStateRow> => {
      const now = new Date();
      const row: MockControlStateRow = {
        id: `mcs-${data.matchId}`,
        matchId: data.matchId,
        state: data.state,
        version: 0,
        reason: null,
        metaJson: null,
        updatedAt: now,
        updatedByUserId: null,
      };
      this.controlStates.set(data.matchId, row);
      return Promise.resolve(row);
    },
    update: ({
      where,
      data,
    }: {
      where: { matchId: string };
      data: Partial<{
        state: ControlState;
        version: number;
        reason: string | null;
        metaJson: unknown;
        updatedByUserId: string | null;
      }>;
    }): Promise<MockControlStateRow> => {
      const current = this.controlStates.get(where.matchId);
      if (!current) return Promise.reject(new Error('control state missing'));
      const next: MockControlStateRow = {
        ...current,
        ...data,
        updatedAt: new Date(),
      };
      this.controlStates.set(where.matchId, next);
      return Promise.resolve(next);
    },
  };

  group = {
    findMany: (): Promise<Array<{ id: string; matches: any[] }>> =>
      Promise.resolve([]),
  };

  async $transaction<T>(fn: (tx: this) => Promise<T> | T): Promise<T> {
    return await fn(this);
  }
}

const actor = {
  id: 'user-1',
  actorId: 'user-1',
  role: Role.SUPER_ADMIN,
  actorRole: Role.SUPER_ADMIN,
  organizationId: null,
  actingOrgId: null,
};

describe('MatchStateService transitions', () => {
  let prisma: MockPrisma;
  let service: MatchStateService;
  let audit: MockAuditService;

  beforeEach(() => {
    prisma = new MockPrisma();
    audit = new MockAuditService();
    const matchControl = {
      startMatch: jest.fn().mockImplementation((_actor, id: string) => {
        const row = prisma.controlStates.get(id);
        if (row) {
          prisma.controlStates.set(id, {
            ...row,
            state: 'LIVE',
            version: row.version + 1,
          });
        }
        const match = prisma.matches.get(id);
        if (match) {
          prisma.matches.set(id, { ...match, status: MatchStatus.LIVE });
        }
        return Promise.resolve(prisma.controlStates.get(id));
      }),
      setStatus: jest.fn().mockImplementation((_actor, id: string, dto) => {
        const row = prisma.controlStates.get(id);
        if (row) {
          prisma.controlStates.set(id, {
            ...row,
            state: dto.status,
            version: row.version + 1,
            reason: dto.reason ?? null,
            metaJson: dto.meta ?? row.metaJson,
          });
        }
        const match = prisma.matches.get(id);
        if (match) {
          const nextStatus =
            dto.status === 'LIVE' || dto.status === 'PAUSED'
              ? MatchStatus.LIVE
              : dto.status === 'FINISH_PENDING'
                ? MatchStatus.FINISH_PENDING
                : dto.status === 'ENDED'
                  ? MatchStatus.ENDED
                  : dto.status === 'CONFIRMED' || dto.status === 'FINISHED'
                    ? MatchStatus.FINISHED
                    : MatchStatus.DRAFT;
          prisma.matches.set(id, { ...match, status: nextStatus });
        }
        return Promise.resolve(prisma.controlStates.get(id));
      }),
    };
    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResultsService;
    service = new MatchStateService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      results,
      matchControl as unknown as MatchControlService,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    prisma.matches.set('m1', {
      id: 'm1',
      status: MatchStatus.DRAFT,
      endedAt: null,
      tournament: { organizationId: 'org-1' },
      dataSource: 'MANUAL',
      pcobStatus: 'PENDING',
    });
  });

  it('allows READY -> LIVE and updates business status', async () => {
    prisma.controlStates.set('m1', {
      id: 'mcs-m1',
      matchId: 'm1',
      state: 'READY',
      version: 0,
      reason: null,
      metaJson: null,
      updatedAt: new Date(),
      updatedByUserId: null,
    });

    const res = await service.transition('m1', 'LIVE', actor, null, null);

    expect(res.state).toBe('LIVE');
    expect(res.version).toBe(1);
    expect(prisma.matches.get('m1')?.status).toBe(MatchStatus.LIVE);
  });

  it('allows LIVE -> READY transition and resets business status to DRAFT', async () => {
    prisma.controlStates.set('m1', {
      id: 'mcs-m1',
      matchId: 'm1',
      state: 'LIVE',
      version: 3,
      reason: null,
      metaJson: null,
      updatedAt: new Date(),
      updatedByUserId: null,
    });
    prisma.matches.set('m1', {
      ...prisma.matches.get('m1')!,
      status: MatchStatus.LIVE,
      endedAt: null,
    });

    const res = await service.transition('m1', 'READY', actor, null, null);

    expect(res.state).toBe('READY');
    expect(res.version).toBe(4);
    expect(prisma.matches.get('m1')?.status).toBe(MatchStatus.DRAFT);
  });

  it('allows FINISH_PENDING -> FINISHED and promotes business status to FINISHED', async () => {
    prisma.controlStates.set('m1', {
      id: 'mcs-m1',
      matchId: 'm1',
      state: 'FINISH_PENDING',
      version: 2,
      reason: null,
      metaJson: null,
      updatedAt: new Date(),
      updatedByUserId: null,
    });
    prisma.matches.set('m1', {
      ...prisma.matches.get('m1')!,
      status: MatchStatus.FINISH_PENDING,
      endedAt: new Date(),
    });

    const res = await service.transition(
      'm1',
      'FINISHED',
      actor,
      'finalize',
      null,
    );

    expect(res.state).toBe('FINISHED');
    expect(res.version).toBe(3);
    expect(prisma.matches.get('m1')?.status).toBe(MatchStatus.FINISHED);
  });

  it('rejects LIVE -> CONFIRMED transition', async () => {
    prisma.controlStates.set('m1', {
      id: 'mcs-m1',
      matchId: 'm1',
      state: 'LIVE',
      version: 4,
      reason: null,
      metaJson: null,
      updatedAt: new Date(),
      updatedByUserId: null,
    });
    prisma.matches.set('m1', {
      ...prisma.matches.get('m1')!,
      status: MatchStatus.LIVE,
      endedAt: null,
    });

    await expect(
      service.transition('m1', 'CONFIRMED', actor, 'confirm', null),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
