import { Module } from '@nestjs/common';
import { MatchStateEngine } from './match-state.engine';

@Module({
  providers: [MatchStateEngine],
  exports: [MatchStateEngine],
})
export class MatchStateModule {}
