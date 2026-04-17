import { LiveState, MatchStatus, Role, TelemetrySource } from '@prisma/client';
import type { AuditService } from '../audit/audit.service';
import { MatchesService, type Actor } from './matches.service';

const createActor = (overrides: Partial<Actor> = {}): Actor => ({
  id: 'user-1',
  actorId: 'user-1',
  role: Role.ORGANIZER,
  actorRole: Role.ORGANIZER,
  organizationId: 'org-1',
  actingOrgId: null,
  ...overrides,
});

const createMatchRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 'match-1',
  status: MatchStatus.DRAFT,
  liveState: LiveState.UPCOMING,
  organizationId: 'org-1',
  telemetrySource: TelemetrySource.PCOB,
  telemetrySourceLockedAt: new Date('2026-04-04T18:00:00.000Z'),
  controlState: {
    state: MatchStatus.DRAFT,
    organizationId: 'org-1',
    metaJson: {
      telemetrySource: TelemetrySource.PCOB,
      telemetryIngress: {
        sessionId: 'session-live',
        lastAdapterSequence: 19,
      },
      telemetryRuntime: {
        lastAcceptedSource: 'PCOB_PUSH',
        lastAcceptedSequence: 19,
      },
    },
  },
  tournament: {
    ownerUserId: 'user-1',
    organizationId: 'org-1',
  },
  ...overrides,
});

describe('MatchesService telemetry source reset', () => {
  const createService = (matchRecord = createMatchRecord()) => {
    const tx = {
      match: {
        update: jest.fn().mockResolvedValue({
          id: 'match-1',
          telemetrySource: TelemetrySource.AUTO,
          telemetrySourceLockedAt: null,
        }),
      },
      matchControlState: {
        upsert: jest.fn().mockResolvedValue(undefined),
      },
    };
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue(matchRecord),
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback: any) => callback(tx)),
    } as any;
    const audit = {
      log: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;
    const service = new MatchesService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      audit,
      {} as any,
    );

    return {
      service,
      prisma,
      tx,
      audit: audit as unknown as { log: jest.Mock },
    };
  };

  it('resets the telemetry source and clears source-specific runtime metadata before LIVE', async () => {
    const { service, tx, audit } = createService();

    await expect(
      service.resetTelemetrySource(createActor(), 'match-1'),
    ).resolves.toEqual({
      ok: true,
      matchId: 'match-1',
      telemetrySource: TelemetrySource.AUTO,
      telemetrySourceLockedAt: null,
      force: false,
    });

    expect(tx.match.update).toHaveBeenCalledWith({
      where: { id: 'match-1' },
      data: {
        telemetrySource: TelemetrySource.AUTO,
        telemetrySourceLockedAt: null,
      },
      select: {
        id: true,
        telemetrySource: true,
        telemetrySourceLockedAt: true,
      },
    });

    const upsertArg = tx.matchControlState.upsert.mock.calls[0][0];
    expect(upsertArg.update.metaJson).toEqual({
      telemetrySource: TelemetrySource.AUTO,
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'match-1',
        after: expect.objectContaining({
          telemetrySource: TelemetrySource.AUTO,
          force: false,
        }),
      }),
    );
  });

  it('does not allow telemetry source reset once the match is LIVE without force', async () => {
    const { service, tx, audit } = createService(
      createMatchRecord({
        status: MatchStatus.LIVE,
        liveState: LiveState.LIVE,
        controlState: {
          state: MatchStatus.LIVE,
          organizationId: 'org-1',
          metaJson: {
            telemetrySource: TelemetrySource.PCOB,
          },
        },
      }),
    );

    await expect(
      service.resetTelemetrySource(createActor(), 'match-1'),
    ).rejects.toThrow('Telemetry source can only be reset before LIVE');

    expect(tx.match.update).not.toHaveBeenCalled();
    expect(tx.matchControlState.upsert).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
});
