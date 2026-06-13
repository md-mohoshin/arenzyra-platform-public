import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role, SessionStatus, SessionType } from '@prisma/client';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { RegisterSessionTeamDto } from './dto/register-session-team.dto';
import { RemoveSessionRegistrationDto } from './dto/remove-session-registration.dto';
import { ResetSessionResultsDto } from './dto/reset-session-results.dto';
import { ListSessionRegistrationsDto } from './dto/list-session-registrations.dto';
import { CreateSessionMatchDto } from './dto/create-session-match.dto';
import { UpdateDiscordChannelPauseDto } from './dto/update-discord-channel-pause.dto';
import { UpdateSessionDiscordConfigDto } from './dto/update-session-discord-config.dto';
import { UpdateSessionRegistrationManagersDto } from './dto/update-session-registration-managers.dto';
import { UpdateSessionRegistrationPlacementDto } from './dto/update-session-registration-placement.dto';
import { UpdateSessionRegistrationPlayStatusDto } from './dto/update-session-registration-play-status.dto';
import { ImportDiscordEventDto } from './dto/import-discord-event.dto';
import { ImportProductionEventDto } from './dto/import-production-event.dto';
import { ImportTelegramEventDto } from './dto/import-telegram-event.dto';
import { SessionBrandingInputDto } from '../organization-branding/dto/update-branding.dto';
import { OrganizationBrandingService } from '../organization-branding/organization-branding.service';
import { SessionDiscordSyncService } from './session-discord-sync.service';
import { SessionTelegramImportService } from './session-telegram-import.service';
import { SessionsService } from './sessions.service';
import { SessionsStandingsService } from './sessions-standings.service';

@Controller('sessions')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ORGANIZER)
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly standings: SessionsStandingsService,
    private readonly discordSync: SessionDiscordSyncService,
    private readonly telegramImport: SessionTelegramImportService,
    private readonly branding: OrganizationBrandingService,
  ) {}

  private requireScopedOrg(req: AuthenticatedRequest): string {
    const orgId = req.orgId ?? null;
    if (!orgId) {
      throw new ForbiddenException('Organization context missing');
    }
    return orgId;
  }

  private async cleanupRemovedRegistrationDiscordRoles(
    sessionId: string,
    registrations: Array<{
      teamId: string;
      leaderDiscordUserId?: string | null;
      managerDiscordUserIds?: string[] | null;
    }>,
    req: AuthenticatedRequest,
  ) {
    if (!registrations.length) {
      return;
    }

    try {
      const result =
        await this.discordSync.cleanupManagedRolesForRemovedRegistrations(
          sessionId,
          registrations,
          req.user,
        );
      if (result.failed > 0) {
        console.warn(
          `[DiscordSync] removed registration role cleanup had ${result.failed}/${result.attempted} failure(s) for session=${sessionId}`,
        );
      }
    } catch (error) {
      console.warn(
        `[DiscordSync] removed registration role cleanup skipped session=${sessionId}: ${String(
          error,
        )}`,
      );
    }
  }

  private async cleanupRemovedRegistrationTeamLogoEmojis(
    sessionId: string,
    registrations: Array<{
      teamId: string;
      team?: { id?: string | null; logoUrl?: string | null } | null;
    }>,
    req: AuthenticatedRequest,
  ) {
    if (!registrations.length) {
      return;
    }

    try {
      const result =
        await this.discordSync.cleanupTeamLogoEmojisForRemovedRegistrations(
          sessionId,
          registrations,
          req.user,
        );
      if (result.deleted > 0) {
        console.log(
          `[DiscordSync] cleaned ${result.deleted} removed team logo emoji(s) for session=${sessionId}`,
        );
      }
    } catch (error) {
      console.warn(
        `[DiscordSync] removed team logo emoji cleanup skipped session=${sessionId}: ${String(
          error,
        )}`,
      );
    }
  }

  private async queueRegistrationPlacementDiscordSync(
    sessionId: string,
    req: AuthenticatedRequest,
  ) {
    try {
      await this.discordSync.queueSync(sessionId, req.user);
    } catch (error) {
      console.warn(
        `[DiscordSync] registration placement sync skipped session=${sessionId}: ${String(
          error,
        )}`,
      );
    }
  }

  @Post()
  create(@Body() dto: CreateSessionDto, @Req() req: AuthenticatedRequest) {
    this.requireScopedOrg(req);
    return this.sessions.create(dto, req.user);
  }

  @Get()
  list(
    @Req() req: AuthenticatedRequest,
    @Query('status') status?: SessionStatus,
    @Query('type') type?: SessionType,
  ) {
    this.requireScopedOrg(req);
    return this.sessions.list(req.user, { status, type });
  }

  @Get('discord/resolve-channel')
  resolveDiscordChannel(
    @Query('guildId') guildId: string,
    @Query('channelId') channelId: string,
    @Query('topicSessionId') topicSessionId: string | undefined,
    @Query('topicKind') topicKind: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.sessions.resolveDiscordChannel(
      guildId,
      channelId,
      {
        ...req.user,
        serviceToken: req.isServiceToken === true || req.user.serviceToken,
      },
      { topicSessionId, topicKind },
    );
  }

  @Get('discord/resolve-guild')
  resolveDiscordGuild(
    @Query('guildId') guildId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.sessions.resolveDiscordGuild(guildId, {
      ...req.user,
      serviceToken: req.isServiceToken === true || req.user.serviceToken,
    });
  }

  @Get('discord/channel-pause')
  getDiscordChannelPause(
    @Query('guildId') guildId: string,
    @Query('channelId') channelId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.sessions.getDiscordChannelPause(guildId, channelId, {
      ...req.user,
      serviceToken: req.isServiceToken === true || req.user.serviceToken,
    });
  }

  @Patch('discord/channel-pause')
  updateDiscordChannelPause(
    @Body() dto: UpdateDiscordChannelPauseDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.sessions.updateDiscordChannelPause(dto, {
      ...req.user,
      serviceToken: req.isServiceToken === true || req.user.serviceToken,
    });
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requireScopedOrg(req);
    return this.sessions.get(id, req.user);
  }

  @Get(':id/standings')
  getStandings(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requireScopedOrg(req);
    return this.standings.getStandings(id, req.user);
  }

  @Get(':id/discord-config')
  getDiscordConfig(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requireScopedOrg(req);
    return this.sessions.getDiscordConfig(id, req.user);
  }

  @Get(':id/branding')
  getBranding(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requireScopedOrg(req);
    return this.branding.getForSessionActor(req.user, id);
  }

  @Patch(':id/branding')
  updateBranding(
    @Param('id') id: string,
    @Body() dto: SessionBrandingInputDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    return this.branding.updateForSessionActor(req.user, id, dto);
  }

  @Patch(':id/discord-config')
  updateDiscordConfig(
    @Param('id') id: string,
    @Body() dto: UpdateSessionDiscordConfigDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    return this.sessions.updateDiscordConfig(id, dto, req.user);
  }

  @Post(':id/discord-sync')
  syncDiscord(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requireScopedOrg(req);
    return this.discordSync.queueSync(id, req.user);
  }

  @Post(':id/discord-logo-history-sync')
  syncDiscordLogoHistory(
    @Param('id') id: string,
    @Body() dto: { limit?: number; channelId?: string | null },
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    return this.discordSync.syncOldLogoMessages(id, dto ?? {}, req.user);
  }

  @Post(':id/discord-player-photo-history-sync')
  syncDiscordPlayerPhotoHistory(
    @Param('id') id: string,
    @Body() dto: { limit?: number; channelId?: string | null },
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    return this.discordSync.syncOldPlayerPhotoMessages(id, dto ?? {}, req.user);
  }

  @Post('discord/import-event')
  importDiscordEvent(
    @Body() dto: ImportDiscordEventDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    return this.discordSync.importEventFromDiscord(dto, req.user);
  }

  @Post('production/import-event')
  importProductionEvent(
    @Body() dto: ImportProductionEventDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    return this.discordSync.importEventFromProductionSlots(dto, req.user);
  }

  @Get('telegram/import-sources')
  getTelegramImportSources(
    @Query('chatId') chatId: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    return this.telegramImport.getImportSources(chatId);
  }

  @Post('telegram/import-event')
  importTelegramEvent(
    @Body() dto: ImportTelegramEventDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    return this.telegramImport.importEvent(dto, req.user);
  }

  @Post(':id/telegram-import')
  refreshTelegramEvent(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    return this.telegramImport.refreshEvent(id, req.user);
  }

  @Post(':id/discord-import')
  refreshDiscordEvent(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    return this.discordSync.refreshEventFromDiscord(id, req.user);
  }

  @Post(':id/discord-source-imports/refresh')
  refreshDiscordSourceImports(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    return this.discordSync.refreshForeignEventSourcesForSourceSession(
      id,
      req.user,
    );
  }

  @Post(':id/archive')
  archive(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requireScopedOrg(req);
    return this.sessions.archive(id, req.user);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requireScopedOrg(req);
    return this.sessions.restore(id, req.user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSessionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    return this.sessions.update(id, dto, req.user);
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Query('cleanupDiscord') cleanupDiscord: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    if (cleanupDiscord === 'true') {
      await this.sessions.archive(id, req.user);
      await this.discordSync.cleanupSessionDiscord(id, req.user, {
        deleteChannels: true,
        deleteRoles: true,
      });
    }
    return this.sessions.softDelete(id, req.user);
  }

  @Post(':id/register-team')
  registerTeam(
    @Param('id') id: string,
    @Body() dto: RegisterSessionTeamDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    return this.sessions.registerTeam(id, dto, req.user);
  }

  @Get(':id/registrations')
  listRegistrations(
    @Param('id') id: string,
    @Query() query: ListSessionRegistrationsDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    return this.sessions.listRegistrations(id, query, req.user);
  }

  @Delete(':id/registrations/slots')
  async removeSlotRegistrations(
    @Param('id') id: string,
    @Body() dto: RemoveSessionRegistrationDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    const result = await this.sessions.removeSlotRegistrations(
      id,
      dto,
      req.user,
    );
    await this.cleanupRemovedRegistrationDiscordRoles(
      id,
      result.removedRegistrations,
      req,
    );
    await this.cleanupRemovedRegistrationTeamLogoEmojis(
      id,
      result.removedRegistrations,
      req,
    );
    if (result.removedRegistrations.length > 0) {
      await this.queueRegistrationPlacementDiscordSync(id, req);
    }
    return result;
  }

  @Delete(':id/registrations/:registrationId')
  async removeRegistration(
    @Param('id') id: string,
    @Param('registrationId') registrationId: string,
    @Body() dto: RemoveSessionRegistrationDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    const result = await this.sessions.removeRegistration(
      id,
      registrationId,
      dto,
      req.user,
    );
    await this.cleanupRemovedRegistrationDiscordRoles(
      id,
      [result.removedRegistration],
      req,
    );
    await this.cleanupRemovedRegistrationTeamLogoEmojis(
      id,
      [result.removedRegistration],
      req,
    );
    await this.queueRegistrationPlacementDiscordSync(id, req);
    return result;
  }

  @Patch(':id/registrations/:registrationId')
  async updateRegistrationPlacement(
    @Param('id') id: string,
    @Param('registrationId') registrationId: string,
    @Body() dto: UpdateSessionRegistrationPlacementDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    const registration = await this.sessions.updateRegistrationPlacement(
      id,
      registrationId,
      dto,
      req.user,
    );
    await this.queueRegistrationPlacementDiscordSync(id, req);
    return registration;
  }

  @Patch(':id/registrations/:registrationId/play-status')
  updateRegistrationPlayStatus(
    @Param('id') id: string,
    @Param('registrationId') registrationId: string,
    @Body() dto: UpdateSessionRegistrationPlayStatusDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    return this.sessions.updateRegistrationPlayStatus(
      id,
      registrationId,
      dto,
      req.user,
    );
  }

  @Patch(':id/registrations/:registrationId/managers')
  updateRegistrationManagers(
    @Param('id') id: string,
    @Param('registrationId') registrationId: string,
    @Body() dto: UpdateSessionRegistrationManagersDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    return this.sessions.updateRegistrationManagers(
      id,
      registrationId,
      dto,
      req.user,
    );
  }

  @Post(':id/results/reset')
  resetResults(
    @Param('id') id: string,
    @Body() dto: ResetSessionResultsDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    return this.sessions.resetResultSystem(id, dto, req.user);
  }

  @Post(':id/matches')
  createMatch(
    @Param('id') id: string,
    @Body() dto: CreateSessionMatchDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    return this.sessions.createMatch(id, dto, req.user);
  }

  @Get(':id/matches')
  listMatches(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requireScopedOrg(req);
    return this.sessions.listMatches(id, req.user);
  }

  @Post(':id/matches/:matchId/sync-slots')
  syncMatchSlots(
    @Param('id') id: string,
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    return this.sessions.syncMatchSlotsFromRegistrations(id, matchId, req.user);
  }
}
