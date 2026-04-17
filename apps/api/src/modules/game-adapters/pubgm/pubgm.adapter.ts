/* eslint-disable @typescript-eslint/no-unused-vars */
import { Injectable } from '@nestjs/common';
import { GameKey } from '@prisma/client';
import { PrismaService } from '../../../db/prisma.service';
import type { GameAdapter } from '../game-adapter.interface';
import type { AdapterContext, AdapterSnapshot } from '../game-adapter.types';

@Injectable()
export class PubgmAdapter implements GameAdapter {
  readonly key = 'pubgm-manual';
  readonly gameKey: GameKey = GameKey.PUBG_MOBILE;

  constructor(private readonly prisma: PrismaService) {}

  async getSnapshot(
    matchId: string,
    _ctx: AdapterContext,
  ): Promise<AdapterSnapshot> {
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
          matchSlots: {
            select: {
              slotNumber: true,
              teamId: true,
              team: {
                select: {
                  id: true,
                  name: true,
                  tag: true,
                  logoUrl: true,
                },
              },
            },
          },
          matchTeams: {
            select: {
              team: {
                select: {
                  id: true,
                  name: true,
                  tag: true,
                  logoUrl: true,
                },
              },
            },
          },
          tournament: {
            select: {
              tournamentTeams: {
                select: {
                  team: {
                    select: {
                      id: true,
                      name: true,
                      tag: true,
                      logoUrl: true,
                      players: {
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
          },
        },
      });

      if (!match) {
        return {
          match: { matchId, snapshotAt: new Date() },
          teams: [],
          players: [],
        };
      }

      const teamMap = new Map<
        string,
        {
          teamId: string;
          name: string | null;
          tag?: string | null;
          logoUrl?: string | null;
        }
      >();

      const addTeam = (team?: {
        id?: string | null;
        name?: string | null;
        tag?: string | null;
        logoUrl?: string | null;
      }) => {
        if (!team?.id) return;
        if (teamMap.has(team.id)) return;
        teamMap.set(team.id, {
          teamId: team.id,
          name: team.name ?? null,
          tag: team.tag ?? null,
          logoUrl: team.logoUrl ?? null,
        });
      };

      match.matchSlots?.forEach((slot) => addTeam(slot.team ?? undefined));
      match.matchTeams?.forEach((mt) => addTeam(mt.team ?? undefined));
      match.tournament?.tournamentTeams?.forEach((tt) =>
        addTeam(tt.team ?? undefined),
      );

      const players: AdapterSnapshot['players'] = [];
      const addPlayer = (
        player?: {
          id?: string | null;
          name?: string | null;
          photoUrl?: string | null;
        },
        teamId?: string | null,
      ) => {
        if (!player?.id) return;
        players.push({
          playerId: player.id,
          name: player.name ?? null,
          teamId: teamId ?? null,
          photoUrl: player.photoUrl ?? null,
        });
      };

      match.tournament?.tournamentTeams?.forEach((tt) => {
        tt.team?.players?.forEach((p) =>
          addPlayer(
            {
              id: p.id,
              name: p.realName ?? p.ign ?? null,
              photoUrl: p.photoUrl ?? null,
            },
            tt.team?.id,
          ),
        );
      });

      return {
        match: {
          matchId: match.id,
          name: match.name ?? null,
          map: match.map ?? null,
          status: match.status ?? null,
          startedAt: match.startedAt,
          endedAt: match.endedAt,
          dataSource: match.dataSource ?? 'MANUAL',
          snapshotAt: new Date(),
        },
        teams: Array.from(teamMap.values()),
        players,
      };
    } catch (_err) {
      return {
        match: { matchId, snapshotAt: new Date() },
        teams: [],
        players: [],
      };
    }
  }
}
