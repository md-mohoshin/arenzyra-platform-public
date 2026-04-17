import { MatchDataSource, MatchStatus } from '@prisma/client';
import { OrgMatchControlController } from './org-match-control.controller';

describe('OrgMatchControlController', () => {
  const actor = {
    id: 'user-1',
    actorId: 'user-1',
    role: 'ORGANIZER',
    actorRole: 'ORGANIZER',
    organizationId: 'org-1',
    actingOrgId: 'org-1',
  } as any;

  const makeMatch = (overrides?: Record<string, unknown>) => ({
    id: 'match-1',
    dataSource: MatchDataSource.MANUAL,
    dataMode: 'MANUAL',
    status: MatchStatus.ENDED,
    liveState: 'ENDED',
    controlState: {
      state: 'ENDED',
      metaJson: null,
      resultsManualLock: false,
      resultsForceUnlock: false,
    },
    tournament: {
      organizationId: 'org-1',
      ownerUserId: 'user-1',
    },
    ...overrides,
  });

  const createController = (match: Record<string, unknown>) => {
    const typedMatch = match as any;
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue(typedMatch),
      },
      matchControlState: {
        upsert: jest.fn().mockImplementation(async ({ update, create }) => ({
          matchId: 'match-1',
          state: typedMatch.controlState?.state ?? 'READY',
          resultsManualLock:
            update?.resultsManualLock ?? create?.resultsManualLock ?? false,
          resultsForceUnlock:
            update?.resultsForceUnlock ?? create?.resultsForceUnlock ?? false,
        })),
      },
      auditLog: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    } as any;

    const audit = {
      log: jest.fn().mockResolvedValue(undefined),
    } as any;

    const controller = new OrgMatchControlController(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      audit,
    );

    return { controller, prisma, audit };
  };

  it('reports ENDED but not finalized matches as unlocked', async () => {
    const { controller } = createController(makeMatch());

    await expect(
      controller.getControl('org-1', 'match-1', { user: actor } as any),
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        control: expect.objectContaining({
          lifecycleStatus: 'ENDED',
          resultsLocked: false,
          lockState: 'UNLOCKED',
        }),
      }),
    );
  });

  it('reports FINISHED matches as locked', async () => {
    const { controller } = createController(
      makeMatch({
        dataSource: MatchDataSource.PCOB,
        dataMode: 'AUTO',
        status: MatchStatus.FINISHED,
        controlState: {
          state: 'CONFIRMED',
          metaJson: { resultFinalized: true },
          resultsManualLock: false,
          resultsForceUnlock: false,
        },
      }),
    );

    await expect(
      controller.getControl('org-1', 'match-1', { user: actor } as any),
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        control: expect.objectContaining({
          lifecycleStatus: 'FINISHED',
          resultsLocked: true,
          lockState: 'LOCKED',
        }),
      }),
    );
  });

  it('returns canonical telemetry provider and PCOB readiness flags in control reads', async () => {
    const { controller } = createController(
      makeMatch({
        dataSource: MatchDataSource.PCOB,
        dataMode: 'PCOB',
        pcobSessionId: 'session-1',
        pcobMode: true,
        pcobBoundAt: new Date('2026-04-01T10:00:00.000Z'),
        pcobLastSeenAt: new Date('2026-04-01T10:01:00.000Z'),
        adapterKey: 'pubgm-pcob',
        status: MatchStatus.LIVE,
        liveState: 'LIVE',
        controlState: {
          state: 'LIVE',
          metaJson: null,
          resultsManualLock: false,
          resultsForceUnlock: false,
        },
      }),
    );

    await expect(
      controller.getControl('org-1', 'match-1', { user: actor } as any),
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        control: expect.objectContaining({
          telemetryProvider: MatchDataSource.PCOB,
          sourceMode: 'AUTO',
          adapterKey: 'pubgm-pcob',
          pcobConfigured: true,
          pcobBound: true,
          pcobReady: true,
        }),
      }),
    );
  });

  it('rejects explicit results unlock before automatic results are finalized', async () => {
    const { controller, prisma } = createController(
      makeMatch({
        dataSource: MatchDataSource.PCOB,
        dataMode: 'MANUAL',
        status: MatchStatus.LIVE,
        liveState: 'LIVE',
        controlState: {
          state: 'LIVE',
          metaJson: null,
          resultsManualLock: false,
          resultsForceUnlock: false,
        },
      }),
    );

    await expect(
      controller.resultsLock('org-1', 'match-1', { user: actor } as any, false),
    ).rejects.toThrow(
      'Automatic results can only be reopened after finalization.',
    );

    expect(prisma.matchControlState.upsert).not.toHaveBeenCalled();
  });

  it('allows explicit results unlock after automatic results are finalized', async () => {
    const { controller, prisma } = createController(
      makeMatch({
        dataSource: MatchDataSource.PCOB,
        dataMode: 'MANUAL',
        status: MatchStatus.FINISHED,
        liveState: 'ENDED',
        controlState: {
          state: 'CONFIRMED',
          metaJson: { resultFinalized: true },
          resultsManualLock: false,
          resultsForceUnlock: false,
        },
      }),
    );

    await expect(
      controller.resultsLock('org-1', 'match-1', { user: actor } as any, false),
    ).resolves.toEqual({
      ok: true,
      locked: false,
      lockState: 'UNLOCKED',
    });

    expect(prisma.matchControlState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          resultsManualLock: false,
          resultsForceUnlock: true,
        }),
        create: expect.objectContaining({
          resultsManualLock: false,
          resultsForceUnlock: true,
        }),
      }),
    );
  });
});
