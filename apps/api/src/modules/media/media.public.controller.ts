import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import * as path from 'path';
import { lookup } from 'mime-types';
import { findMediaFile } from '../teams/asset.util';
import { Public } from '../../common/auth/public.decorator';

@Controller('media')
@Public()
export class MediaPublicController {
  private readonly defaultPlayer = path.join(
    process.cwd(),
    'public',
    'assets',
    'players',
    'default-player.svg',
  );
  private readonly defaultTeam = path.join(
    process.cwd(),
    'public',
    'assets',
    'logos',
    'default-logo.svg',
  );

  @Get('players/:playerId/photo')
  servePlayer(@Param('playerId') playerId: string, @Res() res: Response) {
    return this.serve('player', playerId, 'photo', res);
  }

  @Get('teams/:teamId/logo')
  serveTeam(@Param('teamId') teamId: string, @Res() res: Response) {
    return this.serve('team', teamId, 'logo', res);
  }

  @Get('teams/:teamId/logo-light')
  serveTeamLight(@Param('teamId') teamId: string, @Res() res: Response) {
    return this.serve('team', teamId, 'logo-light', res);
  }

  @Get('teams/:teamId/logo-dark')
  serveTeamDark(@Param('teamId') teamId: string, @Res() res: Response) {
    return this.serve('team', teamId, 'logo-dark', res);
  }

  private serve(
    kind: 'player' | 'team',
    id: string,
    variant: 'logo' | 'logo-light' | 'logo-dark' | 'photo',
    res: Response,
  ) {
    const safeId = this.safeId(id);
    const filePath =
      findMediaFile(kind, safeId, kind === 'team' ? variant : 'photo') ??
      (kind === 'team' ? findMediaFile(kind, safeId, 'logo') : null) ??
      (kind === 'team' ? this.defaultTeam : this.defaultPlayer);

    const mimeType = lookup(filePath);
    const contentType =
      typeof mimeType === 'string' ? mimeType : 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(filePath);
  }

  private safeId(id: string) {
    if (!id || /[^a-zA-Z0-9_-]/.test(id)) {
      throw new BadRequestException('Invalid id');
    }
    return id;
  }
}
