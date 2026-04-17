import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import {
  MeMatchesController,
  OrgMeMatchesController,
} from './matches.me.controller';

describe('MeMatchesController', () => {
  it('mounts manual team-player result updates on the canonical /me route', () => {
    expect(Reflect.getMetadata(PATH_METADATA, MeMatchesController)).toBe('me');
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        MeMatchesController.prototype.updateResultPlayers,
      ),
    ).toBe('matches/:matchId/results/team/:teamId/players');
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        MeMatchesController.prototype.updateResultPlayers,
      ),
    ).toBe(RequestMethod.PATCH);
  });

  it('does not expose manual team-player result updates under /org/me', () => {
    expect(Reflect.getMetadata(PATH_METADATA, OrgMeMatchesController)).toBe(
      'org/me',
    );
    expect('updateResultPlayers' in OrgMeMatchesController.prototype).toBe(
      false,
    );
  });
});
