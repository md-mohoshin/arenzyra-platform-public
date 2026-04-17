import { Module, forwardRef } from '@nestjs/common';
import { ScoringModule } from '../scoring/scoring.module';
import { AuditService } from '../audit/audit.service';
import { ProductionController } from './production.controller';
import {
  MeProductionController,
  OrgMeProductionController,
} from './production.me.controller';
import { ProductionService } from './production.service';
import { PcobModule } from '../pcob/pcob.module';
import { MatchControlModule } from '../match-control/match-control.module';
import { RealtimeModule } from '../../realtime/realtime.module';

@Module({
  imports: [
    ScoringModule,
    forwardRef(() => PcobModule),
    forwardRef(() => MatchControlModule),
    forwardRef(() => RealtimeModule),
  ],
  controllers: [
    ProductionController,
    MeProductionController,
    OrgMeProductionController,
  ],
  providers: [ProductionService, AuditService],
  exports: [ProductionService],
})
export class ProductionModule {}
