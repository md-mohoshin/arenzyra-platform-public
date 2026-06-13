import { Module } from '@nestjs/common';
import { AdaptersModule } from '../adapters/adapters.module';
import { AuditModule } from '../audit/audit.module';
import { MatchesModule } from '../matches/matches.module';
import { OrganizationBrandingModule } from '../organization-branding/organization-branding.module';
import { PlayersModule } from '../players/players.module';
import { SessionsController } from './sessions.controller';
import { SessionDiscordSyncService } from './session-discord-sync.service';
import { SessionTelegramImportService } from './session-telegram-import.service';
import { SessionsStandingsService } from './sessions-standings.service';
import { SessionsService } from './sessions.service';

@Module({
  imports: [
    AdaptersModule,
    AuditModule,
    MatchesModule,
    OrganizationBrandingModule,
    PlayersModule,
  ],
  controllers: [SessionsController],
  providers: [
    SessionsService,
    SessionsStandingsService,
    SessionDiscordSyncService,
    SessionTelegramImportService,
  ],
  exports: [SessionsService, SessionsStandingsService],
})
export class SessionsModule {}
