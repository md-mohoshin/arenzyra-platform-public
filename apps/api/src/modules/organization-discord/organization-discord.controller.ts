import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import type { Actor } from '../../common/auth/jwt.strategy';
import { Roles } from '../../common/auth/roles.decorator';
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

  @Patch()
  updateConfig(
    @CurrentUser() user: Actor,
    @Body() dto: UpdateOrganizationDiscordConfigDto,
  ) {
    return this.discord.updateForActor(user, dto);
  }
}
