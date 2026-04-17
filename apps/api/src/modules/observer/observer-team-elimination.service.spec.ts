import { ObserverTeamEliminationService } from './observer-team-elimination.service';

describe('ObserverTeamEliminationService', () => {
  it('stores, sorts, and emits team elimination events', () => {
    const emitObserverTeamEliminated = jest.fn();
    const realtime = {
      emitObserverTeamEliminated,
    } as any;

    const service = new ObserverTeamEliminationService(realtime);

    expect(
      service.publish({
        matchId: 'match-1',
        eventId: 'event-2',
        teamId: 'team-2',
        teamName: 'Team Two',
        placement: 2,
        kills: 9,
        eliminatedAt: '2026-03-18T10:00:05.000Z',
      }),
    ).toBe(true);
    expect(
      service.publish({
        matchId: 'match-1',
        eventId: 'event-1',
        teamId: 'team-1',
        teamName: 'Team One',
        placement: 3,
        kills: 4,
        eliminatedAt: '2026-03-18T10:00:01.000Z',
      }),
    ).toBe(true);

    expect(service.list('match-1')).toEqual([
      {
        matchId: 'match-1',
        eventId: 'event-1',
        teamId: 'team-1',
        teamName: 'Team One',
        placement: 3,
        kills: 4,
        eliminatedAt: '2026-03-18T10:00:01.000Z',
      },
      {
        matchId: 'match-1',
        eventId: 'event-2',
        teamId: 'team-2',
        teamName: 'Team Two',
        placement: 2,
        kills: 9,
        eliminatedAt: '2026-03-18T10:00:05.000Z',
      },
    ]);
    expect(emitObserverTeamEliminated).toHaveBeenCalledTimes(2);
  });

  it('dedupes by eventId and keeps the latest 50 per match', () => {
    const realtime = {
      emitObserverTeamEliminated: jest.fn(),
    } as any;
    const service = new ObserverTeamEliminationService(realtime);

    expect(
      service.publish({
        matchId: 'match-1',
        eventId: 'event-1',
        teamId: 'team-1',
        teamName: 'Team One',
        placement: 16,
        kills: 0,
        eliminatedAt: '2026-03-18T10:00:00.000Z',
      }),
    ).toBe(true);
    expect(
      service.publish({
        matchId: 'match-1',
        eventId: 'event-1',
        teamId: 'team-1',
        teamName: 'Team One',
        placement: 16,
        kills: 0,
        eliminatedAt: '2026-03-18T10:00:00.000Z',
      }),
    ).toBe(false);

    for (let index = 0; index < 54; index += 1) {
      service.publish({
        matchId: 'match-2',
        eventId: `event-${index}`,
        teamId: `team-${index}`,
        teamName: `Team ${index}`,
        placement: 54 - index,
        kills: index,
        eliminatedAt: new Date(1_710_756_000_000 + index * 1000).toISOString(),
      });
    }

    const events = service.list('match-2');
    expect(events).toHaveLength(50);
    expect(events[0]?.eventId).toBe('event-4');
    expect(events.at(-1)?.eventId).toBe('event-53');
    expect(realtime.emitObserverTeamEliminated).toHaveBeenCalledTimes(55);
  });
});
