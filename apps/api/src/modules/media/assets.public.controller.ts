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
import { Public } from '../../common/auth/public.decorator';
import { findMediaFile } from '../teams/asset.util';

@Controller('assets')
@Public()
export class AssetsPublicController {
  private readonly defaultPlayer = path.join(
    process.cwd(),
    'public',
    'assets',
    'defaults',
    'default-player.png',
  );

  @Get('players/:playerId.png')
  servePlayerPng(@Param('playerId') playerId: string, @Res() res: Response) {
    const filePath =
      findMediaFile('player', this.safeId(playerId), 'photo') ??
      this.defaultPlayer;

    return this.sendFile(res, filePath);
  }

  @Get('default-player.png')
  serveDefaultPlayer(@Res() res: Response) {
    return this.sendFile(res, this.defaultPlayer);
  }

  private sendFile(res: Response, filePath: string) {
    const mimeType = lookup(filePath);
    const contentType =
      typeof mimeType === 'string' ? mimeType : 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(filePath);
  }

  private safeId(id: string) {
    if (!id || /[^a-zA-Z0-9_-]/.test(id)) {
      throw new BadRequestException('Invalid id');
    }
    return id;
  }
}
