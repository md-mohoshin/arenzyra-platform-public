import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth.types';
import { PrismaService } from '../../db/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ResultsEventsService } from './results-events.service';
import { ResultsService } from './results.service';
import type { ManualResultDto } from './dto/manual-result.dto';

@Injectable()
export class ResultsManualService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resultsService: ResultsService,
    private readonly audit: AuditService,
    private readonly events: ResultsEventsService,
  ) {}

  async setManualResult(
    actor: AuthUser,
    matchId: string,
    roundIndex: number,
    dto: ManualResultDto,
  ) {
    const match = await this.resultsService.ensureMatch(actor, matchId);
    const isManual = this.resultsService.isManualSource(match);
    if (!isManual) {
      throw new BadRequestException(
        'Manual edits are only allowed for MANUAL matches',
      );
    }
    await this.resultsService.ensureResultsEditable(match, actor);
    await this.resultsService.ensureResultsFromSlots(match.id);

    const slot = await this.prisma.matchSlotResult.findFirst({
      where: { matchId: match.id, teamId: dto.teamId },
      include: { players: true },
    });
    if (!slot) {
      throw new BadRequestException('Team is not assigned to any slot');
    }
    await this.resultsService.assertSlotPresentForMutation(
      {
        id: slot.id,
        matchId: match.id,
        slotNumber: slot.slotNumber,
        teamId: slot.teamId ?? null,
        wasPresentInMatch: slot.wasPresentInMatch ?? null,
      },
      {
        allowManualPromote: true,
      },
    );

    const before = { ...slot };
    const placement =
      dto.placementManual !== undefined
        ? dto.placementManual
        : (slot.placement ?? null);
    const totalKills =
      dto.killsManual !== undefined
        ? Math.max(0, dto.killsManual)
        : slot.totalKills;

    await this.prisma.matchSlotResult.update({
      where: { id: slot.id },
      data: {
        placement,
        totalKills,
        manualTotalKills:
          dto.killsManual !== undefined ? true : slot.manualTotalKills,
      },
    });

    const recomputed = await this.resultsService.recomputeSlotResult(
      match.id,
      slot.slotNumber,
    );

    await this.audit.log({
      organizationId:
        match.organizationId ??
        match.tournament?.organizationId ??
        actor.organizationId ??
        actor.actingOrgId ??
        null,
      userId: actor.actorId ?? actor.id,
      action: AuditAction.MATCH_RESULT_EDIT,
      entityType: 'MatchSlotResult',
      entityId: slot.id,
      before,
      after: recomputed,
      source: 'MANUAL',
      reason: dto.reason,
    });

    const enrichedRound = await this.resultsService.getRoundWithData(
      match.id,
      roundIndex,
    );

    this.events.emitResultsUpdated(match.id, roundIndex, {
      source: 'MANUAL',
      teamId: dto.teamId,
    });
    this.events.emitLeaderboardUpdated(match.id);

    return {
      round: enrichedRound,
      updated: recomputed,
    };
  }
}
