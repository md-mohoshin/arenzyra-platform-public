import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { OverlayController } from './overlay.controller';

describe('OverlayController', () => {
  const buildRequest = (
    overrides: Partial<AuthenticatedRequest['user']> = {},
  ) =>
    ({
      user: {
        id: 'user-1',
        role: Role.ORGANIZER,
        organizationId: 'org-1',
        actorId: 'user-1',
        actorRole: Role.ORGANIZER,
        actingOrgId: null,
        actingRole: null,
        actingOrgName: null,
        actingAsUserId: null,
        realRole: Role.ORGANIZER,
        ...overrides,
      },
    }) as AuthenticatedRequest;

  const buildController = () => {
    const liveSync = {
      getSnapshot: jest.fn(),
      mapTeam: jest.fn().mockResolvedValue(undefined),
      mapPlayer: jest.fn().mockResolvedValue(undefined),
    } as any;
    const prisma = {
      match: {
        findFirst: jest.fn(),
      },
    } as any;

    return {
      controller: new OverlayController(liveSync, prisma),
      liveSync,
      prisma,
    };
  };

  it('rejects team mapping from a different organization', async () => {
    const { controller, liveSync, prisma } = buildController();
    prisma.match.findFirst.mockResolvedValue({
      organizationId: 'org-2',
      tournament: null,
    });

    await expect(
      controller.mapTeam(
        'match-1',
        buildRequest(),
        'live-team-1',
        'managed-team-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(liveSync.mapTeam).not.toHaveBeenCalled();
  });

  it('rejects player mapping for insufficient roles before reaching the service', async () => {
    const { controller, liveSync, prisma } = buildController();

    await expect(
      controller.mapPlayer(
        'match-1',
        buildRequest({
          role: Role.REFEREE,
          actorRole: Role.REFEREE,
          realRole: Role.REFEREE,
        }),
        'live-player-1',
        'managed-player-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.match.findFirst).not.toHaveBeenCalled();
    expect(liveSync.mapPlayer).not.toHaveBeenCalled();
  });

  it('allows team mapping for admins in the match organization', async () => {
    const { controller, liveSync, prisma } = buildController();
    prisma.match.findFirst.mockResolvedValue({
      organizationId: 'org-1',
      tournament: null,
    });

    await expect(
      controller.mapTeam(
        'match-1',
        buildRequest({
          role: Role.ADMIN,
          actorRole: Role.ADMIN,
          realRole: Role.ADMIN,
        }),
        'live-team-1',
        'managed-team-1',
      ),
    ).resolves.toEqual({ ok: true });

    expect(liveSync.mapTeam).toHaveBeenCalledWith(
      'match-1',
      'live-team-1',
      'managed-team-1',
    );
  });

  it('allows player mapping for organizers in the match organization', async () => {
    const { controller, liveSync, prisma } = buildController();
    prisma.match.findFirst.mockResolvedValue({
      organizationId: 'org-1',
      tournament: null,
    });

    await expect(
      controller.mapPlayer(
        'match-1',
        buildRequest(),
        'live-player-1',
        'managed-player-1',
      ),
    ).resolves.toEqual({ ok: true });

    expect(liveSync.mapPlayer).toHaveBeenCalledWith(
      'match-1',
      'live-player-1',
      'managed-player-1',
    );
  });
});
