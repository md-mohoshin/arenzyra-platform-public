import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import {
  MatchStatus,
  Role,
  MatchDataSource,
  AuditAction,
  Match,
} from '@prisma/client';
import type {
  MatchCreatePayload,
  MatchResultAdjustmentPayload,
  ManualKillPayload,
  ManualMatchResultsPayload,
  ManualPlacementPayload,
  AssignSlotDto,
  MoveSlotDto,
  LobbyStatusValue,
  SyncPreviousMatchSlotsDto,
} from './matches.service';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { OrgScopeGuard } from '../../common/org/org-scope.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { MatchesService } from './matches.service';
import { AuditService } from '../audit/audit.service';
import { MatchStateService } from '../match-control/match-state.service';
import { MatchControlService } from '../match-control/match-control.service';
import { SetControlStateDto } from './dto/control-state.dto';

@Controller('org/:orgId')
@UseGuards(JwtAuthGuard, OrgScopeGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class MatchesController {
  constructor(
    private matches: MatchesService,
    private auditService: AuditService,
    private matchState: MatchStateService,
    private matchControl: MatchControlService,
  ) {}

  @Get('matches/:matchId')
  get(@Param('matchId') matchId: string, @Req() req: AuthenticatedRequest) {
    return this.matches.get(req.user, matchId);
  }

  @Get('matches/:matchId/teams')
  listTeams(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.listTeams(req.user, matchId);
  }

  @Get('matches/:matchId/slots')
  listSlots(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.listSlots(req.user, matchId);
  }

  @Get('matches/:matchId/results')
  listResults(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.getResults(req.user, matchId);
  }

  @Patch('matches/:matchId/results/placements')
  updatePlacements(
    @Param('matchId') matchId: string,
    @Body()
    body: {
      placements: Array<{ teamId: string; placement: number }>;
      expectedVersion?: number | null;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.updatePlacements(
      req.user,
      matchId,
      body?.placements ?? [],
      body?.expectedVersion ?? null,
    );
  }

  @Patch('matches/:matchId/results/manual')
  updateManualResults(
    @Param('matchId') matchId: string,
    @Body() body: ManualMatchResultsPayload,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.updateManualMatchResults(req.user, matchId, body ?? {});
  }

  @Get('matches/:matchId/results/adjustments')
  listResultAdjustments(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.listResultAdjustments(req.user, matchId);
  }

  @Post('matches/:matchId/results/adjustments')
  createResultAdjustment(
    @Param('matchId') matchId: string,
    @Body() body: MatchResultAdjustmentPayload,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.createResultAdjustment(req.user, matchId, body ?? {});
  }

  @Post('matches/:matchId/results/adjustments/:adjustmentId/revoke')
  revokeResultAdjustment(
    @Param('matchId') matchId: string,
    @Param('adjustmentId') adjustmentId: string,
    @Body() body: { reason?: string | null },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.revokeResultAdjustment(
      req.user,
      matchId,
      adjustmentId,
      body ?? {},
    );
  }

  @Patch('matches/:matchId/results/:teamId')
  updateResult(
    @Param('matchId') matchId: string,
    @Param('teamId') teamId: string,
    @Body() body: { kills?: number; placement?: number | null },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.updateResult(req.user, matchId, teamId, body ?? {});
  }

  @Patch('matches/:matchId/teams/:teamId/players')
  setMatchPlayers(
    @Param('matchId') matchId: string,
    @Param('teamId') teamId: string,
    @Body() body: { playerIds: string[] },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.setMatchPlayers(
      req.user,
      matchId,
      teamId,
      body?.playerIds ?? [],
    );
  }

  @Get('tournaments/:tournamentId/matches')
  list(
    @Param('tournamentId') tournamentId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.list(tournamentId, req.user);
  }

  @Get('groups/:groupId/matches')
  listByGroup(
    @Param('groupId') groupId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.listByGroup(req.user, groupId);
  }

  @Post('tournaments/:tournamentId/matches')
  create(
    @Param('tournamentId') tournamentId: string,
    @Body() body: MatchCreatePayload,
    @Req() req: AuthenticatedRequest,
  ) {
    // Body is validated upstream; suppress any typing noise from Nest's @Body inference

    return this.matches.create(tournamentId, body, req.user);
  }

  @Post('groups/:groupId/matches')
  createForGroup(
    @Param('groupId') groupId: string,
    @Body() body: MatchCreatePayload,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.createForGroup(req.user, groupId, body);
  }

  @Post('groups/:groupId/matches/bulk')
  createBulkForGroup(
    @Param('groupId') groupId: string,
    @Body() body: { matches: MatchCreatePayload[] } | MatchCreatePayload[],
    @Req() req: AuthenticatedRequest,
  ) {
    const payload: MatchCreatePayload[] = Array.isArray(body)
      ? body
      : Array.isArray(body?.matches)
        ? body.matches
        : [];
    return this.matches.createBulkForGroup(req.user, groupId, payload);
  }

  @Post('matches/:matchId/teams')
  addTeams(
    @Param('matchId') matchId: string,
    @Body('teamIds') teamIds: string[],
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.addTeams(matchId, teamIds, req.user);
  }

  @Post('matches/:matchId/slots')
  setSlot(
    @Param('matchId') matchId: string,
    @Body() body: { slotNumber: number; teamId: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.setSlot(
      matchId,
      body.slotNumber,
      body.teamId,
      req.user,
    );
  }

  @Post('matches/:matchId/slots/move')
  moveSlot(
    @Param('matchId') matchId: string,
    @Body() body: MoveSlotDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.moveSlot(matchId, body, req.user);
  }

  @Post('matches/:matchId/slots/assign')
  assignSlot(
    @Param('matchId') matchId: string,
    @Body() body: AssignSlotDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.assignMatchTeamSlot(req.user, matchId, body);
  }

  @Patch('matches/:matchId/slots/:slotNumber/lobby')
  updateSlotLobbyStatus(
    @Param('matchId') matchId: string,
    @Param('slotNumber') slotNumber: string,
    @Body() body: { lobbyStatus?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.updateSlotLobbyStatus(
      req.user,
      matchId,
      Number(slotNumber),
      (body?.lobbyStatus ?? 'WAITING') as LobbyStatusValue,
    );
  }

  @Post('matches/:matchId/slots/sync-previous')
  syncSlotsFromPreviousMatch(
    @Param('matchId') matchId: string,
    @Body() body: SyncPreviousMatchSlotsDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.syncSlotsFromPreviousMatch(matchId, req.user, body);
  }

  @Delete('matches/:matchId/slots/:slotNumber')
  clearSlot(
    @Param('matchId') matchId: string,
    @Param('slotNumber') slotNumber: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.removeSlot(matchId, Number(slotNumber), req.user);
  }

  @Delete('matches/:matchId/slots/:slotNumber/team')
  clearSlotTeam(
    @Param('matchId') matchId: string,
    @Param('slotNumber') slotNumber: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.removeSlot(matchId, Number(slotNumber), req.user);
  }

  @Patch('matches/:matchId')
  update(
    @Param('matchId') matchId: string,
    @Body() body: MatchCreatePayload,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.update(matchId, body, req.user);
  }

  @Post('matches/:matchId/set-status')
  async setStatus(
    @Param('matchId') matchId: string,
    @Body('status') status: MatchStatus,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!status || !Object.values(MatchStatus).includes(status)) {
      throw new ForbiddenException('Invalid match status');
    }
    const controlStatus =
      status === MatchStatus.LIVE
        ? 'LIVE'
        : status === MatchStatus.FINISH_PENDING
          ? 'FINISH_PENDING'
          : status === MatchStatus.ENDED
            ? 'FINISH_PENDING'
            : status === MatchStatus.FINISHED
              ? 'FINISHED'
              : 'READY';
    await this.matchControl.setStatus(req.user, matchId, {
      status: controlStatus,
      reason: `set-status ${status}`,
    });
    const updated = (await this.matches.get(req.user, matchId)) as Match;
    const organizationId = updated.tournamentId ?? null;
    await this.auditService.log({
      action: AuditAction.MATCH_STATUS_CHANGE,
      entityType: 'MATCH',
      entityId: matchId,
      userId: req.user?.actorId ?? req.user?.id,
      organizationId,
      after: { status },
      source: 'MANUAL',
    });
    return updated;
  }

  @Post('matches/:matchId/manual-kill')
  manualKill(
    @Param('matchId') matchId: string,
    @Body() body: ManualKillPayload,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.manualKill(req.user, matchId, body);
  }

  @Post('matches/:matchId/manual-placement')
  manualPlacement(
    @Param('matchId') matchId: string,
    @Body() body: ManualPlacementPayload,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.manualPlacement(req.user, matchId, body);
  }

  @Post('matches/:matchId/pcob/link')
  linkPcobSession(
    @Param('matchId') matchId: string,
    @Body('sessionId') sessionId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.linkPcobSession(req.user, matchId, sessionId);
  }

  @Post('matches/:matchId/pcob/unlink')
  unlinkPcobSession(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.unlinkPcobSession(req.user, matchId);
  }

  @Post('matches/:matchId/pcob/kill-sync')
  setPcobKillSync(
    @Param('matchId') matchId: string,
    @Body('enabled') enabled: boolean,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.setPcobKillSync(req.user, matchId, enabled);
  }

  @Post('matches/:matchId/data-source')
  setDataSource(
    @Param('matchId') matchId: string,
    @Body('dataSource') dataSource: MatchDataSource,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.setDataSource(req.user, matchId, dataSource);
  }

  @Post('matches/:matchId/telemetry-source/reset')
  resetTelemetrySource(
    @Param('matchId') matchId: string,
    @Body() body: { force?: boolean } | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.resetTelemetrySource(req.user, matchId, {
      force: body?.force === true,
    });
  }

  @Get('matches/:matchId/control-state')
  async getControlState(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.matches.getMatchWithOrg(matchId, req.user); // auth and org derivation
    const [state, lifecycle] = await Promise.all([
      this.matchState.getState(matchId),
      this.matchControl.getLifecycleState(matchId),
    ]);
    return {
      matchId: state.matchId,
      state: state.state,
      updatedAt: state.updatedAt,
      updatedByUserId: state.updatedByUserId,
      reason: state.reason,
      meta: state.meta ?? null,
      lifecycleStatus: lifecycle.lifecycleStatus,
      locks: lifecycle.locks,
    };
  }

  @Post('matches/:matchId/control-state')
  async setControlState(
    @Param('matchId') matchId: string,
    @Body() body: SetControlStateDto,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.matches.getMatchWithOrg(matchId, req.user);
    const previous = await this.matchState.getState(matchId);
    await this.matchControl.setStatus(req.user, matchId, {
      status: body.state,
      reason: body.reason ?? undefined,
      meta: body.meta ?? undefined,
    });
    const next = await this.matchState.getState(matchId);
    const lifecycle = await this.matchControl.getLifecycleState(matchId);
    return {
      previousState: previous.state,
      matchId: next.matchId,
      state: next.state,
      updatedAt: next.updatedAt,
      updatedByUserId: next.updatedByUserId,
      reason: next.reason,
      meta: next.meta ?? null,
      lifecycleStatus: lifecycle.lifecycleStatus,
      locks: lifecycle.locks,
    };
  }
}
