import { uniqueSlotPlayerNames } from './slot-player-name.util';

describe('uniqueSlotPlayerNames', () => {
  it('keeps unique names unchanged', () => {
    expect(
      uniqueSlotPlayerNames([
        { playerName: 'Alpha', stableId: 'player-2' },
        { playerName: 'Bravo', stableId: 'player-1' },
      ]),
    ).toEqual(['Alpha', 'Bravo']);
  });

  it('disambiguates duplicate names deterministically', () => {
    expect(
      uniqueSlotPlayerNames([
        { playerName: 'Alpha', stableId: 'player-2' },
        { playerName: 'Alpha', stableId: 'player-1' },
        { playerName: 'Alpha (2)', stableId: 'player-3' },
        { playerName: 'Alpha', stableId: 'player-4' },
      ]),
    ).toEqual(['Alpha (3)', 'Alpha', 'Alpha (2)', 'Alpha (4)']);
  });

  it('falls back to Player for empty names', () => {
    expect(
      uniqueSlotPlayerNames([
        { playerName: '', stableId: 'player-1' },
        { playerName: '   ', stableId: 'player-2' },
      ]),
    ).toEqual(['Player', 'Player (2)']);
  });
});
