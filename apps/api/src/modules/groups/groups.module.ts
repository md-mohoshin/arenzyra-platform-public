import { Module } from '@nestjs/common';
import { OrgScopeGuard } from '../../common/org/org-scope.guard';
import { GroupsController, GroupTeamsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { AuditService } from '../audit/audit.service';
import {
  MeGroupsContextController,
  MeStageGroupsController,
  OrgMeGroupsContextController,
  OrgMeStageGroupsController,
} from './groups.me.controller';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [
    GroupsController,
    GroupTeamsController,
    MeStageGroupsController,
    MeGroupsContextController,
    OrgMeStageGroupsController,
    OrgMeGroupsContextController,
  ],
  providers: [GroupsService, OrgScopeGuard, AuditService],
})
export class GroupsModule {}
