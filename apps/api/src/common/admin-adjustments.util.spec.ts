import {
  aggregatePointDeltaForScope,
  applyMatchScoreAdjustments,
} from './admin-adjustments.util';

describe('admin adjustments scoring utility', () => {
  const matchContext = {
    id: 'match-1',
    tournamentId: 'tournament-1',
    stageId: 'stage-1',
    groupId: 'group-1',
    sessionId: 'session-1',
  };

  it('applies match point deltas once to the base match score', () => {
    const adjusted = applyMatchScoreAdjustments(
      15,
      [
        {
          teamId: 'team-1',
          type: 'POINT_DELTA',
          scope: 'MATCH',
          matchId: 'match-1',
          pointsDelta: -3,
        },
        {
          teamId: 'team-1',
          type: 'POINT_DELTA',
          scope: 'TOURNAMENT',
          tournamentId: 'tournament-1',
          pointsDelta: -10,
        },
      ],
      matchContext,
    );

    expect(adjusted).toMatchObject({
      totalPoints: 12,
      pointsDelta: -3,
      zeroed: false,
      disqualified: false,
    });
  });

  it('zeros a match when a matching group disqualification exists', () => {
    const adjusted = applyMatchScoreAdjustments(
      18,
      [
        {
          teamId: 'team-1',
          type: 'DISQUALIFY_GROUP',
          scope: 'GROUP',
          groupId: 'group-1',
          pointsDelta: 0,
        },
      ],
      matchContext,
    );

    expect(adjusted.totalPoints).toBe(0);
    expect(adjusted.disqualified).toBe(true);
  });

  it('rolls descendant aggregate point deltas into tournament totals', () => {
    const delta = aggregatePointDeltaForScope(
      [
        {
          teamId: 'team-1',
          type: 'POINT_DELTA',
          scope: 'GROUP',
          groupId: 'group-1',
          pointsDelta: -2,
        },
        {
          teamId: 'team-1',
          type: 'POINT_DELTA',
          scope: 'STAGE',
          stageId: 'stage-1',
          pointsDelta: -4,
        },
        {
          teamId: 'team-1',
          type: 'POINT_DELTA',
          scope: 'MATCH',
          matchId: 'match-1',
          pointsDelta: -99,
        },
      ],
      'TOURNAMENT',
      'tournament-1',
      {
        TOURNAMENT: ['tournament-1'],
        STAGE: ['stage-1'],
        GROUP: ['group-1'],
      },
    );

    expect(delta).toBe(-6);
  });
});
