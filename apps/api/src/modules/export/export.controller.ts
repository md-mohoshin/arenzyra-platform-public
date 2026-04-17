import { Controller, Get, Param } from '@nestjs/common';
import { ExportService } from './export.service';
import { Public } from '../../common/auth/public.decorator';
import { ObserverService } from '../observer/observer.service';
import { ScaleService } from '../pcob/scale.service';

@Controller('api')
export class ExportController {
  constructor(
    private readonly exportSvc: ExportService,
    private readonly observerSvc: ObserverService,
    private readonly scaleSvc: ScaleService,
  ) {}

  @Get('matches')
  @Public()
  listMatches() {
    return this.exportSvc.getMatches();
  }

  @Get('matches/:matchId')
  @Public()
  match(@Param('matchId') matchId: string) {
    return this.exportSvc.getMatch(matchId) ?? { matchId, error: 'not found' };
  }

  @Get('matches/:matchId/teams')
  @Public()
  teams(@Param('matchId') matchId: string) {
    return this.exportSvc.getTeams(matchId);
  }

  @Get('matches/:matchId/placements')
  @Public()
  placements(@Param('matchId') matchId: string) {
    return this.exportSvc.getPlacements(matchId);
  }

  @Get('matches/:matchId/observer-suggestions')
  @Public()
  observer(@Param('matchId') matchId: string) {
    return this.observerSvc.getSuggestions(matchId);
  }

  @Get('matches/:matchId/nodes')
  @Public()
  nodes(@Param('matchId') matchId: string) {
    return this.scaleSvc.nodes(matchId);
  }
}
