import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import {
  AuditAction,
  AdminAdjustment,
  DataMode,
  MatchDataSource,
  Match,
  MatchStatus,
  PcobStatus,
  Role,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import type { AuthUser } from '../../common/auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { ScoringService } from '../scoring/scoring.service';
import { PcobGateway } from '../pcob/pcob.gateway';
import { MatchControlService } from '../match-control/match-control.service';
import type { Actor as ControlActor } from '../matches/matches.service';
import type { AdminAdjustmentDto } from './dto/adjustment.dto';
import { randomUUID } from 'crypto';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { RankingEmitterService } from '../../realtime/ranking-emitter.service';
import { isMatchFinishedStatus } from '../../common/match-status.util';
import {
  buildPcobBindingData,
  buildPcobUnbindingData,
} from '../../common/pcob-binding.util';

type ActorLike = Partial<AuthUser> & { sub?: string | null };
type MatchWithTournament = Prisma.MatchGetPayload<{
  include: { tournament: true };
}> & {
  tournamentId: string;
  tournament: NonNullable<
    Prisma.MatchGetPayload<{
      include: { tournament: true };
    }>['tournament']
  >;
};

@Injectable()
export class ProductionService {
  private readonly logger = new Logger(ProductionService.name);

  constructor(
    private prisma: PrismaService,
    private scoring: ScoringService,
    private auditService: AuditService,
    private pcobGateway: PcobGateway,
    @Inject(forwardRef(() => MatchControlService))
    private readonly matchControl: MatchControlService,
    private readonly realtime: RealtimeGateway,
    private readonly rankingEmitter: RankingEmitterService,
  ) {}

  private canControl(
    actor: ActorLike | null | undefined,
    ownerUserId: string,
  ): boolean {
    if (!actor) return false;
    const role = actor.role ?? actor.actorRole;
    const actorId = actor.actorId ?? actor.id ?? actor.sub;
    if (role === Role.SUPER_ADMIN) return true;
    return actorId === ownerUserId;
  }

  private async ensureTournament(
    orgId: string | null,
    tournamentId: string,
  ): Promise<{ id: string; organizationId: string | null }> {
    const tournament = await this.prisma.tournament.findFirst({
      where: { id: tournamentId, deletedAt: null },
      select: { id: true, organizationId: true },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    if (
      orgId &&
      tournament.organizationId &&
      tournament.organizationId !== orgId
    ) {
      throw new BadRequestException('Org mismatch');
    }
    if (!tournament.organizationId && orgId) {
      await this.prisma.tournament.update({
        where: { id: tournamentId },
        data: { organizationId: orgId },
      });
      return { ...tournament, organizationId: orgId };
    }
    return tournament;
  }

  private async getMatchOrThrow(
    orgId: string | null,
    matchId: string,
    actor?: ActorLike | null,
  ): Promise<MatchWithTournament> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: { tournament: true },
    });
    if (!match || match.deletedAt)
      throw new NotFoundException('Match not found');
    if (!match.tournamentId || !match.tournament) {
      throw new BadRequestException(
        'Session matches are not supported by production controls',
      );
    }
    if (match.tournament.deletedAt)
      throw new NotFoundException('Tournament not found');
    if (actor && !this.canControl(actor, match.tournament.ownerUserId)) {
      throw new BadRequestException('Not allowed to control this match');
    }
    if (
      orgId &&
      match.tournament.organizationId &&
      match.tournament.organizationId !== orgId
    )
      throw new BadRequestException('Org mismatch');
    if (!match.tournament.organizationId && orgId) {
      await this.prisma.tournament.update({
        where: { id: match.tournamentId },
        data: { organizationId: orgId },
      });
      match.tournament.organizationId = orgId;
    }
    return match as MatchWithTournament;
  }

  private emitStatus(
    matchId: string,
    organizationId: string | null,
    status: 'UPCOMING' | 'LIVE' | 'ENDED' | 'PAUSED' | 'CANCELLED',
  ) {
    this.realtime.emitMatchStatusUpdated(organizationId, {
      matchId,
      status,
      updatedAt: new Date().toISOString(),
    });
  }

  private resolveEffectiveStatus(
    match: Pick<Match, 'status' | 'liveState'>,
  ): MatchStatus {
    if (match.liveState === 'LIVE') {
      return MatchStatus.LIVE;
    }
    if (match.liveState === 'ENDED') {
      return MatchStatus.FINISHED;
    }
    return isMatchFinishedStatus(match.status)
      ? MatchStatus.FINISHED
      : match.status;
  }

  private toControlActor(actor?: ActorLike | null): ControlActor | null {
    return actor
      ? {
          id: actor.id ?? actor.actorId ?? actor.sub ?? '',
          actorId: actor.actorId ?? actor.id ?? actor.sub ?? '',
          role: (actor.role ?? actor.actorRole) as Role | null,
          actorRole: (actor.actorRole ?? actor.role) as Role | null,
          organizationId: actor.organizationId ?? actor.actingOrgId ?? null,
          actingOrgId: actor.actingOrgId ?? null,
        }
      : null;
  }

  async startMatch(
    orgId: string | null,
    matchId: string,
    actor?: ActorLike | null,
  ): Promise<{ ok: true; dataMode: DataMode; notice?: string }> {
    const match = await this.getMatchOrThrow(orgId, matchId, actor);
    const effectiveStatus = this.resolveEffectiveStatus(match);

    if (effectiveStatus === MatchStatus.LIVE) {
      return {
        ok: true,
        dataMode: match.dataMode,
        notice:
          match.pcobMode === true ||
          match.dataMode === DataMode.PCOB ||
          match.dataSource === MatchDataSource.PCOB
            ? 'PCOB mode enabled - awaiting feed'
            : undefined,
      };
    }

    if (effectiveStatus !== MatchStatus.DRAFT) {
      throw new BadRequestException(
        'Match cannot be started from current status',
      );
    }

    const isPcob =
      match.pcobMode === true ||
      match.dataMode === DataMode.PCOB ||
      match.dataSource === MatchDataSource.PCOB;
    const shouldGenerateSession = isPcob && !match.pcobSessionId;
    const sessionUpdates: Prisma.MatchUpdateInput = shouldGenerateSession
      ? buildPcobBindingData(`sess_${randomUUID()}`)
      : {};

    const prepUpdates: Prisma.MatchUpdateInput = {
      ...sessionUpdates,
      pcobStatus: isPcob ? PcobStatus.PENDING : match.pcobStatus,
    };

    if (Object.keys(prepUpdates).length) {
      await this.prisma.match.update({
        where: { id: matchId },
        data: prepUpdates,
      });
    }

    const actorForControl = this.toControlActor(actor);

    await this.matchControl.startMatch(actorForControl, matchId);

    // Best-effort scoreboard refresh. Starting the match should not fail if
    // stale slot results from a previous run are temporarily inconsistent.
    void this.scoring.recomputeMatchAndTournament(matchId).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Post-start scoring refresh failed for match ${matchId}: ${message}`,
      );
    });

    return {
      ok: true,
      dataMode: match.dataMode,
      notice: isPcob ? 'PCOB mode enabled - awaiting feed' : undefined,
    };
  }

  async endMatch(
    orgId: string | null,
    matchId: string,
    actor?: ActorLike | null,
  ): Promise<{ ok: true }> {
    const match = await this.getMatchOrThrow(orgId, matchId, actor);

    if (this.resolveEffectiveStatus(match) !== MatchStatus.LIVE) {
      throw new BadRequestException('Match must be LIVE to end');
    }
    const actorForControl = this.toControlActor(actor);
    if (!actorForControl) {
      throw new BadRequestException('Actor is required to end a match');
    }
    await this.matchControl.endMatch(actorForControl, matchId);
    return { ok: true };
  }

  async publishOfficial(
    orgId: string | null,
    matchId: string,
    userId: string,
    actor?: ActorLike | null,
  ): Promise<{ ok: true }> {
    const match = await this.getMatchOrThrow(orgId, matchId, actor);

    if (!isMatchFinishedStatus(match.status)) {
      throw new BadRequestException(
        'Match must be ENDED before publishing official',
      );
    }

    // recompute once more to ensure latest
    const snapshot = await this.scoring.recomputeMatchAndTournament(matchId);
    if (!snapshot) throw new BadRequestException('Unable to compute snapshot');

    await this.prisma.match.update({
      where: { id: matchId },
      data: { status: MatchStatus.FINISHED },
    });

    this.emitStatus(
      matchId,
      match.tournament.organizationId ?? orgId ?? null,
      'ENDED',
    );
    void this.rankingEmitter.emitLiveRanking(matchId, { force: true });
    void this.rankingEmitter.emitOverallRanking(match.tournamentId, {
      force: true,
    });

    await this.auditService.log({
      organizationId: match.tournament.organizationId ?? orgId ?? null,
      userId,
      action: AuditAction.MATCH_STATUS_CHANGE,
      entityType: 'MATCH',
      entityId: matchId,
      source: 'SYSTEM',
    });

    return { ok: true };
  }

  async resetMatch(
    orgId: string | null,
    matchId: string,
    actor?: ActorLike | null,
  ): Promise<{ ok: true }> {
    await this.getMatchOrThrow(orgId, matchId, actor);

    // clear computed slot results instead of legacy team stats
    await this.prisma.matchSlotResult.updateMany({
      where: { matchId },
      data: {
        wasPresentInMatch: null,
        placement: null,
        placementPoints: 0,
        totalKills: 0,
        points: 0,
        totalPoints: 0,
        manualTotalKills: false,
      },
    });
    const actorForControl = this.toControlActor(actor);
    if (!actorForControl) {
      throw new BadRequestException('Actor is required to reset a match');
    }
    await this.matchControl.setStatus(actorForControl, matchId, {
      status: 'READY',
    });

    // recompute/publish to keep clients updated
    await this.scoring.recomputeMatchAndTournament(matchId);

    return { ok: true };
  }

  async createAdjustment(
    orgId: string | null,
    tournamentId: string,
    body: AdminAdjustmentDto,
  ): Promise<AdminAdjustment> {
    await this.ensureTournament(orgId, tournamentId);

    // Validate team is registered in tournament
    const tt = await this.prisma.tournamentTeam.findFirst({
      where: { tournamentId, teamId: body.teamId, deletedAt: null },
    });
    if (!tt) throw new BadRequestException('Team not registered in tournament');

    const adj = await this.prisma.adminAdjustment.create({
      data: {
        tournamentId,
        matchId: body.matchId ?? null,
        teamId: body.teamId,
        pointsDelta: Number(body.pointsDelta),
        reason: body.reason ?? 'Adjustment',
        createdById: body.createdById ?? null,
      },
    });

    const anyMatch = await this.prisma.match.findFirst({
      where: { tournamentId, deletedAt: null },
    });
    if (anyMatch) {
      await this.scoring.recomputeMatchAndTournament(anyMatch.id);
      void this.rankingEmitter.emitLiveRanking(anyMatch.id, { force: true });
    }
    void this.rankingEmitter.emitOverallRanking(tournamentId, { force: true });

    return adj;
  }

  async softDeleteAdjustment(
    orgId: string | null,
    adjustmentId: string,
  ): Promise<{ ok: true }> {
    const adj = await this.prisma.adminAdjustment.findUnique({
      where: { id: adjustmentId },
    });
    if (!adj || adj.deletedAt)
      throw new NotFoundException('Adjustment not found');

    await this.ensureTournament(orgId, adj.tournamentId);

    await this.prisma.adminAdjustment.update({
      where: { id: adjustmentId },
      data: { deletedAt: new Date() },
    });

    const anyMatch = await this.prisma.match.findFirst({
      where: { tournamentId: adj.tournamentId, deletedAt: null },
    });
    if (anyMatch) {
      await this.scoring.recomputeMatchAndTournament(anyMatch.id);
      void this.rankingEmitter.emitLiveRanking(anyMatch.id, { force: true });
    }
    void this.rankingEmitter.emitOverallRanking(adj.tournamentId, {
      force: true,
    });

    return { ok: true };
  }

  async restoreAdjustment(
    orgId: string | null,
    adjustmentId: string,
  ): Promise<{ ok: true }> {
    const adj = await this.prisma.adminAdjustment.findUnique({
      where: { id: adjustmentId },
    });
    if (!adj) throw new NotFoundException('Adjustment not found');

    await this.ensureTournament(orgId, adj.tournamentId);

    await this.prisma.adminAdjustment.update({
      where: { id: adjustmentId },
      data: { deletedAt: null },
    });

    const anyMatch = await this.prisma.match.findFirst({
      where: { tournamentId: adj.tournamentId, deletedAt: null },
    });
    if (anyMatch) {
      await this.scoring.recomputeMatchAndTournament(anyMatch.id);
      void this.rankingEmitter.emitLiveRanking(anyMatch.id, { force: true });
    }
    void this.rankingEmitter.emitOverallRanking(adj.tournamentId, {
      force: true,
    });

    return { ok: true };
  }

  async bindPcob(
    orgId: string | null,
    matchId: string,
    sessionId: string,
    actor?: ActorLike | null,
  ): Promise<Match> {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new BadRequestException('pcobSessionId is required');
    }
    const match = await this.getMatchOrThrow(orgId, matchId, actor);
    if (isMatchFinishedStatus(match.status)) {
      throw new BadRequestException('Cannot bind PCOB on an ended match');
    }
    const normalizedSessionId = sessionId.trim();
    const updated = await this.prisma.match.update({
      where: { id: matchId },
      data: buildPcobBindingData(normalizedSessionId),
    });
    this.pcobGateway.emitStatus(matchId, {
      type: 'pcob:match:bound',
      pcobSessionId: normalizedSessionId,
    });
    return updated;
  }

  async unbindPcob(
    orgId: string | null,
    matchId: string,
    actor?: ActorLike | null,
  ): Promise<Match> {
    const match = await this.getMatchOrThrow(orgId, matchId, actor);
    if (isMatchFinishedStatus(match.status)) {
      throw new BadRequestException('Cannot unbind PCOB on an ended match');
    }
    const updated = await this.prisma.match.update({
      where: { id: matchId },
      data: buildPcobUnbindingData(),
    });
    this.pcobGateway.emitStatus(matchId, { type: 'pcob:match:unbound' });
    return updated;
  }
}
