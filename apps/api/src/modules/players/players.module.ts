import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { OrgScopeGuard } from '../../common/org/org-scope.guard';
import { PlayersController } from './players.controller';
import { PlayersService } from './players.service';
import { TournamentPlayersController } from './tournament-players.controller';
import { TournamentPlayersService } from './tournament-players.service';
import { GlobalPlayersController } from './global-players.controller';
import { GlobalPlayersService } from './global-players.service';
import { OrganizerPlayersController } from './organizer-players.controller';
import { CurrentOrgPlayersController } from './current-org-players.controller';

@Module({
  imports: [AuthModule],
  controllers: [
    PlayersController,
    GlobalPlayersController,
    TournamentPlayersController,
    OrganizerPlayersController,
    CurrentOrgPlayersController,
  ],
  providers: [
    PlayersService,
    GlobalPlayersService,
    TournamentPlayersService,
    OrgScopeGuard,
  ],
})
export class PlayersModule {}
