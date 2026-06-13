import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Query,
  Body,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { TopFraggerService } from './top-fragger.service';
import { Public } from '../../../common/auth/public.decorator';
import { requireMatchOrganization } from '../../../common/org/org.util';
import { PrismaService } from '../../../db/prisma.service';
import type { Actor } from '../../../common/auth/jwt.strategy';
import { normalizePublicAssetUrl } from '../../../common/public-asset-url.util';

@Public()
@Controller('widgets/top-fragger')
export class TopFraggerController {
  constructor(
    private svc: TopFraggerService,
    private readonly prisma: PrismaService,
  ) {}

  private actor(req?: Request | null): Actor | null {
    return (req as Request & { user?: Actor })?.user ?? null;
  }

  @Get('state')
  async state(
    @Query('matchId') matchId?: string,
    @Query('mode') mode?: string,
    @Query('organizationId') organizationId?: string,
    @Req() req?: Request,
  ) {
    if (!matchId) throw new BadRequestException({ error: 'INVALID_MATCH_ID' });
    const actor = this.actor(req);
    await requireMatchOrganization(this.prisma, matchId, {
      organizationId: organizationId ?? null,
      actor,
    });
    await this.svc.updateAutoIfChanged(matchId).catch(() => null);
    const { record } = await this.svc.getState(matchId);
    const useFinal = (mode ?? 'live').toLowerCase() === 'final';
    const active =
      useFinal && record.overrideFinalEnabled && record.overrideFinalPlayerId
        ? { playerId: record.overrideFinalPlayerId, kills: record.autoKills }
        : useFinal && record.finalPlayerId
          ? {
              playerId: record.finalPlayerId,
              kills: record.finalKills ?? record.autoKills,
            }
          : !useFinal &&
              record.overrideLiveEnabled &&
              record.overrideLivePlayerId
            ? { playerId: record.overrideLivePlayerId, kills: record.autoKills }
            : record.autoPlayerId
              ? { playerId: record.autoPlayerId, kills: record.autoKills }
              : null;

    let activeMeta: {
      playerId?: string | null;
      playerName?: string | null;
      photoUrl?: string | null;
      teamTag?: string | null;
      teamLogo?: string | null;
    } | null = null;
    if (active) {
      // derive from stored fields first
      activeMeta = {
        playerId: active.playerId,
        playerName:
          (useFinal && record.finalPlayerIgn) ||
          (record.overrideLiveEnabled &&
          record.overrideLivePlayerId === active.playerId
            ? record.autoPlayerIgn
            : record.autoPlayerIgn),
        teamTag: record.autoTeamTag ?? null,
        teamLogo: normalizePublicAssetUrl(record.autoTeamLogo ?? null),
      };
      // fetch player details if name/photo missing
      if (!activeMeta.playerName || !activeMeta.photoUrl) {
        const meta = await this.svc.getPlayerMeta(active.playerId);
        activeMeta = {
          ...activeMeta,
          playerName: activeMeta.playerName ?? meta?.playerName ?? null,
          photoUrl: meta?.photoUrl ?? null,
        };
      }
    }

    return {
      matchId,
      modeLive: record.modeLive,
      modeFinal: record.modeFinal,
      finalizedAt: record.finalizedAt,
      auto: { playerId: record.autoPlayerId, kills: record.autoKills },
      overrideLive: {
        enabled: record.overrideLiveEnabled,
        playerId: record.overrideLivePlayerId,
      },
      overrideFinal: {
        enabled: record.overrideFinalEnabled,
        playerId: record.overrideFinalPlayerId,
      },
      final: { playerId: record.finalPlayerId, kills: record.finalKills },
      version: record.version,
      updatedAt: record.updatedAt,
      active: active
        ? {
            ...active,
            playerName: activeMeta?.playerName ?? active.playerId,
            playerPhoto: activeMeta?.photoUrl ?? null,
            teamTag: activeMeta?.teamTag ?? null,
            teamLogo: activeMeta?.teamLogo ?? null,
          }
        : null,
    };
  }

  @Get('state/current')
  async currentState(
    @Query('matchId') matchId?: string,
    @Query('mode') mode?: string,
    @Query('organizationId') organizationId?: string,
    @Req() req?: Request,
  ) {
    return this.state(matchId, mode, organizationId, req);
  }

  @Get('top-5')
  async topFive(
    @Query('matchId') matchId?: string,
    @Query('organizationId') organizationId?: string,
    @Req() req?: Request,
  ) {
    if (!matchId) throw new BadRequestException({ error: 'INVALID_MATCH_ID' });
    const actor = this.actor(req);
    await requireMatchOrganization(this.prisma, matchId, {
      organizationId: organizationId ?? null,
      actor,
    });
    const players = await this.svc.topFive(matchId);
    return {
      version: 'v1',
      matchId,
      players,
      updatedAt: new Date().toISOString(),
    };
  }

  @Post('override')
  async override(
    @Body('matchId') matchId: string,
    @Body('targetMode') targetMode: 'live' | 'final',
    @Body('enabled') enabled: boolean,
    @Body('playerId') playerId?: string | null,
    @Body('organizationId') organizationId?: string | null,
    @Req() req?: Request,
  ) {
    if (!matchId || !targetMode)
      throw new BadRequestException({ error: 'INVALID_PAYLOAD' });
    const actor = this.actor(req);
    await requireMatchOrganization(this.prisma, matchId, {
      organizationId: organizationId ?? null,
      actor,
    });
    const record = await this.svc.override(
      matchId,
      targetMode,
      !!enabled,
      playerId ?? null,
    );
    return { ok: true, state: record };
  }

  @Post('override/clear')
  async clear(
    @Body('matchId') matchId: string,
    @Body('targetMode') targetMode: 'live' | 'final',
    @Body('organizationId') organizationId?: string | null,
    @Req() req?: Request,
  ) {
    if (!matchId || !targetMode)
      throw new BadRequestException({ error: 'INVALID_PAYLOAD' });
    const actor = this.actor(req);
    await requireMatchOrganization(this.prisma, matchId, {
      organizationId: organizationId ?? null,
      actor,
    });
    const record = await this.svc.override(matchId, targetMode, false, null);
    return { ok: true, state: record };
  }

  @Post('finalize')
  async finalize(
    @Body('matchId') matchId: string,
    @Body('organizationId') organizationId?: string | null,
    @Req() req?: Request,
  ) {
    if (!matchId) throw new BadRequestException({ error: 'INVALID_MATCH_ID' });
    const actor = this.actor(req);
    await requireMatchOrganization(this.prisma, matchId, {
      organizationId: organizationId ?? null,
      actor,
    });
    const record = await this.svc.finalize(matchId);
    return { ok: true, state: record };
  }

  @Post('reset')
  async reset(
    @Body('matchId') matchId: string,
    @Body('organizationId') organizationId?: string | null,
    @Req() req?: Request,
  ) {
    if (!matchId) throw new BadRequestException({ error: 'INVALID_MATCH_ID' });
    const actor = this.actor(req);
    await requireMatchOrganization(this.prisma, matchId, {
      organizationId: organizationId ?? null,
      actor,
    });
    const record = await this.svc.reset(matchId);
    return { ok: true, state: record };
  }
}
