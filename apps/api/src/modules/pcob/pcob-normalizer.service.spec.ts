import { PcobNormalizerService } from './pcob-normalizer.service';

describe('PcobNormalizerService', () => {
  it('treats a last remaining knocked player as eliminated', () => {
    const service = new PcobNormalizerService();

    const state = service.normalize({
      matchId: 'match-1',
      teams: [
        {
          teamId: 'team-1',
          players: [
            {
              pubgAccountId: 'player-1',
              ign: 'Alpha',
              alive: true,
              knocked: true,
              eliminated: false,
            },
          ],
        },
      ],
    });

    expect(state.teams[0]).toMatchObject({
      aliveCount: 0,
      eliminated: true,
    });
    expect(state.teams[0]?.players?.[0]).toMatchObject({
      alive: false,
      knocked: false,
      eliminated: true,
    });
  });
});
