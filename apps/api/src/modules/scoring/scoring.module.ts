import { Module, forwardRef } from '@nestjs/common';
import { LiveModule } from '../live/live.module';
import { ScoreboardModule } from '../scoreboard/scoreboard.module';
import { ResultsModule } from '../results/results.module';
import { ScoringController } from './scoring.controller';
import { ScoringRecalcController } from './scoring.recalc.controller';
import { ScoringScoreController } from './scoring.score.controller';
import { ScoringService } from './scoring.service';

@Module({
  imports: [
    LiveModule,
    forwardRef(() => ScoreboardModule),
    forwardRef(() => ResultsModule),
  ],
  controllers: [
    ScoringController,
    ScoringRecalcController,
    ScoringScoreController,
  ],
  providers: [ScoringService],
  exports: [ScoringService],
})
export class ScoringModule {}
