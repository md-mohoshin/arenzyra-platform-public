import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { Public } from '../../common/auth/public.decorator';
import { ResultsApprovalService } from './results-approval.service';
import { ResultsManualService } from './results-manual.service';
import { ResultsService } from './results.service';
import { ApprovalDto, UnlockDto } from './dto/approval.dto';
import { ManualResultDto } from './dto/manual-result.dto';
import { UpdateTeamResultsDto } from './dto/update-team-results.dto';
import { ResultsInitService } from './results-init.service';

@Controller('api/matches/:matchId')
@UseGuards(JwtAuthGuard)
export class ResultsController {
  constructor(
    private readonly results: ResultsService,
    private readonly manual: ResultsManualService,
    private readonly approval: ResultsApprovalService,
    private readonly initService: ResultsInitService,
  ) {}

  @Get('rounds/:roundIndex/results')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER, Role.REFEREE)
  async getResults(
    @Param('matchId') matchId: string,
    @Param('roundIndex', ParseIntPipe) roundIndex: number,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = req.user;
    const match = await this.results.ensureMatch(actor, matchId);
    this.results.ensureRound(match, roundIndex);
    const round = await this.results.getRoundWithData(matchId, roundIndex);
    const { slots = [], ...roundPayload } = round as Record<string, unknown> & {
      slots?: unknown;
    };
    const availableRounds = this.results.listRounds(matchId);
    return { ok: true, round: roundPayload, slots, availableRounds };
  }

  @Post('rounds/:roundIndex/results/manual')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.REFEREE)
  async setManual(
    @Param('matchId') matchId: string,
    @Param('roundIndex', ParseIntPipe) roundIndex: number,
    @Req() req: AuthenticatedRequest,
    @Body() dto: ManualResultDto,
  ) {
    const actor = req.user;
    const { round } = await this.manual.setManualResult(
      actor,
      matchId,
      roundIndex,
      dto,
    );
    return { ok: true, round };
  }

  @Post('rounds/:roundIndex/approve')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.REFEREE)
  async approve(
    @Param('matchId') matchId: string,
    @Param('roundIndex', ParseIntPipe) roundIndex: number,
    @Req() req: AuthenticatedRequest,
    @Body() dto: ApprovalDto,
  ) {
    const actor = req.user;
    const match = await this.results.ensureMatch(actor, matchId);
    this.results.ensureRound(match, roundIndex);
    await this.approval.approveRound(actor, match, dto.reason);
    const enrichedRound = await this.results.getRoundWithData(
      matchId,
      roundIndex,
    );
    const { slots = [], ...roundPayload } = enrichedRound as Record<
      string,
      unknown
    > & { slots?: unknown };
    return { ok: true, round: roundPayload, slots };
  }

  @Post('rounds/:roundIndex/unlock')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async unlock(
    @Param('matchId') matchId: string,
    @Param('roundIndex', ParseIntPipe) roundIndex: number,
    @Req() req: AuthenticatedRequest,
    @Body() dto: UnlockDto,
  ) {
    const actor = req.user;
    const match = await this.results.ensureMatch(actor, matchId);
    this.results.ensureRound(match, roundIndex);
    await this.approval.unlockRound(actor, match, dto.reason);
    const enrichedRound = await this.results.getRoundWithData(
      matchId,
      roundIndex,
    );
    const { slots = [], ...roundPayload } = enrichedRound as Record<
      string,
      unknown
    > & { slots?: unknown };
    return { ok: true, round: roundPayload, slots };
  }

  @Get('results/slots')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER, Role.REFEREE)
  async listSlotResults(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = req.user;
    const slots = await this.results.listSlotResults(actor, matchId);
    return { slots };
  }

  @Get('results')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER, Role.REFEREE)
  async listResults(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = req.user;
    const slots = await this.results.listSlotResults(actor, matchId);
    return { slots };
  }

  @Get('slot-results')
  @Public()
  async listSlotResultsPublic(@Param('matchId') matchId: string) {
    const slots = await this.results.listSlotResultsPublic(matchId);
    return { slots };
  }

  @Patch('results/slots/:slotNumber')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER, Role.REFEREE)
  async updateSlotResult(
    @Param('matchId') matchId: string,
    @Param('slotNumber', ParseIntPipe) slotNumber: number,
    @Req() req: AuthenticatedRequest,
    @Body() body: { placement?: number | null; totalKills?: number | null },
  ) {
    const actor = req.user;
    await this.results.updateSlotResult(actor, matchId, slotNumber, body);
    return { ok: true };
  }

  @Patch('results/team/:teamResultId')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER, Role.REFEREE)
  async updateTeamResult(
    @Param('matchId') matchId: string,
    @Param('teamResultId') teamResultId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: { placement?: number | null },
  ) {
    const actor = req.user;
    await this.results.updateTeamResultById(actor, matchId, teamResultId, body);
    return { ok: true };
  }

  @Patch('results/team/:teamId/players')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER, Role.REFEREE)
  async updateTeamPlayers(
    @Param('matchId') matchId: string,
    @Param('teamId') teamId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdateTeamResultsDto,
  ) {
    const actor = req.user;
    return this.results.updateTeamPlayers(
      actor,
      matchId,
      teamId,
      body ?? { players: [] },
    );
  }

  @Patch('results/team/:teamId')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER, Role.REFEREE)
  async updateTeam(
    @Param('matchId') matchId: string,
    @Param('teamId') teamId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdateTeamResultsDto,
  ) {
    const actor = req.user;
    return this.results.updateTeamPlayers(
      actor,
      matchId,
      teamId,
      body ?? { players: [] },
    );
  }

  @Patch('results/lock')
  @Roles(Role.SUPER_ADMIN)
  async setLockOverride(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: { manualLock?: boolean; forceUnlock?: boolean },
  ) {
    const actor = req.user;
    await this.results.setResultsLockOverride(actor, matchId, body);
    return { ok: true };
  }

  @Patch('results/slots/:slotNumber/players/:playerResultId')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER, Role.REFEREE)
  async updatePlayerResult(
    @Param('matchId') matchId: string,
    @Param('slotNumber', ParseIntPipe) slotNumber: number,
    @Param('playerResultId') playerResultId: string,
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      kills?: number | null;
      knocks?: number | null;
      alive?: boolean | null;
      isKnocked?: boolean | null;
      isAlive?: boolean | null;
    },
  ) {
    const actor = req.user;
    const updated = await this.results.updatePlayerResult(
      actor,
      matchId,
      slotNumber,
      playerResultId,
      body,
    );
    return updated;
  }

  @Patch('results/player/:playerResultId')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER, Role.REFEREE)
  async updatePlayerResultById(
    @Param('matchId') matchId: string,
    @Param('playerResultId') playerResultId: string,
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      kills?: number | null;
      knocks?: number | null;
      alive?: boolean | null;
      isKnocked?: boolean | null;
      isAlive?: boolean | null;
    },
  ) {
    const actor = req.user;
    const updated = await this.results.updatePlayerResultById(
      actor,
      matchId,
      playerResultId,
      body,
    );
    return updated;
  }

  @Post('results/init')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
  async initResults(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = req.user;
    const match = await this.results.ensureMatch(actor, matchId);
    this.results.ensureManualSource(match);
    await this.results.ensureResultsEditable(match, actor);
    await this.initService.initResultsFromSlots(match.id);
    return { ok: true };
  }

  @Get('results/debug-shadow')
  @Roles(Role.SUPER_ADMIN)
  async debugShadow(@Param('matchId') matchId: string) {
    const [killInfo, aliveInfo] = await Promise.all([
      this.results.debugShadowKillInfo(matchId),
      this.results.debugShadowAliveInfo(matchId),
    ]);
    return { ok: true, killInfo, aliveInfo };
  }
}
