import {
  deriveControlLiveState,
  deriveGroupStateFromMatches,
  isLiveMatchLifecycle,
  deriveStageStateFromGroups,
  deriveTournamentStateFromMatches,
} from './live-state.util';

describe('live-state derivation', () => {
  it('marks group ended when only match ends', () => {
    const state = deriveGroupStateFromMatches([
      { controlState: { state: 'ENDED' } },
    ]);
    expect(state).toBe('ENDED');
  });

  it('keeps group live when another match is still live', () => {
    const state = deriveGroupStateFromMatches([
      { controlState: { state: 'ENDED' } },
      { controlState: { state: 'LIVE' } },
    ]);
    expect(state).toBe('LIVE');
  });

  it('derives tournament ended when all matches ended', () => {
    const state = deriveTournamentStateFromMatches([
      { controlState: { state: 'ENDED' } },
      { controlState: { state: 'CONFIRMED' } },
    ]);
    expect(state).toBe('ENDED');
  });

  it('derives stage live when any group live', () => {
    const state = deriveStageStateFromGroups([
      {
        state: deriveGroupStateFromMatches([
          { controlState: { state: 'LIVE' } },
        ]),
      },
      {
        state: deriveGroupStateFromMatches([
          { controlState: { state: 'ENDED' } },
        ]),
      },
    ]);
    expect(state).toBe('LIVE');
  });

  it('derives stage ended when all groups ended', () => {
    const state = deriveStageStateFromGroups([
      { state: 'ENDED' },
      { state: 'ENDED' },
    ]);
    expect(state).toBe('ENDED');
  });

  it('derives upcoming when none live or ended yet', () => {
    const state = deriveGroupStateFromMatches([
      { controlState: { state: 'READY' } },
      { controlState: { state: 'COUNTDOWN' } },
    ]);
    expect(state).toBe('UPCOMING');
  });

  it('treats paused as live-like for derivation', () => {
    const derived = deriveControlLiveState('PAUSED');
    expect(derived).toBe('LIVE');
  });

  it('treats paused control state as a live delete lock', () => {
    expect(
      isLiveMatchLifecycle({
        controlState: { state: 'PAUSED' },
      }),
    ).toBe(true);
  });

  it('treats live status as a live delete lock', () => {
    expect(
      isLiveMatchLifecycle({
        status: 'LIVE',
        controlState: { state: 'READY' },
      }),
    ).toBe(true);
  });

  it('does not lock delete for non-live ended or upcoming matches', () => {
    expect(
      isLiveMatchLifecycle({
        status: 'ENDED',
        liveState: 'ENDED',
        controlState: { state: 'FINISHED' },
      }),
    ).toBe(false);
    expect(
      isLiveMatchLifecycle({
        status: 'DRAFT',
        liveState: 'UPCOMING',
        controlState: { state: 'READY' },
      }),
    ).toBe(false);
  });
});
