import {
  findForbiddenObserverTelemetryFields,
  sanitizeObserverTelemetryPayload,
} from './observer-telemetry-contract.util';

describe('observer telemetry contract', () => {
  it('preserves live team placement fields while guarding player and final result fields', () => {
    const { sanitizedPayload, strippedFields } =
      sanitizeObserverTelemetryPayload({
        rank: 1,
        teams: [
          {
            teamId: 'team-1',
            rank: 2,
            placement: 2,
            placementIndex: 2,
            position: 2,
            finalPlacement: 2,
          },
        ],
        players: [
          {
            playerId: 'player-1',
            rank: 2,
            placement: 2,
          },
        ],
      });

    expect(strippedFields).toEqual(['players[0].rank', 'rank']);
    expect(sanitizedPayload).toEqual(
      expect.objectContaining({
        teams: [
          expect.objectContaining({
            rank: 2,
            placement: 2,
            placementIndex: 2,
            position: 2,
            finalPlacement: 2,
          }),
        ],
        players: [expect.objectContaining({ placement: 2 })],
      }),
    );

    const forbidden = findForbiddenObserverTelemetryFields(sanitizedPayload);

    expect(forbidden).toEqual(
      expect.arrayContaining([
        'players[0].placement',
        'teams[0].finalPlacement',
      ]),
    );
    expect(forbidden).not.toEqual(
      expect.arrayContaining([
        'teams[0].rank',
        'teams[0].placement',
        'teams[0].placementIndex',
        'teams[0].position',
      ]),
    );
  });
});
