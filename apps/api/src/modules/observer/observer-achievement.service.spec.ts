import { ObserverAchievementService } from './observer-achievement.service';

describe('ObserverAchievementService', () => {
  it('accepts FIRST_BLOOD events from the broadcast moment stream', () => {
    const emitObserverAchievement = jest.fn();
    let handler:
      | ((envelope: {
          id?: string;
          payload: {
            matchId: string;
            broadcastEvent: Record<string, unknown>;
          };
        }) => void)
      | null = null;
    const eventBus = {
      subscribe: jest
        .fn()
        .mockImplementation(
          (
            _topic: string,
            _subscriberName: string,
            nextHandler: typeof handler,
          ) => {
            handler = nextHandler;
            return jest.fn();
          },
        ),
    } as any;
    const realtime = {
      emitObserverAchievement,
    } as any;

    const service = new ObserverAchievementService(eventBus, realtime);
    service.onModuleInit();

    handler?.({
      id: 'first-blood-1',
      payload: {
        matchId: 'match-1',
        broadcastEvent: {
          type: 'FIRST_BLOOD',
          timestamp: Date.parse('2026-03-18T10:00:00.000Z'),
          playerId: 'player-1',
          playerName: 'Volt',
          teamId: 'team-1',
          teamName: 'Arenzyra',
          teamTag: 'VTX',
        },
      },
    });

    expect(emitObserverAchievement).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: 'match-1',
        eventId: 'first-blood-1',
        type: 'FIRST_BLOOD',
      }),
    );
    expect(service.list('match-1')).toHaveLength(1);
  });

  it('buffers and emits achievement events from the broadcast moment stream', () => {
    const emitObserverAchievement = jest.fn();
    let handler:
      | ((envelope: {
          id?: string;
          payload: {
            matchId: string;
            broadcastEvent: Record<string, unknown>;
          };
        }) => void)
      | null = null;
    const eventBus = {
      subscribe: jest
        .fn()
        .mockImplementation(
          (
            _topic: string,
            _subscriberName: string,
            nextHandler: typeof handler,
          ) => {
            handler = nextHandler;
            return jest.fn();
          },
        ),
    } as any;
    const realtime = {
      emitObserverAchievement,
    } as any;

    const service = new ObserverAchievementService(eventBus, realtime);
    service.onModuleInit();

    expect(handler).not.toBeNull();

    handler!({
      id: 'event-1',
      payload: {
        matchId: 'match-1',
        broadcastEvent: {
          type: 'TRIPLE_KILL',
          timestamp: Date.parse('2026-03-18T10:00:00.000Z'),
          playerId: 'player-1',
          playerName: 'Volt',
          playerPhotoUrl: 'https://cdn.example.com/volt.png',
          teamId: 'team-1',
          teamName: 'Arenzyra',
          teamTag: 'VTX',
          teamLogoUrl: 'https://cdn.example.com/vtx.png',
        },
      },
    });

    expect(emitObserverAchievement).toHaveBeenCalledWith({
      matchId: 'match-1',
      eventId: 'event-1',
      type: 'TRIPLE_KILL',
      player: {
        id: 'player-1',
        name: 'Volt',
        photoUrl: 'https://cdn.example.com/volt.png',
      },
      team: {
        id: 'team-1',
        name: 'Arenzyra',
        tag: 'VTX',
        logoUrl: 'https://cdn.example.com/vtx.png',
      },
      timestamp: '2026-03-18T10:00:00.000Z',
    });
    expect(service.list('match-1')).toHaveLength(1);

    handler!({
      id: 'event-1',
      payload: {
        matchId: 'match-1',
        broadcastEvent: {
          type: 'TRIPLE_KILL',
          timestamp: Date.parse('2026-03-18T10:00:00.000Z'),
          playerId: 'player-1',
        },
      },
    });

    expect(service.list('match-1')).toHaveLength(1);
    expect(emitObserverAchievement).toHaveBeenCalledTimes(1);
  });

  it('keeps the last 50 buffered events per match in FIFO order', () => {
    let handler:
      | ((envelope: {
          id?: string;
          payload: {
            matchId: string;
            broadcastEvent: Record<string, unknown>;
          };
        }) => void)
      | null = null;
    const eventBus = {
      subscribe: jest
        .fn()
        .mockImplementation(
          (
            _topic: string,
            _subscriberName: string,
            nextHandler: typeof handler,
          ) => {
            handler = nextHandler;
            return jest.fn();
          },
        ),
    } as any;
    const realtime = {
      emitObserverAchievement: jest.fn(),
    } as any;

    const service = new ObserverAchievementService(eventBus, realtime);
    service.onModuleInit();

    expect(handler).not.toBeNull();

    for (let index = 0; index < 55; index += 1) {
      handler!({
        id: `event-${index}`,
        payload: {
          matchId: 'match-1',
          broadcastEvent: {
            type: 'TRIPLE_KILL',
            timestamp: Date.parse('2026-03-18T10:00:00.000Z') + index,
            playerId: `player-${index}`,
          },
        },
      });
    }

    const buffered = service.list('match-1');
    expect(buffered).toHaveLength(50);
    expect(buffered[0]?.eventId).toBe('event-5');
    expect(buffered[49]?.eventId).toBe('event-54');
  });
});
