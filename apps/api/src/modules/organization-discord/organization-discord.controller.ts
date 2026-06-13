import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import type { Actor } from '../../common/auth/jwt.strategy';
import { Roles } from '../../common/auth/roles.decorator';
import { CompleteDiscordInstallDto } from './dto/complete-discord-install.dto';
import { MarkDiscordGuildRemovedDto } from './dto/mark-discord-guild-removed.dto';
import { UpdateOrganizationDiscordConfigDto } from './dto/update-organization-discord-config.dto';
import { OrganizationDiscordService } from './organization-discord.service';

@Controller('organizer/discord-config')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class OrganizationDiscordController {
  constructor(private readonly discord: OrganizationDiscordService) {}

  @Get()
  getConfig(@CurrentUser() user: Actor) {
    return this.discord.getForActor(user);
  }

  @Get('install-url')
  getInstallUrl(@CurrentUser() user: Actor) {
    return this.discord.createInstallUrl(user);
  }

  @Get('guild-channels')
  getGuildChannels(
    @CurrentUser() user: Actor,
    @Query('guildId') guildId?: string,
  ) {
    return this.discord.listGuildChannelsForActor(user, guildId);
  }

  @Post('install-callback')
  completeInstall(
    @CurrentUser() user: Actor,
    @Body() dto: CompleteDiscordInstallDto,
  ) {
    return this.discord.completeInstall(user, dto);
  }

  @Post('validate')
  validateConnection(@CurrentUser() user: Actor) {
    return this.discord.validateForActor(user);
  }

  @Post('guild-removed')
  markGuildRemoved(
    @CurrentUser() user: Actor,
    @Body() dto: MarkDiscordGuildRemovedDto,
  ) {
    return this.discord.markGuildRemovedByBot(user, dto);
  }

  @Patch()
  updateConfig(
    @CurrentUser() user: Actor,
    @Body() dto: UpdateOrganizationDiscordConfigDto,
  ) {
    return this.discord.updateForActor(user, dto);
  }
}
