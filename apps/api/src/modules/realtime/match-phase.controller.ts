import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/auth/public.decorator';
import { MatchStreamService } from './match-stream.service';
import { CanonicalControlReadService } from './canonical-control-read.service';

@Controller('api/matches/:matchId')
export class MatchPhaseController {
  constructor(
    private readonly canonicalRead: CanonicalControlReadService,
    private readonly stream: MatchStreamService,
  ) {}

  @Public()
  @Get('phase')
  async getPhase(@Param('matchId') matchId: string) {
    return this.canonicalRead.getMatchPhase(matchId, { preferCached: false });
  }

  @Public()
  @Get('stream')
  async streamEvents(
    @Param('matchId') matchId: string,
    @Res() res: Response,
  ): Promise<void> {
    this.stream.add(matchId, res);
    const snapshot = await this.canonicalRead.getMatchPhase(matchId, {
      preferCached: false,
    });
    this.stream.emit(matchId, 'phase', snapshot);
  }
}
