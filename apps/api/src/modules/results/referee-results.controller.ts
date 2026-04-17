import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuditAction, Role } from '@prisma/client';
import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { PrismaService } from '../../db/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScoringService } from '../scoring/scoring.service';
import { ResultsService } from './results.service';

class EditResultDto {
  @IsUUID()
  teamId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  kills?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  place?: number;

  @IsString()
  reason!: string;
}

class PenaltyDto {
  @IsUUID()
  teamId!: string;

  @IsOptional()
  @IsInt()
  deltaPoints?: number;

  @IsString()
  reason!: string;
}

@Controller('api/matches/:matchId/results')
@UseGuards(JwtAuthGuard)
export class RefereeResultsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scoring: ScoringService,
    private readonly results: ResultsService,
  ) {}

  @Post('edit')
  @Roles(Role.ADMIN, Role.REFEREE)
  async editResult(
    @Param('matchId') matchId: string,
    @Body() dto: EditResultDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const { orgId, tournamentId } = await this.ensureMatch(matchId);
    if (!orgId) {
      throw new BadRequestException('organizationId is required');
    }
    await this.ensureTeamInTournament(dto.teamId, tournamentId);

    if (dto.kills === undefined && dto.place === undefined) {
      throw new BadRequestException('Provide kills and/or place');
    }

    const { before, after } = await this.results.refereeEditSlot(
      matchId,
      dto.teamId,
      { kills: dto.kills, place: dto.place },
      req.user,
    );

    await this.audit.log({
      organizationId: orgId,
      userId: req.user.id,
      action: AuditAction.MATCH_RESULT_EDIT,
      entityType: 'MATCH_RESULT',
      entityId: matchId,
      before: before ?? null,
      after: after ?? null,
      source: 'SYSTEM',
      reason: dto.reason,
    });

    await this.pushUpdates(matchId);
    return { ok: true };
  }

  @Post('penalty')
  @Roles(Role.ADMIN, Role.REFEREE)
  async applyPenalty(
    @Param('matchId') matchId: string,
    @Body() dto: PenaltyDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const { orgId, tournamentId } = await this.ensureMatch(matchId);
    if (!orgId) {
      throw new BadRequestException('organizationId is required');
    }
    await this.ensureTeamInTournament(dto.teamId, tournamentId);

    if (dto.deltaPoints === undefined) {
      throw new BadRequestException('deltaPoints is required for penalty');
    }

    const adjustment = await this.prisma.adminAdjustment.create({
      data: {
        tournamentId,
        matchId,
        teamId: dto.teamId,
        pointsDelta: dto.deltaPoints,
        reason: dto.reason ?? 'Penalty',
        createdById: req.user.id,
      },
    });

    const { before, after, pointsDelta } =
      await this.results.recomputeSlotAfterAdjustment(
        matchId,
        dto.teamId,
        req.user,
      );

    await this.audit.log({
      organizationId: orgId,
      userId: req.user.id,
      action: AuditAction.MATCH_RESULT_EDIT,
      entityType: 'MATCH_RESULT',
      entityId: matchId,
      before: before ?? null,
      after: { ...(after ?? {}), delta: pointsDelta },
      source: 'SYSTEM',
      reason: dto.reason ?? adjustment.reason ?? 'Penalty',
    });

    await this.pushUpdates(matchId);
    return { ok: true, slot: after };
  }

  private placementPoints(place: number): number {
    if (place === 1) return 10;
    if (place === 2) return 6;
    if (place === 3) return 5;
    if (place === 4) return 4;
    if (place === 5) return 3;
    if (place === 6) return 2;
    if (place === 7 || place === 8) return 1;
    return 0;
  }

  private async ensureMatch(matchId: string): Promise<{
    orgId: string | null;
    tournamentId: string;
    controlState: string | null;
  }> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId, deletedAt: null },
      select: {
        id: true,
        tournamentId: true,
        status: true,
        liveState: true,
        dataSource: true,
        dataMode: true,
        controlState: { select: { state: true } },
        tournament: { select: { organizationId: true } },
      },
    });
    if (!match) throw new BadRequestException('Match not found');
    if (!match.tournamentId || !match.tournament) {
      throw new BadRequestException(
        'Session matches are not supported by referee results',
      );
    }
    return {
      orgId: match.tournament.organizationId ?? null,
      tournamentId: match.tournamentId,
      controlState: match.controlState?.state ?? null,
    };
  }

  private async ensureTeamInTournament(teamId: string, tournamentId: string) {
    const exists = await this.prisma.tournamentTeam.findFirst({
      where: { teamId, tournamentId, deletedAt: null },
      select: { teamId: true },
    });
    if (!exists) throw new BadRequestException('Team not in tournament');
  }

  private async pushUpdates(matchId: string) {
    await this.results.recalculateMatchResults(matchId);
    await this.scoring.recomputeMatchAndTournament(matchId);
  }
}
