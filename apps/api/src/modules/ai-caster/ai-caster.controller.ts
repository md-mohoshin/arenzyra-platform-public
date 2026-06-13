import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { AiCasterService } from './ai-caster.service';
import { PreviewAiCasterVoiceDto } from './dto/preview-ai-caster-voice.dto';
import { UpdateAiCasterSettingsDto } from './dto/update-ai-caster-settings.dto';

@Controller('api/ai-caster')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class AiCasterController {
  constructor(private readonly aiCaster: AiCasterService) {}

  @Get('access')
  getAccess(
    @Req() req: AuthenticatedRequest,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.aiCaster.getAccess(req.user, organizationId ?? null);
  }

  @Patch('settings')
  updateSettings(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateAiCasterSettingsDto,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.aiCaster.updateSettings(req.user, dto, organizationId ?? null);
  }

  @Post('voice-preview')
  previewVoice(
    @Req() req: AuthenticatedRequest,
    @Body() dto: PreviewAiCasterVoiceDto,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.aiCaster.previewVoice(req.user, dto, organizationId ?? null);
  }

  @Get('super/organizations/:orgId')
  @Roles(Role.SUPER_ADMIN)
  getSuperOrganizationAccess(
    @Req() req: AuthenticatedRequest,
    @Param('orgId') orgId: string,
  ) {
    return this.aiCaster.getAccess(req.user, orgId);
  }

  @Patch('super/organizations/:orgId/approval')
  @Roles(Role.SUPER_ADMIN)
  setApproval(
    @Req() req: AuthenticatedRequest,
    @Param('orgId') orgId: string,
    @Body() dto: { isApproved?: boolean; approved?: boolean },
  ) {
    return this.aiCaster.setApproval(
      req.user,
      orgId,
      dto.isApproved === true || dto.approved === true,
    );
  }

  @Patch('super/organizations/:orgId/settings')
  @Roles(Role.SUPER_ADMIN)
  setSuperSettings(
    @Req() req: AuthenticatedRequest,
    @Param('orgId') orgId: string,
    @Body() dto: UpdateAiCasterSettingsDto,
  ) {
    return this.aiCaster.updateSettings(req.user, dto, orgId);
  }
}
