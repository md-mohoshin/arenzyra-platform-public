import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { TournamentsService } from './tournaments.service';
import type { AuthUser } from '../../common/auth/auth.types';

describe('TournamentsService lifecycle guards', () => {
  const buildService = (opts: { nonEndedMatches: number }) => {
    const prisma = {
      tournament: {
        findFirst: jest.fn().mockResolvedValue({
          id: 't-1',
          deletedAt: null,
          ownerUserId: 'u-1',
          organizationId: 'org-1',
        }),
        update: jest.fn().mockResolvedValue({ id: 't-1', status: 'COMPLETED' }),
      },
      match: {
        count: jest.fn().mockResolvedValue(opts.nonEndedMatches),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue(undefined),
      },
    } as any;

    const service = new TournamentsService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    return { service, prisma };
  };

  it('blocks COMPLETED transition when matches not ENDED', async () => {
    const { service } = buildService({ nonEndedMatches: 1 });
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

    await expect(
      service.update('t-1', { status: 'COMPLETED' }, actor),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows COMPLETED transition when all matches ENDED', async () => {
    const { service } = buildService({ nonEndedMatches: 0 });
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

    await expect(
      service.update('t-1', { status: 'COMPLETED' }, actor),
    ).resolves.toBeDefined();
  });
});
