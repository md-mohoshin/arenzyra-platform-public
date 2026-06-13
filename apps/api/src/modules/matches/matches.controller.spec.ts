import { MatchStatus, Role } from '@prisma/client';
import { MatchesController } from './matches.controller';

const req = {
  user: {
    id: 'user-1',
    actorId: 'user-1',
    role: Role.ORGANIZER,
    actorRole: Role.ORGANIZER,
    organizationId: 'org-1',
    actingOrgId: 'org-1',
  },
} as any;

describe('MatchesController setStatus', () => {
  it('syncs canonical control state when organizer ends a match', async () => {
    const matches = {
      get: jest.fn().mockResolvedValue({
        id: 'match-1',
        tournamentId: 'org-1',
        status: MatchStatus.ENDED,
      }),
    };
    const auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    };
    const matchState = {
      transition: jest.fn().mockResolvedValue({
        matchId: 'match-1',
        state: 'ENDED',
      }),
    };
    const matchControl = {
      setStatus: jest.fn().mockResolvedValue({ matchId: 'match-1' }),
    };
    const controller = new MatchesController(
      matches as any,
      auditService as any,
      matchState as any,
      matchControl as any,
    );

    await controller.setStatus('match-1', MatchStatus.ENDED, req);

    expect(matchControl.setStatus).toHaveBeenCalledWith(req.user, 'match-1', {
      status: 'FINISH_PENDING',
      reason: 'set-status ENDED',
    });
    expect(matchState.transition).not.toHaveBeenCalled();
    expect(matches.get).toHaveBeenCalledWith(req.user, 'match-1');
  });

  it('delegates live status updates through canonical match control', async () => {
    const matches = {
      get: jest.fn().mockResolvedValue({
        id: 'match-1',
        tournamentId: 'org-1',
        status: MatchStatus.LIVE,
      }),
    };
    const auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    };
    const matchState = {
      transition: jest.fn().mockResolvedValue(undefined),
    };
    const matchControl = {
      setStatus: jest.fn().mockResolvedValue({ matchId: 'match-1' }),
    };
    const controller = new MatchesController(
      matches as any,
      auditService as any,
      matchState as any,
      matchControl as any,
    );

    await controller.setStatus('match-1', MatchStatus.LIVE, req);

    expect(matchControl.setStatus).toHaveBeenCalledWith(req.user, 'match-1', {
      status: 'LIVE',
      reason: 'set-status LIVE',
    });
    expect(matchState.transition).not.toHaveBeenCalled();
  });

  it('delegates FINISH_PENDING as a distinct control status', async () => {
    const matches = {
      get: jest.fn().mockResolvedValue({
        id: 'match-1',
        tournamentId: 'org-1',
        status: MatchStatus.FINISH_PENDING,
      }),
    };
    const auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    };
    const matchState = {
      transition: jest.fn().mockResolvedValue(undefined),
    };
    const matchControl = {
      setStatus: jest.fn().mockResolvedValue({ matchId: 'match-1' }),
    };
    const controller = new MatchesController(
      matches as any,
      auditService as any,
      matchState as any,
      matchControl as any,
    );

    await controller.setStatus('match-1', MatchStatus.FINISH_PENDING, req);

    expect(matchControl.setStatus).toHaveBeenCalledWith(req.user, 'match-1', {
      status: 'FINISH_PENDING',
      reason: 'set-status FINISH_PENDING',
    });
    expect(matchState.transition).not.toHaveBeenCalled();
  });
});
