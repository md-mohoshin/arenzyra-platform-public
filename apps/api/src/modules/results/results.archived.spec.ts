import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ResultsService } from './results.service';
import type { PrismaService } from '../../db/prisma.service';
import type { ResultsEventsService } from './results-events.service';
import type { StandingsService } from '../standings/standings.service';
import type { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../../common/auth/auth.types';

describe('ResultsService archived tournament guard', () => {
  const prisma = {
    match: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'm-arch',
        status: 'DRAFT',
        liveState: null,
        dataSource: null,
        dataMode: null,
        game: { key: 'PUBG_MOBILE' },
        tournamentId: 't-arch',
        tournament: {
          ownerUserId: 'u-1',
          organizationId: 'org-1',
          status: 'ARCHIVED',
        },
        controlState: {
          state: null,
          metaJson: null,
          resultsManualLock: null,
          resultsForceUnlock: null,
        },
      }),
    },
  } as unknown as PrismaService;

  const dummyEvents = {} as ResultsEventsService;
  const dummyStandings = {
    canEditResults: jest.fn().mockResolvedValue({ canEdit: true }),
  } as Pick<StandingsService, 'canEditResults'>;
  const dummyAudit = {} as AuditService;

  it('blocks result access when tournament is archived', async () => {
    const service = new ResultsService(
      prisma,
      dummyEvents,
      dummyStandings as unknown as StandingsService,
      dummyAudit,
      {} as any,
    );

    const actor: AuthUser = {
      id: 'u-1',
      actorId: 'u-1',
      role: Role.SUPER_ADMIN,
      actorRole: Role.SUPER_ADMIN,
      organizationId: null,
      actingOrgId: null,
      actingRole: null,
      actingOrgName: null,
      actingAsUserId: null,
      realRole: Role.SUPER_ADMIN,
    };

    await expect(service.ensureMatch(actor, 'm-arch')).rejects.toThrow(
      BadRequestException,
    );
  });
});
