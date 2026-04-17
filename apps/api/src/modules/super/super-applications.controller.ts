import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthRequest } from '../../common/auth/auth.types';
import { SuperAdminGuard } from '../../common/auth/super-admin.guard';
import { SuperService } from './super.service';
import { RejectApplicationDto } from './dto/reject-application.dto';

@Controller('super/applications')
@UseGuards(SuperAdminGuard)
export class SuperApplicationsController {
  constructor(private readonly superService: SuperService) {}

  @Get()
  async listApplications() {
    const data = await this.superService.listApplications();
    return { data };
  }

  @Post(':id/approve')
  async approveApplication(@Param('id') id: string, @Req() req: AuthRequest) {
    const data = await this.superService.approveApplication(id, req.user);
    return { data };
  }

  @Post(':id/reject')
  async rejectApplication(
    @Param('id') id: string,
    @Body() dto: RejectApplicationDto,
  ) {
    const data = await this.superService.rejectApplication(id, dto.reason);
    return { data };
  }
}
