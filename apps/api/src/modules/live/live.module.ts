import { Module } from '@nestjs/common';
import { LiveController } from './live.controller';
import { LiveService } from './live.service';
import { StandingsService } from './standings.service';
import { StandingsController } from './standings.controller';
import { StandingsSnapshotsService } from './standings-snapshots.service';

@Module({
  controllers: [LiveController, StandingsController],
  providers: [LiveService, StandingsService, StandingsSnapshotsService],
  exports: [LiveService, StandingsService, StandingsSnapshotsService],
})
export class LiveModule {}
