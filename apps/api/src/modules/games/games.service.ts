import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { DEFAULT_GAMES } from './games.constants';

@Injectable()
export class GamesService implements OnModuleInit {
  private readonly logger = new Logger('GamesService');

  constructor(private prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureSeedData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[GamesService] skipped default games seed: ${msg}`);
    }
  }

  async ensureSeedData() {
    await Promise.all(
      DEFAULT_GAMES.map((game) =>
        this.prisma.game.upsert({
          where: { key: game.key },
          update: { name: game.name },
          create: { key: game.key, name: game.name },
        }),
      ),
    );
  }

  listEnabled(): Promise<any[]> {
    return this.prisma.game.findMany({
      where: { isEnabled: true },
      orderBy: { name: 'asc' },
    });
  }

  listAll(): Promise<any[]> {
    return this.prisma.game.findMany({
      orderBy: { name: 'asc' },
    });
  }
}
