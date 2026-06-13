import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth.types';
import { requireMatchOrganization } from '../../common/org/org.util';
import { PrismaService } from '../../db/prisma.service';
import { MatchControlService } from '../match-control/match-control.service';

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
export class ControlAutoV2ActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matchControl: MatchControlService,
  ) {}

  async startMatch(
    actor: AuthUser,
    matchId: string,
    body: StartMatchBody = {},
  ) {
    await requireMatchOrganization(this.prisma, matchId, { actor });
    return this.matchControl.startMatch(
      actor,
      matchId,
      body.sessionId ?? null,
      {
        source: body.source ?? 'control-auto-v2',
        clientId: body.clientId ?? null,
        requestedMatchId: body.requestedMatchId ?? matchId,
        expectedVersion: body.version ?? null,
      },
    );
  }

  async endMatch(actor: AuthUser, matchId: string, body: EndMatchBody = {}) {
    await requireMatchOrganization(this.prisma, matchId, { actor });
    return this.matchControl.endMatch(
      actor,
      matchId,
      body.reason ?? 'MANUAL_END',
      {
        expectedVersion: body.version ?? null,
      },
    );
  }
}
