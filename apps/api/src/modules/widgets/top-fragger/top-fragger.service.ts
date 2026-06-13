import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../../db/prisma.service';
import { MatchStatus } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '@prisma/client';
import { resolvePlayerPhotoUrl, resolveTeamLogoUrl } from '../widgets.snapshot';
import { isMatchFinishedStatus } from '../../../common/match-status.util';

type PlayerRow = {
  playerId?: string | null;
  name?: string | null;
  ign?: string | null;
  teamId?: string | null;
  teamTag?: string | null;
  teamLogoUrl?: string | null;
  kills?: number | null;
  knocks?: number | null;
  assists?: number | null;
  isAlive?: boolean | null;
};

type TopFiveFraggerRow = {
  playerId: string;
  ign: string;
  photoUrl: string | null;
  teamId: string | null;
  teamName: string;
  teamTag: string | null;
  teamLogo: string | null;
  teamColor: string | null;
  kills: number;
  assists: number;
  placement: number | null;
  damage: number | null;
  survivalTime: number | null;
};

@Injectable()
export class TopFraggerService {
  constructor(
    private prisma: PrismaService,
    @Optional() private audit?: AuditService,
  ) {}

  private pickTop(players: PlayerRow[]) {
    if (!players.length) return null;
    const sorted = [...players].sort((a, b) => {
      const killsDiff = (b.kills ?? 0) - (a.kills ?? 0);
      if (killsDiff !== 0) return killsDiff;
      const knocksDiff = (b.knocks ?? 0) - (a.knocks ?? 0);
      if (knocksDiff !== 0) return knocksDiff;
      return (a.ign ?? a.name ?? '').localeCompare(b.ign ?? b.name ?? '');
    });
    const top = sorted[0];
    return {
      playerId: top.playerId ?? top.ign ?? top.name ?? 'unknown',
      playerIgn: top.ign ?? top.name ?? 'Unknown',
      teamId: top.teamId ?? null,
      teamTag: top.teamTag ?? null,
      teamLogo: top.teamLogoUrl ?? null,
      kills: top.kills ?? 0,
      knocks: top.knocks ?? 0,
    };
  }

  async ensureRecord(matchId: string) {
    const existing = await this.prisma.matchTopFragger.findUnique({
      where: { matchId },
    });
    if (existing) return existing;
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { organizationId: true },
    });
    if (!match?.organizationId) {
      throw new Error('organizationId is required for top fragger');
    }
    return this.prisma.matchTopFragger.create({
      data: { matchId, version: 1, organizationId: match.organizationId },
    });
  }

  async getMatchStatus(matchId: string) {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { status: true },
    });
    return match?.status ?? 'DRAFT';
  }

  async computeAuto(matchId: string) {
    const playerRows = await this.prisma.matchSlotPlayerResult.findMany({
      where: { slotResult: { matchId } },
      include: {
        slotResult: {
          select: {
            slotNumber: true,
            team: {
              select: {
                id: true,
                tag: true,
                name: true,
                logoUrl: true,
                updatedAt: true,
              },
            },
          },
        },
        player: {
          select: {
            id: true,
            ign: true,
            realName: true,
            photoUrl: true,
            updatedAt: true,
          },
        },
      },
    });

    const players: PlayerRow[] = playerRows.map((p) => ({
      playerId: p.playerId ?? p.id,
      name: p.player?.ign ?? p.player?.realName ?? p.playerName ?? null,
      ign: p.player?.ign ?? p.playerName ?? null,
      teamId: p.slotResult?.team?.id ?? null,
      teamTag: p.slotResult?.team?.tag ?? p.slotResult?.team?.name ?? null,
      teamLogoUrl: resolveTeamLogoUrl(p.slotResult?.team ?? null),
      kills: p.kills ?? 0,
      knocks: p.knocks ?? 0,
      assists: p.assists ?? 0,
      isAlive: p.isAlive ?? null,
    }));

    return this.pickTop(players);
  }

  async topFive(matchId: string): Promise<TopFiveFraggerRow[]> {
    const playerRows = await this.prisma.matchSlotPlayerResult.findMany({
      where: { slotResult: { matchId } },
      include: {
        slotResult: {
          select: {
            slotNumber: true,
            placement: true,
            team: {
              select: {
                id: true,
                tag: true,
                name: true,
                logoUrl: true,
                logoLightUrl: true,
                logoDarkUrl: true,
                accentLight: true,
                accentDark: true,
                updatedAt: true,
              },
            },
          },
        },
        player: {
          select: {
            id: true,
            ign: true,
            realName: true,
            photoUrl: true,
            updatedAt: true,
          },
        },
      },
    });

    return playerRows
      .map((row): TopFiveFraggerRow => {
        const team = row.slotResult?.team ?? null;
        return {
          playerId: row.playerId ?? row.player?.id ?? row.id,
          ign:
            row.player?.ign ??
            row.playerName ??
            row.player?.realName ??
            'Unknown',
          photoUrl:
            resolvePlayerPhotoUrl({
              photoUrl: row.player?.photoUrl ?? null,
              photoUpdatedAt: row.player?.updatedAt ?? null,
              updatedAt: row.player?.updatedAt ?? null,
            }) ?? null,
          teamId: team?.id ?? null,
          teamName: team?.name ?? team?.tag ?? 'Team',
          teamTag: team?.tag ?? null,
          teamLogo: resolveTeamLogoUrl(team ?? null),
          teamColor: team?.accentDark ?? team?.accentLight ?? null,
          kills: Math.max(0, row.kills ?? 0),
          assists: Math.max(0, row.assists ?? 0),
          placement: row.slotResult?.placement ?? null,
          damage: null,
          survivalTime: null,
        };
      })
      .sort((left, right) => {
        if (right.kills !== left.kills) return right.kills - left.kills;
        if (right.assists !== left.assists) return right.assists - left.assists;
        return left.ign.localeCompare(right.ign);
      })
      .slice(0, 5);
  }

  async getPlayerMeta(playerId?: string | null) {
    if (!playerId) return null;
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: {
        id: true,
        ign: true,
        realName: true,
        photoUrl: true,
        updatedAt: true,
      },
    });
    if (!player) return null;
    return {
      playerId: player.id,
      playerName: player.ign ?? player.realName ?? null,
      photoUrl:
        resolvePlayerPhotoUrl({
          photoUrl: player.photoUrl ?? null,
          photoUpdatedAt: player.updatedAt ?? null,
          updatedAt: player.updatedAt ?? null,
        }) ?? null,
    };
  }

  async updateAutoIfChanged(matchId: string) {
    const status = await this.getMatchStatus(matchId);
    if (status !== MatchStatus.LIVE) return null;
    const top = await this.computeAuto(matchId);
    if (!top) return null;
    const record = await this.ensureRecord(matchId);
    const changed =
      record.autoPlayerId !== top.playerId ||
      record.autoKills !== (top.kills ?? 0) ||
      record.autoTeamId !== top.teamId ||
      record.autoTeamTag !== top.teamTag;
    if (!changed) return null;
    return this.prisma.matchTopFragger.update({
      where: { matchId },
      data: {
        autoPlayerId: top.playerId,
        autoPlayerIgn: top.playerIgn,
        autoTeamId: top.teamId,
        autoTeamTag: top.teamTag,
        autoTeamLogo: top.teamLogo,
        autoKills: top.kills ?? 0,
        version: { increment: 1 },
      },
    });
  }

  async getState(matchId: string) {
    const record = await this.ensureRecord(matchId);
    const status = await this.getMatchStatus(matchId);
    return { status, record };
  }

  async override(
    matchId: string,
    targetMode: 'live' | 'final',
    enabled: boolean,
    playerId?: string | null,
  ) {
    await this.ensureRecord(matchId);
    const data =
      targetMode === 'live'
        ? {
            overrideLiveEnabled: enabled,
            overrideLivePlayerId: enabled ? (playerId ?? null) : null,
            version: { increment: 1 },
          }
        : {
            overrideFinalEnabled: enabled,
            overrideFinalPlayerId: enabled ? (playerId ?? null) : null,
            version: { increment: 1 },
          };
    const record = await this.prisma.matchTopFragger.update({
      where: { matchId },
      data,
    });
    await this.log(matchId, enabled ? 'OVERRIDE_SET' : 'OVERRIDE_CLEAR', {
      targetMode,
      playerId,
    });
    return record;
  }

  async finalize(matchId: string) {
    const record = await this.ensureRecord(matchId);
    const status = await this.getMatchStatus(matchId);
    if (!isMatchFinishedStatus(status)) {
      throw new Error('MATCH_NOT_ENDED');
    }
    // Ensure we have an auto candidate even if match ended before live polling caught it.
    let finalizedRecord = record;
    if (!record.autoPlayerId) {
      const auto = await this.computeAuto(matchId);
      if (auto) {
        finalizedRecord = await this.prisma.matchTopFragger.update({
          where: { matchId },
          data: {
            autoPlayerId: auto.playerId ?? null,
            autoPlayerIgn: auto.playerIgn ?? null,
            autoTeamId: auto.teamId ?? null,
            autoTeamTag: auto.teamTag ?? null,
            autoTeamLogo: auto.teamLogo ?? null,
            autoKills: auto.kills ?? 0,
            version: { increment: 1 },
          },
        });
      }
    }

    const finalPlayerId =
      finalizedRecord.overrideFinalEnabled &&
      finalizedRecord.overrideFinalPlayerId
        ? finalizedRecord.overrideFinalPlayerId
        : finalizedRecord.overrideLiveEnabled &&
            finalizedRecord.overrideLivePlayerId
          ? finalizedRecord.overrideLivePlayerId
          : finalizedRecord.autoPlayerId;
    const finalKills = finalizedRecord.autoKills ?? 0;
    const updated = await this.prisma.matchTopFragger.update({
      where: { matchId },
      data: {
        finalPlayerId,
        finalKills,
        modeFinal: true,
        finalizedAt: new Date(),
        version: { increment: 1 },
      },
    });
    await this.log(matchId, 'FINALIZE', { finalPlayerId, finalKills });
    return updated;
  }

  async reset(matchId: string) {
    const updated = await this.prisma.matchTopFragger.update({
      where: { matchId },
      data: {
        modeLive: true,
        modeFinal: false,
        finalizedAt: null,
        autoPlayerId: null,
        autoPlayerIgn: null,
        autoTeamId: null,
        autoTeamTag: null,
        autoTeamLogo: null,
        autoKills: 0,
        overrideLiveEnabled: false,
        overrideFinalEnabled: false,
        overrideLivePlayerId: null,
        overrideFinalPlayerId: null,
        finalPlayerId: null,
        finalKills: null,
        version: { increment: 1 },
      },
    });
    await this.log(matchId, 'RESET', {});
    return updated;
  }

  private async log(
    matchId: string,
    action: 'OVERRIDE_SET' | 'OVERRIDE_CLEAR' | 'FINALIZE' | 'RESET',
    after: unknown,
  ) {
    if (!this.audit) return;
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        organizationId: true,
        tournament: { select: { organizationId: true } },
      },
    });
    try {
      await this.audit.log({
        organizationId:
          match?.organizationId ?? match?.tournament?.organizationId ?? null,
        userId: 'system',
        action: AuditAction.MATCH_CONTROL_STATE_CHANGED,
        entityType: 'MATCH_TOP_FRAGGER',
        entityId: matchId,
        before: null,
        after,
        source: 'SYSTEM',
        reason: action,
      });
    } catch {
      /* ignore audit failures */
    }
  }
}
