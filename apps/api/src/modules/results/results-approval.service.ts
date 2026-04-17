import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuditAction, Role } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth.types';
import { PrismaService } from '../../db/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ResultsEventsService } from './results-events.service';
import type { MatchSummary } from './results.types';

@Injectable()
export class ResultsApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: ResultsEventsService,
  ) {}

  ensureUnlocked(
    actor: AuthUser,
    approval: { locked?: boolean | null } | null,
  ): void {
    if (!approval?.locked) return;
    const role = actor.actorRole ?? actor.role;
    if (role === Role.ADMIN || role === Role.SUPER_ADMIN) return;
    throw new ForbiddenException('Results are locked and require unlock');
  }

  private requireOrganizationId(
    match: MatchSummary,
    actor?: AuthUser | null,
  ): string {
    const organizationId =
      match.organizationId ??
      match.tournament?.organizationId ??
      actor?.organizationId ??
      actor?.actingOrgId ??
      null;
    if (!organizationId) {
      throw new BadRequestException(
        'organizationId is required for result approval',
      );
    }
    return organizationId;
  }

  async approveRound(
    actor: AuthUser,
    match: MatchSummary,
    reason?: string | null,
  ) {
    const organizationId = this.requireOrganizationId(match, actor);
    await this.prisma.matchSlotResult.updateMany({
      where: { matchId: match.id },
      data: { isLocked: true },
    });

    await this.audit.log({
      organizationId,
      userId: actor.actorId ?? actor.id,
      action: AuditAction.MATCH_STATUS_CHANGE,
      entityType: 'Match',
      entityId: match.id,
      before: null,
      after: { approved: true, matchId: match.id },
      source: 'MANUAL',
      reason: reason ?? null,
    });

    this.events.emitResultsUpdated(match.id, 0, {
      approved: true,
    });
    this.events.emitLeaderboardUpdated(match.id);

    return { ok: true };
  }

  async unlockRound(
    actor: AuthUser,
    match: MatchSummary,
    reason?: string | null,
  ) {
    const role = actor.actorRole ?? actor.role;
    if (role !== Role.ADMIN && role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only admins can unlock results');
    }

    const organizationId = this.requireOrganizationId(match, actor);
    await this.prisma.matchSlotResult.updateMany({
      where: { matchId: match.id },
      data: { isLocked: false },
    });

    await this.audit.log({
      organizationId,
      userId: actor.actorId ?? actor.id,
      action: AuditAction.MATCH_UNLOCK,
      entityType: 'Match',
      entityId: match.id,
      before: { locked: true },
      after: { locked: false },
      source: 'MANUAL',
      reason: reason ?? null,
    });

    this.events.emitResultsUpdated(match.id, 0, {
      unlocked: true,
    });
    this.events.emitLeaderboardUpdated(match.id);

    return { ok: true };
  }
}
