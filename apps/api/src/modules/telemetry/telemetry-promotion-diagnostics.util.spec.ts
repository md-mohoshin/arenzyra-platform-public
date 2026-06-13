import {
  sanitizeTelemetryPromotionDiagnostics,
  summarizeTelemetryPromotionDiagnosticsScrub,
} from './telemetry-promotion-diagnostics.util';

describe('telemetry-promotion-diagnostics.util', () => {
  it('removes player-level fields from raw-only teams', () => {
    expect(
      sanitizeTelemetryPromotionDiagnostics({
        computedAt: '2026-04-24T08:15:00.000Z',
        rawOnlyTeams: [
          {
            rawSlot: 15,
            rawTeamName: 'Team8',
            rawPlayerNames: ['Raw Alpha', 'Raw Bravo'],
            rawPlayerIdentifiers: ['raw-open-1', 'raw-open-2'],
            rosterPlayerNames: ['Roster Alpha', 'Roster Bravo'],
            matchedRosterIdentityCount: 0,
            matchedRosterNameCount: 0,
          },
        ],
      }),
    ).toEqual({
      computedAt: '2026-04-24T08:15:00.000Z',
      rawOnlyTeams: [
        {
          rawSlot: 15,
          rawTeamName: 'Team8',
          matchedRosterIdentityCount: 0,
          matchedRosterNameCount: 0,
        },
      ],
    });
  });

  it('summarizes how much sensitive data would be removed', () => {
    expect(
      summarizeTelemetryPromotionDiagnosticsScrub({
        rawOnlyTeams: [
          {
            rawPlayerNames: ['Raw Alpha', 'Raw Bravo'],
            rawPlayerIdentifiers: ['raw-open-1', 'raw-open-2', 'raw-open-3'],
            rosterPlayerNames: ['Roster Alpha'],
          },
          {
            rawPlayerNames: ['Raw Charlie'],
          },
        ],
      }),
    ).toEqual({
      rawPlayerNamesRemoved: 3,
      rawPlayerIdentifiersRemoved: 3,
      rosterPlayerNamesRemoved: 1,
      teamsTouched: 2,
    });
  });
});
