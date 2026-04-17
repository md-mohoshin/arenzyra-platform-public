jest.mock('../modules/teams/asset.util', () => ({
  findMediaFile: jest.fn(),
}));

import { findMediaFile } from '../modules/teams/asset.util';
import {
  ARENZYRA_DEFAULT_TEAM_BRANDING,
  resolveTeamBranding,
} from './team-branding.util';

describe('team-branding.util', () => {
  const findMediaFileMock = findMediaFile as jest.MockedFunction<
    typeof findMediaFile
  >;

  beforeEach(() => {
    findMediaFileMock.mockReturnValue(null);
  });

  it('returns assigned team branding when the team exists in match slots', () => {
    expect(
      resolveTeamBranding('team-1', [
        {
          teamId: 'team-1',
          team: {
            id: 'team-1',
            name: 'Team Falcons',
            tag: 'TF',
            logoUrl: '/logos/falcons.png',
          },
        },
      ]),
    ).toEqual({
      name: 'Team Falcons',
      tag: 'TF',
      logoUrl: '/logos/falcons.png',
    });
  });

  it('returns Arenzyra fallback branding for teams that are not assigned to slots', () => {
    expect(resolveTeamBranding('unknown-team', [])).toEqual({
      ...ARENZYRA_DEFAULT_TEAM_BRANDING,
    });
  });

  it('normalizes old localhost logo urls to relative asset paths', () => {
    expect(
      resolveTeamBranding('team-1', [
        {
          teamId: 'team-1',
          team: {
            id: 'team-1',
            name: 'Team Falcons',
            tag: 'TF',
            logoUrl: 'http://localhost:3000/media/teams/team-1/logo?v=123',
          },
        },
      ]),
    ).toEqual({
      name: 'Team Falcons',
      tag: 'TF',
      logoUrl: '/media/teams/team-1/logo?v=123',
    });
  });

  it('uses a stored uploaded logo when the database value is missing', () => {
    findMediaFileMock.mockReturnValue('C:\\media\\teams\\team-1\\logo.png');

    expect(
      resolveTeamBranding('team-1', [
        {
          teamId: 'team-1',
          team: {
            id: 'team-1',
            name: 'Team Falcons',
            tag: 'TF',
            logoUrl: null,
          },
        },
      ]),
    ).toEqual({
      name: 'Team Falcons',
      tag: 'TF',
      logoUrl: '/media/teams/team-1/logo',
    });
  });
});
