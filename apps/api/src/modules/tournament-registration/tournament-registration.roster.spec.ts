import {
  normalizeTournamentRegistrationRoster,
  parseTournamentRegistrationRoster,
} from './tournament-registration.roster';

describe('tournament registration roster validation', () => {
  it('accepts exactly four mains and up to two substitutes', () => {
    expect(
      normalizeTournamentRegistrationRoster({
        main: [
          { name: 'Alpha' },
          { name: 'Bravo' },
          { name: 'Charlie' },
          { name: 'Delta' },
        ],
        subs: [{ name: 'Echo' }, { name: 'Foxtrot' }],
      }),
    ).toEqual({
      main: [
        { name: 'Alpha' },
        { name: 'Bravo' },
        { name: 'Charlie' },
        { name: 'Delta' },
      ],
      subs: [{ name: 'Echo' }, { name: 'Foxtrot' }],
    });
  });

  it('rejects duplicate names across main players and substitutes', () => {
    expect(() =>
      normalizeTournamentRegistrationRoster({
        main: [
          { name: 'Alpha' },
          { name: 'Bravo' },
          { name: 'Charlie' },
          { name: 'Delta' },
        ],
        subs: [{ name: 'alpha' }],
      }),
    ).toThrow('Duplicate player names are not allowed');
  });

  it('rejects malformed stored roster payloads', () => {
    expect(() => parseTournamentRegistrationRoster(null)).toThrow(
      'Stored registration roster is invalid',
    );
  });
});
