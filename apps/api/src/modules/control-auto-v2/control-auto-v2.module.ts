import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { MatchControlModule } from '../match-control/match-control.module';
import { ControlAutoV2ActionsService } from './control-auto-v2-actions.service';
import { ControlAutoV2Controller } from './control-auto-v2.controller';
import { ControlAutoV2LiveService } from './control-auto-v2-live.service';
import { ControlAutoV2ResultsService } from './control-auto-v2-results.service';
import { ControlAutoV2Service } from './control-auto-v2.service';
import { ControlAutoV2SetupService } from './control-auto-v2-setup.service';

@Module({
  imports: [AuthModule, MatchControlModule],
  controllers: [ControlAutoV2Controller],
  providers: [
    ControlAutoV2Service,
    ControlAutoV2SetupService,
    ControlAutoV2LiveService,
    ControlAutoV2ResultsService,
    ControlAutoV2ActionsService,
  ],
})
export class ControlAutoV2Module {}
