import { HttpException, HttpStatus } from '@nestjs/common';
import {
  deriveResultLockState,
  ensureResultsUnlocked,
  type ResultLockState,
} from './results.lock';

describe('results lock derivation', () => {
  const cases: Array<{
    ctx: {
      liveState?: string | null;
      status?: string | null;
      manualLock?: boolean;
      forceUnlock?: boolean;
      dataSource?: string | null;
    };
    lock: ResultLockState;
  }> = [
    {
      ctx: { forceUnlock: true, liveState: 'LIVE', dataSource: 'API' },
      lock: 'LOCKED',
    },
    { ctx: { manualLock: true, liveState: 'LIVE' }, lock: 'LOCKED' },
    {
      ctx: { liveState: 'LIVE', status: 'UPCOMING', dataSource: 'API' },
      lock: 'LOCKED',
    },
    {
      ctx: { liveState: 'UPCOMING', status: 'LIVE', dataSource: 'AUTO' },
      lock: 'LOCKED',
    },
    {
      ctx: {
        liveState: 'LIVE',
        status: 'LIVE',
        dataSource: 'PCOB',
      },
      lock: 'LOCKED',
    },
    { ctx: { liveState: 'UPCOMING' }, lock: 'UNLOCKED' },
    { ctx: { liveState: 'ENDED', dataSource: 'API' }, lock: 'LOCKED' },
    { ctx: { status: 'DRAFT', dataSource: 'AUTO' }, lock: 'LOCKED' },
    { ctx: { status: 'ENDED', dataSource: 'AUTO' }, lock: 'LOCKED' },
    {
      ctx: { status: 'FINISH_PENDING', dataSource: 'MANUAL' },
      lock: 'UNLOCKED',
    },
    { ctx: { status: 'FINISHED', dataSource: 'MANUAL' }, lock: 'UNLOCKED' },
    {
      ctx: { status: 'FINISHED', dataSource: 'API', forceUnlock: true },
      lock: 'UNLOCKED',
    },
    { ctx: { liveState: 'ENDED' }, lock: 'UNLOCKED' },
    { ctx: { liveState: null }, lock: 'UNLOCKED' },
  ];

  it.each(cases)('maps context %# to %s', ({ ctx, lock }) => {
    expect(deriveResultLockState(ctx)).toBe(lock);
  });

  it('throws LockedException for locked states', () => {
    expect(() =>
      ensureResultsUnlocked({
        liveState: 'LIVE',
        dataSource: 'API',
      }),
    ).toThrow();
  });

  it('allows unlocked states', () => {
    expect(() =>
      ensureResultsUnlocked({
        liveState: 'UPCOMING',
        dataSource: 'MANUAL',
      }),
    ).not.toThrow();
    expect(() =>
      ensureResultsUnlocked({
        status: 'FINISHED',
        dataSource: 'AUTO',
        forceUnlock: true,
      }),
    ).not.toThrow();
  });

  it('uses required message', () => {
    try {
      ensureResultsUnlocked({
        liveState: 'LIVE',
        dataSource: 'API',
      });
      throw new Error('expected lock');
    } catch (err: unknown) {
      if (!(err instanceof Error)) throw err;
      expect(err.message).toBe(
        'Results are locked for the current match state.',
      );
    }
  });

  it('returns HTTP 409 for locked state', () => {
    try {
      ensureResultsUnlocked({
        liveState: 'LIVE',
        dataSource: 'API',
      });
      throw new Error('expected 409 CONFLICT');
    } catch (err: unknown) {
      if (err instanceof HttpException) {
        expect(err.getStatus()).toBe(HttpStatus.CONFLICT);
        return;
      }
      throw err;
    }
  });
});
