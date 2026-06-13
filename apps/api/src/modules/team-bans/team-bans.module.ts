import { Module } from '@nestjs/common';
import { TeamBansController } from './team-bans.controller';
import { TeamBansService } from './team-bans.service';

@Module({
  controllers: [TeamBansController],
  providers: [TeamBansService],
  exports: [TeamBansService],
})
export class TeamBansModule {}
