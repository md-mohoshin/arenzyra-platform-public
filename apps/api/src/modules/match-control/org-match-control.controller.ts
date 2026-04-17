import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Body,
  Req,
  UseGuards,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  ControlState,
  MatchDataSource,
  Role,
} from '@prisma/client';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { OrgScopeGuard } from '../../common/org/org-scope.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { PrismaService } from '../../db/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MatchesService } from '../matches/matches.service';
import { ResultsService } from '../results/results.service';
import { StandingsService } from '../standings/standings.service';
import {
  deriveMatchLockContract,
  isManualResultsAuthority,
} from '../../common/match-status.util';
import { derivePcobBindingFlags } from '../../common/match-telemetry-provider.util';

type ControlSummary = {
  matchId: string;
  dataSource: string | null;
  telemetryProvider?: string | null;
  sourceMode?: 'MANUAL' | 'AUTO' | null;
  adapterKey?: string | null;
  pcobConfigured?: boolean;
  pcobBound?: boolean;
  pcobReady?: boolean;
  lifecycleStatus?: string | null;
  resultsLocked: boolean;
  slotLocked?: boolean;
  lifecycleLocked?: boolean;
  lockState?: 'LOCKED' | 'UNLOCKED';
  lockReason?: string | null;
  manualLock?: boolean;
  forceUnlock?: boolean;
  status?: string | null;
  liveState?: string | null;
  dataMode?: string | null;
  locks?: {
    lifecycleLocked: boolean;
    resultsLocked: boolean;
    slotLocked: boolean;
    resultLockState: 'LOCKED' | 'UNLOCKED';
    reason: string | null;
  };
  lastResyncAt: string | null;
};

@Controller('org/:orgId/matches/:matchId/control')
@UseGuards(JwtAuthGuard, OrgScopeGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class OrgMatchControlController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matches: MatchesService,
    private readonly results: ResultsService,
    private readonly standings: StandingsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async getControl(
    @Param('orgId') orgId: string,
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ ok: true; control: ControlSummary }> {
    const match = await this.ensureOrgMatch(orgId, matchId, req.user);
    const lastResyncAt = await this.lastResyncAt(matchId);
    const liveState = match.liveState ?? match.controlState?.state ?? null;
    const lockContract = deriveMatchLockContract({
      status: match.status ?? null,
      liveState,
      controlState: match.controlState?.state ?? null,
      metaJson: match.controlState?.metaJson ?? null,
      dataSource: match.dataSource ?? null,
      dataMode: match.dataMode ?? null,
      manualLock: match.controlState?.resultsManualLock ?? null,
      forceUnlock: match.controlState?.resultsForceUnlock ?? null,
    });
    const resultsLocked = lockContract.resultsLocked;
    const reason = lockContract.reason;
    const binding = derivePcobBindingFlags(match, {
      lifecycleStatus: lockContract.lifecycleStatus,
    });
    return {
      ok: true,
      control: {
        matchId,
        dataSource: match.dataSource ?? null,
        telemetryProvider: binding.telemetryProvider,
        sourceMode: binding.sourceMode,
        adapterKey: binding.adapterKey,
        pcobConfigured: binding.pcobConfigured,
        pcobBound: binding.pcobBound,
        pcobReady: binding.pcobReady,
        dataMode: match.dataMode ?? null,
        lifecycleStatus: lockContract.lifecycleStatus,
        resultsLocked,
        slotLocked: lockContract.slotLocked,
        lifecycleLocked: lockContract.lifecycleLocked,
        lockState: lockContract.resultLockState,
        lockReason: reason,
        manualLock: !!match.controlState?.resultsManualLock,
        forceUnlock: !!match.controlState?.resultsForceUnlock,
        status: match.status ?? null,
        liveState,
        locks: lockContract,
        lastResyncAt,
      },
    };
  }

  @Post('data-source')
  async setDataSource(
    @Param('orgId') orgId: string,
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
    @Body('dataSource') dataSource: string,
    @Body('adapterKey') adapterKey?: string,
  ): Promise<{ ok: true; dataSource: string; adapterKey: string | null }> {
    const match = await this.ensureOrgMatch(orgId, matchId, req.user);
    if (!dataSource) throw new BadRequestException('dataSource is required');
    const normalized = this.normalizeDataSource(dataSource);

    await this.matches.setDataSource(req.user, matchId, normalized);
    // adapterKey is optional and ignored if the schema does not support it; kept for forward compatibility.
    const nextAdapter = adapterKey ?? null;

    await this.audit.log({
      action: AuditAction.MATCH_STATUS_CHANGE,
      entityType: 'MATCH_CONTROL',
      entityId: matchId,
      userId: req.user.actorId ?? req.user.id,
      organizationId: match.tournament.organizationId,
      before: { dataSource: match.dataSource, adapterKey: null },
      after: { dataSource: normalized, adapterKey: nextAdapter },
      source: 'SYSTEM',
      reason: 'Set data source',
    });

    return { ok: true, dataSource: normalized, adapterKey: nextAdapter };
  }

  @Post('resync')
  async resync(
    @Param('orgId') orgId: string,
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
    @Body('reason') reason?: string,
  ): Promise<{ ok: true; lastResyncAt: string }> {
    const match = await this.ensureOrgMatch(orgId, matchId, req.user);
    await this.results.recalculateMatchResults(matchId);
    const slots = await this.results.listSlotResultsPublic(matchId);
    const at = new Date().toISOString();

    await this.audit.log({
      action: AuditAction.MATCH_RESULT_EDIT,
      entityType: 'MATCH_CONTROL',
      entityId: matchId,
      userId: req.user.actorId ?? req.user.id,
      organizationId: match.tournament.organizationId,
      before: null,
      after: { resynced: true, at, slots },
      source: 'SYSTEM',
      reason: reason ?? 'Manual resync',
    });

    return { ok: true, lastResyncAt: at };
  }

  @Post('results-lock')
  resultsLock(
    @Param('orgId') orgId: string,
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
    @Body('locked') locked: boolean,
  ): Promise<{ ok: true; locked: boolean; lockState: string }> {
    return this.setResultsLock(orgId, matchId, req.user, locked);
  }

  private normalizeDataSource(value: string): MatchDataSource {
    const upper = value.toUpperCase();
    if (upper === 'SIMULATOR') return MatchDataSource.SHADOW;
    if (!Object.values(MatchDataSource).includes(upper as MatchDataSource)) {
      throw new BadRequestException('Invalid dataSource');
    }
    return upper as MatchDataSource;
  }

  private async setResultsLock(
    orgId: string,
    matchId: string,
    actor: AuthenticatedRequest['user'],
    locked: boolean,
  ): Promise<{ ok: true; locked: boolean; lockState: string }> {
    const match = await this.ensureOrgMatch(orgId, matchId, actor);
    const actorId = actor.actorId ?? actor.id;
    if (!actorId) {
      throw new ForbiddenException('Missing actor context');
    }

    const manual = isManualResultsAuthority({
      dataSource: match.dataSource ?? null,
      dataMode: match.dataMode ?? null,
    });
    const finalizedMeta =
      match.controlState?.metaJson &&
      typeof match.controlState.metaJson === 'object'
        ? (match.controlState.metaJson as { resultFinalized?: boolean })
        : null;
    const finalized =
      finalizedMeta?.resultFinalized === true ||
      match.status === 'FINISHED' ||
      match.controlState?.state === 'CONFIRMED';

    if (!manual && !locked && !finalized) {
      throw new BadRequestException(
        'Automatic results can only be reopened after finalization.',
      );
    }

    const control = await this.prisma.matchControlState.upsert({
      where: { matchId },
      update: {
        resultsManualLock: manual ? locked : false,
        resultsForceUnlock: manual ? false : !locked,
        updatedByUserId: actorId,
      },
      create: {
        matchId,
        organizationId: match.tournament.organizationId ?? orgId,
        state: (match.controlState?.state as ControlState | null) ?? 'READY',
        resultsManualLock: manual ? locked : false,
        resultsForceUnlock: manual ? false : !locked,
        updatedByUserId: actorId,
      },
    });

    const lockContract = deriveMatchLockContract({
      status: match.status ?? null,
      liveState: match.liveState ?? control.state ?? null,
      controlState: control.state ?? null,
      metaJson: match.controlState?.metaJson ?? null,
      dataSource: match.dataSource ?? null,
      dataMode: match.dataMode ?? null,
      manualLock: control.resultsManualLock ?? null,
      forceUnlock: control.resultsForceUnlock ?? null,
    });

    await this.audit.log({
      action: AuditAction.MATCH_CONTROL_STATE_CHANGED,
      entityType: 'MATCH_CONTROL',
      entityId: matchId,
      userId: actorId,
      organizationId: match.tournament.organizationId,
      before: {
        manualLock: match.controlState?.resultsManualLock ?? null,
        forceUnlock: match.controlState?.resultsForceUnlock ?? null,
      },
      after: {
        manualLock: control.resultsManualLock ?? null,
        forceUnlock: control.resultsForceUnlock ?? null,
      },
      source: 'SYSTEM',
      reason: manual
        ? locked
          ? 'Manual lock'
          : 'Manual unlock'
        : locked
          ? 'Results locked after manual edit review'
          : 'Results reopened for manual editing',
    });

    return {
      ok: true,
      locked: lockContract.resultsLocked,
      lockState: lockContract.resultLockState,
    };
  }

  private async ensureOrgMatch(
    orgId: string,
    matchId: string,
    actor: AuthenticatedRequest['user'],
  ): Promise<{
    id: string;
    dataSource: string | null;
    dataMode: string | null;
    pcobSessionId: string | null;
    pcobMode: boolean | null;
    pcobBoundAt: Date | null;
    pcobLastSeenAt: Date | null;
    adapterKey: string | null;
    status: string | null;
    liveState: string | null;
    controlState: {
      state: string | null;
      metaJson: unknown;
      resultsManualLock: boolean | null;
      resultsForceUnlock: boolean | null;
    } | null;
    tournament: { organizationId: string | null; ownerUserId: string | null };
  }> {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        id: true,
        dataSource: true,
        dataMode: true,
        pcobSessionId: true,
        pcobMode: true,
        pcobBoundAt: true,
        pcobLastSeenAt: true,
        adapterKey: true,
        status: true,
        liveState: true,
        controlState: {
          select: {
            state: true,
            metaJson: true,
            resultsManualLock: true,
            resultsForceUnlock: true,
          },
        },
        tournament: { select: { organizationId: true, ownerUserId: true } },
      },
    });
    if (!match) throw new NotFoundException('Match not found');
    if (!match.tournament) {
      throw new BadRequestException(
        'Session matches are not supported by organization match control',
      );
    }
    if (match.tournament.organizationId !== orgId) {
      throw new ForbiddenException('Match not in organization');
    }

    const actorRole = actor.actorRole ?? actor.role;
    const actorOrg = actor.actingOrgId ?? actor.organizationId;
    if (actorRole !== 'SUPER_ADMIN' && actorOrg && actorOrg !== orgId) {
      throw new ForbiddenException('Not allowed for this organization');
    }

    return match as {
      id: string;
      dataSource: string | null;
      dataMode: string | null;
      pcobSessionId: string | null;
      pcobMode: boolean | null;
      pcobBoundAt: Date | null;
      pcobLastSeenAt: Date | null;
      adapterKey: string | null;
      status: string | null;
      liveState: string | null;
      controlState: {
        state: string | null;
        metaJson: unknown;
        resultsManualLock: boolean | null;
        resultsForceUnlock: boolean | null;
      } | null;
      tournament: { organizationId: string | null; ownerUserId: string | null };
    };
  }

  private async lastResyncAt(matchId: string): Promise<string | null> {
    const audit = await this.prisma.auditLog.findFirst({
      where: {
        entityId: matchId,
        action: AuditAction.MATCH_RESULT_EDIT,
        entityType: 'MATCH_CONTROL',
      },
      select: { createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return audit?.createdAt?.toISOString?.() ?? null;
  }
}
