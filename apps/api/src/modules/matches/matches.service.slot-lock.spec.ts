import { ForbiddenException } from '@nestjs/common';
import { GameKey, MatchStatus, TournamentStatus } from '@prisma/client';
import { MatchesService } from './matches.service';

const actor = {
  id: 'u-1',
  actorId: 'u-1',
  role: null,
  actorRole: null,
  organizationId: 'org-1',
  actingOrgId: 'org-1',
};

describe('MatchesService slot lock guard', () => {
  const buildService = (status: MatchStatus) => {
    const prisma = {
      _dmmf: { modelMap: { Match: { fields: [] } } },
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'm-1',
          tournamentId: 't-1',
          groupId: 'g-1',
          adapterKey: null,
          status,
          slotCount: 25,
          liveState: null,
          dataSource: null,
          dataMode: null,
          controlState: {
            state: null,
            resultsManualLock: null,
            resultsForceUnlock: null,
            updatedAt: null,
            updatedByUserId: null,
          },
          game: { key: GameKey.PUBG_MOBILE },
          tournament: {
            ownerUserId: 'u-1',
            organizationId: 'org-1',
            status: TournamentStatus.ACTIVE,
            game: GameKey.PUBG_MOBILE,
          },
        }),
      },
      matchTeam: {
        findFirst: jest.fn(),
      },
      matchSlot: {
        findFirst: jest.fn(),
      },
      $transaction: jest.fn(),
    } as any;

    const service = new MatchesService(
      prisma,
      {} as any,
      {} as any,
      {
        getAdapterByKey: jest.fn().mockReturnValue(null),
      } as any,
      {} as any,
      {
        ensureResultsFromSlots: jest.fn(),
        recomputeAllSlots: jest.fn(),
      } as any,
      {
        emitResultsLockState: jest.fn(),
      } as any,
      {} as any,
      {
        emitForMatch: jest.fn(),
      } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    return { service, prisma };
  };

  it('blocks assignMatchTeamSlot after a match ends', async () => {
    const { service, prisma } = buildService(MatchStatus.ENDED);

    await expect(
      service.assignMatchTeamSlot(actor, 'm-1', { slot: 1, teamId: 'team-1' }),
    ).rejects.toThrow(
      new ForbiddenException('Slots cannot be edited after match ends'),
    );
    expect(prisma.matchTeam.findFirst).not.toHaveBeenCalled();
  });

  it('blocks setSlot after a match ends', async () => {
    const { service, prisma } = buildService(MatchStatus.ENDED);

    await expect(service.setSlot('m-1', 1, 'team-1', actor)).rejects.toThrow(
      new ForbiddenException('Slots cannot be edited after match ends'),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('blocks removeSlot after a match ends', async () => {
    const { service, prisma } = buildService(MatchStatus.ENDED);

    await expect(service.removeSlot('m-1', 1, actor)).rejects.toThrow(
      new ForbiddenException('Slots cannot be edited after match ends'),
    );
    expect(prisma.matchSlot.findFirst).not.toHaveBeenCalled();
  });
});
