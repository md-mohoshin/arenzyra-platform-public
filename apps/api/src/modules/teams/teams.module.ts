import { Module } from '@nestjs/common';
import { OrgScopeGuard } from '../../common/org/org-scope.guard';
import { TeamsController } from './teams.controller';
import { MeTeamsController } from './me.teams.controller';
import { TeamsService } from './teams.service';
import { TeamsApiController } from './teams.api.controller';
import { OrganizerTeamsController } from './organizer-teams.controller';
import { TeamsApiService } from './teams.api.service';
import { OverlayModule } from '../overlay/overlay.module';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [OverlayModule, AuthModule],
  controllers: [
    TeamsController,
    MeTeamsController,
    TeamsApiController,
    OrganizerTeamsController,
  ],
  providers: [TeamsService, TeamsApiService, OrgScopeGuard],
})
export class TeamsModule {}
