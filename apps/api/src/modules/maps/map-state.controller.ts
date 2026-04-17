import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import type { AuthRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Public } from '../../common/auth/public.decorator';
import { MapStateService } from './map-state.service';

@Controller('matches')
@UseGuards(JwtAuthGuard)
export class MapStateController {
  constructor(private readonly mapState: MapStateService) {}

  @Get(':matchId/map-state')
  async getMapState(@Param('matchId') matchId: string) {
    return this.mapState.getMapState(matchId);
  }
}

@Controller('me/matches')
@UseGuards(JwtAuthGuard)
export class MeMapStateController {
  constructor(private readonly mapState: MapStateService) {}

  @Get(':matchId/state')
  async getAuthorizedMapState(
    @Param('matchId') matchId: string,
    @Req() req: AuthRequest,
  ) {
    return this.mapState.getMapStateForActor(req.user, matchId);
  }
}

@Controller('org/:orgId/operator/matches')
@UseGuards(JwtAuthGuard)
export class OperatorMapStateController {
  constructor(private readonly mapState: MapStateService) {}

  @Get(':matchId/map-state')
  async getOrgMapState(
    @Param('orgId') orgId: string,
    @Param('matchId') matchId: string,
  ) {
    return this.mapState.getOperatorMapState(orgId, matchId);
  }
}

@Controller('api/matches')
@UseGuards(JwtAuthGuard)
export class PublicMapOverlayStateController {
  constructor(private readonly mapState: MapStateService) {}

  @Get(':matchId/overlay/map/state')
  @Public()
  async getPublicMapState(@Param('matchId') matchId: string) {
    return this.mapState.getMapState(matchId);
  }
}
