import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import type { Actor } from '../../common/auth/jwt.strategy';
import { Roles } from '../../common/auth/roles.decorator';
import { UpdateOrganizationDiscordConfigDto } from './dto/update-organization-discord-config.dto';
import { OrganizationDiscordService } from './organization-discord.service';

@Controller('super/discord-configs')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN)
export class SuperDiscordConfigController {
  constructor(private readonly discord: OrganizationDiscordService) {}

  @Get()
  listConfigs(@CurrentUser() user: Actor) {
    return this.discord.listForSuperAdmin(user);
  }

  @Get(':organizationId')
  getConfig(
    @CurrentUser() user: Actor,
    @Param('organizationId') organizationId: string,
  ) {
    return this.discord.getForSuperAdmin(user, organizationId);
  }

  @Patch(':organizationId')
  updateConfig(
    @CurrentUser() user: Actor,
    @Param('organizationId') organizationId: string,
    @Body() dto: UpdateOrganizationDiscordConfigDto,
  ) {
    return this.discord.updateForOrganization(user, organizationId, dto);
  }
}
