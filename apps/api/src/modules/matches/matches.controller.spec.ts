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
      setStatus: jest.fn().mockResolvedValue({
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
    const controller = new MatchesController(
      matches as any,
      auditService as any,
      matchState as any,
      {} as any,
    );

    await controller.setStatus('match-1', MatchStatus.ENDED, req);

    expect(matches.setStatus).toHaveBeenCalledWith(
      'match-1',
      MatchStatus.ENDED,
      req.user,
    );
    expect(matchState.transition).toHaveBeenCalledWith(
      'match-1',
      'ENDED',
      req.user,
      'set-status ENDED',
    );
  });

  it('does not force a redundant control transition for live status updates', async () => {
    const matches = {
      setStatus: jest.fn().mockResolvedValue({
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
    const controller = new MatchesController(
      matches as any,
      auditService as any,
      matchState as any,
      {} as any,
    );

    await controller.setStatus('match-1', MatchStatus.LIVE, req);

    expect(matchState.transition).not.toHaveBeenCalled();
  });
});
