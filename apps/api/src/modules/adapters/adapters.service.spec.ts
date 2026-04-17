import { GameKey } from '@prisma/client';
import { AdaptersService } from './adapters.service';

describe('AdaptersService', () => {
  it('registers pubgm-pcob for PUBG Mobile', () => {
    const service = new AdaptersService();

    expect(service.getAdapterByKey('pubgm-pcob')).toMatchObject({
      key: 'pubgm-pcob',
      gameKey: GameKey.PUBG_MOBILE,
    });
    expect(service.getAdaptersByGame(GameKey.PUBG_MOBILE)).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'pubgm-pcob' })]),
    );
  });
});
