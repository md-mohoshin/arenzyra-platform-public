import {
  Body,
  Controller,
  Get,
  Put,
  Patch,
  UseGuards,
  Param,
} from '@nestjs/common';
import { Roles } from '../../common/auth/roles.decorator';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { Actor } from '../../common/auth/jwt.strategy';
import { OrganizationBrandingService } from './organization-branding.service';
import { OrganizationBrandingInputDto } from './dto/update-branding.dto';
import { Public } from '../../common/auth/public.decorator';

@Controller(['branding', 'api/branding'])
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrganizationBrandingController {
  constructor(private readonly branding: OrganizationBrandingService) {}

  @Get(':organizationId')
  @Public()
  getBrandingPublic(@Param('organizationId') organizationId: string) {
    return this.branding.getForOrganization(organizationId);
  }

  @Put(':organizationId')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
  updateBranding(
    @CurrentUser() user: Actor,
    @Body() dto: OrganizationBrandingInputDto,
    @Param('organizationId') organizationId: string,
  ) {
    return this.branding.updateForActor(user, organizationId, dto);
  }

  // Turbopack/Next fetches use PATCH; provide dedicated handler instead of dual decorators.
  @Patch(':organizationId')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
  patchBranding(
    @CurrentUser() user: Actor,
    @Body() dto: OrganizationBrandingInputDto,
    @Param('organizationId') organizationId: string,
  ) {
    return this.branding.updateForActor(user, organizationId, dto);
  }
}
