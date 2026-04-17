import { Role } from '@prisma/client';
import type { PrismaService } from '../../db/prisma.service';
import type { ResultsEventsService } from './results-events.service';
import type { StandingsService } from '../standings/standings.service';
import type { AuditService } from '../audit/audit.service';
import { ResultsService } from './results.service';

describe('ResultsService session match compatibility', () => {
  const buildService = () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-session-1',
          organizationId: 'org-1',
          sessionId: 'session-1',
          map: null,
          status: 'LIVE',
          liveState: 'LIVE',
          dataSource: 'MANUAL',
          dataMode: 'MANUAL',
          endedAt: null,
          game: { key: 'PUBG_MOBILE' },
          tournamentId: null,
          tournament: null,
          controlState: {
            state: 'LIVE',
            authorityMode: 'MANUAL',
            metaJson: null,
            resultsManualLock: false,
            resultsForceUnlock: false,
          },
        }),
      },
      matchSlotResult: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaService;

    const standings = {
      canEditResults: jest
        .fn()
        .mockRejectedValue(
          new Error('session matches should skip standings.canEditResults'),
        ),
    } as unknown as StandingsService;

    const service = new ResultsService(
      prisma,
      {} as ResultsEventsService,
      standings,
      {} as AuditService,
      {} as any,
    );

    return { service, standings };
  };

  it('allows org-scoped access to a session match and skips tournament standings locks', async () => {
    const { service, standings } = buildService();
    const actor = {
      id: 'organizer-1',
      actorId: 'organizer-1',
      role: Role.ORGANIZER,
      actorRole: Role.ORGANIZER,
      organizationId: 'org-1',
      actingOrgId: 'org-1',
    } as any;

    const match = await service.ensureMatch(actor, 'match-session-1');

    expect(match).toMatchObject({
      id: 'match-session-1',
      organizationId: 'org-1',
      sessionId: 'session-1',
      tournamentId: null,
      tournament: null,
    });

    await expect(
      service.ensureResultsEditable(match, actor),
    ).resolves.toBeUndefined();
    expect(standings.canEditResults).not.toHaveBeenCalled();
  });
});
