import { Module } from '@nestjs/common';
import { MapsController } from './maps.controller';
import { MapsService } from './maps.service';
import {
  MapStateController,
  MeMapStateController,
  OperatorMapStateController,
  PublicMapOverlayStateController,
} from './map-state.controller';
import { MapStateService } from './map-state.service';
import { PcobModule } from '../pcob/pcob.module';
import { MatchControlModule } from '../match-control/match-control.module';

@Module({
  imports: [PcobModule, MatchControlModule],
  controllers: [
    MapsController,
    MapStateController,
    MeMapStateController,
    OperatorMapStateController,
    PublicMapOverlayStateController,
  ],
  providers: [MapsService, MapStateService],
})
export class MapsModule {}
