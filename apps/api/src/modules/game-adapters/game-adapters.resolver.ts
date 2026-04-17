import { Inject, Injectable, Logger } from '@nestjs/common';
import { GameKey } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { AdaptersService } from '../adapters/adapters.service';
import type { GameAdapter } from './game-adapter.interface';
import { NullAdapter } from './null.adapter';

export const GAME_ADAPTERS_TOKEN = 'GAME_ADAPTERS_TOKEN';

@Injectable()
export class GameAdaptersResolver {
  private readonly logger = new Logger(GameAdaptersResolver.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adaptersService: AdaptersService,
    private readonly nullAdapter: NullAdapter,
    @Inject(GAME_ADAPTERS_TOKEN) private readonly adapters: GameAdapter[],
  ) {}

  private findAdapterByKey(key: string | null | undefined): GameAdapter | null {
    if (!key) return null;
    const normalized = key.toLowerCase();
    const match = this.adapters.find((a) => a.key.toLowerCase() === normalized);
    return match ?? null;
  }

  private resolveByGame(
    gameKey: GameKey | null | undefined,
  ): GameAdapter | null {
    if (!gameKey) return null;
    const defs = this.adaptersService.getAdaptersByGame(gameKey);
    const preferred = defs.find((d) => d.isEnabledByDefault) ?? defs[0];
    if (!preferred) return null;
    return this.findAdapterByKey(preferred.key);
  }

  async resolve(matchId: string): Promise<GameAdapter> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        adapterKey: true,
        game: { select: { key: true } },
        ruleset: { select: { gameKey: true } },
      },
    });

    const adapterKey = match?.adapterKey ?? null;
    const byKey = this.findAdapterByKey(adapterKey);
    if (byKey) return byKey;
    if (adapterKey) {
      this.logger.warn(
        `Using NullAdapter for match=${matchId} (unknown adapterKey=${adapterKey})`,
      );
      return this.nullAdapter;
    }

    const gameKey = match?.game?.key ?? match?.ruleset?.gameKey ?? null;

    const byGame = this.resolveByGame(gameKey);
    if (byGame) return byGame;

    this.logger.warn(
      `Using NullAdapter for match=${matchId} (adapterKey=${adapterKey ?? 'none'}, gameKey=${
        gameKey ?? 'none'
      })`,
    );
    return this.nullAdapter;
  }
}
