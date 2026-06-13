import { TelemetryValidatorService } from './telemetry-validator.service';

describe('TelemetryValidatorService', () => {
  it('allows supported end-match control commands', () => {
    const service = new TelemetryValidatorService();

    expect(() =>
      service.validateControlCommand(
        {
          matchId: 'match-1',
          version: 1,
          status: 'LIVE',
          mode: 'MANUAL',
          sequence: 1,
          updatedAt: Date.now(),
          startedAt: Date.now(),
          endedAt: null,
          teamsAlive: 1,
          teams: {
            'team-1': {
              teamId: 'team-1',
              alivePlayers: 1,
              eliminated: false,
              placement: null,
              totalKills: 0,
              totalPlayers: 1,
              eliminatedAt: null,
            },
          },
          players: {
            'player-1': {
              playerId: 'player-1',
              teamId: 'team-1',
              alive: true,
              knocked: false,
              kills: 0,
            },
          },
        },
        {
          type: 'END_MATCH',
          matchId: 'match-1',
        },
      ),
    ).not.toThrow();
  });
});
