import { FightDetectionEngine } from './fight-detection.engine';

describe('FightDetectionEngine', () => {
  it('starts and updates a fight for repeated combat events within 15 seconds', () => {
    const engine = new FightDetectionEngine();

    const first = engine.processMatchEvents({
      matchId: 'match-1',
      sourceMode: 'AUTO',
      updatedAt: 1_000,
      events: [
        {
          id: 'kill-1',
          type: 'PLAYER_KILL',
          ts: 1_000,
          teamId: 'team-a',
          playerId: 'killer-a',
          payload: {
            killerTeamId: 'team-a',
            victimTeamId: 'team-b',
          },
        },
      ],
    });

    expect(first).toHaveLength(1);
    expect(first[0]?.type).toBe('FIGHT_STARTED');

    const second = engine.processMatchEvents({
      matchId: 'match-1',
      sourceMode: 'AUTO',
      updatedAt: 5_000,
      events: [
        {
          id: 'kill-2',
          type: 'PLAYER_KILL',
          ts: 5_000,
          teamId: 'team-b',
          playerId: 'killer-b',
          payload: {
            killerTeamId: 'team-b',
            victimTeamId: 'team-a',
          },
        },
      ],
    });

    expect(second.map((event) => event.type)).toEqual(['FIGHT_UPDATED']);
    expect(second[0]?.killsByTeam).toEqual({
      'team-a': 1,
      'team-b': 1,
    });
  });

  it('ends fights after 15 seconds of inactivity', () => {
    const engine = new FightDetectionEngine();

    engine.processMatchEvents({
      matchId: 'match-2',
      sourceMode: 'AUTO',
      updatedAt: 1_000,
      events: [
        {
          id: 'kill-1',
          type: 'PLAYER_KILL',
          ts: 1_000,
          teamId: 'team-a',
          playerId: 'killer-a',
          payload: {
            killerTeamId: 'team-a',
            victimTeamId: 'team-b',
          },
        },
      ],
    });

    const result = engine.processMatchEvents({
      matchId: 'match-2',
      sourceMode: 'AUTO',
      updatedAt: 17_000,
      events: [],
    });

    expect(result.map((event) => event.type)).toEqual(['FIGHT_ENDED']);
    expect(result[0]?.durationMs).toBe(16_000);
  });

  it('emits TEAM_WIPED and ends the fight when an active fight loses a team', () => {
    const engine = new FightDetectionEngine();

    engine.processMatchEvents({
      matchId: 'match-3',
      sourceMode: 'AUTO',
      updatedAt: 1_000,
      events: [
        {
          id: 'kill-1',
          type: 'PLAYER_KILL',
          ts: 1_000,
          teamId: 'team-a',
          playerId: 'killer-a',
          payload: {
            killerTeamId: 'team-a',
            victimTeamId: 'team-b',
          },
        },
      ],
    });

    const result = engine.processMatchEvents({
      matchId: 'match-3',
      sourceMode: 'AUTO',
      updatedAt: 2_000,
      events: [
        {
          id: 'elim-1',
          type: 'TEAM_ELIMINATED',
          ts: 2_000,
          teamId: 'team-b',
          playerId: null,
          payload: null,
        },
      ],
    });

    expect(result.map((event) => event.type)).toEqual([
      'TEAM_WIPED',
      'FIGHT_ENDED',
    ]);
    expect(result[0]?.teamId).toBe('team-b');
    expect(result[0]?.opponentTeamIds).toEqual(['team-a']);
  });

  it('detects telemetry fights after three combat events within 15 seconds', () => {
    const realtime = {
      emitFightDetected: jest.fn(),
    } as any;
    const engine = new FightDetectionEngine(undefined, realtime);
    const startedAt = Date.now();

    const first = engine.processTelemetryPacket({
      matchId: 'match-4',
      updatedAt: startedAt,
      kills: [
        {
          id: 'telemetry-kill-1',
          killerTeamId: 1,
          victimTeamId: 2,
          timestamp: startedAt,
          eventType: 'KILL',
        },
        {
          id: 'telemetry-kill-2',
          killerTeamId: 2,
          victimTeamId: 1,
          timestamp: startedAt + 6_000,
          eventType: 'KNOCK',
        },
        {
          id: 'telemetry-kill-3',
          killerTeamId: 1,
          victimTeamId: 2,
          timestamp: startedAt + 11_000,
          eventType: 'KILL',
        },
      ],
      teams: [
        {
          teamId: 'team-a',
          teamName: 'Alpha 7',
          teamTag: 'A7',
          logoUrl: 'https://cdn.example.com/a7.png',
          slot: 1,
        },
        {
          teamId: 'team-b',
          teamName: 'Nova',
          teamTag: 'NV',
          logoUrl: 'https://cdn.example.com/nv.png',
          slot: 2,
        },
      ],
    });

    expect(first).toEqual([
      {
        matchId: 'match-4',
        fightId: expect.stringContaining('fight-alert:match-4'),
        teams: [
          {
            teamId: 'team-a',
            teamName: 'Alpha 7',
            teamTag: 'A7',
            logoUrl: 'https://cdn.example.com/a7.png',
            slot: 1,
          },
          {
            teamId: 'team-b',
            teamName: 'Nova',
            teamTag: 'NV',
            logoUrl: 'https://cdn.example.com/nv.png',
            slot: 2,
          },
        ],
        eventCount: 3,
        startedAt: new Date(startedAt).toISOString(),
        lastEventAt: new Date(startedAt + 11_000).toISOString(),
      },
    ]);
    expect(realtime.emitFightDetected).toHaveBeenCalledWith(first[0]);
    expect(engine.getActiveDetectedFights('match-4')).toEqual(first);
  });

  it('expires telemetry fights after 15 seconds of inactivity', () => {
    const engine = new FightDetectionEngine();
    const startedAt = Date.now();

    engine.processTelemetryPacket({
      matchId: 'match-5',
      updatedAt: startedAt,
      kills: [
        {
          id: 'telemetry-kill-1',
          killerTeamId: 1,
          victimTeamId: 2,
          timestamp: startedAt,
          eventType: 'KILL',
        },
        {
          id: 'telemetry-kill-2',
          killerTeamId: 2,
          victimTeamId: 1,
          timestamp: startedAt + 4_000,
          eventType: 'KNOCK',
        },
        {
          id: 'telemetry-kill-3',
          killerTeamId: 1,
          victimTeamId: 2,
          timestamp: startedAt + 8_000,
          eventType: 'KILL',
        },
      ],
      teams: [
        {
          teamId: 'team-a',
          teamName: 'Alpha 7',
          teamTag: 'A7',
          logoUrl: null,
          slot: 1,
        },
        {
          teamId: 'team-b',
          teamName: 'Nova',
          teamTag: 'NV',
          logoUrl: null,
          slot: 2,
        },
      ],
    });

    expect(engine.getActiveDetectedFights('match-5')).toHaveLength(1);

    engine.processTelemetryPacket({
      matchId: 'match-5',
      updatedAt: startedAt + 25_000,
      kills: [],
      teams: [],
    });

    expect(engine.getActiveDetectedFights('match-5')).toEqual([]);
  });
});
