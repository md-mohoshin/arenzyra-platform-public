import { GameKey } from '@prisma/client';
import { GameAdaptersResolver } from './game-adapters.resolver';

describe('GameAdaptersResolver', () => {
  const buildResolver = () => {
    const prisma = {
      match: {
        findUnique: jest.fn(),
      },
    } as any;

    const adaptersService = {
      getAdaptersByGame: jest.fn((gameKey: GameKey) =>
        gameKey === GameKey.PUBG_MOBILE
          ? [{ key: 'pubgm-manual', isEnabledByDefault: true }]
          : [],
      ),
    } as any;

    const nullAdapter = { key: 'null-adapter', gameKey: 'GENERIC' } as any;
    const pubgmAdapter = {
      key: 'pubgm-manual',
      gameKey: GameKey.PUBG_MOBILE,
    } as any;
    const pcobAdapter = {
      key: 'pubgm-pcob',
      gameKey: GameKey.PUBG_MOBILE,
    } as any;

    const resolver = new GameAdaptersResolver(
      prisma,
      adaptersService,
      nullAdapter,
      [pubgmAdapter, pcobAdapter, nullAdapter],
    );

    return { resolver, prisma, nullAdapter, pubgmAdapter, pcobAdapter };
  };

  it('returns NullAdapter when adapterKey is unknown instead of falling back to PUBG', async () => {
    const { resolver, prisma, nullAdapter } = buildResolver();
    prisma.match.findUnique.mockResolvedValue({
      id: 'match-1',
      adapterKey: 'unknown-adapter',
      game: { key: GameKey.PUBG_MOBILE },
      ruleset: null,
    });

    await expect(resolver.resolve('match-1')).resolves.toBe(nullAdapter);
  });

  it('still resolves by game when adapterKey is absent', async () => {
    const { resolver, prisma, pubgmAdapter } = buildResolver();
    prisma.match.findUnique.mockResolvedValue({
      id: 'match-1',
      adapterKey: null,
      game: { key: GameKey.PUBG_MOBILE },
      ruleset: null,
    });

    await expect(resolver.resolve('match-1')).resolves.toBe(pubgmAdapter);
  });

  it('resolves pubgm-pcob explicitly by adapterKey', async () => {
    const { resolver, prisma, pcobAdapter } = buildResolver();
    prisma.match.findUnique.mockResolvedValue({
      id: 'match-1',
      adapterKey: 'pubgm-pcob',
      game: { key: GameKey.PUBG_MOBILE },
      ruleset: null,
    });

    await expect(resolver.resolve('match-1')).resolves.toBe(pcobAdapter);
  });
});
