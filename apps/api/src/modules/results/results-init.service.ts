import { Injectable } from '@nestjs/common';
import { ResultsService } from './results.service';

@Injectable()
export class ResultsInitService {
  constructor(private readonly results: ResultsService) {}

  /**
   * Idempotent initializer that creates slot and player results from slots/rosters
   * and recalculates totals.
   */
  async initResultsFromSlots(matchId: string) {
    await this.results.ensureResultsFromSlots(matchId);
    await this.results.recalculateMatchResults(matchId);
  }
}
