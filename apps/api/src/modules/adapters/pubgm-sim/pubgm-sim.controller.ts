import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/auth/jwt-auth.guard';
import { PubgmSimService } from './pubgm-sim.service';
import type {
  PubgmSimJumpParams,
  PubgmSimStartParams,
} from './pubgm-sim.types';

@Controller('simulator/pubgm')
@UseGuards(JwtAuthGuard)
export class PubgmSimController {
  constructor(private readonly sim: PubgmSimService) {}

  @Post('start')
  start(@Body() body: PubgmSimStartParams) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Disabled in production');
    }
    return this.sim.start(body);
  }

  @Post('stop')
  stop(@Body() body: { matchId: string }) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Disabled in production');
    }
    return this.sim.stop(body.matchId);
  }

  @Get('state/:matchId')
  state(@Param('matchId') matchId: string) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Disabled in production');
    }
    return this.sim.state(matchId);
  }

  @Post('jump')
  jump(@Body() body: PubgmSimJumpParams) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Disabled in production');
    }
    return this.sim.jump(body);
  }
}
