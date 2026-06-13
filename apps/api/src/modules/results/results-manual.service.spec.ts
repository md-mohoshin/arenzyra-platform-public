import { Role } from '@prisma/client';
import type { PrismaService } from '../../db/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { ResultsEventsService } from './results-events.service';
import type { ResultsService } from './results.service';
import { ResultsManualService } from './results-manual.service';

describe('ResultsManualService session compatibility', () => {
  it('accepts manual results for a session match summary', async () => {
    const prisma = {
      matchSlotResult: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'slot-1',
          matchId: 'match-session-1',
          slotNumber: 1,
          teamId: 'team-1',
          wasPresentInMatch: true,
          placement: null,
          totalKills: 0,
          manualTotalKills: false,
          players: [],
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
    } as unknown as PrismaService;

    const resultsService = {
      ensureMatch: jest.fn().mockResolvedValue({
        id: 'match-session-1',
        organizationId: 'org-session',
        sessionId: 'session-1',
        map: null,
        status: 'LIVE',
        liveState: 'LIVE',
        endedAt: null,
        gameKey: 'PUBG_MOBILE',
        dataSource: 'MANUAL',
        dataMode: 'MANUAL',
        controlState: null,
        resultLockState: 'UNLOCKED',
        tournamentId: null,
        tournament: null,
      }),
      isManualSource: jest.fn().mockReturnValue(true),
      ensureResultsEditable: jest.fn().mockResolvedValue(undefined),
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
      assertSlotPresentForMutation: jest.fn().mockResolvedValue(undefined),
      recomputeSlotResult: jest.fn().mockResolvedValue({
        id: 'slot-1',
        slotNumber: 1,
        placement: 1,
        totalKills: 4,
      }),
      getRoundWithData: jest.fn().mockResolvedValue({
        id: 'match-session-1',
        roundIndex: 1,
        teamResults: [],
      }),
    } as unknown as ResultsService;

    const audit = {
      log: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;
    const events = {
      emitResultsUpdated: jest.fn(),
      emitLeaderboardUpdated: jest.fn(),
    } as unknown as ResultsEventsService;

    const service = new ResultsManualService(
      prisma,
      resultsService,
      audit,
      events,
    );

    const actor = {
      id: 'ref-1',
      actorId: 'ref-1',
      role: Role.REFEREE,
      actorRole: Role.REFEREE,
      organizationId: 'org-session',
      actingOrgId: 'org-session',
    } as any;

    const result = await service.setManualResult(actor, 'match-session-1', 1, {
      teamId: 'team-1',
      placementManual: 1,
      killsManual: 4,
      reason: 'session correction',
    });

    expect(result).toMatchObject({
      updated: {
        id: 'slot-1',
        placement: 1,
        totalKills: 4,
      },
    });
    expect((audit as any).log).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-session',
      }),
    );
  });

  it('allows manual session results to promote a missing team back into manual control', async () => {
    const prisma = {
      matchSlotResult: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'slot-1',
          matchId: 'match-session-1',
          slotNumber: 1,
          teamId: 'team-1',
          wasPresentInMatch: false,
          placement: null,
          totalKills: 0,
          manualTotalKills: false,
          players: [],
        }),
        update: jest.fn(),
      },
    } as unknown as PrismaService;

    const resultsService = {
      ensureMatch: jest.fn().mockResolvedValue({
        id: 'match-session-1',
        organizationId: 'org-session',
        sessionId: 'session-1',
        dataSource: 'MANUAL',
        dataMode: 'MANUAL',
        tournamentId: null,
        tournament: null,
      }),
      isManualSource: jest.fn().mockReturnValue(true),
      ensureResultsEditable: jest.fn().mockResolvedValue(undefined),
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
      assertSlotPresentForMutation: jest.fn().mockResolvedValue(undefined),
      recomputeSlotResult: jest.fn().mockResolvedValue({
        id: 'slot-1',
        matchId: 'match-session-1',
        slotNumber: 1,
        teamId: 'team-1',
        wasPresentInMatch: true,
        placement: 1,
        totalKills: 4,
        manualTotalKills: true,
        players: [],
      }),
      getRoundWithData: jest.fn().mockResolvedValue({ index: 1 }),
    } as unknown as ResultsService;

    const service = new ResultsManualService(
      prisma,
      resultsService,
      { log: jest.fn() } as unknown as AuditService,
      {
        emitResultsUpdated: jest.fn(),
        emitLeaderboardUpdated: jest.fn(),
      } as unknown as ResultsEventsService,
    );

    const actor = {
      id: 'ref-1',
      actorId: 'ref-1',
      role: Role.REFEREE,
      actorRole: Role.REFEREE,
      organizationId: 'org-session',
      actingOrgId: 'org-session',
    } as any;

    await expect(
      service.setManualResult(actor, 'match-session-1', 1, {
        teamId: 'team-1',
        placementManual: 1,
        killsManual: 4,
        reason: 'test adjustment',
      }),
    ).resolves.toMatchObject({
      updated: expect.objectContaining({
        id: 'slot-1',
        wasPresentInMatch: true,
        placement: 1,
        totalKills: 4,
      }),
    });
    expect(
      (resultsService as any).assertSlotPresentForMutation,
    ).toHaveBeenCalledWith(
      {
        id: 'slot-1',
        matchId: 'match-session-1',
        slotNumber: 1,
        teamId: 'team-1',
        wasPresentInMatch: false,
      },
      {
        allowManualPromote: true,
      },
    );
    expect((prisma as any).matchSlotResult.update).toHaveBeenCalled();
  });
});
