import { Logger } from '@nestjs/common';
import {
  MatchControlStateStore,
  computeAliveTeams,
  computeTotalTeams,
  countPlayers,
  isAutomaticMatchStateSourceMode,
  toCanonicalMatchStateSourceMode,
  type LiveMatchState,
} from './state.store';

describe('MatchControlStateStore', () => {
  const createStore = () =>
    new MatchControlStateStore({
      getClient: () => null,
    } as any);

  const buildState = (
    matchId: string,
    aliveTeams: number,
    totalTeams: number,
    totalPlayersPerTeam: number,
    options?: {
      startedAt?: string;
    },
  ): LiveMatchState => ({
    matchId,
    status: 'LIVE',
    startedAt:
      options?.startedAt ?? new Date('2026-03-18T10:00:00.000Z').toISOString(),
    endedAt: null,
    version: 0,
    updatedAt: new Date('2026-03-18T10:00:00.000Z').toISOString(),
    teams: Array.from({ length: totalTeams }, (_, index) => ({
      teamId: `team-${index + 1}`,
      name: `Team ${index + 1}`,
      tag: null,
      slot: index + 1,
      kills: 0,
      placement: null,
      points: null,
      logoUrl: null,
      alivePlayers: index < aliveTeams ? totalPlayersPerTeam : 0,
      totalPlayers: totalPlayersPerTeam,
      alive: index < aliveTeams,
      eliminated: index >= aliveTeams,
    })),
    summary: {
      totalTeams,
      aliveTeams,
      totalPlayers: totalTeams * totalPlayersPerTeam,
      alivePlayers: aliveTeams * totalPlayersPerTeam,
      winnerTeamId: aliveTeams === 1 ? 'team-1' : null,
      winnerSlot: aliveTeams === 1 ? 1 : null,
    },
  });

  it('marks a live state initialized only after valid telemetry appears', async () => {
    const store = createStore();

    const saved = await store.save('match-1', buildState('match-1', 2, 10, 1));

    expect(saved.initialized).toBe(true);
    expect(saved.firstValidAt).toEqual(expect.any(Number));
    expect(saved.loggedInit).toBe(true);
    expect(computeAliveTeams(saved)).toBe(2);
    expect(computeTotalTeams(saved)).toBe(10);
    expect(countPlayers(saved)).toBe(10);
  });

  it('does not initialize on empty telemetry and keeps initialization once set', async () => {
    const store = createStore();
    const nowMs = Date.parse('2026-03-18T10:01:00.000Z');
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(nowMs);

    try {
      const first = await store.save(
        'match-2',
        buildState('match-2', 0, 10, 0),
      );
      const second = await store.save(
        'match-2',
        buildState('match-2', 2, 10, 1),
      );
      const third = await store.save(
        'match-2',
        buildState('match-2', 0, 10, 1),
      );

      expect(first.initialized).toBe(false);
      expect(first.firstValidAt).toBeUndefined();
      expect(second.initialized).toBe(true);
      expect(second.firstValidAt).toEqual(expect.any(Number));
      expect(third.initialized).toBe(true);
      expect(third.firstValidAt).toBe(second.firstValidAt);
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('falls back to initialization after the max wait timeout', async () => {
    const store = createStore();
    const nowMs = Date.parse('2026-03-18T10:02:01.000Z');
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(nowMs);

    try {
      const saved = await store.save(
        'match-3',
        buildState('match-3', 0, 10, 0, {
          startedAt: '2026-03-18T10:00:00.000Z',
        }),
      );

      expect(saved.initialized).toBe(true);
      expect(saved.firstValidAt).toBe(nowMs);
      expect(saved.loggedInit).toBe(true);
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('tracks single-team stability across saves', async () => {
    const store = createStore();
    const firstNow = Date.parse('2026-03-18T10:00:00.000Z');
    const secondNow = Date.parse('2026-03-18T10:00:01.000Z');
    const thirdNow = Date.parse('2026-03-18T10:00:02.000Z');
    const fourthNow = Date.parse('2026-03-18T10:00:05.500Z');
    const dateNowSpy = jest.spyOn(Date, 'now');

    try {
      dateNowSpy.mockReturnValue(firstNow);
      const first = await store.save(
        'match-4',
        buildState('match-4', 2, 10, 1),
      );

      dateNowSpy.mockReturnValue(secondNow);
      const second = await store.save(
        'match-4',
        buildState('match-4', 1, 10, 1),
        first.version,
      );

      dateNowSpy.mockReturnValue(thirdNow);
      const third = await store.save(
        'match-4',
        buildState('match-4', 1, 10, 1),
        second.version,
      );

      dateNowSpy.mockReturnValue(fourthNow);
      const fourth = await store.save(
        'match-4',
        buildState('match-4', 2, 10, 1),
        third.version,
      );

      expect(first.lastAliveTeams).toBe(2);
      expect(second.lastAliveTeams).toBe(1);
      expect(second.lastAliveTeamsAt).toBe(secondNow);
      expect(third.lastAliveTeams).toBe(1);
      expect(third.lastAliveTeamsAt).toBe(secondNow);
      expect(fourth.lastAliveTeams).toBe(2);
      expect(fourth.lastAliveTeamsAt).toBe(fourthNow);
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('logs telemetry initialization exactly once', async () => {
    const store = createStore();
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    try {
      await store.save('match-5', buildState('match-5', 2, 10, 1));
      await store.save('match-5', buildState('match-5', 2, 10, 1), 1);

      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith(
        '[Match] Telemetry initialized matchId=match-5',
      );
    } finally {
      logSpy.mockRestore();
    }
  });

  it('treats API, AUTO, and HYBRID as automatic source aliases', () => {
    expect(isAutomaticMatchStateSourceMode('API')).toBe(true);
    expect(isAutomaticMatchStateSourceMode('AUTO')).toBe(true);
    expect(isAutomaticMatchStateSourceMode('HYBRID')).toBe(true);
    expect(isAutomaticMatchStateSourceMode('MANUAL')).toBe(false);
  });

  it('canonicalizes automatic source aliases to API', () => {
    expect(toCanonicalMatchStateSourceMode('API')).toBe('API');
    expect(toCanonicalMatchStateSourceMode('AUTO')).toBe('API');
    expect(toCanonicalMatchStateSourceMode('HYBRID')).toBe('API');
    expect(toCanonicalMatchStateSourceMode('MANUAL')).toBe('MANUAL');
    expect(toCanonicalMatchStateSourceMode(null)).toBeNull();
  });
});
