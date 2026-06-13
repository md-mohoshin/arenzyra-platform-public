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
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { MatchesService } from './matches.service';
import type {
  MatchCreatePayload,
  MatchResultAdjustmentPayload,
  ManualMatchResultsPayload,
  Actor,
  LobbyStatusValue,
  MoveSlotDto,
  SyncPreviousMatchSlotsDto,
} from './matches.service';
import { UpdateTeamResultsDto } from '../results/dto/update-team-results.dto';

@Controller('me')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class MeMatchesController {
  constructor(private matches: MatchesService) {}

  @Get('matches/:matchId')
  get(@Param('matchId') matchId: string, @Req() req: AuthenticatedRequest) {
    return this.matches.get(req.user, matchId);
  }

  @Get('active-match')
  activeMatch(@Req() req: AuthenticatedRequest) {
    return this.matches.getActiveMatch(req.user);
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

  @Post('matches/:matchId/results/overrides/release')
  releaseMatchOverrides(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.releaseMatchResultOverrides(req.user, matchId);
  }

  @Post('matches/:matchId/results/team/:teamId/overrides/release')
  releaseTeamOverrides(
    @Param('matchId') matchId: string,
    @Param('teamId') teamId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.releaseTeamResultOverrides(req.user, matchId, teamId);
  }

  @Post('matches/:matchId/results/player/:playerId/overrides/release')
  releasePlayerOverrides(
    @Param('matchId') matchId: string,
    @Param('playerId') playerId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.releasePlayerResultOverrides(
      req.user,
      matchId,
      playerId,
    );
  }

  @Patch('matches/:matchId/results/:teamId')
  updateResult(
    @Param('matchId') matchId: string,
    @Param('teamId') teamId: string,
    @Body()
    body: {
      kills?: number;
      teamKills?: number | null;
      placement?: number | null;
      playerKills?: Array<{
        playerId?: string | null;
        playerResultId?: string | null;
        kills: number;
        isAlive?: boolean | null;
        alive?: boolean | null;
        isKnocked?: boolean | null;
        knocked?: boolean | null;
      }>;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.updateResult(req.user, matchId, teamId, body ?? {});
  }

  @Patch('matches/:matchId/results/team/:teamId/players')
  updateResultPlayers(
    @Param('matchId') matchId: string,
    @Param('teamId') teamId: string,
    @Body() body: UpdateTeamResultsDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.updateResultPlayers(
      req.user,
      matchId,
      teamId,
      body ?? { players: [] },
    );
  }

  @Patch('matches/:matchId/results/team/:teamId')
  updateResultTeam(
    @Param('matchId') matchId: string,
    @Param('teamId') teamId: string,
    @Body() body: UpdateTeamResultsDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.updateResultPlayers(
      req.user,
      matchId,
      teamId,
      body ?? { players: [] },
    );
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
    const actor: Actor = req.user;

    return this.matches.create(tournamentId, body, actor);
  }

  @Post('groups/:groupId/matches')
  createForGroup(
    @Param('groupId') groupId: string,
    @Body() body: MatchCreatePayload,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor: Actor = req.user;

    return this.matches.createForGroup(actor, groupId, body);
  }

  @Post('groups/:groupId/matches/bulk')
  createBulkForGroup(
    @Param('groupId') groupId: string,
    @Body() body: { matches: MatchCreatePayload[] } | MatchCreatePayload[],
    @Req() req: AuthenticatedRequest,
  ) {
    const actor: Actor = req.user;
    const payload: MatchCreatePayload[] = Array.isArray(body)
      ? body
      : Array.isArray(body?.matches)
        ? body.matches
        : [];
    return this.matches.createBulkForGroup(actor, groupId, payload);
  }

  @Post('matches/:matchId/teams')
  addTeams(
    @Param('matchId') matchId: string,
    @Body('teamIds') teamIds: string[],
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.addTeams(matchId, teamIds, req.user);
  }

  @Delete('matches/:matchId/teams/:teamId')
  removeTeam(
    @Param('matchId') matchId: string,
    @Param('teamId') teamId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor: Actor = req.user;
    return this.matches.removeTeam(matchId, teamId, actor);
  }

  @Post('matches/:matchId/slots')
  addSlot(
    @Param('matchId') matchId: string,
    @Body() body: { slotNumber: number; teamId: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.addSlot(
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
  removeSlot(
    @Param('matchId') matchId: string,
    @Param('slotNumber') slotNumber: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.removeSlot(matchId, Number(slotNumber), req.user);
  }

  @Delete('matches/:matchId/slots/:slotNumber/team')
  removeSlotTeam(
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
    const actor: Actor = req.user;

    return this.matches.update(matchId, body, actor);
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

  @Delete('matches/:matchId')
  delete(@Param('matchId') matchId: string, @Req() req: AuthenticatedRequest) {
    return this.matches.softDelete(req.user, matchId);
  }
}

@Controller('org/me')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class OrgMeMatchesController {
  constructor(private matches: MatchesService) {}

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
    const actor: Actor = req.user;

    return this.matches.create(tournamentId, body, actor);
  }

  @Post('groups/:groupId/matches')
  createForGroup(
    @Param('groupId') groupId: string,
    @Body() body: MatchCreatePayload,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor: Actor = req.user;

    return this.matches.createForGroup(actor, groupId, body);
  }

  @Post('matches/:matchId/teams')
  addTeams(
    @Param('matchId') matchId: string,
    @Body('teamIds') teamIds: string[],
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.addTeams(matchId, teamIds, req.user);
  }

  @Delete('matches/:matchId/teams/:teamId')
  removeTeam(
    @Param('matchId') matchId: string,
    @Param('teamId') teamId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.removeTeam(matchId, teamId, req.user);
  }

  @Post('matches/:matchId/slots')
  addSlot(
    @Param('matchId') matchId: string,
    @Body() body: { slotNumber: number; teamId: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.addSlot(
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

  @Post('matches/:matchId/telemetry-source/reset')
  resetOrgMeTelemetrySource(
    @Param('matchId') matchId: string,
    @Body() body: { force?: boolean } | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.resetTelemetrySource(req.user, matchId, {
      force: body?.force === true,
    });
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
  removeSlot(
    @Param('matchId') matchId: string,
    @Param('slotNumber') slotNumber: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matches.removeSlot(matchId, Number(slotNumber), req.user);
  }

  @Delete('matches/:matchId/slots/:slotNumber/team')
  removeSlotTeam(
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
    const actor: Actor = req.user;

    return this.matches.update(matchId, body, actor);
  }

  @Delete('matches/:matchId')
  delete(@Param('matchId') matchId: string, @Req() req: AuthenticatedRequest) {
    return this.matches.softDelete(req.user, matchId);
  }
}
