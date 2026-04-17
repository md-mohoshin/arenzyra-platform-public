import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  Req,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../../common/auth/public.decorator';
import { MvpService } from './mvp.service';
import { requireMatchOrganization } from '../../../common/org/org.util';
import { PrismaService } from '../../../db/prisma.service';
import type { Actor } from '../../../common/auth/jwt.strategy';

function validateMatchId(matchId?: string | null): string {
  if (!matchId) throw new BadRequestException({ error: 'INVALID_MATCH_ID' });
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(matchId)) {
    throw new BadRequestException({ error: 'INVALID_MATCH_ID' });
  }
  return matchId;
}

@Controller('widgets/mvp')
@Public()
export class MvpController {
  constructor(
    private readonly service: MvpService,
    private readonly prisma: PrismaService,
  ) {}

  private actor(req?: Request | null): Actor | null {
    return (req as Request & { user?: Actor })?.user ?? null;
  }

  private setNoCache(res: Response) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }

  @Get('state')
  async state(
    @Query('matchId') matchId?: string,
    @Query('organizationId') organizationId?: string,
    @Req() req?: Request,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const id = validateMatchId(matchId);
    const actor = this.actor(req);
    await requireMatchOrganization(this.prisma, id, {
      organizationId: organizationId ?? null,
      actor,
    });
    const state = await this.service.state(id);
    this.setNoCache(res!);
    return {
      finalized: state.finalized,
      player: state.player,
      version: state.version,
      show: state.show,
      matchStatus: state.matchStatus,
    };
  }

  @Get('state/current')
  async currentState(
    @Query('matchId') matchId?: string,
    @Query('organizationId') organizationId?: string,
    @Req() req?: Request,
    @Res({ passthrough: true }) res?: Response,
  ) {
    return this.state(matchId, organizationId, req, res);
  }

  @Post('auto')
  async auto(
    @Body('matchId') matchId?: string,
    @Body('organizationId') organizationId?: string | null,
    @Req() req?: Request,
  ) {
    const id = validateMatchId(matchId);
    const actor = this.actor(req);
    await requireMatchOrganization(this.prisma, id, {
      organizationId: organizationId ?? null,
      actor,
    });
    const state = await this.service.autoDetect(id);
    return { ok: true, version: state.version, player: state.player };
  }

  @Post('override')
  async override(
    @Body()
    body: {
      matchId?: string;
      playerId?: string;
      organizationId?: string | null;
    },
    @Req() req?: Request,
  ) {
    const id = validateMatchId(body.matchId);
    if (!body.playerId)
      throw new BadRequestException({ error: 'PLAYER_ID_REQUIRED' });
    const actor = this.actor(req);
    await requireMatchOrganization(this.prisma, id, {
      organizationId: body.organizationId ?? null,
      actor,
    });
    const state = await this.service.override(id, body.playerId);
    return { ok: true, version: state.version, player: state.player };
  }

  @Post('finalize')
  async finalize(
    @Body()
    body: {
      matchId?: string;
      playerId?: string | null;
      organizationId?: string | null;
    },
    @Req() req?: Request,
  ) {
    const id = validateMatchId(body.matchId);
    const actor = this.actor(req);
    await requireMatchOrganization(this.prisma, id, {
      organizationId: body.organizationId ?? null,
      actor,
    });
    const state = await this.service.finalize(id, body.playerId ?? null);
    return {
      ok: true,
      version: state.version,
      player: state.player,
      finalized: state.finalized,
    };
  }

  @Post('show')
  async show(
    @Body('matchId') matchId?: string,
    @Body('organizationId') organizationId?: string | null,
    @Req() req?: Request,
  ) {
    const id = validateMatchId(matchId);
    const actor = this.actor(req);
    await requireMatchOrganization(this.prisma, id, {
      organizationId: organizationId ?? null,
      actor,
    });
    const state = await this.service.show(id);
    return { ok: true, show: state.show, version: state.version };
  }

  @Post('hide')
  async hide(
    @Body('matchId') matchId?: string,
    @Body('organizationId') organizationId?: string | null,
    @Req() req?: Request,
  ) {
    const id = validateMatchId(matchId);
    const actor = this.actor(req);
    await requireMatchOrganization(this.prisma, id, {
      organizationId: organizationId ?? null,
      actor,
    });
    const state = await this.service.hide(id);
    return { ok: true, show: state.show, version: state.version };
  }

  @Post('replay')
  async replay(
    @Body('matchId') matchId?: string,
    @Body('organizationId') organizationId?: string | null,
    @Req() req?: Request,
  ) {
    const id = validateMatchId(matchId);
    const actor = this.actor(req);
    await requireMatchOrganization(this.prisma, id, {
      organizationId: organizationId ?? null,
      actor,
    });
    const state = await this.service.replay(id);
    return { ok: true, show: state.show, version: state.version };
  }
}
