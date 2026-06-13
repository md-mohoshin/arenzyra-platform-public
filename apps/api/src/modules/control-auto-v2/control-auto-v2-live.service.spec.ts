import { requireMatchOrganization } from '../../common/org/org.util';
import { ControlAutoV2LiveService } from './control-auto-v2-live.service';

jest.mock('../../common/org/org.util', () => ({
  requireMatchOrganization: jest.fn().mockResolvedValue('org-1'),
}));

describe('ControlAutoV2LiveService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireMatchOrganization as jest.Mock).mockResolvedValue('org-1');
  });

  it('returns telemetry data only when live telemetry exists', async () => {
    const service = new ControlAutoV2LiveService(
      {} as any,
      {
        get: jest.fn().mockResolvedValue({
          matchId: 'match-1',
          status: 'LIVE',
          startedAt: '2026-04-20T10:00:00.000Z',
          endedAt: null,
          version: 4,
          updatedAt: '2026-04-20T10:05:00.000Z',
          summary: {
            totalTeams: 2,
            aliveTeams: 2,
            totalPlayers: 8,
            alivePlayers: 6,
          },
          circle: {
            phase: 3,
          },
          teams: [
            {
              teamId: 'team-1',
              name: 'Alpha',
              tag: 'ALP',
              slot: 1,
              kills: 4,
              placement: null,
              logoUrl: null,
              alivePlayers: 3,
              totalPlayers: 4,
              hasTelemetryPresence: true,
              players: [
                {
                  id: 'p-1',
                  playerId: 'player-1',
                  teamId: 'team-1',
                  name: 'Alpha 1',
                  ign: 'Alpha 1',
                  alive: true,
                  knocked: false,
                  kills: 2,
                  lifeTelemetryFresh: true,
                },
              ],
            },
          ],
        }),
      } as any,
    );

    await expect(
      service.getLive({ organizationId: 'org-1' } as any, 'match-1'),
    ).resolves.toEqual({
      telemetryStatus: 'live',
      phase: 3,
      aliveTeams: 2,
      alivePlayers: 6,
      teams: [
        {
          teamId: 'team-1',
          name: 'Alpha',
          tag: 'ALP',
          slot: 1,
          alivePlayers: 3,
          totalPlayers: 4,
          kills: 4,
          placement: null,
          players: [
            {
              id: 'p-1',
              playerId: 'player-1',
              teamId: 'team-1',
              name: 'Alpha 1',
              ign: 'Alpha 1',
              alive: true,
              knocked: false,
              kills: 2,
            },
          ],
        },
      ],
      players: [
        {
          id: 'p-1',
          playerId: 'player-1',
          teamId: 'team-1',
          name: 'Alpha 1',
          ign: 'Alpha 1',
          alive: true,
          knocked: false,
          kills: 2,
        },
      ],
    });
  });

  it('returns waiting when no telemetry is available', async () => {
    const service = new ControlAutoV2LiveService(
      {} as any,
      {
        get: jest.fn().mockResolvedValue({
          matchId: 'match-1',
          status: 'LIVE',
          startedAt: '2026-04-20T10:00:00.000Z',
          endedAt: null,
          version: 1,
          updatedAt: '2026-04-20T10:01:00.000Z',
          summary: {
            totalTeams: 1,
            aliveTeams: 1,
            totalPlayers: 4,
            alivePlayers: 4,
          },
          circle: null,
          observedPlayer: null,
          killFeed: [],
          events: [],
          teams: [
            {
              teamId: 'team-1',
              name: 'Alpha',
              tag: 'ALP',
              slot: 1,
              kills: 0,
              placement: null,
              logoUrl: null,
              alivePlayers: 4,
              totalPlayers: 4,
              players: [
                {
                  id: 'p-1',
                  playerId: 'player-1',
                  teamId: 'team-1',
                  name: 'Seeded Player',
                  ign: 'Seeded Player',
                  alive: true,
                  knocked: false,
                  kills: 0,
                },
              ],
            },
          ],
        }),
      } as any,
    );

    await expect(
      service.getLive({ organizationId: 'org-1' } as any, 'match-1'),
    ).resolves.toEqual({
      telemetryStatus: 'waiting',
      phase: null,
      aliveTeams: null,
      alivePlayers: null,
      teams: [],
      players: [],
    });
  });
});
