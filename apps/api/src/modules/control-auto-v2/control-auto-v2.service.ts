import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth.types';
import { ControlAutoV2ActionsService } from './control-auto-v2-actions.service';
import { ControlAutoV2LiveService } from './control-auto-v2-live.service';
import { ControlAutoV2ResultsService } from './control-auto-v2-results.service';
import { ControlAutoV2SetupService } from './control-auto-v2-setup.service';

type StartMatchBody = {
  sessionId?: string | null;
  source?: string | null;
  clientId?: string | null;
  requestedMatchId?: string | null;
  version?: number | null;
};

type EndMatchBody = {
  reason?: string | null;
  version?: number | null;
};

@Injectable()
export class ControlAutoV2Service {
  constructor(
    private readonly setupService: ControlAutoV2SetupService,
    private readonly liveService: ControlAutoV2LiveService,
    private readonly resultsService: ControlAutoV2ResultsService,
    private readonly actionsService: ControlAutoV2ActionsService,
  ) {}

  getSetup(actor: AuthUser, matchId: string) {
    return this.setupService.getSetup(actor, matchId);
  }

  getLive(actor: AuthUser, matchId: string) {
    return this.liveService.getLive(actor, matchId);
  }

  getResults(actor: AuthUser, matchId: string) {
    return this.resultsService.getResults(actor, matchId);
  }

  startMatch(actor: AuthUser, matchId: string, body: StartMatchBody = {}) {
    return this.actionsService.startMatch(actor, matchId, body);
  }

  endMatch(actor: AuthUser, matchId: string, body: EndMatchBody = {}) {
    return this.actionsService.endMatch(actor, matchId, body);
  }
}
