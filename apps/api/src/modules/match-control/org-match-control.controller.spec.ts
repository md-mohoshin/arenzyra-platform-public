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
    organizationId: 'org-1',
    sessionId: null,
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
    const matches = {
      setDataSource: jest.fn().mockResolvedValue(undefined),
    } as any;
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
      matches,
      {} as any,
      {} as any,
      audit,
    );

    return { controller, prisma, audit, matches };
  };

  it('reports finish-pending but not finalized matches as unlocked', async () => {
    const { controller } = createController(makeMatch());

    await expect(
      controller.getControl('org-1', 'match-1', { user: actor } as any),
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        control: expect.objectContaining({
          lifecycleStatus: 'FINISH_PENDING',
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

  it('returns canonical telemetry provider and API source mode in control reads', async () => {
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

    const response = await controller.getControl('org-1', 'match-1', {
      user: actor,
    } as any);

    expect(response).toEqual(
      expect.objectContaining({
        ok: true,
        control: expect.objectContaining({
          telemetryProvider: MatchDataSource.API,
          sourceMode: MatchDataSource.API,
        }),
      }),
    );
    expect(response.control).not.toHaveProperty('adapterKey');
    expect(response.control).not.toHaveProperty('pcobConfigured');
    expect(response.control).not.toHaveProperty('pcobBound');
    expect(response.control).not.toHaveProperty('pcobReady');
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

  it('allows finalized session results to be reopened for placement review', async () => {
    const { controller, prisma, audit } = createController(
      makeMatch({
        tournament: null,
        sessionId: 'session-1',
        organizationId: 'org-1',
        dataSource: MatchDataSource.API,
        dataMode: 'AUTO',
        status: MatchStatus.FINISHED,
        liveState: 'ENDED',
        controlState: {
          state: 'ENDED',
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
        create: expect.objectContaining({
          organizationId: 'org-1',
          resultsForceUnlock: true,
        }),
        update: expect.objectContaining({
          resultsForceUnlock: true,
        }),
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        reason: 'Results reopened for manual editing',
      }),
    );
  });

  it('normalizes AUTO source updates to API in the control setup endpoint', async () => {
    const { controller, audit, matches } = createController(makeMatch());

    await expect(
      controller.setDataSource(
        'org-1',
        'match-1',
        { user: actor } as any,
        'AUTO',
      ),
    ).resolves.toEqual({
      ok: true,
      dataSource: MatchDataSource.API,
    });

    expect(matches.setDataSource).toHaveBeenCalledWith(
      actor,
      'match-1',
      MatchDataSource.API,
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        after: { dataSource: MatchDataSource.API },
      }),
    );
  });
});
