import { MatchDataSource, MatchStatus, Role } from '@prisma/client';
import { PcobFocusService } from './pcob-focus.service';

describe('PcobFocusService', () => {
  it('accepts API-bound adapter matches for focus updates', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-1',
          status: MatchStatus.LIVE,
          dataSource: MatchDataSource.API,
          dataMode: 'MANUAL',
          pcobMode: false,
          pcobSessionId: 'session-1',
          adapterKey: 'pubgm-pcob',
          tournament: { organizationId: 'org-1' },
        }),
      },
      player: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'player-1',
          ign: 'Alpha',
          realName: null,
          photoUrl: null,
          externalPlayerId: null,
          inGameId: 'pubg-1',
          pubgPlayerId: 'pubg-1',
          playerOpenId: null,
          team: {
            id: 'team-1',
            name: 'Team 1',
            logoUrl: null,
          },
        }),
      },
      matchEvent: {
        count: jest.fn().mockResolvedValue(3),
      },
    } as any;
    const cache = {
      setFocus: jest.fn().mockReturnValue({ focus: 'cached' }),
    } as any;
    const events = {
      emitTelemetry: jest.fn(),
    } as any;
    const canonicalRead = {
      getStateSnapshot: jest.fn().mockResolvedValue({}),
      resolvePlayerAlive: jest.fn().mockReturnValue(true),
    } as any;

    const service = new PcobFocusService(prisma, cache, events, canonicalRead);

    await expect(
      service.setFocus('org-1', Role.ORGANIZER, 'match-1', 'player-1'),
    ).resolves.toEqual({
      ok: true,
      focus: {
        playerId: 'player-1',
        name: 'Alpha',
        photoUrl: null,
        teamId: 'team-1',
        teamName: 'Team 1',
        teamLogoUrl: null,
        kills: 3,
        health: null,
        isAlive: true,
      },
      state: { focus: 'cached' },
    });

    expect(cache.setFocus).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({
        playerId: 'player-1',
        isAlive: true,
      }),
    );
    expect(events.emitTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: 'match-1',
        payload: expect.objectContaining({
          type: 'FOCUS_UPDATE',
        }),
      }),
    );
  });
});
