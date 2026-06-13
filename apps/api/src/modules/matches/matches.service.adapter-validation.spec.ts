import { GameKey } from '@prisma/client';
import { MatchesService } from './matches.service';

describe('MatchesService adapter/game validation', () => {
  const buildService = () => {
    const prisma = {
      _dmmf: { modelMap: { Match: { fields: [] } } },
      game: {
        findUnique: jest.fn(
          async ({ where }: { where: Record<string, unknown> }) => {
            if (where.id === 'game-pubgm') {
              return { id: 'game-pubgm', key: GameKey.PUBG_MOBILE };
            }
            if (where.id === 'game-ff') {
              return { id: 'game-ff', key: GameKey.FREE_FIRE };
            }
            if (where.key === GameKey.PUBG_MOBILE) {
              return { id: 'game-pubgm', key: GameKey.PUBG_MOBILE };
            }
            if (where.key === GameKey.FREE_FIRE) {
              return { id: 'game-ff', key: GameKey.FREE_FIRE };
            }
            return null;
          },
        ),
      },
      organization: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'org-1',
          planId: 'multi-game-production',
          accessMode: null,
          enabledGames: [GameKey.PUBG_MOBILE, GameKey.FREE_FIRE],
        }),
      },
    } as any;

    const adapters = {
      getAdapterByKey: jest.fn((key: string | null | undefined) => {
        const normalized = `${key ?? ''}`.trim().toLowerCase();
        if (normalized === 'pubgm-manual') {
          return { key: 'pubgm-manual', gameKey: GameKey.PUBG_MOBILE };
        }
        return null;
      }),
    } as any;

    const service = new MatchesService(
      prisma,
      {} as any,
      {} as any,
      adapters,
      {} as any,
      {} as any,
      { emitResultsLockState: jest.fn() } as any,
      {} as any,
      { emitForMatch: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    return { service };
  };

  const groupContext = {
    groupId: 'group-1',
    stageId: 'stage-1',
    tournamentId: 'tournament-1',
    organizationId: 'org-1',
    tournamentGameKey: null,
  };

  it('does not default missing gameKey to PUBG during create input resolution', async () => {
    const { service } = buildService();

    await expect(
      (service as any).buildMatchCreateInput(
        { name: 'Missing Game' },
        groupContext,
      ),
    ).rejects.toThrow('gameKey is required');
  });

  it('resolves the provided gameKey to the matching gameId', async () => {
    const { service } = buildService();

    const input = await (service as any).buildMatchCreateInput(
      {
        name: 'Free Fire Match',
        gameKey: GameKey.FREE_FIRE,
      },
      groupContext,
    );

    expect(input.gameId).toBe('game-ff');
  });

  it('rejects adapterKey values that do not match the effective gameKey', async () => {
    const { service } = buildService();

    await expect(
      (service as any).buildMatchCreateInput(
        {
          name: 'Mismatched Adapter',
          gameKey: GameKey.FREE_FIRE,
          adapterKey: 'pubgm-manual',
        },
        groupContext,
      ),
    ).rejects.toThrow(
      'adapterKey pubgm-manual is not valid for gameKey FREE_FIRE',
    );
  });
});
