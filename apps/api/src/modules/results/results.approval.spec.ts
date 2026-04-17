import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { PrismaService } from '../../db/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { ResultsEventsService } from './results-events.service';
import type { AuthUser } from '../../common/auth/auth.types';
import { ResultsApprovalService } from './results-approval.service';

describe('ResultsApprovalService', () => {
  const makeActor = (role: Role): AuthUser => ({
    id: 'user',
    actorId: 'user',
    role,
    actorRole: role,
    organizationId: null,
    actingOrgId: null,
    actingRole: null,
    actingOrgName: null,
    actingAsUserId: null,
    isImpersonating: false,
    impersonationExpiresAt: null,
    realRole: role,
  });

  const buildService = () => {
    const prisma = {
      matchSlotResult: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    } as unknown as PrismaService;
    const audit = {
      log: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;
    const events = {
      emitResultsUpdated: jest.fn(),
      emitLeaderboardUpdated: jest.fn(),
      emitOverlayPayload: jest.fn(),
    } as unknown as ResultsEventsService;
    const service = new ResultsApprovalService(prisma, audit, events);
    return { service, prisma, audit, events };
  };

  it('throws when round is locked', () => {
    const { service } = buildService();
    expect(() =>
      service.ensureUnlocked(makeActor(Role.REFEREE), { locked: true }),
    ).toThrow(ForbiddenException);
  });

  it('allows admin when locked', () => {
    const { service } = buildService();
    expect(() =>
      service.ensureUnlocked(makeActor(Role.ADMIN), { locked: true }),
    ).not.toThrow();
  });

  it('allows unlocked rounds', () => {
    const { service } = buildService();
    expect(() =>
      service.ensureUnlocked(makeActor(Role.REFEREE), { locked: false }),
    ).not.toThrow();
    expect(() =>
      service.ensureUnlocked(makeActor(Role.REFEREE), null),
    ).not.toThrow();
  });

  it('uses match.organizationId when approving results for a session-linked match summary', async () => {
    const { service, prisma, audit } = buildService();

    await expect(
      service.approveRound(
        makeActor(Role.ADMIN),
        {
          id: 'match-session-1',
          organizationId: 'org-session',
          sessionId: 'session-1',
          map: null,
          status: 'LIVE' as any,
          liveState: 'LIVE',
          endedAt: null,
          gameKey: null,
          dataSource: null,
          dataMode: null,
          controlState: null,
          resultLockState: 'UNLOCKED',
          tournamentId: null,
          tournament: null,
        },
        'approve',
      ),
    ).resolves.toEqual({ ok: true });

    expect((prisma as any).matchSlotResult.updateMany).toHaveBeenCalledWith({
      where: { matchId: 'match-session-1' },
      data: { isLocked: true },
    });
    expect((audit as any).log).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-session',
      }),
    );
  });
});
