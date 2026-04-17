import {
  deriveCanonicalMatchLifecycleStatus,
  deriveMatchLockContract,
  deriveControlStateFromMatchStatus,
  derivePublicControlStatus,
} from './match-status.util';

describe('match status public lifecycle contract', () => {
  it('surfaces FINISH_PENDING as ended/finalizing and never as public live', () => {
    expect(
      deriveCanonicalMatchLifecycleStatus({ status: 'FINISH_PENDING' }),
    ).toBe('ENDED');
    expect(deriveControlStateFromMatchStatus('FINISH_PENDING')).toBe('ENDED');
    expect(
      derivePublicControlStatus({
        status: 'FINISH_PENDING',
        controlState: 'LIVE',
      }),
    ).toBe('ENDED');
  });

  it('only surfaces confirmed once finalization has actually completed', () => {
    expect(
      derivePublicControlStatus({
        status: 'ENDED',
        controlState: 'ENDED',
      }),
    ).toBe('ENDED');
    expect(
      derivePublicControlStatus({
        status: 'FINISHED',
        controlState: 'CONFIRMED',
        metaJson: { resultFinalized: true },
      }),
    ).toBe('CONFIRMED');
  });

  it('keeps automatic results locked through ended and only unlocks after explicit finalized reopen', () => {
    expect(
      deriveMatchLockContract({
        status: 'ENDED',
        controlState: 'ENDED',
        dataSource: 'PCOB',
      }),
    ).toEqual(
      expect.objectContaining({
        lifecycleStatus: 'ENDED',
        resultsLocked: true,
        resultLockState: 'LOCKED',
        reason: 'Results remain locked until match finalization completes.',
      }),
    );

    expect(
      deriveMatchLockContract({
        status: 'FINISHED',
        controlState: 'CONFIRMED',
        dataSource: 'PCOB',
        metaJson: { resultFinalized: true },
      }),
    ).toEqual(
      expect.objectContaining({
        lifecycleStatus: 'FINISHED',
        resultsLocked: true,
        resultLockState: 'LOCKED',
        reason: 'Results are finalized for this match.',
      }),
    );

    expect(
      deriveMatchLockContract({
        status: 'FINISHED',
        controlState: 'CONFIRMED',
        dataSource: 'PCOB',
        metaJson: { resultFinalized: true },
        forceUnlock: true,
      }),
    ).toEqual(
      expect.objectContaining({
        lifecycleStatus: 'FINISHED',
        resultsLocked: false,
        resultLockState: 'UNLOCKED',
        reason: 'Results are reopened for manual editing.',
      }),
    );
  });
});
