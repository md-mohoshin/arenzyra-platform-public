import {
  deriveCanonicalMatchLifecycleStatus,
  deriveMatchLockContract,
  deriveControlStateFromMatchStatus,
  derivePublicControlStatus,
} from './match-status.util';

describe('match status public lifecycle contract', () => {
  it('surfaces FINISH_PENDING as a first-class finalizing state and never as public live', () => {
    expect(
      deriveCanonicalMatchLifecycleStatus({ status: 'FINISH_PENDING' }),
    ).toBe('FINISH_PENDING');
    expect(deriveControlStateFromMatchStatus('FINISH_PENDING')).toBe(
      'FINISH_PENDING',
    );
    expect(
      derivePublicControlStatus({
        status: 'FINISH_PENDING',
        controlState: 'LIVE',
      }),
    ).toBe('FINISH_PENDING');
  });

  it('only surfaces confirmed once finalization has actually completed', () => {
    expect(
      derivePublicControlStatus({
        status: 'ENDED',
        controlState: 'ENDED',
      }),
    ).toBe('FINISH_PENDING');
    expect(
      derivePublicControlStatus({
        status: 'FINISHED',
        controlState: 'CONFIRMED',
        metaJson: { resultFinalized: true },
      }),
    ).toBe('FINISHED');
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
        lifecycleStatus: 'FINISH_PENDING',
        resultsLocked: true,
        resultLockState: 'LOCKED',
        reason: 'Results remain locked until match finalization completes.',
      }),
    );

    expect(
      deriveMatchLockContract({
        status: 'FINISH_PENDING',
        controlState: 'FINISH_PENDING',
        dataSource: 'PCOB',
      }),
    ).toEqual(
      expect.objectContaining({
        lifecycleStatus: 'FINISH_PENDING',
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
