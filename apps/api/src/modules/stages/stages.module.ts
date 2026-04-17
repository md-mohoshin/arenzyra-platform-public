import { Module } from '@nestjs/common';
import { OrgScopeGuard } from '../../common/org/org-scope.guard';
import {
  OrgStagesController,
  OrgStageTeamsController,
  StagesController,
  TournamentStagesController,
} from './stages.controller';
import { StagesService } from './stages.service';
import {
  MeStagesController,
  OrgMeStagesController,
  OrgMeStageTeamsController,
} from './stages.me.controller';
import { AuditService } from '../audit/audit.service';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [
    StagesController,
    OrgStagesController,
    OrgStageTeamsController,
    TournamentStagesController,
    MeStagesController,
    OrgMeStagesController,
    OrgMeStageTeamsController,
  ],
  providers: [StagesService, OrgScopeGuard, AuditService],
})
export class StagesModule {}
