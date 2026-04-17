import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import type { GameAdapter } from './game-adapter.interface';
import type {
  AdapterContext,
  AdapterSnapshot,
  AdapterGameKey,
} from './game-adapter.types';

/**
 * Safe fallback adapter. Returns minimal snapshot information without throwing.
 */
@Injectable()
export class NullAdapter implements GameAdapter {
  readonly key = 'null-adapter';
  readonly gameKey: AdapterGameKey = 'GENERIC';
  private readonly logger = new Logger(NullAdapter.name);

  constructor(private readonly prisma: PrismaService) {}

  async getSnapshot(
    matchId: string,
    _ctx: AdapterContext,
  ): Promise<AdapterSnapshot> {
    void _ctx;
    try {
      const match = await this.prisma.match.findUnique({
        where: { id: matchId },
        select: {
          id: true,
          name: true,
          map: true,
          status: true,
          startedAt: true,
          endedAt: true,
          dataSource: true,
        },
      });

      if (match) {
        return {
          match: {
            matchId: match.id,
            name: match.name ?? null,
            map: match.map ?? null,
            status: match.status ?? null,
            startedAt: match.startedAt,
            endedAt: match.endedAt,
            dataSource: match.dataSource ?? null,
            isLocked: false,
            snapshotAt: new Date(),
          },
          teams: [],
          players: [],
        };
      }
    } catch (err) {
      this.logger.warn(
        `NullAdapter failed to load match ${matchId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // Absolute fallback: empty snapshot that won't break callers.
    return {
      match: {
        matchId,
        name: null,
        map: null,
        status: null,
        dataSource: null,
        isLocked: null,
        snapshotAt: new Date(),
      },
      teams: [],
      players: [],
    };
  }
}
