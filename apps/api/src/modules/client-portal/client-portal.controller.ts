import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { ClientPortalService } from './client-portal.service';
import {
  ClientPortalPaymentProofDto,
  ClientPortalSupportRequestDto,
} from './dto/client-portal-request.dto';

@Controller('organizer/client-portal')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class ClientPortalController {
  constructor(private readonly clientPortal: ClientPortalService) {}

  @Get()
  async getPortal(@Req() req: AuthRequest) {
    const data = await this.clientPortal.getPortal(req);
    return { data };
  }

  @Post('support-request')
  async sendSupportRequest(
    @Req() req: AuthRequest,
    @Body() dto: ClientPortalSupportRequestDto,
  ) {
    const data = await this.clientPortal.sendSupportRequest(req, dto);
    return { data };
  }

  @Post('payment-proof')
  async sendPaymentProof(
    @Req() req: AuthRequest,
    @Body() dto: ClientPortalPaymentProofDto,
  ) {
    const data = await this.clientPortal.sendPaymentProof(req, dto);
    return { data };
  }
}
