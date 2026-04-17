import { Module } from '@nestjs/common';
import { AdaptersModule } from '../adapters/adapters.module';
import { AuditModule } from '../audit/audit.module';
import { MatchesModule } from '../matches/matches.module';
import { SessionsController } from './sessions.controller';
import { SessionsStandingsService } from './sessions-standings.service';
import { SessionsService } from './sessions.service';

@Module({
  imports: [AdaptersModule, AuditModule, MatchesModule],
  controllers: [SessionsController],
  providers: [SessionsService, SessionsStandingsService],
  exports: [SessionsService, SessionsStandingsService],
})
export class SessionsModule {}
