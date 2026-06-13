import 'reflect-metadata';
import { Role, SessionRegistrationStatus } from '@prisma/client';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { SessionRegistrationPlacementAction } from './dto/update-session-registration-placement.dto';
import { SessionsController } from './sessions.controller';

function makeRequest(): AuthenticatedRequest {
  return {
    orgId: 'org-1',
    user: {
      id: 'user-1',
      role: Role.ORGANIZER,
      organizationId: 'org-1',
      orgId: 'org-1',
      actorId: 'user-1',
      actorRole: Role.ORGANIZER,
      actingOrgId: null,
      actingRole: null,
      actingOrgName: null,
      actingAsUserId: null,
      realRole: Role.ORGANIZER,
    },
  } as AuthenticatedRequest;
}

function buildController() {
  const sessions = {
    updateRegistrationPlacement: jest.fn(),
  };
  const discordSync = {
    queueSync: jest.fn(),
  };

  return {
    controller: new SessionsController(
      sessions as never,
      {} as never,
      discordSync as never,
      {} as never,
    ),
    discordSync,
    sessions,
  };
}

describe('SessionsController', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('queues Discord sync after a registration placement update', async () => {
    const { controller, discordSync, sessions } = buildController();
    const req = makeRequest();
    const registration = {
      id: 'registration-1',
      teamId: 'team-1',
      status: SessionRegistrationStatus.CONFIRMED,
      slotNumber: 7,
      waitlistPosition: null,
    };
    sessions.updateRegistrationPlacement.mockResolvedValue(registration);
    discordSync.queueSync.mockResolvedValue({ ok: true, queued: true });

    await expect(
      controller.updateRegistrationPlacement(
        'session-1',
        'registration-1',
        { action: SessionRegistrationPlacementAction.APPROVE },
        req,
      ),
    ).resolves.toBe(registration);

    expect(sessions.updateRegistrationPlacement).toHaveBeenCalledWith(
      'session-1',
      'registration-1',
      { action: SessionRegistrationPlacementAction.APPROVE },
      req.user,
    );
    expect(discordSync.queueSync).toHaveBeenCalledWith('session-1', req.user);
  });

  it('keeps the placement update response when Discord sync cannot be queued', async () => {
    const { controller, discordSync, sessions } = buildController();
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const req = makeRequest();
    const registration = {
      id: 'registration-1',
      teamId: 'team-1',
      status: SessionRegistrationStatus.CONFIRMED,
      slotNumber: 23,
      waitlistPosition: null,
    };
    sessions.updateRegistrationPlacement.mockResolvedValue(registration);
    discordSync.queueSync.mockRejectedValue(new Error('Discord unavailable'));

    await expect(
      controller.updateRegistrationPlacement(
        'session-1',
        'registration-1',
        { action: SessionRegistrationPlacementAction.VIP },
        req,
      ),
    ).resolves.toBe(registration);

    expect(discordSync.queueSync).toHaveBeenCalledWith('session-1', req.user);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        '[DiscordSync] registration placement sync skipped session=session-1',
      ),
    );
  });
});
