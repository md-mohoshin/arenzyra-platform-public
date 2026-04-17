import { Module } from '@nestjs/common';
import { OrgScopeGuard } from '../../common/org/org-scope.guard';
import { TournamentTeamsController } from './tournament-teams.controller';
import {
  MeTournamentTeamsController,
  OrgMeTournamentTeamsController,
} from './tournament-teams.me.controller';
import { TournamentTeamsService } from './tournament-teams.service';
import { TournamentTeamsApiController } from './tournament-teams.api.controller';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [
    TournamentTeamsController,
    TournamentTeamsApiController,
    MeTournamentTeamsController,
    OrgMeTournamentTeamsController,
  ],
  providers: [TournamentTeamsService, OrgScopeGuard],
})
export class TournamentTeamsModule {}
