import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../../db/prisma.service';

type TeamAssetPayload = {
  teamId: string;
  slot: number | null;
  name: string | null;
  tag: string | null;
  logoUrl: string | null;
};

type PlayerAssetPayload = {
  playerId: string;
  ign: string | null;
  name: string | null;
  teamId: string | null;
  photoUrl: string | null;
};

type AssetPushPayload = {
  matchId: string;
  teams: TeamAssetPayload[];
  players: PlayerAssetPayload[];
};

@Injectable()
export class ShadowPushService {
  private readonly logger = new Logger('ShadowPush');

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Push team logos and player photos to the configured Shadow/PCOB bridge.
   * This does not fail the caller; errors are logged and swallowed.
   */
  async pushAssets(matchId: string): Promise<void> {
    const payload = await this.buildPayload(matchId);
    if (!payload) {
      this.logger.warn(
        `Shadow push skipped: match ${matchId} not found or has no teams`,
      );
      return;
    }

    const baseUrl =
      (
        process.env.SHADOW_API_PUSH_BASE || process.env.SHADOW_API_BASE
      )?.replace(/\/$/, '') || 'http://127.0.0.1:5000';
    const path = process.env.SHADOW_API_ASSET_PATH || '/teamassets';
    const url = `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;

    try {
      await axios.post(url, payload, { timeout: 5_000 });
      this.logger.log(
        `Pushed ${payload.teams.length} teams and ${payload.players.length} players to shadow bridge (${url})`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Shadow asset push failed: ${message}`);
    }
  }

  private async buildPayload(
    matchId: string,
  ): Promise<AssetPushPayload | null> {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      include: {
        matchSlots: {
          where: { team: { deletedAt: null } },
          include: {
            team: {
              include: {
                players: {
                  where: { deletedAt: null },
                  select: {
                    id: true,
                    ign: true,
                    realName: true,
                    photoUrl: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!match) return null;

    const teams: TeamAssetPayload[] = [];
    const players: PlayerAssetPayload[] = [];

    for (const slot of match.matchSlots) {
      const team = slot.team;
      if (!team) continue;
      teams.push({
        teamId: team.id,
        slot: slot.slotNumber ?? null,
        name: team.name ?? null,
        tag: team.tag ?? null,
        logoUrl: team.logoUrl ?? null,
      });
      for (const p of team.players) {
        players.push({
          playerId: p.id,
          ign: p.ign ?? null,
          name: p.realName ?? null,
          teamId: team.id,
          photoUrl: p.photoUrl ?? null,
        });
      }
    }

    return {
      matchId,
      teams,
      players,
    };
  }
}
