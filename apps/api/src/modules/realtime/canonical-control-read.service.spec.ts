import { MatchStatus } from '@prisma/client';
import { CanonicalControlReadService } from './canonical-control-read.service';
import type { PrismaService } from '../../db/prisma.service';
import type { MatchControlService } from '../match-control/match-control.service';
import type {
  LiveMatchState,
  MatchControlStateStore,
} from '../match-control/state.store';

describe('CanonicalControlReadService', () => {
  it('strips unconfirmed live roster rows from cached canonical state', async () => {
    const staleState: LiveMatchState = {
      matchId: 'match-1',
      status: 'LIVE',
      startedAt: '2026-05-31T22:02:38.037Z',
      endedAt: null,
      version: 10,
      updatedAt: '2026-05-31T22:04:59.684Z',
      sourceMode: 'API',
      summary: {
        totalTeams: 2,
        aliveTeams: 2,
        totalPlayers: 8,
        alivePlayers: 8,
      },
      teams: [
        {
          teamId: 'team-unconfirmed',
          name: 'Unconfirmed',
          tag: 'UN',
          slot: 1,
          kills: 0,
          placement: null,
          points: null,
          logoUrl: null,
          hasTelemetryPresence: false,
          alivePlayers: 4,
          totalPlayers: 4,
          alive: true,
          eliminated: false,
          players: [
            {
              id: 'player-1',
              playerId: 'player-1',
              teamId: 'team-unconfirmed',
              alive: true,
              knocked: false,
              kills: 0,
            },
          ],
        },
        {
          teamId: 'team-present',
          name: 'Present',
          tag: 'PR',
          slot: 2,
          wasPresentInMatch: true,
          presenceStatus: 'ACTIVE',
          kills: 0,
          placement: null,
          points: null,
          logoUrl: null,
          hasTelemetryPresence: true,
          alivePlayers: 4,
          totalPlayers: 4,
          alive: true,
          eliminated: false,
          players: [
            {
              id: 'player-2',
              playerId: 'player-2',
              teamId: 'team-present',
              alive: true,
              knocked: false,
              kills: 0,
            },
          ],
        },
      ],
    };
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-1',
          tournamentId: null,
          groupId: null,
          status: MatchStatus.LIVE,
          tournament: { status: null },
        }),
      },
    } as unknown as PrismaService;
    const matchControl = {
      getState: jest.fn(),
    } as unknown as MatchControlService;
    const store = {
      get: jest.fn().mockResolvedValue(staleState),
    } as unknown as MatchControlStateStore;
    const service = new CanonicalControlReadService(
      prisma,
      matchControl,
      store,
    );

    const state = await service.getStateSnapshot('match-1');

    expect(matchControl.getState).not.toHaveBeenCalled();
    expect(state.summary).toMatchObject({
      totalTeams: 2,
      aliveTeams: 1,
      totalPlayers: 4,
      alivePlayers: 4,
    });
    expect(state.teams[0]).toMatchObject({
      teamId: 'team-unconfirmed',
      alivePlayers: null,
      totalPlayers: null,
      presenceStatus: 'UNRESOLVED',
      players: [],
    });
    expect(state.teams[1]).toMatchObject({
      teamId: 'team-present',
      alivePlayers: 4,
      totalPlayers: 4,
      players: expect.arrayContaining([
        expect.objectContaining({ playerId: 'player-2' }),
      ]),
    });
  });
});
